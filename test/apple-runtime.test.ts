import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AppleClient,
    appleInspection,
    appleIncarnation,
} from '../src/infrastructure/native/apple-client.js';
import {
    AppleRuntimeAdapter,
    appleNamespace,
    appleMac,
} from '../src/infrastructure/native/apple-adapter.js';
import { AppleContainerManager } from '../src/infrastructure/apple-containers.js';
import { privateJson } from '../src/infrastructure/native/state-files.js';
import { adaptAppleFileMounts } from '../src/infrastructure/native/apple-file-mounts.js';
import { NativeState } from '../src/infrastructure/native/state.js';
import { guardBackend } from '../src/infrastructure/backend-guard.js';
import { writeSetting } from '../src/infrastructure/settings.js';
import { parse } from 'yaml';
import type {
    ProcessExecutor,
    ProcessRequest,
} from '../src/infrastructure/live-process.js';
import type {
    ResolvedProject,
    ServiceSpec,
} from '../src/domain/orchestration.js';
import type { LiveRuntime } from '../src/domain/live.js';

const spec = (): ServiceSpec => ({
    name: 'app',
    source: 'fixture.yaml',
    owner: 'app',
    kind: 'service',
    mode: 'Service',
    image: 'alpine:3.22',
    pullPolicy: 'missing',
    environment: {},
    labels: {},
    mounts: [],
    ports: [],
    expose: [],
    networks: { chs: { aliases: ['app'] } },
    aliases: ['app'],
    dns: [],
    dnsSearch: [],
    extraHosts: [],
    restart: 'unless-stopped',
    stopSeconds: 1,
    dependencies: {},
    fingerprint: 'same',
});
function inspection(directory = '/fixture') {
    return {
        configuration: {
            id: 'app',
            creationDate: '2026-10-01T12:00:00Z',
            labels: {
                'chs.dev.project': appleNamespace(directory),
                'chs.dev.directory': directory,
                'chs.dev.runtime': 'apple',
                'chs.dev.backend': 'native',
                'chs.dev.instance': 'one',
                'chs.dev.service': 'app',
                'chs.dev.kind': 'service',
                'chs.dev.fingerprint': 'same',
            },
            initProcess: { environment: ['PASSWORD=private-value'] },
        },
        status: {
            state: 'running',
            networks: [{ network: 'chs', ipv4Address: '192.168.64.2/24' }],
            startedDate: '2020-10-01T12:00:01Z',
        },
    };
}
function fixture(t: any) {
    return (async () => {
        const directory = await mkdtemp(join(tmpdir(), 'chs-apple-unit-'));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const calls: ProcessRequest[] = [],
            raw = inspection(directory);
        let healthCode = 0,
            jobCode = 0;
        const execute: ProcessExecutor = async (req) => {
            calls.push(req);
            assert.notEqual(req.command, 'docker');
            let output: any = '';
            switch (req.args[0]) {
                case 'list':
                    output = [raw];
                    break;
                case 'inspect':
                    output = [raw];
                    break;
                case 'exec':
                    return { code: healthCode, stdout: '', stderr: '' };
                case 'stop':
                    raw.status.state = 'stopped';
                    break;
                case 'start':
                    raw.status.state = req.args.includes('--attach')
                        ? 'stopped'
                        : 'running';
                    if (req.args.includes('--attach'))
                        return { code: jobCode, stdout: '', stderr: '' };
                    break;
            }
            return {
                code: 0,
                stdout:
                    typeof output === 'string'
                        ? output
                        : JSON.stringify(output),
                stderr: '',
            };
        };
        const adapter = new AppleRuntimeAdapter({
            directory,
            projectName: 'fixture',
            stateDirectory: directory,
            execute,
            environment: { resolve: async () => ({}) },
        });
        adapter.checkAvailability = async () => ({
            available: true,
            message: 'available',
        });
        const control = {
            incarnation: appleIncarnation(appleInspection(raw))!,
            health: { test: ['CMD', 'true'], interval: 0, retries: 2 },
            restart: 'unless-stopped',
            stopped: false,
            stopSeconds: 1,
            kind: 'service',
        };
        await privateJson(adapter.controlPath('app'), control);
        const project: ResolvedProject = {
            identity: 'fixture',
            directory,
            namespace: appleNamespace(directory),
            services: { app: spec() },
            networks: { chs: {} },
            volumes: {},
        };
        return {
            directory,
            calls,
            raw,
            adapter,
            control,
            project,
            health: (value: number) => {
                healthCode = value;
            },
            job: (value: number) => {
                jobCode = value;
            },
        };
    })();
}

test('Apple inspection accepts the pinned JSON shape and rejects unknown schemas', () => {
    const raw = inspection(),
        item = appleInspection(raw);
    assert.equal(item.status, 'running');
    assert.equal(item.networks?.[0].ipv4Address, '192.168.64.2/24');
    assert.equal(appleIncarnation(item), '2026-10-01T12:00:00Z/one');
    assert.throws(
        () => appleInspection({ ...raw, status: { state: 'surprise' } }),
        /Unsupported Apple inspection/,
    );
    assert.match(appleMac('one'), /^02(?::[a-f0-9]{2}){5}$/);
    assert.equal(appleMac('one'), appleMac('one'));
    assert.notEqual(appleMac('one'), appleMac('two'));
});

test('Apple actions reject replaced identities and foreign exact names before mutation', async (t) => {
    const f = await fixture(t),
        container = await f.adapter.normalize(appleInspection(f.raw));
    f.raw.configuration.labels['chs.dev.instance'] = 'two';
    await assert.rejects(
        f.adapter.containers.action('stop', container, {}),
        /changed/,
    );
    assert.equal(
        f.calls.some((c) => c.args[0] === 'stop'),
        false,
    );
    f.raw.configuration.labels['chs.dev.directory'] = '/another-checkout';
    await assert.rejects(f.adapter.preflight(f.project), /already used/);
});

test('Apple health, manual stop intent and restart monitoring converge without Docker', async (t) => {
    const f = await fixture(t);
    await f.adapter.monitor({});
    assert.equal((await f.adapter.containers.list())[0].health, 'healthy');
    f.health(1);
    await f.adapter.monitor({});
    assert.equal((await f.adapter.containers.list())[0].health, 'healthy');
    await f.adapter.monitor({});
    assert.equal((await f.adapter.containers.list())[0].health, 'unhealthy');
    f.health(0);
    await f.adapter.monitor({});
    assert.equal((await f.adapter.containers.list())[0].health, 'healthy');
    const container = await f.adapter.normalize(appleInspection(f.raw));
    await f.adapter.containers.action('stop', container, {});
    f.calls.length = 0;
    await f.adapter.monitor({});
    assert.equal(
        f.calls.some((c) => c.args[0] === 'start'),
        false,
    );
    await f.adapter.containers.action('start', container, {});
    f.raw.status.state = 'stopped';
    f.calls.length = 0;
    await f.adapter.monitor({});
    assert.equal(
        f.calls.some((c) => c.args[0] === 'start'),
        true,
    );
    assert.ok(f.calls.every((c) => c.privateOutput));
    await f.adapter.close();
});

test('Apple probes share readiness work and discard results from a previous start', async (t) => {
    const f = await fixture(t);
    const original = f.adapter.client.run.bind(f.adapter.client);
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let executions = 0;
    f.adapter.client.run = async (...args) => {
        if (args[0][0] === 'exec') {
            executions++;
            await waiting;
        }
        return original(...args);
    };
    const probe = f.adapter.probe({});
    while (!executions)
        await new Promise((resolve) => {
            setTimeout(resolve, 5);
        });
    const readiness = f.adapter.containers.inspectOwned('app');
    await new Promise((resolve) => {
        setTimeout(resolve, 20);
    });
    assert.equal(executions, 1);
    f.raw.status.startedDate = '2026-10-01T12:01:00Z';
    finish();
    await Promise.all([probe, readiness]);
    assert.notEqual((await f.adapter.containers.list())[0].health, 'healthy');
    await f.adapter.probe({});
    assert.equal((await f.adapter.containers.list())[0].health, 'healthy');
});

test('Apple restart backoff survives adapter recreation', async (t) => {
    const f = await fixture(t);
    f.raw.status.state = 'stopped';
    await f.adapter.monitor({});
    const saved = JSON.parse(
        await readFile(f.adapter.controlPath('app'), 'utf8'),
    );
    assert.equal(saved.retry.count, 1);
    f.raw.status.state = 'stopped';
    f.calls.length = 0;
    const recovered = new AppleRuntimeAdapter(f.adapter.dependencies);
    await recovered.monitor({});
    assert.equal(
        f.calls.some((call) => call.args[0] === 'start'),
        false,
    );
    await recovered.close();
});

test('Apple job exit status survives sessions and missing metadata becomes drift', async (t) => {
    const f = await fixture(t);
    f.control.kind = 'job';
    await privateJson(f.adapter.controlPath('app'), f.control);
    f.job(7);
    await f.adapter.containers.action(
        'start',
        await f.adapter.normalize(appleInspection(f.raw)),
        {},
    );
    assert.equal((await f.adapter.containers.list())[0].exitCode, 7);
    await rm(f.adapter.controlPath('app'));
    const observed = (await f.adapter.containers.list())[0];
    assert.equal(observed.exitCode, undefined);
    assert.equal(observed.configurationIdentity, undefined);
});

test('Apple capability checks reject unsupported socket, network and allocation requirements', async (t) => {
    const f = await fixture(t);
    f.project.services.app.mounts = [
        {
            type: 'bind',
            source: '/var/run/docker.sock',
            target: '/var/run/docker.sock',
            readOnly: true,
        },
    ];
    await assert.rejects(
        f.adapter.preflight(f.project),
        /fixture.yaml: app: requires the Docker API/,
    );
    f.project.services.app = spec();
    f.project.services.app.networks.second = { aliases: [] };
    await assert.rejects(f.adapter.preflight(f.project), /one project network/);
    f.project.services.app = spec();
    f.project.services.app.restart = 'on-failure';
    await assert.rejects(f.adapter.preflight(f.project), /on-failure/);
    f.project.services.app = spec();
    f.project.services.app.ports = [
        { target: 80, published: '0', protocol: 'tcp' },
    ];
    await assert.rejects(f.adapter.preflight(f.project), /host-port/);
});

test('Apple container inspection hides credentials and identifies checkout ownership', async (t) => {
    const f = await fixture(t),
        manager = new AppleContainerManager(f.adapter);
    const details = await manager.inspect('app');
    assert.equal(details.currentProject, true);
    assert.equal(details.name, 'app');
    assert.ok(!JSON.stringify(details.inspection).includes('private-value'));
    assert.match(JSON.stringify(details.inspection), /hidden/);
});

test('Apple streaming logs validate incarnation and honor follow and zero tail', async (t) => {
    const f = await fixture(t),
        manager = new AppleContainerManager(f.adapter);
    const current = await manager.inspect('app');
    await manager.streamLogs(current, { tail: 0, follow: true }, {});
    const request = f.calls.at(-1)!;
    assert.deepEqual(request.args, ['logs', '--follow', '--tail', '0', 'app']);
    assert.equal(request.timeout, 0);
    assert.equal(request.streamPrivateOutput, true);
    await assert.rejects(
        manager.streamLogs(
            { ...current, incarnation: 'old' },
            { tail: 'all', follow: false },
            {},
        ),
        /container changed/,
    );
});

test('Apple settings select Native atomically, while backend changes require a successful stop', async (t) => {
    const f = await fixture(t),
        path = join(f.directory, 'settings.yaml');
    await writeSetting(path, 'runtime', 'apple', null);
    const config = parse(await readFile(path, 'utf8'));
    assert.equal(config.runtime, 'apple');
    assert.equal(config.orchestrator, 'native');
    let applied = 0;
    const runtime = {
        apply: async () => {
            applied++;
            return { outcome: 'success' };
        },
        stopProject: async () => ({ outcome: 'success' }),
    } as unknown as LiveRuntime;
    const docker = guardBackend(runtime, f.directory, 'docker/native'),
        apple = guardBackend(runtime, f.directory, 'apple/native');
    await docker.apply({} as any, {});
    await assert.rejects(apple.apply({} as any, {}), /Stop environment/);
    assert.equal(applied, 1);
    await docker.stopProject({});
    await apple.apply({} as any, {});
    assert.equal(applied, 2);
});

test('Apple file projections contain only declared secrets and rotate without modifying running mounts', async (t) => {
    const f = await fixture(t),
        state = new NativeState(f.directory);
    await state.initialize();
    const source = join(f.directory, 'key');
    await writeFile(source, 'first-private-key', { mode: 0o600 });
    f.project.services.app.mounts = [
        { type: 'bind', source, target: '/run/secrets/id_rsa', readOnly: true },
    ];
    const original = structuredClone(f.project);
    await adaptAppleFileMounts(f.project, f.directory);
    const first = f.project.services.app.mounts[0].source!;
    assert.equal(
        await readFile(join(first, 'id_rsa'), 'utf8'),
        'first-private-key',
    );
    await writeFile(source, 'second-private-key');
    await adaptAppleFileMounts(original, f.directory);
    assert.notEqual(original.services.app.mounts[0].source, first);
    assert.equal(
        await readFile(join(first, 'id_rsa'), 'utf8'),
        'first-private-key',
    );
    assert.ok(!first.includes('first-private-key'));
    assert.deepEqual(f.project.services.app.fileInputs, [source]);
    const unsupported = structuredClone(original);
    unsupported.services.app.mounts = [
        { type: 'bind', source, target: '/etc/arbitrary.conf', readOnly: true },
    ];
    await assert.rejects(
        adaptAppleFileMounts(unsupported, f.directory),
        /directory bind mounts/,
    );
});

test('Apple registry authentication sends the ECR password only through private stdin', async () => {
    const { AppleNativeStrategy } =
        await import('../src/infrastructure/runtimes/apple-native.js');
    const calls: ProcessRequest[] = [];
    const runtime = new AppleNativeStrategy(async (request) => {
        calls.push(request);
        const value =
            request.args[0] === 'sts'
                ? '123456789012'
                : request.args[0] === 'configure'
                  ? 'eu-west-2'
                  : request.args[0] === 'ecr'
                    ? 'fixture-private-password'
                    : '';
        return { code: 0, stdout: value, stderr: '' };
    });
    assert.equal(
        (await runtime.loginRegistry({ profiles: ['fixture'] })).outcome,
        'success',
    );
    const login = calls.find((c) => c.args[0] === 'registry')!;
    assert.equal(login.stdin, 'fixture-private-password\n');
    assert.equal(login.privateOutput, true);
    assert.ok(
        calls.every(
            (c) =>
                c.command !== 'docker' &&
                !c.args.join(' ').includes('fixture-private-password'),
        ),
    );
});
