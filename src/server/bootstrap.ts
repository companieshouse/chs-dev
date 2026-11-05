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
import { selectRuntime } from '../infrastructure/runtimes/select-runtime.js';
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

function createHostOpen(
    options: { runtime?: () => RuntimeStrategy } = {},
): ApplicationHost['open'] {
    return async (intent) => {
        const project = await readProjectConfig();
        if (project.valid)
            project.directory = await realpath(project.directory);
        const groups = project.valid ? await readServices(project) : [];
        const { versions, profiles } = createVersionServices(
            project.directory,
            groups,
        );
        const runtime = options.runtime?.() ?? selectRuntime();
        let release: Awaited<ReturnType<typeof exclusiveLease>> | undefined;
        let controller: BackendSession['controller'];
        if (project.valid) {
            release = await acquireSupervisor(project);
            try {
                controller = createLiveSession(
                    runtime,
                    project.directory,
                    groups,
                    {
                        explicitStart: true,
                        initialIntent: intent,
                        lock: { acquire: heldSupervisorLease },
                        versions,
                    },
                );
            } catch (error) {
                await release();
                throw error;
            }
        }
        return {
            project,
            groups,
            ...profileServices(profiles, groups, versions),
            runtime,
            controller,
            manager: project.valid
                ? runtime.containers?.({ directory: project.directory })
                : undefined,
            readConfiguration: () =>
                readProjectConfiguration(project, groups, versions),
            configurationSnapshot: () =>
                configurationSnapshot(project.directory),
            saveLegacy: (edit, revision, beforeCommit) =>
                saveLegacyChanges(
                    project.directory,
                    groups,
                    edit,
                    revision,
                    beforeCommit,
                ),
            dependencyDiagram: (services, signal) =>
                dependencyDiagrams(project.directory, groups, services, signal),
            save: async (edit, revision) => {
                await saveServiceChanges({
                    directory: project.directory,
                    name: edit.name,
                    enabled: edit.enabled,
                    development: edit.development,
                    provider: edit.provider,
                    mockScenario: edit.mockScenario,
                    image: edit.image,
                    versionSource: edit.versionSource,
                    groups,
                    exclusions: edit.exclusions,
                    expectedRevision: revision,
                });
            },
            close: () => closeBackendSession(controller, release),
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
    options: { runtime?: () => RuntimeStrategy },
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
        open: createHostOpen(options),
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
    const host = createApplicationHost(
        settings,
        state,
        sessionIdentity,
        options,
    );
    const closeGuard = await startProcessGuard();
    const interactions = new Interactions(
        createTerminal,
        () => application?.changed(),
        randomUUID,
    );
    const application = new ProjectSession(host, interactions);
    const operations = new Operations(state, () => application.changed());
    application.operations = operations;
    const closeSteps = [() => operations.close(), () => application.close()];
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
