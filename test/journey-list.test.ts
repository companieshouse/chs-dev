import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listJourneys } from '../src/project/journeys.js';
import { nodeProjectFs } from '../src/project/files.js';

async function checkout() {
    const directory = await mkdtemp(join(tmpdir(), 'chs-journey-list-'));
    await mkdir(join(directory, 'journeys'), { recursive: true });
    return directory;
}

test('listJourneys summarises valid journeys and reports invalid ones', async (t) => {
    const directory = await checkout();
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
        join(directory, 'journeys', 'accounts.yaml'),
        'services: [api, worker]\nlazy: [felixvalidator]\n',
    );
    await writeFile(
        join(directory, 'journeys', 'tiny.yaml'),
        'services: [api]\n',
    );
    await writeFile(
        join(directory, 'journeys', 'broken.yaml'),
        'unknown-key: true\n',
    );
    await writeFile(join(directory, 'journeys', 'notes.txt'), 'ignored\n');
    const result = await listJourneys(directory, nodeProjectFs);
    assert.deepEqual(result.journeys, [
        {
            name: 'accounts',
            services: ['api', 'worker'],
            lazy: ['felixvalidator'],
            excluded: [],
        },
        { name: 'tiny', services: ['api'], lazy: [], excluded: [] },
    ]);
    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0]!.file, /broken\.yaml$/);
    assert.match(result.invalid[0]!.error, /unknown key/);
});

test('listJourneys returns nothing when the directory is missing', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-journey-list-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const result = await listJourneys(directory, nodeProjectFs);
    assert.deepEqual(result, { journeys: [], invalid: [] });
});
