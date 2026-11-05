import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ServiceVersions,
    type VersionRead,
} from '../src/infrastructure/service-versions.js';
import { imageSelections, versionImage } from '../src/domain/image-versions.js';
import { resolveServiceState } from '../src/domain/service-state.js';
import { matchEnvironmentImages } from '../src/domain/aws-versions.js';
import { readEnvironmentVersions } from '../src/infrastructure/cidev-versions.js';
import type { ServiceGroup } from '../src/domain/services.js';

const registry = '123456789012.dkr.ecr.eu-west-2.amazonaws.com';
const groups: ServiceGroup[] = [
    {
        name: 'services',
        services: ['api', 'web', 'missing'],
        definitions: Object.fromEntries(
            ['api', 'web', 'missing'].map((name) => [
                name,
                {
                    image: `${registry}/${name}:${name === 'api' ? '${TAG:-latest}' : '1.0.0'}`,
                    module: 'services',
                    base: false,
                    deprecated: false,
                    development: true,
                    dependencies: [],
                },
            ]),
        ),
    },
    {
        name: 'Infrastructure',
        services: ['mongo'],
        definitions: {
            mongo: {
                image: `${registry}/mongo:4.0`,
                module: 'mongo',
                base: true,
                deprecated: false,
                dependencies: [],
            },
        },
    },
];

async function fixture(t: { after(fn: () => Promise<void>): void }) {
    const root = await mkdtemp(join(tmpdir(), 'chs-service-versions-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const reads: string[] = [];
    const read: VersionRead = async (source) => {
        reads.push(source);
        const matched = matchEnvironmentImages(
            groups,
            ['api', 'web'].map((name) => ({
                cluster: `${source}-cluster`,
                ecsService: `${source}-${name}`,
                container: name,
                image: `${registry}/${name}:${source === 'cidev' ? '2.0' : '3.0'}`,
                digest: `sha256:${(source === 'cidev' ? 'a' : 'b').repeat(64)}`,
            })),
            source,
        );
        return { ...matched, clusters: 1, runningTasks: 2 };
    };
    return {
        root,
        reads,
        read,
        versions: new ServiceVersions(root, groups, read),
    };
}

test('Service versions default to CIDEV and resolve per-service environments while preserving pins', async (t) => {
    const f = await fixture(t);
    const images = await f.versions.images(
        [
            { service: 'api', mode: 'Service' },
            { service: 'web', mode: 'Service' },
        ],
        {},
    );
    assert.match(images.api, /@sha256:a{64}$/);
    assert.deepEqual(f.reads, ['cidev']);
    const selected = await f.versions.images(
        [
            { service: 'api', mode: 'Service' },
            { service: 'web', mode: 'Service' },
        ],
        { versionSource: 'staging', serviceVersionSources: { web: 'cidev' } },
    );
    assert.match(selected.api, /@sha256:b{64}$/);
    assert.match(selected.web, /@sha256:a{64}$/);
    const pinned = await f.versions.images(
        [{ service: 'api', mode: 'Service' }],
        {
            versionSource: 'live',
            serviceImages: { api: `${registry}/api:7.8.9` },
        },
    );
    assert.equal(pinned.api, `${registry}/api:7.8.9`);
    assert.deepEqual(f.reads, ['cidev', 'staging']);
    const details = await f.versions.decorate(
        resolveServiceState({ services: ['api'] }, groups),
    );
    assert.equal(details.api.versionLabel, '2.0');
    assert.equal(details.api.defaultVersionSource, 'cidev');
});

test('Latest, project default, Mock, Development and infrastructure avoid environment reads', async (t) => {
    const f = await fixture(t);
    const images = await f.versions.images(
        [
            { service: 'api', mode: 'Service' },
            { service: 'web', mode: 'Development' },
            { service: 'missing', mode: 'Mock' },
            { service: 'mongo', mode: 'Service' },
        ],
        { versionSource: 'latest' },
    );
    assert.deepEqual(images, { api: `${registry}/api:latest` });
    assert.deepEqual(
        await f.versions.images([{ service: 'api', mode: 'Service' }], {
            versionSource: 'compose',
        }),
        {},
    );
    assert.deepEqual(
        await f.versions.images(
            [
                { service: 'api', mode: 'Mock' },
                { service: 'web', mode: 'Development' },
            ],
            {},
        ),
        {},
    );
    assert.deepEqual(f.reads, []);
});

test('cached versions survive daemon recreation; refresh fetches a new snapshot explicitly', async (t) => {
    const f = await fixture(t);
    await f.versions.snapshot('cidev');
    const reloaded = new ServiceVersions(f.root, groups, f.read);
    const result = await reloaded.snapshot('cidev');
    assert.match(result.images.api, /@sha256:a{64}$/);
    assert.deepEqual(f.reads, ['cidev']);
    await reloaded.snapshot('cidev', undefined, true);
    assert.deepEqual(f.reads, ['cidev', 'cidev']);
});

test('ambiguous or absent images warn for the global source and reject explicit environment overrides', async (t) => {
    const f = await fixture(t);
    const warnings: string[] = [];
    const inventory = [{ service: 'missing', mode: 'Service' as const }];
    assert.deepEqual(
        await f.versions.images(inventory, {}, undefined, (message) =>
            warnings.push(message),
        ),
        {},
    );
    assert.match(warnings[0], /Using the project default/);
    await assert.rejects(
        f.versions.images(inventory, {
            serviceVersionSources: { missing: 'cidev' },
        }),
        /no unambiguous running image/,
    );
});

test('cached snapshots expire and cancelled refreshes leave the previous snapshot usable', async (t) => {
    const f = await fixture(t);
    let now = Date.now();
    const versions = new ServiceVersions(f.root, groups, f.read, () => now);
    await versions.snapshot('cidev');
    now += 300_001;
    await versions.snapshot('cidev');
    assert.deepEqual(f.reads, ['cidev', 'cidev']);
    const abort = new AbortController();
    abort.abort(new Error('Cancelled'));
    await assert.rejects(
        versions.snapshot('cidev', abort.signal, true),
        /Cancelled/,
    );
    assert.match(
        (await versions.snapshot('cidev')).images.api,
        /sha256:a{64}$/,
    );
});

test('environment selections and version tags validate before preparation', () => {
    assert.deepEqual(
        imageSelections({
            versionSource: 'live',
            serviceVersionSources: { api: 'latest' },
        }),
        { versionSource: 'live', serviceVersionSources: { api: 'latest' } },
    );
    assert.throws(
        () => imageSelections({ versionSource: 'invalid' }),
        /Invalid versionSource/,
    );
    assert.throws(
        () => imageSelections({ serviceVersionSources: { api: 'invalid' } }),
        /Invalid version source/,
    );
    assert.equal(
        versionImage('4.5.6', `${registry}/api:${'${TAG:-latest}'}`),
        `${registry}/api:4.5.6`,
    );
    assert.equal(
        versionImage('sha256:' + 'a'.repeat(64), `${registry}/api:latest`),
        `${registry}/api@sha256:${'a'.repeat(64)}`,
    );
    assert.throws(
        () => versionImage('bad value', `${registry}/api:latest`),
        /Enter a version/,
    );
});

test('other environment readers select their own cluster and service names using read-only ECS operations', async () => {
    const calls: string[][] = [];
    const result = await readEnvironmentVersions('staging', groups, {
        read: async (args) => {
            calls.push(args);
            if (args[1] === 'list-clusters')
                return [
                    'utility-cidev-cluster',
                    'utility-staging-cluster',
                    'utility-live-cluster',
                ];
            if (args[1] === 'list-tasks') return ['task'];
            return {
                failures: [],
                tasks: [
                    {
                        group: 'service:staging-api',
                        lastStatus: 'RUNNING',
                        containers: [
                            {
                                name: 'api',
                                image: `${registry}/api:3.0`,
                                imageDigest: `sha256:${'b'.repeat(64)}`,
                                lastStatus: 'RUNNING',
                            },
                        ],
                    },
                ],
            };
        },
    });
    assert.equal(result.matches[0].ecsService, 'staging-api');
    assert.ok(
        calls
            .slice(1)
            .every(
                (args) =>
                    args[args.indexOf('--cluster') + 1] ===
                    'utility-staging-cluster',
            ),
    );
    assert.ok(
        calls.every((args) =>
            ['list-clusters', 'list-tasks', 'describe-tasks'].includes(args[1]),
        ),
    );
});

test('a cancelled metadata refresh waiter cannot report success from another caller’s shared read', async (t) => {
    const f = await fixture(t);
    const existing = await f.read('cidev');
    let release!: (value: typeof existing) => void;
    const gate = new Promise<typeof existing>((resolve) => {
        release = resolve;
    });
    const versions = new ServiceVersions(f.root, groups, async () => gate);
    const first = versions.snapshot('cidev', undefined, true);
    const abort = new AbortController();
    const cancelled = versions.snapshot('cidev', abort.signal, true);
    abort.abort(new Error('Version refresh cancelled'));
    release(existing);
    await assert.rejects(cancelled, /Version refresh cancelled/);
    assert.equal(
        (await first).images.api,
        `${registry}/api@sha256:${'a'.repeat(64)}`,
    );
});

test('a failed cache publication preserves the previous persisted snapshot across recreation', async (t) => {
    const f = await fixture(t);
    let clock = Date.now();
    const versions = new ServiceVersions(f.root, groups, f.read, () => clock);
    const initial = await versions.snapshot('cidev');
    clock += 1000;
    await chmod(f.root, 0o500);
    try {
        await assert.rejects(
            versions.snapshot('cidev', undefined, true),
            /EACCES|EPERM/,
        );
    } finally {
        await chmod(f.root, 0o700);
    }
    const recreated = new ServiceVersions(f.root, groups, async () => {
        throw new Error('Unexpected metadata reread');
    });
    const persisted = await recreated.snapshot('cidev');
    assert.equal(persisted.retrievedAt, initial.retrievedAt);
    assert.equal(persisted.images.api, initial.images.api);
});
