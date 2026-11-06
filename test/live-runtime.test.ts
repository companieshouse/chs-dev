import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DockerLiveRuntime,
    composeArguments,
    ecrAuthorizationFailure,
} from '../src/infrastructure/live-runtime.js';
import {
    createProcessExecutor,
    type ProcessRequest,
} from '../src/infrastructure/live-process.js';
import { LiveEnvironment } from '../src/infrastructure/live-environment.js';
import {
    configurationStore,
    projectLock,
    liveFiles,
    type LiveFiles,
} from '../src/infrastructure/live-files.js';
import type { PreparedProject } from '../src/domain/live.js';
import { initializeTuiLog } from '../src/infrastructure/tui-log.js';

const project: PreparedProject = {
    protocolVersion: 1,
    projectName: 'chs',
    projectDirectory: '/checkout',
    configurationIdentity: 'one',
    composeFiles: ['/operation/compose.yaml'],
    inventory: [{ service: 'api', mode: 'Service' }],
    environmentRequirements: ['AWS_ACCESS_KEY_ID'],
};
const id = 'a'.repeat(64);
const inspect = (overrides: Record<string, string> = {}) => ({
    Id: id,
    Config: {
        Labels: {
            'com.docker.compose.project': 'chs',
            'com.docker.compose.project.working_dir': '/checkout',
            'com.docker.compose.service': 'api',
            'chs.dev.mode': 'Service',
            ...overrides,
        },
    },
    State: {
        Status: 'running',
        Health: { Status: 'unhealthy' },
        ExitCode: 0,
    },
});
function runtimeFixture() {
    const requests: ProcessRequest[] = [];
    const requirements: readonly string[][] = [];
    let inspections = [inspect()];
    let failure = '';
    let artifact =
        'name: chs\nservices:\n  api:\n    image: api:applied\n    depends_on:\n      seed:\n        condition: service_completed_successfully\n  seed:\n    image: seed:applied\n';
    let composeServices = { api: {}, worker: {} } as Record<string, object>;
    const runtime = new DockerLiveRuntime(
        {
            directory: '/checkout',
            projectName: 'chs',
            realpath: async (path) => {
                if (path === '/missing')
                    throw Object.assign(new Error('missing'), {
                        code: 'ENOENT',
                    });
                return path;
            },
            environment: {
                resolve: async (names) => {
                    (requirements as string[][]).push([...names]);
                    return { PATH: '/tools', AWS_ACCESS_KEY_ID: 'in-memory' };
                },
            },
            execute: async (request) => {
                requests.push(request);
                if (request.args[0] === 'ps')
                    return { code: 0, stdout: id, stderr: '' };
                if (request.args[0] === 'logs') {
                    request.onOutput?.({ stream: 'stdout', text: 'api ready' });
                    request.onOutput?.({
                        stream: 'stderr',
                        text: 'api warning',
                    });
                    return { code: 0, stdout: '', stderr: '' };
                }
                if (request.args[0] === 'inspect')
                    return {
                        code: 0,
                        stdout: JSON.stringify(inspections),
                        stderr: '',
                    };
                if (request.args.includes('json'))
                    return {
                        code: 0,
                        stdout: JSON.stringify({ services: composeServices }),
                        stderr: '',
                    };
                return { code: failure ? 1 : 0, stdout: '', stderr: failure };
            },
        },
        { directory: '/state/operations', read: async () => artifact },
    );
    return {
        runtime,
        artifact: (text: string) => {
            artifact = text;
        },
        composeServices: (services: Record<string, object>) => {
            composeServices = services;
        },
        requests,
        requirements,
        set: (next: typeof inspections) => {
            inspections = next;
        },
        fail: (message: string) => {
            failure = message;
        },
    };
}

test('Compose validates first and applies detached with explicit project files, no forced recreation or orphans', async () => {
    const f = runtimeFixture();
    await f.runtime.apply(project, {});
    assert.deepEqual(
        f.requests.map((request) => request.args),
        [
            [...composeArguments(project), 'config', '--quiet'],
            [...composeArguments(project), 'up', '--detach'],
        ],
    );
    assert.deepEqual(f.requirements, [
        ['AWS_ACCESS_KEY_ID'],
        ['AWS_ACCESS_KEY_ID'],
    ]);
    assert.ok(f.requests.every((request) => request.cwd === '/checkout'));
    assert.throws(
        () => composeArguments({ ...project, composeFiles: ['relative'] }),
        /invalid/,
    );
    await assert.rejects(
        f.runtime.apply({ ...project, projectName: 'foreign' }, {}),
        /does not belong/,
    );
});

test('Compose creates lazy services without starting them', async () => {
    const f = runtimeFixture();
    const lazyProject: PreparedProject = {
        ...project,
        inventory: [
            { service: 'api', mode: 'Service' },
            { service: 'worker', mode: 'Service', lazy: true },
        ],
    };
    await f.runtime.apply(lazyProject, {});
    assert.deepEqual(
        f.requests.map((request) =>
            request.args.slice(composeArguments(project).length),
        ),
        [
            ['config', '--quiet'],
            ['config', '--format', 'json'],
            ['up', '--detach', '--no-deps', 'api'],
            ['up', '--no-start', '--no-deps', 'worker'],
        ],
    );
});

test('Compose Apply leaves manually stopped services stopped while starting other configured services', async () => {
    const f = runtimeFixture();
    await f.runtime.apply(
        {
            ...project,
            inventory: [
                { service: 'api', mode: 'Service' },
                { service: 'worker', mode: 'Service' },
            ],
        },
        { stoppedServices: ['api'] },
    );
    assert.deepEqual(
        f.requests.map((request) =>
            request.args.slice(composeArguments(project).length),
        ),
        [
            ['config', '--quiet'],
            ['config', '--format', 'json'],
            ['up', '--detach', '--no-deps', 'worker'],
            ['up', '--no-start', '--no-deps', 'api'],
        ],
    );
    f.requests.length = 0;
    await f.runtime.apply(project, {});
    assert.deepEqual(
        f.requests.at(-1)?.args.slice(composeArguments(project).length),
        ['up', '--detach'],
    );
});

test('Compose Apply keeps a manually stopped Development service and its new builder stopped', async () => {
    const f = runtimeFixture();
    f.composeServices({
        api: { labels: { 'chs.dev.owner-service': 'api' } },
        'build-api': { labels: { 'chs.dev.owner-service': 'api' } },
        worker: { depends_on: { api: { condition: 'service_started' } } },
    });
    await f.runtime.apply(
        {
            ...project,
            inventory: [
                { service: 'api', mode: 'Development' },
                { service: 'worker', mode: 'Service' },
            ],
        },
        { stoppedServices: ['api'] },
    );
    const calls = f.requests.map((request) =>
        request.args.slice(composeArguments(project).length),
    );
    assert.deepEqual(calls.at(-2), ['up', '--detach', '--no-deps', 'worker']);
    assert.deepEqual(calls.at(-1), [
        'up',
        '--no-start',
        '--no-deps',
        'api',
        'build-api',
    ]);
    const listing = f.requests.find((request) => request.args.includes('json'));
    assert.equal(listing?.privateOutput, true);
});

test('reload rebuilds and force-recreates the service and its builder only', async () => {
    const f = runtimeFixture();
    f.set([
        inspect({
            'chs.dev.mode': 'Development',
            'chs.dev.owner-service': 'api',
            'com.docker.compose.project.config_files':
                '/state/operations/one/docker-compose.yaml',
            'chs.dev.lifecycle':
                '{"version":1,"lazy":false,"reclaimable":false,"dependencies":[]}',
        }),
        {
            ...inspect({
                'com.docker.compose.service': 'api-builder',
                'chs.dev.mode': 'Development',
                'chs.dev.owner-service': 'api',
            }),
            Id: 'b'.repeat(64),
        },
        {
            ...inspect({ 'com.docker.compose.service': 'other' }),
            Id: 'c'.repeat(64),
        },
    ]);
    f.artifact(
        'name: chs\nservices:\n  api:\n    image: api:applied\n    environment:\n      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:?login}\n    depends_on:\n      api-builder:\n        condition: service_completed_successfully\n  api-builder:\n    image: builder:applied\n    labels:\n      chs.dev.owner-service: api\n',
    );
    const result = await f.runtime.reloadApplied('api', {});
    assert.deepEqual(result.affectedServices, ['api', 'api-builder']);
    assert.deepEqual(f.requests.at(-1)?.args, [
        ...composeArguments({
            ...project,
            composeFiles: ['/state/operations/one/docker-compose.yaml'],
        }),
        'up',
        '--detach',
        '--build',
        '--force-recreate',
        'api',
        'api-builder',
    ]);
    assert.deepEqual(f.requirements.at(-1), ['AWS_ACCESS_KEY_ID']);
    await assert.rejects(
        f.runtime.reloadApplied('missing', {}),
        /Apply configuration/,
    );
});

test('snapshot retains lifecycle/health/identity and excludes foreign directories, projects, and one-offs', async () => {
    const f = runtimeFixture();
    f.set([
        inspect(),
        inspect({ 'com.docker.compose.project': 'foreign' }),
        inspect({ 'com.docker.compose.project.working_dir': '/foreign' }),
        inspect({ 'com.docker.compose.project.working_dir': '/missing' }),
        inspect({ 'com.docker.compose.oneoff': 'True' }),
    ]);
    const snapshot = await f.runtime.snapshot();
    assert.equal(snapshot.containers.length, 1);
    assert.equal(snapshot.containers[0].health, 'unhealthy');
    assert.equal(snapshot.containers[0].exitCode, 0);
    assert.equal(snapshot.containers[0].lifecycle, 'running');
    assert.equal(snapshot.containers[0].mode, 'Service');
});

test('snapshot carries engine OOMKilled evidence and keeps absence unknown', async () => {
    const f = runtimeFixture();
    const killed = {
        ...inspect({ 'com.docker.compose.service': 'killed' }),
        Id: 'b'.repeat(64),
        State: { ...inspect().State, OOMKilled: true },
    };
    const survived = {
        ...inspect({ 'com.docker.compose.service': 'survived' }),
        Id: 'c'.repeat(64),
        State: {
            Status: 'exited',
            Health: { Status: 'none' },
            ExitCode: 137,
            OOMKilled: false,
        },
    };
    const unreported = {
        ...inspect({ 'com.docker.compose.service': 'unreported' }),
        Id: 'd'.repeat(64),
        State: { Status: 'exited', ExitCode: 137 },
    };
    f.set([inspect(), killed, survived, unreported]);
    const snapshot = await f.runtime.snapshot();
    assert.deepEqual(
        snapshot.containers.map((container) => container.oomKilled),
        [undefined, true, false, undefined],
    );
    assert.equal(
        snapshot.containers.find(
            (container) => container.service === 'unreported',
        )?.exitCode,
        137,
    );
});

test('stop re-verifies exact container IDs and never acquires credentials or uses Compose', async () => {
    const f = runtimeFixture();
    const actual = await f.runtime.snapshot();
    await f.runtime.stop(actual.containers, {});
    assert.deepEqual(f.requests.at(-1)?.args, ['stop', id]);
    assert.ok(f.requirements.every((names) => names.length === 0));
    const stopCount = f.requests.filter(
        (request) => request.args[0] === 'stop',
    ).length;
    f.set([inspect({ 'com.docker.compose.project.working_dir': '/foreign' })]);
    await f.runtime.stop(actual.containers, {});
    assert.equal(
        f.requests.filter((request) => request.args[0] === 'stop').length,
        stopCount,
    );
});

test('stopping the project stops and removes only containers, never volumes', async () => {
    const f = runtimeFixture();
    const stopped = inspect();
    stopped.State = {
        Status: 'exited',
        Health: { Status: 'none' },
        ExitCode: 0,
    };
    const other = 'b'.repeat(64);
    f.set([inspect(), { ...stopped, Id: other }]);
    const result = await f.runtime.stopProject({});
    assert.equal(result.outcome, 'success');
    assert.deepEqual(
        f.requests
            .filter((request) => !['ps', 'inspect'].includes(request.args[0]!))
            .map((request) => request.args),
        [
            ['stop', id],
            ['rm', id, other],
        ],
    );
    assert.ok(
        f.requests
            .filter((request) => !['ps', 'inspect'].includes(request.args[0]!))
            .map((request) => request.args)
            .every(
                (args) => !args.includes('-v') && !args.includes('--volumes'),
            ),
    );
    assert.ok(f.requirements.every((names) => names.length === 0));
});

test('container actions and logs use re-verified container IDs only', async () => {
    const f = runtimeFixture();
    const actual = await f.runtime.snapshot();
    for (const action of ['restart', 'stop', 'start'] as const) {
        await f.runtime.containerAction(action, actual.containers, {});
        assert.deepEqual(f.requests.at(-1)?.args, [action, id]);
    }
    assert.deepEqual(
        await f.runtime.logs(actual.containers[0]!, { tail: 50 }),
        ['api ready', 'api warning'],
    );
    assert.deepEqual(f.requests.at(-1)?.args, [
        'logs',
        '--tail',
        '50',
        '--timestamps',
        id,
    ]);
    f.set([inspect({ 'com.docker.compose.project.working_dir': '/foreign' })]);
    const count = f.requests.length;
    await f.runtime.containerAction('restart', actual.containers, {});
    assert.equal(
        f.requests
            .slice(count)
            .some((request) => request.args[0] === 'restart'),
        false,
    );
    await assert.rejects(
        f.runtime.logs(actual.containers[0]!, { tail: 50 }),
        /no longer exists/,
    );
});

test('validation failures prevent up; ECR failures are distinct', async () => {
    const f = runtimeFixture();
    f.fail('invalid Compose config');
    await assert.rejects(
        f.runtime.apply(project, {}),
        /Compose validation failed/,
    );
    assert.equal(f.requests.length, 1);
    f.fail('no basic auth credentials');
    await assert.rejects(
        f.runtime.apply(project, {}),
        (error: unknown) =>
            error instanceof Error && 'kind' in error && error.kind === 'ecr',
    );
    for (const stderr of [
        'failed to solve: 416670754337.dkr.ecr.eu-west-2.amazonaws.com/ci-node-build-24:latest: failed to resolve source metadata: unexpected status from HEAD request: 403 Forbidden',
        'Error response from daemon: pull access denied for 169942020521.dkr.ecr.eu-west-2.amazonaws.com/x: denied: Your authorization token has expired. Reauthenticate and try again.',
    ]) {
        f.fail(stderr);
        await assert.rejects(
            f.runtime.apply(project, {}),
            (error: unknown) =>
                error instanceof Error &&
                'kind' in error &&
                error.kind === 'ecr' &&
                /dkr\.ecr\.eu-west-2/.test(error.message) &&
                /ECR login profiles/.test(error.message),
        );
    }
});

test('environment provider exports AWS credentials only in returned process memory', async () => {
    const base = { PATH: '/tools' };
    const requests: ProcessRequest[] = [];
    const environment = new LiveEnvironment(
        async (request) => {
            requests.push(request);
            return {
                code: 0,
                stderr: '',
                stdout: JSON.stringify({
                    AccessKeyId: 'key',
                    SecretAccessKey: 'secret',
                    SessionToken: 'session',
                }),
            };
        },
        '/checkout',
        () => base,
        () => 'profile',
        memoryFiles(),
    );
    assert.deepEqual(await environment.resolve([]), {
        ...base,
        CHS_DEV_ROOT: '/checkout',
        AWS_PAGER: '',
        AWS_CLI_AUTO_PROMPT: 'off',
    });

    assert.equal(requests.length, 0);
    const env = await environment.resolve([
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
    ]);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, 'secret');
    assert.deepEqual(base, { PATH: '/tools' });
    assert.equal(requests[0].onOutput, undefined);
    await assert.rejects(
        environment.resolve(['MISSING']),
        /MISSING.*\.env.*retry/,
    );
});

test('project environment is snapshotted with explicit precedence and is never shell-sourced', async () => {
    const files = memoryFiles();
    await files.writeExclusive(
        '/checkout/global.env',
        'GLOBAL_ONLY=yes\nOVERRIDE=global\nPATH=/global\nCHS_DEV_ROOT=/wrong\nLITERAL="$(do-not-run)"\n',
    );
    await files.writeExclusive(
        '/checkout/.env',
        'OVERRIDE=project\nPATH=/project\n',
    );
    const base = { PATH: '/process' };
    const environment = new LiveEnvironment(
        async () => {
            throw new Error('No commands expected');
        },
        '/checkout',
        () => base,
        () => 'profile',
        files,
    );
    const first = await environment.resolve([
        'GLOBAL_ONLY',
        'OVERRIDE',
        'CHS_DEV_ROOT',
    ]);
    assert.equal(first.GLOBAL_ONLY, 'yes');
    assert.equal(first.OVERRIDE, 'project');
    assert.equal(first.PATH, '/process');
    assert.equal(first.CHS_DEV_ROOT, '/checkout');
    assert.equal(first.LITERAL, '$(do-not-run)');
    await files.remove('/checkout/.env');
    await files.writeExclusive('/checkout/.env', 'OVERRIDE=changed\n');
    base.PATH = '/changed';
    const active = await environment.resolve([]);
    assert.equal(active.OVERRIDE, 'project');
    assert.equal(active.PATH, '/process');
    await environment.refresh();
    const next = await environment.resolve([]);
    assert.equal(next.OVERRIDE, 'changed');
    assert.equal(next.PATH, '/changed');
});

test('process adapter streams sanitized bounded lines and cancellation owns the process group until close', async () => {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const kills: string[] = [];
    const timers = new Set<() => void>();
    const execute = createProcessExecutor({
        spawn: () => child,
        kill: (pid, signal) => {
            kills.push(`${pid}:${signal}`);
        },
        schedule: (callback) => {
            timers.add(callback);
            return () => {
                timers.delete(callback);
            };
        },
    });
    const output: string[] = [];
    const abort = new AbortController();
    const work = execute({
        command: 'fake',
        args: [],
        cwd: '/checkout',
        env: { AWS_SECRET_ACCESS_KEY: 'sensitive' },
        signal: abort.signal,
        onOutput: (entry) => output.push(entry.text),
    });
    child.stdout.write('\x1b[31msensitive\x1b[0m\n');
    child.stderr.write(
        '-----BEGIN RSA PRIVATE KEY-----\nsecret body\n-----END RSA PRIVATE KEY-----\n',
    );
    child.stdout.write('x'.repeat(18000));
    abort.abort();
    let done = false;
    void work.catch(() => {
        done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    assert.deepEqual(kills, ['42:SIGTERM']);
    child.emit('close', null);
    await assert.rejects(work, /cancelled/);
    assert.equal(kills.at(-1), '42:SIGKILL');
    assert.equal(timers.size, 0);
    assert.ok(
        output.every(
            (line) =>
                line.length <= 2000 &&
                !line.includes('sensitive') &&
                !line.includes('secret body') &&
                !line.includes('\x1b'),
        ),
    );
});

test('streaming build output is bounded without imposing a total-output failure threshold', async () => {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const execute = createProcessExecutor({
        spawn: () => child,
        kill: () => {
            throw new Error('Streaming output must not cancel the command');
        },
        schedule: () => () => {},
    });
    const lines: string[] = [];
    const work = execute({
        command: 'fake',
        args: [],
        cwd: '/',
        env: {},
        captureStdout: false,
        onOutput: (entry) => lines.push(entry.text),
    });
    for (let index = 0; index < 9; index++)
        child.stdout.write(`${'x'.repeat(1024 * 1024)}\n`);
    child.emit('close', 0);
    const result = await work;
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.ok(lines.every((line) => line.length <= 2000));
});

test('process adapter preserves exit codes and rejects oversized machine output', async () => {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const execute = createProcessExecutor({
        spawn: () => child,
        kill: () => {},
        schedule: () => () => {},
    });
    const work = execute({ command: 'fake', args: [], cwd: '/', env: {} });
    child.stderr.write('failed\n');
    child.emit('close', 7);
    assert.equal((await work).code, 7);
    const excessive = execute({ command: 'fake', args: [], cwd: '/', env: {} });
    child.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
    child.emit('close', null);
    await assert.rejects(excessive, /exceeded/);
});

function memoryFiles(): LiveFiles {
    const files = new Map<string, string>();
    return {
        read: async (path) => {
            if (!files.has(path))
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            return files.get(path)!;
        },
        writeExclusive: async (path, value) => {
            if (files.has(path))
                throw Object.assign(new Error('exists'), { code: 'EEXIST' });
            files.set(path, value);
        },
        remove: async (path) => {
            files.delete(path);
        },
        mkdir: async () => {},
        realpath: async (path) => path,
    };
}
test('configuration snapshots and project ownership use only injected memory files', async () => {
    const files = memoryFiles();
    await files.writeExclusive('/checkout/.chs-dev.yaml', 'services: [api]\n');
    const store = configurationStore(
        '/checkout',
        [
            {
                name: 'module',
                services: ['api', 'base'],
                definitions: {
                    api: {
                        dependencies: ['base'],
                        base: false,
                        module: 'module',
                        deprecated: false,
                    },
                    base: {
                        dependencies: [],
                        base: true,
                        module: 'module',
                        deprecated: false,
                    },
                },
            },
        ],
        files,
    );
    const snapshot = await store.read();
    assert.deepEqual(
        snapshot.inventory.map((entry) => entry.service),
        ['api', 'base'],
    );
    const first = projectLock('/checkout', files, 'first');
    const second = projectLock('/checkout', files, 'second');
    const release = await first.acquire();
    await assert.rejects(second.acquire(), /Another Live session/);
    await release();
    await (
        await second.acquire()
    )();
});

test('runtime observation preserves the engine image reference and image ID rather than saved labels', async () => {
    const f = runtimeFixture();
    const value = {
        ...inspect({ 'chs.dev.image': 'registry.example/api:saved-next' }),
        Image: 'sha256:' + 'b'.repeat(64),
    };
    f.set([
        {
            ...value,
            Config: {
                ...value.Config,
                Image: 'registry.example/api:observed-old',
            },
        },
    ]);
    const snapshot = await f.runtime.snapshot();
    assert.equal(
        snapshot.containers[0].image,
        'registry.example/api:observed-old',
    );
    assert.equal(snapshot.containers[0].imageId, 'sha256:' + 'b'.repeat(64));
});

test('cold start executes immutable applied Compose artifacts with dependency conditions and no image refresh', async () => {
    const f = runtimeFixture();
    f.set([
        inspect({
            'com.docker.compose.project.config_files':
                '/state/operations/one/docker-compose.yaml',
            'chs.dev.lifecycle':
                '{"version":1,"lazy":true,"reclaimable":false,"dependencies":[]}',
        }),
    ]);
    await f.runtime.startApplied('api', {});
    assert.deepEqual(f.requests.at(-1)?.args, [
        'compose',
        '--project-name',
        'chs',
        '--project-directory',
        '/checkout',
        '--env-file',
        '/dev/null',
        '-f',
        '/state/operations/one/docker-compose.yaml',
        'up',
        '--detach',
        '--no-recreate',
        '--no-build',
        '--pull',
        'never',
        'api',
    ]);
    assert.equal(
        f.requests.some((request) => request.args[0] === 'start'),
        false,
    );
});

test('automatic startup rejects missing, foreign and unowned applied artifacts before engine mutation', async () => {
    for (const file of [
        '/checkout/docker-compose.yaml',
        '/state/operations/one/../../foreign/docker-compose.yaml',
        '/state/operations/one/docker-compose.yaml,/state/operations/two/docker-compose.yaml',
        '/missing',
    ]) {
        const f = runtimeFixture();
        f.set([
            inspect({
                'com.docker.compose.project.config_files': file,
                'chs.dev.lifecycle':
                    '{"version":1,"lazy":true,"reclaimable":false,"dependencies":[]}',
            }),
        ]);
        await assert.rejects(
            f.runtime.startApplied('api', {}),
            /Apply configuration/,
        );
        assert.equal(
            f.requests.some((request) => request.args.includes('up')),
            false,
        );
    }
    const f = runtimeFixture();
    f.set([
        inspect({
            'com.docker.compose.project.config_files':
                '/state/operations/one/docker-compose.yaml',
            'chs.dev.lifecycle':
                '{"version":1,"lazy":true,"reclaimable":false,"dependencies":[]}',
        }),
    ]);
    f.artifact('name: foreign\nservices:\n  api:\n    image: other\n');
    await assert.rejects(
        f.runtime.startApplied('api', {}),
        /do not match.*Apply configuration/,
    );
    assert.equal(
        f.requests.some((request) => request.args.includes('up')),
        false,
    );
});

test('Restart and Reload select current applied helpers instead of historical orphan containers', async () => {
    const f = runtimeFixture();
    f.set([
        inspect({
            'com.docker.compose.project.config_files':
                '/state/operations/current/docker-compose.yaml',
            'chs.dev.owner-service': 'api',
            'chs.dev.lifecycle':
                '{"version":1,"lazy":false,"reclaimable":false,"dependencies":[]}',
        }),
        {
            ...inspect({
                'com.docker.compose.service': 'obsolete-builder',
                'chs.dev.owner-service': 'api',
            }),
            Id: 'b'.repeat(64),
        },
    ]);
    f.artifact(
        'name: chs\nservices:\n  api:\n    image: api:applied\n    labels:\n      chs.dev.owner-service: api\n    depends_on:\n      current-builder:\n        condition: service_completed_successfully\n  current-builder:\n    image: builder:applied\n    labels:\n      chs.dev.owner-service: api\n',
    );
    await f.runtime.startApplied('api', {}, 'restart');
    assert.equal(f.requests.at(-1)!.args.includes('obsolete-builder'), false);
    assert.equal(f.requests.at(-1)!.args.includes('current-builder'), true);
    await f.runtime.reloadApplied('api', {});
    assert.equal(f.requests.at(-1)!.args.includes('obsolete-builder'), false);
    assert.equal(f.requests.at(-1)!.args.includes('current-builder'), true);
});

test('environment preflight validates names, exempts AWS and reuses its snapshot until refresh', async () => {
    const files = memoryFiles();
    await files.writeExclusive('/checkout/.env', 'READY=yes\nEMPTY=\n');
    const environment = new LiveEnvironment(
        async () => {
            throw new Error('Preflight must not execute AWS');
        },
        '/checkout',
        () => ({ 'BAD-NAME': 'present' }),
        () => 'profile',
        files,
    );
    assert.deepEqual(
        await environment.missing([
            'READY',
            'EMPTY',
            'BAD-NAME',
            'MISSING',
            'AWS_SESSION_TOKEN',
        ]),
        ['EMPTY', 'BAD-NAME', 'MISSING'],
    );
    await files.remove('/checkout/.env');
    await files.writeExclusive('/checkout/.env', 'MISSING=now-present\n');
    assert.deepEqual(await environment.missing(['READY', 'MISSING']), [
        'MISSING',
    ]);
    await environment.refresh();
    assert.deepEqual(await environment.missing(['READY', 'MISSING']), [
        'READY',
    ]);
});

test('environment rejects unreadable files, failed credential acquisition and malformed credential fields', async () => {
    const unavailable = new LiveEnvironment(
        async () => ({ code: 0, stdout: '', stderr: '' }),
        '/checkout',
        () => ({}),
        () => 'profile',
        {
            ...memoryFiles(),
            read: async () => {
                throw Object.assign(new Error('denied'), { code: 'EACCES' });
            },
        },
    );
    await assert.rejects(
        unavailable.resolve([]),
        /Cannot read project environment/,
    );
    for (const result of [
        { code: 1, stdout: '{"AccessKeyId":"key"}', stderr: 'denied' },
        { code: 0, stdout: 'null', stderr: '' },
        { code: 0, stdout: '42', stderr: '' },
        {
            code: 0,
            stdout: '{"AccessKeyId":42,"SecretAccessKey":null}',
            stderr: '',
        },
    ]) {
        const environment = new LiveEnvironment(
            async () => result,
            '/checkout',
            () => ({}),
            () => 'profile',
            memoryFiles(),
        );
        await assert.rejects(
            environment.resolve(['AWS_ACCESS_KEY_ID']),
            /Cannot acquire AWS|Invalid AWS credential|Required environment variable/,
        );
    }
});

test('real file adapter creates private directories, preserves exclusive creation and removes complete trees idempotently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-live-files-'));
    try {
        const nested = join(directory, 'parent', 'nested');
        await liveFiles.mkdir(nested);
        assert.equal((await stat(nested)).mode & 0o777, 0o700);
        await liveFiles.mkdir(nested);
        const exclusive = join(directory, 'exclusive');
        await liveFiles.mkdir(exclusive, true);
        await assert.rejects(liveFiles.mkdir(exclusive, true), {
            code: 'EEXIST',
        });
        await liveFiles.writeExclusive(join(nested, 'private'), 'secret');
        assert.equal((await stat(join(nested, 'private'))).mode & 0o777, 0o600);
        await liveFiles.remove(join(directory, 'parent'));
        await assert.rejects(stat(nested), { code: 'ENOENT' });
        await liveFiles.remove(join(directory, 'parent'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

const cacheGroups = [
    {
        name: 'module',
        services: ['api', 'base'],
        definitions: {
            api: {
                dependencies: ['base'],
                base: false,
                module: 'module',
                deprecated: false,
            },
            base: {
                dependencies: [],
                base: false,
                module: 'module',
                deprecated: false,
            },
        },
    },
];

test('configuration usage learning only applies when enabled and distinguishes missing from unreadable cache', async () => {
    const files = memoryFiles();
    await files.writeExclusive('/checkout/.chs-dev.yaml', 'services: [api]\n');
    await files.writeExclusive(
        '/checkout/.chs-dev-usage.yaml',
        'format: chs-dev-usage\nversion: 1\nlearned: [base]\n',
    );
    const enabled = await configurationStore(
        '/checkout',
        cacheGroups,
        files,
        () => true,
    ).read();
    assert.equal(
        enabled.inventory.find((entry) => entry.service === 'base')?.lazy,
        true,
    );
    const disabled = await configurationStore(
        '/checkout',
        cacheGroups,
        files,
        () => false,
    ).read();
    assert.equal(
        Boolean(
            disabled.inventory.find((entry) => entry.service === 'base')?.lazy,
        ),
        false,
    );
    await files.remove('/checkout/.chs-dev-usage.yaml');
    assert.equal(
        (
            await configurationStore(
                '/checkout',
                cacheGroups,
                files,
                () => true,
            ).read()
        ).inventory.length,
        2,
    );
    const unreadable = {
        ...files,
        read: async (path: string) => {
            if (path.endsWith('.chs-dev-usage.yaml'))
                throw Object.assign(new Error('cache denied'), {
                    code: 'EACCES',
                });
            return files.read(path);
        },
    };
    await assert.rejects(
        configurationStore(
            '/checkout',
            cacheGroups,
            unreadable,
            () => true,
        ).read(),
        /cache denied/,
    );
    const missing = await configurationStore(
        '/empty',
        cacheGroups,
        files,
    ).read();
    assert.equal(missing.yaml, '{}\n');
    await assert.rejects(
        configurationStore('/checkout', cacheGroups, {
            ...files,
            read: async () => {
                throw Object.assign(new Error('configuration denied'), {
                    code: 'EACCES',
                });
            },
        }).read(),
        /configuration denied/,
    );
});

test('project lock refuses a changed owner token and propagates storage failures', async () => {
    const files = memoryFiles();
    const release = await projectLock('/state', files, 'owner').acquire();
    await files.remove('/state/live.lock');
    await files.writeExclusive('/state/live.lock', 'replacement');
    await assert.rejects(release(), /lock changed/);
    assert.equal(await files.read('/state/live.lock'), 'replacement');
    await assert.rejects(
        projectLock('/state', {
            ...files,
            writeExclusive: async () => {
                throw new Error('storage failed');
            },
        }).acquire(),
        /storage failed/,
    );
});

function processFixture() {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const kills: string[] = [];
    const timers: { callback: () => void; ms: number; cancelled: boolean }[] =
        [];
    const execute = createProcessExecutor({
        spawn: () => child,
        kill: (pid, signal) => {
            kills.push(`${pid}:${signal}`);
        },
        schedule: (callback, ms) => {
            const timer = { callback, ms, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
    });
    return { child, execute, kills, timers };
}

const processRequest = { command: 'fake', args: [], cwd: '/checkout', env: {} };

test('process output streams real lines, preserves sanitized stderr and resumes after private key and oversized lines', async () => {
    const f = processFixture();
    const output: string[] = [];
    const work = f.execute({
        ...processRequest,
        env: { API_TOKEN: 'hidden' },
        onOutput: (entry) => output.push(`${entry.stream}:${entry.text}`),
    });
    f.child.stdout.write(
        'ready hidden\n-----BEGIN RSA PRIVATE KEY-----\nkey body\n-----END RSA PRIVATE KEY-----\nafter key\n',
    );
    f.child.stderr.write('warning hidden\n');
    f.child.stdout.write('x'.repeat(16385));
    f.child.stdout.write('discarded remainder\nnext complete\nlast partial');
    f.child.emit('close', 0);
    const result = await work;
    assert.equal(result.stderr, 'warning [REDACTED]\n');
    assert.equal(result.registryAuthenticationFailed, undefined);
    assert.deepEqual(output, [
        'stdout:ready [REDACTED]',
        'stdout:[REDACTED PRIVATE KEY]',
        'stdout:[REDACTED PRIVATE KEY]',
        'stdout:[REDACTED PRIVATE KEY]',
        'stdout:after key',
        'stderr:warning [REDACTED]',
        'stdout:[Oversized output line truncated]',
        'stdout:next complete',
        'stdout:last partial',
    ]);
});

test('private process output supports silence, captured diagnostics and explicitly requested private streaming', async () => {
    for (const options of [
        { privateOutput: true },
        { privateOutput: true, captureStderr: true },
        { privateOutput: true, streamPrivateOutput: true },
    ]) {
        const f = processFixture();
        const output: string[] = [];
        const work = f.execute({
            ...processRequest,
            ...options,
            onOutput: (entry) => output.push(entry.text),
        });
        f.child.stdout.write('machine\n');
        f.child.stderr.write('403 Forbidden\n');
        f.child.emit('close', 3);
        const result = await work;
        assert.equal(result.stdout, 'machine\n');
        assert.equal(
            result.stderr,
            options.captureStderr || options.streamPrivateOutput
                ? '403 Forbidden\n'
                : '',
        );
        assert.equal(result.registryAuthenticationFailed, true);
        assert.deepEqual(
            output,
            options.streamPrivateOutput ? ['machine', '403 Forbidden'] : [],
        );
    }
});

test('process deadline cancels once, escalates and never replaces its timeout failure with cancellation', async () => {
    const f = processFixture();
    const abort = new AbortController();
    const work = f.execute({
        ...processRequest,
        signal: abort.signal,
        timeout: 73,
    });
    const rejected = assert.rejects(work, /Command timed out/);
    assert.equal(f.timers[0].ms, 73);
    f.timers[0].callback();
    abort.abort();
    assert.deepEqual(f.kills, ['42:SIGTERM']);
    assert.equal(f.timers[1].ms, 1500);
    f.timers[1].callback();
    assert.deepEqual(f.kills, ['42:SIGTERM', '42:SIGKILL']);
    f.child.emit('close', null);
    await rejected;
    assert.ok(f.timers.every((timer) => timer.cancelled));
});

test('zero deadline schedules no timeout and already-cancelled requests never spawn', async () => {
    const f = processFixture();
    const work = f.execute({ ...processRequest, timeout: 0 });
    assert.equal(f.timers.length, 0);
    f.child.emit('close', null);
    assert.deepEqual(await work, { code: -1, stdout: '', stderr: '' });
    const abort = new AbortController();
    abort.abort();
    const execute = createProcessExecutor({
        spawn: () => {
            throw new Error('Must not spawn');
        },
        kill: () => {},
        schedule: () => () => {},
    });
    await assert.rejects(
        execute({ ...processRequest, signal: abort.signal }),
        /Operation cancelled/,
    );
});

test('default process host sends stdin through a pipe and owns a detached process group', async () => {
    const execute = createProcessExecutor();
    const result = await execute({
        command: process.execPath,
        args: [
            '-e',
            "process.kill(-process.pid, 0); process.stdin.setEncoding('utf8'); let text = ''; process.stdin.on('data', chunk => { text += chunk; }); process.stdin.on('end', () => process.stdout.write(text));",
        ],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH },
        stdin: 'private input',
        timeout: 3000,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'private input');
});

test('Compose argument validation rejects each missing identity or invalid path independently', () => {
    for (const invalid of [
        { projectName: '' },
        { projectDirectory: 'relative' },
        { composeFiles: [] },
        { composeFiles: ['relative'] },
    ])
        assert.throws(
            () => composeArguments({ ...project, ...invalid }),
            /invalid Compose/,
        );
});

test('availability checks both Docker and Compose and reports either failure without throwing', async () => {
    for (const failureAt of [0, 1, -1]) {
        const requests: ProcessRequest[] = [];
        const runtime = new DockerLiveRuntime({
            directory: '/checkout',
            projectName: 'chs',
            realpath: async (path) => path,
            environment: { resolve: async () => ({}) },
            execute: async (request) => {
                requests.push(request);
                return {
                    code: requests.length - 1 === failureAt ? 1 : 0,
                    stdout: '',
                    stderr: '',
                };
            },
        });
        const result = await runtime.checkAvailability();
        assert.equal(result.available, failureAt === -1);
        assert.equal(requests.length, failureAt === 0 ? 1 : 2);
        assert.ok(requests.every((request) => request.timeout === 5000));
    }
});

test('snapshot machine requests capture only machine output while ordinary Compose calls stream diagnostics', async () => {
    const f = runtimeFixture();
    await f.runtime.snapshot();
    assert.deepEqual(
        f.requests.map((request) => [
            request.args[0],
            request.captureStdout,
            request.privateOutput,
        ]),
        [
            ['ps', true, false],
            ['inspect', true, false],
        ],
    );
    f.requests.length = 0;
    await f.runtime.apply(project, {});
    assert.ok(
        f.requests.every(
            (request) =>
                request.captureStdout === false &&
                request.privateOutput === false,
        ),
    );
});

test('ECR detection requires a registry and an authorization failure on the same line', () => {
    const host = '123456789012.dkr.ecr.eu-west-2.amazonaws.com';
    assert.equal(
        ecrAuthorizationFailure(`resolving ${host}/api:latest`),
        undefined,
    );
    assert.equal(
        ecrAuthorizationFailure(
            `resolving ${host}\n403 Forbidden from another host`,
        ),
        undefined,
    );
    assert.equal(
        ecrAuthorizationFailure('403 Forbidden from another host'),
        undefined,
    );
    assert.equal(
        ecrAuthorizationFailure(`${host}/api:latest: 401 Unauthorized`),
        host,
    );
});

function observationFixture(
    inspections: unknown,
    listing = id,
    canonical = async (path: string) => path,
) {
    const requests: ProcessRequest[] = [];
    const runtime = new DockerLiveRuntime({
        directory: '/checkout',
        projectName: 'chs',
        realpath: canonical,
        environment: { resolve: async () => ({}) },
        execute: async (request) => {
            requests.push(request);
            if (request.args[0] === 'ps')
                return { code: 0, stdout: listing, stderr: '' };
            return { code: 0, stdout: JSON.stringify(inspections), stderr: '' };
        },
    });
    return { runtime, requests };
}

test('snapshot rejects malformed engine identities and inspection shapes before exposing containers', async () => {
    await assert.rejects(
        observationFixture([], 'not-a-container-id').runtime.snapshot(),
        /invalid container ID/,
    );
    await assert.rejects(
        observationFixture({}).runtime.snapshot(),
        /Invalid Docker inspection response/,
    );
    for (const invalid of [
        { ...inspect(), Id: '' },
        { ...inspect(), Id: 'invalid' },
        inspect({ 'com.docker.compose.service': '' }),
        { ...inspect(), State: {} },
    ])
        await assert.rejects(
            observationFixture([invalid]).runtime.snapshot(),
            /Incomplete Docker container identity/,
        );
});

test('snapshot skips missing working directories and propagates unexpected canonicalization failures', async () => {
    const paths: string[] = [];
    const noDirectory = observationFixture(
        [inspect({ 'com.docker.compose.project.working_dir': '' })],
        id,
        async (path) => {
            paths.push(path);
            return path;
        },
    );
    assert.equal((await noDirectory.runtime.snapshot()).containers.length, 0);
    assert.deepEqual(paths, ['/checkout']);
    for (const code of ['ENOENT', 'ENOTDIR', 'EACCES']) {
        const f = observationFixture(
            [
                inspect({
                    'com.docker.compose.project.working_dir': '/unreadable',
                }),
            ],
            id,
            async (path) => {
                if (path === '/unreadable')
                    throw Object.assign(new Error('canonicalization denied'), {
                        code,
                    });
                return path;
            },
        );
        if (code === 'EACCES')
            await assert.rejects(
                f.runtime.snapshot(),
                /canonicalization denied/,
            );
        else assert.deepEqual((await f.runtime.snapshot()).containers, []);
    }
});

test('snapshot treats invalid optional engine metadata as unknown rather than trusting wrong types', async () => {
    const f = observationFixture([
        {
            ...inspect({ 'chs.dev.mode': 'unsupported' }),
            State: { Status: 'running', ExitCode: 'bad', OOMKilled: 'bad' },
        },
    ]);
    const [container] = (await f.runtime.snapshot()).containers;
    assert.equal(container.mode, undefined);
    assert.equal('exitCode' in container, false);
    assert.equal('oomKilled' in container, false);
});

test('stop and container actions reject each independently mismatched identity field', async () => {
    const f = runtimeFixture();
    const [container] = (await f.runtime.snapshot()).containers;
    for (const changed of [
        { id: 'b'.repeat(64) },
        { service: 'other' },
        { projectDirectory: '/foreign' },
        { projectName: 'foreign' },
    ]) {
        const start = f.requests.length;
        const forged = { ...container, ...changed };
        assert.deepEqual(
            (await f.runtime.stop([forged], {})).affectedServices,
            [],
        );
        assert.deepEqual(
            (await f.runtime.containerAction('restart', [forged], {}))
                .affectedServices,
            [],
        );
        assert.equal(
            f.requests
                .slice(start)
                .some((request) =>
                    ['stop', 'restart'].includes(request.args[0]!),
                ),
            false,
        );
    }
    const start = f.requests.length;
    assert.deepEqual((await f.runtime.stop([], {})).affectedServices, []);
    assert.equal(f.requests.length, start);
});

test('exactly one hundred containers form one inspection, stop and remove batch without empty requests', async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
        ...inspect(),
        Id: (index + 1).toString(16).padStart(64, '0'),
    }));
    const f = observationFixture(
        entries,
        entries.map((entry) => entry.Id).join('\n'),
    );
    await f.runtime.stopProject({});
    assert.deepEqual(
        f.requests.map((request) => [request.args[0], request.args.length]),
        [
            ['ps', 4],
            ['inspect', 101],
            ['stop', 101],
            ['rm', 101],
        ],
    );
    const empty = observationFixture([], '');
    await empty.runtime.stopProject({});
    assert.deepEqual(
        empty.requests.map((request) => request.args[0]),
        ['ps'],
    );
});

test('all-held and missing held services never trigger a targetless Compose up', async () => {
    const all = runtimeFixture();
    await all.runtime.apply(project, { stoppedServices: ['api', 'worker'] });
    assert.deepEqual(
        all.requests
            .filter((request) => request.args.includes('up'))
            .map((request) =>
                request.args.slice(composeArguments(project).length),
            ),
        [['up', '--no-start', '--no-deps', 'api', 'worker']],
    );
    const removed = runtimeFixture();
    removed.composeServices({ api: {} });
    await removed.runtime.apply(project, { stoppedServices: ['removed'] });
    assert.deepEqual(
        removed.requests
            .filter((request) => request.args.includes('up'))
            .map((request) =>
                request.args.slice(composeArguments(project).length),
            ),
        [['up', '--detach', '--no-deps', 'api']],
    );
});

test('applied start and restart keep distinct flags, targets and user messages', async () => {
    const f = runtimeFixture();
    f.set([
        inspect({
            'com.docker.compose.project.config_files':
                '/state/operations/current/docker-compose.yaml',
            'chs.dev.lifecycle':
                '{"version":1,"lazy":false,"reclaimable":false,"dependencies":[]}',
        }),
    ]);
    f.artifact(
        'name: chs\nservices:\n  api:\n    image: api\n  builder:\n    labels:\n      chs.dev.owner-service: api\n',
    );
    const started = await f.runtime.startApplied('api', {});
    assert.match(started.message, /^Started api/);
    assert.equal(f.requests.at(-1)!.args.includes('builder'), false);
    assert.equal(f.requests.at(-1)!.args.includes('--no-recreate'), true);
    const restarted = await f.runtime.startApplied('api', {}, 'restart');
    assert.match(restarted.message, /^Restarted api/);
    assert.equal(f.requests.at(-1)!.args.includes('builder'), true);
    assert.equal(f.requests.at(-1)!.args.includes('--force-recreate'), true);
});

test('machine output accepts exactly eight MiB and lines at the truncation boundary remain normal output', async () => {
    const maximum = processFixture();
    const large = maximum.execute(processRequest);
    maximum.child.stdout.write('x'.repeat(8 * 1024 * 1024));
    maximum.child.emit('close', 0);
    assert.equal((await large).stdout.length, 8 * 1024 * 1024);
    const line = processFixture();
    const output: string[] = [];
    const work = line.execute({
        ...processRequest,
        onOutput: (entry) => output.push(entry.text),
    });
    line.child.stdout.write('x'.repeat(16384));
    line.child.emit('close', 0);
    await work;
    assert.equal(output.length, 1);
    assert.ok(output[0].startsWith('x'));
    assert.equal(output[0].length, 2000);
});

test('an oversized private key header keeps later body lines private until the key ends', async () => {
    const f = processFixture();
    const output: string[] = [];
    const work = f.execute({
        ...processRequest,
        onOutput: (entry) => output.push(entry.text),
    });
    f.child.stdout.write(`-----BEGIN RSA PRIVATE KEY-----${'x'.repeat(16385)}`);
    f.child.stdout.write(
        '\nsecret body\n-----END RSA PRIVATE KEY-----\nvisible\n',
    );
    f.child.emit('close', 0);
    await work;
    assert.deepEqual(output, [
        '[REDACTED PRIVATE KEY]',
        '[REDACTED PRIVATE KEY]',
        '[REDACTED PRIVATE KEY]',
        'visible',
    ]);
});

test('process cancellation reports termination errors consistently for Error and non-Error failures', async () => {
    for (const failure of [new Error('denied'), 'denied']) {
        const child = Object.assign(new EventEmitter(), {
            pid: 42,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
        });
        const abort = new AbortController();
        const execute = createProcessExecutor({
            spawn: () => child,
            kill: () => {
                throw failure;
            },
            schedule: () => () => {},
        });
        const work = execute({ ...processRequest, signal: abort.signal });
        const rejected = assert.rejects(work, {
            message: 'Cannot terminate owned command: denied',
        });
        abort.abort();
        child.emit('close', null);
        await rejected;
    }
});

test('cancellation racing with spawn is observed before a missed abort event can finish successfully', async () => {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const abort = new AbortController();
    const kills: string[] = [];
    const execute = createProcessExecutor({
        spawn: () => {
            abort.abort();
            return child;
        },
        kill: (_, signal) => {
            kills.push(signal);
        },
        schedule: () => () => {},
    });
    const work = execute({ ...processRequest, signal: abort.signal });
    const rejected = assert.rejects(work, /cancelled/);
    assert.deepEqual(kills, ['SIGTERM']);
    child.emit('close', 0);
    await rejected;
});

test('failed spawn without a process ID never attempts to signal an unowned process', async () => {
    const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    const abort = new AbortController();
    const execute = createProcessExecutor({
        spawn: () => child,
        kill: () => {
            throw new Error('Unowned process signalled');
        },
        schedule: () => () => {},
    });
    const work = execute({ ...processRequest, signal: abort.signal });
    const rejected = assert.rejects(work, /spawn failed/);
    child.emit('error', new Error('spawn failed'));
    abort.abort();
    child.emit('close', null);
    await rejected;
});

test('registry authentication failures without a named registry keep the message free of fabricated hosts', async () => {
    const f = runtimeFixture();
    f.fail('no basic auth credentials');
    await assert.rejects(
        f.runtime.apply(project, {}),
        (error: unknown) =>
            error instanceof Error &&
            error.message.startsWith('ECR authentication failed.'),
    );
});

function processLogEntries(
    logger: ReturnType<typeof initializeTuiLog>,
    firstLine: number,
) {
    return logger
        .getSnapshot()
        .lines.slice(firstLine)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.event === 'process');
}

test('process diagnostics distinguish success, failure and cancellation while hiding private command verbs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-process-diagnostics-'));
    const logger = initializeTuiLog(directory);
    try {
        for (const scenario of [
            { code: 0, status: 'success' },
            { code: 7, status: 'failed' },
            { code: 0, status: 'failed', error: true },
            { code: null, status: 'cancelled', abort: true },
        ]) {
            const f = processFixture();
            const signal = new AbortController();
            const firstLine = logger.getSnapshot().lines.length;
            const work = f.execute({
                ...processRequest,
                command: '/tools/docker',
                args: ['compose', 'up', 'private-value'],
                signal: signal.signal,
            });
            const settled = work.then(
                () => undefined,
                (error: unknown) => error,
            );
            if (scenario.error)
                f.child.emit('error', new Error('process failure'));
            if (scenario.abort) signal.abort();
            f.child.emit('close', scenario.code);
            const error = await settled;
            assert.equal(
                error instanceof Error,
                !!(scenario.error || scenario.abort),
            );
            const entries = processLogEntries(logger, firstLine);
            assert.ok(entries.length >= 2);
            assert.equal(entries[0].status, 'start');
            assert.equal(entries.at(-1)?.status, scenario.status);
            assert.ok(
                entries.every(
                    (entry) =>
                        entry.command === 'docker' &&
                        entry.subcommand === 'compose up',
                ),
            );
        }
        const f = processFixture();
        const firstLine = logger.getSnapshot().lines.length;
        const work = f.execute({
            ...processRequest,
            command: '/tools/docker',
            args: ['compose', 'up', 'private-value'],
            privateOutput: true,
        });
        f.child.emit('close', 0);
        await work;
        const entries = processLogEntries(logger, firstLine);
        assert.deepEqual(
            entries.map((entry) => entry.status),
            ['start', 'success'],
        );
        assert.ok(
            entries.every(
                (entry) =>
                    entry.command === 'docker' && !('subcommand' in entry),
            ),
        );
        assert.equal(
            logger
                .getSnapshot()
                .lines.some((line) => line.includes('private-value')),
            false,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
