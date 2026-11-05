import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeFields } from '../src/infrastructure/tui-log.js';

test('proxy event fields survive the log allowlist', () => {
    assert.deepEqual(
        safeFields({
            service: 'felixvalidator',
            cause: 'idle-unload',
            status: 'success',
        }),
        {
            service: 'felixvalidator',
            cause: 'idle-unload',
            status: 'success',
        },
    );
});

test('free text and unknown causes are stripped from proxy events', () => {
    const stripped = safeFields({
        message: 'GET http://user:token@api.chs.local/path',
        url: 'http://api.chs.local/path',
        headers: '{}',
        cause: 'some-free-text',
        service: 'Not_A_Service',
        status: 'success',
    });
    assert.deepEqual(stripped, { status: 'success' });
});
