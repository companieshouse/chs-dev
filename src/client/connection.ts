import { request, type IncomingMessage } from 'node:http';
import { EventDecoder, type EventHandler } from './event-stream.js';
import { ClientError } from '../protocol/types.js';

type JsonCompletion<T> = {
    resolve(value: T): void;
    reject(error: Error): void;
};
function completeJsonResponse<T>(
    status: number,
    contents: string,
    completion: JsonCompletion<T>,
) {
    try {
        const value = JSON.parse(contents);
        if (status >= 400)
            completion.reject(
                new ClientError(
                    value.error ?? {
                        code: 'DAEMON_ERROR',
                        message: 'Daemon request failed.',
                    },
                ),
            );
        else completion.resolve(value as T);
    } catch {
        completion.reject(
            new Error('The daemon returned an invalid response.'),
        );
    }
}
function readJsonResponse<T>(
    res: IncomingMessage,
    completion: JsonCompletion<T>,
    cancel: (error: Error) => void,
) {
    let contents = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
        contents += chunk;
        if (contents.length > 32 * 1024 * 1024)
            cancel(new Error('Daemon response is too large.'));
    });
    res.on('error', completion.reject);
    res.on('end', () =>
        completeJsonResponse(res.statusCode ?? 500, contents, completion),
    );
}
function readEventResponse(
    res: IncomingMessage,
    onEvent: EventHandler,
    close: (error?: Error) => void,
) {
    if (res.statusCode !== 200) {
        readJsonResponse(
            res,
            {
                resolve: () =>
                    close(
                        new Error(
                            `Cannot subscribe to daemon events: HTTP ${res.statusCode}.`,
                        ),
                    ),
                reject: (error) =>
                    close(
                        error instanceof ClientError
                            ? error
                            : new Error(
                                  `Cannot subscribe to daemon events: HTTP ${res.statusCode}.`,
                              ),
                    ),
            },
            (error) => res.destroy(error),
        );
        return;
    }
    const decoder = new EventDecoder(onEvent);
    res.setEncoding('utf8');
    res.setTimeout(45000, () =>
        res.destroy(new Error('Daemon event stream timed out.')),
    );
    res.on('data', (chunk: string) => {
        try {
            decoder.push(chunk);
        } catch (error) {
            res.destroy(
                error instanceof Error ? error : new Error('Invalid event.'),
            );
        }
    });
    res.on('end', () => close());
    res.on('error', close);
}

export function requestJson<T>(
    socket: string,
    path: string,
    method = 'GET',
    value?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const body = value === undefined ? undefined : JSON.stringify(value);
        const req = request(
            {
                socketPath: socket,
                path,
                method,
                signal,
                headers: {
                    ...(body
                        ? {
                              'content-type': 'application/json',
                              'content-length': Buffer.byteLength(body),
                          }
                        : {}),
                },
            },
            (res) =>
                readJsonResponse(res, { resolve, reject }, (error) =>
                    req.destroy(error),
                ),
        );
        req.setTimeout(60000, () =>
            req.destroy(new Error('Daemon request timed out.')),
        );
        req.on('error', reject);
        req.end(body);
    });
}
export function openEvents(
    socket: string,
    path: string,
    onEvent: EventHandler,
    onClose: (error?: Error) => void,
    options?: string | { body: unknown },
) {
    let closed = false;
    const close = (error?: Error) => {
        if (closed) return;
        closed = true;
        onClose(error);
    };
    const req = request(
        {
            socketPath: socket,
            path,
            method: typeof options === 'object' ? 'POST' : 'GET',
            headers:
                typeof options === 'string'
                    ? { 'last-event-id': options }
                    : eventBodyHeaders(options),
        },
        (res) => readEventResponse(res, onEvent, close),
    );
    req.on('error', (error) => close(error));
    req.end(
        typeof options === 'object' ? JSON.stringify(options.body) : undefined,
    );
    return () => {
        closed = true;
        req.destroy();
    };
}
function eventBodyHeaders(options?: string | { body: unknown }) {
    if (typeof options !== 'object') return {};
    return {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(JSON.stringify(options.body)),
    };
}
