import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import { exclusiveLease } from '../infrastructure/daemon-state.js';
import { safeLog } from '../domain/live-logs.js';
import {
    commandRequest,
    queryRequest,
    object,
    string,
    invalid,
    logRequest,
} from '../protocol/schemas.js';
import { handleLogStream } from './log-stream.js';
import {
    ClientError,
    protocolVersion,
    type SessionSnapshot,
    type StateEvent,
} from '../protocol/types.js';
import type { ProjectSession } from '../application/project-session.js';
import type { Operations } from '../application/operations.js';

function json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(value ?? null));
}
async function body(request: IncomingMessage) {
    if (!request.headers['content-type']?.startsWith('application/json'))
        invalid('Use application/json.');
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) invalid('Request is too large.');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        invalid('Invalid JSON.');
    }
}
function streamHeaders(response: ServerResponse) {
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
    });
    response.flushHeaders();
}
function stream(
    response: ServerResponse,
    type: string,
    data: unknown,
    id?: string,
) {
    if (response.destroyed) return;
    if (response.writableLength > 4 * 1024 * 1024) {
        response.destroy();
        return;
    }
    response.write(
        `${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
    );
}
async function assertPrivateDirectory(socket: string) {
    await mkdir(dirname(socket), { recursive: true, mode: 0o700 });
    const directory = await lstat(dirname(socket));
    if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        directory.uid !== process.getuid?.() ||
        directory.mode & 0o077
    )
        throw new Error(
            'Daemon socket directory must be private and owned by the current user.',
        );
}
async function removeStaleSocket(socket: string) {
    const previous = await lstat(socket).catch(
        (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        },
    );
    if (previous) {
        if (!previous.isSocket() || previous.uid !== process.getuid?.())
            throw new Error('Refusing to replace an unexpected daemon socket.');
        await rm(socket);
    }
}
type EventHub = ReturnType<typeof createEventHub>;
type ApiContext = {
    application: ProjectSession;
    operations: Operations;
    hub: EventHub;
    shutdown?: () => Promise<void>;
};
function createEventHub(application: ProjectSession) {
    const subscribers = new Set<ServerResponse>();
    const streams = new Set<ServerResponse>();
    const logTasks = new Set<Promise<void>>();
    const history: { id: string; event: StateEvent; bytes: number }[] = [];
    let retained = 0,
        sequence = 0,
        lastLog = 0,
        lastGeneration = '';
    let pending: ReturnType<typeof setTimeout> | undefined;
    const cursor = () => `${application.snapshot().daemonId}:${sequence}`;
    const publish = () => {
        pending = undefined;
        const snapshot = application.snapshot();
        const live = snapshot.live;
        if (
            lastGeneration !== snapshot.scope.generation ||
            live.logSequence < lastLog
        )
            lastLog = 0;
        const from = Math.max(lastLog, live.logSequence - live.logs.length);
        const event: StateEvent = {
            snapshot: { ...snapshot, live: { ...live, logs: [] } },
            logFrom: from,
            logLines: live.logs.slice(
                Math.max(0, from - (live.logSequence - live.logs.length)),
            ),
        };
        lastLog = live.logSequence;
        lastGeneration = snapshot.scope.generation;
        sequence++;
        const item = {
            id: cursor(),
            event,
            bytes: Buffer.byteLength(JSON.stringify(event)),
        };
        history.push(item);
        retained += item.bytes;
        while (history.length > 256 || retained > 4 * 1024 * 1024)
            retained -= history.shift()!.bytes;
        for (const response of subscribers)
            stream(response, 'state', event, item.id);
    };
    const flush = () => {
        if (pending) {
            clearTimeout(pending);
            publish();
        }
    };
    const cancelPending = () => {
        if (pending) clearTimeout(pending);
    };
    const unsubscribe = application.subscribe(() => {
        pending ??= setTimeout(publish, 50);
    });
    return {
        subscribers,
        streams,
        logTasks,
        history,
        cursor,
        flush,
        cancelPending,
        unsubscribe,
    };
}
function startHeartbeat(response: ServerResponse, onClose: () => void) {
    const keepAlive = setInterval(
        () => response.write(': heartbeat\n\n'),
        15000,
    );
    response.on('close', () => {
        clearInterval(keepAlive);
        onClose();
    });
}
function notFound(response: ServerResponse) {
    json(response, 404, {
        error: {
            code: 'NOT_FOUND',
            message: 'Unknown daemon endpoint.',
        },
    });
}
function handleEvents(
    request: IncomingMessage,
    response: ServerResponse,
    ctx: ApiContext,
) {
    const { hub, application } = ctx;
    hub.flush();
    streamHeaders(response);
    hub.subscribers.add(response);
    hub.streams.add(response);
    const after = request.headers['last-event-id'];
    const index = hub.history.findIndex((e) => e.id === after);
    if (index >= 0)
        for (const item of hub.history.slice(index + 1))
            stream(response, 'state', item.event, item.id);
    else stream(response, 'snapshot', application.snapshot(), hub.cursor());
    startHeartbeat(response, () => {
        hub.subscribers.delete(response);
        hub.streams.delete(response);
    });
}
async function handleCommand(
    request: IncomingMessage,
    response: ServerResponse,
    ctx: ApiContext,
) {
    const command = commandRequest(await body(request));
    const operation = await ctx.operations.submit(
        command,
        () => ctx.application.validate(command),
        (signal, id) => ctx.application.execute(command, signal, id),
    );
    json(response, 202, operation);
}
async function handleQuery(
    request: IncomingMessage,
    response: ServerResponse,
    abort: AbortController,
    ctx: ApiContext,
) {
    const query = queryRequest(await body(request));
    json(response, 200, await ctx.application.query(query, abort.signal));
}
function handleOperation(
    request: IncomingMessage,
    response: ServerResponse,
    ctx: ApiContext,
    match: RegExpExecArray,
) {
    const id = match[1]!;
    if (request.method === 'GET' && !match[2])
        return json(response, 200, ctx.operations.get(id));
    if (request.method === 'POST' && match[2]) {
        ctx.operations.cancel(id);
        return json(response, 200, ctx.operations.get(id));
    }
    return notFound(response);
}
function handleInteraction(
    request: IncomingMessage,
    response: ServerResponse,
    ctx: ApiContext,
    match: RegExpExecArray,
) {
    const id = match[1]!;
    if (request.method === 'GET' && !match[2])
        return claimInteraction(response, ctx, id);
    if (request.method === 'POST' && match[2])
        return handleInteractionInput(request, response, ctx, id);
    return notFound(response);
}
function claimInteraction(
    response: ServerResponse,
    ctx: ApiContext,
    id: string,
) {
    const claim = ctx.application.interactions.claim(id, (text) =>
        stream(response, 'output', { text }),
    );
    streamHeaders(response);
    ctx.hub.streams.add(response);
    stream(response, 'claim', { token: claim.token });
    startHeartbeat(response, () => {
        ctx.hub.streams.delete(response);
        claim.release();
    });
    claim.ready();
}
async function handleInteractionInput(
    request: IncomingMessage,
    response: ServerResponse,
    ctx: ApiContext,
    id: string,
) {
    const input = object(await body(request));
    string(input.token, 128);
    if (
        input.data !== undefined &&
        (typeof input.data !== 'string' || input.data.length > 65536)
    )
        invalid('Invalid terminal input.');
    for (const key of ['columns', 'rows'])
        if (
            input[key] !== undefined &&
            (!Number.isInteger(input[key]) ||
                Number(input[key]) < 1 ||
                Number(input[key]) > 1000)
        )
            invalid('Invalid terminal dimensions.');
    ctx.application.interactions.input(
        id,
        input.token as string,
        input.data as string | undefined,
        input.columns as number | undefined,
        input.rows as number | undefined,
    );
    json(response, 200, {});
}
function handleShutdown(
    response: ServerResponse,
    shutdown: () => Promise<void>,
) {
    json(response, 202, {});
    void shutdown().catch((error) => {
        console.error(
            safeLog(error instanceof Error ? error.message : String(error)),
        );
        process.exitCode = 1;
    });
}
function rejectBrowserOrigin(request: IncomingMessage) {
    if (request.headers.origin)
        throw new ClientError({
            code: 'FORBIDDEN',
            message: 'Browser-origin requests are not supported.',
        });
}

async function routeRequest(
    request: IncomingMessage,
    response: ServerResponse,
    abort: AbortController,
    ctx: ApiContext,
) {
    rejectBrowserOrigin(request);
    const path = requestPath(request);
    const route = `${request.method} ${path}`;
    if (route === 'GET /v1/session')
        return json(response, 200, ctx.application.snapshot());
    if (route === 'GET /v1/events') return handleEvents(request, response, ctx);
    if (route === 'POST /v1/commands')
        return handleCommand(request, response, ctx);
    if (route === 'POST /v1/queries')
        return handleQuery(request, response, abort, ctx);
    if (route === 'POST /v1/logs/stream')
        return handleLogs(request, response, abort, ctx);
    const operation = /^\/v1\/operations\/([a-zA-Z0-9-]+)(\/cancel)?$/.exec(
        path,
    );
    if (operation) return handleOperation(request, response, ctx, operation);
    const interaction = /^\/v1\/interactions\/([a-zA-Z0-9-]+)(\/input)?$/.exec(
        path,
    );
    if (interaction)
        return handleInteraction(request, response, ctx, interaction);
    if (route === 'POST /v1/shutdown' && ctx.shutdown)
        return handleShutdown(response, ctx.shutdown);
    return notFound(response);
}
function requestPath(request: IncomingMessage) {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
}
async function handleLogs(
    request: IncomingMessage,
    response: ServerResponse,
    abort: AbortController,
    ctx: ApiContext,
) {
    const task = handleLogStream({
        application: ctx.application,
        request: logRequest(await body(request)),
        response,
        signal: abort.signal,
        streams: ctx.hub.streams,
    });
    ctx.hub.logTasks.add(task);
    try {
        await task;
    } finally {
        ctx.hub.logTasks.delete(task);
    }
}
const errorStatus: Record<string, number> = {
    NOT_FOUND: 404,
    PROTOCOL_MISMATCH: 426,
    INVALID_REQUEST: 400,
};
function respondError(response: ServerResponse, error: unknown) {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    const detail =
        error instanceof ClientError
            ? error.detail
            : {
                  code: 'REQUEST_FAILED',
                  message: safeLog(
                      error instanceof Error ? error.message : String(error),
                  ),
              };
    json(response, errorStatus[detail.code] ?? 409, { error: detail });
}
export async function listenApi(
    socket: string,
    application: ProjectSession,
    operations: Operations,
    shutdown?: () => Promise<void>,
) {
    await assertPrivateDirectory(socket);
    const release = await exclusiveLease(`${socket}.lock`);
    try {
        await removeStaleSocket(socket);
    } catch (error) {
        await release();
        throw error;
    }
    const hub = createEventHub(application);
    const server = createServer(async (request, response) => {
        const abort = new AbortController();
        response.on('close', () => abort.abort());
        try {
            await routeRequest(request, response, abort, {
                application,
                operations,
                hub,
                shutdown,
            });
        } catch (error) {
            respondError(response, error);
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    try {
        server.listen(socket);
        await once(server, 'listening');
        await chmod(socket, 0o600);
    } catch (error) {
        hub.unsubscribe();
        await release();
        throw error;
    }
    return {
        socket,
        close: async () => {
            hub.unsubscribe();
            hub.cancelPending();
            for (const response of hub.streams) response.end();
            await Promise.allSettled(hub.logTasks);
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
            await release();
        },
    };
}
