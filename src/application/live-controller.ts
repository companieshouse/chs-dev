import { isActiveContainer } from '../domain/containers.js';
import {
    mockOnlyInventory,
    inventoryKey,
    filterSshRequirements,
    isStopOnly,
    LiveFailure,
    LifecycleBlocked,
    PlanChangeRequired,
    SshSetupRequired,
    previewChanges,
    retainsContainer,
    type BlockedReason,
    type ConfigurationRevision,
    type ContainerAction,
    type EnvironmentChanges,
    type InventoryEntry,
    type LivePreview,
    type LiveRuntime,
    type LiveState,
    type PreparationApi,
    type PreparedProject,
    type RuntimeContainer,
    type RuntimeSnapshot,
    type RuntimeOperationResult,
    type SshSetupService,
    type SshSecretRequirement,
    type SshSetupStatus,
} from '../domain/live.js';
import { dependencyOrder } from '../domain/service-dependencies.js';
import { safeLog } from '../domain/live-logs.js';
import type {
    ContainerManager,
    ContainerSummary,
} from '../domain/containers.js';
import type { LogEvent, LogFields } from '../domain/diagnostics.js';

export interface LiveDependencies {
    runtime: LiveRuntime;
    preparation: PreparationApi;
    configuration: { read(): Promise<ConfigurationRevision> };
    verifyAws(signal?: AbortSignal): Promise<{ state: string }>;
    ssh?: SshSetupService;
    lock: { acquire(): Promise<() => Promise<void>> };
    clock: {
        now(): Date;
    };
    eventSink?(event: LogEvent, fields?: LogFields): void;
    operation?(work: () => Promise<void>): Promise<void>;
    /** The daemon requires a Start in this login session before adopting running intent. */
    explicitStart?: boolean;
    initialIntent?: LiveIntent;
}

export interface LiveIntent {
    running: boolean;
    paused: boolean;
    applied?: string;
    baseline?: string;
    stoppedByUser: readonly string[];
}

type ServiceResult = { ok: boolean; message: string };

type RevisionPlan = {
    revision: ConfigurationRevision;
    resolved: Pick<
        PreparedProject,
        | 'inventory'
        | 'projectName'
        | 'projectDirectory'
        | 'configurationIdentity'
        | 'sshRequirements'
    >;
    observed: RuntimeSnapshot;
};

/** Exit codes from a normal stop: success, SIGINT, SIGKILL and SIGTERM. */
const stopExitCodes = [0, 130, 137, 143];
const isActive = (container: RuntimeContainer) =>
    isActiveContainer(container.lifecycle);

function appliedChain(service: string, observed: RuntimeSnapshot) {
    const containers = new Map(
        observed.containers.map((container) => [container.service, container]),
    );
    const dependencies = new Map(
        observed.containers.map((container) => [
            container.service,
            container.policy?.dependencies ?? [],
        ]),
    );
    return dependencyOrder(service, dependencies).map((name) => {
        const container = containers.get(name);
        if (!container?.policy)
            throw new LifecycleBlocked(
                `Applied lifecycle metadata is unavailable for ${name}. Apply configuration first.`,
            );
        return container;
    });
}

function logicalRoots(services: readonly string[], observed: RuntimeSnapshot) {
    const owners = new Map<string, string>();
    for (const container of observed.containers) {
        const owner = container.ownerService ?? container.service;
        owners.set(container.service, owner);
        owners.set(owner, owner);
    }
    return [
        ...new Set(
            services.map((service) => {
                const owner = owners.get(service);
                if (!owner)
                    throw new LifecycleBlocked(
                        `${service} has no owned container. Apply configuration before starting it.`,
                    );
                return owner;
            }),
        ),
    ];
}

function appliedOwners(roots: readonly string[], observed: RuntimeSnapshot) {
    return [
        ...new Set(
            roots.flatMap((root) =>
                appliedChain(root, observed).map(
                    (container) => container.ownerService ?? container.service,
                ),
            ),
        ),
    ];
}

function assertIdleTarget(service: string, observed: RuntimeSnapshot) {
    const target = appliedChain(service, observed).at(-1)!;
    if (!target.policy!.lazy && !target.policy!.reclaimable)
        throw new LifecycleBlocked(
            `${service} is not managed for idle unload. Apply configuration first.`,
        );
    for (const container of observed.containers) {
        if (
            !isActive(container) ||
            (container.ownerService ?? container.service) === service
        )
            continue;
        const needed = appliedChain(container.service, observed).some(
            (dependency) =>
                (dependency.ownerService ?? dependency.service) === service,
        );
        if (needed)
            throw new LifecycleBlocked(
                `${container.ownerService ?? container.service} is still running and requires ${service}.`,
            );
    }
}

function modeChanges(
    revision: ConfigurationRevision,
    observed: RuntimeSnapshot,
): string[] {
    return revision.inventory
        .filter((entry) =>
            observed.containers.some(
                (container) =>
                    container.service === entry.service &&
                    container.mode !== undefined &&
                    container.mode !== entry.mode,
            ),
        )
        .map((entry) => entry.service);
}

function blockedFailureReason(
    failure: LiveFailure | undefined,
    sshSetup: SshSetupStatus | undefined,
): BlockedReason {
    if (sshSetup) return 'ssh';
    if (failure?.kind === 'aws' || failure?.kind === 'ecr') return failure.kind;

    return failure?.reason ?? 'other';
}

function authenticationFailure(
    failure?: LiveFailure,
): 'aws' | 'ecr' | undefined {
    if (failure?.kind === 'aws' || failure?.kind === 'ecr') return failure.kind;

    return undefined;
}

function observedServiceHealth(
    revision: ConfigurationRevision,
    observed: RuntimeSnapshot,
) {
    const inventory = new Set(revision.inventory.map((entry) => entry.service));
    const anyUp = observed.containers.some(
        (container) => inventory.has(container.service) && isActive(container),
    );

    // Crashed containers mean a failing environment, not a stopped one.
    const crashed = observed.containers.some(
        (container) =>
            inventory.has(container.service) &&
            container.lifecycle === 'exited' &&
            (container.oomKilled === true ||
                (container.exitCode !== undefined &&
                    !stopExitCodes.includes(container.exitCode))),
    );

    return { anyUp, crashed };
}

export class LiveController {
    private state: LiveState;
    private listeners = new Set<() => void>();
    private abort?: AbortController;
    private operation?: Promise<void>;
    private stopping?: Promise<void>;
    private release?: () => Promise<void>;
    private releasing?: Promise<void>;
    private paused = false;
    private closed = false;
    private authentication?: 'aws' | 'ecr';
    private applied?: string;
    private approvedStops: readonly string[] = [];
    /** Configuration identity when a running environment was detected at launch. */
    private baseline?: string;
    private polling = false;
    private configurationEpoch = 0;
    /** This checkout's Compose project identity has been confirmed. */
    private identified = false;
    private pollError?: string;
    private pollAbort?: AbortController;
    private pollOperation?: Promise<void>;
    private phaseStarted = Date.now();

    constructor(private readonly dependencies: LiveDependencies) {
        this.state = {
            running: false,
            autoApply: false,
            phase: 'Stopped',
            message: '',
            stoppedByUser: [],
            logs: [],
            logSequence: 0,
            busy: false,
        };

        const intent = dependencies.initialIntent;
        if (intent) {
            this.paused = intent.paused;
            this.applied = intent.applied;
            this.baseline = intent.baseline;
            this.state.running = intent.running;
            this.state.stoppedByUser = intent.stoppedByUser;
            this.state.phase = intent.running
                ? intent.paused
                    ? 'Blocked'
                    : 'Running'
                : 'Stopped';
            this.state.blocked =
                intent.running && intent.paused ? 'cancelled' : undefined;
            this.state.message =
                intent.running && intent.paused
                    ? 'Supervision is paused. Inspect the environment and choose Try again.'
                    : '';
        }
    }

    getIntent(): LiveIntent {
        return {
            running: this.state.running,
            paused: this.paused,
            applied: this.applied,
            baseline: this.baseline,
            stoppedByUser: [...this.state.stoppedByUser],
        };
    }

    async waitUntilIdle(): Promise<void> {
        let operation: Promise<void> | undefined;

        do {
            operation = this.operation;
            await operation;
        } while (operation !== this.operation);
    }

    /** Health observation stays independent of the serialized lifecycle monitor. */
    async probe(signal?: AbortSignal): Promise<void> {
        if (this.closed) return;

        await this.dependencies.runtime.probe?.({ signal });
        if (!this.closed) await this.refresh();
    }

    getSnapshot = (): LiveState => this.state;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private update(update: Partial<LiveState>) {
        if (this.stopping)
            update = { ...update, busy: true, action: 'stop', running: false };
        if (update.phase && update.phase !== this.state.phase) {
            this.dependencies.eventSink?.('live.phase', {
                status: update.phase,
                previousStatus: this.state.phase,
                durationMs: Date.now() - this.phaseStarted,
            });
            this.phaseStarted = Date.now();
        }

        this.state = {
            ...this.state,
            ...update,
            ...(update.busy && !this.state.busy
                ? { operationLogStart: this.state.logSequence }
                : {}),
        };

        for (const listener of this.listeners) listener();
    }

    private log(text: string) {
        for (const raw of text.split(/\r?\n/)) {
            if (!raw) continue;

            const line =
                `${this.dependencies.clock.now().toISOString()} ${safeLog(raw)}`.slice(
                    0,
                    2000,
                );
            this.update({
                logs: [...this.state.logs.slice(-4999), line],
                logSequence: this.state.logSequence + 1,
            });
        }
    }

    private report(error: unknown) {
        const sshSetup =
            error instanceof SshSetupRequired ? error.status : undefined;
        const failure = error instanceof LiveFailure ? error : undefined;
        this.authentication = authenticationFailure(failure);
        const phase =
            failure && failure.kind !== 'failed' ? 'Blocked' : 'Failed';
        const blocked: BlockedReason | undefined =
            phase !== 'Blocked'
                ? undefined
                : blockedFailureReason(failure, sshSetup);
        const message = safeLog(
            error instanceof Error ? error.message : String(error),
        );

        this.update({ phase, blocked, message, sshSetup });
        this.log(`${phase}: ${message}`);
    }

    private async ensureSshSetup(
        requirements: readonly SshSecretRequirement[] | undefined,
        signal: AbortSignal,
    ) {
        if (!requirements?.length) return;

        if (!this.dependencies.ssh)
            throw new LiveFailure(
                'The environment requires Container SSH secret setup, but the setup service is unavailable.',
                'blocked',
            );

        const status = await this.dependencies.ssh.inspect(
            requirements,
            signal,
        );
        if (!status.ready) throw new SshSetupRequired(status);
    }

    private run_(work: () => Promise<void>) {
        const serial = async () => {
            if (this.polling && this.dependencies.runtime.monitor) {
                this.update({ busy: true });
                this.pollAbort?.abort();
                await this.pollOperation;
            }

            return work();
        };

        this.operation = this.dependencies.operation?.(serial) ?? serial();
        return this.operation;
    }

    /**
     * Starts the environment. Checks run first without changing containers; if
     * the plan would stop running services that are not in the configuration,
     * it waits for confirmStart().
     */
    async start(): Promise<void> {
        if (this.state.busy || this.closed) return;
        if (this.state.running) {
            this.update({ stoppedByUser: [] });
            return this.apply();
        }

        this.dependencies.eventSink?.('live.preview', { status: 'start' });
        this.update({
            busy: true,
            action: 'start',
            phase: 'Checking',
            plan: undefined,
            blocked: undefined,
            message: '',
            sshSetup: undefined,
        });
        this.abort = new AbortController();
        const signal = this.abort.signal;
        let plan: LivePreview | undefined;

        const work = async () => {
            try {
                const { revision, resolved, observed } =
                    await this.resolveRevision(signal, true);
                this.assertIdentity(resolved, revision, observed);
                if (signal.aborted) return;

                plan = previewChanges(revision, observed);
                this.update({ observed, phase: 'Stopped' });
                this.dependencies.eventSink?.('live.preview', {
                    status: 'success',
                });
            } catch (error) {
                plan = undefined;
                this.dependencies.eventSink?.('live.preview', {
                    status: signal.aborted ? 'cancelled' : 'failed',
                });
                if (!signal.aborted) this.report(error);
                else
                    this.update({
                        phase: 'Stopped',
                        message: 'Start cancelled.',
                    });
            } finally {
                await this.cleanup();
                this.update({ busy: false });
            }
        };

        await this.run_(work);
        if (!plan || this.closed) return;

        if (plan.stop.length) {
            this.update({
                plan,
                message: `Starting will stop ${plan.stop.length} running service${plan.stop.length === 1 ? '' : 's'} that ${plan.stop.length === 1 ? 'is' : 'are'} not in your configuration.`,
            });
            return;
        }

        this.approvedStops = [];
        this.begin();
    }

    confirmStart() {
        if (!this.state.plan || this.state.busy || this.closed) return;

        this.approvedStops = this.state.plan.stop;
        this.begin();
    }

    async previewStart(signal?: AbortSignal) {
        const revision = await this.dependencies.configuration.read();
        const observed = await this.dependencies.runtime.snapshot(signal);
        return {
            plan: previewChanges(revision, observed),
            revision: revision.identity,
        };
    }

    dismissPlan() {
        if (!this.state.plan) return;

        this.update({ plan: undefined, message: '' });
    }

    private begin() {
        this.dependencies.eventSink?.('live.confirm');
        this.paused = false;
        this.update({
            running: true,
            plan: undefined,
            action: 'start',
            stoppedByUser: [],
        });
        this.request();
    }

    /** Applies the saved configuration now (also used for Try again and fixes). */
    apply(): Promise<void> {
        if (this.closed || this.state.busy)
            return this.operation ?? Promise.resolve();
        if (!this.state.running) return this.start();

        this.dependencies.eventSink?.('live.retry');
        this.paused = false;
        this.update({ action: 'apply' });
        this.request();
        return this.operation ?? Promise.resolve();
    }

    retry() {
        void this.apply();
    }

    /** Saved changes remain pending until an explicit Apply or Start. */
    saved() {
        if (this.closed) return;
        this.configurationEpoch++;
        void this.poll();
    }

    /** Stop owns persistence, cancellation, draining and verified cleanup together. */
    stop(persistStoppedIntent?: () => Promise<void>): Promise<void> {
        if (this.closed) return Promise.resolve();
        if (this.stopping) return this.stopping;
        const active = this.state.busy ? this.operation : undefined;
        const previousAbort = this.abort;
        this.abort = new AbortController();
        const signal = this.abort.signal;
        const stopping = Promise.resolve()
            .then(() =>
                this.persistAndStop(active, persistStoppedIntent, signal),
            )
            .finally(() => {
                this.stopping = undefined;
                this.update({ busy: false });
            });
        this.stopping = stopping;
        this.operation = stopping;
        this.dependencies.eventSink?.('live.disable');
        this.paused = false;
        this.update({
            running: false,
            busy: true,
            action: 'stop',
            plan: undefined,
        });
        previousAbort?.abort();
        return stopping;
    }

    private async persistAndStop(
        active: Promise<void> | undefined,
        persistStoppedIntent: (() => Promise<void>) | undefined,
        signal: AbortSignal,
    ) {
        try {
            await persistStoppedIntent?.();
        } catch {
            await active;
            this.paused = true;
            await this.refresh();
            this.update({
                busy: false,
                phase: 'Blocked',
                blocked: 'other',
                message:
                    'Stop incomplete: cannot persist stopped intent. Containers may still be running. Fix daemon storage and restart the daemon before retrying.',
            });
            this.log(this.state.message);
            return;
        }
        await active;
        await this.run_(() => this.stopContainers(signal));
    }

    private async stopContainers(signal: AbortSignal) {
        this.update({
            busy: true,
            action: 'stop',
            phase: 'Stopping',
            blocked: undefined,
            sshSetup: undefined,
            message: 'Stopping and removing containers…',
        });
        this.log(
            'Stopping environment: inspecting and removing containers; data volumes will be kept.',
        );
        let stopped = false;
        try {
            await this.lock();
            signal.throwIfAborted();
            this.accept(
                await this.dependencies.runtime.stopProject({
                    signal,
                    onOutput: (entry) => this.log(entry.text),
                }),
            );
            this.applied = undefined;
            this.baseline = undefined;
            this.authentication = undefined;
            stopped = true;
        } catch (error) {
            if (signal.aborted)
                this.update({
                    phase: 'Blocked',
                    blocked: 'cancelled',
                    message:
                        'Stop cancelled. Some containers may still be running.',
                });
            else this.report(error);
        } finally {
            await this.finishStop(stopped);
        }
    }

    private async finishStop(stopped: boolean) {
        const refreshed = await this.refresh();
        const remaining = this.state.observed?.containers.length;
        if (stopped && refreshed && remaining === 0) {
            this.update({
                phase: 'Stopped',
                stoppedByUser: [],
                message:
                    'Environment stopped and containers removed. Data volumes were kept.',
            });
            this.log('Stopped: containers removed, volumes kept.');
        } else if (!refreshed || remaining) {
            const detail = refreshed
                ? `Owned containers remaining: ${remaining}.`
                : 'Cannot verify the actual containers.';
            this.update({
                phase:
                    this.state.phase === 'Stopping'
                        ? 'Failed'
                        : this.state.phase,
                message:
                    `Stop incomplete: ${detail} ${stopped ? '' : this.state.message}`.trim(),
            });
            this.log(this.state.message);
        }
        this.update({ busy: false });
        await this.unlock();
    }

    /** Serializes exact-container actions with environment operations and tracks manual stops. */
    async manageContainer(
        manager: ContainerManager,
        container: ContainerSummary,
        action: ContainerAction,
    ): Promise<ServiceResult> {
        if (this.state.busy || this.closed)
            return {
                ok: false,
                message:
                    'The environment is busy. Wait for the current operation to finish.',
            };

        let result: ServiceResult = {
            ok: false,
            message: 'The action did not complete.',
        };

        await this.run_(async () => {
            this.update({
                busy: true,
                activity: `${{ start: 'Starting', stop: 'Stopping', restart: 'Restarting' }[action]} ${container.name}…`,
            });
            this.abort = new AbortController();
            try {
                await this.lock();
                const operation = await manager.action(action, container, {
                    signal: this.abort.signal,
                    onOutput: (entry) => this.log(entry.text),
                });
                this.accept({
                    ...operation,
                    affectedServices: container.service
                        ? [container.service]
                        : [],
                });
                if (container.currentProject && container.service) {
                    this.updateManualStops(
                        [container.ownerService ?? container.service],
                        action,
                    );
                }
                result = { ok: true, message: operation.message };
            } catch (error) {
                const message = safeLog(
                    error instanceof Error ? error.message : String(error),
                );
                this.log(`Container ${action} failed: ${message}`);
                result = { ok: false, message };
            } finally {
                await this.refresh();
                this.update({ busy: false, activity: undefined });
                await this.unlock();
            }
        });

        return result;
    }

    private updateManualStops(
        services: readonly string[],
        action: ContainerAction,
        manual = true,
    ) {
        if (!manual) return;
        const stopped = new Set(this.state.stoppedByUser);
        for (const service of services) {
            if (action === 'stop') stopped.add(service);
            else stopped.delete(service);
        }

        this.update({ stoppedByUser: [...stopped].sort() });
    }

    /** Restarts, stops or starts existing containers and records explicit intent. */
    serviceAction(
        services: readonly string[],
        action: ContainerAction,
    ): Promise<ServiceResult> {
        return action === 'stop'
            ? this.stopServices(services, true)
            : this.activateServices(services, action);
    }

    private async activateServices(
        services: readonly string[],
        action: 'start' | 'restart',
    ): Promise<ServiceResult> {
        if (this.state.busy || this.closed || !services.length)
            return { ok: false, message: 'The environment is busy or closed.' };
        if (!this.state.running)
            return {
                ok: false,
                message:
                    'Start the environment before starting individual services.',
            };
        this.update({
            busy: true,
            activity: `${action === 'start' ? 'Starting' : 'Restarting'} services…`,
        });
        this.abort = new AbortController();
        const signal = this.abort.signal;
        const context = {
            signal,
            onOutput: (entry: { text: string }) => this.log(entry.text),
        };
        let result: ServiceResult = {
            ok: false,
            message: 'The service action did not complete.',
        };
        await this.run_(async () => {
            try {
                await this.lock();
                signal.throwIfAborted();
                const observed =
                    await this.dependencies.runtime.snapshot(signal);
                const roots = logicalRoots(services, observed);
                const owners = new Map(
                    roots.map((root) => [
                        root,
                        appliedOwners([root], observed),
                    ]),
                );
                for (const root of roots) {
                    signal.throwIfAborted();
                    this.accept(
                        await this.dependencies.runtime.startApplied(
                            root,
                            context,
                            action,
                        ),
                    );
                    this.updateManualStops(owners.get(root)!, action);
                }

                result = {
                    ok: true,
                    message: `${action === 'start' ? 'Started' : 'Restarted'} ${roots.join(', ')}.`,
                };
            } catch (error) {
                result = {
                    ok: false,
                    message: safeLog(
                        error instanceof Error ? error.message : String(error),
                    ),
                };
                this.log(
                    `${action} did not complete; some services may already have changed. ${result.message}`,
                );
            } finally {
                await this.refresh();
                this.update({ busy: false, activity: undefined });
                await this.unlock();
            }
        });
        return result;
    }

    /** Idle unload never creates a manual hold or breaks a running dependent. */
    idleUnload(service: string): Promise<ServiceResult> {
        if (!this.state.running || this.paused)
            return Promise.resolve({
                ok: false,
                message: 'The environment is stopped or paused.',
            });
        return this.stopServices([service], false);
    }

    private async stopTargets(
        services: readonly string[],
        manual: boolean,
        signal: AbortSignal,
    ) {
        const observed = await this.dependencies.runtime.snapshot(signal);
        const roots = manual ? logicalRoots(services, observed) : services;
        const targets = observed.containers.filter(
            (container) =>
                (roots.includes(container.ownerService ?? container.service) ||
                    roots.includes(container.service)) &&
                isActive(container),
        );
        if (!manual && targets.length) assertIdleTarget(services[0]!, observed);
        return { targets, roots };
    }

    private async stopServices(
        services: readonly string[],
        manual: boolean,
    ): Promise<ServiceResult> {
        if (this.state.busy || this.closed || !services.length)
            return { ok: false, message: 'The environment is busy.' };
        let outcome = { ok: false, message: '' };
        const work = async () => {
            this.update({
                busy: true,
                activity: `Stopping ${services.join(', ')}…`,
            });
            this.abort = new AbortController();
            const signal = this.abort.signal;
            try {
                await this.lock();
                const { targets, roots } = await this.stopTargets(
                    services,
                    manual,
                    signal,
                );
                if (!targets.length) {
                    this.updateManualStops(roots, 'stop', manual);
                    outcome = {
                        ok: true,
                        message: `Kept ${roots.join(', ')} stopped.`,
                    };
                    return;
                }
                this.log(`Stop: ${roots.join(', ')}`);
                this.accept(
                    await this.dependencies.runtime.containerAction(
                        'stop',
                        targets,
                        { signal, onOutput: (entry) => this.log(entry.text) },
                    ),
                );
                this.updateManualStops(roots, 'stop', manual);
                outcome = { ok: true, message: `Stopped ${roots.join(', ')}.` };
            } catch (error) {
                const message = safeLog(
                    error instanceof Error ? error.message : String(error),
                );
                this.log(`Stop failed: ${message}`);
                outcome = { ok: false, message };
            } finally {
                await this.refresh();
                this.update({ busy: false, activity: undefined });
                await this.unlock();
            }
        };
        await this.run_(work);
        return outcome;
    }

    private requireUnheld(service: string, observed: RuntimeSnapshot) {
        const stopped = appliedChain(service, observed).find((container) =>
            this.state.stoppedByUser.includes(
                container.ownerService ?? container.service,
            ),
        );
        if (stopped)
            throw new LifecycleBlocked(
                `${stopped.ownerService ?? stopped.service} was manually stopped. Start it explicitly before requesting ${service}.`,
            );
    }

    private assertAutomaticStart(deadline: number) {
        if (this.closed || !this.state.running)
            throw new LifecycleBlocked(
                'The environment is stopped. Start the environment explicitly.',
            );
        if (this.paused)
            throw new LifecycleBlocked(
                'The environment is paused. Inspect it and Apply explicitly.',
            );
        if (Date.now() >= deadline)
            throw new LifecycleBlocked(
                'The environment is busy. The cold-start deadline expired.',
            );
    }

    private async waitForAutomaticTurn(deadline: number) {
        let timer: ReturnType<typeof setTimeout>;
        const expired = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        });
        try {
            await Promise.race([this.waitUntilIdle(), expired]);
        } finally {
            clearTimeout(timer!);
        }
    }

    /** Traffic starts use applied state and never release manual stops. */
    async coldStart(service: string, deadline: number): Promise<ServiceResult> {
        try {
            this.assertAutomaticStart(deadline);
            while (this.state.busy) {
                await this.waitForAutomaticTurn(deadline);
                this.assertAutomaticStart(deadline);
            }
        } catch (error) {
            return {
                ok: false,
                message:
                    error instanceof LifecycleBlocked
                        ? error.message
                        : 'Automatic start failed. View environment logs.',
            };
        }
        this.update({ busy: true, activity: `Cold start: ${service}…` });
        this.abort = new AbortController();
        const signal = this.abort.signal;
        let result: ServiceResult = {
            ok: false,
            message: 'Automatic start failed. View environment logs.',
        };
        await this.run_(async () => {
            try {
                await this.lock();
                signal.throwIfAborted();
                this.assertAutomaticStart(deadline);
                const observed =
                    await this.dependencies.runtime.snapshot(signal);
                this.requireUnheld(service, observed);
                this.accept(
                    await this.dependencies.runtime.startApplied(service, {
                        signal,
                        onOutput: (entry) => this.log(entry.text),
                    }),
                );
                result = {
                    ok: true,
                    message: `Started ${service} from applied configuration.`,
                };
            } catch (error) {
                if (error instanceof LifecycleBlocked)
                    result = { ok: false, message: error.message };
                this.log(
                    `Cold start of ${service} failed: ${safeLog(error instanceof Error ? error.message : String(error))}`,
                );
            } finally {
                await this.refresh();
                this.update({ busy: false, activity: undefined });
                await this.unlock();
            }
        });
        return result;
    }

    /** Reload uses immutable applied artifacts and never activates pending edits. */
    async reloadService(service: string): Promise<ServiceResult> {
        if (this.closed || this.state.busy)
            return { ok: false, message: 'The environment is busy or closed.' };
        if (!this.state.running)
            return {
                ok: false,
                message: 'Start the environment before reloading.',
            };
        if (
            !this.state.observed?.containers.some(
                (container) =>
                    (container.ownerService ?? container.service) === service &&
                    container.mode === 'Development',
            )
        )
            return {
                ok: false,
                message: `${service} is not running in Development mode.`,
            };
        this.update({ busy: true, activity: `Reload: ${service}…` });
        this.abort = new AbortController();
        const signal = this.abort.signal;
        let result: ServiceResult = { ok: false, message: 'Reload cancelled.' };
        this.dependencies.eventSink?.('live.reload', { status: 'start' });
        await this.run_(async () => {
            try {
                await this.lock();
                signal.throwIfAborted();
                const revision = await this.dependencies.configuration.read();
                if (revision.identity !== (this.applied ?? this.baseline))
                    throw new LifecycleBlocked(
                        'Apply saved changes before reloading a service.',
                    );
                if (this.state.stoppedByUser.length)
                    this.requireUnheld(
                        service,
                        await this.dependencies.runtime.snapshot(signal),
                    );
                this.accept(
                    await this.dependencies.runtime.reloadApplied(service, {
                        signal,
                        onOutput: (entry) => this.log(entry.text),
                    }),
                );
                result = { ok: true, message: `Rebuilt ${service}.` };
            } catch (error) {
                result = {
                    ok: false,
                    message: `Reload failed: ${safeLog(error instanceof Error ? error.message : String(error))}`,
                };
            } finally {
                this.log(result.message);
                await this.refresh();
                this.update({
                    busy: false,
                    activity: undefined,
                    message: result.message,
                });
                this.dependencies.eventSink?.('live.reload', {
                    status: result.ok ? 'success' : 'failed',
                    count: 1,
                });
                await this.unlock();
            }
        });
        return result;
    }

    async serviceLogs(
        service: string,
        tail = 200,
        signal?: AbortSignal,
    ): Promise<string[]> {
        const observed = await this.dependencies.runtime.snapshot(signal);
        const container =
            observed.containers.find(
                (entry) => entry.service === service && isActive(entry),
            ) ?? observed.containers.find((entry) => entry.service === service);
        if (!container) throw new Error(`${service} has no container yet.`);

        return (
            await this.dependencies.runtime.logs(container, { tail }, signal)
        ).map((line) => safeLog(line));
    }

    async setupSsh(input: {
        keyPath: string;
        passphrase: string;
        replace: boolean;
    }): Promise<boolean> {
        const requirements = this.state.sshSetup?.requirements;
        if (
            !requirements?.length ||
            this.state.busy ||
            this.closed ||
            !this.dependencies.ssh
        )
            return false;

        return this.performSshSetup(requirements, input);
    }

    private async performSshSetup(
        requirements: NonNullable<LiveState['sshSetup']>['requirements'],
        input: { keyPath: string; passphrase: string; replace: boolean },
    ) {
        this.dependencies.eventSink?.('live.ssh-setup', { status: 'start' });

        try {
            await this.dependencies.ssh!.setup(requirements, input);
            this.dependencies.eventSink?.('live.ssh-setup', {
                status: 'success',
            });
            await this.continueAfterSshSetup();
            return true;
        } catch (error) {
            const message = safeLog(
                error instanceof Error ? error.message : String(error),
            );
            this.dependencies.eventSink?.('live.ssh-setup', {
                status: 'failed',
            });
            this.update({ message });
            this.log(`SSH setup failed: ${message}`);
            return false;
        }
    }

    private async continueAfterSshSetup() {
        if (this.closed || this.paused) return;

        this.update({
            sshSetup: undefined,
            blocked: undefined,
            message: 'SSH container secrets created. Continuing.',
        });
        if (this.state.running) this.retry();
        else await this.start();
    }

    async loginSucceeded(kind: 'aws' | 'registry') {
        if (
            !this.state.running ||
            this.paused ||
            !this.authentication ||
            this.closed
        )
            return;
        if (this.authentication === 'ecr' && kind !== 'registry') return;

        // Recovery performs fresh verification with its owned signal.
        this.authentication = undefined;
        this.dependencies.eventSink?.('live.recovery', { status: 'start' });
        this.request();
    }

    cancel() {
        this.dependencies.eventSink?.('live.cancel');
        this.paused = true;

        if (this.state.busy) {
            this.update({
                phase: 'Cancelling',
                message: 'Waiting for running commands to stop.',
            });
            this.abort?.abort();
        }
    }

    private request() {
        if (
            !this.state.running ||
            this.paused ||
            this.closed ||
            this.state.busy
        )
            return;
        this.dependencies.eventSink?.('live.queue');
        void this.run_(() => this.run());
    }

    private async lock() {
        if (this.release) return;

        this.dependencies.eventSink?.('live.lock', { status: 'start' });
        try {
            this.release = await this.dependencies.lock.acquire();
        } catch (error) {
            this.dependencies.eventSink?.('live.lock', { status: 'failed' });
            throw error;
        }
        this.dependencies.eventSink?.('live.lock', { status: 'acquired' });
    }

    private async unlock() {
        const release = this.release;
        this.release = undefined;
        if (release) {
            this.releasing = release()
                .then(() => {
                    this.dependencies.eventSink?.('live.lock', {
                        status: 'released',
                    });
                })
                .catch((error: unknown) => {
                    this.dependencies.eventSink?.('live.lock', {
                        status: 'failed',
                    });
                    this.report(error);
                });
        }
        await this.releasing;
    }

    private async cleanup() {
        try {
            await this.dependencies.preparation.cleanup?.();
            this.dependencies.eventSink?.('live.cleanup', {
                status: 'success',
            });
        } catch (error) {
            this.dependencies.eventSink?.('live.cleanup', { status: 'failed' });
            this.log(
                `Preparation cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async refresh() {
        try {
            // Cancellation must refresh using a new signal, after termination.
            if (!this.closed) {
                const observed = await this.dependencies.runtime.snapshot();
                this.update({ observed });
                return true;
            }
        } catch (error) {
            this.log(
                `Cannot refresh container state: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return false;
    }

    private accept(result: RuntimeOperationResult) {
        if (result.outcome === 'cancelled') throw new Error(result.message);
        if (result.outcome === 'failed')
            throw new LiveFailure(result.message, result.failureKind);
    }

    private async run() {
        const started = Date.now();
        this.update({
            busy: true,
            phase: 'Checking',
            blocked: undefined,
            message: '',
            sshSetup: undefined,
        });
        this.abort = new AbortController();
        const signal = this.abort.signal;

        try {
            await this.applyConfiguration(signal, started);
        } catch (error) {
            this.reportRunFailure(signal, error, started);
        } finally {
            await this.settleRun();
        }
    }

    /** Resolves the current configuration and applies it to the runtime. */
    private async applyConfiguration(signal: AbortSignal, started: number) {
        const plan = await this.resolveRevision(signal);
        const { revision, observed } = plan;
        this.update({ observed });
        this.assertIdentity(plan.resolved, revision, observed);
        const changes = previewChanges(revision, observed);
        if (
            this.state.action === 'start' &&
            changes.stop.some((name) => !this.approvedStops.includes(name))
        )
            throw new PlanChangeRequired(changes);

        this.logPlan(revision, changes);
        const context = {
            signal,
            onOutput: (entry: { text: string }) => this.log(entry.text),
        };
        let partial: PreparedProject | undefined;
        if (this.needsApply(revision, observed, changes))
            partial = await this.applyChanges(plan, signal, context);

        signal.throwIfAborted();
        this.update({ phase: 'Applying' });
        this.accept(
            await this.dependencies.runtime.stop(
                observed.containers.filter(
                    (container) => !retainsContainer(revision, container),
                ),
                context,
            ),
        );

        this.applied = revision.identity;
        this.authentication = undefined;
        this.reportApplied(partial);
        this.dependencies.eventSink?.('live.recovery', {
            status: 'success',
            durationMs: Date.now() - started,
        });
    }

    /** Locks, checks preparation and availability, then reads and resolves the configuration. */
    private async resolveRevision(
        signal: AbortSignal,
        checkSsh = false,
    ): Promise<RevisionPlan> {
        await this.lock();
        signal.throwIfAborted();
        await this.dependencies.preparation.check(signal);
        this.identified = true;

        const available =
            await this.dependencies.runtime.checkAvailability(signal);
        if (!available.available)
            throw new LiveFailure(available.message, 'blocked', 'unavailable');

        const read = await this.dependencies.configuration.read();
        const revision: ConfigurationRevision = Object.freeze({
            ...read,
            inventory: Object.freeze(
                read.inventory.map((entry) => Object.freeze({ ...entry })),
            ),
        });
        this.dependencies.eventSink?.('live.revision', {
            revision: revision.identity,
        });

        const resolved = await this.dependencies.preparation.resolve(revision, {
            signal,
        });
        if (
            inventoryKey(resolved.inventory) !==
                inventoryKey(revision.inventory) ||
            resolved.configurationIdentity !== revision.identity
        )
            throw LiveController.driftFailure();
        if (checkSsh)
            await this.ensureSshSetup(resolved.sshRequirements, signal);

        return {
            revision,
            resolved,
            observed: await this.dependencies.runtime.snapshot(signal),
        };
    }

    private static driftFailure() {
        return new LiveFailure(
            'The project or its service list changed. Restart chs-dev to reload it.',
            'blocked',
            'mismatch',
        );
    }

    private assertIdentity(
        resolved: RevisionPlan['resolved'],
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ) {
        if (!LiveController.identityDrift(resolved, revision, observed)) return;

        this.dependencies.eventSink?.('live.drift', { status: 'Blocked' });
        throw LiveController.driftFailure();
    }

    private static identityDrift(
        applied: {
            configurationIdentity: string;
            inventory: readonly InventoryEntry[];
            projectName: string;
            projectDirectory: string;
        },
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ) {
        return (
            inventoryKey(applied.inventory) !==
                inventoryKey(revision.inventory) ||
            applied.configurationIdentity !== revision.identity ||
            applied.projectName !== observed.projectName ||
            applied.projectDirectory !== observed.projectDirectory
        );
    }

    /** Final message and log for an apply, noting durable-start exclusions. */
    private reportApplied(partial: PreparedProject | undefined) {
        this.logExclusions(partial);
        const excluded = excludedServices(partial);
        this.update({
            phase: 'Running',
            changes: undefined,
            exclusions: partial?.exclusions,
            message: appliedMessage(excluded),
        });
        this.log(appliedCompletion(excluded));
    }

    /** Durable start: every exclusion with cause and remediation, in the log. */
    private logExclusions(partial: PreparedProject | undefined) {
        for (const exclusion of partial?.exclusions ?? []) {
            this.log(
                `Excluded ${exclusion.services.join(', ')}: ${exclusion.cause}. ${exclusion.remediation}`,
            );
        }
        for (const variable of partial?.unattributable ?? []) {
            this.log(
                `${variable} is required but could not be attributed to a service; set it in this checkout's .env file.`,
            );
        }
    }

    /** Like identityDrift, tolerating the services durable start excluded. */
    private static preparationDrift(
        prepared: PreparedProject,
        resolved: { sshRequirements?: SshSecretRequirement[] },
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ) {
        const excluded = new Set(
            (prepared.exclusions ?? []).flatMap(
                (exclusion) => exclusion.services,
            ),
        );
        if (!excluded.size) {
            return (
                LiveController.identityDrift(prepared, revision, observed) ||
                JSON.stringify(prepared.sshRequirements ?? []) !==
                    JSON.stringify(resolved.sshRequirements ?? [])
            );
        }
        return LiveController.excludedDrift(
            prepared,
            excluded,
            revision,
            resolved,
            observed,
        );
    }

    /** Drift comparison when durable start excluded services. */
    private static excludedDrift(
        prepared: PreparedProject,
        excluded: ReadonlySet<string>,
        revision: ConfigurationRevision,
        resolved: { sshRequirements?: SshSecretRequirement[] },
        observed: RuntimeSnapshot,
    ) {
        const expectedInventory = revision.inventory.filter(
            (entry) => !excluded.has(entry.service),
        );
        return (
            inventoryKey(prepared.inventory) !==
                inventoryKey(expectedInventory) ||
            prepared.configurationIdentity !== revision.identity ||
            prepared.projectName !== observed.projectName ||
            prepared.projectDirectory !== observed.projectDirectory ||
            JSON.stringify(prepared.sshRequirements ?? []) !==
                JSON.stringify(
                    filterSshRequirements(
                        resolved.sshRequirements ?? [],
                        excluded,
                    ),
                )
        );
    }

    private logPlan(revision: ConfigurationRevision, changes: LivePreview) {
        this.log(`Revision ${revision.identity}`);
        for (const action of ['start', 'stop', 'recreate'] as const) {
            for (const service of changes[action]) {
                this.log(
                    `${action === 'recreate' ? 'Update (may restart)' : action === 'start' ? 'Start' : 'Stop'}: ${service}`,
                );
            }
        }
    }

    private needsApply(
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
        changes: LivePreview,
    ) {
        if (this.state.action === 'apply') return revision.inventory.length > 0;
        const stopOnly = isStopOnly(revision, observed);
        const modeDrift = modeChanges(revision, observed).length > 0;
        const unchanged =
            this.applied === revision.identity &&
            changes.start.length === 0 &&
            changes.stop.length === 0 &&
            !modeDrift;

        return (
            revision.inventory.length > 0 &&
            !unchanged &&
            (!stopOnly ||
                (this.applied !== revision.identity &&
                    changes.stop.length === 0))
        );
    }

    private async verifyApplyAuthentication(
        revision: ConfigurationRevision,
        signal: AbortSignal,
    ) {
        if (mockOnlyInventory(revision.inventory)) return;
        if (this.authentication === 'ecr') {
            throw new LiveFailure(
                'Pulling images needs AWS + registry login (Ctrl+L) before continuing.',
                'ecr',
            );
        }

        const aws = await this.dependencies.verifyAws(signal);
        if (aws.state !== 'active') {
            throw new LiveFailure(
                `AWS ${aws.state}. Log in (Ctrl+L) to continue; your changes are kept.`,
                'aws',
            );
        }
        this.authentication = undefined;
    }

    private async applyChanges(
        plan: RevisionPlan,
        signal: AbortSignal,
        context: {
            signal: AbortSignal;
            onOutput: (entry: { text: string }) => void;
        },
    ): Promise<PreparedProject | undefined> {
        const { revision, resolved, observed } = plan;
        await this.ensureSshSetup(resolved.sshRequirements, signal);
        await this.verifyApplyAuthentication(revision, signal);

        this.update({ phase: 'Preparing' });
        const prepared = await this.dependencies.preparation.prepare(
            revision,
            context,
        );
        if (
            LiveController.preparationDrift(
                prepared,
                resolved,
                revision,
                observed,
            )
        ) {
            throw LiveController.driftFailure();
        }

        signal.throwIfAborted();
        await this.verifyFreshAws(revision, signal);

        this.update({ phase: 'Applying' });
        this.accept(
            await this.dependencies.runtime.apply(prepared, {
                ...context,
                stoppedServices: this.state.stoppedByUser,
            }),
        );

        return prepared;
    }

    private async verifyFreshAws(
        revision: ConfigurationRevision,
        signal: AbortSignal,
    ) {
        if (mockOnlyInventory(revision.inventory)) return;
        const freshAws = await this.dependencies.verifyAws(signal);
        if (freshAws.state !== 'active')
            throw new LiveFailure(
                `AWS ${freshAws.state}. Log in (Ctrl+L) to continue.`,
                'aws',
            );
    }

    private reportRunFailure(
        signal: AbortSignal,
        error: unknown,
        started: number,
    ) {
        this.dependencies.eventSink?.('live.recovery', {
            status: signal.aborted ? 'cancelled' : 'failed',
            durationMs: Date.now() - started,
        });
        if (signal.aborted) {
            this.paused = true;
            this.update({
                phase: 'Blocked',
                blocked: 'cancelled',
                message:
                    'Cancelled. Some changes may already be applied; choose Try again to finish.',
            });
            this.log('Cancelled: no rollback; refreshing actual state.');
            return;
        }

        if (error instanceof PlanChangeRequired) {
            this.update({
                running: false,
                phase: 'Stopped',
                plan: error.plan,
                message: error.message,
            });
            return;
        }

        this.report(error);
    }

    private async settleRun() {
        await this.cleanup();
        await this.refresh();
        this.update({ busy: false });
        if (this.closed) await this.unlock();
    }

    private changes(
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ): EnvironmentChanges | undefined {
        const plan = previewChanges(revision, observed);
        const stopped = new Set(this.state.stoppedByUser);
        const changes: EnvironmentChanges = {
            start: plan.start.filter((service) => !stopped.has(service)),
            stop: plan.stop,
            recreate: plan.recreate,
            modeChanged: modeChanges(revision, observed),
            edited:
                (this.applied ?? this.baseline) !== undefined &&
                revision.identity !== (this.applied ?? this.baseline),
        };

        return changes.start.length ||
            changes.stop.length ||
            changes.modeChanged.length ||
            changes.edited
            ? changes
            : undefined;
    }

    poll(): Promise<void> {
        if (this.closed || this.state.busy || this.polling)
            return Promise.resolve();

        this.polling = true;
        this.pollAbort = new AbortController();
        this.pollOperation = this.observe(this.pollAbort.signal);
        return this.pollOperation;
    }

    private async observe(signal: AbortSignal) {
        try {
            await this.observeOnce(signal);
        } catch (error) {
            const message = `Cannot refresh configuration or container state: ${safeLog(error instanceof Error ? error.message : String(error))}`;
            // Polls repeat every few seconds; report each distinct problem once.
            if (signal.aborted || message === this.pollError) return;

            this.pollError = message;
            this.log(message);
            this.update({ message });
        } finally {
            this.polling = false;
        }
    }

    private async observeOnce(signal: AbortSignal) {
        const epoch = this.configurationEpoch;
        // Container state is scoped by the project's Compose name.
        if (!this.identified) {
            await this.dependencies.preparation.check(signal);
            this.identified = true;
        }

        const revision = await this.dependencies.configuration.read();
        if (this.closed || this.state.busy) return;
        if (!(await this.startMonitor(signal))) return;

        const observed: RuntimeSnapshot =
            await this.dependencies.runtime.snapshot(signal);
        if (this.observationObsolete(epoch)) return;

        const update: Partial<LiveState> = { observed };
        this.observeIntent(update, revision, observed);
        update.changes = this.observeDifferences(update, revision, observed);
        this.pollError = undefined;
        this.update(update);
    }

    private observationObsolete(epoch: number) {
        return (
            this.closed || this.state.busy || epoch !== this.configurationEpoch
        );
    }

    /** Keeps one monitor per checkout, sharing the same mutation lock as Apply. */
    private async startMonitor(signal: AbortSignal): Promise<boolean> {
        if (
            !this.dependencies.runtime.monitor ||
            (this.dependencies.explicitStart &&
                !(this.state.running && !this.paused))
        )
            return true;

        try {
            await this.lock();
        } catch (error) {
            if (!(error instanceof LiveFailure)) throw error;
        }
        if (this.closed || this.state.busy) return false;
        if (this.release)
            await this.dependencies.runtime.monitor({
                signal,
                onOutput: (entry) => this.log(entry.text),
            });
        return true;
    }

    private observeIntent(
        update: Partial<LiveState>,
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ) {
        const { anyUp, crashed } = observedServiceHealth(revision, observed);
        // The environment's intent follows reality when nothing is in progress:
        // containers started elsewhere count as running, and a fully stopped
        // environment counts as stopped.
        if (
            !this.state.running &&
            !this.dependencies.explicitStart &&
            this.state.phase === 'Stopped' &&
            !this.state.plan &&
            anyUp
        ) {
            update.running = true;
            update.phase = 'Running';
            update.message = 'Environment is running.';
            this.baseline = revision.identity;
            return;
        }

        this.observeStopped(update, anyUp, crashed);
    }

    private observeStopped(
        update: Partial<LiveState>,
        anyUp: boolean,
        crashed: boolean,
    ) {
        if (
            !this.dependencies.explicitStart &&
            this.state.running &&
            this.state.phase === 'Running' &&
            !anyUp &&
            !crashed
        ) {
            update.running = false;
            update.phase = 'Stopped';
            update.message = 'Environment stopped outside chs-dev.';
            this.applied = undefined;
            this.baseline = undefined;
        }
    }

    private observeDifferences(
        update: Partial<LiveState>,
        revision: ConfigurationRevision,
        observed: RuntimeSnapshot,
    ) {
        const running = update.running ?? this.state.running;
        const differences = running
            ? this.changes(revision, observed)
            : undefined;
        const drifted =
            differences &&
            !differences.edited &&
            (!this.state.changes || this.state.changes.edited);
        if (drifted && this.state.phase === 'Running') {
            this.dependencies.eventSink?.('live.drift', {
                status: 'Running',
            });
            const names = [
                ...differences.start.map((name) => `${name} not running`),
                ...differences.stop.map((name) => `${name} not enabled`),
                ...differences.modeChanged.map(
                    (name) => `${name} mode differs`,
                ),
            ];
            this.log(
                `Changed outside chs-dev: ${names.join(', ')}. Apply changes to fix.`,
            );
        }

        return differences;
    }

    async shutdown() {
        this.closed = true;
        this.paused = true;

        if (this.state.busy) this.abort?.abort();
        this.pollAbort?.abort();
        await Promise.all([this.operation, this.pollOperation]);
        await this.dependencies.runtime.close?.();
        await this.unlock();
    }
}

function excludedServices(partial: PreparedProject | undefined): string[] {
    return partial?.exclusions?.length
        ? [
              ...new Set(
                  partial.exclusions.flatMap((exclusion) => exclusion.services),
              ),
          ].sort()
        : [];
}

function appliedMessage(excluded: readonly string[]): string {
    if (excluded.length) {
        return `Applied with ${excluded.length} service${excluded.length === 1 ? '' : 's'} excluded (see log).`;
    }
    return 'Configuration applied.';
}

function appliedCompletion(excluded: readonly string[]): string {
    if (excluded.length) {
        return `Completed: applied with ${excluded.length} excluded: ${excluded.join(', ')}. Fix the reported variables and apply again to start them.`;
    }
    return 'Completed: configuration applied.';
}
