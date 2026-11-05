import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSettings } from '../src/domain/settings.js';
import type { SettingsSnapshot } from '../src/infrastructure/settings.js';
import { configRows } from '../src/tui/components/config-screen.js';
import { editText } from '../src/tui/components/text-input.js';

function snapshot(
    file: Parameters<typeof resolveSettings>[0],
    env: NodeJS.ProcessEnv = {},
    startup = resolveSettings(file, env),
): SettingsSnapshot {
    const resolved = resolveSettings(file, env);
    return {
        path: '/home/me/.config/chs-dev/tui.yaml',
        resolved,
        startup,
        errors: [],
        restartPending:
            resolved.project.value === startup.project.value ? [] : ['project'],
    };
}

test('config rows report sources, overrides, restart markers and project problems', () => {
    const rows = configRows(
        snapshot(
            { awsProfile: 'file-profile', runtime: 'docker' },
            { AWS_PROFILE: 'env-profile' },
        ),
        { directory: '/work', valid: false, message: 'Missing markers.' },
        {
            profiles: [],
            registries: [],
            unmatched: ['1.dkr.ecr.eu-west-2.amazonaws.com'],
            recommended: ['development-eu-west-2'],
            warnings: [],
        },
    );
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.awsProfile.value, 'env-profile');
    assert.equal(byKey.awsProfile.source, 'env AWS_PROFILE');
    assert.match(byKey.awsProfile.note ?? '', /file-profile is overridden/);
    assert.equal(byKey.runtime.source, 'file');
    assert.equal(byKey.runtime.problem, undefined);
    assert.match(byKey.project.problem ?? '', /No project selected/);
    assert.equal(byKey.ecrProfiles.value, 'automatic: development-eu-west-2');
    assert.match(byKey.ecrProfiles.problem ?? '', /No local profile matches/);

    const pending = configRows(
        snapshot(
            { project: '/new' },
            {},
            resolveSettings({ project: '/old' }, {}),
        ),
        { directory: '/old', valid: false, message: 'bad' },
        undefined,
    ).find((row) => row.key === 'project');
    assert.equal(pending?.restart, true);
    assert.equal(pending?.problem, undefined);
    assert.equal(pending?.value, '/new');

    const unsupported = configRows(
        snapshot({ runtime: 'podman' }),
        undefined,
        undefined,
    ).find((row) => row.key === 'runtime');
    assert.match(unsupported?.problem ?? '', /Unsupported runtime/);

    const login = (file: Parameters<typeof snapshot>[0]) =>
        configRows(snapshot(file), undefined, undefined).find(
            (row) => row.key === 'loginAction',
        );
    assert.equal(login({})?.value, 'Ask every time');
    assert.equal(
        login({ loginAction: 'registry' })?.value,
        'AWS + registry login',
    );
    assert.equal(login({ loginAction: 'registry' })?.label, 'Ctrl+L login');
});

test('text editing handles typing, paste, deletion and clearing', () => {
    const none = { backspace: false, delete: false, ctrl: false, meta: false };
    assert.equal(editText('ab', 'c', none), 'abc');
    assert.equal(editText('', '~/Work\u001b[', none), '~/Work[');
    assert.equal(editText('abc', '', { ...none, backspace: true }), 'ab');
    assert.equal(editText('abc', 'u', { ...none, ctrl: true }), '');
    assert.equal(editText('abc', 'x', { ...none, ctrl: true }), undefined);
    assert.equal(editText('abc', '\r', none), undefined);
});
