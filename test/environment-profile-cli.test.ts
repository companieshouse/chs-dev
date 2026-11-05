import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '../src/cli/run.js';
import { profileFixture } from './support/profile-fixture.js';

async function invoke(
    args: string[],
    fixture: Awaited<ReturnType<typeof profileFixture>>,
) {
    let output = '',
        errors = '';
    const code = await runCli([...args, '--json'], {
        connect: fixture.client,
        out: (text) => {
            output += text;
        },
        err: (text) => {
            errors += text;
        },
    });
    assert.equal(code, 0, output + errors);
    return JSON.parse(output).data;
}

test('CLI export, diff and import review shared selections before saving', async (t) => {
    const f = await profileFixture();
    t.after(() => f.close());
    const path = join(f.root, 'team.yaml');
    await invoke(['environment', 'export', path], f);
    const profile = f.files.get(path)!;
    profile.selections.services = [];
    const revision = f.stores.get(f.directory)!.revision;
    const diff = await invoke(['environment', 'diff', path], f);
    assert.ok(
        diff.changes.some(
            (change: any) =>
                change.field === 'enabled' && change.after === 'No',
        ),
    );
    await invoke(['environment', 'import', path], f);
    assert.equal(f.stores.get(f.directory)!.revision, revision);
    await invoke(['environment', 'import', path, '--yes'], f);
    assert.equal(f.app.snapshot().details.api.enabled, 'No');
    assert.equal(f.engine.applies, 0);
});

test('CLI CIDEV copying is preview-only by default and version-only saves stay deferred across restart', async (t) => {
    const f = await profileFixture();
    t.after(() => f.close());
    await invoke(
        [
            'service',
            'configure',
            'api',
            '--provider',
            'mock',
            '--scenario',
            'error',
        ],
        f,
    );
    await invoke(['start'], f);
    const applies = f.engine.applies;
    const before = structuredClone(f.stores.get(f.directory)!.selections);
    const path = join(f.root, 'cidev.yaml');
    const preview = await invoke(
        ['environment', 'versions', 'cidev', '--output', path],
        f,
    );
    assert.equal(preview.saved, false);
    assert.deepEqual(f.stores.get(f.directory)!.selections, before);
    assert.match(f.files.get(path)!.selections.serviceImages!.api, /@sha256:/);
    const saved = await invoke(
        ['environment', 'versions', 'cidev', '--yes'],
        f,
    );
    assert.equal(saved.saved, true);
    const after = f.stores.get(f.directory)!.selections;
    const withoutImages = { ...after };
    delete withoutImages.serviceImages;
    assert.deepEqual(withoutImages, before);
    assert.equal(f.app.snapshot().details.api.mode, 'Mock');
    assert.equal(f.app.snapshot().details.api.mockScenario, 'error');
    await f.controller.poll();
    await f.restart();
    await f.controller.poll();
    assert.equal(f.engine.applies, applies);
    assert.ok(f.app.snapshot().live.deferredConfigurationRevision);
    await invoke(['apply'], f);
    assert.equal(f.engine.applies, applies + 1);
});

test('global source and per-service overrides preserve providers and clear explicit pins when requested', async (t) => {
    const f = await profileFixture();
    t.after(() => f.close());
    await invoke(
        [
            'service',
            'configure',
            'api',
            '--provider',
            'mock',
            '--scenario',
            'error',
            '--image',
            'registry.example/api:3.4.5',
        ],
        f,
    );
    await invoke(['environment', 'source', 'live'], f);
    let selections = f.stores.get(f.directory)!.selections;
    assert.equal(selections.versionSource, 'live');
    assert.equal(selections.serviceProviders!.api, 'mock');
    assert.equal(selections.mockScenarios!.api, 'error');
    assert.equal(selections.serviceImages!.api, 'registry.example/api:3.4.5');
    await invoke(
        ['service', 'configure', 'api', '--version-source', 'latest'],
        f,
    );
    selections = f.stores.get(f.directory)!.selections;
    assert.equal(selections.serviceImages!.api, undefined);
    assert.equal(selections.serviceVersionSources!.api, 'latest');
    await invoke(
        ['service', 'configure', 'api', '--version-source', 'default'],
        f,
    );
    assert.equal(selections.serviceVersionSources!.api, undefined);
    assert.equal(f.reads(), 0);
    assert.equal(f.engine.applies, 0);
});

test('stale profile previews reject saves and CLI rejects other AWS environments locally', async (t) => {
    const f = await profileFixture();
    t.after(() => f.close());
    const client = await f.client();
    const profile = await client.query('environment.profile', {});
    const preview = await client.query('environment.profilePreview', {
        profile,
        versionsOnly: false,
    });
    await invoke(['service', 'configure', 'api', '--provider', 'mock'], f);
    await assert.rejects(
        client.command('environment.profileImport', {
            profile,
            versionsOnly: false,
            revision: preview.revision,
        }),
        (error: any) => error.detail.code === 'CONFIGURATION_CONFLICT',
    );
    let output = '';
    const code = await runCli(['environment', 'versions', 'live', '--json'], {
        connect: async () => {
            throw new Error('Unexpected daemon connection');
        },
        out: (text) => {
            output += text;
        },
        err: () => {},
    });
    assert.equal(code, 2);
    assert.equal(JSON.parse(output).error.code, 'INVALID_USAGE');
    assert.equal(f.reads(), 0);
    await assert.rejects(
        client.command('environment.profileImport', {
            profile: { ...profile, version: 2 } as any,
            versionsOnly: false,
            revision: client.getSnapshot().configurationRevision,
        }),
        (error: any) => error.detail.code === 'INVALID_REQUEST',
    );
});
