import { spawn, type ChildProcess } from 'node:child_process';
import { safeLog } from '../domain/live-logs.js';
import type { OperationContext } from '../domain/runtime-strategy.js';
import { guardedCommand } from './process-guard.js';
import { processFields, tuiLog } from './tui-log.js';

export interface ProcessRequest extends OperationContext {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout?: number;
    captureStdout?: boolean;
    /** Retain sanitized stderr for the caller even when output streaming is private. */
    captureStderr?: boolean;
    /** Capture machine output without streaming it or its diagnostics into logs. */
    privateOutput?: boolean;
    /** Stream private log output to its requesting client without diagnostic capture. */
    streamPrivateOutput?: boolean;
    /** Sent through a pipe; never included in process diagnostics. */
    stdin?: string | Buffer;
}
export interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
    registryAuthenticationFailed?: boolean;
}
export type ProcessExecutor = (
    request: ProcessRequest,
) => Promise<ProcessResult>;
export interface ProcessHost {
    spawn(
        request: ProcessRequest,
    ): Pick<ChildProcess, 'pid' | 'stdout' | 'stderr' | 'on'>;
    kill(pid: number, signal: NodeJS.Signals): void;
    schedule(callback: () => void, ms: number): () => void;
}
const host: ProcessHost = {
    spawn: (request) => {
        const program = guardedCommand(request.command, request.args);
        const child = spawn(program.command, program.args, {
            cwd: request.cwd,
            env: request.env,
            detached: true,
            stdio: [
                request.stdin === undefined ? 'ignore' : 'pipe',
                'pipe',
                'pipe',
            ],
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(request.stdin);
        return child;
    },
    kill: (pid, signal) => {
        try {
            process.kill(-pid, signal);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    },
    schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
};

interface ExecutionRun {
    request: ProcessRequest;
    platform: ProcessHost;
    child: ReturnType<ProcessHost['spawn']>;
    secrets: string[];
    described: ReturnType<typeof processFields>;
    started: number;
    stdout: string;
    stderr: string;
    registryAuthenticationFailed: boolean;
    failure?: Error;
    finished: boolean;
    cancelKill?: () => void;
    cancelTimeout?: () => void;
    pending: { stdout: string; stderr: string };
    discarding: { stdout: boolean; stderr: boolean };
    privateKey: { stdout: boolean; stderr: boolean };
}

function collectSecrets(env: NodeJS.ProcessEnv): string[] {
    return Object.entries(env)
        .filter(([key]) =>
            /credential|secret|token|password|private|access_key|(?:^|_)key(?:_|$)/i.test(
                key,
            ),
        )
        .map(([, value]) => value ?? '');
}

function killChild(run: ExecutionRun, signal: NodeJS.Signals): void {
    tuiLog?.write('process.signal', { signal });
    if (run.child.pid) {
        try {
            run.platform.kill(run.child.pid, signal);
        } catch (error) {
            run.failure = new Error(
                `Cannot terminate owned command: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}

function abortRun(run: ExecutionRun): void {
    if (run.finished || run.cancelKill) return;
    run.failure ??= new Error('Operation cancelled.');
    killChild(run, 'SIGTERM');
    run.cancelKill = run.platform.schedule(
        () => killChild(run, 'SIGKILL'),
        1500,
    );
}

function emitLine(
    run: ExecutionRun,
    stream: 'stdout' | 'stderr',
    text: string,
): void {
    const request = run.request;
    if (!shouldReadLine(request, stream)) return;
    if (/-----BEGIN .*PRIVATE KEY-----/.test(text))
        run.privateKey[stream] = true;
    const sanitized = run.privateKey[stream]
        ? '[REDACTED PRIVATE KEY]'
        : safeLog(text, run.secrets);
    if (/-----END .*PRIVATE KEY-----/.test(text))
        run.privateKey[stream] = false;
    if (stream === 'stderr')
        run.stderr = `${run.stderr}${sanitized}\n`.slice(-65536);
    if (shouldStreamLine(request))
        request.onOutput?.({ stream, text: sanitized });
}

function shouldStreamLine(request: ProcessRequest) {
    return !request.privateOutput || request.streamPrivateOutput;
}
function shouldReadLine(request: ProcessRequest, stream: 'stdout' | 'stderr') {
    return (
        shouldStreamLine(request) ||
        (stream === 'stderr' && request.captureStderr)
    );
}

function captureOutput(
    run: ExecutionRun,
    stream: 'stdout' | 'stderr',
    text: string,
) {
    const request = run.request;
    if (stream === 'stdout' && request.captureStdout !== false) {
        if (run.stdout.length + text.length > 8 * 1024 * 1024) {
            run.failure = new Error('Command output exceeded 8 MiB.');
            abortRun(run);
        } else run.stdout += text;
    }
}

function receiveChunk(
    run: ExecutionRun,
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string,
): void {
    const text = chunk.toString();
    if (
        stream === 'stderr' &&
        /unauthorized|authentication required|no basic auth credentials|authorization token has expired|403 Forbidden|pull access denied/i.test(
            text,
        )
    )
        run.registryAuthenticationFailed = true;
    captureOutput(run, stream, text);
    run.pending[stream] += text;
    const lines = run.pending[stream].split(/\r\n|\n|\r/);
    run.pending[stream] = lines.pop() ?? '';
    for (const line of lines) {
        if (run.discarding[stream]) run.discarding[stream] = false;
        else emitLine(run, stream, line);
    }
    if (run.pending[stream].length > 16384) {
        if (/-----BEGIN .*PRIVATE KEY-----/.test(run.pending[stream]))
            run.privateKey[stream] = true;
        emitLine(run, stream, '[Oversized output line truncated]');
        run.pending[stream] = '';
        run.discarding[stream] = true;
    }
}

function closeStatus(run: ExecutionRun, code: number | null) {
    return run.request.signal?.aborted
        ? 'cancelled'
        : run.failure || code !== 0
          ? 'failed'
          : 'success';
}

function closeResult(run: ExecutionRun, code: number | null): ProcessResult {
    return {
        code: code ?? -1,
        stdout: run.stdout,
        stderr: run.stderr,
        ...(run.registryAuthenticationFailed
            ? { registryAuthenticationFailed: true }
            : {}),
    };
}

function runOwnedProcess(
    run: ExecutionRun,
    resolve: (result: ProcessResult) => void,
    reject: (error: Error) => void,
): void {
    const { request } = run;
    const abort = () => abortRun(run);
    if (request.timeout !== 0)
        run.cancelTimeout = run.platform.schedule(
            () => {
                tuiLog?.write('process.timeout');
                run.failure = new Error('Command timed out.');
                abortRun(run);
            },
            request.timeout ?? 30 * 60 * 1000,
        );
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        tuiLog?.write('process', {
            ...run.described,
            status: closeStatus(run, code),
            code,
            signal,
            durationMs: Date.now() - run.started,
        });
        run.finished = true;
        if (run.cancelKill) killChild(run, 'SIGKILL');
        run.cancelKill?.();
        run.cancelTimeout?.();
        request.signal?.removeEventListener('abort', abort);
        for (const stream of ['stdout', 'stderr'] as const) {
            if (run.pending[stream] && !run.discarding[stream])
                emitLine(run, stream, run.pending[stream]);
        }
        if (run.failure) reject(run.failure);
        else resolve(closeResult(run, code));
    };
    run.child.stdout?.setEncoding('utf8');
    run.child.stderr?.setEncoding('utf8');
    run.child.stdout?.on('data', (chunk: Buffer | string) =>
        receiveChunk(run, 'stdout', chunk),
    );
    run.child.stderr?.on('data', (chunk: Buffer | string) =>
        receiveChunk(run, 'stderr', chunk),
    );
    run.child.on('error', (error: Error) => {
        tuiLog?.write('process', { ...run.described, status: 'failed' });
        run.failure = error;
    });
    run.child.on('close', onClose);
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abortRun(run);
}

export function createProcessExecutor(
    platform: ProcessHost = host,
): ProcessExecutor {
    return (request) =>
        new Promise((resolve, reject) => {
            if (request.signal?.aborted) {
                reject(new Error('Operation cancelled.'));
                return;
            }
            const started = Date.now();
            const described = processFields(
                request.command,
                request.privateOutput ? ['[private operation]'] : request.args,
            );
            tuiLog?.write('process', { ...described, status: 'start' });
            let child: ReturnType<ProcessHost['spawn']>;
            try {
                child = platform.spawn(request);
            } catch (error) {
                tuiLog?.write('process', {
                    ...described,
                    status: 'failed',
                    durationMs: Date.now() - started,
                });
                reject(error);
                return;
            }
            runOwnedProcess(
                {
                    request,
                    platform,
                    child,
                    secrets: collectSecrets(request.env),
                    described,
                    started,
                    stdout: '',
                    stderr: '',
                    registryAuthenticationFailed: false,
                    finished: false,
                    pending: { stdout: '', stderr: '' },
                    discarding: { stdout: false, stderr: false },
                    privateKey: { stdout: false, stderr: false },
                },
                resolve,
                reject,
            );
        });
}
