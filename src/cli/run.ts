import type { Client } from '../client/client.js';
import { ClientError, type Operation } from '../protocol/types.js';
import { environmentMismatch } from '../daemon-control/environment.js';
import { daemonAction } from '../daemon-control/actions.js';
import { packageVersion } from '../daemon-control/package.js';
import { help } from './registry.js';
import { secretCommand, type SecretDependencies } from './secrets.js';
import { parseInvocation, type Invocation } from './parse.js';
import { connectCli } from './connect.js';
import type { CliContext, CliResult } from './context.js';
import { execute } from './execute.js';
import { envelope, errorDetail, exitCode, textResult } from './output.js';

export interface CliDependencies extends SecretDependencies {
    out?(text: string): void;
    err?(text: string): void;
    connect?(invocation: Invocation): Promise<Client | undefined>;
    signal?: AbortSignal;
}
interface RunState {
    invocation?: Invocation;
    client?: Client;
    context?: CliContext;
    warnings: string[];
}
function lifetime(
    dependencies: CliDependencies,
    timeout?: string | boolean | string[],
    privateOperation = false,
) {
    const controller = new AbortController();
    const interrupt = (signal: 'SIGINT' | 'SIGTERM') =>
        controller.abort(
            new ClientError({
                code: signal,
                message: privateOperation
                    ? 'Secret request interrupted. A write may have reached SSM; retrieve it before retrying.'
                    : 'Disconnected. Accepted operations continue in the daemon.',
            }),
        );
    const sigint = () => interrupt('SIGINT');
    const sigterm = () => interrupt('SIGTERM');
    process.once('SIGINT', sigint);
    process.once('SIGTERM', sigterm);
    const seconds = Number(timeout ?? 0);
    const timer = seconds
        ? setTimeout(
              () =>
                  controller.abort(
                      new ClientError({
                          code: 'WAIT_TIMEOUT',
                          message: privateOperation
                              ? 'Secret request timed out. A write may have reached SSM; retrieve it before retrying.'
                              : 'Wait timed out. Accepted work continues; use operation wait or cancel.',
                      }),
                  ),
              seconds * 1000,
          )
        : undefined;
    const signal = dependencies.signal
        ? AbortSignal.any([controller.signal, dependencies.signal])
        : controller.signal;
    return {
        signal,
        close: () => {
            clearTimeout(timer);
            process.off('SIGINT', sigint);
            process.off('SIGTERM', sigterm);
        },
    };
}

async function perform(
    state: RunState,
    dependencies: CliDependencies,
    signal: AbortSignal,
): Promise<CliResult> {
    const invocation = state.invocation!;
    if (invocation.local === 'help')
        return {
            data: { help: help(invocation.name) },
            text: help(invocation.name),
        };
    if (invocation.local === 'version') {
        const version = await packageVersion();
        return { data: { version }, text: version };
    }
    if (
        invocation.name.startsWith('daemon ') &&
        invocation.name !== 'daemon logs'
    )
        return { data: await daemonAction(invocation.name.split(' ')[1]) };
    if (invocation.name.startsWith('secret '))
        return secretCommand(
            invocation,
            dependencies,
            signal,
            dependencies.out ??
                ((text) => {
                    process.stdout.write(text);
                }),
        );
    state.client = await (dependencies.connect ?? connectCli)(invocation);
    if (!state.client) return unavailable(invocation);
    return performConnected(state, dependencies, signal);
}
function unavailable(invocation: Invocation): CliResult {
    if (invocation.name === 'status')
        return {
            data: { daemon: { running: false } },
            text: 'Daemon stopped.',
        };
    throw new ClientError({
        code: 'DAEMON_UNAVAILABLE',
        message: 'The daemon is stopped. Run chs-dev daemon start.',
    });
}
async function performConnected(
    state: RunState,
    dependencies: CliDependencies,
    signal: AbortSignal,
): Promise<CliResult> {
    const invocation = state.invocation!;
    const client = state.client!;
    const scope = client.getSnapshot().scope;
    if (!invocation.name.startsWith('operation '))
        await client.query('refresh', {}, signal, scope);
    const snapshot = await client.refreshSession(signal);
    if (snapshot.scope.generation !== scope.generation)
        throw new ClientError({
            code: 'STALE_PROJECT',
            message:
                'The active checkout changed. Retry after reviewing status.',
        });
    const mismatch = environmentMismatch(snapshot);
    if (mismatch) state.warnings.push(mismatch);
    state.warnings.push(...snapshot.settings.warnings);
    state.context = {
        invocation,
        client,
        scope,
        signal,
        out:
            dependencies.out ??
            ((text) => {
                process.stdout.write(text);
            }),
        err:
            dependencies.err ??
            ((text) => {
                process.stderr.write(text);
            }),
    };
    return execute(state.context);
}

function printResult(
    state: RunState,
    result: CliResult,
    out: (text: string) => void,
    err: (text: string) => void,
) {
    if (result.streamed) return;
    if (state.invocation!.options.json) {
        if (result.rawJson) printWarnings(state.warnings, err);
        const value = result.rawJson
            ? result.data
            : envelope(
                  state.invocation!.name,
                  result.data,
                  state.warnings,
                  state.context?.operation,
              );
        out(`${JSON.stringify(value)}\n`);
        return;
    }
    printWarnings(state.warnings, err);
    out(`${textResult(result)}\n`);
}
function printWarnings(warnings: string[], err: (text: string) => void) {
    for (const warning of warnings) err(`${warning}\n`);
}
function printFailure(
    state: RunState,
    error: unknown,
    output: {
        json: boolean;
        command: string;
        out(text: string): void;
        err(text: string): void;
    },
) {
    const detail = errorDetail(error);
    const operation: Operation | undefined = state.context?.operation;
    if (output.json)
        output.out(
            `${JSON.stringify(envelope(state.invocation?.name ?? output.command, detail.data ?? null, state.warnings, operation, detail))}\n`,
        );
    else
        output.err(
            `${detail.message}${operation ? ` (operation ${operation.id})` : ''}\n`,
        );
    return exitCode(detail);
}
function interruption(
    error: unknown,
    live?: ReturnType<typeof lifetime>,
    privateOperation = false,
) {
    if (!live?.signal.aborted) return error;
    if (!privateOperation) return live.signal.reason;
    const reason = live.signal.reason;
    const code =
        reason instanceof ClientError &&
        ['SIGINT', 'SIGTERM', 'WAIT_TIMEOUT'].includes(reason.detail.code)
            ? reason.detail.code
            : 'SECRET_CANCELLED';
    return new ClientError({
        code,
        message:
            'Secret request interrupted or timed out. A write may have reached SSM; retrieve it before retrying.',
    });
}

function invocationLifetime(
    dependencies: CliDependencies,
    invocation: Invocation,
) {
    const privateOperation = invocation.name.startsWith('secret ');
    return lifetime(
        dependencies,
        invocation.options.timeout ?? (privateOperation ? '30' : undefined),
        privateOperation,
    );
}

export async function runCli(
    argv: string[],
    dependencies: CliDependencies = {},
) {
    const out =
        dependencies.out ??
        ((text: string) => {
            process.stdout.write(text);
        });
    const err =
        dependencies.err ??
        ((text: string) => {
            process.stderr.write(text);
        });
    const state: RunState = { warnings: [] };
    let live: ReturnType<typeof lifetime> | undefined;
    const jsonRequested = argv.some((arg) => arg === '--json' || arg === '-j');
    try {
        state.invocation = parseInvocation(argv);
        live = invocationLifetime(dependencies, state.invocation);
        const result = await perform(state, dependencies, live.signal);
        printResult(state, result, out, err);
        return 0;
    } catch (error) {
        return printFailure(
            state,
            interruption(error, live, argv.includes('secret')),
            {
                json: state.invocation?.options.json === true || jsonRequested,
                command: argv.includes('secret') ? 'secret' : argv.join(' '),
                out,
                err,
            },
        );
    } finally {
        state.client?.close();
        live?.close();
    }
}
