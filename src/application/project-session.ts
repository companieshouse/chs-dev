const busyAllowedCommands = new Set([
    'environment.stop',
    'environment.cancel',
    'configuration.save',
    'settings.save',
]);
import {
    ClientError,
    emptyLive,
    protocolVersion,
    type CommandRequest,
    type QueryRequest,
    type Scope,
    type SessionSnapshot,
    type LogRequest,
} from '../protocol/types.js';
import type { ApplicationHost, BackendSession } from './ports.js';
import { Supervisor } from './supervisor.js';
import type { Interactions } from './interactions.js';
import type { UsageTracker } from './usage-tracker.js';
import type {
    SettingKey,
    SettingValues,
    SettingsSnapshot,
    ResolvedSettings,
} from '../domain/settings.js';
import type { Operations } from './operations.js';
import type { LiveController } from './live-controller.js';
import { serviceDependencies } from '../domain/service-dependencies.js';
import { lazyChain } from '../proxy/lifecycle.js';

type Dispatch = { handled: true; value?: unknown } | { handled: false };

/**
 * Expands a manual start into its dependency chain, dependencies first, so
 * starting a service also starts the (possibly lazy) services beneath it.
 */
function startChain(
    services: readonly string[],
    groups: BackendSession['groups'],
): string[] {
    const names = new Set(services);
    for (const name of services)
        for (const dependency of serviceDependencies(name, groups))
            names.add(dependency.name);
    const dependencies = new Map(
        [...names].map((name) => [
            name,
            serviceDependencies(name, groups).map(
                (dependency) => dependency.name,
            ),
        ]),
    );
    return [
        ...new Set(services.flatMap((name) => lazyChain(name, dependencies))),
    ];
}

export class ProjectSession {
    private backend?: BackendSession;
    private state: SessionSnapshot;
    private listeners = new Set<() => void>();
    private supervisor = new Supervisor();
    private unsubscribe?: () => void;
    private closed = false;
    private switching = false;
    private searchAbort?: AbortController;
    private lastIntent = '';
    private stateFailure = '';
    private settingsQueue: Promise<unknown> = Promise.resolve();
    private configurationQueue: Promise<unknown> = Promise.resolve();
    constructor(
        private readonly host: ApplicationHost,
        readonly interactions: Interactions,
    ) {
        this.state = {
            protocol: protocolVersion,
            daemonId: host.id(),
            scope: { project: '', generation: host.id() },
            changedAt: new Date().toISOString(),
            ready: false,
            project: {
                directory: '',
                valid: false,
                message: 'Loading project…',
            },
            groups: [],
            details: {},
            configurationRevision: '',
            configurationError: '',
            settings: host.settings(),
            settingsRevision: host.settingsRevision(),
            usage: { learned: [], unusedLastRun: [] },
            runtime: {
                id: '',
                name: 'Loading',
                capabilities: {
                    inspect: false,
                    apply: false,
                    registryLogin: false,
                    logs: false,
                },
                canStart: false,
            },
            statuses: {},
            runtimeState: 'loading',
            aws: { state: 'checking' },
            live: emptyLive,
            operations: [],
            search: {
                found: [],
                visited: 0,
                searching: false,
                truncated: false,
            },
            home: host.home,
        };
    }
    operations?: Operations;
    /** Usage-cache runs; set by the daemon bootstrap before initialize. */
    usage?: UsageTracker;
    snapshot = (): SessionSnapshot => ({
        ...this.state,
        operations: this.operations?.list() ?? [],
        interaction: this.interactions.snapshot(),
    });
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    changed = () => {
        for (const listener of this.listeners) listener();
    };
    private update(next: Partial<SessionSnapshot>) {
        this.state = {
            ...this.state,
            ...next,
            changedAt: new Date().toISOString(),
        };
        this.changed();
    }
    async initialize() {
        const previous = await this.host.readIntent();
        const settings = this.host.settings().startup;
        const backend = `${settings.runtime.value}/${settings.orchestrator.value}`;
        const canonical = settings.project.value
            ? (await this.host.validateProject(settings.project.value))
                  .directory
            : undefined;
        const intent = this.resumableIntent(previous, backend, canonical);
        await this.attach(await this.host.open(intent));
    }
    private resumableIntent(
        previous: Awaited<ReturnType<ApplicationHost['readIntent']>>,
        backend: string,
        canonical?: string,
    ) {
        if (
            !previous ||
            previous.hostSession !== this.host.hostSession ||
            previous.backend !== backend ||
            previous.switching ||
            previous.scope.project !== canonical ||
            !previous.intent
        )
            return undefined;
        return {
            ...previous.intent,
            paused:
                previous.interrupted ||
                this.operations?.interruptedOnStartup ||
                previous.intent.paused,
        };
    }
    private async attach(backend: BackendSession) {
        this.backend = backend;
        this.update({
            scope: {
                project: backend.project.directory,
                generation: this.host.id(),
            },
            project: backend.project,
            groups: backend.groups,
            details: {},
            configurationRevision: '',
            configurationError: '',
            runtime: {
                id: backend.runtime.id,
                name: backend.runtime.name,
                capabilities: { ...backend.runtime.capabilities },
                canStart: !!backend.runtime.startService,
            },
            statuses: {},
            runtimeState: 'loading',
            live: backend.controller?.getSnapshot() ?? emptyLive,
            settings: this.host.settings(),
            settingsRevision: this.host.settingsRevision(),
            ready: true,
        });
        this.unsubscribe = backend.controller?.subscribe(() => {
            this.update({ live: backend.controller!.getSnapshot() });
            void this.checkpoint().catch((error) =>
                this.persistenceFailed(error),
            );
        });
        await this.refreshConfiguration();
        await this.refreshUsage();
        await this.usage?.openRun(backend.project.directory);
        await this.checkpoint();
        this.supervisor = new Supervisor();
        this.supervisor.every(
            5000,
            async () => {
                if (this.switching) return;
                await backend.controller?.poll();
                await this.refreshSettings();
                await this.refreshConfiguration();
                await this.refreshUsage();
            },
            (error) =>
                this.update({
                    notice:
                        error instanceof Error ? error.message : String(error),
                }),
        );
        this.supervisor.every(5000, async (signal) => {
            if (!this.switching) await this.refreshStatus(signal);
        });
        this.supervisor.every(2000, async (signal) => {
            if (!this.switching) await backend.controller?.probe(signal);
        });
        this.supervisor.every(30000, async (signal) => {
            this.update({ aws: await this.host.aws(signal) });
        });
    }
    private persistenceFailed(error: unknown) {
        this.stateFailure =
            'Cannot save daemon state. Check permissions and free space before starting more work.';
        this.backend?.controller?.cancel();
        this.update({ notice: this.stateFailure });
    }
    private checkpoint(force = false) {
        const settings = this.host.settings().startup;
        const value = {
            version: 1 as const,
            hostSession: this.host.hostSession,
            scope: this.state.scope,
            backend: `${settings.runtime.value}/${settings.orchestrator.value}`,
            intent: this.backend?.controller?.getIntent(),
            interrupted: !!this.state.live.busy,
            switching: this.switching,
        };
        const identity = JSON.stringify(value);
        if (!force && this.lastIntent === identity) return Promise.resolve();
        this.lastIntent = identity;
        return this.host.writeIntent(value);
    }
    assertScope(scope: Scope) {
        if (this.closed)
            throw new ClientError({
                code: 'SHUTTING_DOWN',
                message: 'The daemon is stopping.',
            });
        if (
            scope.project !== this.state.scope.project ||
            scope.generation !== this.state.scope.generation
        )
            throw new ClientError({
                code: 'STALE_PROJECT',
                message:
                    'The active checkout or runtime changed. Refresh before retrying.',
            });
    }
    validate(request: CommandRequest, executing?: string) {
        this.assertScope(request.scope);
        if (this.stateFailure)
            throw new ClientError({
                code: 'STATE_WRITE_FAILED',
                message: this.stateFailure,
            });
        if (this.switching)
            throw new ClientError({
                code: 'PROJECT_SWITCHING',
                message: 'Wait for the current checkout switch to finish.',
            });
        this.assertRevisionCurrent(request);
        this.assertEnvironmentIdle(request);
        this.assertNoConflictingOperation(request, executing);
        this.assertInteractionFree(request);
    }
    private assertRevisionCurrent(request: CommandRequest) {
        if (
            [
                'configuration.save',
                'configuration.legacyEdit',
                'environment.profileImport',
            ].includes(request.command) &&
            (request.args as { revision: string }).revision !==
                this.state.configurationRevision
        )
            throw new ClientError({
                code: 'CONFIGURATION_CONFLICT',
                message:
                    'Configuration changed. Close the editor and review the latest values.',
            });
        if (
            request.command === 'settings.save' &&
            (request.args as { revision: string }).revision !==
                this.host.settingsRevision()
        )
            throw new ClientError({
                code: 'SETTINGS_CONFLICT',
                message:
                    'Settings changed. Close the editor and review the latest values.',
            });
    }
    private assertEnvironmentIdle(request: CommandRequest) {
        if (this.state.live.busy && !busyAllowedCommands.has(request.command))
            throw new ClientError({
                code: 'BUSY',
                message:
                    'The environment is busy. Wait for its current operation to finish.',
            });
    }
    private assertNoConflictingOperation(
        request: CommandRequest,
        executing?: string,
    ) {
        const coordinated = [
            'environment.start',
            'environment.apply',
            'environment.confirm',
            'service.action',
            'service.reload',
            'container.action',
            'authentication.login',
            'project.clone',
            'ssh.setup',
            'runtime.start',
            'configuration.legacyEdit',
            'environment.profileImport',
        ];
        const active = this.operations
            ?.active()
            .find((o) => o.id !== executing && coordinated.includes(o.kind));
        if (
            active &&
            request.command === 'settings.save' &&
            ['project', 'runtime', 'orchestrator'].includes(
                (request.args as { key: string }).key,
            ) &&
            [
                'ssh.setup',
                'project.clone',
                'runtime.start',
                'configuration.legacyEdit',
                'environment.profileImport',
            ].includes(active.kind)
        )
            throw new ClientError({
                code: 'BUSY',
                message:
                    'Wait for the active operation before switching checkout or runtime.',
                operationId: active.id,
            });
        if (active && !busyAllowedCommands.has(request.command))
            throw new ClientError({
                code: 'BUSY',
                message:
                    'Another operation is in progress. Wait for it to finish.',
                operationId: active.id,
            });
    }
    private assertInteractionFree(request: CommandRequest) {
        if (
            ['authentication.login', 'project.clone'].includes(
                request.command,
            ) &&
            this.interactions.snapshot()
        )
            throw new ClientError({
                code: 'INTERACTION_BUSY',
                message: 'A login or clone is already in progress.',
                operationId: this.interactions.snapshot()?.id,
            });
    }
    async execute(
        request: CommandRequest,
        signal: AbortSignal,
        id: string,
    ): Promise<unknown> {
        this.validate(request, id);
        signal.throwIfAborted();
        const backend = this.backend!,
            controller = backend.controller;
        const requireController = () => {
            if (!controller)
                throw new ClientError({
                    code: 'PROJECT_UNAVAILABLE',
                    message: this.state.project.message,
                });
            return controller;
        };
        const cancel = () => controller?.cancel();
        if (
            ![
                'settings.save',
                'configuration.save',
                'configuration.legacyEdit',
                'environment.profileImport',
                'environment.profileExport',
                'authentication.login',
                'project.clone',
            ].includes(request.command)
        )
            signal.addEventListener('abort', cancel, { once: true });
        try {
            const environment = await this.runEnvironmentCommand(
                request,
                backend,
                signal,
                requireController,
            );
            if (environment.handled) {
                this.assertEnvironmentOutcome(request, controller);
                return environment.value;
            }
            const project = await this.runProjectCommand(
                request,
                backend,
                signal,
                id,
                requireController,
            );
            if (project.handled) return project.value;
            this.assertEnvironmentOutcome(request, controller);
        } finally {
            signal.removeEventListener('abort', cancel);
            await this.checkpoint();
            this.update({
                settings: this.host.settings(),
                settingsRevision: this.host.settingsRevision(),
            });
        }
    }
    private async runEnvironmentCommand(
        request: CommandRequest,
        backend: BackendSession,
        signal: AbortSignal,
        requireController: () => LiveController,
    ): Promise<Dispatch> {
        const { command, args: a } = request;
        switch (command) {
            case 'environment.start':
            case 'environment.apply':
                return {
                    handled: true,
                    value: await this.applyEnvironment(
                        requireController(),
                        command === 'environment.start' ? 'start' : 'apply',
                        a.approveStops,
                    ),
                };
            case 'environment.stop':
                return {
                    handled: true,
                    value: await this.stopEnvironment(requireController()),
                };
            case 'environment.cancel':
                requireController().cancel();
                await requireController().waitUntilIdle();
                return { handled: true };
            case 'environment.confirm':
                await this.confirmPlan(a.plan, requireController);
                return { handled: true };
            case 'environment.dismiss':
                requireController().dismissPlan();
                return { handled: true };
            default:
                return (
                    (await this.runServiceCommand(
                        request,
                        backend,
                        signal,
                        requireController,
                    )) ?? { handled: false }
                );
        }
    }
    /** Applies the selection, then reopens the usage run for the new state. */
    private async applyEnvironment(
        controller: LiveController,
        action: 'start' | 'apply',
        approveStops?: boolean,
    ) {
        await this.usage?.closeRun();
        await this.startEnvironment(controller, action, approveStops);
        await this.refreshUsage();
        await this.ensureUsageRun();
        return undefined;
    }
    /** Stops the environment, closing the run so its verdict is learned. */
    private async stopEnvironment(controller: LiveController) {
        this.interactions.close();
        await controller.stop();
        await this.usage?.closeRun();
        await this.refreshUsage();
        return undefined;
    }
    /** Service-level commands that need the live controller. */
    private async runServiceCommand(
        request: CommandRequest,
        backend: BackendSession,
        signal: AbortSignal,
        requireController: () => LiveController,
    ): Promise<Dispatch | undefined> {
        const { command, args: a } = request;
        if (command === 'service.action')
            return {
                handled: true,
                value: await requireController().serviceAction(
                    a.action === 'start'
                        ? startChain(a.services, backend.groups)
                        : a.services,
                    a.action,
                ),
            };
        if (command === 'service.reload')
            return {
                handled: true,
                value: await requireController().reloadService(a.service),
            };
        if (command !== 'container.action') return undefined;
        return {
            handled: true,
            value: await this.manageContainer(
                backend,
                a,
                signal,
                requireController,
            ),
        };
    }
    private async startEnvironment(
        controller: LiveController,
        action: 'start' | 'apply',
        approveStops?: boolean,
    ) {
        await controller[action]();
        await controller.waitUntilIdle();
        if (controller.getSnapshot().plan && approveStops) {
            const plan = JSON.stringify({
                plan: controller.getSnapshot().plan,
                revision: this.state.configurationRevision,
            });
            await this.confirmPlan(plan, () => controller);
        }
    }
    private async confirmPlan(
        plan: unknown,
        requireController: () => LiveController,
    ) {
        if (
            plan !==
            JSON.stringify({
                plan: this.state.live.plan,
                revision: this.state.configurationRevision,
            })
        )
            throw new ClientError({
                code: 'PLAN_CHANGED',
                message: 'The plan changed. Review it before confirming.',
            });
        const controller = requireController();
        controller.confirmStart();
        await controller.waitUntilIdle();
        await this.ensureUsageRun();
    }
    private async manageContainer(
        backend: BackendSession,
        a: CommandRequest<'container.action'>['args'],
        signal: AbortSignal,
        requireController: () => LiveController,
    ) {
        if (!backend.manager)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'This runtime cannot manage containers.',
            });
        const current = await backend.manager.inspect(a.container.id, signal);
        if (
            current.incarnation !== a.container.incarnation ||
            current.backend !== a.container.backend
        )
            throw new ClientError({
                code: 'STALE_CONTAINER',
                message:
                    'This container changed. Refresh its details before retrying.',
            });
        return requireController().manageContainer(
            backend.manager,
            current,
            a.action,
        );
    }
    private async runProjectCommand(
        request: CommandRequest,
        backend: BackendSession,
        signal: AbortSignal,
        id: string,
        requireController: () => LiveController,
    ): Promise<Dispatch> {
        const profile = await this.runProfileCommand(request, backend);
        if (profile.handled) return profile;
        const session = await this.runSessionCommand(
            request,
            backend,
            signal,
            id,
            requireController,
        );
        if (session) return session;
        const { command, args: a } = request;
        switch (command) {
            case 'configuration.save':
                await this.queueConfigurationSave(request, backend);
                await this.rememberPin(backend, [a.edit.name]);
                return { handled: true };
            case 'usage.cacheClear':
                return {
                    handled: true,
                    value: await this.clearUsageCache(backend),
                };
            case 'project.saveJourney':
                return {
                    handled: true,
                    value: await this.saveJourneyFile(backend, a),
                };
            case 'project.deleteJourney':
                if (!backend.deleteJourney)
                    throw new ClientError({
                        code: 'UNSUPPORTED',
                        message: 'No project is open.',
                    });
                return {
                    handled: true,
                    value: await backend.deleteJourney(a.name),
                };
            case 'configuration.legacyEdit':
                return {
                    handled: true,
                    value: await this.queueLegacySave(request, backend),
                };
            case 'settings.save':
                await this.queueSettingsSave(request, signal);
                return { handled: true };
            default:
                return { handled: false };
        }
    }

    /** Commands bound to the live session or an interactive operation. */
    private async runSessionCommand(
        request: CommandRequest,
        backend: BackendSession,
        signal: AbortSignal,
        id: string,
        requireController: () => LiveController,
    ): Promise<Dispatch | undefined> {
        const { command, args: a } = request;
        switch (command) {
            case 'ssh.setup':
                return {
                    handled: true,
                    value: await requireController().setupSsh(a),
                };
            case 'runtime.start':
                return {
                    handled: true,
                    value: await backend.runtime.startService?.(signal),
                };
            case 'authentication.login':
                return {
                    handled: true,
                    value: await this.login(request, backend, signal, id),
                };
            case 'project.clone':
                return {
                    handled: true,
                    value: await this.cloneProject(a.destination, signal, id),
                };
            default:
                return undefined;
        }
    }

    private async runProfileCommand(
        request: CommandRequest,
        backend: BackendSession,
    ): Promise<Dispatch> {
        if (request.command === 'environment.profileExport') {
            if (!backend.profiles)
                throw new Error(
                    'Restart the daemon to use environment profiles.',
                );
            return {
                handled: true,
                value: await backend.profiles.export(
                    request.args.path,
                    request.args.force,
                    request.args.profile,
                ),
            };
        }
        if (request.command === 'environment.profileImport')
            return {
                handled: true,
                value: await this.queueProfileImport(request, backend),
            };
        return { handled: false };
    }

    private cloneProject(
        destination: string,
        signal: AbortSignal,
        operationId: string,
    ) {
        return this.interactions.run(
            operationId,
            'Cloning project',
            signal,
            (run, interactiveSignal) =>
                this.host.clone(destination, interactiveSignal, run),
        );
    }

    private queueConfigurationSave(
        request: CommandRequest<'configuration.save'>,
        backend: BackendSession,
    ) {
        const { args: a } = request;
        const controller = backend.controller;
        const save = this.configurationQueue.then(async () => {
            this.assertScope(request.scope);
            await backend.save(a.edit, a.revision);
            await this.refreshConfiguration();
            controller?.saved();
        });
        this.configurationQueue = save.catch(() => {});
        return save;
    }
    private queueSettingsSave(
        request: CommandRequest<'settings.save'>,
        signal: AbortSignal,
    ) {
        const { args: a } = request;
        const save = this.settingsQueue.then(() => {
            this.assertScope(request.scope);
            return this.saveSetting(a.key, a.value, a.revision, signal);
        });
        this.settingsQueue = save.catch(() => {});
        return save;
    }
    private queueLegacySave(
        request: CommandRequest<'configuration.legacyEdit'>,
        backend: BackendSession,
    ) {
        const save = this.configurationQueue.then(async () => {
            this.assertScope(request.scope);
            if (!backend.saveLegacy)
                throw new ClientError({
                    code: 'UNSUPPORTED',
                    message: 'Legacy configuration edits are unavailable.',
                });
            const result = await this.saveDeferredConfiguration(
                request,
                backend,
            );
            backend.controller?.deferConfiguration(result.revision);
            await this.refreshConfiguration();
            return result;
        });
        this.configurationQueue = save.catch(() => {});
        return save;
    }

    private queueProfileImport(
        request: CommandRequest<'environment.profileImport'>,
        backend: BackendSession,
    ) {
        const save = this.configurationQueue.then(() =>
            this.saveProfileImport(request, backend),
        );
        this.configurationQueue = save.catch(() => {});
        return save;
    }

    private async saveProfileImport(
        request: CommandRequest<'environment.profileImport'>,
        backend: BackendSession,
    ) {
        this.assertScope(request.scope);
        if (!backend.profiles)
            throw new Error('Restart the daemon to use environment profiles.');
        const previous =
            backend.controller?.getSnapshot().deferredConfigurationRevision;
        try {
            const result = await backend.profiles.save({
                ...request.args,
                beforeCommit: async (revision) => {
                    backend.controller?.deferConfiguration(revision, true);
                    await this.checkpoint();
                },
            });
            backend.controller?.deferConfiguration(result.revision);
            await this.refreshConfiguration();
            return result;
        } catch (error) {
            backend.controller?.restoreConfigurationDeferral(previous);
            throw error;
        }
    }
    private async saveDeferredConfiguration(
        request: CommandRequest<'configuration.legacyEdit'>,
        backend: BackendSession,
    ) {
        const previous =
            backend.controller?.getSnapshot().deferredConfigurationRevision;
        try {
            return await backend.saveLegacy!(
                request.args.edit,
                request.args.revision,
                async (revision) => {
                    backend.controller?.deferConfiguration(revision, true);
                    await this.checkpoint();
                },
            );
        } catch (error) {
            backend.controller?.restoreConfigurationDeferral(previous);
            throw error;
        }
    }
    private async login(
        request: CommandRequest<'authentication.login'>,
        backend: BackendSession,
        signal: AbortSignal,
        id: string,
    ) {
        const { args: a } = request;
        const controller = backend.controller;
        const result = await this.interactions.run(
            id,
            'Logging in',
            signal,
            (run, interactiveSignal) =>
                this.host.login(backend, a.action, interactiveSignal, run),
        );
        this.update({ aws: await this.host.aws(signal) });
        if (result.outcome === 'success') {
            this.assertScope(request.scope);
            await controller?.loginSucceeded(a.action);
        }
        return result;
    }
    private assertEnvironmentOutcome(
        request: CommandRequest,
        controller: LiveController | undefined,
    ) {
        if (
            ![
                'environment.start',
                'environment.apply',
                'environment.stop',
                'environment.confirm',
            ].includes(request.command)
        )
            return;
        const state = controller!.getSnapshot();
        if (state.plan)
            throw new ClientError({
                code: 'CONFIRMATION_REQUIRED',
                message: state.message,
                data: {
                    plan: state.plan,
                    revision: this.state.configurationRevision,
                },
            });
        if (state.phase === 'Failed' || state.phase === 'Blocked')
            throw new ClientError({
                code: state.blocked
                    ? `${state.blocked.toUpperCase()}_REQUIRED`
                    : 'ENVIRONMENT_FAILED',
                message: state.message,
            });
    }
    private async saveSetting(
        key: SettingKey,
        value: SettingValues[SettingKey] | undefined,
        revision: string,
        signal?: AbortSignal,
    ) {
        signal?.throwIfAborted();
        if (revision !== this.host.settingsRevision())
            throw new ClientError({
                code: 'SETTINGS_CONFLICT',
                message: 'Settings changed. Review the latest values.',
            });
        const previous = this.host.settings();
        const next = this.host.previewSetting(key, value);
        if (
            next[key].source === 'env' &&
            JSON.stringify(next[key].value) !== JSON.stringify(value)
        )
            throw new ClientError({
                code: 'ENVIRONMENT_OVERRIDE',
                message: `${next[key].environment} controls this setting. Update the daemon startup environment to change it.`,
            });
        if (!ProjectSession.settingSwitches(key, next, previous)) {
            await this.host.saveSetting(key, value);
            this.backend?.controller?.setAutoApply(next.autoApply.value);
            return;
        }
        await this.switchCheckout(key, value, previous, next, signal);
    }
    private static settingSwitches(
        key: SettingKey,
        next: ResolvedSettings,
        previous: SettingsSnapshot,
    ) {
        return (
            ['project', 'runtime', 'orchestrator'].includes(key) &&
            ['project', 'runtime', 'orchestrator'].some(
                (k) =>
                    JSON.stringify(next[k as SettingKey].value) !==
                    JSON.stringify(previous.startup[k as SettingKey].value),
            )
        );
    }
    private async switchCheckout(
        key: SettingKey,
        value: SettingValues[SettingKey] | undefined,
        previous: SettingsSnapshot,
        next: ResolvedSettings,
        signal?: AbortSignal,
    ) {
        const destination = next.project.value;
        if (!destination)
            throw new ClientError({
                code: 'INVALID_PROJECT',
                message: 'Choose a project directory.',
            });
        const project = await this.host.validateProject(destination);
        if (!project.valid)
            throw new ClientError({
                code: 'INVALID_PROJECT',
                message: project.message,
            });
        if (
            next.runtime.value === 'apple' &&
            next.orchestrator.value !== 'native'
        )
            throw new ClientError({
                code: 'INVALID_RUNTIME',
                message: 'Apple containers require native orchestration.',
            });
        const old = this.backend!;
        this.switching = true;
        this.update({
            notice: 'Stopping the current environment before switching…',
        });
        await this.checkpoint(true);
        try {
            await this.usage?.closeRun();
            await this.stopCurrentEnvironment(old, signal);
            signal?.throwIfAborted();
            await this.supervisor.close();
            this.unsubscribe?.();
            await old.close();
            await this.activateCheckout(key, value, previous);
            this.update({
                notice: 'Checkout selected. Start the environment when ready.',
            });
        } finally {
            this.switching = false;
            await this.checkpoint(true);
        }
    }
    private async stopCurrentEnvironment(
        old: BackendSession,
        signal?: AbortSignal,
    ) {
        this.interactions.close();
        if (old.controller) {
            const cancel = () => old.controller?.cancel();
            signal?.addEventListener('abort', cancel, { once: true });
            try {
                await old.controller.stop();
            } finally {
                signal?.removeEventListener('abort', cancel);
            }
            signal?.throwIfAborted();
            if (old.controller.getSnapshot().phase !== 'Stopped')
                throw new ClientError({
                    code: 'STOP_FAILED',
                    message: `Checkout was not switched. ${old.controller.getSnapshot().message}`,
                });
        }
        if (old.manager) {
            const remaining = (await old.manager.list()).filter(
                (container) => container.currentProject,
            );
            if (remaining.length)
                throw new ClientError({
                    code: 'STOP_FAILED',
                    message: `Checkout was not switched. Containers remain: ${remaining.map((c) => c.name).join(', ')}.`,
                });
        }
    }
    private async activateCheckout(
        key: SettingKey,
        value: SettingValues[SettingKey] | undefined,
        previous: SettingsSnapshot,
    ) {
        let saved = false;
        let opened: BackendSession | undefined;
        try {
            await this.host.saveSetting(key, value);
            saved = true;
            this.host.activateSettings();
            opened = await this.host.open();
            await this.attach(opened);
        } catch (error) {
            await opened?.close();
            this.unsubscribe?.();
            await this.recoverCheckout(key, previous, saved);
            throw error;
        }
    }
    private async recoverCheckout(
        key: SettingKey,
        previous: SettingsSnapshot,
        saved: boolean,
    ) {
        try {
            if (saved) {
                await this.host.saveSetting(key, previous.resolved[key].file);
                if (key === 'runtime')
                    await this.host.saveSetting(
                        'orchestrator',
                        previous.resolved.orchestrator.file,
                    );
                this.host.activateSettings();
            }
            await this.attach(await this.host.open());
        } catch (recovery) {
            this.stateFailure =
                'Reconfiguration failed after stopping the environment. Review the settings file and restart the daemon.';
            this.update({ ready: false, notice: this.stateFailure });
            throw new ClientError({
                code: 'RECONFIGURATION_FAILED',
                message: this.stateFailure,
            });
        }
    }
    private async refreshSettings() {
        await this.host.refreshSettings?.();
        this.backend?.controller?.setAutoApply(
            this.host.settings().resolved.autoApply.value,
        );
        this.update({
            settings: this.host.settings(),
            settingsRevision: this.host.settingsRevision(),
        });
    }
    private async refreshConfiguration() {
        if (!this.backend) return;
        const next = await this.backend.readConfiguration();
        this.update({
            details: next.details,
            configurationRevision: next.revision,
            configurationError: next.error,
        });
    }
    /** Pulls the usage cache state into the session snapshot. */
    private async refreshUsage() {
        if (!this.backend?.usage) return;
        this.update({ usage: await this.backend.usage() });
    }
    /** Opens a usage run when none is open (after an apply completes). */
    private ensureUsageRun() {
        if (!this.usage || this.usage.open || !this.backend) return;
        return this.usage.openRun(this.backend.project.directory);
    }
    private async refreshStatus(signal?: AbortSignal) {
        if (!this.backend?.project.valid) return;
        try {
            const statuses = await this.backend.runtime.inspect(
                { directory: this.backend.project.directory },
                signal,
            );
            this.update({ statuses, runtimeState: 'ready' });
        } catch (error) {
            if (!signal?.aborted)
                this.update({ runtimeState: 'error', statuses: {} });
        }
    }
    async query(request: QueryRequest, signal?: AbortSignal): Promise<unknown> {
        this.assertScope(request.scope);
        const backend = this.backend!;
        const gated = await this.queryGates(request, backend, signal);
        if (gated.handled) return gated.value;
        switch (request.query) {
            case 'aws.refresh': {
                const aws = await this.host.aws(signal);
                this.update({ aws });
                return aws;
            }
            case 'refresh':
                if (!this.switching) await this.refreshSettings();
                await this.refreshConfiguration();
                await this.refreshStatus(signal);
                return;
            case 'project.search':
                return this.search();
            default: {
                const project = await this.queryProject(request, backend);
                if (project.handled) return project.value;
                return undefined;
            }
        }
    }

    /** Version, profile, container, journey and configuration queries. */
    private async queryGates(
        request: QueryRequest,
        backend: BackendSession,
        signal?: AbortSignal,
    ): Promise<Dispatch> {
        const versions = await this.queryVersions(request, backend, signal);
        if (versions.handled) return versions;
        const profile = await this.queryProfile(request, backend, signal);
        if (profile.handled) return profile;
        const containers = await this.queryContainers(request, backend, signal);
        if (containers.handled) return containers;
        const journeys = this.queryJourneys(request, backend);
        if (journeys.handled) return journeys;
        const proxy = this.queryProxy(request, backend);
        if (proxy.handled) return proxy;
        return this.queryConfiguration(request, backend, signal);
    }

    private async queryVersions(
        request: QueryRequest,
        backend: BackendSession,
        signal?: AbortSignal,
    ): Promise<Dispatch> {
        if (request.query !== 'environment.versionSnapshot')
            return { handled: false };
        if (!backend.versionSnapshot)
            throw new Error('Restart the daemon to select service versions.');
        const result = await backend.versionSnapshot(
            request.args.source,
            signal,
            request.args.refresh,
        );
        this.assertScope(request.scope);
        await this.refreshConfiguration();
        return { handled: true, value: result };
    }

    private async queryProfile(
        request: QueryRequest,
        backend: BackendSession,
        signal?: AbortSignal,
    ): Promise<Dispatch> {
        if (
            !request.query.startsWith('environment.profile') &&
            request.query !== 'environment.cidevVersions'
        )
            return { handled: false };
        if (!backend.profiles)
            throw new Error('Restart the daemon to use environment profiles.');
        switch (request.query) {
            case 'environment.profile':
                return {
                    handled: true,
                    value: await backend.profiles.snapshot(),
                };
            case 'environment.profileRead':
                return {
                    handled: true,
                    value: await backend.profiles.read(request.args.path),
                };
            case 'environment.profilePreview':
                return {
                    handled: true,
                    value: await backend.profiles.preview(
                        request.args.profile,
                        request.args.versionsOnly,
                    ),
                };
            case 'environment.measure':
                return {
                    handled: true,
                    value: await this.measure(backend, request.args.journey),
                };
            case 'environment.cidevVersions': {
                if (!backend.cidevVersions)
                    throw new Error('CIDEV version discovery is unavailable.');
                return {
                    handled: true,
                    value: await backend.cidevVersions(request.args, signal),
                };
            }
            default:
                return { handled: false };
        }
    }
    private async measure(backend: BackendSession, journey?: string) {
        if (!backend.measure)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'Measurement is unavailable.',
            });
        return backend.measure(journey);
    }

    private async saveJourneyFile(
        backend: BackendSession,
        a: CommandRequest<'project.saveJourney'>['args'],
    ) {
        if (!backend.saveJourney)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'No project is open.',
            });
        const saved = await backend.saveJourney({
            name: a.name,
            services: a.services,
            lazy: a.lazy ?? [],
            excluded: a.excluded ?? [],
        });
        // A pin is authoritative evidence of need: drop any learned verdict.
        await this.rememberPin(backend, a.services);
        return saved;
    }

    /** A pinned service outranks the cache: drop its learned verdict. */
    private async rememberPin(
        backend: BackendSession,
        names: readonly string[],
    ) {
        await this.usage?.forget(backend.project.directory, names);
        await this.refreshUsage();
    }

    /** Wipes every learned verdict for the checkout. */
    private async clearUsageCache(backend: BackendSession) {
        if (!this.usage)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'Restart the daemon to manage the usage cache.',
            });
        if (!backend.project.valid)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'No project is open.',
            });
        const cleared = await this.usage.clear(backend.project.directory);
        await this.refreshUsage();
        return { cleared };
    }

    private queryJourneys(
        request: QueryRequest,
        backend: BackendSession,
    ): Dispatch {
        if (request.query !== 'journey.list') return { handled: false };
        if (!backend.journeys)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'No project is open.',
            });
        return { handled: true, value: backend.journeys() };
    }

    private queryProxy(
        request: QueryRequest,
        backend: BackendSession,
    ): Dispatch {
        if (request.query !== 'proxy.accounting') return { handled: false };
        if (!backend.accounting)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'The proxy is not running.',
            });
        return { handled: true, value: backend.accounting() };
    }

    private async queryConfiguration(
        request: QueryRequest,
        backend: BackendSession,
        signal?: AbortSignal,
    ) {
        if (request.query === 'environment.preview') {
            if (!backend.controller)
                throw new ClientError({
                    code: 'UNSUPPORTED',
                    message: 'Environment preview is unavailable.',
                });
            const value = await backend.controller.previewStart(signal);
            this.assertScope(request.scope);
            return { handled: true, value };
        }
        if (request.query === 'configuration.snapshot') {
            if (!backend.configurationSnapshot)
                throw new ClientError({
                    code: 'UNSUPPORTED',
                    message: 'Configuration inspection is unavailable.',
                });
            return {
                handled: true,
                value: await backend.configurationSnapshot(),
            };
        }
        if (request.query === 'dependency.diagram') {
            if (!backend.dependencyDiagram)
                throw new ClientError({
                    code: 'UNSUPPORTED',
                    message: 'Diagram rendering is unavailable.',
                });
            return {
                handled: true,
                value: await backend.dependencyDiagram(
                    request.args.services,
                    signal,
                ),
            };
        }
        return { handled: false };
    }
    async prepareLogStream(request: LogRequest, signal: AbortSignal) {
        this.assertScope(request.scope);
        const manager = this.backend?.manager;
        if (request.source === 'environment') return undefined;
        if (!manager?.streamLogs)
            throw new ClientError({
                code: 'UNSUPPORTED',
                message: 'This runtime cannot stream service logs.',
            });
        const available = new Set(
            this.state.groups.flatMap((group) => group.services),
        );
        for (const service of request.services) {
            if (!available.has(service))
                throw new ClientError({
                    code: 'UNKNOWN_SERVICE',
                    message: `Unknown service: ${service}`,
                });
        }
        const containers = (await manager.list(signal)).filter(
            (container) =>
                container.currentProject &&
                (!request.services.length ||
                    request.services.some(
                        (service) =>
                            container.service === service ||
                            container.ownerService === service,
                    )),
        );
        this.assertScope(request.scope);
        return async (
            send: (entry: { service: string; text: string }) => void,
        ) => {
            const failed = new AbortController();
            const streamSignal = AbortSignal.any([signal, failed.signal]);
            const results = await Promise.allSettled(
                containers.map((container) =>
                    manager.streamLogs!(container, request, {
                        signal: streamSignal,
                        onOutput: (entry) =>
                            send({
                                service: container.service ?? container.name,
                                text: entry.text,
                            }),
                    }).catch((error) => {
                        failed.abort(error);
                        throw error;
                    }),
                ),
            );
            const error = results.find(
                (result) => result.status === 'rejected',
            );
            if (error?.status === 'rejected') throw failed.signal.reason;
        };
    }
    private async search() {
        if (!this.searchAbort) {
            this.searchAbort = new AbortController();
            this.update({
                search: { ...this.state.search, searching: true },
            });
            void this.host
                .search(
                    (search) => this.update({ search }),
                    this.searchAbort.signal,
                )
                .catch((error) =>
                    this.update({
                        search: {
                            ...this.state.search,
                            searching: false,
                        },
                        notice: 'Project search failed.',
                    }),
                );
        }
        return this.state.search;
    }
    private async queryContainers(
        request: QueryRequest,
        backend: BackendSession,
        signal?: AbortSignal,
    ): Promise<Dispatch> {
        const { query, args: a } = request;
        switch (query) {
            case 'containers.list':
                return {
                    handled: true,
                    value: backend.manager?.list(signal) ?? [],
                };
            case 'containers.inspect':
                return {
                    handled: true,
                    value: backend.manager?.inspect(a.id, signal),
                };
            case 'containers.logs':
                return {
                    handled: true,
                    value: backend.manager?.logs(a.id, a.tail, signal),
                };
            case 'services.logs':
                return {
                    handled: true,
                    value: backend.controller?.serviceLogs(
                        a.service,
                        a.tail,
                        signal,
                    ),
                };
            default:
                return { handled: false };
        }
    }
    private async queryProject(
        request: QueryRequest,
        backend: BackendSession,
    ): Promise<Dispatch> {
        const { query, args: a } = request;
        switch (query) {
            case 'aws.discovery': {
                const directory = backend.project.valid
                    ? backend.project.directory
                    : undefined;

                return {
                    handled: true,
                    value: this.host.discovery(directory),
                };
            }
            case 'project.validate':
                return {
                    handled: true,
                    value: this.host.validateProject(a.directory),
                };
            case 'project.cloneDestination':
                return {
                    handled: true,
                    value: {
                        error: await this.host.cloneDestination(a.directory),
                    },
                };
            case 'project.defaultDestination':
                return {
                    handled: true,
                    value: this.host.defaultDestination(),
                };
            case 'diagnostics':
                return { handled: true, value: this.host.diagnostics() };
            default:
                return { handled: false };
        }
    }
    async close() {
        this.closed = true;
        this.searchAbort?.abort();
        this.interactions.close();
        if (this.state.live.busy) this.backend?.controller?.cancel();
        await this.supervisor.close();
        try {
            // Best effort: a failed write costs one run's verdict, no more.
            await this.usage?.closeRun().catch(() => {});
            if (this.backend) await this.checkpoint(true);
        } finally {
            this.unsubscribe?.();
            await this.backend?.close();
        }
    }
}
