import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientProvider } from '../src/tui/context.js';
import JourneysScreen from '../src/tui/components/journeys-screen.js';
import {
    applyMemberState,
    deriveJourneySets,
    journeyEditorState,
    journeyEditorView,
    journeyListRows,
} from '../src/tui/models/journeys-tab.js';
import { journeyDraft } from '../src/tui/models/journey-creator.js';
import type { Client } from '../src/client/client.js';
import type { ServiceDetails, ServiceGroup } from '../src/domain/services.js';
import type { SessionUsage } from '../src/protocol/types.js';
import { terminal } from './support/terminal.js';

const listResult = {
    journeys: [
        {
            name: 'accounts',
            services: ['api'],
            lazy: ['felixvalidator'],
            excluded: [],
        },
        { name: 'pilot', services: ['web'], lazy: [], excluded: [] },
    ],
    invalid: [{ file: 'journeys/broken.yaml', error: 'Unknown key: extras' }],
    active: 'pilot',
};

function details(): Record<string, ServiceDetails> {
    return {
        api: { enabled: 'Yes', mode: 'Service' },
        web: { enabled: 'Yes', mode: 'Service' },
        felixvalidator: { enabled: 'No', mode: 'Service' },
    };
}

function groups(): ServiceGroup[] {
    return [
        {
            name: 'fixture',
            services: ['api', 'web', 'felixvalidator'],
            definitions: {
                api: {
                    module: 'fixture',
                    dependencies: ['felixvalidator'],
                    base: false,
                    deprecated: false,
                },
                web: {
                    module: 'fixture',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                },
                felixvalidator: {
                    module: 'fixture',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                    startMode: 'lazy',
                },
                database: {
                    module: 'fixture',
                    dependencies: [],
                    base: true,
                    deprecated: false,
                },
            },
        },
    ];
}

function screen(
    client: Client,
    usage: SessionUsage = emptyUsage(),
    active = true,
    screenGroups = groups(),
) {
    return terminal(
        createElement(
            ClientProvider,
            { value: client },
            createElement(JourneysScreen, {
                active,
                height: 24,
                groups: screenGroups,
                usage,
            }),
        ),
        { rows: 40 },
    );
}

function singleServiceGroups(name: string): ServiceGroup[] {
    return [
        {
            name: 'fixture',
            services: [name],
            definitions: {
                [name]: {
                    module: 'fixture',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                },
            },
        },
    ];
}

function emptyUsage(): SessionUsage {
    return { learned: [], unusedLastRun: [] };
}

function fakeClient(handlers: {
    query(name: string, args: unknown): unknown;
    command(name: string, args: unknown): unknown;
}) {
    const queries: Array<{ name: string; args: unknown }> = [];
    const commands: Array<{ name: string; args: unknown }> = [];
    return {
        queries,
        commands,
        query: async (name: string, args: unknown) => {
            queries.push({ name, args });
            return handlers.query(name, args);
        },
        command: async (name: string, args: unknown) => {
            commands.push({ name, args });
            return handlers.command(name, args);
        },
    } as unknown as Client & {
        queries: Array<{ name: string; args: unknown }>;
        commands: Array<{ name: string; args: unknown }>;
    };
}

const measurement = {
    baseline: { services: [], serviceCount: 0 },
    journey: {
        name: 'accounts',
        started: ['api'],
        lazy: ['felixvalidator'],
        notInJourney: ['worker'],
        added: [],
        target: {
            services: ['api'],
            baseServices: [],
            serviceCount: 1,
            baseServiceCount: 0,
            modeCounts: {},
            dependencyEdgeCount: 0,
            memoryLimitBytes: 0,
            memoryReservationBytes: 0,
            servicesWithMemoryLimit: 0,
            servicesWithoutMemoryLimit: [],
            unparsedMemory: [],
            lazyServices: ['felixvalidator'],
        },
        delta: {
            services: 0,
            dependencyEdges: 0,
            memoryLimitBytes: 0,
            memoryReservationBytes: 0,
        },
    },
};

test('the list model sorts valid journeys, marks the active one, and appends invalid files', () => {
    const rows = journeyListRows(listResult);
    assert.deepEqual(
        rows.map((row) => [row.name, row.active, row.invalid ?? null]),
        [
            ['accounts', false, null],
            ['pilot', true, null],
            ['broken', false, 'Unknown key: extras'],
        ],
    );
    assert.deepEqual(rows[0]!.services, ['api']);
    assert.deepEqual(rows[0]!.lazy, ['felixvalidator']);
});

test('the editor derives closure membership and label defaults', () => {
    const state = journeyEditorState({
        name: 'accounts',
        members: ['api', 'web', 'felixvalidator'],
        initial: { services: ['api'], lazy: ['felixvalidator'] },
        dependencies: { api: ['felixvalidator'], web: [] },
        lazyDefault: new Set(['felixvalidator']),
    });
    assert.equal(state.name, 'accounts');
    assert.deepEqual(state.members, ['api', 'felixvalidator', 'web']);
    assert.equal(state.states.api, 'start');
    assert.equal(state.states.felixvalidator, 'lazy');
    assert.equal(state.states.web, 'out');
    assert.equal(state.selected, 1);
    // A lazy root that the closure pulls in stays in the dependency group.
    const view = journeyEditorView(state);
    assert.deepEqual([...view.grouping.enabled].sort(), ['api']);
    assert.ok(view.grouping.closure.has('felixvalidator'));
});

test('a closure member is derived, not explicit', () => {
    const state = journeyEditorState({
        name: 'accounts',
        members: ['api', 'web', 'felixvalidator'],
        initial: { services: ['api'] },
        dependencies: { api: ['felixvalidator'], web: [] },
        lazyDefault: new Set(['felixvalidator']),
    });
    assert.deepEqual(state.services, ['api']);
    assert.deepEqual(state.lazy, []);
    assert.equal(state.states.felixvalidator, 'lazy');
    const draft = journeyDraft(state);
    assert.deepEqual(draft.services, ['api']);
    assert.deepEqual(draft.lazy, []);
    assert.deepEqual(draft.excluded, []);
});

test('a directly chosen lazy root stays in the Enabled group', () => {
    const state = journeyEditorState({
        name: 'standalone',
        members: ['api', 'web'],
        initial: { lazy: ['web'] },
        dependencies: { api: [], web: [] },
    });
    const view = journeyEditorView(state);
    assert.deepEqual([...view.grouping.enabled].sort(), ['web']);
    assert.equal(view.grouping.closure.size, 0);
    assert.deepEqual(state.members, ['web', 'api']);
});

test('excluding a dependency keeps it visible but not included', () => {
    const state = journeyEditorState({
        name: 'accounts',
        members: ['api', 'web', 'felixvalidator'],
        initial: { services: ['api'], excluded: ['felixvalidator'] },
        dependencies: { api: ['felixvalidator'], web: [] },
    });
    assert.equal(state.states.felixvalidator, 'out');
    const flipped = applyMemberState(state, 'felixvalidator', 'start');
    assert.deepEqual(flipped.services, ['api', 'felixvalidator']);
    assert.deepEqual(flipped.excluded, []);
    assert.equal(flipped.states.felixvalidator, 'start');
});

test('the tab lists journeys with sizes, active marker, and invalid files', async (t) => {
    const client = fakeClient({ query: () => listResult, command: () => ({}) });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.frame(), /3 journeys · active: pilot/);
    assert.match(term.frame(), /accounts - 1 always start, 1 lazy/);
    assert.match(term.frame(), /pilot - 1 always start, 0 lazy \(active\)/);
    assert.match(term.frame(), /broken - invalid: Unknown key: extras/);
});

test('an inactive journeys tab does not open a mode modal from input', async (t) => {
    const client = fakeClient({
        query: () => listResult,
        command: () => ({}),
    });
    const screenGroups = singleServiceGroups('accounts-filing-api');
    const term = screen(client, emptyUsage(), true, screenGroups);
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.frame(), /accounts/);
    await term.key('\r');
    assert.match(term.frame(), /Editing journeys\/accounts\.yaml/);
    assert.match(term.frame(), /accounts-filing-api/);

    term.rerender(
        createElement(
            ClientProvider,
            { value: client },
            createElement(JourneysScreen, {
                active: false,
                height: 24,
                groups: screenGroups,
                usage: emptyUsage(),
            }),
        ),
    );
    await term.key('\r');
    assert.doesNotMatch(term.frame(), /Mode for /);
    term.rerender(
        createElement(
            ClientProvider,
            { value: client },
            createElement(JourneysScreen, {
                active: true,
                height: 24,
                groups: screenGroups,
                usage: emptyUsage(),
            }),
        ),
    );
    assert.doesNotMatch(term.frame(), /Mode for accounts-filing-api/);
});

test('learned members count as lazy in list rows and derive as lazy in the editor', () => {
    const rows = journeyListRows(listResult, {
        dependencies: { api: ['web'] },
        lazyDefault: new Set(),
        learned: new Set(['web']),
    });
    assert.deepEqual(rows.find((row) => row.name === 'accounts')!.derived, {
        start: 1,
        lazy: 2,
    });

    const sets = deriveJourneySets({
        services: ['api'],
        lazy: [],
        excluded: [],
        dependencies: { api: ['worker'], web: [] },
        learned: new Set(['worker']),
    });
    assert.deepEqual(sets, { started: ['api'], lazy: ['worker'] });
});

test('journey derivation inherits lazy through an exclusive lazy subtree', () => {
    const sets = deriveJourneySets({
        services: ['a'],
        lazy: [],
        excluded: [],
        dependencies: { a: ['b'], b: ['c'], c: [] },
        lazyDefault: new Set(['b']),
    });
    assert.deepEqual(sets, { started: ['a'], lazy: ['b', 'c'] });
    const shared = deriveJourneySets({
        services: ['a'],
        lazy: [],
        excluded: [],
        dependencies: { a: ['b', 'c'], b: ['c'], c: [] },
        lazyDefault: new Set(['b']),
    });
    assert.deepEqual(shared, { started: ['a', 'c'], lazy: ['b'] });
});

test('the editor annotates learned members and unused pinned selections', () => {
    const state = journeyEditorState({
        name: 'accounts',
        members: ['api', 'worker', 'web'],
        initial: { services: ['api', 'web'] },
        dependencies: { api: ['worker'], web: [] },
        learned: new Set(['worker']),
        unusedLastRun: new Set(['web']),
    });
    assert.equal(state.states.worker, 'lazy');
    const view = journeyEditorView(state);
    assert.deepEqual([...view.learnedLazy], ['worker']);
    assert.deepEqual([...view.unusedPinned], ['web']);
    // The learned state is display-only: the explicit lists are untouched.
    assert.deepEqual(state.services, ['api', 'web']);
    assert.deepEqual(state.lazy, []);
});

test('Enter opens the editor pre-filled; the mode modal and Esc save write the draft', async (t) => {
    const client = fakeClient({
        query: () => listResult,
        command: (name, args) => {
            if (name === 'project.saveJourney') return { path: 'x' };
            void args;
            return {};
        },
    });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\r');
    assert.match(term.frame(), /Editing journeys\/accounts\.yaml/);
    assert.match(term.frame(), /Enabled \(1\)/);
    assert.match(term.frame(), /Dependencies of enabled \(1\)/);
    assert.match(term.frame(), /api  always start/);
    assert.match(term.frame(), /felixvalidator  lazy/);
    await term.key('\r');
    assert.match(term.frame(), /Mode for api/);
    await term.key('\u001b[B');
    await term.key('\r');
    assert.match(term.frame(), /api  lazy/);
    await term.key('\u001b[B');
    await term.key('\r');
    assert.match(term.frame(), /Mode for felixvalidator/);
    await term.key('\u001b[A');
    await term.key('\r');
    assert.match(term.frame(), /felixvalidator  always start/);
    await term.key('\u001b');
    assert.match(term.frame(), /Save changes to journeys\/accounts\.yaml\?/);
    await term.key('\r');
    await delay(100);
    const saved = client.commands.find(
        (call) => call.name === 'project.saveJourney',
    );
    assert.deepEqual(saved!.args, {
        name: 'accounts',
        services: ['felixvalidator'],
        lazy: ['api'],
        excluded: [],
    });
    assert.match(term.frame(), /Saved journey accounts\./);
});

test('an untouched editor exits on Esc without prompting', async (t) => {
    const client = fakeClient({ query: () => listResult, command: () => ({}) });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\r');
    await term.key('\u001b');
    await delay(100);
    assert.match(term.frame(), /3 journeys · active: pilot/);
    assert.doesNotMatch(term.frame(), /Save changes/);
});

test('delete asks for confirmation and calls the daemon command', async (t) => {
    const client = fakeClient({
        query: () => listResult,
        command: (name, args) => {
            if (name === 'project.deleteJourney')
                return { deleted: true, selectionCleared: false };
            void args;
            return {};
        },
    });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('d');
    assert.match(term.frame(), /Delete journey accounts\?/);
    await term.key('y');
    await delay(100);
    const deleted = client.commands.find(
        (call) => call.name === 'project.deleteJourney',
    );
    assert.deepEqual(deleted!.args, { name: 'accounts' });
    assert.match(term.frame(), /Deleted journey accounts\./);
});

test('switching previews the measured delta, then applies through the daemon', async (t) => {
    const client = fakeClient({
        query: (name) => {
            if (name === 'environment.measure') return measurement as never;
            if (name === 'configuration.snapshot')
                return {
                    revision: 'rev-1',
                    selections: { services: ['api', 'worker'] },
                };
            return listResult;
        },
        command: (name) => {
            if (name === 'environment.apply')
                throw Object.assign(new Error('Confirmation required.'), {
                    detail: { code: 'CONFIRMATION_REQUIRED' },
                });
            return {};
        },
    });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('s');
    await delay(100);
    assert.match(term.frame(), /Switch to journey accounts/);
    assert.match(term.frame(), /Members lazy \(1\): felixvalidator/);
    assert.match(term.frame(), /Stopped \(1\): worker/);
    await term.key('\r');
    await delay(100);
    const imported = client.commands.find(
        (call) => call.name === 'environment.profileImport',
    );
    assert.ok(imported);
    const applied = client.commands.find(
        (call) => call.name === 'environment.apply',
    );
    assert.ok(applied);
    assert.match(
        term.frame(),
        /Approve the stop plan in the Environment panel/,
    );
});

test('the Journeys tab is actually mounted in the workspace', async () => {
    // Regression guard: the screen once existed but was never mounted, so the
    // tab rendered an empty region. Pin the mount, not just the component.
    const source = await import('node:fs').then((fs) =>
        fs.readFileSync(
            new URL(
                '../src/tui/components/workspace-screens.tsx',
                import.meta.url,
            ),
            'utf8',
        ),
    );
    assert.match(source, /<JourneysScreen/);
    assert.match(source, /activeTab === 'Journeys'/);
});

test('c opens the clear-cache confirmation and confirming calls the daemon', async (t) => {
    const client = fakeClient({
        query: () => listResult,
        command: (name) =>
            name === 'usage.cacheClear' ? { cleared: true } : {},
    });
    const term = screen(client);
    t.after(() => term.app.unmount());
    await delay(150);
    term.key('c');
    await delay(80);
    assert.match(term.frame(), /Clear the usage cache\?/);
    term.key('y');
    await delay(120);
    assert.match(term.frame(), /Cleared learned usage modes\./);
    assert.deepEqual(client.commands, [{ name: 'usage.cacheClear', args: {} }]);
});
