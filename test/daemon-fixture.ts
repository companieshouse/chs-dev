import type { OperationCompletion } from '../src/domain/telemetry.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SettingsStore } from '../src/infrastructure/settings.js';
import { DaemonState } from '../src/infrastructure/daemon-state.js';
import { ProjectSession } from '../src/application/project-session.js';
import { Operations } from '../src/application/operations.js';
import { Interactions } from '../src/application/interactions.js';
import { LiveController } from '../src/application/live-controller.js';
import type {
    ApplicationHost,
    BackendSession,
} from '../src/application/ports.js';
import type { RuntimeContainer, LiveRuntime } from '../src/domain/live.js';
import type { ServiceGroup } from '../src/domain/services.js';
import type { MockSupport } from '../src/domain/providers.js';
import { withMockRuntime } from '../src/domain/live.js';
import { listJourneys, saveJourney } from '../src/project/journeys.js';
import type { TerminalFactory } from '../src/application/interactions.js';
import { listenApi } from '../src/server/api.js';
import { Client } from '../src/client/client.js';
import {
    editSelections,
    projectSelections,
    type ProjectSelections,
} from '../src/domain/configuration.js';
import { resolveServiceState } from '../src/domain/service-state.js';
import type { ContainerManager } from '../src/domain/containers.js';

export async function daemonFixture(
    terminal?: TerminalFactory,
    manager?: ContainerManager,
    options: {
        mock?: MockSupport;
        image?: string;
        completed?: (completion: OperationCompletion) => void;
        configure?: (backend: BackendSession) => void;
    } = {},
) {
    const root = await mkdtemp(join(tmpdir(), 'chs-daemon-test-'));
    const directory = join(root, 'checkout-a'),
        second = join(root, 'checkout-b');
    const settingsFile = join(root, 'settings.yaml');
    await writeFile(settingsFile, `project: ${directory}\n`);
    const stores = new Map<
        string,
        {
            containers: RuntimeContainer[];
            revision: number;
            enabled: boolean;
            selections: ProjectSelections;
        }
    >();
    const engine = {
        applies: 0,
        stops: 0,
        probes: 0,
        monitors: 0,
        observations: 0,
        failStop: false,
        applyGate: undefined as Promise<void> | undefined,
        legacySaveGate: undefined as Promise<void> | undefined,
    };
    let hostSession = 'login-a';
    let currentController!: LiveController;
    let app!: ProjectSession,
        operations!: Operations,
        api!: Awaited<ReturnType<typeof listenApi>>;
    const groups: ServiceGroup[] = [
        {
            name: 'fixture',
            services: ['api'],
            definitions: {
                api: {
                    dependencies: [],
                    module: 'fixture',
                    base: false,
                    development: true,
                    image: options.image ?? 'registry.example/api:1.0.0',
                    mock: options.mock,
                },
            },
        },
    ];
    const start = async () => {
        const settings = await SettingsStore.load(settingsFile, {}, root);
        const state = new DaemonState(join(root, 'state'));
        await state.initialize();
        const host: ApplicationHost = {
            id: randomUUID,
            home: root,
            hostSession,
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
            writeIntent: (value) => state.writeIntent(value),
            validateProject: async (path) => ({
                directory: path,
                valid: [directory, second].includes(path),
                message: 'Fixture project',
                expectedOrigin: true,
            }),
            open: async (intent) => {
                const path = settings.getSnapshot().startup.project.value!;
                const project = {
                    directory: path,
                    valid: true,
                    message: 'Fixture project',
                };
                let actual = stores.get(path);
                if (!actual) {
                    actual = {
                        containers: [],
                        revision: 1,
                        enabled: true,
                        selections: projectSelections({ services: ['api'] }),
                    };
                    stores.set(path, actual);
                }
                const snapshot = async () => {
                    engine.observations++;
                    return {
                        projectName: 'fixture',
                        projectDirectory: path,
                        containers: actual!.containers,
                    };
                };
                const revision = () => ({
                    identity: `revision-${actual!.revision}`,
                    yaml: '{}',
                    inventory: actual!.enabled
                        ? withMockRuntime([
                              {
                                  service: 'api',
                                  mode: resolveServiceState(
                                      actual!.selections,
                                      groups,
                                  ).api.mode as
                                      'Service' | 'Development' | 'Mock',
                                  ...(resolveServiceState(
                                      actual!.selections,
                                      groups,
                                  ).api.mockScenario
                                      ? {
                                            mockScenario: resolveServiceState(
                                                actual!.selections,
                                                groups,
                                            ).api.mockScenario,
                                        }
                                      : {}),
                              },
                          ])
                        : [],
                });
                const resolve = async () => ({
                    projectName: 'fixture',
                    projectDirectory: path,
                    configurationIdentity: revision().identity,
                    inventory: revision().inventory,
                });
                const success = () => ({
                    outcome: 'success' as const,
                    message: 'Done.',
                    affectedServices: ['api'],
                });
                const runtime: LiveRuntime = {
                    checkAvailability: async () => ({
                        available: true,
                        message: 'Ready',
                    }),
                    snapshot,
                    apply: async (prepared, { signal }) => {
                        engine.applies++;
                        if (engine.applyGate)
                            await Promise.race([
                                engine.applyGate,
                                new Promise((_, reject) => {
                                    signal?.addEventListener(
                                        'abort',
                                        () => reject(new Error('Cancelled')),
                                        { once: true },
                                    );
                                }),
                            ]);
                        actual!.containers = prepared.inventory.map(
                            (entry) => ({
                                id: 'api-' + path,
                                service: entry.service,
                                projectName: 'fixture',
                                projectDirectory: path,
                                lifecycle: 'running',
                                mode: entry.mode,
                            }),
                        );
                        return success();
                    },
                    stop: async () => success(),
                    stopProject: async () => {
                        engine.stops++;
                        if (engine.failStop)
                            throw new Error('Fixture Stop failed');
                        actual!.containers = [];
                        return success();
                    },
                    containerAction: async (action) => {
                        if (action === 'stop')
                            actual!.containers = actual!.containers.map(
                                (c) => ({
                                    ...c,
                                    lifecycle: 'exited',
                                    exitCode: 0,
                                }),
                            );
                        return success();
                    },
                    reload: async () => success(),
                    logs: async () => ['fixture log'],
                    probe: async () => {
                        engine.probes++;
                    },
                    monitor: async () => {
                        engine.monitors++;
                    },
                };
                const controller = new LiveController({
                    runtime,
                    explicitStart: true,
                    initialIntent: intent,
                    configuration: { read: async () => revision() },
                    preparation: {
                        check: async () => {},
                        resolve,
                        prepare: async () => ({
                            protocolVersion: 1,
                            composeFiles: [],
                            environmentRequirements: [],
                            ...(await resolve()),
                        }),
                    },
                    verifyAws: async () => ({ state: 'active' }),
                    lock: { acquire: async () => async () => {} },
                    clock: {
                        now: () => new Date(),
                    },
                });
                currentController = controller;
                const backend: BackendSession = {
                    project,
                    groups,
                    controller,
                    runtime: {
                        id: 'docker',
                        name: 'Fixture Docker',
                        capabilities: {
                            apply: true,
                            inspect: true,
                            logs: true,
                            registryLogin: true,
                        },
                        inspect: async () =>
                            Object.fromEntries(
                                actual!.containers.map((c) => [
                                    c.service,
                                    c.lifecycle === 'running'
                                        ? 'Running'
                                        : 'Stopped',
                                ]),
                            ),
                        checkAvailability: runtime.checkAvailability,
                        loginRegistry: async () => ({
                            outcome: 'success',
                            message: 'Logged in',
                        }),
                    },
                    manager,
                    readConfiguration: async () => ({
                        details: {
                            api: {
                                ...resolveServiceState(
                                    actual!.selections,
                                    groups,
                                ).api,
                                enabled: actual!.enabled ? 'Yes' : 'No',
                            },
                        },
                        revision: revision().identity,
                        error: '',
                    }),
                    save: async (edit, expected) => {
                        if (expected !== revision().identity)
                            throw new Error('Configuration changed');
                        actual!.enabled = edit.enabled;
                        actual!.selections.services = edit.enabled
                            ? ['api']
                            : [];
                        actual!.selections.excludedServices = edit.enabled
                            ? []
                            : ['api'];
                        actual!.selections.servicesWithLiveUpdate =
                            edit.development ? ['api'] : [];
                        if (edit.provider)
                            actual!.selections.serviceProviders = {
                                api: edit.provider,
                            };
                        if (edit.mockScenario)
                            actual!.selections.mockScenarios = {
                                api: edit.mockScenario,
                            };
                        if (edit.image === null)
                            delete actual!.selections.serviceImages?.api;
                        else if (edit.image !== undefined)
                            actual!.selections.serviceImages = {
                                api: edit.image,
                            };
                        if (edit.versionSource === null)
                            delete actual!.selections.serviceVersionSources
                                ?.api;
                        else if (edit.versionSource !== undefined)
                            actual!.selections.serviceVersionSources = {
                                api: edit.versionSource,
                            };
                        actual!.revision++;
                    },
                    saveJourney: async (input) => ({
                        path: await saveJourney(path, {
                            name: input.name,
                            services: input.services,
                            lazy: input.lazy,
                        }),
                    }),
                    journeys: () => listJourneys(path),
                    configurationSnapshot: async () => ({
                        revision: revision().identity,
                        selections: projectSelections(actual!.selections),
                    }),
                    saveLegacy: async (edit, expected) => {
                        if (expected !== revision().identity)
                            throw new Error('Configuration changed');
                        const next = editSelections(
                            actual!.selections,
                            edit,
                            groups,
                        );
                        await engine.legacySaveGate;
                        actual!.selections = next;
                        actual!.enabled =
                            resolveServiceState(next, groups).api.enabled ===
                            'Yes';
                        actual!.revision++;
                        return {
                            revision: revision().identity,
                            selections: next,
                        };
                    },
                    close: () => controller.shutdown(),
                };
                options.configure?.(backend);
                return backend;
            },
            aws: async () => ({ state: 'active' }),
            discovery: async () => ({
                profiles: [],
                registries: [],
                unmatched: [],
                recommended: [],
                warnings: [],
            }),
            login: async (_backend, _action, signal, run) =>
                run({
                    command: 'fixture',
                    args: [],
                    label: 'Fixture login',
                    missingMessage: 'Missing fixture',
                    signal,
                    environment: {},
                }),
            clone: async () => ({ outcome: 'success', message: 'Cloned' }),
            cloneDestination: async () => undefined,
            defaultDestination: async () => second,
            search: async (update) =>
                update({
                    found: [{ directory: second, valid: true, message: '' }],
                    visited: 1,
                    searching: false,
                    truncated: false,
                }),
            diagnostics: () => ({
                lines: [],
                sequence: 0,
                failure: '',
                path: '',
            }),
        };
        const interactions = new Interactions(
            terminal ??
                (async () => {
                    throw new Error('No fixture terminal');
                }),
            () => app?.changed(),
            randomUUID,
        );
        app = new ProjectSession(host, interactions);
        operations = new Operations(
            state,
            () => app.changed(),
            options.completed,
        );
        app.operations = operations;
        await operations.initialize();
        await app.initialize();
        api = await listenApi(join(root, 'api.sock'), app, operations);
    };
    await start();
    const clients: Client[] = [];
    const disconnect = () => {
        for (const client of clients) client.close();
        clients.length = 0;
    };
    const stop = async () => {
        disconnect();
        await operations.close();
        await app.close();
        await api.close();
    };
    return {
        root,
        directory,
        second,
        engine,
        stores,
        get controller() {
            return currentController;
        },
        get app() {
            return app;
        },
        get operations() {
            return operations;
        },
        client: async () => {
            const client = await new Client(join(root, 'api.sock')).connect();
            clients.push(client);
            return client;
        },
        disconnect,
        reconnectTransport: async () => {
            await api.close();
            api = await listenApi(join(root, 'api.sock'), app, operations);
        },
        restart: async (newLogin = false) => {
            await stop();
            if (newLogin) hostSession = 'login-b';
            await start();
        },
        close: async () => {
            await stop();
            await rm(root, { recursive: true, force: true });
        },
    };
}
export async function eventually(check: () => boolean, timeout = 5000) {
    const until = Date.now() + timeout;
    while (!check()) {
        if (Date.now() > until)
            throw new Error('Condition did not become true');
        await new Promise((resolve) => {
            setTimeout(resolve, 20);
        });
    }
}
