import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { runInteractiveCommand } from '../src/infrastructure/interactive-command.js';

function command() {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const written: string[] = [];
    const result = runInteractiveCommand({
        command: 'login',
        args: [],
        label: 'Docker ECR login',
        missingMessage: 'Missing login',
        dependencies: {
            spawn: (_command, _args, options) => {
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
    return { child, written, result };
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
