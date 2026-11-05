import { serviceDefinitions } from '../domain/services.js';
import { dependencyTree } from '../domain/service-dependencies.js';
import {
    requireServices,
    submit,
    type CliContext,
    type CliResult,
} from './context.js';
import { usage } from './parse.js';

export function serviceRows(context: CliContext) {
    const state = context.client.getSnapshot();
    return state.groups
        .flatMap((group) =>
            group.services.map((name) => ({
                name,
                module: group.name,
                ...state.details[name],
                status: state.statuses[name] ?? 'Unknown',
            })),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
}

function serviceEdit(context: CliContext) {
    const {
        args: [name],
        options,
    } = context.invocation;
    const current = context.client.getSnapshot().details[name];
    if (current.enabled === 'Unknown' || current.mode === 'Unknown')
        usage('Repair the project configuration before editing services.');
    const exclusions: Record<string, boolean> = {};
    for (const dependency of (options.exclude as string[] | undefined) ?? [])
        exclusions[dependency] = true;
    for (const dependency of (options.allow as string[] | undefined) ?? []) {
        if (exclusions[dependency])
            usage(`Cannot both exclude and allow ${dependency}.`);
        exclusions[dependency] = false;
    }
    return {
        name,
        enabled:
            options.enabled === undefined
                ? current.enabled === 'Yes'
                : options.enabled === 'true',
        development:
            options.development === undefined
                ? current.mode === 'Development'
                : options.development === 'true',
        exclusions,
    };
}

function servicesText(rows: ReturnType<typeof serviceRows>) {
    const width = Math.max(7, ...rows.map((row) => row.name.length));
    return [
        `${'Service'.padEnd(width)}  Enabled  Mode         Status       Module`,
        ...rows.map(
            (row) =>
                `${row.name.padEnd(width)}  ${row.enabled.padEnd(7)}  ${row.mode.padEnd(11)}  ${row.status.padEnd(11)}  ${row.module}`,
        ),
    ].join('\n');
}

async function configure(context: CliContext) {
    const result = await submit(context, 'configuration.save', {
        edit: serviceEdit(context),
        revision: context.client.getSnapshot().configurationRevision,
    });
    if (context.invocation.options.detach) return result;
    const state = await context.client.refreshSession(context.signal);
    const application =
        state.live.running && state.live.autoApply ? 'queued' : 'pending';
    return {
        data: {
            saved: true,
            application,
            revision: state.configurationRevision,
        },
        text: `Configuration saved; application ${application}.`,
    };
}

export async function serviceCommand(context: CliContext): Promise<CliResult> {
    const action = context.invocation.name.split(' ')[1];
    if (action === 'list') {
        const services = serviceRows(context);
        return { data: { services }, text: servicesText(services) };
    }
    requireServices(context);
    const [name] = context.invocation.args;
    if (action === 'show')
        return {
            data: {
                ...serviceRows(context).find((row) => row.name === name),
                definition: serviceDefinitions(
                    context.client.getSnapshot().groups,
                )[name],
                dependencies: dependencyTree(
                    name,
                    context.client.getSnapshot().groups,
                ),
            },
        };
    if (action === 'logs')
        return {
            data: {
                lines: await context.client.query(
                    'services.logs',
                    {
                        service: name,
                        tail: Number(context.invocation.options.tail ?? 200),
                    },
                    context.signal,
                    context.scope,
                ),
            },
        };
    if (action === 'configure') return configure(context);
    if (action === 'reload')
        return submit(context, 'service.reload', { service: name });
    return submit(context, 'service.action', {
        services: context.invocation.args,
        action: action as 'start' | 'stop' | 'restart',
    });
}
