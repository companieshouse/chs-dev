import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import ServiceLogs from '../src/tui/components/service-logs.js';
import { terminal } from './support/terminal.js';

test('long log entries wrap into scrollable rows and keep the footer in a narrow window', async (t) => {
    const line = `BEGINNING ${'stack.trace.'.repeat(70)} FINAL_MARKER`;
    const term = terminal(
        createElement(ServiceLogs, {
            name: 'api',
            fullScreen: true,
            load: async () => [line],
            onClose: () => {},
        }),
        { columns: 60, rows: 10 },
    );
    t.after(() => term.app.unmount());
    await delay(100);
    assert.match(term.frame(), /FINAL_MARKER/);
    assert.doesNotMatch(term.frame(), /BEGINNING/);
    const frames = [term.frame()];
    await term.key('\u001b[5~');
    frames.push(term.frame());
    await term.key('\u001b[5~');
    frames.push(term.frame());
    assert.match(term.frame(), /BEGINNING/);
    for (const frame of frames) {
        const rows = frame.split('\n');
        assert.equal(rows.length, 10);
        assert.match(rows[0], /← Back \(Esc\).*Containers \/ Logs/);
        assert.match(rows.at(-1)!, /Esc back/);
        assert.ok(rows.every((row) => row.length <= 60));
        assert.doesNotMatch(frame, /[╭╮╰╯]/);
    }
    await term.key('\u001b[6~');
    await term.key('\u001b[6~');
    assert.match(term.frame(), /FINAL_MARKER/);
});

test('logs use the entire wide window and rewrap embedded newlines, tabs and Unicode after resize', async (t) => {
    const line = `2026-10-02T12:32:00Z ${'x'.repeat(110)} END_OF_LONG_LINE`;
    const term = terminal(
        createElement(ServiceLogs, {
            name: 'api',
            fullScreen: true,
            load: async () => [
                line,
                'first\r\nsecond\nthird',
                '\twide: 界界 café 👩‍💻',
            ],
            onClose: () => {},
        }),
        { columns: 180, rows: 18 },
    );
    t.after(() => term.app.unmount());
    await delay(100);
    assert.ok(
        term
            .frame()
            .split('\n')
            .some((row) => row.includes(line)),
    );
    assert.match(term.frame(), /first\s*\n.*second\s*\n.*third/);
    assert.match(term.frame(), /界界 café 👩‍💻/);
    assert.doesNotMatch(term.frame(), /\t/);
    term.resize(50, 12);
    await delay(100);
    const rows = term.frame().split('\n');
    assert.equal(rows.length, 12);
    assert.match(rows[0], /← Back \(Esc\).*Containers \/ Logs/);
    assert.match(rows.at(-1)!, /Esc back/);
    assert.ok(rows.every((row) => row.length <= 50));
    assert.match(term.frame(), /END_OF_LONG_LINE/);
    assert.match(term.frame(), /first\s*\n.*second\s*\n.*third/);
    assert.match(term.frame(), /界界 café 👩‍💻/);
});

test('log failures and empty results stay within the viewport with back and refresh controls visible', async (t) => {
    let fail = true;
    let closes = 0;
    const term = terminal(
        createElement(ServiceLogs, {
            name: 'api',
            fullScreen: true,
            load: async () => {
                if (fail)
                    throw new Error(
                        'Failed to read logs.\n' + 'detail '.repeat(100),
                    );
                return [];
            },
            onClose: () => {
                closes++;
            },
        }),
        { columns: 50, rows: 10 },
    );
    t.after(() => term.app.unmount());
    await delay(100);
    assert.match(term.frame(), /Failed to read logs/);
    assert.equal(term.frame().split('\n').length, 10);
    assert.match(term.frame().split('\n').at(-1)!, /Esc back/);
    fail = false;
    await term.key('r');
    assert.match(term.frame(), /No output yet/);
    assert.equal(term.frame().split('\n').length, 10);
    assert.match(term.frame().split('\n').at(-1)!, /Esc back/);
    await term.key('\u001b');
    assert.equal(closes, 1);
});
