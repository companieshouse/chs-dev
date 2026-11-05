import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { resolveSettings, settingKeys } from '../src/domain/settings.js';
import SettingEditor from '../src/tui/components/setting-editor.js';
import { terminal } from './support/terminal.js';

test('every setting key opens an editor that renders something', async () => {
    const resolved = resolveSettings({}, {});
    // The project picker renders after an async search, so it is covered elsewhere.
    for (const setting of settingKeys.filter((key) => key !== 'project')) {
        const term = terminal(
            createElement(SettingEditor, {
                setting,
                settings: {
                    path: '/tmp/tui.yaml',
                    resolved,
                    startup: resolved,
                    errors: [],
                    warnings: [],
                    restartPending: [],
                },
                projectDirectory: undefined,
                discovery: {},
                save: async () => {},
                clone: async () => ({ ok: true }) as any,
                onClose: () => {},
            }),
        );
        try {
            await term.waitFor(/\S/, 1000).catch((error) => {
                throw new Error(`${setting}: ${error.message}`);
            });
            assert.ok(term.frame().trim().length > 0, `${setting} is blank`);
        } finally {
            term.app.unmount();
        }
    }
});
