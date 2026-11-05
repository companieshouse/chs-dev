import type { OperationCompletion } from '../domain/telemetry.js';
import { safeLog } from '../domain/live-logs.js';
import {
    ClientError,
    operationFinished,
    type CommandRequest,
    type Operation,
    type ApiError,
} from '../protocol/types.js';

export interface OperationRecord extends Operation {
    fingerprint: string;
}
export interface OperationStore {
    read(): Promise<OperationRecord[]>;
    write(records: OperationRecord[]): Promise<void>;
    fingerprint(request: CommandRequest): string;
    id(): string;
}
export class Operations {
    private records: OperationRecord[] = [];
    private controllers = new Map<string, AbortController>();
    private tasks = new Set<Promise<void>>();
    private serial: Promise<unknown> = Promise.resolve();
    private closed = false;
    interruptedOnStartup = false;
    constructor(
        private readonly store: OperationStore,
        private readonly changed: () => void,
        private readonly completed?: (completion: OperationCompletion) => void,
    ) {}
    async initialize() {
        this.records = await this.store.read();
        for (const operation of this.records)
            if (!operationFinished(operation)) {
                this.interruptedOnStartup = true;
                operation.state = 'interrupted';
                operation.updatedAt = new Date().toISOString();
                operation.error = {
                    code: 'INTERRUPTED',
                    message:
                        'The daemon stopped before this operation completed. Actual container state will be inspected; the command has not been replayed.',
                };
            }
        await this.save();
    }
    list(): Operation[] {
        return this.records
            .slice(-100)
            .map(({ fingerprint, ...operation }) => operation);
    }
    get(id: string): Operation {
        const found = this.records.find((o) => o.id === id);
        if (!found)
            throw new ClientError({
                code: 'NOT_FOUND',
                message: 'Operation history is no longer available.',
            });
        const { fingerprint, ...operation } = found;
        return operation;
    }
    active() {
        return this.list().filter((o) => !operationFinished(o));
    }
    private save() {
        const snapshot = JSON.parse(
            JSON.stringify(this.records),
        ) as OperationRecord[];
        const write = this.serial.then(() => this.store.write(snapshot));
        this.serial = write.catch(() => {});
        return write;
    }
    private accepting: Promise<unknown> = Promise.resolve();
    submit(
        request: CommandRequest,
        validate: () => void,
        execute: (signal: AbortSignal, id: string) => Promise<unknown>,
    ): Promise<Operation> {
        const submit = this.accepting.then(() =>
            this.enqueue(request, validate, execute),
        );
        this.accepting = submit.catch(() => {});
        return submit;
    }
    private async enqueue(
        request: CommandRequest,
        validate: () => void,
        execute: (signal: AbortSignal, id: string) => Promise<unknown>,
    ): Promise<Operation> {
        if (this.closed)
            throw new ClientError({
                code: 'SHUTTING_DOWN',
                message: 'The daemon is stopping.',
            });
        const fingerprint = this.store.fingerprint(request);
        const prior = this.records.find(
            (o) =>
                o.requestId === request.requestId &&
                o.clientId === request.clientId,
        );
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                throw new ClientError({
                    code: 'REQUEST_CONFLICT',
                    message:
                        'This request ID was already used for a different command.',
                });
            return this.get(prior.id);
        }
        validate();
        if (this.controllers.size >= 32)
            throw new ClientError({
                code: 'BUSY',
                message: 'Too many operations are pending.',
            });
        const record = this.newRecord(request, fingerprint);
        await this.appendRecord(record);
        const abort = new AbortController();
        this.controllers.set(record.id, abort);
        const task = this.runOperation(record, abort, execute).catch(() => {
            record.state = 'failed';
            record.error = {
                code: 'STATE_WRITE_FAILED',
                message:
                    'Cannot save operation state. Check permissions and free space.',
            };
            this.changed();
            this.reportCompletion(record);
        });
        this.tasks.add(task);
        void task.finally(() => this.tasks.delete(task));
        this.changed();
        return this.get(record.id);
    }
    private newRecord(
        request: CommandRequest,
        fingerprint: string,
    ): OperationRecord {
        const now = new Date().toISOString();
        return {
            id: this.store.id(),
            requestId: request.requestId,
            clientId: request.clientId,
            kind: request.command,
            scope: request.scope,
            fingerprint,
            state: 'queued',
            createdAt: now,
            updatedAt: now,
        };
    }
    private async appendRecord(record: OperationRecord) {
        this.records = [
            ...this.records.filter(
                (r, i) =>
                    i >= this.records.length - 499 || !operationFinished(r),
            ),
            record,
        ];
        try {
            await this.save();
        } catch (error) {
            this.records = this.records.filter((r) => r !== record);
            throw error;
        }
    }
    private async runOperation(
        record: OperationRecord,
        abort: AbortController,
        execute: (signal: AbortSignal, id: string) => Promise<unknown>,
    ) {
        try {
            record.state = 'running';
            await this.save();
            this.changed();

            record.result = await execute(abort.signal, record.id);
            record.state = Operations.outcomeState(
                record.result,
                abort.signal.aborted,
            );

            if (record.state === 'failed') {
                const message =
                    (record.result as { message?: string } | undefined)
                        ?.message ??
                    'The action could not complete. Review the environment status.';
                record.error = {
                    code: 'OPERATION_FAILED',
                    message: safeLog(message),
                };
            }
        } catch (error) {
            record.state = abort.signal.aborted ? 'cancelled' : 'failed';
            record.error = Operations.failureDetail(error);
        } finally {
            record.updatedAt = new Date().toISOString();
            this.controllers.delete(record.id);
            await this.save();
            this.changed();
            this.reportCompletion(record);
        }
    }

    private reportCompletion(record: OperationRecord): void {
        if (!['succeeded', 'failed', 'cancelled'].includes(record.state))
            return;
        try {
            const observation = this.completed?.({
                command: record.kind,
                state: record.state as OperationCompletion['state'],
                durationMs: Math.max(
                    0,
                    Date.parse(record.updatedAt) - Date.parse(record.createdAt),
                ),
                errorCode: record.error?.code,
            });
            void Promise.resolve(observation).catch(() => {});
        } catch {
            /* Observers never change accepted operation outcomes. */
        }
    }

    private static failureDetail(error: unknown): ApiError {
        if (error instanceof ClientError) return error.detail;

        return {
            code: 'OPERATION_FAILED',
            message:
                error instanceof Error
                    ? safeLog(error.message)
                    : 'Operation failed.',
        };
    }

    private static outcomeState(result: unknown, aborted: boolean) {
        const value = result as { outcome?: string; ok?: boolean } | undefined;
        if (aborted || value?.outcome === 'cancelled') return 'cancelled';
        if (
            value?.outcome === 'failed' ||
            value?.ok === false ||
            result === false
        )
            return 'failed';
        return 'succeeded';
    }
    cancel(id: string) {
        this.get(id);
        this.controllers.get(id)?.abort();
    }
    async close() {
        this.closed = true;
        await this.accepting;
        for (const abort of this.controllers.values()) abort.abort();
        await Promise.all(this.tasks);
        await this.serial;
    }
}
