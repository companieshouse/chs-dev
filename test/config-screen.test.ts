import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { resolveSettings } from '../src/domain/settings.js';
import type { SettingsSnapshot } from '../src/infrastructure/settings.js';
import ConfigScreen, {
    configRows,
} from '../src/tui/components/config-screen.js';
import { editText } from '../src/tui/components/text-input.js';
import { terminal } from './support/terminal.js';

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
        warnings: [],
        restartPending:
            resolved.project.value === startup.project.value ? [] : ['project'],
    };
}

test('config rows report sources, overrides, restart markers and project problems', () => {
    const rows = configRows(
        snapshot(
            { awsProfile: 'file-profile' },
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
    assert.equal(byKey.runtime, undefined);
    assert.equal(byKey.orchestrator, undefined);
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

test('Config shows retired-setting warnings without offering backend controls', async () => {
    const settings = {
        ...snapshot({}),
        warnings: [
            'runtime is retired and ignored; Docker Compose is always used.',
        ],
    };
    const term = terminal(
        createElement(ConfigScreen, {
            settings,
            rows: configRows(settings, undefined, undefined),
            active: true,
            height: 32,
            onEdit: () => {},
        }),
    );
    try {
        await term.waitFor(/runtime is retired and ignored/);
        assert.doesNotMatch(
            term.frame(),
            /Container engine|Orchestration|Start Apple/,
        );
    } finally {
        term.app.unmount();
    }
});
