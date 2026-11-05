import * as fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { settingKeys } from '../domain/settings.js';

export const retention = '5 MiB active + 2 rotations; owner-only';
export { events } from '../domain/diagnostics.js';
export type { LogEvent, LogFields } from '../domain/diagnostics.js';
import {
    events,
    type LogEvent,
    type LogFields,
} from '../domain/diagnostics.js';

const statuses = new Set([
    'start',
    'success',
    'failed',
    'cancelled',
    'ready',
    'error',
    'unavailable',
    'checking',
    'authenticated',
    'expired',
    'missing',
    'acquired',
    'released',
    'conflict',
    'validated',
    'suspended',
    'Checking',
    'Preparing',
    'Applying',
    'Verifying',
    'Blocked',
    'Failed',
    'Cancelling',
    'Live OFF',
    'Live ON',
    'Watching',
    'Idle',
    'In sync',
    'Stopping',
    'Running',
    'Synced',
    'Stopped',
    'active',
    'signed-out',
    'missing-cli',
    'unconfigured',
]);
const commandVerbs = new Set([
    'build',
    'clone',
    'compose',
    'config',
    'configure',
    'create',
    'down',
    'exec',
    'export-credentials',
    'get-caller-identity',
    'images',
    'info',
    'inspect',
    'kill',
    'list-profiles',
    'login',
    'logs',
    'ps',
    'pull',
    'restart',
    'rm',
    'run',
    'secret',
    'sso',
    'start',
    'stop',
    'sts',
    'up',
    'version',
]);

/** Names the program and up to two known verbs; paths and values are never logged. */
export function processFields(
    command: string,
    args: readonly string[],
): LogFields {
    const name = command.split(/[\\/]/).pop() ?? '';
    return {
        command: name,
        subcommand: args
            .filter((arg) => commandVerbs.has(arg))
            .slice(0, 2)
            .join(' '),
    };
}

function stringIn(allowed: ReadonlySet<string>): (value: unknown) => boolean {
    return (value) => typeof value === 'string' && allowed.has(value);
}

function stringAmong(allowed: readonly string[]): (value: unknown) => boolean {
    return (value) => typeof value === 'string' && allowed.includes(value);
}

function finiteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

const logCategories = ['aws', 'registry', 'live', 'config'];
const logSignals = ['SIGINT', 'SIGTERM', 'SIGKILL'];

const fieldChecks: Record<string, (value: unknown) => boolean> = {
    durationMs: finiteNumber,
    code: finiteNumber,
    count: finiteNumber,
    enabled: (value) => typeof value === 'boolean',
    development: (value) => typeof value === 'boolean',
    status: stringIn(statuses),
    previousStatus: stringIn(statuses),
    category: stringAmong(logCategories),
    signal: stringAmong(logSignals),
    setting: stringAmong(settingKeys as readonly string[]),
    command: (value) =>
        typeof value === 'string' && /^[A-Za-z][\w.-]{0,39}$/.test(value),
    subcommand: (value) =>
        typeof value === 'string' &&
        !!value &&
        value.split(' ').every((verb) => commandVerbs.has(verb)),
    revision: (value) =>
        typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    service: (value) =>
        typeof value === 'string' && /^[a-z][a-z0-9-]{0,99}$/.test(value),
};

export function safeFields(fields: LogFields): LogFields {
    const result: LogFields = {};
    for (const [key, value] of Object.entries(fields)) {
        if (fieldChecks[key]?.(value)) result[key] = value;
    }
    return result;
}

export class TuiLog {
    readonly session = randomUUID();
    readonly path: string;
    private context = new AsyncLocalStorage<string>();
    private listeners = new Set<() => void>();
    private transitions = new Map<string, string>();
    private snapshot = {
        lines: [] as string[],
        sequence: 0,
        failure: '',
        path: '',
    };
    constructor(
        directory: string,
        private filesystem = fs,
        private maxBytes = 5 * 1024 * 1024,
        private warn = (message: string) => {
            process.stderr.write(`${message}\n`);
        },
    ) {
        const logDirectory = directory;
        this.path = join(logDirectory, 'tui.log');
        filesystem.mkdirSync(logDirectory, {
            recursive: true,
            mode: 0o700,
        });
        if (!filesystem.lstatSync(logDirectory).isDirectory())
            throw new Error(
                'Cannot initialize TUI logging: unsafe log directory.',
            );
        this.snapshot.path = this.path;
        try {
            this.append('');
        } catch {
            throw new Error(
                'Cannot initialize TUI logging. Check log permissions and free space.',
            );
        }
    }
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    getSnapshot = () => this.snapshot;
    correlation = () => ({
        CHS_DEV_LOG_SESSION: this.session,
        ...(this.context.getStore()
            ? { CHS_DEV_LOG_OPERATION: this.context.getStore()! }
            : {}),
    });
    scope<T>(work: () => T): T {
        return this.context.run(randomUUID(), work);
    }
    private append(line: string) {
        const io = this.filesystem;
        const inspect = (path: string) => {
            try {
                const info = io.lstatSync(path);
                if (!info.isFile() || info.nlink !== 1)
                    throw new Error('Unsafe log file');
                return info;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return undefined;
                throw error;
            }
        };
        const active = inspect(this.path);
        if (active && active.size + Buffer.byteLength(line) > this.maxBytes) {
            inspect(`${this.path}.1`);
            if (inspect(`${this.path}.2`)) io.unlinkSync(`${this.path}.2`);
            if (inspect(`${this.path}.1`))
                io.renameSync(`${this.path}.1`, `${this.path}.2`);
            io.renameSync(this.path, `${this.path}.1`);
        }
        const fd = io.openSync(
            this.path,
            fs.constants.O_WRONLY |
                fs.constants.O_APPEND |
                fs.constants.O_CREAT |
                fs.constants.O_NOFOLLOW |
                fs.constants.O_NONBLOCK,
            0o600,
        );
        try {
            const info = io.fstatSync(fd);
            if (!info.isFile() || info.nlink !== 1)
                throw new Error('Unsafe log file');
            io.fchmodSync(fd, 0o600);
            io.writeFileSync(fd, line);
        } finally {
            io.closeSync(fd);
        }
    }
    write(event: LogEvent, fields: LogFields = {}) {
        if (!events.includes(event)) return;
        const line = JSON.stringify({
            time: new Date().toISOString(),
            source: 'tui',
            session: this.session,
            operation: this.context.getStore(),
            event,
            ...safeFields(fields),
        });
        let failure = this.snapshot.failure;
        try {
            this.append(`${line}\n`);
            failure = '';
        } catch {
            failure =
                'TUI logging failed; operation results are unchanged. Check permissions and free space.';
            if (!this.snapshot.failure) {
                try {
                    this.warn(failure);
                } catch {
                    // The Logs view still exposes the failure if stderr is unavailable.
                }
            }
        }
        this.snapshot = {
            path: this.path,
            failure,
            sequence: this.snapshot.sequence + 1,
            lines: [...this.snapshot.lines.slice(-499), line],
        };
        for (const listener of this.listeners) listener();
    }
    transition(event: LogEvent, status: string) {
        if (this.transitions.get(event) === status) return;
        this.transitions.set(event, status);
        this.write(event, { status });
    }
    async operation<T>(
        event: LogEvent,
        fields: LogFields,
        work: () => Promise<T>,
    ): Promise<T> {
        return this.context.run(randomUUID(), async () => {
            const start = Date.now();
            this.write(event, { ...fields, status: 'start' });
            try {
                const result = await work();
                this.write(event, {
                    ...fields,
                    status: 'success',
                    durationMs: Date.now() - start,
                });
                return result;
            } catch (error) {
                this.write(event, {
                    ...fields,
                    status: 'failed',
                    durationMs: Date.now() - start,
                });
                throw error;
            }
        });
    }
}
export let tuiLog: TuiLog | undefined;
/** Logs to `directory/tui.log`, normally the project's state directory. */
export function initializeTuiLog(directory: string) {
    const logger = new TuiLog(directory);
    logger.write('startup', { status: 'start' });
    if (logger.getSnapshot().failure)
        throw new Error(
            'Cannot initialize TUI logging. Check permissions and free space.',
        );
    tuiLog = logger;
    return tuiLog;
}
