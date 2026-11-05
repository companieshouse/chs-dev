import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli, type CliDependencies } from '../src/cli/run.js';
import { createSsmSecretStore } from '../src/infrastructure/ssm-secrets.js';
import type {
    ProcessExecutor,
    ProcessRequest,
} from '../src/infrastructure/live-process.js';

const flags = [
    '--namespace',
    '/approved/dev',
    '--profile',
    'developer',
    '--region',
    'eu-west-2',
];

function fixture() {
    const parameters = new Map<string, { value: string; version: number }>();
    const requests: ProcessRequest[] = [];
    const execute: ProcessExecutor = async (request) => {
        if (request.args[0] === 'configure')
            return { code: 1, stdout: '', stderr: '' };
        requests.push(request);
        const input = JSON.parse(String(request.stdin));
        const parameter = parameters.get(input.Name);
        if (request.args[1] === 'put-parameter') {
            if (parameter && !input.Overwrite)
                return failure('ParameterAlreadyExists');
            const next = {
                value: input.Value,
                version: (parameter?.version ?? 0) + 1,
            };
            parameters.set(input.Name, next);
            return success({ Version: next.version });
        }
        if (!parameter) return failure('ParameterNotFound');
        if (request.args[1] === 'delete-parameter') {
            parameters.delete(input.Name);
            return success({});
        }
        return success({
            Parameter: {
                Name: input.Name,
                Type: 'SecureString',
                Value: parameter.value,
                Version: parameter.version,
            },
        });
    };
    return { requests, execute };
}

function success(value: unknown) {
    return { code: 0, stdout: JSON.stringify(value), stderr: '' };
}

function failure(code: string) {
    return {
        code: 254,
        stdout: '',
        stderr: `An error occurred (${code}) when calling operation: private-provider-detail`,
    };
}

function providerResponse(response: {
    code: number;
    stdout: string;
    stderr: string;
}): ProcessExecutor {
    return async (request) =>
        request.args[0] === 'configure'
            ? { code: 1, stdout: '', stderr: '' }
            : response;
}

async function invoke(
    action: string,
    f: ReturnType<typeof fixture>,
    options: { value?: string; extra?: string[] } = {},
) {
    let output = '',
        errors = '';
    const dependencies: CliDependencies = {
        connect: async () => {
            throw new Error('Secrets must not use the daemon');
        },
        secretStore: (configuration) =>
            createSsmSecretStore(configuration, f.execute),
        readSecretInput: async () => options.value ?? '',
        out: (text) => {
            output += text;
        },
        err: (text) => {
            errors += text;
        },
    };
    const code = await runCli(
        [
            'secret',
            action,
            'database/password',
            ...flags,
            ...(options.extra ?? ['--json']),
        ],
        dependencies,
    );
    return { code, output, errors, json: () => JSON.parse(output) };
}

test('secret CLI creates a private SecureString and deliberately reveals it without a daemon', async () => {
    const f = fixture();
    const value = 'sensitive\n"☃"';
    const created = await invoke('create', f, { value });
    assert.equal(created.code, 0, created.output + created.errors);
    assert.deepEqual(created.json().data, {
        action: 'create',
        completed: true,
    });
    assert.equal(created.output.includes('sensitive'), false);
    const read = await invoke('get', f, { extra: ['--reveal'] });
    assert.equal(read.code, 0, read.errors);
    assert.equal(read.output, value);
    assert.equal(read.errors, '');
    for (const request of f.requests) {
        assert.equal(request.args.join(' ').includes(value), false);
        assert.equal(request.privateOutput, true);
        assert.equal(request.captureStderr, true);
        assert.equal(request.timeout, 30_000);
        assert.equal(request.onOutput, undefined);
    }
    const stored = JSON.parse(String(f.requests[0]!.stdin));
    assert.equal(stored.Type, 'SecureString');
    assert.equal(stored.Tier, 'Standard');
    assert.equal(stored.Name, '/approved/dev/database/password');
    assert.equal(stored.Value, value);
});

test('create rejects duplicates, update replaces only existing secrets, and delete removes them', async () => {
    const f = fixture();
    const missing = await invoke('update', f, { value: 'replacement' });
    assert.equal(missing.json().error.code, 'SECRET_NOT_FOUND');
    assert.equal((await invoke('create', f, { value: 'initial' })).code, 0);
    assert.equal(
        (await invoke('create', f, { value: 'duplicate' })).json().error.code,
        'SECRET_ALREADY_EXISTS',
    );
    assert.equal((await invoke('update', f, { value: 'replacement' })).code, 0);
    assert.equal(
        (await invoke('get', f, { extra: ['--reveal'] })).output,
        'replacement',
    );
    assert.equal((await invoke('delete', f)).code, 0);
    assert.equal(
        (await invoke('get', f, { extra: ['--reveal'] })).errors.includes(
            'does not exist',
        ),
        true,
    );
    assert.equal(
        (await invoke('delete', f)).json().error.code,
        'SECRET_NOT_FOUND',
    );
});

async function run(args: string[], dependencies: CliDependencies = {}) {
    let output = '',
        errors = '';
    const code = await runCli(args, {
        connect: async () => {
            throw new Error('Unexpected daemon connection');
        },
        ...dependencies,
        out: (text) => {
            output += text;
        },
        err: (text) => {
            errors += text;
        },
    });
    return { code, output, errors, json: () => JSON.parse(output) };
}

test('secrets reject accidental values in argv, JSON reveal and missing configuration without leaking them', async () => {
    for (const args of [
        ['secret', 'create', 'name', 'unquoted-private-value', ...flags],
        [
            'secret',
            'create',
            'name',
            '--value=unquoted-private-value',
            ...flags,
        ],
        ['secret', 'get', 'name', ...flags],
        ['secret', 'get', 'name', '--reveal', ...flags],
        ['secret', 'delete', 'name', ...flags, '--timeout', '0'],
        ['secret', 'delete', 'name', ...flags, '--timeout', '61'],
    ]) {
        const result = await run([...args, '--json']);
        assert.equal(result.code, 2);
        assert.equal(result.json().error.code, 'INVALID_USAGE');
        assert.equal(result.output.includes('unquoted-private-value'), false);
    }
    const missing = await run(['secret', 'create', 'name', '--json']);
    assert.equal(missing.json().error.code, 'SECRET_CONFIGURATION');
    assert.match(
        missing.json().error.message,
        /--namespace, --profile and --region/,
    );
});

test('relative names cannot escape the configured namespace and invalid configuration fails before execution', async () => {
    let executions = 0;
    const execute: ProcessExecutor = async () => {
        executions++;
        return success({});
    };
    const store = createSsmSecretStore(
        {
            namespace: '/approved/dev',
            profile: 'developer',
            region: 'eu-west-2',
        },
        execute,
    );
    for (const name of [
        '/another/password',
        '../password',
        'db/../../password',
        'db//password',
        'db/./password',
        'db/',
        '',
        'db\\password',
    ]) {
        await assert.rejects(store.create(name, 'private'), {
            code: 'INVALID_SECRET_NAME',
        });
        await assert.rejects(store.get(name), { code: 'INVALID_SECRET_NAME' });
        await assert.rejects(store.update(name, 'private'), {
            code: 'INVALID_SECRET_NAME',
        });
        await assert.rejects(store.delete(name), {
            code: 'INVALID_SECRET_NAME',
        });
    }
    for (const namespace of [
        '/',
        '/approved/../dev',
        '/approved//dev',
        '/approved/dev/',
        'approved/dev',
        '/aws/dev',
        '/SSM/dev',
    ])
        assert.throws(
            () =>
                createSsmSecretStore(
                    { namespace, profile: 'developer', region: 'eu-west-2' },
                    execute,
                ),
            { code: 'SECRET_CONFIGURATION' },
        );
    assert.equal(executions, 0);
});

test('denied, unavailable, malformed and thrown provider failures never expose private data', async () => {
    const cases = [
        {
            response: failure('AccessDeniedException'),
            code: 'SECRET_ACCESS_DENIED',
        },
        {
            response: failure('ExpiredTokenException'),
            code: 'SECRET_AUTHENTICATION',
        },
        {
            response: failure('ThrottlingException'),
            code: 'SECRET_PROVIDER_FAILED',
        },
        {
            response: {
                code: 0,
                stdout: 'private-provider-detail',
                stderr: '',
            },
            code: 'SECRET_INVALID_RESPONSE',
        },
        {
            response: success({
                Parameter: {
                    Name: '/outside/password',
                    Type: 'SecureString',
                    Value: 'private-provider-detail',
                },
            }),
            code: 'SECRET_INVALID_RESPONSE',
        },
        {
            response: success({
                Parameter: {
                    Name: '/approved/dev/name',
                    Type: 'String',
                    Value: 'private-provider-detail',
                },
            }),
            code: 'SECRET_INVALID_RESPONSE',
        },
        {
            response: success({
                Parameter: { Name: '/approved/dev/name', Type: 'SecureString' },
            }),
            code: 'SECRET_INVALID_RESPONSE',
        },
        {
            response: success(['private-provider-detail']),
            code: 'SECRET_INVALID_RESPONSE',
        },
    ];
    for (const entry of cases) {
        const result = await run(
            ['secret', 'get', 'name', ...flags, '--reveal'],
            {
                secretStore: (configuration) =>
                    createSsmSecretStore(
                        configuration,
                        providerResponse(entry.response),
                    ),
            },
        );
        assert.equal(result.code, 1);
        assert.equal(result.output, '');
        assert.equal(result.errors.includes('private-provider-detail'), false);
        const store = createSsmSecretStore(
            {
                namespace: '/approved/dev',
                profile: 'developer',
                region: 'eu-west-2',
            },
            providerResponse(entry.response),
        );
        await assert.rejects(store.get('name'), { code: entry.code });
    }
    const thrown = await run(['secret', 'get', 'name', ...flags, '--reveal'], {
        secretStore: (configuration) =>
            createSsmSecretStore(configuration, async () => {
                throw new Error('private-provider-detail');
            }),
    });
    assert.equal(thrown.code, 1);
    assert.equal(thrown.errors.includes('private-provider-detail'), false);
});

test('empty and oversized private input never reaches AWS', async () => {
    const f = fixture();
    for (const value of ['', '☃'.repeat(1366)]) {
        const result = await invoke('create', f, { value });
        assert.equal(result.json().error.code, 'INVALID_SECRET_VALUE');
    }
    assert.equal(f.requests.length, 0);
});

test('cancellation and the CLI deadline abort private work without exposing reasons', async () => {
    const abort = new AbortController();
    abort.abort(new Error('private-provider-detail'));
    const f = fixture();
    const cancelled = await run(
        ['secret', 'get', 'name', ...flags, '--reveal'],
        {
            signal: abort.signal,
            secretStore: (configuration) =>
                createSsmSecretStore(configuration, f.execute),
        },
    );
    assert.equal(cancelled.code, 1);
    assert.equal(cancelled.errors.includes('private-provider-detail'), false);
    assert.equal(f.requests.length, 0);
    const timed = await run(
        ['secret', 'create', 'name', ...flags, '--timeout', '0.01', '--json'],
        {
            secretStore: (configuration) =>
                createSsmSecretStore(configuration, f.execute),
            readSecretInput: (signal) =>
                new Promise((_, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(signal.reason),
                        { once: true },
                    );
                }),
        },
    );
    assert.equal(timed.code, 124);
    assert.equal(timed.json().error.code, 'WAIT_TIMEOUT');
    assert.equal(timed.output.includes('daemon'), false);
    assert.equal(f.requests.length, 0);
});

test('production private stdin preserves bytes and refuses echoed, oversized or cancelled input', async () => {
    const { PassThrough } = await import('node:stream');
    const { readSecretInput } = await import('../src/secret-control/index.js');
    const f = fixture();
    const pipe = new PassThrough();
    const created = run(['secret', 'create', 'name', ...flags, '--json'], {
        secretStore: (configuration) =>
            createSsmSecretStore(configuration, f.execute),
        readSecretInput: (signal) => readSecretInput(signal, pipe),
    });
    pipe.end('  private\n☃\n');
    assert.equal((await created).code, 0);
    const retrieved = await run(
        ['secret', 'get', 'name', ...flags, '--reveal'],
        {
            secretStore: (configuration) =>
                createSsmSecretStore(configuration, f.execute),
        },
    );
    assert.equal(retrieved.output, '  private\n☃\n');
    const terminal = Object.assign(new PassThrough(), { isTTY: true });
    await assert.rejects(
        readSecretInput(new AbortController().signal, terminal),
        { code: 'SECRET_INPUT_REQUIRED' },
    );
    const oversized = new PassThrough();
    const rejected = readSecretInput(new AbortController().signal, oversized);
    oversized.end('x'.repeat(4097));
    await assert.rejects(rejected, { code: 'INVALID_SECRET_VALUE' });
    assert.equal(oversized.listenerCount('data'), 0);
    const stalled = new PassThrough();
    const controller = new AbortController();
    const pending = readSecretInput(controller.signal, stalled);
    controller.abort();
    await assert.rejects(pending, { code: 'SECRET_CANCELLED' });
    assert.equal(stalled.listenerCount('data'), 0);
});

test('configured customer-managed KMS key is sent on writes, without becoming secret metadata', async () => {
    const f = fixture();
    const create = await invoke('create', f, {
        value: 'private-key-value',
        extra: ['--key-id', 'alias/approved-dev-key', '--json'],
    });
    assert.equal(create.code, 0, create.output);
    assert.equal(
        JSON.parse(String(f.requests[0]!.stdin)).KeyId,
        'alias/approved-dev-key',
    );
    const update = await invoke('update', f, {
        value: 'updated-private-value',
        extra: ['--key-id', 'alias/approved-dev-key', '--json'],
    });
    assert.equal(update.code, 0, update.output);
    assert.equal(
        JSON.parse(String(f.requests.at(-1)!.stdin)).KeyId,
        'alias/approved-dev-key',
    );
    assert.equal(update.output.includes('approved-dev-key'), false);
    assert.equal(update.output.includes('updated-private-value'), false);
});

test('enabled or unknown AWS CLI history blocks secret requests before any value is sent', async () => {
    for (const probe of [
        { code: 0, stdout: 'enabled\n', stderr: '' },
        { code: 1, stdout: '', stderr: 'private-provider-detail' },
        { code: 1, stdout: 'private-provider-detail', stderr: '' },
        { code: 2, stdout: '', stderr: '' },
        { code: 0, stdout: 'unknown', stderr: '' },
    ]) {
        const requests: ProcessRequest[] = [];
        const result = await run(
            ['secret', 'create', 'name', ...flags, '--json'],
            {
                secretStore: (configuration) =>
                    createSsmSecretStore(configuration, async (request) => {
                        requests.push(request);
                        return probe;
                    }),
                readSecretInput: async () => 'private-secret-value',
            },
        );
        assert.equal(result.json().error.code, 'SECRET_PRIVACY_CONFIGURATION');
        assert.equal(result.output.includes('private-provider-detail'), false);
        assert.equal(requests.length, 1);
        assert.equal(requests[0]!.args[0], 'configure');
        assert.equal(requests[0]!.stdin, undefined);
        assert.equal(
            JSON.stringify(requests).includes('private-secret-value'),
            false,
        );
    }
});

test('invalid UTF-8 input is rejected without silently changing the secret', async () => {
    const { PassThrough } = await import('node:stream');
    const { readSecretInput } = await import('../src/secret-control/index.js');
    const input = new PassThrough();
    const result = readSecretInput(new AbortController().signal, input);
    input.end(Buffer.from([0xc3, 0x28]));
    await assert.rejects(result, { code: 'INVALID_SECRET_VALUE' });
});

test('private argument diagnostics remain redacted when global options precede secret', async () => {
    const result = await run([
        '--json',
        'secret',
        'create',
        'name',
        '--value=private-argument-value',
        ...flags,
    ]);
    assert.equal(result.code, 2);
    assert.equal(result.output.includes('private-argument-value'), false);
    assert.equal(result.json().command, 'secret');
});

test('direct storage cancellation during AWS privacy probing remains a typed cancellation', async () => {
    const controller = new AbortController();
    const store = createSsmSecretStore(
        {
            namespace: '/approved/dev',
            profile: 'developer',
            region: 'eu-west-2',
        },
        (request) =>
            new Promise((_, reject) => {
                request.signal!.addEventListener(
                    'abort',
                    () => reject(new Error('private-abort-detail')),
                    { once: true },
                );
            }),
    );
    const reading = store.get('name', controller.signal);
    controller.abort();
    await assert.rejects(reading, {
        code: 'SECRET_CANCELLED',
        message:
            'Secret request cancelled. A write may have reached SSM; retrieve it before retrying.',
    });
});

test('public secret CLI uses private stdin through the real AWS adapter and process executor', async () => {
    const { mkdtemp, readFile, rm, writeFile } =
        await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { initializeTuiLog } =
        await import('../src/infrastructure/tui-log.js');
    const directory = await mkdtemp(join(tmpdir(), 'chs-secret-process-'));
    const previousPath = process.env.PATH;
    const privateValue = 'fixture-private-value ☃\n';
    const aws = join(directory, 'aws');
    const source = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.join(' ').includes('fixture-private')) process.exit(9);
if (args[0] === 'configure') { console.log('disabled'); process.exit(0); }
let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => body += chunk);
process.stdin.on('end', () => {
    const input = JSON.parse(body);
    console.error('provider-private-value fixture-private-value');
    if (input.Name === '/approved/dev/denied') {
        console.error('An error occurred (AccessDeniedException): fixture-private-value');
        process.exitCode = 254;
        return;
    }
    if (input.Name !== '/approved/dev/name') process.exit(8);
    if (args[1] === 'put-parameter') {
        if (input.Value !== ${JSON.stringify(privateValue)} || input.Type !== 'SecureString') process.exit(7);
        console.log(JSON.stringify({Version: 1}));
    } else if (args[1] === 'get-parameter') {
        console.log(JSON.stringify({Parameter: {Name: input.Name, Type: 'SecureString', Value: ${JSON.stringify(privateValue)}}}));
    } else if (args[1] !== 'delete-parameter') process.exit(6);
});
`;
    try {
        await writeFile(aws, source, { mode: 0o700 });
        // Only this owned executable is resolvable; installed AWS is unreachable.
        process.env.PATH = directory;
        const log = initializeTuiLog(join(directory, 'logs'));
        for (const action of ['create', 'get', 'update', 'delete']) {
            const result = await run(
                [
                    'secret',
                    action,
                    'name',
                    ...flags,
                    ...(action === 'get' ? ['--reveal'] : ['--json']),
                ],
                {
                    readSecretInput: async () => privateValue,
                },
            );
            assert.equal(result.code, 0, result.output + result.errors);
            assert.equal(result.errors, '');
            if (action === 'get') assert.equal(result.output, privateValue);
            else assert.equal(result.output.includes('fixture-private'), false);
        }
        const denied = await run([
            'secret',
            'get',
            'denied',
            ...flags,
            '--reveal',
        ]);
        assert.equal(denied.code, 1);
        assert.match(denied.errors, /Secret access denied/);
        assert.equal(denied.output, '');
        assert.equal(denied.errors.includes('fixture-private'), false);
        assert.equal(denied.errors.includes('provider-private'), false);
        const diagnostic = await readFile(log.path, 'utf8');
        assert.match(diagnostic, /"event":"process"/);
        assert.equal(diagnostic.includes('fixture-private'), false);
        assert.equal(diagnostic.includes('provider-private'), false);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        await rm(directory, { recursive: true, force: true });
    }
});
