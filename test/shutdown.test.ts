import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shutdown } from '../src/server/shutdown.js';

test('shutdown attempts all resources in order after any cleanup failure', async () => {
    for (let failing = 0; failing < 4; failing++) {
        const calls: number[] = [];
        const failure = new Error('cleanup failed');
        await assert.rejects(
            shutdown(
                Array.from({ length: 4 }, (_, index) => async () => {
                    calls.push(index);
                    if (index === failing) throw failure;
                }),
            ),
            (error: AggregateError) => {
                assert.deepEqual(error.errors, [failure]);
                return true;
            },
        );
        assert.deepEqual(calls, [0, 1, 2, 3]);
    }
});

test('initialization failure remains primary and includes every cleanup error', async () => {
    const original = new Error('initialization failed');
    const cleanup = new Error('cleanup failed');
    await assert.rejects(
        shutdown([], { error: original }),
        (error) => error === original,
    );
    await assert.rejects(
        shutdown(
            [
                async () => {
                    throw cleanup;
                },
                async () => {
                    throw cleanup;
                },
            ],
            { error: original },
        ),
        (error: AggregateError) => {
            assert.equal(error.cause, original);
            assert.deepEqual(error.errors, [original, cleanup, cleanup]);
            return true;
        },
    );
});
