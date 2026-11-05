import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
    DockerLiveRuntime,
    composeArguments,
} from '../src/infrastructure/live-runtime.js';
import {
    createProcessExecutor,
    type ProcessRequest,
} from '../src/infrastructure/live-process.js';
import { LiveEnvironment } from '../src/infrastructure/live-environment.js';
import {
    configurationStore,
    projectLock,
    type LiveFiles,
} from '../src/infrastructure/live-files.js';
import type { PreparedProject } from '../src/domain/live.js';

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
    let composeServices = { api: {}, worker: {} } as Record<string, object>;
    const runtime = new DockerLiveRuntime({
        directory: '/checkout',
        projectName: 'chs',
        realpath: async (path) => {
            if (path === '/missing')
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
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
                request.onOutput?.({ stream: 'stderr', text: 'api warning' });
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
    });
    return {
        runtime,
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
    const result = await f.runtime.reload(project, ['api'], {});
    assert.deepEqual(result.affectedServices, ['api', 'api-builder']);
    assert.deepEqual(f.requests.at(-1)?.args, [
        ...composeArguments(project),
        'up',
        '--detach',
        '--build',
        '--force-recreate',
        '--no-deps',
        'api',
        'api-builder',
    ]);
    assert.deepEqual(f.requirements.at(-1), ['AWS_ACCESS_KEY_ID']);
    await assert.rejects(
        f.runtime.reload(project, ['missing'], {}),
        /no containers to reload/,
    );
    await assert.rejects(
        f.runtime.reload({ ...project, projectName: 'foreign' }, ['api'], {}),
        /does not belong/,
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
