import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Interactions } from '../src/application/interactions.js';
import { eventually } from './daemon-fixture.js';

test('interactive claims are exclusive, resize before spawn works, and private input is absent from snapshots', async () => {
    const writes: string[] = [],
        sizes: number[][] = [],
        output: string[] = [];
    let finish!: () => void;
    let spawned = false;
    const interactions = new Interactions(
        async (_request, send) => {
            spawned = true;
            send('private browser link');
            return {
                write: (text) => writes.push(text),
                resize: (columns, rows) => sizes.push([columns, rows]),
                kill: () => finish(),
                result: new Promise((resolve) => {
                    finish = () =>
                        resolve({ outcome: 'success', message: 'Logged in' });
                }),
            };
        },
        () => {},
        randomUUID,
    );
    const abort = new AbortController();
    const done = interactions.run('login', 'Logging in', abort.signal, (run) =>
        run({
            command: 'fixture',
            args: [],
            label: 'Login',
            missingMessage: '',
            environment: {},
        }),
    );
    const claim = interactions.claim('login', (text) => output.push(text));
    assert.throws(
        () => interactions.claim('login', () => {}),
        /Another frontend/,
    );
    interactions.input('login', claim.token, undefined, 110, 32);
    claim.ready();
    await eventually(() => spawned && sizes.length > 0);
    interactions.input('login', claim.token, 'private passphrase');
    assert.deepEqual(writes, ['private passphrase']);
    assert.deepEqual(sizes, [[110, 32]]);
    assert.ok(output.includes('private browser link'));
    assert.equal(
        JSON.stringify(interactions.snapshot()).includes('private'),
        false,
    );
    assert.throws(
        () => interactions.input('login', 'wrong-token', 'x'),
        /Attach/,
    );
    finish();
    await done;
    assert.equal(interactions.snapshot(), undefined);
});

test('abandoning an interaction cancels the whole login flow, including non-terminal stages', async () => {
    const interactions = new Interactions(
        async () => {
            throw new Error('No terminal needed');
        },
        () => {},
        randomUUID,
    );
    let activeSignal: AbortSignal | undefined;
    const done = interactions.run(
        'login',
        'Logging in',
        new AbortController().signal,
        async (_run, signal) => {
            activeSignal = signal;
            await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => resolve(), {
                    once: true,
                });
            });
        },
    );
    const claim = interactions.claim('login', () => {});
    claim.ready();
    await eventually(() => !!activeSignal);
    interactions.close();
    await done;
    assert.equal(activeSignal?.aborted, true);
});
