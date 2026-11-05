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
    ...['create', 'get', 'update', 'delete'].map((action) =>
        command(
            `secret ${action}`,
            action === 'get'
                ? 'Reveal a private secret only with --reveal'
                : `${action} a private SSM secret${action === 'delete' ? '' : '; reads private stdin'}`,
            1,
            1,
            [
                'namespace',
                'profile',
                'region',
                'timeout',
                ...(action === 'get' ? ['reveal'] : []),
                ...(['create', 'update'].includes(action) ? ['key-id'] : []),
            ],
        ),
    ),
    ...['start', 'apply'].map((name) =>
        command(name, `${name} the environment`, 0, 0, [...waiting, 'yes']),
    ),
    command('stop', 'Stop the environment; retain volumes', 0, 0, waiting),
    command('logs', 'Read recent environment output', 0, 0, ['tail']),
    command('service list', 'List services'),
    command('journey list', 'List journeys in this checkout'),
    command('cache clear', 'Clear learned usage modes (usage cache)'),
    command(
        'journey start',
        'Switch to a journey: preview, save, apply',
        1,
        1,
        [...waiting, 'yes'],
    ),
    command(
        'environment measure',
        'Measure the selected stack, or a journey against it',
        0,
        0,
        ['journey'],
    ),
    command(
        'environment source',
        'Choose default Service versions; saves until Apply',
        1,
        1,
        waiting,
    ),
    command('environment export', 'Write a portable environment file', 1, 1, [
        ...waiting,
        'force',
    ]),
    command('environment diff', 'Preview an environment file', 1, 1, [
        'versions-only',
    ]),
    command(
        'environment import',
        'Preview or save an environment file; --yes saves until Apply',
        1,
        1,
        [...waiting, 'yes', 'versions-only'],
    ),
    command(
        'environment versions',
        'Read running CIDEV image versions; --yes saves local pins only',
        1,
        1,
        ['profile', 'region', 'output', 'force', 'yes', 'timeout'],
    ),
    command('service show', 'Inspect a service', 1),
    command('service mocks', 'List mock contracts and scenarios', 0, 1),
    command('service configure', 'Edit service configuration', 1, 1, [
        ...waiting,
        'enabled',
        'development',
        'provider',
        'scenario',
        'image',
        'version-source',
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
        'Configure: --enabled true|false, --provider service|development|mock, --scenario <name>, --exclude <name>, --allow <name>.',
        'Legacy options and compatibility limits: docs/cli.md.',
    ].join('\n');
}
