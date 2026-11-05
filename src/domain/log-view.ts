export type LogCategory = 'App' | 'Config' | 'AWS' | 'Docker' | 'Env';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const logFilters = [
    'All',
    'Env',
    'Docker',
    'AWS',
    'Config',
    'App',
    'Problems',
] as const;
export type LogFilter = (typeof logFilters)[number];

export interface LogEntry {
    time: string;
    category: LogCategory;
    level: LogLevel;
    text: string;
    raw: string;
}

type Fields = Record<string, unknown>;

const errorStatuses = new Set([
    'failed',
    'error',
    'Failed',
    'expired',
    'signed-out',
    'conflict',
]);
const warnStatuses = new Set([
    'cancelled',
    'Blocked',
    'unavailable',
    'missing',
    'missing-cli',
    'unconfigured',
    'Cancelling',
]);

export function duration(ms: unknown): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function clockTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}

const took = (fields: Fields) => {
    const value = duration(fields.durationMs);
    return value ? ` (${value})` : '';
};

const outcome = (status: unknown) =>
    status === 'start'
        ? 'started'
        : status === 'success'
          ? 'succeeded'
          : String(status ?? '');

type Description = { category: LogCategory; text: string; debug?: boolean };
type EventCase = (fields: Fields, status: unknown) => Description;

const eventCases: Record<string, EventCase> = {
    startup: ({ status }) => ({
        category: 'App',
        text:
            status === 'start'
                ? 'chs-dev starting'
                : status === 'success'
                  ? 'chs-dev started'
                  : 'chs-dev failed to start',
    }),
    shutdown: (fields, status) => ({
        category: 'App',
        text: `${status === 'start' ? 'Shutting down' : status === 'success' ? 'Shut down' : 'Shutdown failed'}${fields.signal ? ` (${fields.signal})` : ''}`,
    }),
    'terminal.resume': ({ status }) => ({
        category: 'App',
        text:
            status === 'failed'
                ? 'Could not restore the TUI after a terminal command'
                : 'Returned to the TUI',
    }),
    'config.load': ({ status }) => ({
        category: 'Config',
        text: `Project configuration load ${outcome(status)}`,
        debug: status === 'start',
    }),
    'config.save': (fields, status) => {
        if (status === 'conflict')
            return {
                category: 'Config',
                text: 'Configuration changed on disk; save rejected',
            };
        const flags = [
            fields.enabled === true
                ? 'enabled'
                : fields.enabled === false
                  ? 'disabled'
                  : '',
            fields.development === true ? 'development' : '',
        ].filter(Boolean);
        return {
            category: 'Config',
            text: `Saving ${fields.service ?? 'service'}${flags.length ? ` (${flags.join(', ')})` : ''}`,
        };
    },
    'settings.save': (fields, status) => ({
        category: 'Config',
        text: `Setting ${fields.setting ?? ''} save ${outcome(status ?? 'success')}`,
        debug: status === 'start',
    }),
    'project.search': (fields) => ({
        category: 'Config',
        text: `Project search found ${fields.count ?? 0} checkout${fields.count === 1 ? '' : 's'}`,
    }),
    'project.clone': (fields, status) => ({
        category: 'Config',
        text: `Project clone ${outcome(status)}${took(fields)}`,
        debug: status === 'start',
    }),
    'aws.status': (fields, status) => {
        const labels: Record<string, string> = {
            active: 'AWS session active',
            expired: 'AWS session expired',
            'signed-out': 'AWS not authenticated',
            'missing-cli': 'AWS CLI not installed',
            unconfigured: 'AWS profile needs configuration',
            unavailable: 'AWS status unavailable',
            checking: 'Checking AWS session',
        };
        return {
            category: 'AWS',
            text: labels[String(status)] ?? `AWS status ${status}`,
        };
    },
    'aws.profiles': (fields, status) => ({
        category: 'AWS',
        text: `AWS profile discovery ${outcome(status)}${took(fields)}`,
        debug: status === 'start',
    }),
    login: (fields, status) => {
        const registry = fields.category === 'registry';
        return {
            category: registry ? 'Docker' : 'AWS',
            text: `${registry ? 'Registry (ECR) login' : 'AWS login'} ${outcome(status)}${took(fields)}`,
        };
    },
    'docker.status': ({ status }) => ({
        category: 'Docker',
        text:
            status === 'ready'
                ? 'Docker status available'
                : 'Docker status unavailable; retrying',
    }),
    process: (fields, status) => {
        const command = [fields.command, fields.subcommand]
            .filter(Boolean)
            .join(' ');
        const name = command || 'command';
        const category = processCategory(fields.command);
        if (status === 'start')
            return { category, text: `Running ${name}`, debug: true };
        if (status === 'success')
            return {
                category,
                text: `Ran ${name}${took(fields)}`,
                debug: true,
            };
        if (status === 'cancelled')
            return { category, text: `Cancelled ${name}${took(fields)}` };
        return {
            category,
            text: `${name} failed${typeof fields.code === 'number' ? ` with exit code ${fields.code}` : ''}${fields.signal ? ` (${fields.signal})` : ''}${took(fields)}`,
        };
    },
    'process.signal': (fields) => ({
        category: 'App',
        text: `Sent ${fields.signal ?? 'signal'} to a running command`,
    }),
    'process.timeout': () => ({ category: 'App', text: 'A command timed out' }),
    'live.phase': (fields, status) => ({
        category: 'Env',
        text: `${fields.previousStatus ?? '?'} → ${status}${fields.durationMs !== undefined ? ` after ${duration(fields.durationMs)}` : ''}`,
    }),
    'live.lock': ({ status }) => ({
        category: 'Env',
        text: `Project lock ${status}`,
        debug: true,
    }),
    'live.revision': (fields) => ({
        category: 'Env',
        text: `Revision ${String(fields.revision ?? '').slice(0, 12)}`,
        debug: true,
    }),
    'live.drift': () => ({ category: 'Env', text: 'Changed outside chs-dev' }),
};

function describeOtherEvent(event: string, fields: Fields): Description {
    const status = fields.status;
    const [, action = event] = event.split('.');
    const labels: Record<string, string> = {
        confirm: 'Start requested',
        disable: 'Stop requested',
        retry: 'Apply requested',
        queue: 'Change queued',
        cancel: 'Cancel requested',
    };
    return {
        category: event.startsWith('live.') ? 'Env' : 'App',
        text:
            labels[action] ??
            `${action.replace(/-/g, ' ')}${status ? ` ${outcome(status)}` : ''}${took(fields)}`,
    };
}

function describe(event: string, fields: Fields): Description {
    const describeCase = eventCases[event];
    if (describeCase) return describeCase(fields, fields.status);
    return describeOtherEvent(event, fields);
}

function levelFor(fields: Fields, debug: boolean): LogLevel {
    const status = String(fields.status ?? '');
    if (errorStatuses.has(status)) return 'error';
    if (warnStatuses.has(status)) return 'warn';
    return debug ? 'debug' : 'info';
}

export function parseTuiLogLine(raw: string): LogEntry {
    try {
        const fields = JSON.parse(raw) as Fields;
        if (typeof fields.event !== 'string') throw new Error('not an event');
        const {
            category,
            text,
            debug = false,
        } = describe(fields.event, fields);
        let level = levelFor(fields, debug);
        if (fields.event === 'live.drift' || fields.event === 'process.signal')
            level = 'warn';
        if (fields.event === 'process.timeout') level = 'error';
        return {
            time: clockTime(String(fields.time ?? '')),
            category,
            level,
            text,
            raw,
        };
    } catch {
        return { time: '', category: 'App', level: 'info', text: raw, raw };
    }
}

function processCategory(command: unknown): LogCategory {
    const categories: Record<string, LogCategory> = {
        docker: 'Docker',
        l_docker: 'Docker',
        aws: 'AWS',
        git: 'Config',
    };
    return command ? (categories[String(command)] ?? 'Env') : 'App';
}

function liveOutputLevel(text: string): LogEntry['level'] {
    if (/^warning:/i.test(text)) return 'warn';
    if (
        /^Failed:/.test(text) ||
        /\b(error|failed|denied|unauthorized|exited with code [1-9])/i.test(
            text,
        )
    )
        return 'error';
    if (
        /^Blocked:/.test(text) ||
        /\b(warn(ing)?|drift)\b|^Changed outside/i.test(text)
    )
        return 'warn';
    return 'info';
}

const livePhasePrefix =
    /^(Live OFF|Stopped|Running|Stopping|Checking|Preparing|Applying|Synced|Blocked|Failed|Cancelling|Revision|SSH setup|Cancelled|Completed|Changed outside|Runtime drift|Cannot refresh|Preparation cleanup|(Start|Stop|Restart|Update \(may restart\))( failed)?:)/;

/** Environment output lines are `ISO-time text`; controller messages are Env, the rest is runtime output. */
export function parseLiveOutputLine(raw: string): LogEntry {
    const match = /^(\S+Z) (.*)$/.exec(raw);
    const text = match?.[2] ?? raw;
    return {
        time: match ? clockTime(match[1]!) : '',
        category: livePhasePrefix.test(text) ? 'Env' : 'Docker',
        level: liveOutputLevel(text),
        text,
        raw,
    };
}

export function filterLogEntries(
    entries: readonly LogEntry[],
    filter: LogFilter,
    query: string,
    verbose: boolean,
): LogEntry[] {
    const needle = query.trim().toLowerCase();
    return entries.filter(
        (entry) =>
            (verbose || entry.level !== 'debug') &&
            (filter === 'All' ||
                (filter === 'Problems'
                    ? entry.level === 'error' || entry.level === 'warn'
                    : entry.category === filter)) &&
            (!needle ||
                `${entry.category} ${entry.text}`
                    .toLowerCase()
                    .includes(needle)),
    );
}
