import {
    ClientError,
    operationFinished,
    type SessionSnapshot,
} from '../protocol/types.js';
import type { CliContext, CliResult } from './context.js';
import { serviceCommand } from './services.js';
import { environmentCommand } from './environment.js';
import { legacyCommand } from './legacy.js';
import { operationCommand } from './operations.js';
import { profileCommand } from './profiles.js';

export async function execute(context: CliContext): Promise<CliResult> {
    const { name, options } = context.invocation;
    const state = context.client.getSnapshot();
    if (name === 'status')
        return {
            text: statusText(state),
            data: {
                daemon: { running: true, id: state.daemonId },
                project: state.project,
                runtime: { ...state.runtime, state: state.runtimeState },
                environment: { ...state.live, logs: undefined },
                operations: state.operations.filter(
                    (operation) => !operationFinished(operation),
                ),
            },
        };
    if (name === 'logs')
        return {
            data: {
                lines: state.live.logs.slice(-Number(options.tail ?? 200)),
            },
        };
    if (name === 'daemon logs') {
        const diagnostics = await context.client.query(
            'diagnostics',
            {},
            context.signal,
            context.scope,
        );
        return {
            data: {
                ...diagnostics,
                lines: diagnostics.lines.slice(-Number(options.tail ?? 200)),
            },
        };
    }
    if (name.startsWith('operation ')) return operationCommand(context);
    if (!state.project.valid)
        throw new ClientError({
            code: 'PROJECT_UNAVAILABLE',
            message: state.project.message,
        });
    if (name.startsWith('service ')) return serviceCommand(context);
    return projectCommand(context);
}

function projectCommand(context: CliContext) {
    const name = context.invocation.name;
    if (name.startsWith('environment ')) return profileCommand(context);
    if (name.startsWith('legacy ')) return legacyCommand(context);
    return environmentCommand(context);
}
function statusText(state: SessionSnapshot) {
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
        state.live.deferredConfigurationRevision
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
