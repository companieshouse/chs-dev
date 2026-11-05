import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    readdir,
    rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppleClient } from '../src/infrastructure/native/apple-client.js';
import {
    appleImageMetadata,
    parseImageMetadata,
} from '../src/infrastructure/native/apple-image-metadata.js';

const digest = `sha256:${'a'.repeat(64)}`;
const configDigest = `sha256:${'b'.repeat(64)}`;
const manifestDigest = `sha256:${'c'.repeat(64)}`;
const defaults = {
    Volumes: { '/data': {} },
    Healthcheck: {
        Test: ['CMD-SHELL', 'test -f /ready'],
        Interval: 1000,
        Retries: 3,
    },
    Shell: ['/bin/sh', '-c'],
};

test('image metadata validates health, shell and volume boundaries', () => {
    assert.deepEqual(parseImageMetadata(defaults), defaults);
    assert.deepEqual(
        parseImageMetadata({ Volumes: null, Healthcheck: null, Shell: null }),
        { Volumes: null, Healthcheck: null, Shell: null },
    );
    for (const invalid of [
        null,
        [],
        { Volumes: [] },
        { Shell: [1] },
        { Healthcheck: { Test: null } },
        { Healthcheck: { Test: 'true' } },
        { Healthcheck: { Interval: '1s' } },
        { Healthcheck: { Timeout: Infinity } },
    ]) {
        assert.throws(() => parseImageMetadata(invalid), /Invalid/);
    }
});

function imageClient(state: string, config: unknown, calls: string[]) {
    const members: Record<string, unknown> = {
        'index.json': {
            manifests: [
                {
                    digest: manifestDigest,
                    platform: { os: 'linux', architecture: 'arm64' },
                },
            ],
        },
        [`blobs/sha256/${manifestDigest.slice(7)}`]: {
            config: { digest: configDigest },
        },
        [`blobs/sha256/${configDigest.slice(7)}`]: { config },
    };
    return new AppleClient({
        directory: state,
        environment: { resolve: async () => ({}) },
        execute: async (request) => {
            calls.push(request.command);
            const member =
                request.command === '/usr/bin/tar'
                    ? members[request.args.at(-1)!]
                    : {};
            return { code: 0, stdout: JSON.stringify(member), stderr: '' };
        },
    });
}

test('exported image defaults are validated, cached and reused without another export', async (t) => {
    const state = await mkdtemp(join(tmpdir(), 'chs-image-metadata-'));
    t.after(() => rm(state, { recursive: true, force: true }));
    const calls: string[] = [];
    const request = {
        state,
        digest,
        reference: 'fixture:latest',
        platform: 'linux/arm64',
        context: {},
        client: imageClient(state, defaults, calls),
    };
    assert.deepEqual(await appleImageMetadata(request), defaults);
    assert.equal(calls.length, 4);
    assert.deepEqual(await appleImageMetadata(request), defaults);
    assert.equal(calls.length, 4);
    const root = join(state, 'image-metadata');
    assert.deepEqual(await readdir(root), [digest.slice(7) + '.json']);
    assert.deepEqual(
        JSON.parse(
            await readFile(join(root, digest.slice(7) + '.json'), 'utf8'),
        ),
        defaults,
    );
});

test('malformed cached or exported metadata fails without caching it or retaining temporary files', async (t) => {
    const state = await mkdtemp(join(tmpdir(), 'chs-image-metadata-'));
    t.after(() => rm(state, { recursive: true, force: true }));
    const calls: string[] = [];
    const request = {
        state,
        digest,
        reference: 'fixture:latest',
        platform: 'linux/arm64',
        context: {},
        client: imageClient(state, { Shell: [false] }, calls),
    };
    await assert.rejects(appleImageMetadata(request), /Invalid/);
    const root = join(state, 'image-metadata');
    assert.deepEqual(await readdir(root), []);
    await mkdir(root, { recursive: true });
    await writeFile(
        join(root, digest.slice(7) + '.json'),
        JSON.stringify({ Healthcheck: { Test: null } }),
    );
    await assert.rejects(appleImageMetadata(request), /Invalid/);
    assert.equal(calls.length, 4);
});
