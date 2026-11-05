import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientProvider } from '../src/tui/context.js';
import EnvironmentPanel from '../src/tui/components/environment-panel.js';
import { terminal } from './support/terminal.js';
import { profileFixture } from './support/profile-fixture.js';
import { eventually } from './daemon-fixture.js';

test('TUI export and import share file paths and require review before replacing selections', async (t) => {
    const f = await profileFixture();
    const client = await f.client();
    const term = terminal(
        createElement(
            ClientProvider,
            { value: client },
            createElement(EnvironmentPanel, {
                state: f.app.snapshot().live,
                onClose: () => {},
                onSetupSsh: () => {},
                onLogin: () => {},
                onViewLogs: () => {},
                onAutoApply: () => {},
            }),
        ),
    );
    t.after(async () => {
        term.app.unmount();
        await f.close();
    });
    await delay(150);
    await term.key('p');
    assert.match(term.frame(), /Share environment/);
    assert.doesNotMatch(term.frame(), /Copy CIDEV/);
    await term.key('\r');
    await term.key('\r');
    await eventually(() => term.frame().includes('Exported'));
    const path = `${f.directory}/environments/environment.yaml`;
    assert.equal(f.files.get(path)!.selections.services[0], 'api');
    f.files.get(path)!.selections.services = [];
    await term.key('\u001b[B');
    await term.key('\r');
    await term.key('\r');
    await eventually(() => term.frame().includes('Review environment import'));
    assert.match(term.frame(), /api · enabled: Yes → No/);
    assert.equal(f.app.snapshot().details.api.enabled, 'Yes');
    await term.key('\u001b[A');
    await term.key('\r');
    await eventually(() => term.frame().includes('Configuration saved'));
    assert.equal(f.app.snapshot().details.api.enabled, 'No');
    assert.equal(f.engine.applies, 0);
});
