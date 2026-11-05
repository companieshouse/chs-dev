import {
    ClientError,
    operationFinished,
    type SessionSnapshot,
} from '../protocol/types.js';
import type { CliContext, CliResult } from './context.js';
import { serviceCommand } from './services.js';
import { environmentCommand } from './environment.js';
import { journeyCommand } from './journeys.js';
import { legacyCommand } from './legacy.js';
import { serviceBlockers } from '../domain/environment.js';
import type { ServiceGroup } from '../domain/services.js';
import { operationCommand } from './operations.js';
import { profileCommand } from './profiles.js';

/** Commands answered from the session snapshot or daemon diagnostics. */
async function snapshotCommand(
    context: CliContext,
    state: ReturnType<CliContext['client']['getSnapshot']>,
): Promise<CliResult | undefined> {
    const { name, options } = context.invocation;
    if (name === 'status') return statusResult(context, state);
    if (name === 'logs')
        return {
            data: {
                lines: state.live.logs.slice(-Number(options.tail ?? 200)),
            },
        };
    if (name !== 'daemon logs') return undefined;
    return diagnosticsLines(context, Number(options.tail ?? 200));
}

async function diagnosticsLines(context: CliContext, tail: number) {
    const diagnostics = await context.client.query(
        'diagnostics',
        {},
        context.signal,
        context.scope,
    );
    return {
        data: { ...diagnostics, lines: diagnostics.lines.slice(-tail) },
    };
}

/** `chs-dev cache clear`: forget every learned usage mode. */
async function cacheCommand(context: CliContext): Promise<CliResult> {
    const result = await context.client.command(
        'usage.cacheClear',
        {},
        context.scope,
    );
    return {
        data: result,
        text: result.cleared
            ? 'Cleared learned usage modes.'
            : 'No learned usage modes to clear.',
    };
}

export async function execute(context: CliContext): Promise<CliResult> {
    const { name } = context.invocation;
    const state = context.client.getSnapshot();
    const local = await snapshotCommand(context, state);
    if (local) return local;
    if (name.startsWith('operation ')) return operationCommand(context);
    if (name === 'cache clear') return cacheCommand(context);
    if (!state.project.valid)
        throw new ClientError({
            code: 'PROJECT_UNAVAILABLE',
            message: state.project.message,
        });
    if (name.startsWith('service ')) return serviceCommand(context);
    if (name.startsWith('journey ')) return journeyCommand(context);
    return projectCommand(context);
}

function projectCommand(context: CliContext) {
    const name = context.invocation.name;
    if (name.startsWith('environment ')) return profileCommand(context);
    if (name.startsWith('legacy ')) return legacyCommand(context);
    return environmentCommand(context);
}
/** Snapshot status with per-service causal blockers. */
async function statusResult(
    context: CliContext,
    state: SessionSnapshot,
): Promise<CliResult> {
    const proxy = await context.client
        .query('proxy.accounting', {}, context.signal, context.scope)
        .catch(() => undefined);
    const blockers = serviceBlockers({
        enabled: Object.entries(state.details)
            .filter(([, detail]) => detail.enabled === 'Yes')
            .map(([name]) => name),
        statuses: state.statuses,
        containers: state.live.observed?.containers,
        exclusions: state.live.exclusions,
        dependencies: dependencyMap(state.groups),
        lazy: new Set(proxy?.lazy ?? []),
        coldStarting: proxy?.coldStarting ?? [],
    });
    return {
        text: statusText(state, blockers),
        data: {
            daemon: { running: true, id: state.daemonId },
            project: state.project,
            warnings: state.settings.warnings,
            runtime: { ...state.runtime, state: state.runtimeState },
            environment: { ...state.live, logs: undefined },
            blockers,
            operations: state.operations.filter(
                (operation) => !operationFinished(operation),
            ),
        },
    };
}

function dependencyMap(groups: ServiceGroup[]) {
    const map: Record<string, string[]> = {};
    for (const group of groups)
        for (const [name, definition] of Object.entries(
            group.definitions ?? {},
        ))
            map[name] = [...definition.dependencies];
    return map;
}

function statusText(
    state: SessionSnapshot,
    blockers: ReturnType<typeof serviceBlockers> = [],
) {
    const active = state.operations.filter(
        (operation) => !operationFinished(operation),
    );
    return [
        `Daemon: running (${state.daemonId})`,
        `Project: ${state.project.directory}`,
        `Runtime: ${state.runtime.name} (${state.runtimeState})`,
        `Environment: ${state.live.phase}`,
        state.project.valid ? '' : state.project.message,
        state.live.message,
        state.live.changes?.edited
            ? 'Configuration changes pending; run chs-dev apply or choose Apply / Start.'
            : '',
        `Active operations: ${active.length}`,
        ...active.map(
            (operation) =>
                `  ${operation.id} ${operation.state} ${operation.kind}`,
        ),
    ]
        .filter(Boolean)
        .join('\n');
}
