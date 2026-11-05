import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseProfileList, resolveSettings } from '../src/domain/settings.js';
import {
    SettingsStore,
    expandHome,
    parseSettings,
    settingsPath,
    stateDirectory,
    writeSetting,
} from '../src/infrastructure/settings.js';

test('settings paths follow XDG with absolute overrides only', () => {
    assert.equal(
        settingsPath({}, '/home/me'),
        '/home/me/.config/chs-dev/tui.yaml',
    );
    assert.equal(
        settingsPath({ XDG_CONFIG_HOME: '/xdg' }, '/home/me'),
        '/xdg/chs-dev/tui.yaml',
    );
    assert.equal(
        settingsPath({ XDG_CONFIG_HOME: 'relative' }, '/home/me'),
        '/home/me/.config/chs-dev/tui.yaml',
    );
    assert.equal(
        stateDirectory({}, '/home/me'),
        '/home/me/.local/state/chs-dev',
    );
    assert.equal(
        stateDirectory({ XDG_STATE_HOME: '/state' }, '/home/me'),
        '/state/chs-dev',
    );
    assert.equal(expandHome('~/x', '/home/me'), '/home/me/x');
    assert.equal(expandHome('/abs', '/home/me'), '/abs');
});

test('environment overrides file, which overrides defaults, with sources reported', () => {
    const file = {
        project: '/file/project',
        awsProfile: 'file-profile',
        ecrProfiles: ['a', 'b'],
    };
    const defaults = resolveSettings({}, {});
    assert.equal(defaults.awsProfile.value, 'default');
    assert.equal(defaults.project.value, undefined);
    assert.equal(defaults.ecrProfiles.value, undefined);

    const fromFile = resolveSettings(file, {});
    assert.equal(fromFile.project.value, '/file/project');
    assert.equal(fromFile.project.source, 'file');
    assert.deepEqual(fromFile.ecrProfiles.value, ['a', 'b']);

    const fromEnv = resolveSettings(file, {
        CHS_DEV_PROJECT: '/env/project',
        AWS_DEFAULT_PROFILE: 'fallback-env',
        CHS_DEV_ECR_PROFILES: 'x, y x',
        CHS_DEV_RUNTIME: '  ',
    });
    assert.equal(fromEnv.project.value, '/env/project');
    assert.equal(fromEnv.project.source, 'env');
    assert.equal(fromEnv.project.environment, 'CHS_DEV_PROJECT');
    assert.equal(fromEnv.project.file, '/file/project');
    assert.equal(fromEnv.awsProfile.value, 'fallback-env');
    assert.equal(fromEnv.awsProfile.environment, 'AWS_DEFAULT_PROFILE');
    assert.deepEqual(fromEnv.ecrProfiles.value, ['x', 'y']);
    assert.equal(
        resolveSettings({}, { AWS_PROFILE: 'p', AWS_DEFAULT_PROFILE: 'q' })
            .awsProfile.value,
        'p',
    );
    assert.equal(parseProfileList('bad profile!'), undefined);
    // An unusable environment list falls back to the file value.
    assert.deepEqual(
        resolveSettings(file, { CHS_DEV_ECR_PROFILES: '!!' }).ecrProfiles.value,
        ['a', 'b'],
    );
});

test('invalid files and entries are reported without failing', () => {
    assert.deepEqual(parseSettings(null).values, {});
    const broken = parseSettings('project: [');
    assert.deepEqual(broken.values, {});
    assert.match(broken.errors[0], /not valid YAML/);
    const mixed = parseSettings(
        [
            'version: 1',
            'project: ~/checkout',
            'runtime: Docker',
            'autoApply: maybe',
            'aws:',
            '  profile: "has space"',
            '  ecrProfiles: [one, two, one]',
        ].join('\n'),
        '/home/me',
    );
    assert.deepEqual(mixed.values, {
        project: '/home/me/checkout',
        ecrProfiles: ['one', 'two'],
    });
    assert.equal(mixed.errors.length, 2);
    assert.match(mixed.errors.join('\n'), /autoApply/);
    assert.match(mixed.errors.join('\n'), /aws\.profile/);
});

test('saving preserves comments and unknown keys, writes atomically and detects conflicts', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-settings-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'nested', 'chs-dev', 'tui.yaml');

    let raw = await writeSetting(path, 'awsProfile', 'dev', null, root);
    assert.match(raw, /version: 1/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
        (await stat(join(root, 'nested', 'chs-dev'))).mode & 0o777,
        0o700,
    );

    await writeFile(path, `# keep me\nextra: true\n${raw}`);
    raw = await readFile(path, 'utf8');
    raw = await writeSetting(path, 'ecrProfiles', ['a', 'b'], raw, root);
    assert.match(raw, /# keep me/);
    assert.match(raw, /extra: true/);
    assert.deepEqual(parseSettings(raw).values.ecrProfiles, ['a', 'b']);

    raw = await writeSetting(path, 'ecrProfiles', undefined, raw, root);
    raw = await writeSetting(path, 'awsProfile', undefined, raw, root);
    assert.doesNotMatch(raw, /aws:/);

    await assert.rejects(
        writeSetting(path, 'awsProfile', 'x', 'stale', root),
        /changed outside/,
    );
    await assert.rejects(
        writeSetting(path, 'project', 'relative', raw, root),
        /absolute/,
    );
    await writeFile(path, 'project: [');
    await assert.rejects(
        writeSetting(path, 'awsProfile', 'x', 'project: [', root),
        /invalid settings file/,
    );
});

test('store tracks current values and restart-only changes', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-settings-store-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'tui.yaml');
    const store = await SettingsStore.load(path, { AWS_PROFILE: 'env' }, root);
    let notified = 0;
    store.subscribe(() => notified++);

    await store.save('awsProfile', 'file-profile');
    let snapshot = store.getSnapshot();
    assert.equal(snapshot.resolved.awsProfile.value, 'env');
    assert.equal(snapshot.resolved.awsProfile.file, 'file-profile');
    assert.deepEqual(snapshot.restartPending, []);

    await store.save('project', join(root, 'project'));
    snapshot = store.getSnapshot();
    assert.equal(snapshot.resolved.project.value, join(root, 'project'));
    assert.equal(snapshot.startup.project.value, undefined);
    assert.deepEqual(snapshot.restartPending, ['project']);

    await store.save('project', undefined);
    assert.deepEqual(store.getSnapshot().restartPending, []);
    assert.equal(notified, 3);

    const reloaded = await SettingsStore.load(path, {}, root);
    assert.equal(
        reloaded.getSnapshot().resolved.awsProfile.value,
        'file-profile',
    );
});

test('login preference is read from the file and CHS_DEV_LOGIN', () => {
    assert.equal(resolveSettings({}, {}).loginAction.value, undefined);
    const file = parseSettings('login:\n  action: registry\n');
    assert.deepEqual(file.values, { loginAction: 'registry' });
    assert.match(
        parseSettings('login:\n  action: sometimes\n').errors.join('\n'),
        /login\.action/,
    );
    const env = resolveSettings(file.values, { CHS_DEV_LOGIN: 'aws' });
    assert.equal(env.loginAction.value, 'aws');
    assert.equal(env.loginAction.source, 'env');
    assert.equal(
        resolveSettings({}, { CHS_DEV_LOGIN: 'Docker' }).loginAction.value,
        'registry',
    );
    assert.equal(
        resolveSettings({ loginAction: 'ask' }, { CHS_DEV_LOGIN: '??' })
            .loginAction.value,
        'ask',
    );
});

test('automatic login defaults to when needed and reads login.auto and CHS_DEV_AUTO_LOGIN', () => {
    assert.equal(resolveSettings({}, {}).autoLogin.value, 'needed');
    const file = parseSettings('login:\n  auto: needed\n');
    assert.deepEqual(file.values, { autoLogin: 'needed' });
    assert.match(
        parseSettings('login:\n  auto: maybe\n').errors.join('\n'),
        /login\.auto/,
    );
    assert.equal(
        resolveSettings(file.values, { CHS_DEV_AUTO_LOGIN: 'expired' })
            .autoLogin.value,
        'expired',
    );
});

test('retired backend configuration is ignored with persistent warnings and no file rewrite', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-retired-settings-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'tui.yaml');
    const raw =
        '# preserve me\nruntime: apple\norchestrator: native\nautoApply: false\n';
    await writeFile(path, raw);
    const env = { CHS_DEV_RUNTIME: 'apple', CHS_DEV_ORCHESTRATOR: 'native' };
    const store = await SettingsStore.load(path, env, root);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.warnings.length, 4);
    assert.deepEqual(snapshot.errors, []);
    assert.deepEqual(snapshot.restartPending, []);
    assert.equal('runtime' in snapshot.resolved, false);
    assert.equal('orchestrator' in snapshot.resolved, false);
    assert.equal(snapshot.resolved.autoApply.value, false);
    assert.equal(await readFile(path, 'utf8'), raw);
    await store.save('autoApply', true);
    assert.match(
        await readFile(path, 'utf8'),
        /# preserve me\nruntime: apple\norchestrator: native/,
    );
    assert.equal(store.getSnapshot().warnings.length, 4);
    await writeFile(path, 'autoApply: false\n');
    await store.refresh();
    assert.equal(store.getSnapshot().warnings.length, 2);
    assert.ok(
        store
            .getSnapshot()
            .warnings.every((warning) => warning.startsWith('CHS_DEV_')),
    );
});
