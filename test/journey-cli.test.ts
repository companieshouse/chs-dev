import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClientError } from '../src/protocol/types.js';
import { journeyCommand } from '../src/cli/journeys.js';
import type { StackMeasurement } from '../src/domain/measurements.js';

const measurement = (overrides: Partial<StackMeasurement['journey']>) =>
    ({
        baseline: {
            services: ['api', 'db', 'worker'],
            baseServices: ['db'],
            serviceCount: 3,
            baseServiceCount: 1,
            modeCounts: { Service: 3 },
            dependencyEdgeCount: 2,
            memoryLimitBytes: 0,
            memoryReservationBytes: 0,
            servicesWithMemoryLimit: 0,
            servicesWithoutMemoryLimit: ['api', 'db', 'worker'],
            unparsedMemory: [],
            lazyServices: [],
        },
        journey: {
            name: 'accounts',
            started: ['api'],
            lazy: [],
            notInJourney: ['worker'],
            added: [],
            target: {
                services: ['api', 'db'],
                baseServices: ['db'],
                serviceCount: 2,
                baseServiceCount: 1,
                modeCounts: { Service: 2 },
                dependencyEdgeCount: 1,
                memoryLimitBytes: 0,
                memoryReservationBytes: 0,
                servicesWithMemoryLimit: 0,
                servicesWithoutMemoryLimit: ['api', 'db'],
                unparsedMemory: [],
                lazyServices: [],
            },
            delta: {
                services: 1,
                dependencyEdges: 1,
                memoryLimitBytes: 0,
                memoryReservationBytes: 0,
            },
            ...overrides,
        },
    }) as StackMeasurement;

function fakeClient(handlers: {
    query(name: string, args: unknown): unknown;
    submit(command: string, args: unknown): unknown;
}) {
    const calls: Array<{ kind: string; name: string; args: unknown }> = [];
    return {
        calls,
        getSnapshot: () => ({ project: { valid: true } }),
        query: async (name: string, args: unknown) => {
            calls.push({ kind: 'query', name, args });
            return handlers.query(name, args);
        },
        submit: async (command: string, args: unknown) => {
            calls.push({ kind: 'submit', name: command, args });
            handlers.submit(command, args);
            return { id: `op-${calls.length}` };
        },
        wait: async () => null,
        operation: async (id: string) => ({ id }),
    };
}

function context(
    client: {
        getSnapshot(): unknown;
        query(name: string, args: unknown): Promise<unknown>;
        submit(command: string, args: unknown): Promise<unknown>;
    },
    invocation: {
        name: string;
        args: string[];
        options: Record<string, unknown>;
    },
) {
    return {
        invocation,
        client,
        scope: { project: 'p', generation: '1' },
        signal: new AbortController().signal,
        out: () => {},
        err: () => {},
    } as Parameters<typeof journeyCommand>[0];
}

const snapshot = {
    revision: 'rev-1',
    selections: {
        modules: [],
        services: ['api', 'worker'],
        servicesWithLiveUpdate: [],
        excludedServices: [],
        journey: undefined,
    },
};

test('journey list renders names, sizes, and invalid files', async () => {
    let queried: string | undefined;
    const client = fakeClient({
        query: (name) => {
            queried = name;
            return {
                journeys: [
                    {
                        name: 'accounts',
                        services: new Array(9).fill('svc'),
                        lazy: ['felix'],
                    },
                    { name: 'tiny', services: ['api'], lazy: [] },
                ],
                invalid: [{ file: 'journeys/bad.yaml', error: 'Unknown key' }],
                active: 'accounts',
            };
        },
        submit: () => {
            throw new Error('not used');
        },
    });
    const result = await journeyCommand(
        context(client, { name: 'journey list', args: [], options: {} }),
    );
    assert.equal(queried, 'journey.list');
    assert.match(result.text!, /accounts \(active\) - 9 always start, 1 lazy/);
    assert.match(result.text!, /tiny - 1 always start, 0 lazy/);
    assert.match(result.text!, /Invalid journeys\/bad\.yaml: Unknown key/);
});

test('journey start with a smaller set saves the journey members and applies', async () => {
    const client = fakeClient({
        query: (name) =>
            name === 'environment.measure' ? measurement({}) : snapshot,
        submit: (command, args) => {
            if (command === 'environment.apply') return { done: true };
            return { saved: true, args };
        },
    });
    const result = await journeyCommand(
        context(client, {
            name: 'journey start',
            args: ['accounts'],
            options: {},
        }),
    );
    const imports = client.calls.filter(
        (call) => call.name === 'environment.profileImport',
    );
    assert.equal(imports.length, 1);
    const selections = (
        imports[0]!.args as { profile: { selections: Record<string, unknown> } }
    ).profile.selections;
    assert.equal(selections.journey, 'accounts');
    assert.deepEqual(selections.services, ['api']);
    const applies = client.calls.filter(
        (call) => call.name === 'environment.apply',
    );
    assert.equal(applies.length, 1);
    assert.deepEqual(applies[0]!.args, { approveStops: false });
    assert.match(result.text!, /0 to start, 1 to stop/);
});

test('journey start with --yes approves stops', async () => {
    const client = fakeClient({
        query: (name) =>
            name === 'environment.measure' ? measurement({}) : snapshot,
        submit: () => ({ done: true }),
    });
    await journeyCommand(
        context(client, {
            name: 'journey start',
            args: ['accounts'],
            options: { yes: true },
        }),
    );
    const apply = client.calls.find(
        (call) => call.name === 'environment.apply',
    );
    assert.deepEqual(apply!.args, { approveStops: true });
});

test('an equivalent membership saves the marker and never applies', async () => {
    const client = fakeClient({
        query: (name) =>
            name === 'environment.measure'
                ? measurement({ notInJourney: [], added: [] })
                : snapshot,
        submit: (command) => {
            if (command === 'environment.apply')
                throw new Error('must not apply');
            return { saved: true };
        },
    });
    const result = await journeyCommand(
        context(client, {
            name: 'journey start',
            args: ['accounts'],
            options: {},
        }),
    );
    const applies = client.calls.filter(
        (call) => call.name === 'environment.apply',
    );
    assert.equal(applies.length, 0);
    const imports = client.calls.filter(
        (call) => call.name === 'environment.profileImport',
    );
    assert.equal(imports.length, 1);
    const selections = (
        imports[0]!.args as { profile: { selections: Record<string, unknown> } }
    ).profile.selections;
    assert.equal(selections.journey, 'accounts');
    assert.deepEqual(selections.services, ['api', 'worker']);
    assert.match(result.text!, /nothing starts or stops/);
});

test('an already-selected equivalent journey changes nothing', async () => {
    const client = fakeClient({
        query: (name) =>
            name === 'environment.measure'
                ? measurement({ notInJourney: [], added: [] })
                : {
                      ...snapshot,
                      selections: {
                          ...snapshot.selections,
                          journey: 'accounts',
                      },
                  },
        submit: () => {
            throw new Error('must not submit');
        },
    });
    const result = await journeyCommand(
        context(client, {
            name: 'journey start',
            args: ['accounts'],
            options: {},
        }),
    );
    assert.deepEqual(
        client.calls.filter((call) => call.kind === 'submit'),
        [],
    );
    assert.match(result.text!, /already selected/);
});

test('a shrinking switch without approval raises the confirmation', async () => {
    const client = fakeClient({
        query: (name) =>
            name === 'environment.measure' ? measurement({}) : snapshot,
        submit: (command) => {
            if (command === 'environment.apply')
                throw new ClientError({
                    code: 'CONFIRMATION_REQUIRED',
                    message: 'Review the plan.',
                    data: { plan: {}, revision: 'next' },
                });
            return { saved: true };
        },
    });
    await assert.rejects(
        () =>
            journeyCommand(
                context(client, {
                    name: 'journey start',
                    args: ['accounts'],
                    options: {},
                }),
            ),
        /Review the plan/,
    );
    const imports = client.calls.filter(
        (call) => call.name === 'environment.profileImport',
    );
    assert.equal(imports.length, 1);
    const applies = client.calls.filter(
        (call) => call.name === 'environment.apply',
    );
    assert.equal(applies.length, 1);
});
