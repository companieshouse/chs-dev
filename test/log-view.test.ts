import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    clockTime,
    duration,
    filterLogEntries,
    parseLiveOutputLine,
    parseTuiLogLine,
} from '../src/domain/log-view.js';
import { processFields, safeFields } from '../src/infrastructure/tui-log.js';

const line = (fields: Record<string, unknown>) =>
    JSON.stringify({
        time: '2026-09-28T13:44:05.261Z',
        source: 'tui',
        session: 'abc',
        ...fields,
    });

test('formats durations and local clock times', () => {
    assert.equal(duration(73), '73ms');
    assert.equal(duration(1500), '1.5s');
    assert.equal(duration(327724), '5m 28s');
    assert.equal(duration(undefined), '');
    assert.match(clockTime('2026-09-28T13:44:05.261Z'), /^\d\d:\d\d:05$/);
    assert.equal(clockTime('nope'), '');
});

test('turns JSON events into categorized human text', () => {
    const phase = parseTuiLogLine(
        line({
            event: 'live.phase',
            status: 'Live OFF',
            previousStatus: 'Blocked',
            durationMs: 327724,
        }),
    );
    assert.equal(phase.category, 'Env');
    assert.equal(phase.text, 'Blocked → Live OFF after 5m 28s');
    assert.equal(phase.level, 'info');

    const aws = parseTuiLogLine(
        line({ event: 'aws.status', status: 'expired' }),
    );
    assert.deepEqual(
        [aws.category, aws.level, aws.text],
        ['AWS', 'error', 'AWS session expired'],
    );

    const registry = parseTuiLogLine(
        line({
            event: 'login',
            category: 'registry',
            status: 'success',
            durationMs: 4200,
        }),
    );
    assert.deepEqual(
        [registry.category, registry.text],
        ['Docker', 'Registry (ECR) login succeeded (4.2s)'],
    );

    assert.equal(
        parseTuiLogLine(line({ event: 'live.cancel' })).text,
        'Cancel requested',
    );
    const unparsed = parseTuiLogLine('not json');
    assert.equal(unparsed.text, 'not json');
});

test('treats routine process runs as detail and failures as errors', () => {
    const ok = parseTuiLogLine(
        line({
            event: 'process',
            command: 'docker',
            subcommand: 'compose ps',
            status: 'success',
            code: 0,
            durationMs: 73,
        }),
    );
    assert.deepEqual(
        [ok.category, ok.level, ok.text],
        ['Docker', 'debug', 'Ran docker compose ps (73ms)'],
    );
    const failed = parseTuiLogLine(
        line({
            event: 'process',
            command: 'docker',
            subcommand: 'compose up',
            status: 'failed',
            code: 1,
            durationMs: 180000,
        }),
    );
    assert.equal(failed.level, 'error');
    assert.equal(
        failed.text,
        'docker compose up failed with exit code 1 (3m 0s)',
    );
    assert.equal(
        parseTuiLogLine(line({ event: 'process', status: 'start' })).category,
        'App',
    );
});

test('classifies environment output as phase messages or runtime output', () => {
    const phase = parseLiveOutputLine(
        '2026-09-28T13:06:27.000Z Failed: Compose apply failed',
    );
    assert.deepEqual(
        [phase.category, phase.level, phase.text],
        ['Env', 'error', 'Failed: Compose apply failed'],
    );
    const output = parseLiveOutputLine(
        '2026-09-28T13:06:20.000Z  Container mongo  Started',
    );
    assert.deepEqual([output.category, output.level], ['Docker', 'info']);
    assert.equal(
        parseLiveOutputLine(
            '2026-09-28T13:06:21.000Z unauthorized: token expired',
        ).level,
        'error',
    );
    for (const [text, level] of [
        ['Start: api', 'info'],
        ['Update (may restart): api', 'info'],
        ['Restart failed: api has no running container.', 'error'],
        ['Changed outside chs-dev: mongo not running.', 'warn'],
        ['Stopped: environment stopped.', 'info'],
    ] as const) {
        const entry = parseLiveOutputLine(`2026-09-28T13:06:21.000Z ${text}`);
        assert.deepEqual([entry.category, entry.level], ['Env', level], text);
    }
});

test('explicit initialization warnings stay warnings when their diagnostic contains an error', () => {
    const entry = parseLiveOutputLine(
        '2026-09-28T13:06:21.000Z Warning: datasync.mongo.js: initialization exited 1; continuing with remaining scripts. MongoBulkWriteError: E11000 duplicate key error',
    );
    assert.equal(entry.level, 'warn');
    assert.deepEqual(filterLogEntries([entry], 'Problems', '', false), [entry]);
    assert.equal(
        parseLiveOutputLine('Error: runtime unavailable').level,
        'error',
    );
});

test('filters by category, problems, search text and detail level', () => {
    const entries = [
        parseTuiLogLine(line({ event: 'aws.status', status: 'active' })),
        parseTuiLogLine(line({ event: 'docker.status', status: 'error' })),
        parseTuiLogLine(
            line({ event: 'process', command: 'docker', status: 'start' }),
        ),
        parseTuiLogLine(line({ event: 'live.drift' })),
    ];
    const texts = (items: typeof entries) => items.map((entry) => entry.text);
    assert.deepEqual(texts(filterLogEntries(entries, 'Docker', '', false)), [
        'Docker status unavailable; retrying',
    ]);
    assert.deepEqual(texts(filterLogEntries(entries, 'Docker', '', true)), [
        'Docker status unavailable; retrying',
        'Running docker',
    ]);
    assert.deepEqual(texts(filterLogEntries(entries, 'Problems', '', false)), [
        'Docker status unavailable; retrying',
        'Changed outside chs-dev',
    ]);
    assert.deepEqual(texts(filterLogEntries(entries, 'All', 'aws', false)), [
        'AWS session active',
    ]);
});

test('logs only the program name and known verbs of a command', () => {
    assert.deepEqual(
        processFields('/usr/local/bin/docker', [
            'compose',
            '-f',
            '/Users/me/secret-project/compose.yaml',
            '--project-name',
            'chs',
            'up',
            '-d',
            'mongo',
        ]),
        { command: 'docker', subcommand: 'compose up' },
    );
    assert.deepEqual(
        safeFields({ command: 'docker', subcommand: 'compose up' }),
        { command: 'docker', subcommand: 'compose up' },
    );
    assert.deepEqual(
        safeFields({ command: '../x y', subcommand: 'compose /etc/passwd' }),
        {},
    );
});
