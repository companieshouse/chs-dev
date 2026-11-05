import { moduleNames } from '../domain/configuration.js';
import { serviceDefinitions } from '../domain/services.js';
import {
    dependencyTree,
    serviceDependencies,
} from '../domain/service-dependencies.js';
import {
    requireServices,
    submit,
    type CliContext,
    type CliResult,
} from './context.js';
import { environmentCommand } from './environment.js';
import { legacyLogs } from './logs.js';
import { openArtifacts } from '../daemon-control/artifacts.js';

async function legacyStatus(context: CliContext) {
    const { selections } = await context.client.query(
        'configuration.snapshot',
        {},
        context.signal,
        context.scope,
    );
    const state = context.client.getSnapshot();
    const services = Object.keys(state.details)
        .filter((name) => state.details[name].enabled === 'Yes')
        .sort()
        .map((name) => ({
            name,
            composeStatus:
                state.statuses[name] === 'Stopped'
                    ? 'Not running'
                    : (state.statuses[name] ?? 'Not running'),
            liveUpdate: selections.servicesWithLiveUpdate.includes(name),
            transient: !selections.services.includes(name),
        }));
    const sections = [
        ['Manually activated modules:', selections.modules],
        ['Manually activated services:', selections.services],
        [
            'Automatically activated services:',
            services.map(
                (service) =>
                    `${service.name} (${service.composeStatus})${service.liveUpdate ? ' [LIVE UPDATE]' : ''}`,
            ),
        ],
        ['Manually deactivated services:', selections.excludedServices],
    ] as const;
    return {
        data: { modules: selections.modules, services },
        rawJson: true,
        text: sections
            .map(
                ([label, names]) =>
                    `${label}\n${names.map((name) => ` - ${name}`).join('\n')}`,
            )
            .join('\n\n'),
    };
}

async function legacyQuery(context: CliContext): Promise<CliResult> {
    const { name } = context.invocation;
    const groups = context.client.getSnapshot().groups;
    if (name === 'legacy status') return legacyStatus(context);
    if (name === 'legacy modules available')
        return { data: { modules: moduleNames(groups) }, rawJson: true };
    if (name === 'legacy exclusions list') {
        const { selections } = await context.client.query(
            'configuration.snapshot',
            {},
            context.signal,
            context.scope,
        );
        return {
            data: { exclusions: selections.excludedServices },
            rawJson: true,
        };
    }
    const definitions = serviceDefinitions(groups);
    const services = Object.keys(definitions)
        .filter(
            (service) =>
                name !== 'legacy development services' ||
                definitions[service].development,
        )
        .sort();
    return { data: { services }, rawJson: true };
}

async function dependencies(context: CliContext) {
    const system = context.invocation.name === 'legacy dependency system';
    if (!system) requireServices(context);
    if (system || context.invocation.options.type === 'diagram') {
        const data = await context.client.query(
            'dependency.diagram',
            { services: system ? [] : context.invocation.args },
            context.signal,
            context.scope,
        );
        if (
            !context.invocation.options.json &&
            process.stdin.isTTY &&
            process.stdout.isTTY
        )
            openArtifacts(data.paths);
        return { data, text: data.paths.join('\n') };
    }
    const groups = context.client.getSnapshot().groups;
    const flat = context.invocation.options.type === 'flattree';
    const trees = context.invocation.args.map((name) => ({
        name,
        rows: flat
            ? serviceDependencies(name, groups).map((dependency) => ({
                  name: dependency.name,
                  prefix: '\t',
                  reference: undefined,
              }))
            : dependencyTree(name, groups),
    }));
    return {
        data: { trees },
        text: trees
            .map((tree) =>
                [
                    tree.name,
                    ...tree.rows.map(
                        (row) =>
                            `${row.prefix}${row.name}${row.reference ? ` (${row.reference})` : ''}`,
                    ),
                ].join('\n'),
            )
            .join('\n\n'),
    };
}

async function legacyEdit(context: CliContext) {
    const [, topic, action] = context.invocation.name.split(' ');
    const snapshot = await context.client.query(
        'configuration.snapshot',
        {},
        context.signal,
        context.scope,
    );
    const result = await submit(context, 'configuration.legacyEdit', {
        revision: snapshot.revision,
        edit: {
            topic: topic as
                'services' | 'modules' | 'development' | 'exclusions',
            action: action as 'enable' | 'disable' | 'add' | 'remove',
            names: context.invocation.args,
            dependencies: context.invocation.options.dependency as
                boolean | undefined,
        },
    });
    if (context.invocation.options.detach) return result;
    return {
        data: result.data,
        text: `Saved ${topic} ${action}: ${context.invocation.args.join(', ')}. Run chs-dev legacy up to apply.`,
    };
}

export async function legacyCommand(context: CliContext): Promise<CliResult> {
    const { name, definition, args } = context.invocation;
    if (definition?.legacyJson) return legacyQuery(context);
    if (name.startsWith('legacy dependency ')) return dependencies(context);
    if (name === 'legacy logs') return legacyLogs(context);
    if (name === 'legacy up' || name === 'legacy down')
        return environmentCommand(context);
    if (name === 'legacy reload') {
        requireServices(context);
        return submit(context, 'service.reload', { service: args[0] });
    }
    return legacyEdit(context);
}
