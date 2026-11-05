import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerComposeStrategy } from '../src/infrastructure/runtimes/docker-compose.js';
import type { ProcessRequest } from '../src/infrastructure/live-process.js';

test('all Docker strategy operations stay on the original local engine while project secrets vary', async () => {
    const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'chs-connection-')),
    );
    const calls: ProcessRequest[] = [];
    const id = 'a'.repeat(64);
    const labels = {
        'com.docker.compose.project': 'fixture',
        'com.docker.compose.project.working_dir': directory,
        'com.docker.compose.service': 'api',
    };
    const inspection = {
        Id: id,
        Name: '/api',
        Config: { Labels: labels },
        State: { Status: 'running' },
    };
    const startup = {
        DOCKER_CONTEXT: 'desktop',
        DOCKER_CONFIG: '/fixture/docker',
    };
    const runtime = new DockerComposeStrategy({
        directory,
        environment: startup,
        execute: async (request) => {
            calls.push(request);
            const [command] = request.args;
            let stdout = '';
            if (command === 'context')
                stdout = JSON.stringify({
                    Host: 'unix:///fixture/original.sock',
                });
            if (command === 'info') stdout = 'original-engine';
            if (command === 'ps') stdout = id;
            if (command === 'inspect')
                stdout = request.args.includes('--format')
                    ? JSON.stringify({ labels, state: { Status: 'running' } })
                    : JSON.stringify([inspection]);
            if (command === 'container' && request.args[1] === 'ls')
                stdout = JSON.stringify({ ID: id });
            if (command === 'container' && request.args[1] === 'inspect')
                stdout = JSON.stringify([inspection]);
            return { code: 0, stdout, stderr: '' };
        },
    });
    try {
        const project = {
            directory,
            name: 'fixture',
            environment: {
                resolve: async () => ({
                    DOCKER_HOST: 'unix:///fixture/wrong.sock',
                    DOCKER_CONTEXT: 'wrong',
                    PROJECT_SECRET: 'required-by-compose',
                }),
            },
        };
        assert.equal((await runtime.checkAvailability()).available, true);
        startup.DOCKER_CONTEXT = 'other';
        await runtime.live(project).snapshot();
        const manager = runtime.containers(project);
        const [container] = await manager.list();
        await manager.action('stop', container, {});
        await manager.streamLogs(container, { tail: 10, follow: true }, {});
        await runtime.inspect(project);
        const engineCalls = calls.filter((call) => call.args[0] !== 'context');
        assert.ok(engineCalls.some((call) => call.args[0] === 'ps'));
        assert.ok(
            engineCalls.some(
                (call) =>
                    call.args[0] === 'container' && call.args[1] === 'stop',
            ),
        );
        assert.ok(engineCalls.some((call) => call.args.includes('--follow')));
        assert.ok(
            engineCalls.every(
                (call) =>
                    call.env.DOCKER_HOST === 'unix:///fixture/original.sock',
            ),
        );
        assert.ok(
            engineCalls.every((call) => call.env.DOCKER_CONTEXT === undefined),
        );
        assert.ok(
            engineCalls.every(
                (call) => call.env.DOCKER_CONFIG === '/fixture/docker',
            ),
        );
        assert.ok(
            engineCalls.some(
                (call) => call.env.PROJECT_SECRET === 'required-by-compose',
            ),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('recovery identity uses the actual engine and local endpoint, and unavailable checks can retry without reselecting', async () => {
    const calls: ProcessRequest[] = [];
    let engine = 'engine-a';
    let unavailable = true;
    const runtime = new DockerComposeStrategy({
        environment: { DOCKER_HOST: 'unix:///fixture/daemon.sock' },
        execute: async (request) => {
            calls.push(request);
            if (unavailable)
                return { code: 1, stdout: '', stderr: 'unavailable' };
            return { code: 0, stdout: engine, stderr: '' };
        },
    });
    await assert.rejects(runtime.engineIdentity(), /verify.*engine/);
    unavailable = false;
    const original = await runtime.engineIdentity();
    assert.match(original!, /^[a-f0-9]{64}$/);
    assert.equal(await runtime.engineIdentity(), original);
    engine = 'engine-b';
    assert.notEqual(await runtime.engineIdentity(), original);
    assert.ok(
        calls.every(
            (call) => call.env.DOCKER_HOST === 'unix:///fixture/daemon.sock',
        ),
    );
    assert.ok(calls.every((call) => call.args[0] === 'info'));
});

test('remote and context-held transports retain explicit use but never claim recoverable identity', async () => {
    for (const environment of [
        {
            DOCKER_HOST: 'tcp://remote:2376',
            DOCKER_TLS_VERIFY: '1',
            DOCKER_CERT_PATH: '/fixture/certificates',
        },
        { DOCKER_CONTEXT: 'ssh-remote' },
    ]) {
        const calls: ProcessRequest[] = [];
        const runtime = new DockerComposeStrategy({
            environment,
            execute: async (request) => {
                calls.push(request);
                const stdout =
                    request.args[0] === 'context'
                        ? JSON.stringify({ Host: 'ssh://fixture' })
                        : 'ready';
                return { code: 0, stdout, stderr: '' };
            },
        });
        assert.equal(await runtime.engineIdentity(), undefined);
        assert.equal((await runtime.checkAvailability()).available, true);
        const actual = calls.find((call) => call.args[0] === 'info')!.env;
        for (const [key, value] of Object.entries(environment))
            assert.equal(actual[key], value);
    }
});

test('absent and empty context selectors resolve the CLI default before pinning', async () => {
    for (const DOCKER_CONTEXT of [undefined, '']) {
        const calls: ProcessRequest[] = [];
        const runtime = new DockerComposeStrategy({
            environment: { DOCKER_CONTEXT },
            execute: async (request) => {
                calls.push(request);
                const stdout =
                    request.args[1] === 'show'
                        ? 'default-context'
                        : request.args[1] === 'inspect'
                          ? '{"Host":"unix:///fixture/default.sock"}'
                          : 'engine-a';
                return { code: 0, stdout, stderr: '' };
            },
        });
        assert.match((await runtime.engineIdentity())!, /^[a-f0-9]{64}$/);
        assert.deepEqual(calls[0].args, ['context', 'show']);
        assert.ok(calls[1].args.includes('default-context'));
        assert.equal(
            calls.at(-1)!.env.DOCKER_HOST,
            'unix:///fixture/default.sock',
        );
    }
});
