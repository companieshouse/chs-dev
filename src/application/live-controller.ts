import { isActiveContainer } from '../domain/containers.js';
import {
    mockOnlyInventory,
    inventoryKey,
    filterSshRequirements,
    isStopOnly,
    LiveFailure,
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

function settle(
    pending: Map<string, ((result: ServiceResult) => void)[]>,
    result: ServiceResult,
) {
    for (const callbacks of pending.values())
        for (const callback of callbacks) callback(result);
}

/** Exit codes from a normal stop: success, SIGINT, SIGKILL and SIGTERM. */
const stopExitCodes = [0, 130, 137, 143];
const isActive = (container: RuntimeContainer) =>
    isActiveContainer(container.lifecycle);

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
            container.exitCode !== undefined &&
            !stopExitCodes.includes(container.exitCode),
    );

    return { anyUp, crashed };
}

export class LiveController {
    private state: LiveState;
    private listeners = new Set<() => void>();
    private abort?: AbortController;
    private operation?: Promise<void>;
    private release?: () => Promise<void>;
    private releasing?: Promise<void>;
    private queued = false;
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
    /** Development services waiting to be rebuilt by the next apply. */
    private reloads = new Map<string, ((result: ServiceResult) => void)[]>();

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
        if (this.closed) return Promise.resolve();
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

    /** Stops and removes this checkout's containers, while keeping data volumes. */
    async stop(): Promise<void> {
        if (this.closed) return;

        this.dependencies.eventSink?.('live.disable');
        this.queued = false;
        this.paused = false;
        this.dropReloads('Reload cancelled: the environment was stopped.');
        this.update({ running: false, plan: undefined });

        if (this.state.busy) {
            this.abort?.abort();
            await this.operation;
        }

        const work = async () => {
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
            this.abort = new AbortController();
            const signal = this.abort.signal;

            try {
                await this.lock();
                this.accept(
                    await this.dependencies.runtime.stopProject({
                        signal,
                        onOutput: (entry) => this.log(entry.text),
                    }),
                );
                this.applied = undefined;
                this.baseline = undefined;
                this.authentication = undefined;
                this.update({
                    phase: 'Stopped',
                    stoppedByUser: [],
                    message:
                        'Environment stopped and containers removed. Data volumes were kept.',
                });
                this.log('Stopped: containers removed, volumes kept.');
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
                await this.refresh();
                this.update({ busy: false });
                await this.unlock();
            }
        };

        await this.run_(work);
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
                    this.updateManualStops([container.service], action);
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
    ) {
        const stopped = new Set(this.state.stoppedByUser);
        for (const service of services) {
            if (action === 'stop') stopped.add(service);
            else stopped.delete(service);
        }

        this.update({ stoppedByUser: [...stopped].sort() });
    }

    /** Restarts, stops or starts existing containers for the given services. */
    async serviceAction(
        services: readonly string[],
        action: ContainerAction,
    ): Promise<{ ok: boolean; message: string }> {
        if (this.state.busy || this.closed || !services.length)
            return { ok: false, message: 'The environment is busy.' };

        const verb = { restart: 'Restart', stop: 'Stop', start: 'Start' }[
            action
        ];
        const names =
            services.length === 1
                ? services[0]!
                : `${services.length} services`;
        let outcome = { ok: false, message: '' };

        const work = async () => {
            this.update({
                busy: true,
                activity: `${verb === 'Stop' ? 'Stopping' : `${verb}ing`} ${names}…`,
            });
            this.abort = new AbortController();
            const signal = this.abort.signal;

            try {
                await this.lock();
                const observed =
                    await this.dependencies.runtime.snapshot(signal);
                const containers = observed.containers.filter(
                    (container) =>
                        services.includes(container.service) &&
                        (action === 'start'
                            ? !isActive(container)
                            : action === 'stop'
                              ? isActive(container)
                              : true),
                );
                if (!containers.length)
                    throw new Error(
                        action === 'start'
                            ? `${names} has no stopped container to start. Start or apply the environment instead.`
                            : `${names} has no running container.`,
                    );

                this.log(`${verb}: ${services.join(', ')}`);
                this.accept(
                    await this.dependencies.runtime.containerAction(
                        action,
                        containers,
                        {
                            signal,
                            onOutput: (entry) => this.log(entry.text),
                        },
                    ),
                );
                this.updateManualStops(services, action);
                outcome = {
                    ok: true,
                    message: `${verb === 'Stop' ? 'Stopped' : `${verb}ed`} ${names}.`,
                };
            } catch (error) {
                const message = safeLog(
                    error instanceof Error ? error.message : String(error),
                );
                this.log(`${verb} failed: ${message}`);
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

    /**
     * Rebuilds a development service from source. Runs through the normal apply
     * so AWS, SSH and preparation checks still happen, then recreates the
     * service and its builder. Resolves when that apply finishes.
     */
    reloadService(service: string): Promise<ServiceResult> {
        if (this.closed)
            return Promise.resolve({
                ok: false,
                message: 'The environment is closed.',
            });
        if (!this.state.running)
            return Promise.resolve({
                ok: false,
                message: 'Start the environment (Ctrl+E) before reloading.',
            });
        if (
            !this.state.observed?.containers.some(
                (container) =>
                    (container.ownerService ?? container.service) === service &&
                    container.mode === 'Development',
            )
        )
            return Promise.resolve({
                ok: false,
                message: `${service} is not running in Development mode.`,
            });

        return new Promise((resolve) => {
            this.reloads.set(service, [
                ...(this.reloads.get(service) ?? []),
                resolve,
            ]);
            this.dependencies.eventSink?.('live.reload', { status: 'start' });
            this.paused = false;
            this.update({ action: 'apply' });
            this.request();
        });
    }

    private dropReloads(message: string) {
        const pending = new Map(this.reloads);
        this.reloads.clear();
        settle(pending, { ok: false, message });
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

        // The queued operation performs the fresh verification with its owned signal.
        this.authentication = undefined;
        this.dependencies.eventSink?.('live.recovery', { status: 'start' });
        this.request();
    }

    cancel() {
        this.dependencies.eventSink?.('live.cancel');
        this.paused = true;
        this.queued = false;
        this.dropReloads('Reload cancelled.');

        if (this.state.busy) {
            this.update({
                phase: 'Cancelling',
                message: 'Waiting for running commands to stop.',
            });
            this.abort?.abort();
        }
    }

    private request() {
        if (!this.state.running || this.paused || this.closed) return;

        this.queued = true;
        this.dependencies.eventSink?.('live.queue');
        if (this.state.busy) return;

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
            }
        } catch (error) {
            this.log(
                `Cannot refresh container state: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private accept(result: RuntimeOperationResult) {
        if (result.outcome === 'cancelled') throw new Error(result.message);
        if (result.outcome === 'failed')
            throw new LiveFailure(result.message, result.failureKind);
    }

    private async run() {
        const started = Date.now();
        this.queued = false;
        const reloading = new Map(this.reloads);
        this.reloads.clear();
        this.update({
            busy: true,
            phase: 'Checking',
            blocked: undefined,
            message: '',
            sshSetup: undefined,
        });
        this.abort = new AbortController();
        const signal = this.abort.signal;
        const progress = { reloaded: false };

        try {
            await this.applyConfiguration(reloading, signal, started, progress);
        } catch (error) {
            this.reportRunFailure(signal, error, started);
        } finally {
            await this.settleRun(reloading, progress.reloaded);
        }
    }

    /** Resolves the current configuration and applies it to the runtime. */
    private async applyConfiguration(
        reloading: Map<string, ((result: ServiceResult) => void)[]>,
        signal: AbortSignal,
        started: number,
        progress: { reloaded: boolean },
    ) {
        const plan = await this.resolveRevision(signal);
        const { revision, observed } = plan;
        this.update({ observed });
        this.assertIdentity(plan.resolved, revision, observed);
        if (
            reloading.size &&
            revision.identity !== (this.applied ?? this.baseline)
        )
            throw new LiveFailure(
                'Apply saved changes before reloading a service.',
                'blocked',
            );

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
        if (this.needsApply(revision, observed, changes, reloading))
            partial = await this.applyChanges(
                { ...plan, changes },
                reloading,
                signal,
                context,
                progress,
            );

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
        this.reportApplied(
            partial,
            progress,
            [...reloading.keys()].sort().join(', '),
        );
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
    private reportApplied(
        partial: PreparedProject | undefined,
        progress: { reloaded: boolean },
        reloadedNames: string,
    ) {
        this.logExclusions(partial);
        const excluded = excludedServices(partial);
        this.update({
            phase: 'Running',
            changes: undefined,
            exclusions: partial?.exclusions,
            message: appliedMessage(excluded, progress.reloaded, reloadedNames),
        });
        this.log(appliedCompletion(excluded, progress.reloaded, reloadedNames));
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
        reloading: Map<string, ((result: ServiceResult) => void)[]>,
    ) {
        const stopOnly = isStopOnly(revision, observed);
        const modeDrift = modeChanges(revision, observed).length > 0;
        const unchanged =
            this.applied === revision.identity &&
            changes.start.length === 0 &&
            changes.stop.length === 0 &&
            !modeDrift;

        return (
            revision.inventory.length > 0 &&
            (this.dependencies.runtime.reconciles ||
                reloading.size > 0 ||
                (!unchanged &&
                    (!stopOnly ||
                        (this.applied !== revision.identity &&
                            changes.stop.length === 0))))
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
        plan: RevisionPlan & { changes: LivePreview },
        reloading: Map<string, ((result: ServiceResult) => void)[]>,
        signal: AbortSignal,
        context: {
            signal: AbortSignal;
            onOutput: (entry: { text: string }) => void;
        },
        progress: { reloaded: boolean },
    ): Promise<PreparedProject | undefined> {
        const { revision, resolved, observed, changes } = plan;
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
        this.dependencies.runtime.stoppedServices = this.state.stoppedByUser;
        this.dependencies.runtime.reloadTargets = [...reloading.keys()];
        this.dependencies.runtime.allowedRemovals = changes.stop;
        try {
            this.accept(
                await this.dependencies.runtime.apply(prepared, context),
            );
        } finally {
            this.dependencies.runtime.stoppedServices = undefined;
            this.dependencies.runtime.reloadTargets = undefined;
            this.dependencies.runtime.allowedRemovals = undefined;
        }

        if (reloading.size && this.dependencies.runtime.reconciles)
            progress.reloaded = true;
        if (reloading.size && !this.dependencies.runtime.reconciles) {
            signal.throwIfAborted();
            const services = [...reloading.keys()].sort();
            this.log(`Reload: ${services.join(', ')}`);
            this.accept(
                await this.dependencies.runtime.reload(
                    prepared,
                    services,
                    context,
                ),
            );
            progress.reloaded = true;
        }
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
            this.dropReloads('Reload cancelled.');
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

    private async settleRun(
        reloading: Map<string, ((result: ServiceResult) => void)[]>,
        reloaded: boolean,
    ) {
        await this.cleanup();
        await this.refresh();
        this.update({ busy: false });
        this.settleReloads(reloading, reloaded);

        if (this.closed) {
            await this.unlock();
            return;
        }
        if (this.state.running && this.queued && !this.paused) this.request();
    }

    private settleReloads(
        reloading: Map<string, ((result: ServiceResult) => void)[]>,
        reloaded: boolean,
    ) {
        if (!reloading.size) return;

        this.dependencies.eventSink?.('live.reload', {
            status: reloaded ? 'success' : 'failed',
            count: reloading.size,
        });
        settle(
            reloading,
            reloaded
                ? {
                      ok: true,
                      message: `Rebuilt ${[...reloading.keys()].sort().join(', ')}.`,
                  }
                : {
                      ok: false,
                      message: `Reload failed: ${this.state.message || 'the environment did not apply.'}`,
                  },
        );
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
            !crashed &&
            !this.queued
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
        this.queued = false;
        this.paused = true;
        this.dropReloads('Reload cancelled: chs-dev is closing.');

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

function appliedMessage(
    excluded: readonly string[],
    reloaded: boolean,
    reloadedNames: string,
): string {
    if (excluded.length) {
        return `Applied with ${excluded.length} service${excluded.length === 1 ? '' : 's'} excluded (see log).`;
    }
    return reloaded ? `Rebuilt ${reloadedNames}.` : 'Configuration applied.';
}

function appliedCompletion(
    excluded: readonly string[],
    reloaded: boolean,
    reloadedNames: string,
): string {
    if (excluded.length) {
        return `Completed: applied with ${excluded.length} excluded: ${excluded.join(', ')}. Fix the reported variables and apply again to start them.`;
    }
    return reloaded
        ? `Completed: rebuilt ${reloadedNames}.`
        : 'Completed: configuration applied.';
}
