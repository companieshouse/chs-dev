export interface CommandDefinition {
    name: string;
    description: string;
    min: number;
    max: number;
    options: string[];
    autostart?: boolean;
    legacyJson?: boolean;
}

const waiting = ['detach', 'timeout'];
function command(
    name: string,
    description: string,
    min = 0,
    max = min,
    options: string[] = [],
): CommandDefinition {
    const autostart = options.includes('detach');
    return { name, description, min, max, options, autostart };
}

export const commands: CommandDefinition[] = [
    command('status', 'Show the active environment'),
    ...['start', 'apply'].map((name) =>
        command(name, `${name} the environment`, 0, 0, [...waiting, 'yes']),
    ),
    command('stop', 'Stop the environment; retain volumes', 0, 0, waiting),
    command('logs', 'Read recent environment output', 0, 0, ['tail']),
    command('service list', 'List services'),
    command('service show', 'Inspect a service', 1),
    command('service configure', 'Edit service configuration', 1, 1, [
        ...waiting,
        'enabled',
        'development',
        'exclude',
        'allow',
    ]),
    ...['start', 'stop', 'restart'].map((action) =>
        command(
            `service ${action}`,
            `${action} selected services`,
            1,
            500,
            waiting,
        ),
    ),
    command('service reload', 'Rebuild a development service', 1, 1, waiting),
    command('service logs', 'Read service logs', 1, 1, ['tail']),
    ...[
        'status',
        'start',
        'stop',
        'restart',
        'install',
        'uninstall',
        'logs',
    ].map((action) =>
        command(
            `daemon ${action}`,
            `${action} daemon`,
            0,
            0,
            action === 'logs' ? ['tail'] : [],
        ),
    ),
    command('operation list', 'List retained operations'),
    command('operation show', 'Inspect an operation', 1),
    command('operation wait', 'Wait for an operation', 1, 1, ['timeout']),
    command('operation cancel', 'Explicitly cancel an operation', 1, 1, [
        'timeout',
    ]),
    ...[
        'services available',
        'modules available',
        'development services',
        'exclusions list',
        'status',
    ].map((name) => ({
        ...command(`legacy ${name}`, `Legacy ${name}`),
        legacyJson: true,
    })),
    ...[
        'services enable',
        'services disable',
        'modules enable',
        'modules disable',
        'development enable',
        'development disable',
    ].map((name) =>
        command(
            `legacy ${name}`,
            `Legacy ${name}; save until up`,
            1,
            500,
            waiting,
        ),
    ),
    ...['exclusions add', 'exclusions remove'].map((name) =>
        command(`legacy ${name}`, `Legacy ${name}; save until up`, 1, 500, [
            ...waiting,
            'dependency',
        ]),
    ),
    command('legacy up', 'Apply saved configuration through the daemon', 0, 0, [
        ...waiting,
        'yes',
    ]),
    command(
        'legacy down',
        'Stop the environment; retain volumes',
        0,
        0,
        waiting,
    ),
    command('legacy reload', 'Rebuild through the daemon', 1, 1, waiting),
    command(
        'legacy logs',
        'Read or follow service logs; -C for operation output',
        0,
        500,
        ['compose', 'follow', 'tail'],
    ),
    command(
        'legacy dependency service',
        'Inspect service dependencies',
        1,
        500,
        ['type'],
    ),
    command(
        'legacy dependency system',
        'Generate the system dependency diagram',
    ),
];

export function help(topic = '') {
    const selected = commands.filter(
        (entry) =>
            entry.name === topic ||
            entry.name.startsWith(topic ? `${topic} ` : ''),
    );
    const lines = selected.map(
        (entry) =>
            `  chs-dev ${entry.name}${entry.min ? ' <name…>' : ''}\n    ${entry.description}`,
    );
    return [
        `Usage: chs-dev${topic ? ` ${topic}` : ''} <command> [options]`,
        'Run chs-dev without arguments to open the TUI.',
        ...lines,
        `Options: --help, --json${selected.length === 1 ? selected[0].options.map((option) => `, --${option}`).join('') : '; mutations: --detach, --timeout <seconds>'}.`,
        'Startup approval: --yes. JSON, piped and detached commands never prompt.',
        'Configure: --enabled true|false, --development true|false, --exclude <name>, --allow <name>.',
        'Legacy options and compatibility limits: docs/cli.md.',
    ].join('\n');
}
