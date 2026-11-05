import { randomUUID } from 'node:crypto';
import {
    ClientError,
    operationFinished,
    protocolVersion,
    type SessionSnapshot,
    type StateEvent,
    type CommandName,
    type CommandMap,
    type CommandRequest,
    type QueryName,
    type QueryMap,
    type Scope,
    type Operation,
} from '../protocol/types.js';
import { openEvents, requestJson } from './connection.js';

export type ClientSnapshot = SessionSnapshot & {
    connection: 'connected' | 'reconnecting';
    connectionMessage?: string;
};
export class Client {
    readonly id = randomUUID();
    private state!: ClientSnapshot;
    private listeners = new Set<() => void>();
    private closeStream?: () => void;
    private retry?: ReturnType<typeof setTimeout>;
    private cursor?: string;
    private closed = false;
    private localNotice?: string;
    constructor(readonly socket: string) {}
    async connect() {
        const snapshot = await requestJson<SessionSnapshot>(
            this.socket,
            '/v1/session',
        );
        if (snapshot.protocol !== protocolVersion)
            throw new ClientError({
                code: 'PROTOCOL_MISMATCH',
                message:
                    'The daemon and frontend protocol versions differ. Restart the daemon when current work finishes.',
            });
        this.set({ ...snapshot, connection: 'connected' });
        this.events();
        return this;
    }
    getSnapshot = () => this.state;
    async refreshSession(signal?: AbortSignal) {
        const snapshot = await requestJson<SessionSnapshot>(
            this.socket,
            '/v1/session',
            'GET',
            undefined,
            signal,
        );
        if (snapshot.protocol !== protocolVersion)
            throw new ClientError({
                code: 'PROTOCOL_MISMATCH',
                message: 'The daemon protocol changed. Restart this frontend.',
            });
        this.set({ ...snapshot, connection: 'connected' });
        return snapshot;
    }
    operation(id: string, signal?: AbortSignal) {
        return requestJson<Operation>(
            this.socket,
            `/v1/operations/${encodeURIComponent(id)}`,
            'GET',
            undefined,
            signal,
        );
    }
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private set(state: ClientSnapshot) {
        this.state = { ...state, notice: this.localNotice ?? state.notice };
        for (const listener of this.listeners) listener();
    }
    notice(message: string) {
        this.localNotice = message;
        this.set({ ...this.state, notice: message });
    }
    private receiveState(event: StateEvent) {
        const same =
            this.state.scope.generation === event.snapshot.scope.generation;
        const previous = same ? this.state.live.logs : [];
        const sequence = same ? this.state.live.logSequence : 0;
        const lines =
            event.logFrom <= sequence
                ? event.logLines.slice(sequence - event.logFrom)
                : event.logLines;
        const logs = event.logFrom > sequence ? lines : [...previous, ...lines];
        this.set({
            ...event.snapshot,
            live: {
                ...event.snapshot.live,
                logs: logs.slice(-5000),
            },
            connection: 'connected',
        });
    }
    private events() {
        this.closeStream = openEvents(
            this.socket,
            '/v1/events',
            (type, data, id) => {
                if (
                    (type === 'snapshot'
                        ? data.protocol
                        : data.snapshot?.protocol) !== protocolVersion
                )
                    throw new Error(
                        'The daemon protocol changed. Restart this frontend after updating it.',
                    );
                if (type === 'snapshot')
                    this.set({ ...data, connection: 'connected' });
                else if (type === 'state') {
                    this.receiveState(data as StateEvent);
                }
                if (id) this.cursor = id;
            },
            (error) => {
                if (this.closed) return;
                this.set({
                    ...this.state,
                    connection: 'reconnecting',
                    connectionMessage:
                        error?.message ?? 'Connection lost. Reconnecting…',
                });
                this.retry = setTimeout(() => this.events(), 1000);
            },
            this.cursor,
        );
    }
    query<K extends QueryName>(
        query: K,
        args: QueryMap[K]['args'],
        signal?: AbortSignal,
        scope = this.state.scope,
    ): Promise<QueryMap[K]['result']> {
        return requestJson(
            this.socket,
            '/v1/queries',
            'POST',
            { scope, query, args },
            signal,
        );
    }
    async submit<K extends CommandName>(
        command: K,
        args: CommandMap[K]['args'],
        scope = this.state.scope,
        requestId = randomUUID(),
    ): Promise<Operation> {
        const request = {
            protocol: protocolVersion,
            clientId: this.id,
            requestId,
            scope,
            command,
            args,
        } as CommandRequest<K>;
        // An explicit request ID lets callers retry a lost response without repeating work.
        return requestJson(this.socket, '/v1/commands', 'POST', request);
    }
    async command<K extends CommandName>(
        command: K,
        args: CommandMap[K]['args'],
        scope = this.state.scope,
    ): Promise<CommandMap[K]['result']> {
        return this.wait(
            (await this.submit(command, args, scope)).id,
        ) as Promise<CommandMap[K]['result']>;
    }
    private waitForOperationUpdate(id: string, signal?: AbortSignal) {
        return new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            const abort = () => {
                clearTimeout(timer);
                unsubscribe();
                reject(signal!.reason);
            };
            const finish = () => {
                clearTimeout(timer);
                unsubscribe();
                signal?.removeEventListener('abort', abort);
                resolve();
            };
            const unsubscribe = this.subscribe(() => {
                const current = this.state.operations.find((o) => o.id === id);
                if (current && operationFinished(current)) finish();
            });
            const timer = setTimeout(finish, 1000);
            signal?.addEventListener('abort', abort, { once: true });
        });
    }
    async wait(id: string, signal?: AbortSignal): Promise<unknown> {
        let operation = await requestJson<Operation>(
            this.socket,
            `/v1/operations/${id}`,
            'GET',
            undefined,
            signal,
        );
        while (!operationFinished(operation)) {
            await this.waitForOperationUpdate(id, signal);
            operation =
                this.state.operations.find((o) => o.id === id) ?? operation;
            if (!operationFinished(operation))
                operation = await requestJson(
                    this.socket,
                    `/v1/operations/${id}`,
                    'GET',
                    undefined,
                    signal,
                );
        }
        if (operation.state === 'cancelled')
            throw new ClientError({
                code: 'CANCELLED',
                message: 'Operation cancelled.',
                operationId: id,
            });
        if (operation.error)
            throw new ClientError({ ...operation.error, operationId: id });
        return operation.result;
    }
    cancel(id: string) {
        return requestJson<Operation>(
            this.socket,
            `/v1/operations/${id}/cancel`,
            'POST',
            {},
        );
    }
    close() {
        this.closed = true;
        clearTimeout(this.retry);
        this.closeStream?.();
        this.listeners.clear();
    }
}
