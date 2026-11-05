import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectSession } from '../src/application/project-session.js';
import type { ApplicationHost } from '../src/application/ports.js';
import type { Interactions } from '../src/application/interactions.js';
import { resolveSettings } from '../src/domain/settings.js';
import { runCli } from '../src/cli/run.js';
import type { Client } from '../src/client/client.js';

for (const json of [false, true]) {
    test(`CLI status reports retired settings in ${json ? 'JSON' : 'text'} output`, async () => {
        const resolved = resolveSettings({}, {});
        const warning =
            'Settings file key runtime is retired and ignored; chs-dev always uses Docker Compose.';
        const host = {
            id: () => 'id',
            home: '/home',
            settingsRevision: () => 'revision',
            settings: () => ({
                path: '/settings',
                resolved,
                startup: resolved,
                errors: [],
                warnings: [warning],
                restartPending: [],
            }),
        } as unknown as ApplicationHost;
        const snapshot = new ProjectSession(host, {
            snapshot: () => undefined,
        } as unknown as Interactions).snapshot();
        const client = {
            getSnapshot: () => snapshot,
            query: async () => undefined,
            refreshSession: async () => snapshot,
            close: () => {},
        } as unknown as Client;
        let output = '',
            errors = '';
        const code = await runCli(['status', ...(json ? ['--json'] : [])], {
            connect: async () => client,
            out: (text) => {
                output += text;
            },
            err: (text) => {
                errors += text;
            },
        });
        assert.equal(code, 0, errors);
        if (json) {
            const envelope = JSON.parse(output);
            assert.ok(envelope.warnings.includes(warning));
            assert.deepEqual(envelope.data.warnings, [warning]);
        } else assert.ok(errors.includes(warning));
    });
}
