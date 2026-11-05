import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    journeyYaml,
    loadJourney,
    saveJourney,
} from '../src/project/journeys.js';
import { nodeProjectFs } from '../src/project/files.js';

async function checkout(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'chs-journey-save-'));
    await mkdir(join(directory, 'services/modules/m'), { recursive: true });
    await mkdir(join(directory, 'services/infrastructure'), {
        recursive: true,
    });
    await writeFile(
        join(directory, 'services/modules/m/app.docker-compose.yaml'),
        'services:\n  api:\n    image: api\n  worker:\n    image: worker\n',
    );
    await writeFile(
        join(directory, 'services/infrastructure/docker-compose.yaml'),
        'services:\n  redis:\n    image: redis\n',
    );
    return directory;
}

test('journeyYaml emits sorted services and an optional lazy list', () => {
    assert.equal(
        journeyYaml(['worker', 'api'], []),
        'services:\n  - api\n  - worker\n',
    );
    assert.equal(
        journeyYaml(['api'], ['worker']),
        'services:\n  - api\nlazy:\n  - worker\n',
    );
    assert.throws(() => journeyYaml([], []), /at least one service/);
});

test('saveJourney writes a file the loader reads back identically', async (t) => {
    const directory = await checkout();
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = await saveJourney(directory, {
        name: 'pilot',
        services: ['api', 'worker'],
        lazy: [],
        excluded: [],
    });
    assert.equal(path, join(directory, 'journeys', 'pilot.yaml'));
    const journey = await loadJourney(directory, 'pilot', nodeProjectFs);
    assert.deepEqual(journey, {
        name: 'pilot',
        services: ['api', 'worker'],
        lazy: [],
        excluded: [],
    });
});

test('saveJourney replaces an existing journey file', async (t) => {
    const directory = await checkout();
    t.after(() => rm(directory, { recursive: true, force: true }));
    await saveJourney(directory, {
        name: 'pilot',
        services: ['api'],
        lazy: [],
        excluded: [],
    });
    await saveJourney(directory, {
        name: 'pilot',
        services: ['worker'],
        lazy: ['api'],
        excluded: [],
    });
    const text = await readFile(
        join(directory, 'journeys', 'pilot.yaml'),
        'utf8',
    );
    assert.match(text, /lazy:\n {2}- api\n/);
    const journey = await loadJourney(directory, 'pilot', nodeProjectFs);
    assert.deepEqual(journey.services, ['worker']);
});

test('saveJourney rejects invalid names, overlaps, and empty journeys', async (t) => {
    const directory = await checkout();
    t.after(() => rm(directory, { recursive: true, force: true }));
    await assert.rejects(
        () =>
            saveJourney(directory, {
                name: '../escape',
                services: ['api'],
                lazy: [],
                excluded: [],
            }),
        /Invalid journey name/,
    );
    await assert.rejects(
        () =>
            saveJourney(directory, {
                name: 'dupe',
                services: ['api'],
                lazy: ['api'],
                excluded: [],
            }),
        /in both services and lazy/,
    );
    await assert.rejects(
        () => saveJourney(directory, { name: 'empty', services: [], lazy: [] }),
        /at least one service/,
    );
    await assert.rejects(
        () => readFile(join(directory, 'journeys', 'empty.yaml'), 'utf8'),
        /ENOENT/,
    );
});
