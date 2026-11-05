import type { Client } from '../client/client.js';
import type { Invocation } from './parse.js';
import {
    ClientError,
    type Operation,
    type Scope,
    type CommandName,
    type CommandMap,
} from '../protocol/types.js';

export interface CliContext {
    invocation: Invocation;
    client: Client;
    scope: Scope;
    signal: AbortSignal;
    out(text: string): void;
    err(text: string): void;
    operation?: Operation;
}
export interface CliResult {
    data: unknown;
    text?: string;
    rawJson?: boolean;
    streamed?: boolean;
}

export function requireServices(
    context: CliContext,
    names = context.invocation.args,
) {
    const state = context.client.getSnapshot();
    if (!state.project.valid)
        throw new ClientError({
            code: 'PROJECT_UNAVAILABLE',
            message: state.project.message,
        });
    const available = new Set(state.groups.flatMap((group) => group.services));
    for (const name of names) {
        if (!available.has(name))
            throw new ClientError({
                code: 'UNKNOWN_SERVICE',
                message: `Unknown service: ${name}`,
            });
    }
}

export async function submit<K extends CommandName>(
    context: CliContext,
    command: K,
    args: CommandMap[K]['args'],
): Promise<CliResult> {
    context.signal.throwIfAborted();
    context.operation = await context.client.submit(
        command,
        args,
        context.scope,
    );
    if (context.invocation.options.detach)
        return {
            data: { accepted: true },
            text: `Accepted operation ${context.operation.id}.`,
        };
    const data = await context.client.wait(
        context.operation.id,
        context.signal,
    );
    context.operation = await context.client.operation(
        context.operation.id,
        context.signal,
    );
    return {
        data: data ?? null,
        text: `Operation ${context.operation.id} succeeded.`,
    };
}
