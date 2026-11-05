import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    readdir,
    rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { PortableChsAdapter } from '../src/infrastructure/native/portable-chs.js';
import type {
    RuntimeAdapter,
    ObservedContainer,
} from '../src/domain/runtime-adapter.js';
import type {
    ResolvedProject,
    ServiceSpec,
} from '../src/domain/orchestration.js';
import type { RuntimeLogEntry } from '../src/domain/runtime-strategy.js';

const service = (name: string): ServiceSpec => ({
    name,
    source: 'fixture',
    owner: name,
    kind: 'service',
    mode: 'Service',
    pullPolicy: 'missing',
    environment: {},
    labels: {},
    mounts: [],
    ports: [],
    expose: [],
    networks: { chs: { aliases: [name] } },
    aliases: [name],
    dns: [],
    dnsSearch: [],
    extraHosts: [],
    restart: 'no',
    stopSeconds: 1,
    dependencies: {},
});
async function fixture(t: any) {
    const state = await mkdtemp(join(tmpdir(), 'chs-portable-'));
    t.after(() => rm(state, { recursive: true, force: true }));
    const db: ObservedContainer = {
        id: 'db-id',
        incarnation: 'one',
        service: 'db',
        projectName: 'fixture',
        projectDirectory: state,
        lifecycle: 'running',
        kind: 'service',
        dependencies: {},
        anonymousVolumes: {},
        stopSeconds: 1,
        addresses: { chs: '192.168.64.2' },
    };
    let fail = true,
        data = 'volume-generation-one';
    const executions: string[] = [];
    const inner = {
        name: 'Fixture',
        checkAvailability: async () => ({ available: true, message: 'ok' }),
        environment: async () => ({}),
        preflight: async () => {},
        resources: { ensure: async () => {} },
        images: { prepare: async () => {} },
        containers: {
            list: async () => [db],
            inspectOwned: async () => db,
            storageIdentity: async () => data,
            exec: async (
                _id: string,
                _args: string[],
                _context: any,
                stdin: Buffer,
            ) => {
                const source = stdin.toString();
                executions.push(source);
                return {
                    code: source.includes('second') && fail ? 1 : 0,
                    stdout: '',
                    stderr: 'MongoBulkWriteError: E11000 duplicate key error; password=hidden-value',
                };
            },
        },
    } as unknown as RuntimeAdapter;
    const adapter = new PortableChsAdapter(inner, state);
    const project: ResolvedProject = {
        identity: 'fixture',
        directory: state,
        namespace: 'fixture',
        services: { db: service('db') },
        networks: { chs: {} },
        volumes: {},
    };
    return {
        state,
        db,
        project,
        inner,
        adapter,
        executions,
        succeed: () => {
            fail = false;
        },
        newData: () => {
            data = 'volume-generation-two';
        },
    };
}

async function initializationFixture(t: any, extension = 'sh') {
    const f = await fixture(t),
        scripts = join(f.state, 'scripts');
    await mkdir(scripts);
    for (const [index, source] of ['first', 'second', 'third'].entries())
        await writeFile(join(scripts, `0${index + 1}.db.${extension}`), source);
    const job = {
        ...service('execute-db-scripts'),
        kind: 'job' as const,
        initialization: {
            target: 'db',
            directory: scripts,
            suffix: 'db',
            extension,
            force: false,
        },
    };
    f.project.services[job.name] = job;
    await f.adapter.preflight(f.project);
    const task = await f.adapter.containers.create(f.project, job, {}, {});
    const checkpoints = async () => {
        const root = join(f.state, 'initialization');
        return Promise.all(
            (await readdir(root)).map(async (name) => ({
                path: join(root, name),
                value: JSON.parse(await readFile(join(root, name), 'utf8')),
            })),
        );
    };
    return { ...f, scripts, job, task, checkpoints };
}

for (const extension of ['sh', 'js'])
    test(`portable ${extension} initialization continues after script errors and remembers warnings across recreation`, async (t) => {
        const f = await initializationFixture(t, extension);
        const output: RuntimeLogEntry[] = [];
        await f.adapter.containers.action('start', f.task, {
            onOutput: (entry) => output.push(entry),
        });
        assert.deepEqual(f.executions, ['first', 'second', 'third']);
        const completed = await f.adapter.containers.inspectOwned(f.task.id);
        assert.equal(completed.lifecycle, 'exited');
        assert.equal(completed.exitCode, 0);
        const logs = (await f.adapter.containers.logs(f.task.id, 20)).join(
            '\n',
        );
        assert.ok(logs.includes(join(f.scripts, `02.db.${extension}`)));
        assert.match(logs, /initialization exited 1; continuing/);
        assert.match(logs, /E11000 duplicate key error/);
        assert.match(logs, /completed with warnings.*1 of 3 scripts/);
        assert.ok(output.some((entry) => entry.stream === 'stderr'));
        assert.ok(!JSON.stringify(output).includes('hidden-value'));
        const checkpoints = await f.checkpoints();
        assert.deepEqual(
            checkpoints.map((c) => c.value.exitCode).sort(),
            [0, 0, 1],
        );
        assert.ok(!JSON.stringify(checkpoints).includes('hidden-value'));

        // Restarting the daemon or recreating the task must retain attempted-script history.
        const restored = new PortableChsAdapter(f.inner, f.state);
        await restored.preflight(f.project);
        const recreated = await restored.containers.create(
            f.project,
            f.job,
            {},
            {},
        );
        f.succeed();
        await restored.containers.action('start', recreated, {});
        assert.deepEqual(f.executions, ['first', 'second', 'third']);
        const repeated = (
            await restored.containers.logs(recreated.id, 20)
        ).join('\n');
        assert.match(
            repeated,
            /previously exited 1; skipping unchanged script/,
        );
        assert.match(repeated, /E11000 duplicate key error/);
        assert.match(repeated, /completed with warnings.*1 of 3 scripts/);
    });

test('portable initialization reruns changed scripts, forced attempts and replaced data', async (t) => {
    const f = await initializationFixture(t);
    await f.adapter.containers.action('start', f.task, {});
    f.succeed();
    await writeFile(join(f.scripts, '02.db.sh'), 'second edited');
    await f.adapter.containers.action('start', f.task, {});
    assert.deepEqual(f.executions, [
        'first',
        'second',
        'third',
        'second edited',
    ]);
    assert.ok((await f.checkpoints()).every((c) => c.value.exitCode === 0));
    assert.doesNotMatch(
        (await f.adapter.containers.logs(f.task.id, 20)).join('\n'),
        /Warning:/,
    );
    f.job.initialization.force = true;
    const forced = await f.adapter.containers.create(f.project, f.job, {}, {});
    await f.adapter.containers.action('start', forced, {});
    assert.deepEqual(f.executions.slice(4), [
        'first',
        'second edited',
        'third',
    ]);
    f.job.initialization.force = false;
    const task = await f.adapter.containers.create(f.project, f.job, {}, {});
    f.newData();
    await f.adapter.containers.action('start', task, {});
    assert.deepEqual(f.executions.slice(7), [
        'first',
        'second edited',
        'third',
    ]);
});

test('portable initialization still accepts success-only checkpoints', async (t) => {
    const f = await initializationFixture(t);
    f.succeed();
    await f.adapter.containers.action('start', f.task, {});
    for (const { path, value } of await f.checkpoints())
        await writeFile(path, JSON.stringify({ digest: value.digest }));
    await f.adapter.containers.action('start', f.task, {});
    assert.deepEqual(f.executions, ['first', 'second', 'third']);
    assert.doesNotMatch(
        (await f.adapter.containers.logs(f.task.id, 20)).join('\n'),
        /Warning:/,
    );
});

test('portable initialization ignores mount order and migrates legacy storage checkpoints', async (t) => {
    const f = await initializationFixture(t);
    let storage = [
        ['/data/db', 'db-volume', 'first-generation'],
        ['/data/configdb', 'config-volume', 'first-generation'],
    ];
    f.inner.containers.storageIdentity = async () => storage;
    const hash = (value: string) =>
        createHash('sha256').update(value).digest('hex');
    const ledger = join(f.state, 'initialization');
    await mkdir(ledger);
    for (const name of await readdir(f.scripts)) {
        const path = join(f.scripts, name);
        const contents = (await readFile(path)).toString('base64');
        await writeFile(
            join(ledger, hash(`db:${path}`) + '.json'),
            JSON.stringify({
                digest: hash(contents + JSON.stringify(storage)),
            }),
        );
    }
    await f.adapter.containers.action('start', f.task, {});
    assert.deepEqual(f.executions, []);
    storage = [...storage].reverse();
    await f.adapter.containers.action('start', f.task, {});
    assert.deepEqual(f.executions, []);
    storage[0] = [storage[0][0], storage[0][1], 'new-generation'];
    f.succeed();
    await f.adapter.containers.action('start', f.task, {});
    assert.deepEqual(f.executions, ['first', 'second', 'third']);
});

for (const failure of [
    'execution',
    'timeout',
    'cancellation',
    'target stopped',
    'target changed',
    'runtime lost',
])
    test(`portable initialization does not checkpoint an interrupted attempt: ${failure}`, async (t) => {
        const f = await initializationFixture(t);
        const abort = new AbortController();
        const execute = f.inner.containers.exec!;
        const inspect = f.inner.containers.inspectOwned;
        // The fixture's observation must be a snapshot, as it is with real adapters.
        f.inner.containers.list = async () => [{ ...f.db }];
        f.inner.containers.exec = async (id, args, context, stdin) => {
            const result = await execute(id, args, context, stdin);
            if (stdin?.toString() === 'second') {
                if (failure === 'execution')
                    throw new Error('Runtime execution failed');
                if (failure === 'timeout') throw new Error('Command timed out');
                if (failure === 'cancellation')
                    abort.abort(new Error('Operation cancelled'));
                if (failure === 'target stopped') f.db.lifecycle = 'exited';
                if (failure === 'target changed')
                    f.db.incarnation = 'replacement';
                if (failure === 'runtime lost')
                    f.inner.containers.inspectOwned = async () => {
                        throw new Error('Runtime unavailable');
                    };
            }
            return result;
        };
        await assert.rejects(
            f.adapter.containers.action('start', f.task, {
                signal: abort.signal,
            }),
        );
        assert.deepEqual(f.executions, ['first', 'second']);
        assert.equal((await f.checkpoints()).length, 1);
        assert.equal(
            (await f.adapter.containers.inspectOwned(f.task.id)).exitCode,
            1,
        );

        f.inner.containers.exec = execute;
        f.inner.containers.inspectOwned = inspect;
        f.db.lifecycle = 'running';
        f.succeed();
        await f.adapter.containers.action('start', f.task, {});
        assert.deepEqual(f.executions, ['first', 'second', 'second', 'third']);
        assert.equal(
            (await f.adapter.containers.inspectOwned(f.task.id)).exitCode,
            0,
        );
    });

test('portable discovery generates valid empty config and updates route/monitor targets from observed services', async (t) => {
    const f = await fixture(t);
    await f.adapter.preflight(f.project);
    await f.adapter.publish({});
    const routes = join(f.state, 'discovery', 'routes', 'routes.yaml');
    assert.deepEqual(parse(await readFile(routes, 'utf8')), {});
    Object.assign(f.project.services.db, {
        labels: {
            'traefik.http.routers.fixture.rule': 'Host(`fixture.test`)',
            'traefik.http.services.fixture.loadbalancer.server.port': '8080',
        },
        expose: ['8080'],
    });
    await f.adapter.preflight(f.project);
    await f.adapter.publish({});
    const config = parse(await readFile(routes, 'utf8'));
    assert.equal(config.http.routers.fixture.service, 'fixture');
    assert.equal(
        config.http.services.fixture.loadBalancer.servers[0].url,
        'http://db:8080',
    );
    assert.equal(config.http.middlewares, undefined);
    const targets = JSON.parse(
        await readFile(
            join(f.state, 'discovery', 'targets', 'targets.json'),
            'utf8',
        ),
    );
    assert.deepEqual(targets[0].targets, ['192.168.64.2:8080']);
    f.db.lifecycle = 'exited';
    await f.adapter.publish({});
    assert.deepEqual(parse(await readFile(routes, 'utf8')), {});
    f.project.services.db.labels = { 'traefik.unsupported': 'true' };
    await assert.rejects(
        f.adapter.preflight(f.project),
        /unsupported native routing label/,
    );
});

test('Docker discovery leaves network aliases and per-container host overrides to Docker', async (t) => {
    const f = await fixture(t);
    const eric = service('eric');
    eric.networks.chs.aliases.push('account.chs.local', 'shared');
    const auth = service('authentication-service');
    auth.networks.chs.aliases.push('shared');
    auth.extraHosts = ['account.chs.local:host-gateway', 'internal:192.0.2.1'];
    auth.expose = ['8080'];
    auth.labels = {
        'traefik.http.routers.auth.rule': 'Host(`account.chs.local`)',
        'traefik.http.services.auth.loadbalancer.server.port': '8080',
    };
    const other = service('other');
    other.extraHosts = ['internal:192.0.2.2'];
    const specs = [eric, auth, other, service('ingress-proxy')];
    f.project.services = Object.fromEntries(
        specs.map((spec) => [spec.name, spec]),
    );
    const observed = specs.map((spec, index) => ({
        ...f.db,
        id: `${spec.name}-id`,
        service: spec.name,
        addresses: { chs: `192.0.2.${index + 10}` },
    }));
    f.inner.containers.list = async () => observed;
    const before = JSON.stringify(specs);
    await f.adapter.preflight(f.project);
    await f.adapter.publish({});
    assert.equal(JSON.stringify(specs), before);
    const routes = parse(
        await readFile(
            join(f.state, 'discovery', 'routes', 'routes.yaml'),
            'utf8',
        ),
    );
    assert.equal(routes.http.routers.auth.rule, 'Host(`account.chs.local`)');
    assert.deepEqual(routes.http.services.auth.loadBalancer.servers, [
        { url: 'http://authentication-service:8080' },
    ]);
    const targets = JSON.parse(
        await readFile(
            join(f.state, 'discovery', 'targets', 'targets.json'),
            'utf8',
        ),
    );
    assert.deepEqual(targets[0].targets, ['192.0.2.11:8080']);
    await assert.rejects(readFile(join(f.state, 'discovery', 'dns', 'hosts')), {
        code: 'ENOENT',
    });

    // Publication must also work while containers are starting or stopping.
    observed.find((c) => c.service === 'ingress-proxy')!.lifecycle = 'exited';
    await f.adapter.publish({});
    observed.find((c) => c.service === 'authentication-service')!.lifecycle =
        'exited';
    await f.adapter.publish({});
    assert.deepEqual(
        parse(
            await readFile(
                join(f.state, 'discovery', 'routes', 'routes.yaml'),
                'utf8',
            ),
        ),
        {},
    );
});

test('Apple discovery still validates the aliases in its generated DNS records', async (t) => {
    const f = await fixture(t);
    const other = service('other');
    other.networks.chs.aliases.push('db');
    f.project.services.other = other;
    f.inner.containers.list = async () => [
        f.db,
        {
            ...f.db,
            id: 'other-id',
            service: 'other',
            addresses: { chs: '192.168.64.3' },
        },
    ];
    const adapter = new PortableChsAdapter(f.inner, f.state, true);
    await adapter.preflight(f.project);
    await assert.rejects(
        adapter.publish({}),
        /Conflicting project DNS alias db/,
    );
});
