import { guardedCommand } from './process-guard.js';
import { spawn } from 'node-pty';
import type { TerminalFactory } from '../application/interactions.js';

export const createTerminal: TerminalFactory = async (request, output) => {
    request.signal?.throwIfAborted();
    const program = guardedCommand(request.command, request.args);
    const child = spawn(program.command, program.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: {
            ...request.environment,
            AWS_PAGER: '',
            AWS_CLI_AUTO_PROMPT: 'off',
            NO_PAGER: '1',
        },
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const kill = () => {
        if (finished) return;
        try {
            child.kill('SIGTERM');
        } catch {}
        killTimer ??= setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {}
        }, 1500);
    };
    const data = child.onData(output);
    request.signal?.addEventListener('abort', kill, { once: true });
    const result = new Promise<
        import('../domain/runtime-strategy.js').OperationResult
    >((resolve) => {
        child.onExit(({ exitCode, signal }) => {
            finished = true;
            clearTimeout(killTimer);
            data.dispose();
            request.signal?.removeEventListener('abort', kill);
            const cancelled =
                request.signal?.aborted || signal === 2 || exitCode === 130;
            resolve({
                outcome: cancelled
                    ? 'cancelled'
                    : exitCode === 0
                      ? 'success'
                      : 'failed',
                message: cancelled
                    ? `${request.label} cancelled.`
                    : exitCode === 0
                      ? `${request.label} completed.`
                      : `${request.label} failed (exit ${exitCode}). See the terminal output for details.`,
            });
        });
    });
    return {
        write: (data) => child.write(data),
        resize: (columns, rows) => child.resize(columns, rows),
        kill,
        result,
    };
};
