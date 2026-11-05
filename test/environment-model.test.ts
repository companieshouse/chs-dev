import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LiveState } from '../src/domain/live.js';
import {
    changeSummary,
    environmentActions,
    environmentDetailList,
    environmentDetails,
    environmentOutput,
    environmentStatus,
    environmentSteps,
    wrapText,
} from '../src/tui/models/environment.js';

const base: LiveState = {
    running: false,
    autoApply: true,
    phase: 'Stopped',
    message: '',
    stoppedByUser: [],
    logs: [],
    logSequence: 0,
    busy: false,
};
const summary = (
    state: 'Ready' | 'Issues' | 'Stopped' | 'Starting',
    up: number,
    failed: string[] = [],
) => ({
    state,
    up,
    total: 3,
    failed,
    label:
        state === 'Issues'
            ? `${failed.length} failing · ${up}/3 up`
            : state === 'Starting'
              ? `Starting ${up}/3`
              : state,
});
const ids = (state: LiveState, s?: ReturnType<typeof summary>) =>
    environmentActions(state, s).map((action) => action.id);
const label = (state: LiveState, s?: ReturnType<typeof summary>) => {
    const status = environmentStatus(state, s);
    return `${status.icon} ${status.label}${status.hint ? ` · ${status.hint}` : ''}`;
};

test('status bar shows one state with one hint', () => {
    assert.equal(label(base), '○ Stopped · Ctrl+E start');
    assert.equal(
        label(
            { ...base, running: true, phase: 'Running' },
            summary('Ready', 3),
        ),
        '● Running 3/3',
    );
    assert.equal(
        label(
            { ...base, running: true, phase: 'Running' },
            summary('Issues', 2, ['api']),
        ),
        '✕ 1 failing · 2/3 up · Ctrl+E details',
    );
    assert.equal(
        label(
            {
                ...base,
                running: true,
                phase: 'Running',
                changes: {
                    start: ['db'],
                    stop: ['old'],
                    recreate: [],
                    modeChanged: [],
                    edited: true,
                },
            },
            summary('Ready', 3),
        ),
        '● Running 3/3 · 2 changes pending · Ctrl+E apply',
    );
    assert.equal(
        label(
            {
                ...base,
                running: true,
                phase: 'Running',
                changes: {
                    start: ['mongo'],
                    stop: [],
                    recreate: [],
                    modeChanged: [],
                    edited: false,
                },
            },
            summary('Ready', 3),
        ),
        '● Running 3/3 · mongo not running · Ctrl+E fix',
    );
    assert.equal(
        label({ ...base, phase: 'Blocked', blocked: 'ecr' }),
        '▲ Needs AWS + registry login · Ctrl+L',
    );
    assert.equal(
        label({ ...base, phase: 'Blocked', blocked: 'ssh' }),
        '▲ Needs SSH access · Ctrl+E set up',
    );
    assert.equal(
        label({ ...base, phase: 'Failed', action: 'apply' }),
        '✕ Apply failed · Ctrl+E details',
    );
    assert.equal(
        label(
            { ...base, busy: true, phase: 'Applying', action: 'start' },
            summary('Starting', 1),
        ),
        '◌ Starting services 1/3 · Ctrl+E details',
    );
    assert.equal(
        label({ ...base, busy: true, activity: 'Restarting api…' }),
        '◌ Restarting api… · Ctrl+E details',
    );
    assert.equal(
        label({
            ...base,
            plan: { start: [], stop: ['old'], recreate: [] },
        }),
        '▲ Confirm start · Ctrl+E',
    );
    assert.equal(
        environmentStatus(base, summary('Ready', 3), false).label,
        'Ready',
    );
});

test('the panel offers only actions that apply, recommended first', () => {
    assert.deepEqual(ids(base, summary('Stopped', 0)), [
        'start',
        'logs',
        'close',
    ]);
    const leftovers = {
        ...base,
        observed: {
            projectName: 'chs',
            projectDirectory: '/project',
            containers: [
                {
                    id: 'a',
                    service: 'api',
                    projectName: 'chs',
                    projectDirectory: '/project',
                    lifecycle: 'exited',
                },
            ],
        },
    };
    assert.deepEqual(ids(leftovers, summary('Stopped', 0)), [
        'start',
        'stop',
        'logs',
        'close',
    ]);
    const running = { ...base, running: true, phase: 'Running' as const };
    assert.deepEqual(ids(running, summary('Ready', 3)), [
        'apply',
        'stop',
        'logs',
        'close',
    ]);
    assert.deepEqual(
        ids(
            {
                ...running,
                changes: {
                    start: ['db'],
                    stop: [],
                    recreate: [],
                    modeChanged: [],
                    edited: true,
                },
            },
            summary('Issues', 2, ['api']),
        ).slice(0, 2),
        ['apply', 'restart-failing'],
    );
    assert.deepEqual(ids({ ...base, busy: true, phase: 'Checking' }), [
        'cancel',
        'stop',
        'logs',
        'close',
    ]);
    assert.deepEqual(
        ids({ ...base, busy: true, phase: 'Stopping', action: 'stop' }),
        ['cancel', 'logs', 'close'],
    );
    assert.deepEqual(
        ids({ ...base, plan: { start: ['api'], stop: ['old'], recreate: [] } }),
        ['confirm', 'dismiss', 'logs'],
    );
    assert.deepEqual(ids({ ...base, phase: 'Blocked', blocked: 'aws' }), [
        'login-aws',
        'retry',
        'logs',
        'close',
    ]);
    const cancelled = environmentActions({
        ...running,
        phase: 'Blocked',
        blocked: 'cancelled',
    });
    assert.equal(cancelled[0]?.label, 'Resume');
    assert.ok(cancelled.some((action) => action.id === 'stop'));
    assert.deepEqual(ids(base, undefined).includes('stop'), false);
    assert.deepEqual(
        environmentActions(base, undefined, false).map((action) => action.id),
        ['close'],
    );
});

test('details describe plans, pending changes and problems in plain words', () => {
    const plan = { start: ['api', 'db'], stop: ['old'], recreate: ['base'] };
    assert.equal(
        changeSummary({ ...plan, modeChanged: [] }, { updates: true }),
        'start 2 · stop 1 · update 1 (may restart)',
    );
    assert.deepEqual(environmentDetailList({ ...base, plan }), [
        'Start (2)',
        '  api',
        '  db',
        'Stop (1)',
        '  old',
        'Update (may restart) (1)',
        '  base',
    ]);
    const pending = environmentDetails({
        ...base,
        running: true,
        phase: 'Running',
        autoApply: false,
        changes: {
            start: ['db'],
            stop: [],
            recreate: [],
            modeChanged: [],
            edited: true,
        },
    });
    assert.equal(
        pending[0]?.text,
        '1 change pending: start 1 · saved changes wait for Apply',
    );
    assert.match(
        environmentDetails({ ...base, phase: 'Failed', message: '' })[0]!.text,
        /View logs/,
    );
    assert.deepEqual(environmentSteps({ ...base, phase: 'Preparing' }), {
        steps: [
            'Checking configuration and tools',
            'Preparing images',
            'Applying changes',
        ],
        current: 1,
    });
});

test('long diagnostics wrap for narrow terminals', () => {
    assert.deepEqual(wrapText('missing ERIC_PORT', 10), [
        'missing',
        'ERIC_PORT',
    ]);
    assert.deepEqual(wrapText('0123456789abcdef', 6), [
        '012345',
        '6789ab',
        'cdef',
    ]);
    assert.deepEqual(wrapText('first\n\nlast', 20), ['first', '', 'last']);
});

test('operation progress excludes old startup waits without discarding log history', () => {
    const stopping: LiveState = {
        ...base,
        busy: true,
        phase: 'Stopping',
        logSequence: 10,
        operationLogStart: 10,
        logs: ['2026-10-01T10:00:00Z Wait: mongo (service_healthy)'],
    };
    assert.deepEqual(environmentOutput(stopping), []);
    stopping.logs = [
        ...stopping.logs,
        '2026-10-01T10:01:00Z Stopping: mongo [1/2]',
    ];
    stopping.logSequence++;
    assert.deepEqual(environmentOutput(stopping), ['Stopping: mongo [1/2]']);
    assert.equal(stopping.logs.length, 2);
    stopping.logs = [
        '2026-10-01T10:02:00Z Removed: mongo [1/2]; volumes kept.',
    ];
    stopping.logSequence += 5000;
    assert.deepEqual(environmentOutput(stopping), [
        'Removed: mongo [1/2]; volumes kept.',
    ]);
});
