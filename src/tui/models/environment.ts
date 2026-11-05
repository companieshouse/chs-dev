import type {
    EnvironmentSummary,
    ProxyState,
    ServiceBlocker,
} from '../../domain/environment.js';
import { serviceBlockers } from '../../domain/environment.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import type {
    EnvironmentChanges,
    LivePreview,
    LiveState,
} from '../../domain/live.js';

export type EnvironmentTone =
    'healthy' | 'busy' | 'warning' | 'error' | 'muted';

export interface EnvironmentStatus {
    icon: string;
    label: string;
    /** Short key hint, e.g. "Ctrl+E start". */
    hint?: string;
    tone: EnvironmentTone;
}

export type EnvironmentActionId =
    | 'start'
    | 'confirm'
    | 'dismiss'
    | 'apply'
    | 'restart-failing'
    | 'stop'
    | 'login-aws'
    | 'login-registry'
    | 'ssh'
    | 'retry'
    | 'cancel'
    | 'logs'
    | 'profiles'
    | 'versions'
    | 'close';

export interface EnvironmentActionItem {
    id: EnvironmentActionId;
    label: string;
}

type Summary = Pick<
    EnvironmentSummary,
    'state' | 'up' | 'total' | 'failed' | 'label'
>;

const plural = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;

function ratio(summary?: Summary) {
    return summary && summary.total ? ` ${summary.up}/${summary.total}` : '';
}

/** Number of concrete differences; saved edits with none still count as one. */
export function pendingCount(changes: EnvironmentChanges): number {
    const count =
        changes.start.length + changes.stop.length + changes.modeChanged.length;
    return count || (changes.edited ? 1 : 0);
}

/** One-line description of what applying would do, e.g. "start 2 · stop 1". */
export function changeSummary(
    changes: Pick<
        EnvironmentChanges,
        'start' | 'stop' | 'recreate' | 'modeChanged'
    >,
    options: { updates?: boolean } = {},
): string {
    const parts = [
        changes.start.length ? `start ${changes.start.length}` : '',
        changes.stop.length ? `stop ${changes.stop.length}` : '',
        changes.modeChanged.length
            ? `switch mode ${changes.modeChanged.length}`
            : '',
        options.updates && changes.recreate.length
            ? `update ${changes.recreate.length} (may restart)`
            : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'update settings (may restart)';
}

/** What changed outside chs-dev, in plain words. */
export function outsideChanges(changes: EnvironmentChanges): string[] {
    return [
        ...changes.start.map((name) => `${name} not running`),
        ...changes.stop.map((name) => `${name} not enabled`),
        ...changes.modeChanged.map((name) => `${name} in a different mode`),
    ];
}

function busyLabel(state: LiveState, summary?: Summary): string {
    if (state.activity) return state.activity;
    switch (state.phase) {
        case 'Checking':
            return 'Checking…';
        case 'Preparing':
            return 'Preparing images…';
        case 'Applying':
            return state.action === 'start'
                ? `Starting services${ratio(summary)}`
                : 'Applying changes…';
        case 'Stopping':
            return 'Stopping…';
        case 'Cancelling':
            return 'Cancelling…';
        default:
            return 'Working…';
    }
}

const failedLabels = {
    start: 'Start failed',
    apply: 'Apply failed',
    stop: 'Stop failed',
    service: 'Action failed',
} as const;

function blockedStatus(state: LiveState): EnvironmentStatus {
    switch (state.blocked) {
        case 'aws':
            return {
                icon: '▲',
                label: 'Needs AWS login',
                hint: 'Ctrl+L',
                tone: 'warning',
            };
        case 'ecr':
            return {
                icon: '▲',
                label: 'Needs AWS + registry login',
                hint: 'Ctrl+L',
                tone: 'warning',
            };
        case 'ssh':
            return {
                icon: '▲',
                label: 'Needs SSH access',
                hint: 'Ctrl+E set up',
                tone: 'warning',
            };
        case 'cancelled':
            return {
                icon: '▲',
                label: 'Paused',
                hint: 'Ctrl+E resume',
                tone: 'warning',
            };
        default:
            return {
                icon: '▲',
                label: state.running ? "Can't apply" : "Can't start",
                hint: 'Ctrl+E details',
                tone: 'warning',
            };
    }
}

function runningStatus(state: LiveState, summary?: Summary): EnvironmentStatus {
    const changes = state.changes;
    if (changes?.edited) {
        const count = pendingCount(changes);
        return {
            icon: '●',
            label: `Running${ratio(summary)} · ${plural(count, 'change')} pending`,
            hint: 'Ctrl+E apply',
            tone: 'warning',
        };
    }
    if (changes) {
        const [first, ...rest] = outsideChanges(changes);
        return {
            icon: '●',
            label: `Running${ratio(summary)} · ${first ?? 'changed outside chs-dev'}${rest.length ? ` +${rest.length}` : ''}`,
            hint: 'Ctrl+E fix',
            tone: 'warning',
        };
    }
    if (summary?.state === 'Issues')
        return {
            icon: '✕',
            label: summary.label,
            hint: 'Ctrl+E details',
            tone: 'error',
        };
    if (summary?.state === 'Starting')
        return { icon: '◌', label: summary.label, tone: 'busy' };
    return {
        icon: '●',
        label: `Running${ratio(summary)}`,
        tone: 'healthy',
    };
}

function unavailableStatus(summary?: Summary): EnvironmentStatus {
    return {
        icon: summary?.state === 'Ready' ? '●' : '○',
        label: summary?.label ?? 'Unavailable',
        tone: summary?.state === 'Ready' ? 'healthy' : 'muted',
    };
}

export function environmentStatus(
    state: LiveState,
    summary?: Summary,
    available = true,
): EnvironmentStatus {
    if (!available) return unavailableStatus(summary);
    if (state.busy)
        return {
            icon: '◌',
            label: busyLabel(state, summary),
            hint: 'Ctrl+E details',
            tone: 'busy',
        };
    if (state.plan)
        return {
            icon: '▲',
            label: 'Confirm start',
            hint: 'Ctrl+E',
            tone: 'warning',
        };
    if (state.phase === 'Blocked') return blockedStatus(state);
    if (state.phase === 'Failed')
        return {
            icon: '✕',
            label: failedLabels[state.action ?? 'start'],
            hint: 'Ctrl+E details',
            tone: 'error',
        };
    if (state.running) return runningStatus(state, summary);
    return {
        icon: '○',
        label: 'Stopped',
        hint: 'Ctrl+E start',
        tone: 'muted',
    };
}

const logsAction: EnvironmentActionItem = { id: 'logs', label: 'View logs' };
const closeAction: EnvironmentActionItem = { id: 'close', label: 'Close' };
const stopAction: EnvironmentActionItem = {
    id: 'stop',
    label: 'Stop environment',
};

function blockedFailedActions(state: LiveState): EnvironmentActionItem[] {
    const actions: EnvironmentActionItem[] = [];
    if (state.blocked === 'aws')
        actions.push({ id: 'login-aws', label: 'Log in to AWS' });
    else if (state.blocked === 'ecr')
        actions.push({
            id: 'login-registry',
            label: 'Log in to AWS + registry',
        });
    else if (state.blocked === 'ssh' && state.sshSetup)
        actions.push({ id: 'ssh', label: 'Set up SSH access' });
    actions.push({
        id: 'retry',
        label: state.blocked === 'cancelled' ? 'Resume' : 'Try again',
    });
    if (state.running) actions.push(stopAction);
    actions.push(logsAction, closeAction);
    return actions;
}

function stoppedActions(
    state: LiveState,
    summary: Summary | undefined,
): EnvironmentActionItem[] {
    const actions: EnvironmentActionItem[] = [
        { id: 'start', label: 'Start environment' },
    ];
    if (summary?.up) actions.push(stopAction);
    else if (state.observed?.containers.length) actions.push(stopAction);
    actions.push(logsAction, closeAction);
    return actions;
}

function runningActions(
    state: LiveState,
    summary: Summary | undefined,
): EnvironmentActionItem[] {
    const actions: EnvironmentActionItem[] = [
        {
            id: 'apply',
            label: state.changes
                ? state.changes.edited
                    ? 'Apply changes'
                    : 'Fix: apply saved configuration'
                : 'Re-apply configuration',
        },
    ];
    if (summary?.failed.length)
        actions.push({
            id: 'restart-failing',
            label: `Restart failing services (${summary.failed.length})`,
        });
    actions.push(stopAction);
    actions.push(logsAction, closeAction);
    return actions;
}

export function environmentActions(
    state: LiveState,
    summary?: Summary,
    available = true,
): EnvironmentActionItem[] {
    if (!available) return [{ id: 'close', label: 'Close' }];
    if (state.busy)
        return [
            ...(state.phase === 'Cancelling'
                ? []
                : [{ id: 'cancel' as const, label: 'Cancel' }]),
            ...(state.action === 'stop' ? [] : [stopAction]),
            logsAction,
            closeAction,
        ];
    if (state.plan)
        return [
            { id: 'confirm', label: 'Start and stop the listed services' },
            { id: 'dismiss', label: "Don't start" },
            logsAction,
        ];
    if (state.phase === 'Blocked' || state.phase === 'Failed')
        return blockedFailedActions(state);
    if (!state.running) return stoppedActions(state, summary);
    return runningActions(state, summary);
}

/** Recent output from this operation, without unrelated messages from earlier work. */
export function environmentOutput(state: LiveState): string[] {
    const count = Math.min(
        5,
        state.logSequence - (state.operationLogStart ?? 0),
    );
    return count > 0
        ? state.logs.slice(-count).map((line) => line.replace(/^\S+Z /, ''))
        : [];
}

/** Steps shown while an operation runs, with the index of the current one. */
export function environmentSteps(state: LiveState): {
    steps: string[];
    current: number;
} {
    if (state.activity) return { steps: [state.activity], current: 0 };
    if (state.phase === 'Stopping' || state.action === 'stop')
        return { steps: ['Stopping containers'], current: 0 };
    const steps = [
        'Checking configuration and tools',
        'Preparing images',
        state.action === 'start' ? 'Starting containers' : 'Applying changes',
    ];
    const current =
        state.phase === 'Preparing' ? 1 : state.phase === 'Applying' ? 2 : 0;
    return { steps, current };
}

function planRows(
    state: LiveState,
    plan: LivePreview,
): { text: string; tone: EnvironmentTone }[] {
    return [
        { text: state.message, tone: 'warning' },
        {
            text: `Plan: ${changeSummary({ ...plan, modeChanged: [] }, { updates: true })}`,
            tone: 'muted',
        },
    ];
}

function blockedFailedRows(state: LiveState): {
    text: string;
    tone: EnvironmentTone;
}[] {
    const rows: { text: string; tone: EnvironmentTone }[] = [
        {
            text:
                state.message ||
                'The operation did not finish. See View logs for the command output.',
            tone: state.phase === 'Failed' ? 'error' : 'warning',
        },
    ];
    if (state.sshSetup)
        rows.push({
            text: `Needed by: ${state.sshSetup.requirements[0]?.services.join(', ') || 'selected development services'}`,
            tone: 'muted',
        });
    return rows;
}

/** Per-service first causal blockers, for the environment panel. */
export function blockerRows(
    state: LiveState,
    statuses: Readonly<Record<string, ServiceStatus>>,
    dependencies: Readonly<Record<string, readonly string[]>>,
    proxy?: Pick<ProxyState, 'coldStarting' | 'lazy'>,
): { text: string; tone: EnvironmentTone }[] {
    if (!state.running) return [];
    const enabled = new Set<string>([
        ...Object.entries(statuses)
            .filter(([, status]) => status !== 'Unknown')
            .map(([service]) => service),
        ...(state.exclusions ?? []).flatMap((exclusion) => exclusion.services),
        ...(proxy?.coldStarting ?? []),
    ]);
    const blockers = serviceBlockers({
        enabled: [...enabled],
        statuses,
        containers: state.observed?.containers,
        exclusions: state.exclusions,
        dependencies,
        lazy: new Set(proxy?.lazy ?? []),
        coldStarting: proxy?.coldStarting,
    });
    return blockers.map((blocker) => blockerRow(blocker));
}

function blockerRow(blocker: ServiceBlocker): {
    text: string;
    tone: EnvironmentTone;
} {
    const tone: EnvironmentTone =
        blocker.state === 'failing'
            ? 'error'
            : blocker.state === 'lazy-idle'
              ? 'muted'
              : 'warning';
    return {
        text: `${blocker.service}: ${blocker.state} - ${blocker.detail}`,
        tone,
    };
}

function runningRows(
    state: LiveState,
    summary: Summary | undefined,
): { text: string; tone: EnvironmentTone }[] {
    const rows: { text: string; tone: EnvironmentTone }[] = [];
    if (state.running && summary?.failed.length)
        rows.push({
            text: `${summary.failed.length} failing: ${summary.failed.join(', ')}`,
            tone: 'error',
        });
    if (state.running && state.changes) {
        if (state.changes.edited)
            rows.push({
                text: `${plural(pendingCount(state.changes), 'change')} pending: ${changeSummary(state.changes)} · saved changes wait for Apply`,
                tone: 'warning',
            });
        else
            rows.push({
                text: `Changed outside chs-dev: ${outsideChanges(state.changes).join(', ')}`,
                tone: 'warning',
            });
    }
    if (state.running && state.stoppedByUser.length)
        rows.push({
            text: `Stopped by you: ${state.stoppedByUser.join(', ')}`,
            tone: 'muted',
        });
    return rows;
}

function idleRow(state: LiveState): {
    text: string;
    tone: EnvironmentTone;
} {
    return {
        text: state.running
            ? 'Saved service edits wait until you choose Apply changes.'
            : 'Start brings containers in line with your saved configuration.',
        tone: 'muted',
    };
}

/** Plain-language details shown above the actions. */
export function environmentDetails(
    state: LiveState,
    summary?: Summary,
): { text: string; tone: EnvironmentTone }[] {
    if (state.plan) return planRows(state, state.plan);
    if (state.phase === 'Blocked' || state.phase === 'Failed')
        return blockedFailedRows(state);
    if (state.busy) return [];
    const rows = runningRows(state, summary);
    if (!rows.length) rows.push(idleRow(state));
    return rows;
}

/** Service names for the `d` details list. */
export function environmentDetailList(state: LiveState): string[] {
    const source = state.plan
        ? { ...state.plan, modeChanged: [] as string[] }
        : state.changes;
    if (!source) return [];
    const section = (title: string, names: readonly string[]) =>
        names.length
            ? [
                  `${title} (${names.length})`,
                  ...names.map((name) => `  ${name}`),
              ]
            : [];
    return [
        ...section('Start', source.start),
        ...section('Stop', source.stop),
        ...section('Switch mode', source.modeChanged),
        ...(state.plan ? section('Update (may restart)', source.recreate) : []),
    ];
}

export function wrapText(value: string, width: number): string[] {
    const limit = Math.max(1, Math.floor(width));
    return value.split(/\r?\n/).flatMap((line) => {
        if (!line) return [''];
        const rows: string[] = [];
        let remaining = line;
        while (remaining.length > limit) {
            let split = remaining.lastIndexOf(' ', limit);
            if (split <= 0) split = limit;
            rows.push(remaining.slice(0, split));
            remaining = remaining.slice(split).trimStart();
        }
        rows.push(remaining);
        return rows;
    });
}
