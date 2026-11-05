import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    translate,
    duration,
    ComposeDefinitionCompiler,
} from '../src/infrastructure/native/compiler.js';
import {
    dependencyOrder,
    planProject,
    executeGraph,
} from '../src/domain/orchestration.js';
import {
    containerBody,
    desktopLabels,
    decodeLogs,
    DockerHttpClient,
    resolveDockerConnection,
} from '../src/infrastructure/native/docker.js';
import { resolveSettings } from '../src/domain/settings.js';
import { selectRuntime } from '../src/infrastructure/runtimes/select-runtime.js';
import type { PreparedProject } from '../src/domain/live.js';
import { NativeState } from '../src/infrastructure/native/state.js';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProcessExecutor } from '../src/infrastructure/live-process.js';
import { createServer } from 'node:http';
const prepared: PreparedProject = {
    protocolVersion: 1,
    projectName: 'test',
    projectDirectory: '/project',
    configurationIdentity: 'revision',
    composeFiles: ['/state/compose.yaml'],
    inventory: [],
    environmentRequirements: [],
};
const document = () => ({
    services: {
        db: {
            image: 'alpine',
            healthcheck: { test: ['CMD', 'true'], start_interval: '2s' },
        },
        job: {
            image: 'alpine',
            depends_on: { db: { condition: 'service_healthy' } },
        },
        app: {
            image: 'alpine',
            entrypoint: ['sh', '-c'],
            command: ['echo "$X"'],
            environment: { X: 'hello\nworld' },
            depends_on: {
                job: { condition: 'service_completed_successfully' },
                db: { condition: 'service_healthy', restart: true },
            },
        },
    },
    networks: { default: {} },
});

test('orchestration selection keeps existing settings on Compose and never falls back', () => {
    assert.equal(resolveSettings({}, {}).orchestrator.value, 'compose');
    assert.equal(
        resolveSettings(
            { orchestrator: 'compose' },
            { CHS_DEV_ORCHESTRATOR: 'native' },
        ).orchestrator.value,
        'native',
    );
    assert.equal(selectRuntime('docker', 'native').name, 'Docker / Native');
    assert.throws(() => selectRuntime('docker', 'other'), /Unsupported/);
});
test('translation preserves argument arrays, dependency types and execution details', () => {
    const project = translate(document(), prepared);
    const app = project.services.app;
    assert.equal(project.services.job.kind, 'job');
    assert.equal(app.kind, 'service');
    assert.deepEqual(dependencyOrder(project.services), ['db', 'job', 'app']);
    assert.equal(duration('1m30s'), 90e9);
    assert.equal(project.services.db.health?.startInterval, 2e9);
    const body = containerBody(project, app);
    assert.deepEqual(body.Entrypoint, ['sh', '-c']);
    assert.deepEqual(body.Cmd, ['echo "$X"']);
    assert.deepEqual(body.Env, ['X=hello\nworld']);
    assert.deepEqual(
        containerBody(project, project.services.db).Healthcheck?.Test,
        ['CMD', 'true'],
    );
    assert.deepEqual(desktopLabels(project, app.name), {
        'com.docker.compose.project': `test-native-${project.namespace.slice(-12)}`,
        'com.docker.compose.service': 'app',
    });
    assert.equal(
        body.Labels['com.docker.compose.project'],
        desktopLabels(project, 'app')['com.docker.compose.project'],
    );
    assert.equal(body.Labels['com.docker.compose.service'], 'app');
    assert.equal(body.Labels['com.docker.compose.config-hash'], undefined);
    assert.equal(
        body.Labels['com.docker.compose.project.working_dir'],
        undefined,
    );
    assert.equal(body.Labels['chs.dev.backend'], 'native');
});
test('extra hosts normalize Compose list and mapping output for the Engine API', () => {
    const expected = [
        'account.chs.local:host-gateway',
        'legacy.chs.local:127.0.0.1',
        'ipv6.chs.local:::1',
        'multiple.chs.local:192.0.2.1',
        'multiple.chs.local:2001:db8::1',
    ];
    for (const hosts of [
        [
            'account.chs.local=host-gateway',
            'legacy.chs.local:127.0.0.1',
            'ipv6.chs.local=[::1]',
            'multiple.chs.local=192.0.2.1',
            'multiple.chs.local:2001:db8::1',
        ],
        {
            'account.chs.local': 'host-gateway',
            'legacy.chs.local': '127.0.0.1',
            'ipv6.chs.local': ['::1'],
            'multiple.chs.local': ['192.0.2.1', '2001:db8::1'],
        },
    ]) {
        const project = translate(
            { services: { app: { image: 'alpine', extra_hosts: hosts } } },
            prepared,
        );
        assert.deepEqual(
            containerBody(project, project.services.app).HostConfig.ExtraHosts,
            expected,
        );
    }
});
test('invalid extra hosts fail compilation with service and definition context', () => {
    for (const hosts of [
        ['account.chs.local'],
        ['account.chs.local=not-an-ip'],
        ['=127.0.0.1'],
        ['bad host=127.0.0.1'],
        [123],
        { 'account.chs.local': 123 },
        'account.chs.local=host-gateway',
    ]) {
        assert.throws(
            () =>
                translate(
                    {
                        services: {
                            app: { image: 'alpine', extra_hosts: hosts },
                        },
                    },
                    {
                        ...prepared,
                        sources: { app: '/services/app.yaml' },
                    },
                ),
            /\/services\/app.yaml: app.extra_hosts: expected hostname=IP/,
        );
    }
});
test('Docker errors include the daemon response detail', async () => {
    const socketDirectory = await mkdtemp(
        join(tmpdir(), 'chs-dev-docker-error-'),
    );
    const socket = join(socketDirectory, 'docker.sock');
    const server = createServer((_request, response) => {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'application/json');
        response.end(
            JSON.stringify({
                message:
                    'invalid mount config for type "bind": bind source path does not exist',
            }),
        );
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
    });
    try {
        await assert.rejects(
            new DockerHttpClient(socket).call(
                'POST',
                '/containers/create?name=test',
                {},
            ),
            (error: unknown) =>
                error instanceof Error &&
                error.message ===
                    'Docker POST /containers/create failed (HTTP 400): invalid mount config for type "bind": bind source path does not exist',
        );
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await rm(socketDirectory, { recursive: true, force: true });
    }
});
test('Docker errors normalize and bound plain-text response detail', async () => {
    const socketDirectory = await mkdtemp(
        join(tmpdir(), 'chs-dev-docker-error-'),
    );
    const socket = join(socketDirectory, 'docker.sock');
    const server = createServer((_request, response) => {
        response.statusCode = 400;
        response.end(`plain Docker error\n${'x'.repeat(1200)}`);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
    });
    try {
        await assert.rejects(
            new DockerHttpClient(socket).call('POST', '/containers/create', {}),
            (error: unknown) =>
                error instanceof Error &&
                error.message.startsWith(
                    'Docker POST /containers/create failed (HTTP 400): plain Docker error ',
                ) &&
                error.message.length <=
                    'Docker POST /containers/create failed (HTTP 400): '
                        .length +
                        1000,
        );
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await rm(socketDirectory, { recursive: true, force: true });
    }
});
test('unknown executable fields and external resources are rejected with context', () => {
    assert.throws(
        () =>
            translate(
                { services: { app: { image: 'app', privileged: true } } },
                prepared,
            ),
        /app.*unsupported field privileged/,
    );
    assert.throws(
        () =>
            translate(
                {
                    services: { app: { image: 'app' } },
                    volumes: { data: { external: true } },
                },
                prepared,
            ),
        /volumes.data.*external/,
    );
    assert.throws(
        () =>
            translate(
                {
                    services: {
                        a: {
                            image: 'app',
                            depends_on: { b: { condition: 'service_started' } },
                        },
                        b: {
                            image: 'app',
                            depends_on: { a: { condition: 'service_started' } },
                        },
                    },
                },
                prepared,
            ),
        /a -> b -> a/,
    );
});
test('planner retains jobs, replaces changed services and propagates restarts', () => {
    const project = translate(document(), prepared);
    for (const s of Object.values(project.services)) s.fingerprint = 'same';
    const containers = Object.values(project.services).map((s) => ({
        service: s.name,
        id: s.name,
        projectName: 'test',
        projectDirectory: '/project',
        kind: s.kind,
        configurationIdentity: 'same',
        lifecycle: s.kind === 'job' ? 'exited' : 'running',
        exitCode: 0,
    }));
    assert.ok(
        planProject(project, containers).actions.every(
            (a) => a.action === 'keep',
        ),
    );
    project.services.db.fingerprint = 'changed';
    assert.deepEqual(
        planProject(project, containers).actions.map((a) => [
            a.service,
            a.action,
        ]),
        [
            ['db', 'replace'],
            ['job', 'keep'],
            ['app', 'restart'],
        ],
    );
    containers.find((c) => c.service === 'app')!.lifecycle = 'exited';
    assert.equal(
        planProject(project, containers).actions.find(
            (a) => a.service === 'app',
        )?.action,
        'start',
    );
});
test('planner marks deferred services without planning a start', () => {
    const project = translate(document(), prepared);
    for (const s of Object.values(project.services)) s.fingerprint = 'same';
    const plan = planProject(project, [], { deferred: ['app'] });
    const app = plan.actions.find((a) => a.service === 'app')!;
    assert.equal(app.deferred, true);
    assert.equal(app.action, 'create');
    assert.equal(
        plan.actions.find((a) => a.service === 'db')?.deferred,
        undefined,
    );
});

test('scheduler observes dependencies, caps concurrency and settles in-flight work on failure', async () => {
    const events: string[] = [];
    let running = 0,
        max = 0;
    await executeGraph(
        ['a', 'b', 'c'].map((id) => ({
            id,
            dependencies: id === 'c' ? ['a', 'b'] : [],
            run: async () => {
                running++;
                max = Math.max(max, running);
                await new Promise((r) => {
                    setTimeout(r, 5);
                });
                events.push(id);
                running--;
            },
        })),
        2,
    );
    assert.equal(max, 2);
    assert.equal(events.at(-1), 'c');
    await assert.rejects(
        executeGraph([
            {
                id: 'bad',
                dependencies: [],
                run: async () => {
                    throw new Error('bad');
                },
            },
            {
                id: 'waiting',
                dependencies: ['bad'],
                run: async () => {
                    throw new Error('must not run');
                },
            },
        ]),
        /bad/,
    );
});
test('Docker contexts are pinned and remote contexts fail explicitly', async () => {
    const requests: any[] = [];
    const execute = async (request: any) => {
        requests.push(request);
        return {
            code: 0,
            stdout: JSON.stringify([
                { Endpoints: { docker: { Host: 'unix:///tmp/docker.sock' } } },
            ]),
            stderr: '',
        };
    };
    const connection = await resolveDockerConnection(execute, '/project', {
        DOCKER_HOST: 'ssh://remote',
        DOCKER_CONTEXT: 'desktop',
    });
    assert.equal(connection.socket, '/tmp/docker.sock');
    assert.equal(connection.environment.DOCKER_CONTEXT, undefined);
    assert.equal(connection.environment.DOCKER_HOST, 'unix:///tmp/docker.sock');
    await assert.rejects(
        resolveDockerConnection(execute, '/project', {
            DOCKER_HOST: 'ssh://remote',
        }),
        /local Unix/,
    );
});
test('private compiler output is captured without emitting secrets or stderr', async () => {
    const output: string[] = [];
    const execute = createProcessExecutor();
    const result = await execute({
        command: process.execPath,
        args: ['-e', `console.log('a-secret');console.error('another-secret')`],
        cwd: process.cwd(),
        env: process.env,
        privateOutput: true,
        captureStdout: true,
        onOutput: (e) => output.push(e.text),
    });
    assert.equal(result.stdout.trim(), 'a-secret');
    assert.equal(result.stderr, '');
    assert.deepEqual(output, []);
    let request: any;
    const compiler = new ComposeDefinitionCompiler(async (r) => {
        request = r;
        return { code: 0, stdout: JSON.stringify(document()), stderr: '' };
    });
    await compiler.compile(prepared, { environment: { SECRET: 'value' } });
    assert.equal(request.privateOutput, true);
    assert.ok(request.args.includes('config'));
    assert.ok(!request.args.includes('up'));
});
test('fingerprints are deterministic, ignore provenance and change with effective environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-native-unit-'));
    try {
        const state = new NativeState(directory);
        await state.initialize();
        const spec = translate(document(), prepared).services.app;
        const first = await state.fingerprint(spec);
        spec.source = '/different/source';
        assert.equal(await state.fingerprint(spec), first);
        spec.environment.X = 'changed';
        assert.notEqual(await state.fingerprint(spec), first);
        assert.ok(!first.includes('hello'));
        const state2 = new NativeState(directory);
        await state2.initialize();
        assert.equal(
            await state2.fingerprint(spec),
            await state.fingerprint(spec),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('Docker multiplexed output is decoded without frame bytes', () => {
    const payload = Buffer.from('hello\n');
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(payload.length, 4);
    assert.deepEqual(decodeLogs(Buffer.concat([header, payload])), ['hello']);
    assert.deepEqual(decodeLogs(payload), ['hello']);
});

test('native strategy shares a session across symlinked project paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chs-native-alias-'));
    try {
        const alias = root + '-alias';
        await symlink(root, alias);
        try {
            const strategy = selectRuntime('docker', 'native');
            assert.equal(
                strategy.live!({ directory: root }),
                strategy.live!({ directory: alias }),
            );
        } finally {
            await rm(alias);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('manifest references stay tied to the requested repository', async () => {
    const { immutableImageReference } =
        await import('../src/infrastructure/native/docker-adapter.js');
    assert.equal(
        immutableImageReference(
            {
                Id: 'selected',
                RepoDigests: ['unrelated@sha256:other', 'alpine@sha256:index'],
            },
            'docker.io/library/alpine:3.22',
        ),
        'alpine@sha256:index',
    );
    assert.equal(
        immutableImageReference({ Id: 'local' }, 'local:dev'),
        'local',
    );
});
