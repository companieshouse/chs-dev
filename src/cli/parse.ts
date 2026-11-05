import { parseArgs, type ParseArgsConfig } from 'node:util';
import { ClientError } from '../protocol/types.js';
import { commands, type CommandDefinition } from './registry.js';
import { serviceProviders } from '../domain/providers.js';

const options: NonNullable<ParseArgsConfig['options']> = {
    json: { type: 'boolean', short: 'j' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean' },
    detach: { type: 'boolean' },
    timeout: { type: 'string' },
    yes: { type: 'boolean' },
    enabled: { type: 'string' },
    development: { type: 'string' },
    provider: { type: 'string' },
    scenario: { type: 'string' },
    exclude: { type: 'string', multiple: true },
    allow: { type: 'string', multiple: true },
    tail: { type: 'string', short: 'n' },
    compose: { type: 'boolean', short: 'C' },
    follow: { type: 'boolean', short: 'f' },
    dependency: { type: 'boolean', short: 'd' },
    type: { type: 'string', short: 't' },
};
export type CliOptions = Record<
    string,
    string | boolean | string[] | undefined
>;
export interface Invocation {
    definition?: CommandDefinition;
    name: string;
    args: string[];
    options: CliOptions;
    local?: 'help' | 'version';
}
export function usage(message: string): never {
    throw new ClientError({ code: 'INVALID_USAGE', message });
}
function canonical(positionals: string[]) {
    if (positionals[0] !== 'legacy') return positionals;
    const rest = positionals
        .slice(1)
        .flatMap((item, index) => (index === 0 ? item.split(':') : [item]));
    if (rest[0] === 'exclude') rest.splice(0, 1, 'exclusions', 'add');
    if (rest[0] === 'include') rest.splice(0, 1, 'exclusions', 'remove');
    return ['legacy', ...rest];
}
function parse(argv: string[]) {
    try {
        return parseArgs({ args: argv, options, allowPositionals: true });
    } catch (error) {
        return usage(error instanceof Error ? error.message : String(error));
    }
}
function validateNumbers(invocation: Invocation) {
    const opts = invocation.options;
    if (
        opts.timeout !== undefined &&
        (!Number.isFinite(Number(opts.timeout)) ||
            Number(opts.timeout) < 0 ||
            Number(opts.timeout) > 2147483)
    )
        usage('Timeout must be between 0 and 2147483 seconds.');
    validateTail(invocation);
}
function validateTail(invocation: Invocation) {
    const opts = invocation.options;
    if (opts.tail === undefined) return;
    const legacy = invocation.name === 'legacy logs';
    if (legacy && opts.tail === 'all') return;
    const tail = Number(opts.tail);
    if (
        !Number.isSafeInteger(tail) ||
        tail < (legacy ? 0 : 1) ||
        (!legacy && tail > 5000)
    )
        usage(
            legacy
                ? 'Tail must be all or a nonnegative integer.'
                : 'Tail must be between 1 and 5000.',
        );
}
function validateOptions(invocation: Invocation) {
    const definition = invocation.definition!;
    const allowed = new Set(['help', 'json', ...definition.options]);
    for (const key of Object.keys(invocation.options)) {
        if (!allowed.has(key))
            usage(`--${key} is not supported by ${invocation.name}.`);
    }
    if (invocation.name === 'legacy logs' && invocation.options.json)
        usage(
            'Legacy streaming logs use text output. Use the new log commands for JSON snapshots.',
        );
    validateNumbers(invocation);
    validateConfigurationOptions(invocation);
    if (
        invocation.name === 'legacy dependency service' &&
        !['tree', 'flattree', 'diagram'].includes(
            String(invocation.options.type),
        )
    )
        usage('Supply -t tree, flattree or diagram.');
}
function validateConfigurationOptions(invocation: Invocation) {
    validateProviderOptions(invocation.options);
    for (const key of ['enabled', 'development']) {
        if (
            invocation.options[key] !== undefined &&
            !['true', 'false'].includes(String(invocation.options[key]))
        )
            usage(`--${key} must be true or false.`);
    }
    if (
        invocation.name === 'service configure' &&
        ![
            'enabled',
            'development',
            'provider',
            'scenario',
            'exclude',
            'allow',
        ].some((key) => invocation.options[key] !== undefined)
    )
        usage('Supply at least one configuration edit.');
    const excluded = invocation.options.exclude as string[] | undefined;
    const allowed = invocation.options.allow as string[] | undefined;
    if (excluded?.some((name) => allowed?.includes(name)))
        usage('A dependency cannot be both excluded and allowed.');
}

function validateProviderOptions(options: CliOptions) {
    if (
        options.provider !== undefined &&
        !(serviceProviders as readonly unknown[]).includes(options.provider)
    )
        usage('--provider must be service, development or mock.');
    if (
        options.provider !== undefined &&
        options.development !== undefined &&
        (options.provider === 'development') !==
            (options.development === 'true')
    )
        usage('--provider and --development disagree.');
    if (
        options.scenario !== undefined &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(String(options.scenario))
    )
        usage('Supply a valid mock scenario name.');
}
function versionInvocation(
    positionals: string[],
    values: CliOptions,
): Invocation {
    if (
        positionals.length ||
        Object.keys(values).length > (values.json ? 2 : 1)
    )
        usage('Use chs-dev --version [--json].');
    return { name: 'version', args: [], options: values, local: 'version' };
}
function resolveInvocation(
    positionals: string[],
    values: CliOptions,
): Invocation {
    const definition = commands.find((entry) =>
        entry.name
            .split(' ')
            .every((part, index) => positionals[index] === part),
    );
    const name = definition?.name ?? positionals.join(' ');
    if (helpRequested(positionals, values, definition))
        return { name, args: [], options: values, local: 'help' };
    if (!definition)
        usage(`Unknown command: ${name || '(missing)'}. Run chs-dev --help.`);
    const args = positionals.slice(definition.name.split(' ').length);
    if (args.length < definition.min || args.length > definition.max)
        usage(`Invalid arguments for ${name}. Run chs-dev ${name} --help.`);
    const invocation = { definition, name, args, options: values };
    validateOptions(invocation);
    return invocation;
}
function helpRequested(
    positionals: string[],
    values: CliOptions,
    definition?: CommandDefinition,
) {
    const topic =
        !positionals.length ||
        commands.some((entry) =>
            entry.name.startsWith(`${positionals.join(' ')} `),
        );
    if (values.help) return !!definition || topic;
    return !definition && topic && positionals.length > 0;
}
export function parseInvocation(argv: string[]): Invocation {
    const parsed = parse(argv);
    const positionals = canonical(parsed.positionals);
    const values = parsed.values as CliOptions;
    return values.version
        ? versionInvocation(positionals, values)
        : resolveInvocation(positionals, values);
}
