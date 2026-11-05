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
    assert.match(term.frame(), /Show: Disabled · 1 service/);
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
    assert.match(term.frame(), /Show: Enabled · 1 service/);
    assert.match(term.frame(), /accounts-api/);
    assert.doesNotMatch(term.frame(), /accounts-worker|redis/);
    await term.key('e');
    assert.match(term.frame(), /Show: Enabled · 0 services/);
    assert.match(term.frame(), /\/accountse/);
    await term.key('\u007f');
    await term.key('\r');
    await term.key('e');
    assert.match(term.frame(), /Show: Disabled · 1 service/);
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
    assert.match(term.frame(), /Show: Disabled · 1 service/);
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
    assert.match(term.frame(), /Show: Enabled · 1 service/);
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

test('compact table keeps exact selection and full version context at supported sizes', async (t) => {
    for (const [columns, rows] of [
        [80, 24],
        [120, 34],
        [160, 45],
    ]) {
        const { props } = fixture();
        const name = 'confirmation-statement-submission-validation-worker';
        const term = terminal(
            createElement(ServicesScreen, {
                ...props,
                height: rows,
                groups: [{ name: 'filing', services: [name, name + '-retry'] }],
                details: {
                    [name]: {
                        enabled: 'Yes',
                        mode: 'Development',
                        effectiveStartMode: 'always',
                        versionLabel: 'v5.12.0-build-20261105-abcdef123456',
                        image: 'registry.example/filing:5.12.0-build-20261105-abcdef123456',
                    },
                },
            }),
            { columns, rows },
        );
        t.after(() => term.app.unmount());
        await delay(100);
        const frame = term.frame();
        assert.match(frame, /SAVED.*RUNTIME.*SAVED VER/);
        assert.match(
            frame,
            /Selected: confirmation-statement-submission-validation-worker/,
        );
        assert.match(frame, /v5\.12\.0-build-20261105-abcdef123456/);
        assert.match(frame, /Saved: Yes Development.*Start: always/);
        assert.ok(frame.split('\n').every((line) => line.length <= columns));
        assert.ok(frame.split('\n').length <= rows + 1);
    }
});

test('a 266-service table pages through the same selection used by actions and filtering', async (t) => {
    const { props, opened } = fixture();
    const services = Array.from(
        { length: 266 },
        (_, index) => `filing-service-${String(index + 1).padStart(3, '0')}`,
    );
    const term = terminal(
        createElement(ServicesScreen, {
            ...props,
            height: 20,
            groups: [{ name: 'filing', services }],
            details: Object.fromEntries(
                services.map((name) => [
                    name,
                    { enabled: 'Yes', mode: 'Service' },
                ]),
            ),
        }),
        { columns: 80, rows: 24 },
    );
    t.after(() => term.app.unmount());
    await delay(100);
    await term.key('\u001b[6~');
    assert.doesNotMatch(term.frame(), /Selected: filing-service-001/);
    await term.key('\r');
    assert.equal(opened.length, 1);
    assert.match(term.frame(), new RegExp(`Selected: ${opened[0]}`));
    term.resize(120, 34);
    await term.waitFor(new RegExp(`Selected: ${opened[0]}`));
    assert.ok(
        term
            .frame()
            .split('\n')
            .every((line) => line.length <= 120),
    );
    await term.key('/');
    await term.key('266');
    assert.match(term.frame(), /Selected: filing-service-266/);
    await term.key('\r');
    await term.key('\r');
    assert.deepEqual(opened.slice(-1), ['filing-service-266']);
    await term.key('/');
    await term.key('missing');
    assert.match(term.frame(), /No matching services/);
    assert.doesNotMatch(term.frame(), /Selected:/);
});

test('very long selection context keeps actions visible and full values readable in details', async (t) => {
    const { props, opened } = fixture();
    const name = 'filing-'.repeat(22) + 'worker';
    const image =
        'registry.example/' +
        'nested-repository/'.repeat(7) +
        '@sha256:' +
        'a'.repeat(64);
    const scenario = 'validation-'.repeat(14) + 'failure';
    const term = terminal(
        createElement(ServicesScreen, {
            ...props,
            height: 20,
            width: 74,
            live: {
                running: true,
                phase: 'Blocked',
                message: 'AWS login required',
                busy: false,
                stoppedByUser: [name],
                logs: [],
                logSequence: 0,
            },
            groups: [{ name: 'filing', services: [name] }],
            details: {
                [name]: {
                    enabled: 'Yes',
                    mode: 'Mock',
                    image,
                    mockScenario: scenario,
                },
            },
        }),
        { columns: 80, rows: 24 },
    );
    t.after(() => term.app.unmount());
    await term.waitFor(/Selected:/);
    assert.match(term.frame(), /i details/);
    assert.match(term.frame(), /Intent: manual stop/);
    assert.match(term.frame(), /Enter actions/);
    assert.match(term.frame(), /q quit/);
    await term.key('i');
    assert.match(term.frame(), /Esc back/);
    const frames = [term.frame()];
    await term.key('\u001b[6~');
    frames.push(term.frame());
    await term.key('\u001b[6~');
    frames.push(term.frame());
    const readable = frames.join('\n').replace(/\s/g, '');
    assert.ok(readable.includes(name));
    assert.ok(readable.includes(image));
    assert.ok(readable.includes(scenario));
    await term.key('\r');
    assert.deepEqual(opened, [name]);
});

test('saved lazy policy and manual stop remain distinct from a stopped observation', async (t) => {
    const { props } = fixture();
    const term = terminal(
        createElement(ServicesScreen, {
            ...props,
            height: 20,
            groups: [{ name: 'filing', services: ['api', 'worker'] }],
            details: {
                api: {
                    enabled: 'Yes',
                    mode: 'Service',
                    effectiveStartMode: 'lazy',
                },
                worker: {
                    enabled: 'Yes',
                    mode: 'Service',
                    effectiveStartMode: 'lazy',
                },
            },
            statuses: { api: 'Stopped', worker: 'Stopped' },
            live: {
                running: true,
                autoApply: false,
                phase: 'Running',
                message: '',
                busy: false,
                stoppedByUser: ['api'],
                logs: [],
                logSequence: 0,
            },
        }),
        { columns: 80, rows: 24 },
    );
    t.after(() => term.app.unmount());
    await term.waitFor(/Intent: manual stop/);
    assert.match(term.frame(), /Start: lazy/);
    await term.key('\u001b[B');
    assert.match(term.frame(), /Selected: worker/);
    assert.match(term.frame(), /Start: lazy/);
    assert.match(term.frame(), /Runtime: Stopped/);
    assert.doesNotMatch(term.frame(), /Intent: manual stop|Healthy|Idle/);
});
