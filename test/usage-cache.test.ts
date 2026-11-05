import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nodeProjectFs } from '../src/project/files.js';
import {
    clearUsageCache,
    forgetUsage,
    loadUsagePolicy,
    parseUsageCache,
    readUsageCache,
    resolveUsageRun,
    usageCacheFile,
    usageCacheYaml,
    writeUsageCache,
} from '../src/project/usage-cache.js';

async function scratch() {
    return mkdtemp(join(tmpdir(), 'chs-usage-'));
}

const record = {
    learned: ['worker', 'api'],
    lastRun: {
        at: '2026-10-16T12:00:00.000Z',
        selection: ['api', 'worker', 'redis'],
        used: ['api'],
    },
};

test('the usage cache round-trips through its YAML form', () => {
    assert.deepEqual(parseUsageCache(usageCacheYaml(record)), {
        learned: ['api', 'worker'],
        lastRun: {
            at: '2026-10-16T12:00:00.000Z',
            selection: ['api', 'redis', 'worker'],
            used: ['api'],
        },
    });
});

test('a malformed usage cache reads as empty instead of failing', () => {
    for (const raw of [
        '',
        'not: [valid',
        '[]',
        'format: something-else\nversion: 1\nlearned: [a]',
        'format: chs-dev-usage\nversion: 2\nlearned: [a]',
        'format: chs-dev-usage\nversion: 1\nlearned: "nope"',
        'format: chs-dev-usage\nversion: 1\nlastRun: { at: "nope" }',
    ])
        assert.deepEqual(parseUsageCache(raw), { learned: [] }, raw);
});

test('write, read, clear and forget the cache file on disk', async () => {
    const directory = await scratch();
    try {
        await writeUsageCache(directory, record);
        assert.deepEqual(await readUsageCache(directory), {
            learned: ['api', 'worker'],
            lastRun: {
                at: '2026-10-16T12:00:00.000Z',
                selection: ['api', 'redis', 'worker'],
                used: ['api'],
            },
        });
        const raw = await readFile(join(directory, usageCacheFile), 'utf8');
        assert.match(raw, /format: chs-dev-usage/);
        assert.deepEqual(await forgetUsage(directory, ['worker']), {
            learned: ['api'],
            lastRun: {
                at: '2026-10-16T12:00:00.000Z',
                selection: ['api', 'redis', 'worker'],
                used: ['api'],
            },
        });
        assert.deepEqual(await readUsageCache(directory), {
            learned: ['api'],
            lastRun: {
                at: '2026-10-16T12:00:00.000Z',
                selection: ['api', 'redis', 'worker'],
                used: ['api'],
            },
        });
        assert.equal(await clearUsageCache(directory), true);
        assert.equal(await clearUsageCache(directory), false);
        assert.deepEqual(await readUsageCache(directory), { learned: [] });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('forgetting an unknown service leaves the file alone', async () => {
    const directory = await scratch();
    try {
        await writeUsageCache(directory, record);
        const before = await readFile(join(directory, usageCacheFile), 'utf8');
        assert.deepEqual(await forgetUsage(directory, ['other']), {
            learned: ['api', 'worker'],
            lastRun: {
                at: '2026-10-16T12:00:00.000Z',
                selection: ['api', 'redis', 'worker'],
                used: ['api'],
            },
        });
        assert.equal(
            await readFile(join(directory, usageCacheFile), 'utf8'),
            before,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('the usage policy loads only when enabled and learned bits exist', async () => {
    const directory = await scratch();
    try {
        assert.equal(
            await loadUsagePolicy(directory, true, nodeProjectFs),
            undefined,
        );
        await writeUsageCache(directory, record);
        const policy = await loadUsagePolicy(directory, true, nodeProjectFs);
        assert.deepEqual([...policy!.learned], ['api', 'worker']);
        assert.equal(
            await loadUsagePolicy(directory, false, nodeProjectFs),
            undefined,
        );
        assert.equal(
            await loadUsagePolicy(directory, undefined, nodeProjectFs),
            undefined,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

async function checkout() {
    const directory = await scratch();
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

test('a run snapshot scopes evidence to the selection and its eligible members', async () => {
    const directory = await checkout();
    try {
        const run = await resolveUsageRun(directory, nodeProjectFs);
        assert.deepEqual(run.selection, ['api', 'redis', 'worker']);
        // api is pinned by the state file, redis is base, worker is derived.
        assert.deepEqual(run.eligible, ['worker']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
