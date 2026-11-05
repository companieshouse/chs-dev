import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import ServiceModal from '../src/tui/components/service-modal.js';
import type { ServiceEdit, ServiceGroup } from '../src/domain/services.js';
import { terminal } from './support/terminal.js';

function groups(development = true): ServiceGroup[] {
    return [
        {
            name: 'fixture',
            services: ['api'],
            definitions: {
                api: {
                    module: 'fixture',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                    development,
                    mock: {
                        defaultScenario: 'success',
                        scenarios: [
                            { name: 'success', description: 'Normal response' },
                            {
                                name: 'error',
                                description: 'Unavailable response',
                            },
                        ],
                    },
                },
            },
        },
    ];
}

test('service modal cycles all three providers and saves the selected mock scenario', async (t) => {
    const edits: ServiceEdit[] = [];
    const term = terminal(
        createElement(ServiceModal, {
            name: 'api',
            groups: groups(),
            details: { enabled: 'Yes', mode: 'Service' },
            allDetails: {},
            onClose: () => {},
            onApply: async (edit) => {
                edits.push(edit);
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\u001b[B');
    await term.key(' ');
    assert.match(term.frame(), /Provider: development/);
    await term.key(' ');
    assert.match(term.frame(), /Provider: mock/);
    assert.match(term.frame(), /Mock scenario: success/);
    assert.match(term.frame(), /Dependencies are not started/);
    await term.key('\u001b[B');
    await term.key(' ');
    assert.match(term.frame(), /Mock scenario: error/);
    await term.key('\u001b[B');
    await term.key('\u001b[B');
    await term.key('\r');
    assert.deepEqual(edits, [
        {
            name: 'api',
            enabled: true,
            development: false,
            provider: 'mock',
            mockScenario: 'error',
            exclusions: {},
        },
    ]);
});

test('mock selection is available without a development builder and cancelling leaves it unsaved', async (t) => {
    const edits: ServiceEdit[] = [];
    let closed = 0;
    const term = terminal(
        createElement(ServiceModal, {
            name: 'api',
            groups: groups(false),
            details: { enabled: 'Yes', mode: 'Service' },
            allDetails: {},
            onClose: () => {
                closed++;
            },
            onApply: async (edit) => {
                edits.push(edit);
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\u001b[B');
    await term.key(' ');
    assert.match(term.frame(), /Provider: mock/);
    assert.doesNotMatch(term.frame(), /Provider: development/);
    await term.key('\u001b');
    assert.equal(closed, 1);
    assert.deepEqual(edits, []);
});
