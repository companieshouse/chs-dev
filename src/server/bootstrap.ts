import {
    createTelemetry,
    telemetryConfiguration,
} from '../infrastructure/telemetry.js';
import { shutdown } from './shutdown.js';
import { startProcessGuard } from '../infrastructure/process-guard.js';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import { ProjectSession } from '../application/project-session.js';
import { Operations } from '../application/operations.js';
import { Interactions } from '../application/interactions.js';
import type { ApplicationHost, BackendSession } from '../application/ports.js';
import {
    initializeSettings,
    stateDirectory,
    projectStateDirectory,
    expandHome,
} from '../infrastructure/settings.js';
import { readProjectConfig } from '../project/config.js';
import { startDaemonProxy } from './proxy-service.js';
import { measureProject } from '../project/measure.js';
import { createUsageLedger } from '../proxy/usage-ledger.js';
import { UsageTracker } from '../application/usage-tracker.js';
import {
    deleteJourney,
    listJourneys,
    saveJourney,
} from '../project/journeys.js';
import type { RequestAccounting } from '../proxy/accounting.js';
import { createAccounting } from '../proxy/accounting.js';
import type { LiveController } from '../application/live-controller.js';
import type { ProxyState } from '../domain/environment.js';
import { readServices } from '../project/catalog.js';
import { saveServiceChanges } from '../project/service-configuration.js';
import { EnvironmentProfiles } from '../project/environment-profiles.js';
import { readCidevVersions } from '../infrastructure/cidev-versions.js';
import { ServiceVersions } from '../infrastructure/service-versions.js';
import type { CidevVersionOptions } from '../domain/aws-versions.js';
import type { AwsEnvironment } from '../domain/version-sources.js';
import {
    configurationSnapshot,
    saveLegacyChanges,
} from '../project/configuration.js';
import { dependencyDiagrams } from '../infrastructure/dependency-diagrams.js';
import { resolveServiceState } from '../domain/service-state.js';
import {
    createLiveSession,
    closeLiveSession,
} from '../infrastructure/live-session.js';
import { DockerComposeStrategy } from '../infrastructure/runtimes/docker-compose.js';
import { initializeTuiLog, tuiLog } from '../infrastructure/tui-log.js';
import {
    DaemonState,
    exclusiveLease,
    hostSessionIdentity,
} from '../infrastructure/daemon-state.js';
import { readAwsStatus, awsProfile } from '../infrastructure/aws-status.js';
import {
    discoverAwsProfiles,
    effectiveEcrProfiles,
} from '../infrastructure/aws-profiles.js';
import { runAwsLogin } from '../infrastructure/aws-login.js';
import { runInteractiveCommand } from '../infrastructure/interactive-command.js';
import { withInteractiveRunner } from '../infrastructure/interactive-context.js';
import { createTerminal } from '../infrastructure/terminal-process.js';
import {
    cloneDestinationError,
    defaultCloneDestination,
    isProjectRemote,
    projectRepositoryUrl,
    readGitOrigin,
    searchProjects,
} from '../project/discovery.js';
import { ClientError, type ProjectSearch } from '../protocol/types.js';
import type { RuntimeStrategy } from '../domain/runtime-strategy.js';
import type { LiveIntent } from '../application/live-controller.js';
import type { SettingsSnapshot } from '../domain/settings.js';
import type { ProjectConfig } from '../domain/project.js';
import type { ServiceGroup, ServiceDetails } from '../domain/services.js';

function createHostValidateProject(): ApplicationHost['validateProject'] {
    return async (directory) => {
        const config = await readProjectConfig(expandHome(directory));
        if (config.valid) config.directory = await realpath(config.directory);
        const origin = await readGitOrigin(config.directory);
        return {
            ...config,
            origin,
            expectedOrigin: !!origin && isProjectRemote(origin),
        };
    };
}
async function acquireSupervisor(project: ProjectConfig) {
    const directory = projectStateDirectory(project.directory);
    if (
        await access(join(directory, 'live.lock')).then(
            () => true,
            () => false,
        )
    )
        throw new Error(
            'A legacy TUI session holds this checkout. Close that TUI before starting the daemon. A stale live.lock must be checked before removing it.',
        );
    return exclusiveLease(join(directory, 'supervisor.lock'));
}
async function readProjectConfiguration(
    project: ProjectConfig,
    groups: ServiceGroup[],
    versions?: ServiceVersions,
): Promise<{
    details: Record<string, ServiceDetails>;
    revision: string;
    error: string;
}> {
    if (!project.valid)
        return {
            details: {},
            revision: '',
            error: project.message,
        };
    let revision = '';
    try {
        const yaml = await readFile(
            join(project.directory, '.chs-dev.yaml'),
            'utf8',
        ).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return '{}\n';
            throw error;
        });
        revision = createHash('sha256').update(yaml).digest('hex');
        return {
            details:
                (await versions?.decorate(
                    resolveServiceState(parse(yaml), groups),
                )) ?? resolveServiceState(parse(yaml), groups),
            revision,
            error: '',
        };
    } catch (error) {
        return {
            details: {},
            revision,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function heldSupervisorLease() {
    return async () => {};
}
async function closeBackendSession(
    controller: BackendSession['controller'],
    release: Awaited<ReturnType<typeof exclusiveLease>> | undefined,
) {
    try {
        if (controller) await closeLiveSession(controller);
    } finally {
        await release?.();
    }
}

async function openSupervised(
    project: ProjectConfig,
    groups: ServiceGroup[],
    runtime: RuntimeStrategy,
    versions: ServiceVersions,
    intent?: LiveIntent,
) {
    const release = await acquireSupervisor(project);
    try {
        const controller = createLiveSession(
            runtime,
            project.directory,
            groups,
            {
                initialIntent: intent,
                lock: { acquire: heldSupervisorLease },
                versions,
            },
        );
        return { controller, release };
    } catch (error) {
        await release();
        throw error;
    }
}

function serviceSaver(
    project: ProjectConfig,
    groups: ServiceGroup[],
): BackendSession['save'] {
    return async (edit, revision) => {
        await saveServiceChanges({
            directory: project.directory,
            name: edit.name,
            enabled: edit.enabled,
            development: edit.development,
            provider: edit.provider,
            mockScenario: edit.mockScenario,
            image: edit.image,
            versionSource: edit.versionSource,
            startMode: edit.startMode,
            groups,
            exclusions: edit.exclusions,
            expectedRevision: revision,
        });
    };
}

function accountingCapability(
    project: ProjectConfig,
    state: (() => ProxyState) | undefined,
): BackendSession['accounting'] {
    if (!project.valid || !state) return undefined;
    return async () => state();
}

function usageCapability(
    project: ProjectConfig,
    tracker: UsageTracker | undefined,
): BackendSession['usage'] {
    if (!project.valid || !tracker) return undefined;
    return () => tracker.snapshot(project.directory);
}

function journeySaver(project: ProjectConfig): BackendSession['saveJourney'] {
    if (!project.valid) return undefined;
    return (input) =>
        saveJourney(project.directory, {
            name: input.name,
            services: input.services,
            lazy: input.lazy,
            excluded: input.excluded ?? [],
        }).then((path) => ({ path }));
}

function createHostOpen(
    runtimeOption: (() => RuntimeStrategy) | undefined,
    accounting: RequestAccounting,
    proxyState: () => ProxyState,
    active: { controller?: LiveController },
    usage: { tracker: UsageTracker | undefined; enabled: () => boolean },
): ApplicationHost['open'] {
    return async (intent) => {
        const project = await readProjectConfig();
        if (project.valid)
            project.directory = await realpath(project.directory);
        const groups = await readGroups(project);
        const { versions, profiles } = createVersionServices(
            project.directory,
            groups,
        );
        const runtime = runtimeOption?.() ?? new DockerComposeStrategy();
        let release: Awaited<ReturnType<typeof exclusiveLease>> | undefined;
        let controller: BackendSession['controller'];
        if (project.valid) {
            const opened = await openSupervised(
                project,
                groups,
                runtime,
                versions,
                intent,
            );
            controller = opened.controller;
            release = opened.release;
            active.controller = controller;
        }
        return {
            project,
            groups,
            ...profileServices(profiles, groups, versions),
            runtime,
            controller,
            manager: containerManager(project, runtime),
            readConfiguration: () =>
                readProjectConfiguration(project, groups, versions),
            configurationSnapshot: () =>
                configurationSnapshot(project.directory),
            saveLegacy: (edit, revision) =>
                saveLegacyChanges(project.directory, groups, edit, revision),
            dependencyDiagram: (services, signal) =>
                dependencyDiagrams(project.directory, groups, services, signal),
            measure: measureCapability(project, usage.enabled),
            save: serviceSaver(project, groups),
            saveJourney: journeySaver(project),
            journeys: journeysCapability(project),
            deleteJourney: deleteJourneyCapability(project),
            accounting: accountingCapability(project, proxyState),
            usage: usageCapability(project, usage.tracker),
            close: () => {
                if (active.controller === controller)
                    active.controller = undefined;
                return closeBackendSession(controller, release);
            },
        };
    };
}

function createVersionServices(directory: string, groups: ServiceGroup[]) {
    const versions = new ServiceVersions(
        join(projectStateDirectory(directory), 'versions'),
        groups,
    );
    const profiles = new EnvironmentProfiles(
        directory,
        groups,
        (inventory, selections) => versions.images(inventory, selections),
    );
    return { versions, profiles };
}

function profileServices(
    profiles: EnvironmentProfiles,
    groups: ServiceGroup[],
    versions: ServiceVersions,
) {
    return {
        profiles,
        versionSnapshot: (
            source: AwsEnvironment,
            signal?: AbortSignal,
            refresh?: boolean,
        ) => versions.snapshot(source, signal, refresh),
        cidevVersions: async (
            options: CidevVersionOptions,
            signal?: AbortSignal,
        ) => {
            const snapshot = await profiles.snapshot(false);
            const versions = await readCidevVersions(options, groups, signal);
            return {
                profile: {
                    ...snapshot,
                    selections: {
                        ...snapshot.selections,
                        serviceImages: versions.images,
                    },
                },
                matches: versions.matches,
                ambiguous: versions.ambiguous,
                warnings: versions.warnings,
                clusters: versions.clusters,
                runningTasks: versions.runningTasks,
            };
        },
    };
}
function createHostLogin(settings: {
    getSnapshot: () => SettingsSnapshot;
}): ApplicationHost['login'] {
    return async (backend, action, signal, runner) =>
        withInteractiveRunner(runner, async () => {
            if (action === 'aws') return runAwsLogin(awsProfile(), signal);
            const selected = settings.getSnapshot().resolved;
            const discovery = selected.ecrProfiles.value?.length
                ? undefined
                : await discoverAwsProfiles({
                      projectDirectory: backend.project.valid
                          ? backend.project.directory
                          : undefined,
                      primary: selected.awsProfile.value,
                  });
            return backend.runtime.loginRegistry(
                {
                    profiles: effectiveEcrProfiles(
                        selected.ecrProfiles.value,
                        discovery,
                        selected.awsProfile.value,
                    ),
                },
                signal,
            );
        });
}
function createHostClone(): ApplicationHost['clone'] {
    return async (destination, signal, runner) => {
        const target = expandHome(destination);
        const problem = await cloneDestinationError(target);
        if (problem)
            throw new ClientError({
                code: 'INVALID_DESTINATION',
                message: problem,
            });
        return withInteractiveRunner(runner, () =>
            runInteractiveCommand({
                command: 'git',
                args: ['clone', projectRepositoryUrl, target],
                label: 'Git clone',
                missingMessage: 'git is not installed.',
                signal,
            }),
        );
    };
}
function createHostSearch(): ApplicationHost['search'] {
    return async (update, signal) => {
        const result: ProjectSearch = {
            found: [],
            visited: 0,
            searching: true,
            truncated: false,
        };
        const pending: Promise<void>[] = [];
        const readCandidate = async (directory: string) => {
            const config = await readProjectConfig(directory);
            if (signal.aborted) return;
            result.found.push(config);
            update({ ...result, found: [...result.found] });
        };
        const found = await searchProjects(homedir(), {
            signal,
            onProgress: (visited) => {
                result.visited = visited;
                update({ ...result, found: [...result.found] });
            },
            onFound: (directory) => {
                pending.push(readCandidate(directory));
            },
        });
        await Promise.all(pending);
        if (!signal.aborted)
            update({
                ...result,
                searching: false,
                truncated: found.truncated,
            });
    };
}
function createApplicationHost(
    settings: Awaited<ReturnType<typeof initializeSettings>>,
    state: DaemonState,
    sessionIdentity: string,
    daemon: {
        runtime?: () => RuntimeStrategy;
        accounting: RequestAccounting;
        proxyState: () => ProxyState;
        active: { controller?: LiveController };
        usage: UsageTracker | undefined;
        usageCacheEnabled: () => boolean;
    },
): ApplicationHost {
    return {
        id: randomUUID,
        home: homedir(),
        hostSession: sessionIdentity,
        settings: settings.getSnapshot,
        refreshSettings: () => settings.refresh(),
        settingsRevision: () =>
            createHash('sha256')
                .update(JSON.stringify(settings.getSnapshot()))
                .digest('hex'),
        previewSetting: (key, value) => settings.preview(key, value),
        saveSetting: (key, value) => settings.save(key, value),
        activateSettings: () => settings.activate(),
        readIntent: () => state.readIntent(),
        writeIntent: (intent) => state.writeIntent(intent),
        validateProject: createHostValidateProject(),
        open: createHostOpen(
            daemon.runtime,
            daemon.accounting,
            daemon.proxyState,
            daemon.active,
            { tracker: daemon.usage, enabled: daemon.usageCacheEnabled },
        ),
        aws: readAwsStatus,
        discovery: (directory) =>
            discoverAwsProfiles({
                projectDirectory: directory,
                primary: awsProfile(),
            }),
        login: createHostLogin(settings),
        clone: createHostClone(),
        cloneDestination: (directory) =>
            cloneDestinationError(expandHome(directory)),
        defaultDestination: defaultCloneDestination,
        search: createHostSearch(),
        diagnostics: () =>
            tuiLog?.getSnapshot() ?? {
                lines: [],
                sequence: 0,
                failure: '',
                path: '',
            },
    };
}

export async function createApplication(
    options: {
        runtime?: () => import('../domain/runtime-strategy.js').RuntimeStrategy;
    } = {},
) {
    const settings = await initializeSettings();
    const state = new DaemonState(join(stateDirectory(), 'daemon'));
    await state.initialize();
    initializeTuiLog(state.directory);
    const sessionIdentity = await hostSessionIdentity();
    const accounting = createAccounting();
    const active: { controller?: LiveController } = {};
    const ledger = createUsageLedger();
    const usageCacheEnabled = () =>
        settings.getSnapshot().resolved.usageCache.value;
    const usage = new UsageTracker({ settings: settings.getSnapshot, ledger });
    const proxy = startDaemonProxy({
        ...options,
        accounting,
        controller: () => active.controller,
        ledger,
    });
    const host = createApplicationHost(settings, state, sessionIdentity, {
        runtime: options.runtime,
        accounting,
        proxyState: () => proxy.state(),
        active,
        usage,
        usageCacheEnabled,
    });
    const closeGuard = await startProcessGuard();
    const interactions = new Interactions(
        createTerminal,
        () => application?.changed(),
        randomUUID,
    );
    const application = new ProjectSession(host, interactions);
    application.usage = usage;
    const telemetry = createTelemetry(telemetryConfiguration());
    const operations = new Operations(
        state,
        () => application.changed(),
        (completion) => telemetry.record(completion),
    );
    application.operations = operations;
    const closeSteps = [
        async () => telemetry.close(),
        () => operations.close(),
        () => application.close(),
        () => proxy.close(),
    ];
    try {
        await operations.initialize();
        await application.initialize();
    } catch (error) {
        await shutdown([...closeSteps, closeGuard], { error });
        throw error;
    }
    return {
        application,
        operations,
        state,
        close: () => shutdown([...closeSteps, () => state.flush(), closeGuard]),
    };
}

function readGroups(project: ProjectConfig): Promise<ServiceGroup[]> {
    return project.valid ? readServices(project) : Promise.resolve([]);
}

function containerManager(project: ProjectConfig, runtime: RuntimeStrategy) {
    return project.valid
        ? runtime.containers?.({ directory: project.directory })
        : undefined;
}

function measureCapability(
    project: ProjectConfig,
    usageCache: () => boolean,
): BackendSession['measure'] {
    if (!project.valid) return undefined;
    return (journey?: string) =>
        measureProject(project.directory, undefined, journey, usageCache());
}

function journeysCapability(
    project: ProjectConfig,
): BackendSession['journeys'] {
    if (!project.valid) return undefined;
    return async () => ({
        ...(await listJourneys(project.directory)),
        active: (await configurationSnapshot(project.directory)).selections
            .journey,
    });
}

function deleteJourneyCapability(
    project: ProjectConfig,
): BackendSession['deleteJourney'] {
    if (!project.valid) return undefined;
    return (name) => deleteJourney(project.directory, name);
}
