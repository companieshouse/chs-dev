import type { Client } from './client.js';
import { openEvents, requestJson } from './connection.js';
import type { OperationResult } from '../domain/runtime-strategy.js';
import { ClientError, type CommandMap } from '../protocol/types.js';

function failureResult(
    error: unknown,
    kind: 'authentication.login' | 'project.clone',
): OperationResult {
    const cancelled =
        error instanceof ClientError && error.detail.code === 'CANCELLED';
    return {
        outcome: cancelled ? 'cancelled' : 'failed',
        message: cancelled
            ? kind === 'project.clone'
                ? 'Git clone cancelled.'
                : 'AWS login cancelled.'
            : error instanceof Error
              ? error.message
              : String(error),
    };
}

/** Command acceptance precedes creation of its interaction channel. */
async function waitForInteraction(client: Client, id: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = client.getSnapshot();
        if (snapshot.interaction?.id === id) break;
        const finished = snapshot.operations.find((o) => o.id === id);
        if (finished && !['queued', 'running'].includes(finished.state))
            return true;
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
    }
    return false;
}

/** Attach a terminal to a server-owned interaction; no runtime command runs in this client. */
export async function interact<
    K extends 'authentication.login' | 'project.clone',
>(
    client: Client,
    kind: K,
    args: CommandMap[K]['args'],
): Promise<OperationResult> {
    const operation = await client.submit(kind, args);
    let token: string | undefined;
    let closed = false;
    const waitAbort = new AbortController();
    const send = (input: Record<string, unknown>) => {
        if (!token || closed) return;
        void requestJson(
            client.socket,
            `/v1/interactions/${operation.id}/input`,
            'POST',
            { token, ...input },
        ).catch(() => {});
    };
    const cancel = () => {
        void client.cancel(operation.id).catch(() => {});
    };
    const input = (data: Buffer | string) => {
        const text = data.toString();
        if (text.includes('\x03')) cancel();
        else send({ data: text });
    };
    const resize = () =>
        send({
            columns: process.stdout.columns ?? 80,
            rows: process.stdout.rows ?? 24,
        });
    let closeStream: (() => void) | undefined;
    const previousRaw = process.stdin.isRaw;
    try {
        if (await waitForInteraction(client, operation.id))
            return (await client.wait(operation.id)) as OperationResult;
        closeStream = openEvents(
            client.socket,
            `/v1/interactions/${operation.id}`,
            (type, data) => {
                if (type === 'claim') {
                    token = data.token;
                    resize();
                } else if (type === 'output') process.stdout.write(data.text);
            },
            (error) => {
                if (!closed) {
                    waitAbort.abort(
                        error ?? new Error('Interactive connection closed.'),
                    );
                    cancel();
                }
            },
        );
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.on('data', input);
        process.stdout.on('resize', resize);
        process.on('SIGINT', cancel);
        return (await client.wait(
            operation.id,
            waitAbort.signal,
        )) as OperationResult;
    } catch (error) {
        return failureResult(error, kind);
    } finally {
        closed = true;
        closeStream?.();
        process.stdin.off('data', input);
        process.stdout.off('resize', resize);
        process.off('SIGINT', cancel);
        process.stdin.setRawMode?.(previousRaw ?? false);
        process.stdin.pause();
    }
}
