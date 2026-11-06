import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveController } from '../src/application/live-controller.js';
import {
    LiveFailure,
    LifecycleBlocked,
    previewChanges,
    type ConfigurationRevision,
    type PreparationExclusion,
    type PreparedProject,
    type RuntimeContainer,
    type RuntimeOperationResult,
    type SshSecretRequirement,
} from '../src/domain/live.js';
import { logWindow, safeLog } from '../src/domain/live-logs.js';

test('a created lazy container is not a pending start in the preview', () => {
    const revision: ConfigurationRevision = {
        identity: 'one',
        yaml: 'one',
        inventory: [
            { service: 'api', mode: 'Service' },
            { service: 'worker', mode: 'Service', lazy: true },
        ],
    };
    const created = { ...container('worker'), lifecycle: 'created' };
    const preview = previewChanges(revision, {
        projectName: 'chs',
        projectDirectory: '/project',
        containers: [container('api'), created],
    });
    assert.deepEqual(preview.start, []);
});

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
    policy: { version: 1, lazy: false, reclaimable: false, dependencies: [] },
});
function fixture(options: { ssh?: boolean; exclusiveLock?: boolean } = {}) {
    let revision: ConfigurationRevision = {
        identity: 'one',
        yaml: 'one',
        inventory: [{ service: 'api', mode: 'Service' }],
    };
    let containers: RuntimeContainer[] = [];
    let stopRemainder: RuntimeContainer[] | undefined;
    let stopFailure: Error | undefined;
    let observationFailure: unknown;
    let activationIgnored = false;
    let actionResult: RuntimeOperationResult | undefined;
    let aws = 'active';
    let awsSequence: string[] = [];
    let preparationFailure: Error | undefined;
    let applyFailure: unknown;
    let applyFailureArmed = false;
    let mismatch = false;
    let resolvedChanges: Partial<PreparedProject> = {};
    let preparedChanges: Partial<PreparedProject> = {};
    let available = true;
    let lockFailure: Error | undefined;
    let leaseHeld = false;
    let sshRequired = false;
    let sshReady = false;
    let sshHold: Promise<void> | undefined;
    let sshFailure: unknown;
    let sshFailureArmed = false;
    let output = '';
    let hold: (() => Promise<void>) | undefined;
    let observation: ((signal?: AbortSignal) => Promise<void>) | undefined;
    let partialPrepare = false;
    let partialExclusions: PreparationExclusion[] | undefined;
    let partialUnattributable: string[] | undefined;
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
    /** Durable start: prepare excludes services whose variables are missing. */
    const partiallyPrepared = (
        revision: ConfigurationRevision,
    ): PreparedProject => ({
        ...prepared(revision),
        inventory: revision.inventory.filter(
            (entry) =>
                !(partialExclusions ?? []).some((exclusion) =>
                    exclusion.services.includes(entry.service),
                ),
        ),
        ...(partialExclusions?.length ? { exclusions: partialExclusions } : {}),
        ...(partialUnattributable
            ? { unattributable: partialUnattributable }
            : {}),
    });
    const lock = {
        acquire: async () => {
            calls.push('lock');
            if (lockFailure) throw lockFailure;
            if (options.exclusiveLock && leaseHeld)
                throw new LiveFailure('Environment already owned', 'blocked');
            leaseHeld = true;
            return async () => {
                calls.push('unlock');
                leaseHeld = false;
            };
        },
    };
    const controller = new LiveController({
        eventSink: (event, fields) => events.push({ event, fields }),
        runtime: {
            checkAvailability: async () => ({
                available,
                message: 'Docker unavailable',
            }),
            snapshot: async (signal) => {
                await observation?.(signal);
                if (observationFailure) throw observationFailure;
                return {
                    projectName: 'chs',
                    projectDirectory: '/project',
                    containers: [...containers],
                };
            },
            startApplied: async (service, context, action = 'start') => {
                context.signal?.throwIfAborted();
                calls.push(`activate:${action}:${service}`);
                if (!activationIgnored)
                    containers = containers.map((entry) => ({
                        ...entry,
                        lifecycle: 'running',
                    }));
                return {
                    outcome: 'success',
                    message: 'Started',
                    affectedServices: [service],
                };
            },
            apply: async (project, context) => {
                calls.push('apply');
                if (output)
                    context.onOutput?.({ stream: 'stdout', text: output });
                if (hold) await hold();
                context.signal?.throwIfAborted();
                if (applyFailureArmed) throw applyFailure;
                containers = project.inventory.map((entry) =>
                    context.stoppedServices?.includes(entry.service)
                        ? {
                              ...container(entry.service, entry.mode),
                              lifecycle: 'exited',
                              exitCode: 143,
                          }
                        : container(entry.service, entry.mode),
                );
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [],
                };
            },
            stopProject: async () => {
                calls.push('stopProject');
                containers = stopRemainder ?? [];
                if (stopFailure) throw stopFailure;
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
                return (
                    actionResult ?? {
                        outcome: 'success',
                        message: '',
                        affectedServices: [],
                    }
                );
            },
            logs: async (target, { tail }) => {
                calls.push(`logs:${target.id}:${tail}`);
                return ['\x1b[32mready\x1b[0m token=abc'];
            },
            reloadApplied: async (service, context) => {
                calls.push(`reload:${service}`);
                if (hold) await hold();
                context.signal?.throwIfAborted();
                if (applyFailureArmed) throw applyFailure;
                return {
                    outcome: 'success',
                    message: '',
                    affectedServices: [service],
                };
            },
            stop: async (obsolete) => {
                calls.push(
                    `stop:${obsolete.map((entry) => entry.service).join(',')}`,
                );
                containers =
                    stopRemainder ??
                    containers.filter(
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
                    ...resolvedChanges,
                };
            },
            prepare: async (revision) => {
                calls.push('prepare');
                snapshots.push(revision);
                return {
                    ...(partialPrepare
                        ? partiallyPrepared(revision)
                        : prepared(revision)),
                    ...preparedChanges,
                };
            },
        },
        configuration: { read: async () => revision },
        verifyAws: async () => {
            calls.push('aws');
            return { state: awsSequence.shift() ?? aws };
        },
        ssh:
            options.ssh === false
                ? undefined
                : {
                      inspect: async (requirements) => ({
                          requirements: [...requirements],
                          keyState: sshReady ? 'valid' : 'missing',
                          passphraseState: sshReady ? 'valid' : 'missing',
                          ready: sshReady,
                          message: 'SSH setup required.',
                      }),
                      setup: async () => {
                          calls.push('ssh-setup');
                          await sshHold;
                          if (sshFailureArmed) throw sshFailure;
                          sshReady = true;
                      },
                  },
        lock,
        clock: {
            now: () => new Date(0),
        },
    });
    return {
        controller,
        claimEnvironment: () => lock.acquire(),
        ignoreActivation: () => {
            activationIgnored = true;
        },
        actionResult: (result: RuntimeOperationResult) => {
            actionResult = result;
        },
        failObservation: (error: unknown) => {
            observationFailure = error;
        },
        stopLeaves: (next: RuntimeContainer[], error?: Error) => {
            stopRemainder = next;
            stopFailure = error;
        },
        observe: (fn: (signal?: AbortSignal) => Promise<void>) => {
            observation = fn;
        },
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
        awsSequence: (states: string[]) => {
            awsSequence = [...states];
        },
        unsupported: () => {
            preparationFailure = new LiveFailure(
                'Upgrade CLI to runtime protocol 1.',
                'blocked',
            );
        },
        fail: (failure?: Error) => {
            applyFailure = failure;
            applyFailureArmed = failure !== undefined;
        },
        rejectApply: (failure: unknown) => {
            applyFailure = failure;
            applyFailureArmed = true;
        },
        mismatch: () => {
            mismatch = true;
        },
        drift: (
            stage: 'resolve' | 'prepare',
            changes: Partial<PreparedProject>,
        ) => {
            if (stage === 'resolve') resolvedChanges = changes;
            else preparedChanges = changes;
        },
        partial: (
            exclusions?: PreparationExclusion[],
            unattributable?: string[],
        ) => {
            partialExclusions = exclusions;
            partialUnattributable = unattributable;
            partialPrepare =
                exclusions !== undefined || unattributable !== undefined;
        },
        unavailable: () => {
            available = false;
        },
        requireSsh: () => {
            sshRequired = true;
        },
        holdSsh: (gate: Promise<void>) => {
            sshHold = gate;
        },
        rejectSsh: (failure: unknown) => {
            sshFailure = failure;
            sshFailureArmed = true;
        },
        output: (text: string) => {
            output = text;
        },
        hold: (fn: () => Promise<void>) => {
            hold = fn;
        },
    };
}

test('mock-only environments start and change scenarios without requesting AWS authentication', async () => {
    const f = fixture();
    f.aws('expired');
    const inventory = [
        { service: 'api', mode: 'Mock' as const, mockScenario: 'success' },
        { service: 'ingress-proxy', mode: 'Service' as const },
        { service: 'chs-dev-microcks', mode: 'Mock' as const },
    ];
    f.edit('mock-one', inventory);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.calls.includes('aws'), false);
    f.edit(
        'mock-two',
        inventory.map((entry) =>
            entry.service === 'api'
                ? { ...entry, mockScenario: 'error' }
                : entry,
        ),
    );
    f.controller.saved();
    await f.controller.apply();
    await f.controller.waitUntilIdle();
    assert.equal(f.calls.filter((call) => call === 'apply').length, 2);
    assert.equal(f.calls.includes('aws'), false);
    await f.controller.shutdown();
});

test('a scenario change is applied when the same configuration also removes another mock', async () => {
    const f = fixture();
    f.aws('expired');
    const inventory = [
        { service: 'api', mode: 'Mock' as const, mockScenario: 'success' },
        {
            service: 'other-api',
            mode: 'Mock' as const,
            mockScenario: 'success',
        },
        { service: 'ingress-proxy', mode: 'Service' as const },
        { service: 'chs-dev-microcks', mode: 'Mock' as const },
    ];
    f.edit('both-mocks', inventory);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    f.edit(
        'one-mock-with-new-scenario',
        inventory
            .filter((entry) => entry.service !== 'other-api')
            .map((entry) =>
                entry.service === 'api'
                    ? { ...entry, mockScenario: 'error' }
                    : entry,
            ),
    );
    f.controller.saved();
    await f.controller.apply();
    await f.controller.waitUntilIdle();
    assert.equal(f.calls.filter((call) => call === 'apply').length, 2);
    assert.equal(f.snapshots.at(-1)?.inventory[0].mockScenario, 'error');
    assert.equal(f.calls.includes('stop:other-api'), true);
    assert.equal(f.calls.includes('aws'), false);
    await f.controller.shutdown();
});

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
    assert.equal(f.controller.getSnapshot().autoApply, false);
    f.containers([container('old')]);
    f.controller.saved();
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

test('durable start applies with exclusions, reporting cause and remediation', async () => {
    const f = fixture();
    f.partial([
        {
            variable: 'DB_PASSWORD',
            services: ['api'],
            cause: 'DB_PASSWORD is not set',
            remediation:
                "Set DB_PASSWORD in this checkout's .env file, then apply the environment again.",
        },
    ]);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.calls.includes('prepare'), true);
    assert.equal(f.calls.includes('apply'), true);
    const state = f.controller.getSnapshot();
    assert.match(state.message, /1 service excluded/);
    assert.deepEqual(f.controller.getIntent().appliedServices, []);
    const logs = state.logs;
    assert.ok(
        logs.some((text) =>
            text.includes('Excluded api: DB_PASSWORD is not set.'),
        ),
    );
    assert.ok(
        logs.some((text) =>
            text.includes("Set DB_PASSWORD in this checkout's .env file"),
        ),
    );
    assert.deepEqual(
        state.observed?.containers.map((entry) => entry.service) ?? [],
        [],
    );
    await f.controller.shutdown();
});

test('durable start reports unattributable variables without excluding services', async () => {
    const f = fixture();
    f.partial([], ['TOP_VAR']);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    const state = f.controller.getSnapshot();
    assert.equal(state.message, 'Configuration applied.');
    assert.ok(
        state.logs.some((text) =>
            text.includes(
                'TOP_VAR is required but could not be attributed to a service',
            ),
        ),
    );
    assert.deepEqual(
        state.observed?.containers.map((entry) => entry.service) ?? [],
        ['api'],
    );
    await f.controller.shutdown();
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

test('nonempty Start prepares fresh membership even when all selected services already run', async () => {
    const f = fixture();
    f.containers([container('api'), container('old')]);
    await start(f);
    assert.equal(f.calls.includes('prepare'), true);
    assert.equal(f.calls.includes('aws'), true);
    assert.ok(f.calls.includes('stop:old'));
    assert.deepEqual(f.controller.getIntent().appliedServices, ['api']);
    assert.doesNotThrow(() => f.controller.assertTrafficAllowed('api'));
});

test('fresh reconciliation keeps desired owner helpers out of obsolete-container cleanup', async () => {
    const f = fixture();
    f.edit('development', [{ service: 'api', mode: 'Development' }]);
    f.containers([
        container('api', 'Development'),
        { ...container('api-builder'), ownerService: 'api' },
        container('obsolete'),
    ]);
    await start(f);
    assert.ok(f.calls.includes('stop:obsolete'));
    assert.equal(
        f.calls.some(
            (call) => call.startsWith('stop:') && call.includes('api-builder'),
        ),
        false,
    );
    assert.equal(f.calls.includes('prepare'), true);
});

test('saves during Apply preserve its immutable input and wait for the next explicit Apply', async () => {
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
    assert.equal(applies(f), 1);
    assert.equal(f.snapshots[0].identity, 'one');
    assert.ok(Object.isFrozen(f.snapshots[0].inventory[0]));
    f.hold(async () => {});
    release();
    await settle();
    assert.deepEqual(
        f.snapshots.map((revision) => revision.identity),
        ['one'],
    );
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().changes?.edited, true);
    await f.controller.apply();
    assert.deepEqual(
        f.snapshots.map((revision) => revision.identity),
        ['one', 'three'],
    );
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

test('observing externally stopped containers preserves explicit running intent', async () => {
    const f = fixture();
    await start(f);
    f.containers([{ ...container('api'), lifecycle: 'exited', exitCode: 2 }]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, true);
    f.containers([{ ...container('api'), lifecycle: 'exited', exitCode: 143 }]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, true);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0].exitCode,
        143,
    );
    assert.deepEqual(f.controller.getSnapshot().changes?.start, ['api']);
    assert.equal(applies(f), 1);
});

test('poll stages external configuration changes without retrying failed revisions', async () => {
    const f = fixture();
    f.fail(new Error('Build failed'));
    await start(f);
    await f.controller.poll();
    await settle();
    assert.equal(applies(f), 1);
    f.fail();
    f.edit('external');
    await f.controller.poll();
    await settle();
    assert.equal(f.snapshots.at(-1)?.identity, 'one');
    assert.equal(f.controller.getSnapshot().phase, 'Failed');
    assert.equal(f.controller.getSnapshot().changes?.edited, false);
    await f.controller.apply();
    assert.equal(f.snapshots.at(-1)?.identity, 'external');
});

test('external containers are observed at launch without adopting running intent', async () => {
    const f = fixture();
    f.containers([container('api')]);
    await f.controller.poll();
    let state = f.controller.getSnapshot();
    assert.equal(state.running, false);
    assert.equal(state.phase, 'Stopped');
    assert.deepEqual(state.observed?.containers, [container('api')]);
    assert.equal(state.changes, undefined);
    assert.deepEqual(f.calls, []);
    f.edit('two');
    f.controller.saved();
    await settle();
    state = f.controller.getSnapshot();
    assert.equal(state.changes, undefined);
    assert.equal(state.running, false);
    assert.equal(applies(f), 0);
});

test('external containers cannot release explicit environment stop intent', async () => {
    const f = fixture();
    await start(f);
    await f.controller.stop();
    f.containers([container('api')]);
    await f.controller.poll();
    await f.controller.probe();
    const state = f.controller.getSnapshot();
    assert.deepEqual(state.observed?.containers, [container('api')]);
    assert.equal(state.running, false);
    assert.equal(state.phase, 'Stopped');
    assert.equal(state.changes, undefined);
    assert.equal(applies(f), 1);
    assert.equal(
        (await f.controller.coldStart('api', Date.now() + 1000)).ok,
        false,
    );
});

test('health snapshots refresh during Apply without taking lifecycle ownership', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    const applying = f.controller.apply();
    await settle();
    f.calls.length = 0;
    f.containers([{ ...container('api'), health: 'unhealthy' }]);
    await f.controller.probe();
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0].health,
        'unhealthy',
    );
    assert.deepEqual(f.calls, []);
    release();
    await applying;
});

test('cancelling a health snapshot discards its late observation', async () => {
    const f = fixture();
    await start(f);
    const abort = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    f.observe(
        (signal) =>
            new Promise<void>((resolve) => {
                signal!.addEventListener('abort', () => resolve(), {
                    once: true,
                });
                entered();
            }),
    );
    f.containers([{ ...container('api'), health: 'unhealthy' }]);
    const probing = f.controller.probe(abort.signal);
    await started;
    abort.abort();
    await probing;
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0].health,
        undefined,
    );
    assert.equal(f.controller.getSnapshot().running, true);
});

test('saved edits wait for Apply and ordinary Apply preserves manual stops', async () => {
    const f = fixture();
    f.edit('one', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Service' },
    ]);
    await start(f);
    await f.controller.serviceAction(['api'], 'stop');
    f.edit('two', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Development' },
    ]);
    f.controller.saved();
    await settle();
    assert.equal(applies(f), 1);
    assert.equal(f.controller.getSnapshot().changes?.edited, true);
    await f.controller.apply();
    await settle();
    assert.equal(applies(f), 2);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    assert.equal(
        f.controller
            .getSnapshot()
            .observed?.containers.find((entry) => entry.service === 'api')
            ?.lifecycle,
        'exited',
    );
    assert.equal(
        f.controller
            .getSnapshot()
            .observed?.containers.find((entry) => entry.service === 'db')
            ?.lifecycle,
        'running',
    );
});

test('explicit Start releases manual stops while the environment is already running', async () => {
    const f = fixture();
    f.edit('one', [
        { service: 'api', mode: 'Service' },
        { service: 'db', mode: 'Service' },
    ]);
    await start(f);
    await f.controller.serviceAction(['api'], 'stop');
    await f.controller.start();
    await f.controller.waitUntilIdle();
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal(
        f.controller
            .getSnapshot()
            .observed?.containers.find((entry) => entry.service === 'api')
            ?.lifecycle,
        'running',
    );
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
    assert.ok(f.calls.includes('activate:restart:api'));
    assert.equal((await f.controller.serviceAction(['api'], 'start')).ok, true);
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

test('reload rebuilds a development service from applied artifacts without preparing unrelated configuration', async () => {
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
    // Reload reuses the applied artifacts without refreshing image metadata.
    assert.deepEqual(
        f.calls.filter((call) => call !== 'lock' && call !== 'unlock'),
        ['reload:api'],
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

test('Reload cannot activate saved pending configuration for other services', async () => {
    const f = fixture();
    f.edit('one', [{ service: 'api', mode: 'Development' }]);
    await start(f);
    f.edit('two', [
        { service: 'api', mode: 'Development' },
        { service: 'db', mode: 'Service' },
    ]);
    f.controller.saved();
    const result = await f.controller.reloadService('api');
    assert.equal(result.ok, false);
    assert.match(result.message, /Apply saved changes/);
    assert.deepEqual(
        f.snapshots.map((revision) => revision.identity),
        ['one'],
    );
    assert.equal(
        f.controller
            .getSnapshot()
            .observed?.containers.some((entry) => entry.service === 'db'),
        false,
    );
});

test('competing Reload is rejected while Apply owns the environment', async () => {
    const f = fixture();
    const inventory = [{ service: 'api', mode: 'Development' as const }];
    f.edit('one', inventory);
    await start(f);
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    f.edit('two', inventory);
    const applying = f.controller.apply();
    await settle();
    const reloading = f.controller.reloadService('api');
    f.edit('three', [...inventory, { service: 'db', mode: 'Service' }]);
    f.controller.saved();
    release();
    await applying;
    await f.controller.waitUntilIdle();
    const result = await reloading;
    assert.equal(result.ok, false);
    assert.match(result.message, /busy/);
    assert.deepEqual(
        f.snapshots.map((revision) => revision.identity),
        ['one', 'two'],
    );
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
    await settle();
    assert.equal(f.calls.includes('aws'), false);
    assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.calls.includes('apply'), false);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('inventory discrepancies block cleanup before any mutation', async () => {
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
    assert.deepEqual(f.calls, ['lock']);
    assert.deepEqual(f.resolved, []);
    assert.deepEqual(f.snapshots, []);
    assert.equal(
        f.events.some(({ event }) => event === 'live.revision'),
        false,
    );
    await f.controller.shutdown();
});

test('traffic cannot release a manual dependency stop or start a stopped environment', async () => {
    const f = fixture();
    const policy = {
        version: 1 as const,
        lazy: true,
        reclaimable: false,
        dependencies: [] as string[],
    };
    f.edit('one', [
        { service: 'api', mode: 'Service' },
        { service: 'database', mode: 'Service' },
    ]);
    await start(f);
    f.containers([
        {
            ...container('api'),
            lifecycle: 'created',
            policy: { ...policy, dependencies: ['database'] },
        },
        { ...container('database'), policy },
    ]);
    await f.controller.serviceAction(['database'], 'stop');
    const blocked = await f.controller.coldStart('api', Date.now() + 1000);
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /database.*manually stopped/);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['database']);
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
    await f.controller.stop();
    const stopped = await f.controller.coldStart('api', Date.now() + 1000);
    assert.equal(stopped.ok, false);
    assert.match(stopped.message, /environment.*stopped/i);
});

test('engine-confirmed OOM exit 137 remains a crashed running environment', async () => {
    const f = fixture();
    await start(f);
    f.containers([
        {
            ...container('api'),
            lifecycle: 'exited',
            exitCode: 137,
            oomKilled: true,
        },
    ]);
    await f.controller.poll();
    assert.equal(f.controller.getSnapshot().running, true);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('idle unload preserves manual intent and refuses a dependency of a running applied dependent', async () => {
    const f = fixture();
    f.edit('one', [
        { service: 'api', mode: 'Service' },
        { service: 'database', mode: 'Service' },
    ]);
    await start(f);
    const policy = {
        version: 1 as const,
        lazy: true,
        reclaimable: false,
        dependencies: [] as string[],
    };
    f.containers([
        {
            ...container('api'),
            policy: { ...policy, dependencies: ['database'] },
        },
        { ...container('database'), policy },
    ]);
    const needed = await f.controller.idleUnload('database');
    assert.equal(needed.ok, false);
    assert.match(needed.message, /api.*running/);
    assert.equal((await f.controller.idleUnload('api')).ok, true);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal((await f.controller.idleUnload('database')).ok, true);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal(
        (await f.controller.coldStart('api', Date.now() + 1000)).ok,
        true,
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
});

test('traffic waiting behind Apply expires without starting after the deadline', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    const applying = f.controller.apply();
    await settle();
    const result = await f.controller.coldStart('api', Date.now() + 20);
    assert.equal(result.ok, false);
    assert.match(result.message, /deadline expired/);
    release();
    await applying;
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('Stop reports remaining owned containers even when the engine claims successful cleanup', async () => {
    const f = fixture();
    await start(f);
    f.stopLeaves([container('api')]);
    await f.controller.stop();
    const state = f.controller.getSnapshot();
    assert.equal(state.running, false);
    assert.equal(state.phase, 'Failed');
    assert.match(
        state.message,
        /Stop incomplete.*Owned containers remaining: 1/i,
    );
    assert.equal(state.observed?.containers[0]?.id, 'api');
});

test('Stop keeps partial cleanup failure and actual remaining containers visible', async () => {
    const f = fixture();
    await start(f);
    f.stopLeaves(
        [{ ...container('api'), lifecycle: 'exited', exitCode: 143 }],
        new Error('Engine removal failed'),
    );
    await f.controller.stop();
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().phase, 'Failed');
    assert.match(
        f.controller.getSnapshot().message,
        /Stop incomplete.*Owned containers remaining: 1.*Engine removal failed/,
    );
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'exited',
    );
});

test('Stop cannot claim completion when actual container cleanup cannot be inspected', async () => {
    const f = fixture();
    await start(f);
    f.failObservation(new Error('Docker observation unavailable'));
    await f.controller.stop();
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().phase, 'Failed');
    assert.match(
        f.controller.getSnapshot().message,
        /Stop incomplete.*Cannot verify the actual containers/,
    );
});

test('cancelling Stop during persistence prevents later cleanup while retaining stopped intent', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    const checkpoint = new Promise<void>((resolve) => {
        release = resolve;
    });
    const stopping = f.controller.stop(() => checkpoint);
    f.controller.cancel();
    release();
    await stopping;
    assert.equal(f.calls.includes('stopProject'), false);
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'cancelled');
});

test('manual Stop holds an already idle or created owned service without first starting it', async () => {
    for (const lifecycle of ['created', 'exited']) {
        const f = fixture();
        await start(f);
        f.containers([
            {
                ...container('api'),
                lifecycle,
                policy: {
                    version: 1,
                    lazy: true,
                    reclaimable: false,
                    dependencies: [],
                },
            },
        ]);
        const stopped = await f.controller.serviceAction(['api'], 'stop');
        assert.equal(stopped.ok, true);
        assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
        assert.equal(
            (await f.controller.serviceAction(['api'], 'stop')).ok,
            true,
        );
        assert.equal(
            (await f.controller.coldStart('api', Date.now() + 1000)).ok,
            false,
        );
        assert.equal(
            f.calls.some((call) => call.startsWith('activate:')),
            false,
        );
        assert.equal(f.calls.includes('stop:api'), false);
        assert.equal(
            (await f.controller.serviceAction(['missing'], 'stop')).ok,
            false,
        );
        assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    }
});

test('traffic for a selected healthy service does not validate unrelated missing selected containers', async () => {
    const f = fixture();
    f.edit('selected-pair', [
        { service: 'api', mode: 'Service' },
        { service: 'worker', mode: 'Service' },
    ]);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    f.containers([container('worker')]);
    await f.controller.probe();
    assert.doesNotThrow(() => f.controller.assertTrafficAllowed('worker'));
    assert.throws(
        () => f.controller.assertTrafficAllowed('api'),
        /metadata.*unavailable/,
    );
});

test('explicit deselection narrows established membership and cannot resume a historical stopped root', async () => {
    const f = fixture();
    f.edit('pair', [
        { service: 'api', mode: 'Service' },
        { service: 'worker', mode: 'Service' },
    ]);
    await start(f);
    assert.deepEqual(f.controller.getIntent().appliedServices, [
        'api',
        'worker',
    ]);
    f.edit('api-only', [{ service: 'api', mode: 'Service' }]);
    await f.controller.start();
    await f.controller.waitUntilIdle();
    assert.deepEqual(f.controller.getIntent().appliedServices, ['api']);
    f.containers([
        container('api'),
        { ...container('worker'), lifecycle: 'exited' },
    ]);
    assert.equal(
        (await f.controller.coldStart('worker', Date.now() + 1000)).ok,
        false,
    );
    assert.equal(
        f.calls.some((call) => call === 'activate:start:worker'),
        false,
    );
});

test('dedicated Stop remains independent of AWS and preparation on a fresh observer', async () => {
    const f = fixture();
    f.containers([container('api'), container('obsolete')]);
    f.aws('expired');
    await f.controller.stop();
    assert.equal(f.calls.includes('stopProject'), true);
    assert.equal(f.calls.includes('aws'), false);
    assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
});

test('idle unload cannot stop an always-running applied service', async () => {
    const f = fixture();
    await start(f);

    const result = await f.controller.idleUnload('api');

    assert.equal(result.ok, false);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
});

test('clean restoration resumes an applied eager service without applying saved configuration', async () => {
    const f = fixture();
    f.edit('pending', [{ service: 'other', mode: 'Service' }]);
    f.containers([{ ...container('api'), lifecycle: 'exited' }]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: [],
    });

    assert.deepEqual(f.controller.getIntent(), {
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: [],
    });
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.controller.getSnapshot().blocked, undefined);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
    assert.deepEqual(f.calls, ['lock', 'activate:start:api', 'unlock']);
    assert.doesNotThrow(() => f.controller.assertTrafficAllowed('api'));
});

test('interrupted restoration preserves applied intent and manual holds without replaying work', async () => {
    const f = fixture();
    f.containers([
        {
            ...container('api'),
            policy: { ...container('api').policy!, lazy: true },
        },
    ]);
    const intent = {
        running: true,
        paused: true,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: ['held-other'],
    };

    await f.controller.restoreIntent(intent);

    assert.deepEqual(f.controller.getIntent(), intent);
    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'cancelled');
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.deepEqual(f.calls, []);
    await f.controller.probe();
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
    assert.equal((await f.controller.idleUnload('api')).ok, false);
    assert.equal(
        (await f.controller.coldStart('api', Date.now() + 1000)).ok,
        false,
    );
    assert.deepEqual(f.calls, []);
});

test('clean stopped restoration stops owned containers without requiring running membership', async () => {
    const f = fixture();
    f.containers([container('api')]);

    await f.controller.restoreIntent({
        running: false,
        paused: false,
        stoppedByUser: [],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getIntent().paused, false);
    assert.deepEqual(f.controller.getSnapshot().observed?.containers, []);
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('restoration keeps lazy services, reclaimable services and completed jobs stopped', async () => {
    const f = fixture();
    f.containers([
        {
            ...container('lazy'),
            lifecycle: 'created',
            policy: { ...container('lazy').policy!, lazy: true },
        },
        {
            ...container('reclaimable'),
            lifecycle: 'exited',
            policy: { ...container('reclaimable').policy!, reclaimable: true },
        },
        { ...container('job'), kind: 'job', lifecycle: 'exited', exitCode: 0 },
    ]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['lazy', 'reclaimable', 'job'],
        stoppedByUser: [],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.deepEqual(
        f.controller
            .getSnapshot()
            .observed?.containers.map((entry) => [
                entry.service,
                entry.lifecycle,
            ]),
        [
            ['lazy', 'created'],
            ['reclaimable', 'exited'],
            ['job', 'exited'],
        ],
    );
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('restoration reconciles only applied membership and respects a held dependency', async () => {
    const f = fixture();
    f.containers([
        container('selected'),
        container('retired'),
        {
            ...container('api'),
            lifecycle: 'exited',
            policy: { ...container('api').policy!, dependencies: ['database'] },
        },
        container('database'),
    ]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['selected', 'api'],
        stoppedByUser: ['database'],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['database']);
    assert.deepEqual(
        f.controller
            .getSnapshot()
            .observed?.containers.map((entry) => [
                entry.service,
                entry.lifecycle,
            ]),
        [
            ['selected', 'running'],
            ['api', 'exited'],
        ],
    );
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
    assert.doesNotThrow(() => f.controller.assertTrafficAllowed('selected'));
    assert.throws(() => f.controller.assertTrafficAllowed('retired'));
});

test('restoration requires known applied membership before permitting traffic', async () => {
    const f = fixture();
    f.containers([container('api')]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'legacy',
        stoppedByUser: [],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('restoration cannot claim success when the engine leaves an eager service stopped', async () => {
    const f = fixture();
    f.ignoreActivation();
    f.containers([{ ...container('api'), lifecycle: 'exited' }]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: [],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
});

test('restoration cannot admit traffic when an unselected container remains active', async () => {
    const f = fixture();
    f.containers([container('retired')]);
    f.stopLeaves([container('retired')]);

    await f.controller.restoreIntent({
        running: true,
        paused: false,
        applied: 'empty',
        appliedServices: [],
        stoppedByUser: [],
    });

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('retired'));
});

test('restoration remains paused and rejects replacement intent until applied state is verified', async () => {
    const f = fixture();
    f.containers([container('api')]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.observe(() => gate);
    const intent = {
        running: true,
        paused: false,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: [],
    };
    const restoring = f.controller.restoreIntent(intent);
    await settle();
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
    const replacement = f.controller.restoreIntent({
        running: false,
        paused: true,
        applied: 'replacement',
        appliedServices: [],
        stoppedByUser: ['api'],
    });
    release();
    await Promise.all([restoring, replacement]);
    assert.deepEqual(f.controller.getIntent(), intent);
});

test('already-cancelled restoration preserves stopped safety without activating applied services', async () => {
    const f = fixture();
    f.containers([{ ...container('api'), lifecycle: 'exited' }]);
    const cancellation = new AbortController();
    cancellation.abort();

    await f.controller.restoreIntent(
        {
            running: true,
            paused: false,
            applied: 'applied',
            appliedServices: ['api'],
            stoppedByUser: [],
        },
        cancellation.signal,
    );

    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('observation cannot establish applied state when checkout identification fails', async () => {
    const f = fixture();
    f.containers([container('api')]);
    f.unsupported();

    await f.controller.poll();

    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().observed, undefined);
    assert.equal(f.controller.getIntent().applied, undefined);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
});

test('Stop drains an active Apply once and keeps stopped intent visible throughout cancellation', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.hold(() => gate);
    const applying = f.controller.apply();
    await settle();
    let persisted = 0;
    let persistedPaused: boolean | undefined;
    const drainingStates: {
        running: boolean;
        busy: boolean;
        action?: string;
    }[] = [];
    const unsubscribe = f.controller.subscribe(() => {
        const state = f.controller.getSnapshot();
        if (state.phase !== 'Stopped')
            drainingStates.push({
                running: state.running,
                busy: state.busy,
                action: state.action,
            });
    });
    const stopping = f.controller.stop(async () => {
        persisted++;
        persistedPaused = f.controller.getIntent().paused;
    });
    const repeated = f.controller.stop(async () => {
        persisted++;
    });
    await settle();
    const beforeDrain = f.controller.getSnapshot();
    const stoppedBeforeDrain = f.calls.includes('stopProject');
    release();
    await applying;
    const afterDrain = f.controller.getSnapshot();
    await Promise.all([stopping, repeated]);
    unsubscribe();

    assert.equal(stoppedBeforeDrain, false);
    assert.equal(beforeDrain.running, false);
    assert.equal(beforeDrain.busy, true);
    assert.equal(beforeDrain.action, 'stop');
    assert.equal(afterDrain.running, false);
    assert.equal(afterDrain.busy, true);
    assert.equal(afterDrain.action, 'stop');
    assert.equal(persisted, 1);
    assert.equal(persistedPaused, false);
    assert.ok(
        drainingStates.every(
            (state) => !state.running && state.busy && state.action === 'stop',
        ),
    );
    assert.equal(f.calls.filter((call) => call === 'stopProject').length, 1);
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.equal(f.controller.getSnapshot().busy, false);
});

test('shutdown preserves manual holds and refuses subsequent lifecycle work', async () => {
    const f = fixture();
    await start(f);
    await f.controller.serviceAction(['api'], 'stop');
    await f.controller.shutdown();
    const intent = f.controller.getIntent();
    const observed = f.controller.getSnapshot().observed;
    f.calls.length = 0;

    await f.controller.start();
    await f.controller.apply();
    f.controller.retry();
    f.controller.confirmStart();
    f.controller.saved();
    await f.controller.stop();
    assert.equal(
        (await f.controller.serviceAction(['api'], 'start')).ok,
        false,
    );
    assert.equal((await f.controller.serviceAction(['api'], 'stop')).ok, false);
    assert.equal((await f.controller.idleUnload('api')).ok, false);
    assert.equal((await f.controller.reloadService('api')).ok, false);
    assert.equal(
        (await f.controller.coldStart('api', Date.now() + 1000)).ok,
        false,
    );
    await f.controller.restoreIntent({
        running: false,
        paused: false,
        stoppedByUser: [],
    });
    await f.controller.probe();
    await f.controller.poll();

    assert.deepEqual(f.controller.getIntent(), intent);
    assert.deepEqual(f.controller.getSnapshot().observed, observed);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.deepEqual(f.calls, []);
});

test('failed or cancelled engine results cannot establish a successful manual stop', async () => {
    for (const outcome of ['failed', 'cancelled'] as const) {
        const f = fixture();
        await start(f);
        f.actionResult({
            outcome,
            failureKind: 'failed',
            message: 'Engine did not complete the request.',
            affectedServices: [],
        });

        const result = await f.controller.serviceAction(['api'], 'stop');

        assert.equal(result.ok, false);
        assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
        assert.equal(f.controller.getSnapshot().busy, false);
        assert.equal(
            f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
            'exited',
        );
    }
});

test('applied generated dependencies admit traffic while initial unverified membership blocks with a lifecycle reason', async () => {
    const f = fixture();
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    await start(f);
    let blocked: unknown;
    try {
        f.controller.assertTrafficAllowed('api');
    } catch (error) {
        blocked = error;
    }
    release();
    await f.controller.waitUntilIdle();
    assert.ok(blocked instanceof LifecycleBlocked);

    f.containers([
        {
            ...container('api'),
            policy: { ...container('api').policy!, dependencies: ['database'] },
        },
        container('database'),
    ]);
    await f.controller.probe();
    assert.doesNotThrow(() => f.controller.assertTrafficAllowed('database'));
    assert.equal(
        (await f.controller.coldStart('database', Date.now() + 1000)).ok,
        true,
    );
});

test('waiting for idle includes Stop that supersedes an in-flight Apply', async () => {
    const f = fixture();
    await start(f);
    let finishApply!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                finishApply = resolve;
            }),
    );
    const applying = f.controller.apply();
    await settle();
    let idle = false;
    const waiting = f.controller.waitUntilIdle().then(() => {
        idle = true;
    });
    let persistStop!: () => void;
    const stopping = f.controller.stop(
        () =>
            new Promise<void>((resolve) => {
                persistStop = resolve;
            }),
    );
    await settle();
    finishApply();
    await applying;
    await settle();
    const idleBeforeStopCompleted = idle;
    persistStop();
    await Promise.all([stopping, waiting]);

    assert.equal(idleBeforeStopCompleted, false);
    assert.equal(idle, true);
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
});

test('foreign project identity blocks Start before preparing or changing containers', async () => {
    for (const changes of [
        { projectName: 'foreign' },
        { projectDirectory: '/foreign' },
    ]) {
        const f = fixture();
        f.containers([container('api')]);
        f.drift('resolve', changes);

        await f.controller.start();
        await f.controller.waitUntilIdle();

        assert.equal(f.controller.getSnapshot().phase, 'Blocked');
        assert.equal(f.controller.getSnapshot().blocked, 'mismatch');
        assert.equal(f.controller.getIntent().applied, undefined);
        assert.equal(f.calls.includes('prepare'), false);
        assert.equal(f.calls.includes('apply'), false);
    }
});

test('prepared artifacts must match the approved revision and SSH requirements even after durable exclusions', async () => {
    const changes: Partial<PreparedProject>[] = [
        { inventory: [] },
        { configurationIdentity: 'stale' },
        { projectName: 'foreign' },
        { projectDirectory: '/foreign' },
        {
            sshRequirements: [
                {
                    kind: 'container-ssh-secrets',
                    services: ['api'],
                    keyPath: '/unapproved/key',
                    passphrasePath: '/unapproved/passphrase',
                },
            ],
        },
    ];
    const cases = changes.flatMap((drift) => [
        { drift, excluded: false },
        { drift, excluded: true },
    ]);
    for (const { drift, excluded } of cases) {
        const f = fixture();
        f.edit('approved', [
            { service: 'api', mode: 'Service' },
            { service: 'worker', mode: 'Service' },
        ]);
        if (excluded)
            f.partial([
                {
                    variable: 'WORKER_TOKEN',
                    services: ['worker'],
                    cause: 'Missing worker credentials',
                    remediation: 'Set WORKER_TOKEN',
                },
            ]);
        f.drift('prepare', drift);

        await start(f);
        await f.controller.waitUntilIdle();

        assert.equal(f.controller.getSnapshot().phase, 'Blocked');
        assert.equal(f.controller.getSnapshot().blocked, 'mismatch');
        assert.equal(f.controller.getIntent().applied, undefined);
        assert.equal(f.calls.includes('apply'), false);
        assert.equal(
            f.calls.some((call) => call.startsWith('stop:')),
            false,
        );
    }
});

test('failed stopped-intent persistence pauses the environment before any cleanup and a successful Stop clears that pause', async () => {
    const f = fixture();
    await start(f);

    await f.controller.stop(async () => {
        throw new Error('Intent storage unavailable');
    });

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
    assert.equal(f.calls.includes('stopProject'), false);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));

    await f.controller.stop();

    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.equal(f.controller.getIntent().paused, false);
    assert.equal(f.controller.getIntent().applied, undefined);
    assert.equal(f.controller.getIntent().appliedServices, undefined);
    assert.deepEqual(f.controller.getSnapshot().observed?.containers, []);
});

test('a poll begun before a newer save cannot publish obsolete pending changes', async () => {
    const f = fixture();
    await start(f);
    f.edit('pending', [{ service: 'worker', mode: 'Service' }]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.observe(() => gate);
    const polling = f.controller.poll();
    await settle();
    f.edit('one', [{ service: 'api', mode: 'Service' }]);
    f.controller.saved();
    release();
    await polling;

    assert.equal(f.controller.getSnapshot().changes, undefined);
    assert.equal(f.controller.getIntent().applied, 'one');
    assert.equal(applies(f), 1);
});

test('a newly observed stop target requires a revised approval before Start can remove it', async () => {
    const f = fixture();
    f.containers([container('old')]);
    await f.controller.start();
    assert.deepEqual(f.controller.getSnapshot().plan?.stop, ['old']);
    f.containers([container('old'), container('new')]);

    f.controller.confirmStart();
    await f.controller.waitUntilIdle();

    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getSnapshot().phase, 'Stopped');
    assert.deepEqual(f.controller.getSnapshot().plan?.stop, ['old', 'new']);
    assert.equal(f.calls.includes('apply'), false);
    assert.equal(
        f.calls.some((call) => call.startsWith('stop:')),
        false,
    );
});

test('a cold start cannot begin at the exact expiration deadline', async (t) => {
    const f = fixture();
    t.mock.method(Date, 'now', () => 1234);
    await start(f);

    const result = await f.controller.coldStart('api', 1234);

    assert.equal(result.ok, false);
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('Reload cannot rebuild a development service while an applied prerequisite is manually held', async () => {
    const f = fixture();
    f.edit('development', [
        { service: 'api', mode: 'Development' },
        { service: 'database', mode: 'Service' },
    ]);
    await start(f);
    f.containers([
        {
            ...container('api', 'Development'),
            policy: { ...container('api').policy!, dependencies: ['database'] },
        },
        container('database'),
    ]);
    await f.controller.serviceAction(['database'], 'stop');

    const result = await f.controller.reloadService('api');

    assert.equal(result.ok, false);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['database']);
    assert.equal(f.calls.includes('reload:api'), false);
});

test('AWS credentials that expire during preparation prevent engine activation', async () => {
    const f = fixture();
    f.awsSequence(['active', 'expired']);

    await start(f);
    await f.controller.waitUntilIdle();

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'aws');
    assert.equal(f.controller.getIntent().applied, undefined);
    assert.equal(f.calls.includes('prepare'), true);
    assert.equal(f.calls.includes('apply'), false);
});

test('service logs select the active instance of the requested service and reject absent services', async () => {
    const f = fixture();
    f.containers([
        { ...container('api'), id: 'old-api', lifecycle: 'exited' },
        container('database'),
        { ...container('api'), id: 'live-api' },
    ]);

    assert.deepEqual(await f.controller.serviceLogs('api', 30), [
        'ready token=[REDACTED]',
    ]);
    assert.deepEqual(f.calls, ['logs:live-api:30']);
    await assert.rejects(f.controller.serviceLogs('missing'), /no container/);
});

test('an explicit Apply preserves the registry-login gate after an ECR failure', async () => {
    const f = fixture();
    f.fail(new LiveFailure('Registry authorization expired', 'ecr'));
    await start(f);
    f.fail();
    const attempts = applies(f);

    await f.controller.apply();

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'ecr');
    assert.equal(applies(f), attempts);
    await f.controller.loginSucceeded('registry');
    await f.controller.waitUntilIdle();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('Apply starts an initially stopped environment using the saved configuration', async () => {
    const f = fixture();

    await f.controller.apply();
    await f.controller.waitUntilIdle();

    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.controller.getSnapshot().running, true);
    assert.equal(f.controller.getIntent().applied, 'one');
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
});

test('manual Start and Restart cannot activate services in a stopped environment', async () => {
    for (const action of ['start', 'restart'] as const) {
        const f = fixture();
        f.containers([container('api')]);
        await f.controller.probe();

        const result = await f.controller.serviceAction(['api'], action);

        assert.equal(result.ok, false);
        assert.equal(f.controller.getSnapshot().running, false);
        assert.equal(f.controller.getSnapshot().busy, false);
        assert.deepEqual(f.calls, []);
    }
});

test('required SSH setup remains blocked when no setup adapter is available', async () => {
    const f = fixture({ ssh: false });
    f.requireSsh();

    await f.controller.start();

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'other');
    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.calls.includes('apply'), false);
});

test('a running controller retains exclusive environment ownership until shutdown', async () => {
    const f = fixture({ exclusiveLock: true });
    await start(f);

    await assert.rejects(f.claimEnvironment(), /already owned/);
    await f.controller.apply();
    assert.equal(f.controller.getSnapshot().phase, 'Running');
    await assert.rejects(f.claimEnvironment(), /already owned/);
    await f.controller.shutdown();
    assert.equal(f.controller.getIntent().paused, true);
    const release = await f.claimEnvironment();
    await release();
});

test('shutdown makes a retained Start approval inert', async () => {
    const f = fixture();
    f.containers([container('old')]);
    await f.controller.start();
    assert.deepEqual(f.controller.getSnapshot().plan?.stop, ['old']);
    await f.controller.shutdown();
    const intent = f.controller.getIntent();
    f.calls.length = 0;

    f.controller.confirmStart();
    await f.controller.waitUntilIdle();

    assert.deepEqual(f.controller.getIntent(), intent);
    assert.deepEqual(f.controller.getSnapshot().plan?.stop, ['old']);
    assert.deepEqual(f.calls, []);
});

test('service actions expose busy intent immediately and clear it after completion', async () => {
    for (const action of ['start', 'stop', 'cold-start', 'reload'] as const) {
        const f = fixture();
        f.edit('development', [{ service: 'api', mode: 'Development' }]);
        await start(f);

        const pending =
            action === 'cold-start'
                ? f.controller.coldStart('api', Date.now() + 1000)
                : action === 'reload'
                  ? f.controller.reloadService('api')
                  : f.controller.serviceAction(['api'], action);
        const busyDuringAction = f.controller.getSnapshot().busy;
        const result = await pending;

        assert.equal(busyDuringAction, true);
        assert.equal(result.ok, true);
        assert.equal(f.controller.getSnapshot().busy, false);
    }
});

test('resolved configuration drift blocks SSH setup before any secret request is offered', async () => {
    const f = fixture();
    f.requireSsh();
    f.mismatch();

    await f.controller.start();

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'mismatch');
    assert.equal(f.controller.getSnapshot().sshSetup, undefined);
    assert.equal(f.calls.includes('ssh-setup'), false);
    assert.equal(f.calls.includes('apply'), false);
});

test('cancelling Start cannot revive the environment when a late preview read resolves or rejects', async () => {
    for (const outcome of ['resolved', 'rejected']) {
        const f = fixture();
        f.observe(async () => {
            f.controller.cancel();
            if (outcome === 'rejected')
                throw new Error('Preview read cancelled');
        });

        await f.controller.start();
        await f.controller.waitUntilIdle();

        assert.notEqual(f.controller.getSnapshot().phase, 'Failed');
        assert.equal(f.controller.getSnapshot().running, false);
        assert.equal(f.controller.getSnapshot().busy, false);
        assert.equal(f.controller.getIntent().paused, true);
        assert.equal(f.calls.includes('apply'), false);
    }
});

test('a cold-start engine observation failure reports refusal without exposing backend credentials', async () => {
    const f = fixture();
    await start(f);
    f.failObservation(new Error('Engine failed token=abc123'));

    const result = await f.controller.coldStart('api', Date.now() + 1000);

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /abc123/);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
});

test('Apply reports non-Error adapter rejections as failed work without throwing a second error', async () => {
    for (const failure of [null, undefined, 'Backend unavailable']) {
        const f = fixture();
        await start(f);
        f.rejectApply(failure);

        await f.controller.apply();

        assert.equal(f.controller.getSnapshot().phase, 'Failed');
        assert.equal(f.controller.getSnapshot().busy, false);
        assert.equal(f.controller.getSnapshot().blocked, undefined);
    }
});

test('traffic during explicit recovery receives a lifecycle refusal until observation is available', async () => {
    const f = fixture();
    f.containers([container('api')]);
    await f.controller.restoreIntent({
        running: true,
        paused: true,
        applied: 'applied',
        appliedServices: ['api'],
        stoppedByUser: [],
    });
    const applying = f.controller.apply();
    let failure: unknown;
    try {
        f.controller.assertTrafficAllowed('api');
    } catch (error) {
        failure = error;
    }
    await applying;

    assert.ok(failure instanceof LifecycleBlocked);
    assert.equal(f.controller.getSnapshot().phase, 'Running');
});

test('overlapping polls share one pending backend observation', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let observations = 0;
    f.observe(async () => {
        observations++;
        await gate;
    });
    const first = f.controller.poll();
    await settle();
    const second = f.controller.poll();
    await settle();
    const observationsBeforeCompletion = observations;
    release();
    await Promise.all([first, second]);

    assert.equal(observationsBeforeCompletion, 1);
    assert.equal(f.controller.getSnapshot().running, true);
});

test('applying an empty selection clears applied membership without AWS or preparation', async () => {
    const f = fixture();
    await start(f);
    f.edit('empty', []);
    f.aws('expired');
    f.calls.length = 0;

    await f.controller.apply();

    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.equal(f.controller.getIntent().applied, 'empty');
    assert.deepEqual(f.controller.getIntent().appliedServices, []);
    assert.deepEqual(f.controller.getSnapshot().observed?.containers, []);
    assert.equal(f.calls.includes('aws'), false);
    assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.calls.includes('apply'), false);
    f.containers([container('api')]);
    await f.controller.probe();
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
});

test('idle unloading an owned helper preserves its running sibling and creates no manual hold', async () => {
    const f = fixture();
    await start(f);
    f.containers([
        { ...container('api'), lifecycle: 'exited' },
        {
            ...container('api-helper'),
            ownerService: 'api',
            policy: { ...container('api').policy!, lazy: true },
        },
        { ...container('api-sidecar'), ownerService: 'api' },
    ]);

    const result = await f.controller.idleUnload('api-helper');

    assert.equal(result.ok, true);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.deepEqual(
        f.controller
            .getSnapshot()
            .observed?.containers.map((entry) => [
                entry.service,
                entry.lifecycle,
            ]),
        [
            ['api', 'exited'],
            ['api-helper', 'exited'],
            ['api-sidecar', 'running'],
        ],
    );
});

test('manual service actions report non-Error observation failures without claiming success', async () => {
    for (const action of ['start', 'stop'] as const) {
        const f = fixture();
        await start(f);
        f.failObservation('Backend unavailable token=abc123');

        const result = await f.controller.serviceAction(['api'], action);

        assert.equal(result.ok, false);
        assert.match(result.message, /Backend unavailable/);
        assert.doesNotMatch(result.message, /abc123/);
        assert.equal(f.controller.getSnapshot().busy, false);
    }
});

test('Reload reports refusal for stopped environments and services outside Development mode', async () => {
    const f = fixture();
    assert.equal((await f.controller.reloadService('api')).ok, false);
    await start(f);

    assert.equal((await f.controller.reloadService('api')).ok, false);
    assert.equal(f.calls.includes('reload:api'), false);
    assert.equal(f.controller.getSnapshot().busy, false);
});

test('Cancel while idle durably pauses automatic traffic without changing containers', async () => {
    const f = fixture();
    await start(f);

    f.controller.cancel();

    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
    assert.equal(
        (await f.controller.coldStart('api', Date.now() + 1000)).ok,
        false,
    );
    assert.equal(
        f.calls.some((call) => call.startsWith('activate:')),
        false,
    );
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
});

test('SSH setup refuses absent requirements and closed controllers', async () => {
    const input = { keyPath: '/key', passphrase: 'secret', replace: false };
    const f = fixture();
    assert.equal(await f.controller.setupSsh(input), false);
    assert.deepEqual(f.calls, []);
    f.requireSsh();
    await f.controller.start();
    await f.controller.shutdown();
    f.calls.length = 0;

    assert.equal(await f.controller.setupSsh(input), false);
    assert.deepEqual(f.calls, []);
});

test('failed SSH setup reports refusal with a redacted non-Error failure and keeps the environment stopped', async () => {
    const f = fixture();
    f.requireSsh();
    await f.controller.start();
    f.rejectSsh('SSH backend unavailable token=abc123');

    const result = await f.controller.setupSsh({
        keyPath: '/key',
        passphrase: 'secret',
        replace: false,
    });

    assert.equal(result, false);
    assert.equal(f.controller.getSnapshot().running, false);
    assert.match(f.controller.getSnapshot().message, /SSH backend unavailable/);
    assert.doesNotMatch(f.controller.getSnapshot().message, /abc123/);
    assert.equal(f.calls.includes('apply'), false);
});

test('Cancel while SSH setup is pending prevents late setup success from starting the environment', async () => {
    const f = fixture();
    f.requireSsh();
    await f.controller.start();
    let release!: () => void;
    f.holdSsh(
        new Promise<void>((resolve) => {
            release = resolve;
        }),
    );
    const setup = f.controller.setupSsh({
        keyPath: '/key',
        passphrase: 'secret',
        replace: false,
    });
    await settle();
    f.controller.cancel();
    release();
    assert.equal(await setup, true);
    await f.controller.waitUntilIdle();

    assert.equal(f.controller.getSnapshot().running, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.equal(f.calls.includes('apply'), false);
});

test('SSH setup continues a running Apply without releasing manual service holds', async () => {
    const f = fixture();
    await start(f);
    f.requireSsh();
    f.edit('requires-ssh');
    await f.controller.apply();
    assert.equal(f.controller.getSnapshot().blocked, 'ssh');
    await f.controller.serviceAction(['api'], 'stop');

    assert.equal(
        await f.controller.setupSsh({
            keyPath: '/key',
            passphrase: 'secret',
            replace: false,
        }),
        true,
    );
    await f.controller.waitUntilIdle();

    assert.equal(f.controller.getSnapshot().phase, 'Running');
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, ['api']);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'exited',
    );
});

test('Cancel during Apply leaves a paused blocked environment after the engine aborts', async () => {
    const f = fixture();
    await start(f);
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    const applying = f.controller.apply();
    await settle();
    f.controller.cancel();
    release();
    await applying;

    assert.equal(f.controller.getSnapshot().phase, 'Blocked');
    assert.equal(f.controller.getSnapshot().blocked, 'cancelled');
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getIntent().paused, true);
    assert.throws(() => f.controller.assertTrafficAllowed('api'));
});

test('exact-container action failures report refusal without adding a manual hold', async () => {
    const f = fixture();
    await start(f);
    const manager = {
        list: async () => [],
        inspect: async () => {
            throw new Error('Unused');
        },
        logs: async () => [],
        action: async () => Promise.reject('Manager unavailable token=abc123'),
    };
    const target = {
        id: 'api',
        name: 'api-1',
        image: 'api:1',
        state: 'running',
        status: 'Running',
        service: 'api',
        currentProject: true,
        ports: [],
    };

    const result = await f.controller.manageContainer(manager, target, 'stop');

    assert.equal(result.ok, false);
    assert.match(result.message, /Manager unavailable/);
    assert.doesNotMatch(result.message, /abc123/);
    assert.deepEqual(f.controller.getSnapshot().stoppedByUser, []);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(
        f.controller.getSnapshot().observed?.containers[0]?.lifecycle,
        'running',
    );
});

test('shutdown cancels an in-flight Apply before pending selection becomes applied', async () => {
    const f = fixture();
    await start(f);
    f.edit('pending', [{ service: 'worker', mode: 'Service' }]);
    let release!: () => void;
    f.hold(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    const applying = f.controller.apply();
    await settle();
    const shuttingDown = f.controller.shutdown();
    release();
    await Promise.all([applying, shuttingDown]);

    assert.equal(f.controller.getIntent().applied, 'one');
    assert.equal(f.controller.getIntent().paused, true);
    await assert.doesNotReject(f.controller.serviceLogs('api'));
    await assert.rejects(f.controller.serviceLogs('worker'), /no container/);
});
