import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement, type ComponentProps } from 'react';
import ServicesScreen from '../src/tui/components/services-screen.js';
import { terminal } from './support/terminal.js';

function fixture() {
    const opened: string[] = [];
    const containers: string[] = [];
    const props: ComponentProps<typeof ServicesScreen> = {
        active: true,
        height: 25,
        groups: [
            {
                name: 'accounts',
                services: [
                    'accounts-api',
                    'accounts-worker',
                    'accounts-unknown',
                ],
            },
            { name: 'Infrastructure', services: ['redis', 'not-read-yet'] },
        ],
        details: {
            'accounts-api': { enabled: 'Yes', mode: 'Service' },
            'accounts-worker': { enabled: 'No', mode: 'Service' },
            'accounts-unknown': { enabled: 'Unknown', mode: 'Unknown' },
            redis: { enabled: 'Yes', mode: 'Service' },
        },
        statuses: { 'accounts-api': 'Stopped', 'accounts-worker': 'Running' },
        defaultStatus: 'Stopped',
        loading: false,
        error: '',
        stateError: '',
        runtimeName: 'Docker',
        runtimeState: 'ready',
        onOpen: (name) => opened.push(name),
        onContainer: (name) => containers.push(name),
    };
    return { props, opened, containers };
}

test('Services cycles configured enabled states and targets actions at the visible selection', async (t) => {
    const { props, opened, containers } = fixture();
    const term = terminal(createElement(ServicesScreen, props));
    t.after(() => term.app.unmount());
    await delay(100);
    assert.match(term.frame(), /Show: All · 5 services/);
    assert.match(term.frame(), /accounts-unknown/);
    assert.match(term.frame(), /not-read-yet/);
    await term.key('\u001b[B');
    await term.key('e');
    assert.match(term.frame(), /Show: Enabled · 2 services/);
    assert.match(term.frame(), /› accounts-api.*Yes.*Stopped/);
    assert.match(term.frame(), /redis/);
    assert.doesNotMatch(
        term.frame(),
        /accounts-worker|accounts-unknown|not-read-yet/,
    );
    await term.key('\u001b[B');
    await term.key('c');
    assert.deepEqual(containers, ['redis']);
    await term.key('e');
    assert.match(term.frame(), /Show: Disabled · 1 services/);
    assert.match(term.frame(), /› accounts-worker.*No.*Running/);
    assert.doesNotMatch(
        term.frame(),
        /accounts-api|redis|accounts-unknown|not-read-yet/,
    );
    await term.key('\r');
    assert.deepEqual(opened, ['accounts-worker']);
    await term.key('e');
    assert.match(term.frame(), /Show: All · 5 services/);
    assert.match(term.frame(), /› accounts-api/);
    await term.key('\r');
    assert.deepEqual(opened, ['accounts-worker', 'accounts-api']);
});

test('enabled filtering combines with search and treats e as text while editing', async (t) => {
    const { props } = fixture();
    const term = terminal(createElement(ServicesScreen, props));
    t.after(() => term.app.unmount());
    await delay(100);
    await term.key('e');
    await term.key('/');
    await term.key('accounts');
    assert.match(term.frame(), /Show: Enabled · 1 services/);
    assert.match(term.frame(), /accounts-api/);
    assert.doesNotMatch(term.frame(), /accounts-worker|redis/);
    await term.key('e');
    assert.match(term.frame(), /Show: Enabled · 0 services/);
    assert.match(term.frame(), /\/accountse/);
    await term.key('\u007f');
    await term.key('\r');
    await term.key('e');
    assert.match(term.frame(), /Show: Disabled · 1 services/);
    assert.match(term.frame(), /Filter: accounts/);
    assert.match(term.frame(), /accounts-worker/);
    assert.doesNotMatch(term.frame(), /accounts-api|redis/);
    await term.key('\u001b');
    assert.match(term.frame(), /Show: All · 5 services/);
    assert.doesNotMatch(term.frame(), /Filter: accounts/);
});

test('filters survive inactive screens and control shortcuts do not cycle enabled state', async (t) => {
    const { props, opened, containers } = fixture();
    const term = terminal(createElement(ServicesScreen, props));
    t.after(() => term.app.unmount());
    await delay(100);
    await term.key('e');
    await term.key('\u0005');
    assert.match(term.frame(), /Show: Enabled · 2 services/);
    await term.key('__proto__');
    assert.match(term.frame(), /Show: Enabled · 2 services/);
    term.rerender(createElement(ServicesScreen, { ...props, active: false }));
    await delay(100);
    await term.key('e');
    await term.key('\r');
    await term.key('c');
    assert.match(term.frame(), /Show: Enabled · 2 services/);
    assert.deepEqual(opened, []);
    assert.deepEqual(containers, []);
    term.rerender(createElement(ServicesScreen, props));
    await delay(100);
    await term.key('e');
    assert.match(term.frame(), /Show: Disabled · 1 services/);
});

test('configuration updates clamp selection and empty filters cannot trigger actions', async (t) => {
    const { props, opened, containers } = fixture();
    const term = terminal(createElement(ServicesScreen, props));
    t.after(() => term.app.unmount());
    await delay(100);
    await term.key('e');
    await term.key('\u001b[B');
    assert.match(term.frame(), /› redis/);
    const details = {
        ...props.details,
        redis: { enabled: 'No' as const, mode: 'Service' as const },
    };
    term.rerender(createElement(ServicesScreen, { ...props, details }));
    await delay(100);
    assert.match(term.frame(), /Show: Enabled · 1 services/);
    assert.match(term.frame(), /› accounts-api/);
    await term.key('\r');
    assert.deepEqual(opened, ['accounts-api']);
    term.rerender(
        createElement(ServicesScreen, {
            ...props,
            details: {
                ...details,
                'accounts-api': { enabled: 'Unknown', mode: 'Unknown' },
            },
        }),
    );
    await delay(100);
    assert.match(term.frame(), /Show: Enabled · 0 services/);
    assert.match(term.frame(), /No matching services/);
    await term.key('\r');
    await term.key('c');
    assert.deepEqual(opened, ['accounts-api']);
    assert.deepEqual(containers, []);
});
