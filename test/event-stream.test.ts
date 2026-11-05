import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    EventDecoder,
    parseEventBlock,
    type StreamEvent,
} from '../src/client/event-stream.js';

test('event blocks preserve defaults, cursors and multiline JSON and ignore comments', () => {
    assert.equal(parseEventBlock(': keepalive\nid: ignored'), undefined);
    assert.deepEqual(parseEventBlock('data: {"ready":true}'), {
        type: 'message',
        data: { ready: true },
        id: undefined,
    });
    assert.deepEqual(
        parseEventBlock(
            ': comment\nevent: unused\nevent: snapshot\nid: old\nid: 42\ndata: {\ndata: "ready":true\ndata: }',
        ),
        { type: 'snapshot', data: { ready: true }, id: '42' },
    );
});

test('event decoding preserves partial frames at every possible chunk boundary', () => {
    const input =
        ': keepalive\n\nevent: snapshot\nid: 42\ndata: {"name":"café"}\n\ndata: [1,2]\n\n';
    const expected: StreamEvent[] = [
        { type: 'snapshot', data: { name: 'café' }, id: '42' },
        { type: 'message', data: [1, 2], id: undefined },
    ];
    for (let boundary = 0; boundary <= input.length; boundary++) {
        const events: StreamEvent[] = [];
        const decoder = new EventDecoder((type, data, id) => {
            events.push({ type, data, id });
        });
        decoder.push(input.slice(0, boundary));
        decoder.push(input.slice(boundary));
        assert.deepEqual(events, expected, `chunk boundary ${boundary}`);
    }
    const events: StreamEvent[] = [];
    const decoder = new EventDecoder((type, data, id) => {
        events.push({ type, data, id });
    });
    for (const character of input) decoder.push(character);
    assert.deepEqual(events, expected);
});

test('partial events wait for a delimiter and consumed frames release buffer capacity', () => {
    const values: unknown[] = [];
    const decoder = new EventDecoder((_, value) => values.push(value), 12);
    decoder.push('data: 1\n');
    assert.deepEqual(values, []);
    decoder.push('\n');
    assert.deepEqual(values, [1]);
    for (let i = 0; i < 100; i++) decoder.push('data: 2\n\n');
    assert.equal(values.length, 101);
    decoder.push('123456789012');
    assert.throws(() => decoder.push('3'), /Daemon event is too large/);
});

test('invalid JSON and handler failures stop decoding the failed stream', () => {
    const values: unknown[] = [];
    const decoder = new EventDecoder((_, value) => values.push(value));
    assert.throws(
        () => decoder.push('data: invalid\n\ndata: 2\n\n'),
        SyntaxError,
    );
    assert.deepEqual(values, []);
    const failure = new Error('handler failed');
    let calls = 0;
    const failing = new EventDecoder(() => {
        calls++;
        throw failure;
    });
    assert.throws(
        () => failing.push('data: 1\n\ndata: 2\n\n'),
        (error) => error === failure,
    );
    assert.equal(calls, 1);
});
