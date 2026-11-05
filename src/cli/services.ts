import { serviceDefinitions } from '../domain/services.js';
import { dependencyTree } from '../domain/service-dependencies.js';
import {
    requireServices,
    submit,
    type CliContext,
    type CliResult,
} from './context.js';
import { usage } from './parse.js';
import {
    detailsProvider,
    mockScenarioFor,
    validateProvider,
    type ServiceProvider,
} from '../domain/providers.js';

function providerEdit(context: CliContext) {
    const {
        args: [name],
        options,
    } = context.invocation;
    const state = context.client.getSnapshot();
    const current = state.details[name];
    const definition = serviceDefinitions(state.groups)[name];
    const legacy = options.development === 'true' ? 'development' : 'service';
    const provider =
        (options.provider as ServiceProvider | undefined) ??
        (options.development === undefined
            ? detailsProvider(current, definition)
            : legacy);
    if (options.scenario && provider !== 'mock')
        usage('Choose --provider mock before selecting a scenario.');
    const scenario = options.scenario ?? mockScenarioFor(current, definition);
    const mockScenario = mockScenarioSelection(provider, scenario);
    validateProvider(name, provider, definition, mockScenario);
    return {
        provider,
        development: provider === 'development',
        ...(mockScenario ? { mockScenario } : {}),
    };
}

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

function mockScenarioSelection(provider: ServiceProvider, scenario: unknown) {
    if (provider !== 'mock') return undefined;
    if (typeof scenario !== 'string')
        usage('This service has no mock contract.');
    return scenario;
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
        ...providerEdit(context),
        exclusions,
    };
}

function servicesText(rows: ReturnType<typeof serviceRows>) {
    const width = Math.max(7, ...rows.map((row) => row.name.length));
    return [
        `${'Service'.padEnd(width)}  Enabled  Mode         Status       Module`,
        ...rows.map(
            (row) =>
                `${row.name.padEnd(width)}  ${row.enabled.padEnd(7)}  ${row.mode.padEnd(11)}  ${row.status.padEnd(11)}  ${row.module}${row.mockScenario ? ` · ${row.mockScenario}` : ''}`,
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
    if (action === 'mocks') return mockCatalogue(context);
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

function mockCatalogue(context: CliContext): CliResult {
    requireServices(context);
    const [selected] = context.invocation.args;
    const state = context.client.getSnapshot();
    const mocks = Object.entries(serviceDefinitions(state.groups))
        .filter(
            ([name, definition]) =>
                definition.mock && (!selected || name === selected),
        )
        .map(([name, definition]) => ({
            name,
            ...definition.mock!,
            activeScenario: state.details[name]?.mockScenario,
        }));
    if (selected && !mocks.length) usage(`${selected} has no mock contract.`);
    const lines = mocks.flatMap((mock) => [
        mock.name,
        ...mock.scenarios.map(
            (scenario) =>
                `  ${scenario.name}${scenario.name === mock.activeScenario ? ' (active)' : ''}: ${scenario.description}`,
        ),
    ]);
    return {
        data: { mocks },
        text: lines.length
            ? lines.join('\n')
            : 'No mock contracts are available for this checkout.',
    };
}
