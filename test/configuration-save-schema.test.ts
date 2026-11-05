import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandRequest } from '../src/protocol/schemas.js';
import { protocolVersion } from '../src/protocol/types.js';

function save(edit: Record<string, unknown>) {
    return {
        protocol: protocolVersion,
        clientId: 'client',
        requestId: 'request',
        scope: { project: '/project', generation: 'g1' },
        command: 'configuration.save',
        args: {
            revision: 'r1',
            edit: {
                name: 'accounts-filing-web',
                enabled: false,
                development: false,
                exclusions: {},
                ...edit,
            },
        },
    };
}

test('configuration.save accepts a disable edit carrying a start mode', () => {
    for (const startMode of ['lazy', 'always', null, undefined]) {
        assert.doesNotThrow(() => commandRequest(save({ startMode })));
    }
});

test('configuration.save rejects an unknown start mode', () => {
    assert.throws(
        () => commandRequest(save({ startMode: 'sometimes' })),
        /lazy or always/,
    );
});
