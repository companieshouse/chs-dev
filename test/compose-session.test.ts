import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectSession } from '../src/application/project-session.js';
import type { ApplicationHost } from '../src/application/ports.js';
import type { Interactions } from '../src/application/interactions.js';
import { resolveSettings } from '../src/domain/settings.js';
import { commandRequest } from '../src/protocol/schemas.js';
import { ClientError, protocolVersion } from '../src/protocol/types.js';

test('saved intent is never passed into a backend before engine identity is verified', async () => {
    const resolved = resolveSettings({ project: '/checkout' }, {});
    for (const backend of ['docker/compose', 'docker/native', 'apple/native']) {
        let received: unknown = 'not opened';
        const stopped = new Error('Stop before attaching the backend');
        const host = {
            id: () => 'id',
            home: '/home',
            hostSession: 'login',
            settings: () => ({
                path: '/settings',
                resolved,
                startup: resolved,
                errors: [],
                warnings: [],
                restartPending: [],
            }),
            settingsRevision: () => 'revision',
            readIntent: async () => ({
                version: 1,
                hostSession: 'login',
                scope: { project: '/checkout', generation: 'old' },
                backend,
                interrupted: false,
                intent: {
                    running: true,
                    paused: false,
                    stoppedByUser: ['api'],
                },
            }),
            validateProject: async () => ({ directory: '/checkout' }),
            open: async (intent: unknown) => {
                received = intent;
                throw stopped;
            },
        } as unknown as ApplicationHost;
        const session = new ProjectSession(host, {} as Interactions);
        await assert.rejects(session.initialize(), stopped);
        assert.equal(received, undefined);
    }
});

test('protocol rejects retired commands/settings and old clients', () => {
    const request = {
        protocol: protocolVersion,
        clientId: 'client',
        requestId: 'request',
        scope: { project: '/checkout', generation: 'generation' },
    };
    assert.throws(
        () =>
            commandRequest({ ...request, command: 'runtime.start', args: {} }),
        /Unknown command/,
    );
    for (const key of ['runtime', 'orchestrator'])
        assert.throws(
            () =>
                commandRequest({
                    ...request,
                    command: 'settings.save',
                    args: { key, value: 'native', revision: 'revision' },
                }),
            /Unknown setting/,
        );
    assert.throws(
        () =>
            commandRequest({
                ...request,
                protocol: 4,
                command: 'environment.stop',
                args: {},
            }),
        (error) =>
            error instanceof ClientError &&
            error.detail.code === 'PROTOCOL_MISMATCH',
    );
});
