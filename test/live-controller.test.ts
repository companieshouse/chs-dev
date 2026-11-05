import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveController } from '../src/application/live-controller.js';
import {
    LiveFailure,
    type ConfigurationRevision,
    type PreparedProject,
    type RuntimeContainer,
    type SshSecretRequirement,
} from '../src/domain/live.js';
import { logWindow, safeLog } from '../src/domain/live-logs.js';

const container = (
    service: string,
    mode: 'Service' | 'Development' | 'Mock' = 'Service',
): RuntimeContainer => ({
    service,
    mode,
    id: service,
    projectName: 'chs',
    projectDirectory: '/project',
    lifecycle: 'running',
});
function fixture(options: { autoApply?: boolean; native?: boolean } = {}) {
    let revision: ConfigurationRevision = {
        identity: 'one',
        yaml: 'one',
        inventory: [{ service: 'api', mode: 'Service' }],
    };
    let containers: RuntimeContainer[] = [];
    let aws = 'active';
    let preparationFailure: Error | undefined;
    let applyFailure: Error | undefined;
    let mismatch = false;
    let available = true;
    let lockFailure: Error | undefined;
    let sshRequired = false;
    let sshReady = false;
    let output = '';
    let hold: (() => Promise<void>) | undefined;
    const calls: string[] = [];
    const events: { event: string; fields?: Record<string, unknown> }[] = [];
    const snapshots: ConfigurationRevision[] = [];
    const resolved: ConfigurationRevision[] = [];
    const sshRequirement: SshSecretRequirement = {
        kind: 'docker-ssh-secrets',
        services: ['api'],
        keyPath: 'local/.ssh_key',
        passphrasePath: 'local/.ssh_key_passphrase',
    };
    const scheduled = new Set<() => void>();
    const prepared = (revision: ConfigurationRevision): PreparedProject => ({
        protocolVersion: 1,
        projectName: 'chs',
        projectDirectory: '/project',
        configurationIdentity: revision.identity,
        composeFiles: ['/op/compose.yaml'],
        inventory: [...revision.inventory],
        environmentRequirements: [],
        ...(sshRequired ? { sshRequirements: [sshRequirement] } : {}),
    });
    const controller = new LiveController({
        autoApply: options.autoApply,
        eventSink: (event, fields) => events.push({ event, fields }),
        runtime: {
            reconciles: options.native,
            checkAvailability: async () => ({
                available,
                message: 'Docker unavailable',
            }),
            snapshot: async () => ({
                projectName: 'chs',
                projectDirectory: '/project',
                containers: [...containers],
            }),
            apply: async (project, context) => {
                calls.push('apply');
                if (output)
                    context.onOutput?.({ stream: 'stdout', text: output });
                if (hold) await hold();
                context.signal?.throwIfAborted();
                if (applyFailure) throw applyFailure;
                containers = project.inventory.map((entry) =>
                    container(entry.service, entry.mode),
                );
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [],
                };
            },
            stopProject: async () => {
                calls.push('stopProject');
                containers = [];
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [],
                };
            },
            containerAction: async (action, targets) => {
                calls.push(
                    `${action}:${targets.map((entry) => entry.service).join(',')}`,
                );
                containers = containers.map((entry) =>
                    targets.some((target) => target.id === entry.id)
                        ? {
                              ...entry,
                              lifecycle:
                                  action === 'stop' ? 'exited' : 'running',
                              exitCode: action === 'stop' ? 143 : undefined,
                          }
                        : entry,
                );
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [],
                };
            },
            logs: async (target, { tail }) => {
                calls.push(`logs:${target.service}:${tail}`);
                return ['\x1b[32mready\x1b[0m token=abc'];
            },
            reload: async (_project, services, context) => {
                calls.push(`reload:${services.join(',')}`);
                context.signal?.throwIfAborted();
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [...services],
                };
            },
            stop: async (obsolete) => {
                calls.push(
                    `stop:${obsolete.map((entry) => entry.service).join(',')}`,
                );
                containers = containers.filter(
                    (entry) => !obsolete.some((old) => old.id === entry.id),
                );
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [],
                };
            },
        },
        preparation: {
            check: async () => {
                if (preparationFailure) throw preparationFailure;
            },
            resolve: async (revision) => {
                resolved.push(revision);
                return {
                    ...prepared(revision),
                    ...(mismatch ? { inventory: [] } : {}),
                    ...(sshRequired
                        ? { sshRequirements: [sshRequirement] }
                        : {}),
                };
            },
            prepare: async (revision) => {
                calls.push('prepare');
                snapshots.push(revision);
                return prepared(revision);
            },
        },
        configuration: { read: async () => revision },
        verifyAws: async () => {
            calls.push('aws');
            return { state: aws };
        },
        ssh: {
            inspect: async (requirements) => ({
                requirements: [...requirements],
                keyState: sshReady ? 'valid' : 'missing',
                passphraseState: sshReady ? 'valid' : 'missing',
                ready: sshReady,
                message: 'SSH setup required.',
            }),
            setup: async () => {
                calls.push('ssh-setup');
                sshReady = true;
            },
        },
        lock: {
            acquire: async () => {
                calls.push('lock');
                if (lockFailure) throw lockFailure;
                return async () => {
                    calls.push('unlock');
                };
            },
        },
        clock: {
            now: () => new Date(0),
            schedule: (callback, delay) => {
                assert.equal(delay, 250);
                scheduled.add(callback);
                return () => {
                    scheduled.delete(callback);
                };
            },
        },
    });
    return {
        controller,
        rejectLock: (error: Error) => {
            lockFailure = error;
        },
        calls,
        events,
        snapshots,
        resolved,
        edit: (identity: string, inventory = revision.inventory) => {
            revision = { identity, yaml: identity, inventory };
        },
        containers: (next: RuntimeContainer[]) => {
            containers = next;
        },
        aws: (state: string) => {
            aws = state;
        },
        unsupported: () => {
            preparationFailure = new LiveFailure(
                'Upgrade CLI to runtime protocol 1.',
                'blocked',
            );
        },
        fail: (failure?: Error) => {
            applyFailure = failure;
        },
        mismatch: () => {
            mismatch = true;
        },
        unavailable: () => {
            available = false;
        },
        requireSsh: () => {
            sshRequired = true;
        },
        output: (text: string) => {
            output = text;
        },
        hold: (fn: () => Promise<void>) => {
            hold = fn;
        },
        flush: () => {
            for (const callback of [...scheduled]) {
                scheduled.delete(callback);
                callback();
            }
        },
    };
}
async function settle() {
    for (let index = 0; index < 50; index++) await Promise.resolve();
}
/** Starts the environment, confirming the plan when it would stop services. */
async function start(f: ReturnType<typeof fixture>) {
    await f.controller.start();
    if (f.controller.getSnapshot().plan) f.controller.confirmStart();
    await settle();
}
const applies = (f: ReturnType<typeof fixture>) =>
    f.calls.filter((call) => call === 'apply').length;

test('starts stopped; saves while stopped do nothing; a plan that stops others waits for confirmation', async () => {
    const f = fixture();
    f.containers([container('old')]);
    f.controller.saved();
    f.flush();
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.deepEqual(f.calls, []);
    await f.controller.start();
    assert.deepEqual(f.controller.getSnapshot().plan, {
        start: ['api'],
        stop: ['old'],
        recreate: [],
    });
    assert.match(f.controller.getSnapshot().message, /stop 1 running service/);
    f.controller.dismissPlan();
    assert.equal(f.controller.getSnapshot().plan, undefined);
    assert.equal(f.controller.getSnapshot().running, false);
    assert.deepEqual(f.calls, ['lock']);
    assert.equal(f.controller.getIntent().lastRead, 'one');
    assert.equal(f.resolved.length, 1);
    assert.ok(Object.isFrozen(f.resolved[0]));
    assert.ok(Object.isFrozen(f.resolved[0].inventory));
    assert.ok(Object.isFrozen(f.resolved[0].inventory[0]));
    assert.ok(f.events.some(({ event }) => event === 'live.revision'));
    await f.controller.shutdown();
    assert.equal(f.calls.at(-1), 'unlock');
});

test('starting with nothing to stop runs immediately without confirmation', async () => {
    const f = fixture();
    await f.controller.start();
    assert.equal(f.controller.getSnapshot().plan, undefined);
    await settle();
    const state = f.controller.getSnapshot();
    assert.equal(state.running, true);
    assert.equal(state.phase, 'Running');
    assert.equal(state.action, 'start');
    assert.equal(applies(f), 1);
    await f.controller.shutdown();
});

test('SSH setup blocks start before AWS and continues the start after setup', async () => {
    const f = fixture();
    f.requireSsh();
    await f.controller.start();
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'ssh');
    assert.equal(f.controller.getSnapshot().sshSetup?.keyState, 'missing');
    assert.deepEqual(f.calls, ['lock']);

    assert.equal(
        await f.controller.setupSsh({
            keyPath: '/home/test/.ssh/id_ed25519',
            passphrase: '',
            replace: false,
        }),
        true,
    );
    await settle();
    assert.equal(f.calls.includes('ssh-setup'), true);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(applies(f), 1);
    await f.controller.shutdown();
});

test('durable events describe lifecycle without copying child output or errors', async () => {
    const f = fixture();
    f.output('SECRET child output');
    await start(f);
    await f.controller.stop();
    await f.controller.shutdown();
    assert.ok(
        f.events.some(
            ({ event, fields }) =>
                event === 'live.lock' && fields?.status === 'acquired',
        ),
    );
    assert.ok(
        f.events.some(
            ({ event, fields }) =>
                event === 'live.lock' && fields?.status === 'released',
        ),
    );
    assert.ok(
        f.events.some(
            ({ event, fields }) =>
                event === 'live.recovery' && fields?.status === 'success',
        ),
    );
    assert.ok(f.events.some(({ event }) => event === 'live.preview'));
    assert.doesNotMatch(JSON.stringify(f.events), /SECRET/);
    const failed = fixture();
    failed.fail(new Error('SECRET YAML parse snippet'));
    await start(failed);
    assert.ok(
        failed.events.some(
            ({ event, fields }) =>
                event === 'live.recovery' && fields?.status === 'failed',
        ),
    );
    assert.equal(failed.controller.getSnapshot().phase, 'Failed');
    assert.doesNotMatch(JSON.stringify(failed.events), /SECRET/);
    await failed.controller.shutdown();
});

test('confirming rereads configuration and an unsupported CLI blocks the start', async () => {
    const f = fixture();
    f.containers([container('old')]);
    await f.controller.start();
    f.edit('two', [{ service: 'mock', mode: 'Mock' }]);
    f.controller.confirmStart();
    await settle();
    assert.equal(f.snapshots[0].identity, 'two');
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    await f.controller.shutdown();
    assert.equal(f.calls.at(-1), 'unlock');
    const old = fixture();
    old.unsupported();
    await old.controller.start();
    assert.equal(old.controller.getSnapshot().phase, 'Blocked');
    old.controller.confirmStart();
    assert.equal(old.controller.getSnapshot().running, false);
});

test('AWS expired blocks preparation; successful login recovers only while running', async () => {
    const f = fixture();
    f.aws('expired');
    await start(f);
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'aws');
    assert.equal(f.calls.includes('prepare'), false);
    f.aws('active');
    await f.controller.loginSucceeded('aws');
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    await f.controller.stop();
    const count = f.calls.length;
    await f.controller.loginSucceeded('registry');
    await settle();
    assert.equal(f.calls.length, count);
});

test('stop-only work preserves shared/base services and needs neither AWS nor preparation', async () => {
    const f = fixture();
    f.containers([container('api'), container('old')]);
    f.aws('unavailable');
    await start(f);
    assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.calls.includes('aws'), false);
    assert.ok(f.calls.includes('stop:old'));
    assert.deepEqual(
        f.controller
            .getSnapshot()
            .observed?.containers.map((entry) => entry.service),
        ['api'],
    );
});

test('development builder helpers remain while their owner is desired', async () => {
    const f = fixture();
    f.edit('development', [{ service: 'api', mode: 'Development' }]);
    f.containers([
        container('api', 'Development'),
        { ...container('api-builder'), ownerService: 'api' },
        container('obsolete'),
    ]);
    f.aws('expired');
    await start(f);
    assert.deepEqual(
        f.controller
            .getSnapshot()
            .observed?.containers.map((entry) => entry.service),
        ['api', 'api-builder'],
    );
    assert.ok(f.calls.includes('stop:obsolete'));
    assert.equal(f.calls.includes('aws'), false);
});

test('rapid edits coalesce and active immutable revision is not changed by queued saves', async () => {
    const f = fixture();
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    await start(f);
    assert.equal(f.controller.getSnapshot().busy, true);
    f.edit('two');
    f.controller.saved();
    f.edit('three', [{ service: 'api', mode: 'Development' }]);
    f.controller.saved();
    f.flush();
    assert.equal(applies(f), 1);
    assert.equal(f.snapshots[0].identity, 'one');
    assert.ok(Object.isFrozen(f.snapshots[0].inventory[0]));
    f.hold(async () => {});
    release();
    await settle();
    assert.deepEqual(
        f.snapshots.map((revision) => revision.identity),
        ['one', 'three'],
    );
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('stopping cancels the current operation, drops queued work, stops containers and releases the lock', async () => {
    const f = fixture();
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    await start(f);
    f.edit('two');
    f.controller.saved();
    f.flush();
    const stopping = f.controller.stop();
    release();
    await stopping;
    await settle();
    const state = f.controller.getSnapshot();
    assert.equal(applies(f), 1);
    assert.equal(state.phase, 'Stopped');
    assert.equal(state.running, false);
    assert.ok(f.calls.includes('stopProject'));
    assert.equal(f.calls.at(-1), 'unlock');
});

test('stopping removes containers but keeps volumes', async () => {
    const f = fixture();
    await start(f);
    await f.controller.stop();
    const state = f.controller.getSnapshot();
    assert.ok(f.calls.includes('stopProject'));
    assert.equal(state.phase, 'Stopped');
    assert.match(state.message, /volumes were kept/);
    assert.deepEqual(state.observed?.containers, []);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, false);
});

test('cancellation waits, refreshes partial state, and pauses until Resume', async () => {
    const f = fixture();
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    await start(f);
    f.controller.cancel();
    assert.equal(f.controller.getSnapshot().phase, 'Cancelling');
    release();
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'cancelled');
    await f.controller.loginSucceeded('registry');
    await settle();
    assert.equal(applies(f), 1);
    f.hold(async () => {});
    f.controller.retry();
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('failures do not loop, ECR requires registry login, and outside changes never block', async () => {
    const f = fixture();
    f.edit('two', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Service' },
    ]);
    f.fail(new LiveFailure('AWS + registry login required', 'ecr'));
    await start(f);
    assert.equal(f.controller.getSnapshot().blocked, 'ecr');
    await f.controller.loginSucceeded('aws');
    await settle();
    assert.equal(applies(f), 1);
    f.fail();
    await f.controller.loginSucceeded('registry');
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    f.containers([
        { ...container('api'), health: 'unhealthy' },
        container('db'),
    ]);
    await f.controller.poll();
    await settle();
    assert.equal(applies(f), 2);
    f.containers([
        { ...container('api'), lifecycle: 'exited', exitCode: 0 },
        container('db'),
    ]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().changes, undefined);
    f.containers([
        { ...container('api'), lifecycle: 'exited', exitCode: 1 },
        container('db'),
    ]);
    await f.controller.poll();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, 'Running');
    assert.deepEqual(state.changes?.start, ['api']);
    assert.equal(state.changes?.edited, false);
    assert.match(
        state.logs.at(-1)!,
        /Changed outside chs-dev: api not running/,
    );
    assert.equal(applies(f), 2);
});

test('a crashed environment stays running; one stopped everywhere becomes stopped', async () => {
    const f = fixture();
    await start(f);
    f.containers([{ ...container('api'), lifecycle: 'exited', exitCode: 2 }]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, true);
    f.containers([{ ...container('api'), lifecycle: 'exited', exitCode: 143 }]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.equal(applies(f), 1);
});

test('poll detects external configuration changes, but never repeats failed revisions', async () => {
    const f = fixture();
    f.fail(new Error('Build failed'));
    await start(f);
    await f.controller.poll();
    f.flush();
    await settle();
    assert.equal(applies(f), 1);
    f.fail();
    f.edit('external');
    await f.controller.poll();
    f.flush();
    await settle();
    assert.equal(f.snapshots.at(-1)?.identity, 'external');
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('a running environment is detected at launch without applying anything', async () => {
    const f = fixture({ autoApply: false });
    f.containers([container('api')]);
    await f.controller.poll();
    let state = f.controller.getSnapshot();
    assert.equal(state.running, true);
    assert.equal(state.phase, 'Running');
    assert.equal(state.changes, undefined);
    assert.deepEqual(f.calls, []);
    f.edit('two');
    f.controller.saved();
    await settle();
    state = f.controller.getSnapshot();
    assert.equal(state.changes?.edited, true);
    assert.equal(applies(f), 0);
});

test('with auto-apply off, edits wait as pending changes until Apply', async () => {
    const f = fixture({ autoApply: false });
    await start(f);
    f.edit('two', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Service' },
    ]);
    f.controller.saved();
    f.flush();
    await settle();
    let state = f.controller.getSnapshot();
    assert.equal(applies(f), 1);
    assert.equal(state.changes?.edited, true);
    assert.deepEqual(state.changes?.start, ['db']);
    await f.controller.apply();
    await settle();
    state = f.controller.getSnapshot();
    assert.equal(applies(f), 2);
    assert.equal(state.changes, undefined);
    f.controller.setAutoApply(true);
    f.edit('three');
    f.controller.saved();
    f.flush();
    await settle();
    assert.equal(applies(f), 3);
});

test('service actions restart, stop and start containers and track services stopped by the user', async () => {
    const f = fixture();
    f.edit('two', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Service' },
    ]);
    await start(f);
    assert.deepEqual(await f.controller.serviceAction(['api'], 'restart'), {
        ok: true,
        message: 'Restarted api.',
    });
    assert.ok(f.calls.includes('restart:api'));
    assert.equal(
        (await f.controller.serviceAction(['api'], 'start')).ok,
        false,
    );
    assert.equal((await f.controller.serviceAction(['api'], 'stop')).ok, true);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().changes, undefined);
    assert.equal(f.controller.getSnapshot().running, true);
    assert.equal((await f.controller.serviceAction(['api'], 'start')).ok, true);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal(applies(f), 1);
    assert.deepEqual(await f.controller.serviceLogs('api', 50), [
        'ready token=[REDACTED]',
    ]);
    assert.ok(f.calls.includes('logs:api:50'));
});

test('reload rebuilds a running development service through a full apply', async () => {
    const f = fixture();
    assert.match(
        (await f.controller.reloadService('api')).message,
        /Start the environment/,
    );
    f.edit('two', [
        { service: 'api', mode: 'Development' },
        { service: 'db', mode: 'Service' },
    ]);
    await start(f);
    assert.match(
        (await f.controller.reloadService('db')).message,
        /not running in Development mode/,
    );
    f.calls.length = 0;
    assert.deepEqual(await f.controller.reloadService('api'), {
        ok: true,
        message: 'Rebuilt api.',
    });
    // The configuration is unchanged, yet reload still prepares and applies.
    assert.deepEqual(
        f.calls.filter((call) => call !== 'lock' && call !== 'unlock'),
        ['aws', 'prepare', 'aws', 'apply', 'reload:api', 'stop:'],
    );
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.controller.getSnapshot().message, 'Rebuilt api.');

    f.fail(new LiveFailure('compose broke'));
    const failed = await f.controller.reloadService('api');
    assert.equal(failed.ok, false);
    assert.match(failed.message, /Reload failed: compose broke/);
    f.fail(undefined);

    const pending = f.controller.reloadService('api');
    await f.controller.stop();
    const stopped = await pending;
    assert.equal(stopped.ok, false);
    await f.controller.shutdown();
});

test('logs strip terminal controls, redact secrets, truncate lines, and support follow-tail', () => {
    assert.equal(safeLog('\x1b[31mhello\x1b[0m\x00'), 'hello');
    assert.equal(safeLog('secret=abc ******'), 'secret=[REDACTED] ******');
    assert.equal(safeLog('value hidden', ['hidden']), 'value [REDACTED]');
    assert.equal(safeLog('x'.repeat(3000)).length, 2000);
    assert.deepEqual(logWindow(['one', 'two', 'three'], 2, 0), [
        'two',
        'three',
    ]);
    assert.deepEqual(logWindow(['one', 'two', 'three'], 2, 1), ['one', 'two']);
    assert.deepEqual(logWindow(['one', 'two', 'three'], 2, 99), ['one', 'two']);
});

test('unchanged saved revisions need no AWS, preparation, or restart', async () => {
    const f = fixture();
    await start(f);
    f.calls.length = 0;
    f.aws('expired');
    f.controller.saved();
    f.flush();
    await settle();
    assert.equal(f.calls.includes('aws'), false);
    assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.calls.includes('apply'), false);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('inventory discrepancies block even credential-free stop-only mutations', async () => {
    const f = fixture();
    f.containers([container('api'), container('obsolete')]);
    await f.controller.start();
    f.mismatch();
    f.controller.confirmStart();
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'mismatch');
    assert.equal(
        f.calls.some((call) => call.startsWith('stop:')),
        false,
    );
    assert.equal(f.calls.includes('prepare'), false);
});

test('Docker unavailability prevents starting before AWS or mutation', async () => {
    const f = fixture();
    f.unavailable();
    await f.controller.start();
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'unavailable');
    assert.deepEqual(f.calls, ['lock']);
    await f.controller.shutdown();
});

test('a non-auth failure after AWS recovery cannot be retried by another login', async () => {
    const f = fixture();
    f.aws('expired');
    await start(f);
    f.aws('active');
    f.fail(new Error('Build failed'));
    await f.controller.loginSucceeded('aws');
    await settle();
    assert.equal(f.controller.getSnapshot().phase, 'Failed');
    const attempts = applies(f);
    await f.controller.loginSucceeded('registry');
    await settle();
    assert.equal(applies(f), attempts);
});

test('mode drift is reported without blocking and Apply reconciles it', async () => {
    const f = fixture();
    await start(f);
    f.containers([container('api', 'Development')]);
    await f.controller.poll();
    const state = f.controller.getSnapshot();
    assert.equal(state.phase, 'Running');
    assert.deepEqual(state.changes?.modeChanged, ['api']);
    await f.controller.apply();
    await settle();
    assert.equal(applies(f), 2);
});

test('log buffer has exactly 5000 bounded timestamped lines after oversized operation output', async () => {
    const f = fixture();
    f.output(
        Array.from({ length: 5100 }, (_, index) => `line ${index}`).join('\n'),
    );
    await start(f);
    const state = f.controller.getSnapshot();
    assert.equal(state.logs.length, 5000);
    assert.ok(state.logs.every((line) => line.length <= 2000));
    assert.ok(state.logs[0].startsWith('1970-01-01T00:00:00.000Z '));
    assert.ok(state.logs.every((line) => !line.includes('line 0\n')));
    assert.match(state.logs.at(-1)!, /Completed/);
});

test('shutdown cancels an owned operation, waits for termination, releases ownership and leaves containers', async () => {
    const f = fixture();
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    await start(f);
    let stopped = false;
    const shutdown = f.controller.shutdown().then(() => {
        stopped = true;
    });
    await settle();
    assert.equal(stopped, false);
    assert.equal(f.calls.includes('unlock'), false);
    release();
    await shutdown;
    assert.equal(f.calls.at(-1), 'unlock');
    assert.equal(
        f.calls.some((call) => call.startsWith('stopProject')),
        false,
    );
});

test('native apply always evaluates resolved configuration while polling remains read-only', async () => {
    const f = fixture({ native: true });
    await f.controller.start();
    await settle();
    const first = f.calls.filter((call) => call === 'apply').length;
    await f.controller.apply();
    await settle();
    assert.equal(f.calls.filter((call) => call === 'apply').length, first + 1);
    await f.controller.poll();
    assert.equal(f.calls.filter((call) => call === 'apply').length, first + 1);
    await f.controller.shutdown();
});

test('stop starts a new progress window while keeping earlier operation logs', async () => {
    const f = fixture();
    f.output('Wait: api (service_healthy)');
    await start(f);
    const before = f.controller.getSnapshot().logSequence;
    let startOfStop: number | undefined;
    const unsubscribe = f.controller.subscribe(() => {
        const state = f.controller.getSnapshot();
        if (state.phase === 'Stopping') startOfStop = state.operationLogStart;
    });
    await f.controller.stop();
    unsubscribe();
    assert.equal(startOfStop, before);
    assert.ok(
        f.controller
            .getSnapshot()
            .logs.some((line) => line.includes('Wait: api')),
    );
    assert.ok(
        f.controller
            .getSnapshot()
            .logs.some((line) => line.includes('Stopping environment:')),
    );
});

test('container management shares the operation lock, targets an exact ID and records manual stops', async () => {
    const f = fixture();
    await start(f);
    const target = {
        id: 'selected',
        name: 'api-1',
        image: 'api:1',
        state: 'running',
        status: 'Running',
        service: 'api',
        currentProject: true,
        ports: [],
    };
    const calls: string[] = [];
    let release!: () => void;
    const manager: import('../src/domain/containers.js').ContainerManager = {
        list: async () => [],
        inspect: async () => {
            throw new Error('unused');
        },
        logs: async () => [],
        action: async (action, container) => {
            calls.push(`${action}:${container.id}`);
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return {
                outcome: 'success',
                message: 'Stopped selected container.',
            };
        },
    };
    const pending = f.controller.manageContainer(manager, target, 'stop');
    await settle();
    assert.equal(f.controller.getSnapshot().busy, true);
    const second = await f.controller.manageContainer(
        manager,
        { ...target, id: 'another' },
        'restart',
    );
    assert.equal(second.ok, false);
    assert.match(second.message, /busy/);
    assert.equal(
        (await f.controller.serviceAction(['api'], 'restart')).ok,
        false,
    );
    release();
    assert.equal((await pending).ok, true);
    assert.deepEqual(calls, ['stop:selected']);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    assert.equal(f.calls.at(-1), 'unlock');
    manager.action = async () => ({ outcome: 'success', message: 'Done' });
    await f.controller.manageContainer(
        manager,
        { ...target, currentProject: false },
        'start',
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    await f.controller.manageContainer(manager, target, 'start');
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
});

test('start cannot resolve or mutate without ownership', async () => {
    const f = fixture();
    f.rejectLock(new LiveFailure('Already owned', 'blocked'));
    await f.controller.start();
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getIntent().lastRead, undefined);
    assert.deepEqual(f.calls, ['lock']);
    assert.deepEqual(f.resolved, []);
    assert.deepEqual(f.snapshots, []);
    assert.equal(
        f.events.some(({ event }) => event === 'live.revision'),
        false,
    );
    await f.controller.shutdown();
});
