import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { EnvironmentProfiles } from '../src/project/environment-profiles.js';
import { configurationSnapshot } from '../src/project/configuration.js';
import { parseEnvironmentProfile } from '../src/domain/environment-profile.js';
import { imageSelections, validImage } from '../src/domain/image-versions.js';
import { readMockCatalogue } from '../src/project/mock-catalogue.js';
import type { ServiceGroup } from '../src/domain/services.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
    const root = await mkdtemp(join(tmpdir(), 'chs-environment-profile-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const catalogue = await readMockCatalogue();
    const groups: ServiceGroup[] = [
        {
            name: 'fixture',
            services: ['api', 'felixvalidator', 'database'],
            definitions: {
                api: {
                    module: 'fixture',
                    dependencies: ['database'],
                    base: false,
                    deprecated: false,
                    development: true,
                    image: 'registry.example/api:1.0.0',
                },
                database: {
                    module: 'fixture',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                    image: 'database:1.0',
                },
                felixvalidator: {
                    module: 'fixture',
                    dependencies: ['database'],
                    base: false,
                    deprecated: false,
                    development: true,
                    image: 'registry.example/felixvalidator:2.0.0',
                    mock: catalogue.services.felixvalidator,
                },
            },
        },
    ];
    const selections = {
        modules: [],
        services: ['api', 'felixvalidator'],
        servicesWithLiveUpdate: [],
        excludedServices: [],
        serviceProviders: { felixvalidator: 'mock' },
        mockScenarios: { felixvalidator: 'validation-failed' },
    };
    await writeFile(
        join(root, '.chs-dev.yaml'),
        '# Shared selection\n' +
            stringify({ ...selections, privateExtension: 'preserve me' }),
    );
    return { root, groups, profiles: new EnvironmentProfiles(root, groups) };
}

test('portable exports capture providers, scenarios, effective service images and mock fingerprints', async (t) => {
    const f = await fixture(t);
    await writeFile(
        join(f.root, '.env'),
        'AWS_SECRET_ACCESS_KEY=private-value\n',
    );
    const result = await f.profiles.export('environments/accounts.yaml');
    const raw = await readFile(result.path, 'utf8');
    assert.doesNotMatch(
        raw,
        /private-value|privateExtension|AWS_SECRET_ACCESS_KEY/,
    );
    const profile = await f.profiles.read(result.path);
    assert.equal(
        profile.selections.mockScenarios?.felixvalidator,
        'validation-failed',
    );
    assert.equal(profile.selections.serviceProviders?.felixvalidator, 'mock');
    assert.equal(
        profile.selections.serviceImages?.api,
        'registry.example/api:1.0.0',
    );
    assert.equal(profile.selections.serviceImages?.database, 'database:1.0');
    assert.equal(profile.selections.serviceImages?.felixvalidator, undefined);
    assert.match(profile.mockContracts!.felixvalidator, /^[a-f0-9]{64}$/);
    await assert.rejects(f.profiles.export(result.path), { code: 'EEXIST' });
});

test('version-only imports preserve providers, scenarios, exclusions and unrelated image pins', async (t) => {
    const f = await fixture(t);
    const before = await configurationSnapshot(f.root);
    const profile = await f.profiles.snapshot();
    profile.selections = {
        ...profile.selections,
        services: [],
        serviceProviders: { felixvalidator: 'service' },
        mockScenarios: {},
        serviceImages: { api: 'registry.example/api@sha256:' + 'a'.repeat(64) },
    };
    const preview = await f.profiles.preview(profile, true);
    assert.ok(preview.changes.every((change) => change.field === 'image'));
    const saved = await f.profiles.save({
        profile,
        versionsOnly: true,
        revision: preview.revision,
    });
    assert.deepEqual(saved.selections.services, before.selections.services);
    assert.deepEqual(
        saved.selections.serviceProviders,
        before.selections.serviceProviders,
    );
    assert.deepEqual(
        saved.selections.mockScenarios,
        before.selections.mockScenarios,
    );
    const raw = await readFile(join(f.root, '.chs-dev.yaml'), 'utf8');
    assert.match(raw, /Shared selection/);
    assert.equal(parse(raw).privateExtension, 'preserve me');
    await assert.rejects(
        f.profiles.save({
            profile,
            versionsOnly: true,
            revision: before.revision,
        }),
        /Configuration changed/,
    );
});

test('profile validation fails before changing configuration and warns on changed mock content', async (t) => {
    const f = await fixture(t);
    const profile = await f.profiles.snapshot();
    profile.mockContracts!.felixvalidator = '0'.repeat(64);
    assert.match(
        (await f.profiles.preview(profile)).warnings.join('\n'),
        /mock contract differs/,
    );
    profile.selections.services.push('missing-api');
    const before = await readFile(join(f.root, '.chs-dev.yaml'), 'utf8');
    await assert.rejects(f.profiles.preview(profile), /Unknown service/);
    assert.equal(await readFile(join(f.root, '.chs-dev.yaml'), 'utf8'), before);
    assert.throws(
        () => parseEnvironmentProfile({ ...profile, version: 2 }),
        /Unsupported/,
    );
});

test('image pins reject interpolated values, credentials, malformed digests and shell syntax', () => {
    for (const image of [
        'repo:${TAG}',
        'https://registry/repo:1',
        'user:secret@registry/repo:1',
        'repo@sha256:short',
        'repo:$(command)',
    ])
        assert.equal(validImage(image), false, image);
    assert.equal(validImage('localhost:5000/team/api:1.2.3'), true);
    assert.throws(
        () => imageSelections({ serviceImages: { api: 'repo:${TAG}' } }),
        /Invalid image pin/,
    );
});
