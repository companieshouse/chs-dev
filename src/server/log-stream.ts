import type { ServerResponse } from 'node:http';
import type { ProjectSession } from '../application/project-session.js';
import { ClientError, type LogRequest } from '../protocol/types.js';
import { safeLog } from '../domain/live-logs.js';

function send(response: ServerResponse, type: string, data: unknown) {
    if (response.destroyed) throw new Error('Log subscriber disconnected.');
    if (response.writableLength > 4 * 1024 * 1024) {
        response.destroy();
        throw new Error('Log subscriber is too slow.');
    }
    response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function environmentLogs(
    application: ProjectSession,
    request: LogRequest,
    signal: AbortSignal,
    receive: (entry: { text: string }) => void,
) {
    const state = application.snapshot();
    const initial =
        request.tail === 'all'
            ? state.live.logs
            : request.tail === 0
              ? []
              : state.live.logs.slice(-request.tail);
    for (const text of initial) receive({ text });
    if (!request.follow) return Promise.resolve();
    let cursor = state.live.logSequence;
    return new Promise<void>((resolve, reject) => {
        const stop = (error?: Error) => {
            unsubscribe();
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve();
        };
        const refresh = () => {
            const next = application.snapshot();
            if (next.scope.generation !== request.scope.generation)
                return stop(
                    new ClientError({
                        code: 'STALE_PROJECT',
                        message:
                            'The active checkout changed. Reopen the log stream.',
                    }),
                );
            const from = next.live.logSequence - next.live.logs.length;
            if (cursor < from)
                return stop(
                    new ClientError({
                        code: 'LOG_GAP',
                        message: 'Log history expired. Reopen the log stream.',
                    }),
                );
            for (const text of next.live.logs.slice(Math.max(0, cursor - from)))
                receive({ text });
            cursor = next.live.logSequence;
        };
        const changed = () => {
            try {
                refresh();
            } catch (error) {
                stop(error instanceof Error ? error : new Error(String(error)));
            }
        };
        const unsubscribe = application.subscribe(changed);
        const abort = () => stop();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

export async function handleLogStream(options: {
    application: ProjectSession;
    request: LogRequest;
    response: ServerResponse;
    signal: AbortSignal;
    streams: Set<ServerResponse>;
}) {
    const { application, request, response, signal, streams } = options;
    const run = await application.prepareLogStream(request, signal);
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
    });
    response.flushHeaders();
    streams.add(response);
    const heartbeat = setInterval(
        () => response.write(': heartbeat\n\n'),
        15000,
    );
    const receive = (entry: { service?: string; text: string }) =>
        send(response, 'line', entry);
    try {
        if (run) await run(receive);
        else await environmentLogs(application, request, signal, receive);
        if (!signal.aborted && !response.destroyed) send(response, 'done', {});
    } catch (error) {
        if (!signal.aborted && !response.destroyed)
            send(
                response,
                'error',
                error instanceof ClientError
                    ? error.detail
                    : {
                          code: 'LOG_STREAM_FAILED',
                          message: safeLog(String(error)),
                      },
            );
    } finally {
        clearInterval(heartbeat);
        streams.delete(response);
        response.end();
    }
}
