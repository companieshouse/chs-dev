import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientProvider } from '../src/tui/context.js';
import EnvironmentPanel from '../src/tui/components/environment-panel.js';
import ServiceModal from '../src/tui/components/service-modal.js';
import type { ServiceEdit, ServiceGroup } from '../src/domain/services.js';
import { resolveServiceState } from '../src/domain/service-state.js';
import { terminal } from './support/terminal.js';
import { profileFixture } from './support/profile-fixture.js';
import { eventually } from './daemon-fixture.js';

const groups: ServiceGroup[] = [
    {
        name: 'fixture',
        services: ['api'],
        definitions: {
            api: {
                image: '123456789012.dkr.ecr.eu-west-2.amazonaws.com/api:${TAG:-latest}',
                module: 'fixture',
                base: false,
                deprecated: false,
                development: true,
                dependencies: [],
            },
        },
    },
];

test('the Environment versions shortcut selects a global source in one screen and keeps provider choices', async (t) => {
    const f = await profileFixture();
    const client = await f.client();
    await client.command('configuration.save', {
        edit: {
            name: 'api',
            enabled: true,
            development: false,
            provider: 'mock',
            mockScenario: 'error',
            exclusions: {},
        },
        revision: client.getSnapshot().configurationRevision,
    });
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
    await term.key('v');
    await eventually(() => term.frame().includes('CIDEV (default)'));
    assert.match(term.frame(), /Service versions · CIDEV/);
    await term.key('r');
    await eventually(() => term.frame().includes('versions refreshed'));
    assert.equal(f.engine.applies, 0);
    await term.key('\u001b[B');
    await term.key('\r');
    await eventually(() => term.frame().includes('Staging selected'));
    const selections = f.stores.get(f.directory)!.selections;
    assert.equal(selections.versionSource, 'staging');
    assert.equal(selections.serviceProviders!.api, 'mock');
    assert.equal(selections.mockScenarios!.api, 'error');
    assert.equal(f.engine.applies, 0);
});

test('a service can select Latest and remove an old explicit image pin', async (t) => {
    const edits: ServiceEdit[] = [];
    const details = resolveServiceState(
        {
            services: ['api'],
            serviceImages: {
                api: '123456789012.dkr.ecr.eu-west-2.amazonaws.com/api:1.0.0',
            },
        },
        groups,
    );
    const term = terminal(
        createElement(ServiceModal, {
            name: 'api',
            groups,
            details: details.api,
            allDetails: details,
            onClose: () => {},
            onApply: async (edit) => {
                edits.push(edit);
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\u001b[B');
    await term.key('\u001b[B');
    await term.key('\r');
    assert.match(term.frame(), /Service version source/);
    await term.key('\u001b[A');
    await term.key('\u001b[A');
    await term.key('\r');
    assert.match(term.frame(), /Versions: Latest/);
    await term.key('\u001b[B');
    await term.key('\u001b[B');
    await term.key('\r');
    assert.equal(edits[0].versionSource, 'latest');
    assert.equal(edits[0].image, null);
});

test('specific version entry validates input and saves a full image reference without changing the provider', async (t) => {
    const edits: ServiceEdit[] = [];
    const details = resolveServiceState(
        { services: ['api'], versionSource: 'staging' },
        groups,
    );
    const term = terminal(
        createElement(ServiceModal, {
            name: 'api',
            groups,
            details: details.api,
            allDetails: details,
            onClose: () => {},
            onApply: async (edit) => {
                edits.push(edit);
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.frame(), /Versions: Staging \(environment default\)/);
    await term.key('\u001b[B');
    await term.key('\u001b[B');
    await term.key('\r');
    await term.key('\u001b[A');
    await term.key('\r');
    assert.match(term.frame(), /Specific service version/);
    await term.key('bad value');
    await term.key('\r');
    assert.match(term.frame(), /Enter a version tag/);
    assert.deepEqual(edits, []);
    await term.key('\u0015');
    await term.key('3.4.5');
    await term.key('\r');
    assert.match(term.frame(), /Version: 3.4.5/);
    await term.key('\u001b[B');
    await term.key('\u001b[B');
    await term.key('\r');
    assert.equal(edits[0].provider, 'service');
    assert.equal(
        edits[0].image,
        '123456789012.dkr.ecr.eu-west-2.amazonaws.com/api:3.4.5',
    );
    assert.equal(edits[0].versionSource, null);
});
