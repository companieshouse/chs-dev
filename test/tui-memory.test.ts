import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify, stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test('development TUI redraws release profiling entries and old session snapshots', async () => {
    const { stdout } = await promisify(execFile)(
        process.execPath,
        [
            '--expose-gc',
            '--max-old-space-size=512',
            '--import',
            'tsx',
            fileURLToPath(
                new URL('./support/tui-memory-worker.ts', import.meta.url),
            ),
        ],
        {
            env: { ...process.env, NODE_ENV: 'development' },
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
        },
    );
    const { before, after, observedMeasures } = JSON.parse(
        stripVTControlCharacters(stdout).trim(),
    );
    assert.ok(
        observedMeasures > 200,
        'The development profiler must be active',
    );
    assert.ok(
        after.measures < 100,
        `${after.measures} profiling entries retained`,
    );
    const growth = after.heap - before.heap;
    assert.ok(
        growth < 32 * 1024 * 1024,
        `Heap grew by ${Math.round(growth / 1024 / 1024)} MB after warm-up`,
    );
});
