import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
    runInteractiveCommand,
    type InteractiveCommandRequest,
} from '../src/infrastructure/interactive-command.js';
import { withInteractiveRunner } from '../src/infrastructure/interactive-context.js';

function command(options: Partial<InteractiveCommandRequest> = {}) {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const written: string[] = [];
    const signals: unknown[] = [];
    let spawned = false;
    child.kill = (signal) => {
        signals.push(signal);
        return true;
    };
    const result = runInteractiveCommand({
        command: 'login',
        args: [],
        label: 'Docker ECR login',
        missingMessage: 'Missing login',
        ...options,
        dependencies: {
            spawn: (_command, _args, options) => {
                spawned = true;
                assert.deepEqual(options.stdio, ['inherit', 'pipe', 'pipe']);
                return child;
            },
            stdout: (text) => {
                written.push(text);
            },
            stderr: (text) => {
                written.push(text);
            },
        },
    });
    return { child, written, result, signals, spawned };
}

test('exit zero succeeds even when Docker writes success to stderr', async () => {
    const { child, written, result } = command();
    child.stderr!.emit('data', 'Login Succeeded\n');
    child.emit('close', 0, null);
    assert.equal((await result).outcome, 'success');
    assert.deepEqual(written, ['Login Succeeded\n']);
});

test('failed login retains sanitized command details and the actual exit status', async () => {
    const { child, result } = command();
    child.stdout!.emit('data', 'AWS logged in\n');
    child.stderr!.emit(
        'data',
        '\x1b[31mDocker credential store failed password=hidden\x1b[0m\n',
    );
    child.emit('close', 1, null);
    const failure = await result;
    assert.equal(failure.outcome, 'failed');
    assert.match(failure.message, /exit 1/);
    assert.match(failure.message, /Docker credential store failed/);
    assert.doesNotMatch(failure.message, /hidden|\x1b/);
});

test('cancellation does not become a command failure', async () => {
    const { child, result } = command();
    child.emit('close', null, 'SIGINT');
    assert.equal((await result).outcome, 'cancelled');
});

test('long login output retains the final error in a bounded message', async () => {
    const { child, result } = command();
    child.stdout!.emit('data', 'Progress\n'.repeat(10000));
    child.stderr!.emit('data', 'Final Docker error\n');
    child.emit('close', 1, null);
    const failure = await result;
    assert.match(failure.message, /Final Docker error/);
    assert.ok(failure.message.length < 2100);
});

test('startup failures distinguish a missing command and redact environment credentials', async () => {
    const missing = command();
    missing.child.emit(
        'error',
        Object.assign(new Error('not installed'), { code: 'ENOENT' }),
    );
    assert.deepEqual(await missing.result, {
        outcome: 'failed',
        message: 'Missing login',
    });
    const denied = command({
        environment: {
            SESSION_TOKEN: 'private-value',
            EMPTY_TOKEN: '',
            ABSENT_SECRET: undefined,
        },
    });
    denied.child.emit(
        'error',
        Object.assign(new Error('access denied for private-value'), {
            code: 'EACCES',
        }),
    );
    assert.deepEqual(await denied.result, {
        outcome: 'failed',
        message:
            'Unable to start Docker ECR login: access denied for [REDACTED]',
    });
});

test('failed commands without output still explain the failure', async () => {
    const f = command();
    f.child.emit('close', 2, null);
    assert.deepEqual(await f.result, {
        outcome: 'failed',
        message:
            'Docker ECR login failed (exit 2). The command produced no output.',
    });
});

test('an already cancelled command never spawns a process', async () => {
    const f = command({ signal: AbortSignal.abort() });
    f.child.emit('close', 0, null);
    assert.equal(f.spawned, false);
    assert.equal((await f.result).outcome, 'cancelled');
});

test('cancellation interrupts the child and wins over its eventual zero exit', async () => {
    const abort = new AbortController();
    const listeners = process.listenerCount('SIGINT');
    const f = command({ signal: abort.signal });
    abort.abort();
    f.child.emit('close', 0, null);
    assert.deepEqual(f.signals, ['SIGINT']);
    assert.equal((await f.result).outcome, 'cancelled');
    assert.equal(process.listenerCount('SIGINT'), listeners);
});

test('an attached terminal receives the command and supplies its outcome', async () => {
    const requests: unknown[] = [];
    const outcome = {
        outcome: 'success' as const,
        message: 'Handled by attached terminal',
    };
    const f = await withInteractiveRunner(
        async (request) => {
            requests.push(request);
            return outcome;
        },
        async () => command({ environment: { REGION: 'local-fixture' } }),
    );
    f.child.emit('close', 0, null);
    assert.equal(f.spawned, false);
    assert.deepEqual(await f.result, outcome);
    assert.deepEqual(requests, [
        {
            command: 'login',
            args: [],
            label: 'Docker ECR login',
            missingMessage: 'Missing login',
            signal: undefined,
            environment: { REGION: 'local-fixture' },
        },
    ]);
});
