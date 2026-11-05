import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { terminal } from './support/terminal.js';
import EnvironmentPanel from '../src/tui/components/environment-panel.js';
import ServiceModal from '../src/tui/components/service-modal.js';
import type { EnvironmentClient } from '../src/client/environment.js';
import type { LiveState } from '../src/domain/live.js';
import type { ServiceEdit, ServiceGroup } from '../src/domain/services.js';

const stopped: LiveState = {
    running: false,
    autoApply: false,
    phase: 'Stopped',
    message: '',
    stoppedByUser: [],
    logs: [],
    logSequence: 0,
    busy: false,
};
function panelFixture() {
    const calls: string[] = [];
    const controller = {
        start: async () => {
            calls.push('start');
        },
        cancel: async () => {
            calls.push('cancel');
        },
    } as unknown as EnvironmentClient;
    const props = {
        controller,
        state: stopped,
        onClose: () => {
            calls.push('close');
        },
        onSetupSsh: () => {},
        onLogin: () => {},
        onViewLogs: () => {},
        onAutoApply: () => {},
    };
    return { props, calls };
}

test('Environment starts with a selection, clears it after Start, and waits for navigation', async (t) => {
    const { props, calls } = panelFixture();
    const term = terminal(createElement(EnvironmentPanel, props));
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.output(), /›.*Start environment/);
    term.clear();
    await term.key('\r');
    assert.deepEqual(calls, ['start']);
    assert.doesNotMatch(term.output(), /›/);
    await term.key('\r');
    assert.deepEqual(calls, ['start']);
    term.clear();
    await term.key('\u001b[B');
    assert.match(term.output(), /›.*Start environment/);
    await term.key('\r');
    assert.deepEqual(calls, ['start', 'start']);
    term.clear();
    await term.key('\u001b[A');
    assert.match(term.output(), /›.*Close/);
});

test('Environment clears a disappeared action and Enter cannot activate its replacement', async (t) => {
    const { props, calls } = panelFixture();
    const term = terminal(createElement(EnvironmentPanel, props));
    t.after(() => term.app.unmount());
    await delay(150);
    term.clear();
    term.rerender(
        createElement(EnvironmentPanel, {
            ...props,
            state: { ...stopped, busy: true, phase: 'Preparing' },
        }),
    );
    await delay(150);
    assert.doesNotMatch(term.output(), /›.*(?:Cancel|View logs|Close)/);
    await term.key('\r');
    assert.deepEqual(calls, []);
    await term.key('\u001b[B');
    await term.key('\r');
    assert.deepEqual(calls, ['cancel']);
});

const groups: ServiceGroup[] = [
    {
        name: 'app',
        services: ['api'],
        definitions: {
            api: {
                dependencies: [],
                module: 'app',
                base: false,
                deprecated: false,
                development: true,
            },
        },
    },
];
function serviceProps(
    onApply: (edit: ServiceEdit) => Promise<void>,
    onClose: () => void,
) {
    const details = { enabled: 'Yes' as const, mode: 'Service' as const };
    return {
        name: 'api',
        details,
        allDetails: { api: details },
        groups,
        onApply,
        onClose,
    };
}
async function selectSave(term: ReturnType<typeof terminal>) {
    await term.key('\r');
    for (let index = 0; index < 3; index++) await term.key('\u001b[B');
    await term.key('\r');
}

test('service save owns closing, blocks duplicate submissions and releases busy on success', async (t) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const edits: ServiceEdit[] = [];
    let closed = 0;
    const term = terminal(
        createElement(
            ServiceModal,
            serviceProps(
                async (edit) => {
                    edits.push(edit);
                    await pending;
                },
                () => {
                    closed++;
                },
            ),
        ),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await selectSave(term);
    await term.key('\r');
    assert.equal(edits.length, 1);
    assert.equal(edits[0].enabled, false);
    release();
    await delay(150);
    assert.equal(closed, 1);
    term.clear();
    await term.key('\u001b[A');
    assert.match(term.output(), /›.*Dependencies/);
});

test('service save failure keeps edits and permits retry', async (t) => {
    const edits: ServiceEdit[] = [];
    let closed = 0;
    const term = terminal(
        createElement(
            ServiceModal,
            serviceProps(
                async (edit) => {
                    edits.push(edit);
                    if (edits.length === 1) throw new Error('Save failed');
                },
                () => {
                    closed++;
                },
            ),
        ),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await selectSave(term);
    assert.equal(closed, 0);
    assert.match(term.output(), /Save failed/);
    await term.key('\r');
    assert.equal(closed, 1);
    assert.equal(edits.length, 2);
    assert.deepEqual(edits[0], edits[1]);
});
