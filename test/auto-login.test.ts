import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    autoLoginStep,
    initialAutoLoginMemory,
    parseAutoLogin,
    type AutoLoginInput,
    type AutoLoginMemory,
} from '../src/domain/auto-login.js';

const base: AutoLoginInput = {
    mode: 'needed',
    aws: 'active',
    phase: 'Running',
    idle: true,
};
function run(steps: Partial<AutoLoginInput>[]) {
    let memory: AutoLoginMemory = initialAutoLoginMemory;
    return steps.map((step) => {
        const decision = autoLoginStep({ ...base, ...step }, memory);
        memory = decision.memory;
        return decision.login?.kind;
    });
}

test('parses automatic login modes', () => {
    assert.equal(parseAutoLogin('off'), 'off');
    assert.equal(parseAutoLogin('TRUE'), 'needed');
    assert.equal(parseAutoLogin('expired'), 'expired');
    assert.equal(parseAutoLogin('sometimes'), undefined);
});

test('off never logs in', () => {
    assert.deepEqual(
        run([
            { mode: 'off', phase: 'Blocked', blocked: 'aws', aws: 'expired' },
        ]),
        [undefined],
    );
});

test('when needed logs in once per block and uses the Ctrl+L choice', () => {
    assert.deepEqual(
        run([
            { phase: 'Blocked', blocked: 'aws', aws: 'expired' },
            { phase: 'Blocked', blocked: 'aws', aws: 'expired' },
            { phase: 'Running' },
            { phase: 'Blocked', blocked: 'aws', preference: 'aws' },
        ]),
        ['registry', undefined, undefined, 'aws'],
    );
    // ECR always needs the registry login, even when AWS only is preferred.
    assert.deepEqual(
        run([{ phase: 'Blocked', blocked: 'ecr', preference: 'aws' }]),
        ['registry'],
    );
    // A repeated ECR block after a successful login is not retried in a loop.
    assert.deepEqual(
        run([
            { phase: 'Blocked', blocked: 'ecr' },
            { phase: 'Applying' },
            { phase: 'Blocked', blocked: 'ecr' },
        ]),
        ['registry', undefined, undefined],
    );
    // Other block reasons and a plain expiry do not trigger it.
    assert.deepEqual(
        run([
            { phase: 'Blocked', blocked: 'ssh' },
            { phase: 'Stopped', aws: 'expired' },
        ]),
        [undefined, undefined],
    );
});

test('waits while a modal is open or a login runs', () => {
    assert.deepEqual(
        run([
            { phase: 'Blocked', blocked: 'aws', idle: false },
            { phase: 'Blocked', blocked: 'aws' },
        ]),
        [undefined, 'registry'],
    );
});

test('authentication recovery runs from the Environment window, but waits for other work', () => {
    assert.deepEqual(
        run([
            { phase: 'Applying', environmentOpen: true, idle: false },
            {
                phase: 'Blocked',
                blocked: 'ecr',
                environmentOpen: true,
                idle: false,
            },
            { phase: 'Blocked', blocked: 'ecr', environmentOpen: true },
            { phase: 'Blocked', blocked: 'ecr', environmentOpen: true },
            { phase: 'Applying', environmentOpen: true },
            { phase: 'Blocked', blocked: 'ecr', environmentOpen: true },
        ]),
        [undefined, undefined, 'registry', undefined, undefined, undefined],
    );
    assert.deepEqual(
        run([
            {
                phase: 'Blocked',
                blocked: 'aws',
                environmentOpen: true,
                aws: 'expired',
            },
        ]),
        ['registry'],
    );
    assert.deepEqual(
        run([
            {
                mode: 'expired',
                phase: 'Stopped',
                aws: 'expired',
                environmentOpen: true,
            },
            {
                mode: 'expired',
                phase: 'Stopped',
                aws: 'expired',
                environmentOpen: false,
            },
        ]),
        [undefined, 'registry'],
    );
});

test('on expiry logs in once, outside operations, until credentials are active again', () => {
    assert.deepEqual(
        run([
            { mode: 'expired', aws: 'expired', phase: 'Applying' },
            { mode: 'expired', aws: 'expired', phase: 'Running' },
            { mode: 'expired', aws: 'expired', phase: 'Stopped' },
            { mode: 'expired', aws: 'active' },
            { mode: 'expired', aws: 'expired', preference: 'aws' },
            { mode: 'expired', aws: 'signed-out' },
        ]),
        [undefined, 'registry', undefined, undefined, 'aws', undefined],
    );
});
