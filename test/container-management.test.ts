import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    DockerContainerManager,
    redactInspection,
} from '../src/infrastructure/docker-containers.js';
import {
    filterContainers,
    imageVersion,
    serviceContainers,
} from '../src/domain/containers.js';
import {
    createProcessExecutor,
    type ProcessRequest,
} from '../src/infrastructure/live-process.js';

const first = 'a'.repeat(64);
const second = 'b'.repeat(64);
const third = 'c'.repeat(64);
const inspection = (id = first, labels: Record<string, string> = {}) => ({
    Id: id,
    Name: id === first ? '/api' : '/other',
    Image: 'sha256:image-id',
    Created: '2026-10-01T12:00:00Z',
    Config: {
        Image: 'registry:5000/api:1.2',
        Env: ['PASSWORD=private-value'],
        Labels: labels,
    },
    State: { Status: 'running', Health: { Status: 'healthy' }, ExitCode: 0 },
    Mounts: [
        {
            Type: 'volume',
            Source: '/volumes/data',
            Destination: '/data',
            RW: true,
        },
    ],
    NetworkSettings: {
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8081' }] },
        Networks: { chs: { IPAddress: '172.20.0.2' } },
    },
});
function fixture() {
    const calls: ProcessRequest[] = [];
    let vanished = false;
    const values = [
        inspection(first, {
            'chs.dev.directory': '/checkout',
            'chs.dev.service': 'api',
            'chs.dev.backend': 'native',
            'chs.dev.image': 'registry:5000/api:stale-label',
        }),
        inspection(second, {
            'com.docker.compose.project.working_dir': '/checkout',
            'com.docker.compose.project': 'chs',
            'com.docker.compose.service': 'worker',
        }),
        inspection(third),
    ];
    const manager = new DockerContainerManager({
        directory: '/checkout',
        environment: async () => ({ DOCKER_CONTEXT: 'desktop-linux' }),
        execute: async (request) => {
            calls.push(request);
            request.signal?.throwIfAborted();
            const [, subcommand, ...args] = request.args;
            if (subcommand === 'ls')
                return {
                    code: 0,
                    stdout: values
                        .map((v) => JSON.stringify({ ID: v.Id }))
                        .join('\n'),
                    stderr: '',
                };
            if (subcommand === 'inspect') {
                const selected = values.filter(
                    (v) => args.includes(v.Id) && !(vanished && v.Id === first),
                );
                return {
                    code: vanished && args.includes(first) ? 1 : 0,
                    stdout: JSON.stringify(selected),
                    stderr: vanished
                        ? `Error: No such container: ${first}`
                        : '',
                };
            }
            if (subcommand === 'logs')
                return {
                    code: 0,
                    stdout: '2026-10-01T12:00:02Z ready\n',
                    stderr: '2026-10-01T12:00:01Z token=secret\n',
                };
            if (['start', 'stop', 'restart'].includes(subcommand))
                return { code: 0, stdout: first, stderr: '' };
            throw new Error(`Unexpected ${request.args.join(' ')}`);
        },
    });
    return {
        manager,
        calls,
        disappear: () => {
            vanished = true;
        },
    };
}

test('container listing maps native and Compose ownership and leaves other containers outside the checkout', async () => {
    const { manager, calls } = fixture();
    const list = await manager.list();
    assert.equal(list.length, 3);
    assert.deepEqual(
        list
            .filter((c) => c.currentProject)
            .map((c) => c.id)
            .sort(),
        [first, second],
    );
    const api = list.find((c) => c.id === first)!;
    assert.equal(api.name, 'api');
    assert.equal(api.status, 'Healthy');
    assert.deepEqual(api.ports, ['127.0.0.1:8081 → 8080/tcp']);
    assert.equal(list.find((c) => c.id === second)?.backend, 'compose');
    assert.equal(filterContainers(list, { all: false, query: '' }).length, 2);
    assert.equal(filterContainers(list, { all: true, query: '' }).length, 3);
    assert.equal(
        filterContainers(list, { all: true, query: '1.2', service: 'api' })
            .length,
        1,
    );
    assert.ok(calls.every((c) => c.privateOutput && c.captureStdout));
    assert.equal(calls[1].env.DOCKER_CONTEXT, 'desktop-linux');
});

test('container details include image, mounts, networks and redacted inspection', async () => {
    const { manager } = fixture();
    const details = await manager.inspect(first);
    assert.equal(details.image, 'registry:5000/api:1.2');
    assert.equal(imageVersion(details.image), '1.2');
    assert.equal(imageVersion('registry:5000/api'), 'latest (implicit)');
    assert.equal(imageVersion('registry/api@sha256:abc'), 'sha256:abc');
    assert.deepEqual(details.networks, [
        { name: 'chs', addresses: ['172.20.0.2'] },
    ]);
    assert.equal(details.mounts[0].target, '/data');
    assert.doesNotMatch(JSON.stringify(details.inspection), /private-value/);
    assert.match(JSON.stringify(details.inspection), /PASSWORD=\[hidden\]/);
    assert.deepEqual(
        redactInspection({
            password: 'secret',
            nested: { token: 'secret', ok: true },
        }),
        { password: '[hidden]', nested: { token: '[hidden]', ok: true } },
    );
});

test('container actions use only the full selected ID', async () => {
    const { manager, calls } = fixture();
    const container = (await manager.list())[0];
    for (const action of ['stop', 'start', 'restart'] as const) {
        assert.equal(
            (await manager.action(action, container, {})).outcome,
            'success',
        );
        assert.deepEqual(calls.at(-1)?.args, ['container', action, first]);
    }
    await assert.rejects(manager.inspect('api'), /full container ID/);
    await assert.rejects(manager.logs('--all', 20), /full container ID/);
});

test('a deleted container is omitted during polling and never replaced by a same-name action target', async () => {
    const { manager, calls, disappear } = fixture();
    const container = (await manager.list())[0];
    disappear();
    assert.equal((await manager.list()).length, 2);
    await assert.rejects(
        manager.action('stop', container, {}),
        /No such container/,
    );
    assert.ok(!calls.some((c) => c.args[1] === 'stop'));
});

test('logs combine timestamped streams, bound the tail and sanitize credential output', async () => {
    const { manager, calls } = fixture();
    const lines = await manager.logs(first, 9000);
    assert.match(lines[0], /12:00:01Z token=\[REDACTED\]/);
    assert.match(lines[1], /ready/);
    assert.deepEqual(calls.at(-1)?.args, [
        'container',
        'logs',
        '--timestamps',
        '--tail',
        '2000',
        first,
    ]);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(manager.list(abort.signal));
});

test('service links include builders and exclude services from other checkouts', async () => {
    const { manager } = fixture();
    const list = await manager.list();
    list.push({
        ...list[0],
        id: 'builder',
        service: 'api-builder',
        ownerService: 'api',
    });
    list.push({ ...list[0], id: 'foreign', currentProject: false });
    assert.deepEqual(
        serviceContainers(list, 'api')
            .map((c) => c.id)
            .sort(),
        [first, 'builder'],
    );
});

test('private container commands retain sanitized stderr without broadcasting logs', async () => {
    const output: string[] = [];
    const result = await createProcessExecutor()({
        command: process.execPath,
        args: [
            '-e',
            'console.error("token=private-value"); console.error("diagnostic");',
        ],
        cwd: process.cwd(),
        env: process.env,
        privateOutput: true,
        captureStderr: true,
        onOutput: (entry) => output.push(entry.text),
    });
    assert.deepEqual(output, []);
    assert.match(result.stderr, /token=\[REDACTED\]/);
    assert.match(result.stderr, /diagnostic/);
    assert.doesNotMatch(result.stderr, /private-value/);
});

test('Docker follow streams keep the pinned engine and have no artificial process deadline', async () => {
    const { manager, calls } = fixture();
    const target = (await manager.list()).find(
        (container) => container.id === first,
    )!;
    await manager.streamLogs(target, { tail: 'all', follow: true }, {});
    const request = calls.at(-1)!;
    assert.deepEqual(request.args, [
        'container',
        'logs',
        '--timestamps',
        '--tail',
        'all',
        '--follow',
        first,
    ]);
    assert.equal(request.env.DOCKER_CONTEXT, 'desktop-linux');
    assert.equal(request.timeout, 0);
    assert.equal(request.captureStdout, false);
    assert.equal(request.privateOutput, true);
    assert.equal(request.streamPrivateOutput, true);
});

test('private streamed process output is incremental, sanitized and not accumulated in stdout', async () => {
    const output: string[] = [];
    const result = await createProcessExecutor()({
        command: process.execPath,
        args: [
            '-e',
            'console.log("repeat"); console.log("repeat"); console.error("token=private-value");',
        ],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH },
        timeout: 0,
        privateOutput: true,
        streamPrivateOutput: true,
        captureStdout: false,
        captureStderr: true,
        onOutput: (entry) => output.push(entry.text),
    });
    assert.equal(result.stdout, '');
    assert.equal(output.filter((text) => text === 'repeat').length, 2);
    assert.ok(output.includes('token=[REDACTED]'));
    assert.ok(!JSON.stringify(output).includes('private-value'));
});
