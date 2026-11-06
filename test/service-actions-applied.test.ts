import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringify } from 'yaml';
import { daemonFixture, eventually } from './daemon-fixture.js';
import { DockerLiveRuntime } from '../src/infrastructure/live-runtime.js';
import type { RuntimeContainer } from '../src/domain/live.js';

async function fixture(mode: 'Mock' | 'Development', failService?: string) {
    const commands: string[][] = [];
    const file = '/state/operations/applied/docker-compose.yaml';
    const helper = mode === 'Mock' ? 'chs-dev-microcks' : 'api-builder';
    const dependencies =
        mode === 'Mock'
            ? { 'chs-dev-microcks': { condition: 'service_healthy' } }
            : {
                  'api-builder': {
                      condition: 'service_completed_successfully',
                  },
                  database: { condition: 'service_healthy' },
              };
    const artifact = stringify({
        name: 'fixture',
        services: {
            api: {
                image: 'api:applied',
                depends_on: dependencies,
                labels: { 'chs.dev.owner-service': 'api' },
            },
            [helper]: {
                image: 'helper:applied',
                labels: {
                    'chs.dev.owner-service':
                        mode === 'Development' ? 'api' : helper,
                },
            },
            database: { image: 'database:applied' },
        },
    });
    const adapter = new DockerLiveRuntime(
        {
            get directory() {
                return f.directory;
            },
            projectName: 'fixture',
            realpath: async (path) => path,
            environment: { resolve: async () => ({}) },
            execute: async ({ args }) => {
                commands.push(args);
                const containers = f.stores.get(f.directory)!.containers;
                let stdout = '';
                if (args[0] === 'ps')
                    stdout = containers
                        .map((container) => container.id)
                        .join('\n');
                if (args[0] === 'inspect')
                    stdout = JSON.stringify(
                        containers
                            .filter((container) => args.includes(container.id))
                            .map((container) => ({
                                Id: container.id,
                                Config: {
                                    Labels: {
                                        'com.docker.compose.project': 'fixture',
                                        'com.docker.compose.project.working_dir':
                                            f.directory,
                                        'com.docker.compose.project.config_files':
                                            file,
                                        'com.docker.compose.service':
                                            container.service,
                                        'chs.dev.owner-service':
                                            container.ownerService ??
                                            container.service,
                                        'chs.dev.lifecycle': JSON.stringify(
                                            container.policy,
                                        ),
                                    },
                                },
                                State: {
                                    Status: container.lifecycle,
                                    ExitCode: container.exitCode,
                                    Health: container.health
                                        ? { Status: container.health }
                                        : undefined,
                                },
                            })),
                    );
                if (['start', 'restart', 'stop'].includes(args[0]!)) {
                    for (const container of containers)
                        if (args.includes(container.id))
                            container.lifecycle =
                                args[0] === 'stop' ? 'exited' : 'running';
                }
                if (args[0] === 'compose' && args.includes('up')) {
                    assert.ok(
                        args.includes(file),
                        'engine execution must use the applied artifact',
                    );
                    assert.equal(
                        args.includes('--no-deps'),
                        false,
                        'Compose owns prerequisite readiness',
                    );
                    if (failService && args.includes(failService))
                        return {
                            code: 1,
                            stdout: '',
                            stderr: 'Requested fixture service could not start',
                        };
                    const needed =
                        mode === 'Mock'
                            ? ['api', 'chs-dev-microcks']
                            : ['database', 'api-builder', 'api'];
                    for (const container of containers) {
                        if (!needed.includes(container.service)) continue;
                        container.lifecycle =
                            container.service === 'api-builder'
                                ? 'exited'
                                : 'running';
                        container.exitCode =
                            container.service === 'api-builder' ? 0 : undefined;
                        container.health =
                            container.service === 'database'
                                ? 'healthy'
                                : undefined;
                    }
                }
                return { code: 0, stdout, stderr: '' };
            },
        },
        {
            directory: '/state/operations',
            read: async (path) => {
                assert.equal(path, file);
                return artifact;
            },
        },
    );
    const f = await daemonFixture(undefined, undefined, {
        configure(backend) {
            const group = backend.groups[0]!;
            group.services.push('database');
            group.definitions!.api.dependencies = ['database'];
            group.definitions!.database = {
                module: 'fixture',
                base: false,
                dependencies: [],
                development: false,
            };
        },
        runtime: (base) => ({
            ...base,
            containerAction: adapter.containerAction.bind(adapter),
            startApplied: adapter.startApplied.bind(adapter),
            reloadApplied: adapter.reloadApplied.bind(adapter),
        }),
    });
    const client = await f.client();
    await client.command('environment.start', {});
    const store = f.stores.get(f.directory)!;
    const make = (
        service: string,
        digit: string,
        ownerService?: string,
    ): RuntimeContainer => ({
        id: digit.repeat(12),
        service,
        mode: service === 'api' ? mode : 'Service',
        projectName: 'fixture',
        projectDirectory: f.directory,
        lifecycle: 'exited',
        ...(ownerService ? { ownerService } : {}),
        policy: {
            version: 1,
            lazy: false,
            reclaimable: false,
            dependencies: [],
        },
    });
    store.containers = [
        make('api', 'a'),
        make(helper, 'b', mode === 'Development' ? 'api' : undefined),
        make('database', 'c'),
    ];
    store.containers[0]!.policy!.dependencies = Object.keys(dependencies);
    await f.controller.probe();
    return { f, client, commands, store };
}

test('manual Start uses applied Mock dependencies and preserves an unrelated real database hold', async (t) => {
    const { f, client, commands, store } = await fixture('Mock');
    t.after(() => f.close());
    store.containers.find(
        (container) => container.service === 'database',
    )!.lifecycle = 'running';
    await client.command('service.action', {
        services: ['database'],
        action: 'stop',
    });
    assert.equal(
        (
            await client.command('service.action', {
                services: ['api'],
                action: 'start',
            })
        ).ok,
        true,
    );
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .lifecycle,
        'exited',
    );
    assert.equal(
        store.containers.find(
            (container) => container.service === 'chs-dev-microcks',
        )!.lifecycle,
        'running',
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['database']);
    assert.equal(
        commands.some((args) => args[0] === 'start'),
        false,
    );
    assert.equal(f.engine.applies, 1);
});

test('manual Development Start delegates builder completion and dependency health to applied Compose', async (t) => {
    const { f, client, commands, store } = await fixture('Development');
    t.after(() => f.close());
    assert.equal(
        (
            await client.command('service.action', {
                services: ['api'],
                action: 'start',
            })
        ).ok,
        true,
    );
    const up = commands.find(
        (args) => args[0] === 'compose' && args.includes('up'),
    );
    assert.ok(up);
    assert.equal(up.includes('--no-deps'), false);
    assert.equal(up.includes('--no-recreate'), true);
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .health,
        'healthy',
    );
    assert.equal(
        store.containers.find(
            (container) => container.service === 'api-builder',
        )!.exitCode,
        0,
    );
    assert.equal(
        store.containers.find((container) => container.service === 'api')!
            .lifecycle,
        'running',
    );
});

test('manual Restart starts its applied prerequisites and recreates logical owner helpers without refreshing images', async (t) => {
    const { f, client, commands, store } = await fixture('Development');
    t.after(() => f.close());
    store.containers[0]!.lifecycle = 'running';
    store.containers.find(
        (container) => container.service === 'database',
    )!.lifecycle = 'running';
    await client.command('service.action', {
        services: ['database'],
        action: 'stop',
    });
    assert.equal(
        (
            await client.command('service.action', {
                services: ['api'],
                action: 'restart',
            })
        ).ok,
        true,
    );
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .lifecycle,
        'running',
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    const up = commands.find(
        (args) => args[0] === 'compose' && args.includes('up'),
    )!;
    assert.ok(up.includes('--force-recreate'));
    assert.ok(up.includes('api-builder'));
    assert.ok(up.includes('--no-build'));
    assert.equal(up[up.indexOf('--pull') + 1], 'never');
});

test('generated service aliases normalize to the logical owner for manual holds and activation', async (t) => {
    const { f, client, store } = await fixture('Development');
    t.after(() => f.close());
    assert.equal(
        (
            await client.command('service.action', {
                services: ['api-builder'],
                action: 'stop',
            })
        ).ok,
        true,
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    assert.equal(
        (
            await client.command('service.action', {
                services: ['api-builder'],
                action: 'start',
            })
        ).ok,
        true,
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal(
        store.containers.find((container) => container.service === 'api')!
            .lifecycle,
        'running',
    );
});

test('every requested logical root is validated before any applied service starts', async (t) => {
    const { f, client, commands, store } = await fixture('Mock');
    t.after(() => f.close());
    await assert.rejects(
        client.command('service.action', {
            services: ['api', 'missing'],
            action: 'start',
        }),
        /missing/,
    );
    assert.equal(
        commands.some((args) => args.includes('up') || args[0] === 'start'),
        false,
    );
    assert.equal(store.containers[0]!.lifecycle, 'exited');
});

test('a later failed root reports partial effects after an earlier root started their shared dependencies', async (t) => {
    const { f, client, store } = await fixture('Development', 'database');
    t.after(() => f.close());
    for (const container of store.containers) container.lifecycle = 'running';
    await client.command('service.action', {
        services: ['api', 'database'],
        action: 'stop',
    });
    await assert.rejects(
        client.command('service.action', {
            services: ['api', 'database'],
            action: 'start',
        }),
        /could not start/,
    );
    assert.equal(
        store.containers.find((container) => container.service === 'api')!
            .lifecycle,
        'running',
    );
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .lifecycle,
        'running',
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.match(
        f.controller.getSnapshot().logs.at(-1)!,
        /some services may already have changed/,
    );
});

test('clean recovery starts only applied roots with generated dependencies and stops historical orphan helpers', async (t) => {
    const { f, store, commands } = await fixture('Development');
    t.after(() => f.close());
    store.containers.find(
        (container) => container.service === 'api-builder',
    )!.kind = 'job';
    store.containers.push({
        ...store.containers[1]!,
        id: 'd'.repeat(12),
        service: 'old-api-builder',
        lifecycle: 'running',
    });
    store.enabled = false;
    store.revision++;
    await f.restart(true);
    await eventually(
        () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
    );
    const starts = commands.filter(
        (args) => args[0] === 'compose' && args.includes('up'),
    );
    assert.equal(starts.length, 1);
    assert.equal(starts[0].includes('--no-build'), true);
    assert.equal(starts[0].includes('--pull'), true);
    assert.equal(starts[0].includes('never'), true);
    assert.equal(starts[0].includes('--no-deps'), false);
    assert.equal(starts[0].at(-1), 'api');
    assert.equal(
        store.containers.find((container) => container.service === 'api')!
            .lifecycle,
        'running',
    );
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .health,
        'healthy',
    );
    assert.equal(
        store.containers.find(
            (container) => container.service === 'api-builder',
        )!.exitCode,
        0,
    );
    assert.equal(
        store.containers.find(
            (container) => container.service === 'old-api-builder',
        )!.lifecycle,
        'exited',
    );
    assert.equal(f.engine.applies, 1);
    assert.equal(f.app.snapshot().live.running, true);
});

test('clean recovery retains the generated Mock runtime absent from logical applied inventory', async (t) => {
    const { f, store, commands } = await fixture('Mock');
    t.after(() => f.close());
    await f.restart(true);
    await eventually(
        () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
    );
    const starts = commands.filter(
        (args) => args[0] === 'compose' && args.includes('up'),
    );
    assert.equal(starts.length, 1);
    assert.equal(starts[0].at(-1), 'api');
    assert.deepEqual(f.controller.getIntent().appliedServices, ['api']);
    assert.equal(
        store.containers.find(
            (container) => container.service === 'chs-dev-microcks',
        )!.lifecycle,
        'running',
    );
    assert.equal(
        store.containers.find((container) => container.service === 'database')!
            .lifecycle,
        'exited',
    );
    assert.equal(f.app.snapshot().live.running, true);
});
