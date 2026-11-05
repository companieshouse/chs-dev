import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli, type CliDependencies } from '../src/cli/run.js';
import { parseInvocation } from '../src/cli/parse.js';
import { ClientError } from '../src/protocol/types.js';
import { daemonFixture, eventually } from './daemon-fixture.js';

async function invoke(args: string[], dependencies: CliDependencies = {}) {
    let output = '',
        errors = '';
    const code = await runCli(args, {
        ...dependencies,
        out: (text) => {
            output += text;
        },
        err: (text) => {
            errors += text;
        },
    });
    return { code, output, errors, json: () => JSON.parse(output) };
}

test('help, version and invalid arguments stay local; legacy syntax is canonicalized', async () => {
    const connect = async () => {
        throw new Error('Unexpected daemon connection');
    };
    assert.match(
        (await invoke(['--help'], { connect })).output,
        /service configure/,
    );
    assert.match(
        (await invoke(['service', 'configure', '--help'], { connect })).output,
        /--enabled/,
    );
    assert.equal(
        (await invoke(['--version', '--json'], { connect })).json().ok,
        true,
    );
    for (const args of [
        ['nonsense', '--help'],
        ['start', '--timeout', '-1'],
        ['legacy', 'up', '--no-pull'],
        ['legacy', 'reload', 'api', '--force'],
        ['legacy', 'down', '--volumes'],
        ['legacy', 'state', 'save', 'x'],
        ['service', 'configure', 'api', '--exclude', 'db', '--allow', 'db'],
    ]) {
        const result = await invoke([...args, '--json'], { connect });
        assert.equal(result.code, 2, args.join(' '));
        assert.equal(result.json().error.code, 'INVALID_USAGE');
    }
    assert.equal(
        parseInvocation(['legacy', 'services:enable', 'api']).name,
        'legacy services enable',
    );
    assert.equal(
        parseInvocation(['legacy', 'exclude', 'api', '-d']).name,
        'legacy exclusions add',
    );
    assert.equal(
        parseInvocation(['legacy', 'include', 'api']).name,
        'legacy exclusions remove',
    );
});

test('passive status succeeds while other reads report a stopped daemon', async () => {
    const connect = async () => undefined;
    const status = await invoke(['status', '--json'], { connect });
    assert.equal(status.code, 0);
    assert.deepEqual(status.json().data, { daemon: { running: false } });
    assert.equal(
        (await invoke(['service', 'list', '--json'], { connect })).code,
        1,
    );
});

test('CLI mock discovery, provider switching and scenario edits use shared daemon state', async () => {
    const f = await daemonFixture(undefined, undefined, {
        mock: {
            defaultScenario: 'success',
            scenarios: [
                { name: 'success', description: 'Normal' },
                { name: 'error', description: 'Unavailable' },
            ],
        },
    });
    try {
        const dependencies = { connect: f.client };
        const catalogue = await invoke(
            ['service', 'mocks', 'api', '--json'],
            dependencies,
        );
        assert.deepEqual(
            catalogue
                .json()
                .data.mocks[0].scenarios.map((scenario: any) => scenario.name),
            ['success', 'error'],
        );
        const selected = await invoke(
            [
                'service',
                'configure',
                'api',
                '--enabled',
                'true',
                '--provider',
                'mock',
                '--scenario',
                'error',
                '--json',
            ],
            dependencies,
        );
        assert.equal(selected.code, 0, selected.errors);
        assert.equal(selected.json().data.application, 'pending');
        await invoke(['start', '--json'], dependencies);
        await eventually(
            () => f.app.snapshot().details.api.mockScenario === 'error',
        );
        assert.equal(f.app.snapshot().details.api.mode, 'Mock');
        const changed = await invoke(
            ['service', 'configure', 'api', '--scenario', 'success', '--json'],
            dependencies,
        );
        assert.equal(changed.code, 0, changed.errors);
        assert.equal(changed.json().data.application, 'pending');
        assert.equal(f.engine.applies, 1);
        await invoke(['apply', '--json'], dependencies);
        assert.equal(f.engine.applies, 2);
        assert.match(
            (await invoke(['service', 'mocks', 'api'], dependencies)).output,
            /success \(active\)/,
        );
        assert.equal(
            (
                await invoke(
                    [
                        'service',
                        'configure',
                        'api',
                        '--scenario',
                        'missing',
                        '--json',
                    ],
                    dependencies,
                )
            ).code,
            1,
        );
        assert.equal(f.app.snapshot().details.api.mockScenario, 'success');
        assert.equal(
            (
                await invoke(
                    [
                        'service',
                        'configure',
                        'api',
                        '--provider',
                        'development',
                        '--json',
                    ],
                    dependencies,
                )
            ).code,
            0,
        );
        await eventually(
            () => f.app.snapshot().details.api.mode === 'Development',
        );
        assert.equal(
            (
                await invoke(
                    [
                        'service',
                        'configure',
                        'api',
                        '--provider',
                        'mock',
                        '--json',
                    ],
                    dependencies,
                )
            ).code,
            0,
        );
        assert.equal(f.app.snapshot().details.api.mockScenario, 'success');
    } finally {
        await f.close();
    }
});

test('CLI and legacy queries use their separate JSON contracts over the shared daemon', async () => {
    const f = await daemonFixture();
    try {
        const dependencies = { connect: f.client };
        const status = await invoke(['status', '--json'], dependencies);
        assert.match(
            (await invoke(['status'], dependencies)).output,
            /Environment: Stopped/,
        );
        assert.match(
            (await invoke(['service', 'list'], dependencies)).output,
            /Service\s+Enabled\s+Mode/,
        );
        assert.equal(status.json().version, 1);
        assert.equal(status.json().data.project.directory, f.directory);
        assert.deepEqual(
            (
                await invoke(
                    ['legacy', 'services', 'available', '-j'],
                    dependencies,
                )
            ).json(),
            { services: ['api'] },
        );
        assert.deepEqual(
            (
                await invoke(
                    ['legacy', 'modules', 'available', '-j'],
                    dependencies,
                )
            ).json(),
            { modules: ['fixture'] },
        );
        const legacy = (
            await invoke(['legacy', 'status', '-j'], dependencies)
        ).json();
        assert.deepEqual(legacy, {
            modules: [],
            services: [
                {
                    name: 'api',
                    composeStatus: 'Not running',
                    liveUpdate: false,
                    transient: false,
                },
            ],
        });
        const shown = (
            await invoke(['service', 'show', 'api', '--json'], dependencies)
        ).json();
        assert.equal(shown.ok, true);
        assert.equal(
            (
                await invoke(
                    ['service', 'show', 'missing', '--json'],
                    dependencies,
                )
            ).code,
            1,
        );
    } finally {
        await f.close();
    }
});

test('CLI reports execution failures and startup confirmation as nonzero outcomes', async () => {
    const f = await daemonFixture();
    try {
        const dependencies = { connect: f.client };
        const actual = f.stores.get(f.directory)!;
        actual.containers = [
            {
                id: 'orphan',
                service: 'orphan',
                projectName: 'fixture',
                projectDirectory: f.directory,
                lifecycle: 'running',
                mode: 'Service',
            },
        ];
        const review = await invoke(['start', '--json'], dependencies);
        assert.equal(review.code, 3);
        assert.equal(review.json().error.code, 'CONFIRMATION_REQUIRED');
        assert.deepEqual(review.json().data.plan.stop, ['orphan']);
        const detachedReview = await invoke(
            ['start', '--detach', '--json'],
            dependencies,
        );
        assert.equal(detachedReview.code, 3);
        assert.deepEqual(detachedReview.json().data.plan.stop, ['orphan']);
        const approved = await invoke(
            ['start', '--yes', '--json'],
            dependencies,
        );
        assert.equal(approved.code, 0);
        f.engine.failStop = true;
        const failed = await invoke(['stop', '--json'], dependencies);
        assert.equal(failed.code, 1);
        assert.equal(failed.json().error.code, 'ENVIRONMENT_FAILED');
        assert.equal(f.operations.list().at(-1)!.state, 'failed');
    } finally {
        await f.close();
    }
});

test('detached work survives CLI exit, and operation commands wait and cancel explicitly', async () => {
    const f = await daemonFixture();
    let release!: () => void;
    try {
        f.engine.applyGate = new Promise((resolve) => {
            release = resolve;
        });
        const dependencies = { connect: f.client };
        const accepted = await invoke(
            ['start', '--yes', '--detach', '--json'],
            dependencies,
        );
        assert.equal(accepted.code, 0);
        const id = accepted.json().operation.id;
        await eventually(() => f.engine.applies === 1);
        assert.equal(f.app.snapshot().live.busy, true);
        const cancelled = await invoke(
            ['operation', 'cancel', id, '--json'],
            dependencies,
        );
        assert.equal(cancelled.code, 0);
        assert.equal(cancelled.json().operation.state, 'cancelled');
        assert.equal(
            (await invoke(['operation', 'wait', id, '--json'], dependencies))
                .code,
            1,
        );
        assert.equal(
            (
                await invoke(['operation', 'show', id, '--json'], dependencies)
            ).json().data.state,
            'cancelled',
        );
    } finally {
        release?.();
        await f.close();
    }
});

test('wait deadlines and interrupts disconnect without cancelling accepted work', async () => {
    const f = await daemonFixture();
    let release!: () => void;
    try {
        f.engine.applyGate = new Promise((resolve) => {
            release = resolve;
        });
        const timed = await invoke(['start', '--timeout', '0.1', '--json'], {
            connect: f.client,
        });
        assert.equal(timed.code, 124);
        assert.equal(f.app.snapshot().live.busy, true);
        const id = timed.json().operation.id;
        const controller = new AbortController();
        controller.abort(
            new ClientError({ code: 'SIGINT', message: 'Disconnected' }),
        );
        assert.equal(
            (
                await invoke(['operation', 'wait', id, '--json'], {
                    connect: f.client,
                    signal: controller.signal,
                })
            ).code,
            130,
        );
        release();
        assert.equal(
            (
                await invoke(['operation', 'wait', id, '--json'], {
                    connect: f.client,
                })
            ).code,
            0,
        );
    } finally {
        release?.();
        await f.close();
    }
});

test('legacy edits stay pending across observation and daemon restart until up applies them', async () => {
    const f = await daemonFixture();
    try {
        const dependencies = { connect: f.client };
        assert.equal((await invoke(['start', '--json'], dependencies)).code, 0);
        const applied = f.engine.applies;
        assert.equal(
            (
                await invoke(
                    ['legacy', 'development', 'enable', 'api', '--json'],
                    dependencies,
                )
            ).code,
            0,
        );
        assert.equal(f.app.snapshot().live.autoApply, false);
        assert.equal(f.app.snapshot().configurationRevision, 'revision-2');
        await f.controller.poll();
        await f.restart();
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        await f.controller.poll();
        await new Promise((resolve) => {
            setTimeout(resolve, 350);
        });
        assert.equal(f.engine.applies, applied);
        assert.equal(f.app.snapshot().configurationRevision, 'revision-2');
        assert.equal(
            (await invoke(['legacy', 'up', '--yes', '--json'], dependencies))
                .code,
            0,
        );
        assert.equal(f.engine.applies, applied + 1);
        assert.equal(f.app.snapshot().live.changes, undefined);
    } finally {
        await f.close();
    }
});

test('ordinary configuration saves and later external edits wait for explicit Apply across restart', async () => {
    const f = await daemonFixture();
    try {
        const dependencies = { connect: f.client };
        await invoke(['start', '--json'], dependencies);
        const configured = await invoke(
            ['service', 'configure', 'api', '--development', 'true', '--json'],
            dependencies,
        );
        assert.equal(configured.code, 0);
        assert.equal(configured.json().data.saved, true);
        assert.equal(configured.json().data.application, 'pending');
        await f.controller.poll();
        await f.restart();
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        f.stores.get(f.directory)!.revision++;
        await f.controller.poll();
        await new Promise((resolve) => {
            setTimeout(resolve, 350);
        });
        assert.equal(f.engine.applies, 1);
        assert.equal(f.app.snapshot().live.changes?.edited, true);
        assert.equal((await invoke(['apply', '--json'], dependencies)).code, 0);
        assert.equal(f.engine.applies, 2);
    } finally {
        await f.close();
    }
});

test('legacy saves and later external edits remain pending during and after commit', async () => {
    const f = await daemonFixture();
    let release!: () => void;
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        f.engine.legacySaveGate = new Promise((resolve) => {
            release = resolve;
        });
        const operation = await client.submit('configuration.legacyEdit', {
            revision: 'revision-1',
            edit: { topic: 'development', action: 'enable', names: ['api'] },
        });
        await eventually(() =>
            f.app
                .snapshot()
                .operations.some(
                    (entry) =>
                        entry.kind === 'configuration.legacyEdit' &&
                        entry.state === 'running',
                ),
        );
        const observations = f.engine.observations;
        await f.controller.poll();
        assert.ok(f.engine.observations >= observations);
        assert.equal(f.engine.applies, 1);
        assert.equal(f.stores.get(f.directory)!.revision, 1);
        await assert.rejects(
            client.submit('settings.save', {
                key: 'project',
                value: f.second,
                revision: f.app.snapshot().settingsRevision,
            }),
            (error: any) => error.detail.code === 'BUSY',
        );
        release();
        await client.wait(operation.id);
        await f.controller.poll();
        assert.equal(f.engine.applies, 1);
        f.stores.get(f.directory)!.revision++;
        await f.controller.poll();
        assert.equal(f.engine.applies, 1);
        await client.command('environment.apply', {});
        assert.equal(f.engine.applies, 2);
    } finally {
        release?.();
        await f.close();
    }
});
