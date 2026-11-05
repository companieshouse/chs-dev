import {
    spawn,
    type ChildProcess,
    type SpawnOptions,
} from 'node:child_process';
import type { OperationResult } from '../domain/runtime-strategy.js';
import { safeLog } from '../domain/live-logs.js';
import { processFields, tuiLog } from './tui-log.js';
import { interactiveRunner } from './interactive-context.js';

export interface InteractiveCommandDependencies {
    spawn: (
        command: string,
        args: string[],
        options: SpawnOptions,
    ) => ChildProcess;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

export interface InteractiveCommandRequest {
    command: string;
    args: string[];
    label: string;
    missingMessage: string;
    signal?: AbortSignal;
    dependencies?: InteractiveCommandDependencies;
    environment?: NodeJS.ProcessEnv;
}

const defaultDependencies: InteractiveCommandDependencies = {
    spawn: (command, args, options) => spawn(command, args, options),
    stdout: (text) => {
        process.stdout.write(text);
    },
    stderr: (text) => {
        process.stderr.write(text);
    },
};

function secretValues(environment: NodeJS.ProcessEnv): string[] {
    return Object.entries(environment)
        .filter(([name]) => /secret|token|password|access_key/i.test(name))
        .flatMap(([, value]) => (value ? [value] : []));
}

function startChild(
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    dependencies: InteractiveCommandDependencies,
): ChildProcess {
    return dependencies.spawn(command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
            ...environment,
            AWS_PAGER: '',
            AWS_CLI_AUTO_PROMPT: 'off',
            NO_PAGER: '1',
        },
    });
}

function startFailure(
    error: NodeJS.ErrnoException,
    label: string,
    missingMessage: string,
    secrets: string[],
): string {
    return error.code === 'ENOENT'
        ? missingMessage
        : `Unable to start ${label}: ${safeLog(error.message, secrets)}`;
}

function closedStatus(
    interrupted: boolean,
    signalName: string | null,
    code: number | null,
) {
    return interrupted || signalName === 'SIGINT' || code === 130
        ? 'cancelled'
        : code === 0
          ? 'success'
          : 'failed';
}

function closeOutcome(context: {
    label: string;
    output: string;
    secrets: string[];
    interrupted: boolean;
    code: number | null;
    signalName: string | null;
}): OperationResult {
    const { label, output, secrets, interrupted, code, signalName } = context;
    const status = closedStatus(interrupted, signalName, code);
    if (status === 'cancelled')
        return { outcome: 'cancelled', message: `${label} cancelled.` };
    if (status === 'success')
        return { outcome: 'success', message: `${label} completed.` };
    const detail = safeLog(output, secrets, 16 * 1024)
        .trim()
        .split(/\r?\n/)
        .slice(-6)
        .join('\n')
        .slice(-2000);
    return {
        outcome: 'failed',
        message: `${label} failed (exit ${code ?? signalName ?? 'unknown'}).${detail ? `\n${detail}` : ' The command produced no output.'}`,
    };
}

function attachOutput(
    child: ReturnType<typeof startChild>,
    record: (text: string, write: (text: string) => void) => void,
    dependencies: InteractiveCommandRequest['dependencies'],
) {
    if (!dependencies) return;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) =>
        record(text, dependencies.stdout),
    );
    child.stderr?.on('data', (text: string) =>
        record(text, dependencies.stderr),
    );
}

export function runInteractiveCommand({
    command,
    args,
    label,
    missingMessage,
    signal,
    dependencies = defaultDependencies,
    environment = process.env,
}: InteractiveCommandRequest): Promise<OperationResult> {
    const runner = interactiveRunner();
    if (runner)
        return runner({
            command,
            args,
            label,
            missingMessage,
            signal,
            environment,
        });
    if (signal?.aborted)
        return Promise.resolve({
            outcome: 'cancelled',
            message: `${label} cancelled.`,
        });
    return runChildCommand({
        command,
        args,
        label,
        missingMessage,
        signal,
        dependencies,
        environment,
    });
}
function runChildCommand({
    command,
    args,
    label,
    missingMessage,
    signal,
    dependencies = defaultDependencies,
    environment = process.env,
}: InteractiveCommandRequest): Promise<OperationResult> {
    return new Promise((resolve) => {
        const started = Date.now();
        const described = processFields(command, args);
        tuiLog?.write('process', { ...described, status: 'start' });
        let interrupted = false;
        let output = '';
        const secrets = secretValues(environment);
        const child = startChild(command, args, environment, dependencies);
        const record = (text: string, write: (text: string) => void) => {
            write(text);
            output = (output + text).slice(-16 * 1024);
        };
        attachOutput(child, record, dependencies);
        // The child owns the terminal while Ink is suspended. Ctrl+C cancels login
        // without terminating the parent TUI.
        const interrupt = () => {
            tuiLog?.write('process.signal', { signal: 'SIGINT' });
            interrupted = true;
            child.kill('SIGINT');
        };
        process.on('SIGINT', interrupt);
        signal?.addEventListener('abort', interrupt, { once: true });
        const cleanup = () => {
            process.off('SIGINT', interrupt);
            signal?.removeEventListener('abort', interrupt);
        };
        child.once('error', (error: NodeJS.ErrnoException) => {
            tuiLog?.write('process', {
                ...described,
                status: 'failed',
                durationMs: Date.now() - started,
            });
            cleanup();
            resolve({
                outcome: 'failed',
                message: startFailure(error, label, missingMessage, secrets),
            });
        });
        child.once('close', (code, closeSignal) => {
            tuiLog?.write('process', {
                ...described,
                code,
                signal: closeSignal,
                durationMs: Date.now() - started,
                status: closedStatus(interrupted, closeSignal, code),
            });
            cleanup();
            resolve(
                closeOutcome({
                    label,
                    output,
                    secrets,
                    interrupted,
                    code,
                    signalName: closeSignal,
                }),
            );
        });
    });
}
