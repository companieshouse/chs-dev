import { openEvents } from './connection.js';
import { ClientError, type LogRequest } from '../protocol/types.js';

export function streamLogs(
    socket: string,
    request: LogRequest,
    receive: (entry: { service?: string; text: string }) => void,
    signal: AbortSignal,
) {
    return new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
            signal.removeEventListener('abort', abort);
            close();
            if (error) reject(error);
            else resolve();
        };
        const abort = () => finish(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        const close = openEvents(
            socket,
            '/v1/logs/stream',
            (type, data) => {
                if (type === 'line') receive(data);
                if (type === 'done') finish();
                if (type === 'error') finish(new ClientError(data));
            },
            (error) =>
                finish(error ?? new Error('The log stream disconnected.')),
            { body: request },
        );
        if (signal.aborted) abort();
    });
}
