import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SettingsSnapshot } from '../src/domain/settings.js';
import { createUsageLedger } from '../src/proxy/usage-ledger.js';
import { UsageTracker } from '../src/application/usage-tracker.js';
import { nodeProjectFs } from '../src/project/files.js';
import { readUsageCache } from '../src/project/usage-cache.js';

function settings(enabled: boolean): () => SettingsSnapshot {
    return () =>
        ({
            resolved: { usageCache: { value: enabled } },
        }) as unknown as SettingsSnapshot;
}

async function checkout() {
    const directory = await mkdtemp(join(tmpdir(), 'chs-tracker-'));
    await mkdir(join(directory, 'services/modules/m'), { recursive: true });
    await mkdir(join(directory, 'services/infrastructure'), {
        recursive: true,
    });
    await writeFile(
        join(directory, 'services/modules/m/example.docker-compose.yaml'),
        'services:\n  api:\n    image: api\n    depends_on: [worker]\n  worker:\n    image: worker\n',
    );
    await writeFile(
        join(directory, 'services/infrastructure/docker-compose.yaml'),
        'services:\n  redis:\n    image: redis\n',
    );
    await writeFile(join(directory, '.chs-dev.yaml'), 'services: [api]\n');
    return directory;
}

const clock = () => new Date('2026-10-16T12:00:00.000Z');

function tracker(enabled: boolean, ledger = createUsageLedger()) {
    return new UsageTracker({
        settings: settings(enabled),
        ledger,
        now: clock,
    });
}

test('a run where only pinned services are used demotes the rest', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = tracker(true, ledger);
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('api');
        await usage.closeRun();
        const cache = await readUsageCache(directory, nodeProjectFs);
        assert.deepEqual(cache.learned, ['worker']);
        assert.deepEqual(cache.lastRun!.selection, ['api', 'redis', 'worker']);
        assert.deepEqual(cache.lastRun!.used, ['api']);
        assert.equal(cache.lastRun!.at, '2026-10-16T12:00:00.000Z');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('used services are promoted: the verdict is rewritten wholesale', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = tracker(true, ledger);
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('api');
        await usage.closeRun();
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('worker');
        await usage.closeRun();
        const cache = await readUsageCache(directory, nodeProjectFs);
        assert.deepEqual(cache.learned, []);
        assert.deepEqual(cache.lastRun!.used, ['worker']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('runs below the traffic floor teach nothing', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        for (let index = 0; index < 4; index++) ledger.record('api');
        const usage = new UsageTracker({
            settings: settings(true),
            ledger,
            minRunRequests: 5,
        });
        await usage.openRun(directory);
        await usage.closeRun();
        assert.deepEqual(await readUsageCache(directory, nodeProjectFs), {
            learned: [],
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a run at the floor teaches even with no real usage', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = new UsageTracker({
            settings: settings(true),
            ledger,
            minRunRequests: 5,
        });
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('api');
        await usage.closeRun();
        const cache = await readUsageCache(directory, nodeProjectFs);
        assert.deepEqual(cache.learned, ['worker']);
        assert.deepEqual(cache.lastRun!.used, ['api']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a disabled cache still records usage', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = tracker(false, ledger);
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('api');
        await usage.closeRun();
        const cache = await readUsageCache(directory, nodeProjectFs);
        assert.deepEqual(cache.learned, ['worker']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('closing without an open run is a no-op and clearing reports existence', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = tracker(true, ledger);
        await usage.closeRun();
        assert.deepEqual(await readUsageCache(directory, nodeProjectFs), {
            learned: [],
        });
        assert.equal(await usage.clear(directory), false);
        await usage.openRun(directory);
        for (let index = 0; index < 5; index++) ledger.record('api');
        await usage.closeRun();
        assert.equal(await usage.clear(directory), true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('the snapshot reports learned modes and unused pinned selections', async () => {
    const directory = await checkout();
    try {
        const ledger = createUsageLedger();
        const usage = tracker(true, ledger);
        await usage.openRun(directory);
        for (let index = 0; index < 6; index++) ledger.record('api');
        await usage.closeRun();
        assert.deepEqual(await usage.snapshot(directory), {
            enabled: true,
            learned: ['worker'],
            unusedLastRun: ['redis', 'worker'],
        });
        await usage.forget(directory, ['worker']);
        assert.deepEqual((await usage.snapshot(directory)).learned, []);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
