import { ClientError } from '../protocol/types.js';
import type { OperationResult } from '../domain/runtime-strategy.js';

export interface InteractiveCommand {
    command: string;
    args: string[];
    label: string;
    missingMessage: string;
    signal?: AbortSignal;
    environment: Record<string, string | undefined>;
}
export interface TerminalProcess {
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(): void;
    result: Promise<OperationResult>;
}
export type TerminalFactory = (
    request: InteractiveCommand,
    output: (data: string) => void,
) => Promise<TerminalProcess>;
type Channel = {
    id: string;
    label: string;
    send?: (text: string) => void;
    token?: string;
    terminal?: TerminalProcess;
    ready: Promise<void>;
    attached(): void;
    abort: AbortController;
    columns?: number;
    rows?: number;
    timer?: ReturnType<typeof setTimeout>;
};

export class Interactions {
    private channel?: Channel;
    constructor(
        private readonly terminal: TerminalFactory,
        private readonly changed: () => void,
        private readonly token: () => string,
    ) {}
    snapshot() {
        const c = this.channel;
        return c ? { id: c.id, label: c.label, claimed: !!c.send } : undefined;
    }
    async run<T>(
        id: string,
        label: string,
        signal: AbortSignal,
        work: (
            run: (request: InteractiveCommand) => Promise<OperationResult>,
            signal: AbortSignal,
        ) => Promise<T>,
    ): Promise<T> {
        if (this.channel)
            throw new ClientError({
                code: 'INTERACTION_BUSY',
                message:
                    'Another login or terminal interaction is already in progress.',
                operationId: this.channel.id,
            });
        let attached!: () => void;
        const channel: Channel = {
            id,
            label,
            ready: new Promise((resolve) => {
                attached = resolve;
            }),
            attached: () => attached(),
            abort: new AbortController(),
        };
        const abort = () => {
            channel.abort.abort();
            channel.terminal?.kill();
            channel.attached();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        this.channel = channel;
        this.changed();
        const timeout = setTimeout(abort, 120000);
        try {
            await channel.ready;
            clearTimeout(timeout);
            channel.abort.signal.throwIfAborted();
            channel.send?.(`${label}\r\n`);
            return await work(async (request) => {
                channel.abort.signal.throwIfAborted();
                const terminal = await this.terminal(
                    { ...request, signal: channel.abort.signal },
                    (text) => channel.send?.(text),
                );
                channel.terminal = terminal;
                if (channel.columns && channel.rows)
                    terminal.resize(channel.columns, channel.rows);
                try {
                    return await terminal.result;
                } finally {
                    channel.terminal = undefined;
                }
            }, channel.abort.signal);
        } finally {
            clearTimeout(timeout);
            clearTimeout(channel.timer);
            signal.removeEventListener('abort', abort);
            channel.terminal?.kill();
            this.channel = undefined;
            this.changed();
        }
    }
    claim(id: string, send: (text: string) => void) {
        const c = this.channel;
        if (!c || c.id !== id)
            throw new ClientError({
                code: 'NOT_FOUND',
                message: 'This interaction is no longer waiting for input.',
            });
        if (c.send)
            throw new ClientError({
                code: 'INTERACTION_CLAIMED',
                message: 'Another frontend is attached to this interaction.',
            });
        clearTimeout(c.timer);
        c.send = send;
        c.token = this.token();
        this.changed();
        return {
            token: c.token,
            ready: () => c.attached(),
            release: () => {
                if (this.channel !== c) return;
                c.send = undefined;
                c.token = undefined;
                this.changed();
                c.timer = setTimeout(() => {
                    c.abort.abort();
                    c.terminal?.kill();
                    c.attached();
                }, 5000);
            },
        };
    }
    input(
        id: string,
        token: string,
        data?: string,
        columns?: number,
        rows?: number,
    ) {
        const c = this.channel;
        if (!c || c.id !== id || c.token !== token || !c.send)
            throw new ClientError({
                code: 'INTERACTION_CLAIM_REQUIRED',
                message: 'Attach to this interaction before sending input.',
            });
        if (data !== undefined) c.terminal?.write(data);
        if (columns && rows) {
            c.columns = columns;
            c.rows = rows;
            c.terminal?.resize(columns, rows);
        }
    }
    close() {
        this.channel?.abort.abort();
        this.channel?.terminal?.kill();
        this.channel?.attached();
    }
}
