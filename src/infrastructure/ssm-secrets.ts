import {
    SecretStoreError,
    validateSecretValue,
    type SecretStore,
    type SecretStoreConfiguration,
} from '../domain/secrets.js';
import {
    createProcessExecutor,
    type ProcessExecutor,
    type ProcessRequest,
} from './live-process.js';

function validPath(value: string): boolean {
    return value
        .split('/')
        .every(
            (part) =>
                /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..',
        );
}

function validateConfiguration(configuration: SecretStoreConfiguration): void {
    const { namespace, profile, region } = configuration;
    if (
        configuration.keyId !== undefined &&
        !/^[a-zA-Z0-9:/_.-]{1,2048}$/.test(configuration.keyId)
    )
        throw new SecretStoreError(
            'SECRET_CONFIGURATION',
            'Supply a valid KMS --key-id or omit it to use the AWS-managed SSM key.',
        );
    if (
        !namespace.startsWith('/') ||
        !validPath(namespace.slice(1)) ||
        /^\/(aws|ssm)(\/|$)/i.test(namespace)
    )
        throw new SecretStoreError(
            'SECRET_CONFIGURATION',
            'Supply an approved absolute --namespace without empty or traversal segments.',
        );
    if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_.@+-]*$/.test(profile) ||
        !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)
    )
        throw new SecretStoreError(
            'SECRET_CONFIGURATION',
            'Supply an explicit valid --profile and --region. See docs/secrets.md.',
        );
}

function parameterName(namespace: string, name: string): string {
    if (!validPath(name))
        throw new SecretStoreError(
            'INVALID_SECRET_NAME',
            'Use a relative secret name without empty or traversal segments.',
        );
    const qualified = `${namespace}/${name}`;
    if (qualified.length > 900 || qualified.split('/').length > 16)
        throw new SecretStoreError(
            'INVALID_SECRET_NAME',
            'Secret path exceeds the supported SSM name length or hierarchy depth.',
        );
    return qualified;
}

function providerFailure(stderr: string): SecretStoreError {
    if (/\(ParameterNotFound\)/.test(stderr))
        return new SecretStoreError(
            'SECRET_NOT_FOUND',
            'Secret does not exist in the configured namespace, profile and region.',
        );
    if (/\(ParameterAlreadyExists\)/.test(stderr))
        return new SecretStoreError(
            'SECRET_ALREADY_EXISTS',
            'Secret already exists. Use secret update to replace it.',
        );
    if (
        /\((AccessDeniedException|AccessDenied|UnauthorizedOperation|KMSAccessDeniedException)\)/.test(
            stderr,
        )
    )
        return new SecretStoreError(
            'SECRET_ACCESS_DENIED',
            'Secret access denied. Check SSM/KMS permissions for the configured profile and namespace.',
        );
    if (
        /\((ExpiredToken|ExpiredTokenException|UnrecognizedClientException|InvalidClientTokenId)\)|SSO.*expired|Unable to locate credentials/i.test(
            stderr,
        )
    )
        return new SecretStoreError(
            'SECRET_AUTHENTICATION',
            'AWS credentials are unavailable or expired. Authenticate the configured profile and retry.',
        );
    return new SecretStoreError(
        'SECRET_PROVIDER_FAILED',
        'AWS SSM request failed. Check the configured profile, region, namespace and AWS CLI installation.',
    );
}

function malformed(): never {
    throw new SecretStoreError(
        'SECRET_INVALID_RESPONSE',
        'AWS SSM returned an invalid response. No secret value was displayed.',
    );
}

function parseResponse(stdout: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(stdout);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return malformed();
        return parsed as Record<string, unknown>;
    } catch {
        return malformed();
    }
}

function readParameter(
    response: Record<string, unknown>,
    name: string,
): string {
    const parameter = response.Parameter as Record<string, unknown> | undefined;
    if (
        !parameter ||
        parameter.Name !== name ||
        parameter.Type !== 'SecureString' ||
        typeof parameter.Value !== 'string'
    )
        return malformed();
    return parameter.Value;
}

function privateAwsRequest(
    configuration: SecretStoreConfiguration,
    args: string[],
    signal?: AbortSignal,
    stdin?: string,
): ProcessRequest {
    return {
        command: 'aws',
        args: [
            ...args,
            '--profile',
            configuration.profile,
            '--region',
            configuration.region,
            '--output',
            'json',
            '--no-cli-pager',
            '--no-cli-auto-prompt',
        ],
        cwd: process.cwd(),
        env: {
            ...process.env,
            AWS_PAGER: '',
            AWS_CLI_AUTO_PROMPT: 'off',
            AWS_MAX_ATTEMPTS: '1',
            AWS_EC2_METADATA_DISABLED: 'true',
        },
        stdin,
        privateOutput: true,
        captureStderr: true,
        timeout: 30_000,
        signal,
    };
}

async function requireDisabledHistory(
    configuration: SecretStoreConfiguration,
    execute: ProcessExecutor,
    signal?: AbortSignal,
): Promise<void> {
    let result;
    try {
        result = await execute(
            privateAwsRequest(
                configuration,
                ['configure', 'get', 'cli_history'],
                signal,
            ),
        );
    } catch {
        if (signal?.aborted) throw privateCommandFailure(signal);
        throw new SecretStoreError(
            'SECRET_PRIVACY_CONFIGURATION',
            'Cannot confirm AWS CLI history is disabled. Check AWS CLI installation and disable cli_history for the configured profile.',
        );
    }
    const unset =
        result.code === 1 && result.stdout === '' && result.stderr === '';
    const disabled =
        result.code === 0 &&
        result.stdout.trim() === 'disabled' &&
        result.stderr === '';
    if (unset || disabled) return;
    throw new SecretStoreError(
        'SECRET_PRIVACY_CONFIGURATION',
        'AWS CLI history must be disabled for the configured profile before managing secrets. Configure cli_history=disabled and retry.',
    );
}

function privateCommandFailure(signal?: AbortSignal): SecretStoreError {
    if (signal?.aborted)
        return new SecretStoreError(
            'SECRET_CANCELLED',
            'Secret request cancelled. A write may have reached SSM; retrieve it before retrying.',
        );
    return new SecretStoreError(
        'SECRET_PROVIDER_FAILED',
        'AWS SSM command could not complete within 30 seconds. Check AWS CLI and authentication; a write may have reached SSM.',
    );
}

function createSsmRequest(
    configuration: SecretStoreConfiguration,
    execute: ProcessExecutor,
) {
    return async (
        operation: string,
        input: Record<string, unknown>,
        signal?: AbortSignal,
    ) => {
        if (signal?.aborted)
            throw new SecretStoreError(
                'SECRET_CANCELLED',
                'Secret request cancelled.',
            );
        await requireDisabledHistory(configuration, execute, signal);
        let result;
        try {
            result = await execute(
                privateAwsRequest(
                    configuration,
                    ['ssm', operation, '--cli-input-json', 'file:///dev/stdin'],
                    signal,
                    JSON.stringify(input),
                ),
            );
        } catch {
            throw privateCommandFailure(signal);
        }
        if (signal?.aborted)
            throw new SecretStoreError(
                'SECRET_CANCELLED',
                'Secret request cancelled. A write may have reached SSM; retrieve it before retrying.',
            );
        if (result.code !== 0) throw providerFailure(result.stderr);
        return parseResponse(result.stdout || '{}');
    };
}

export function createSsmSecretStore(
    configuration: SecretStoreConfiguration,
    execute: ProcessExecutor = createProcessExecutor(),
): SecretStore {
    validateConfiguration(configuration);
    const request = createSsmRequest(configuration, execute);
    async function put(
        Name: string,
        value: string,
        Overwrite: boolean,
        signal?: AbortSignal,
    ): Promise<void> {
        const result = await request(
            'put-parameter',
            {
                Name,
                Value: value,
                Type: 'SecureString',
                Tier: 'Standard',
                ...(configuration.keyId ? { KeyId: configuration.keyId } : {}),
                Overwrite,
            },
            signal,
        );
        if (!Number.isSafeInteger(result.Version) || Number(result.Version) < 1)
            malformed();
    }
    return {
        async create(name, value, signal) {
            const Name = parameterName(configuration.namespace, name);
            validateSecretValue(value);
            await put(Name, value, false, signal);
        },
        async get(name, signal) {
            const Name = parameterName(configuration.namespace, name);
            return readParameter(
                await request(
                    'get-parameter',
                    { Name, WithDecryption: true },
                    signal,
                ),
                Name,
            );
        },
        async update(name, value, signal) {
            const Name = parameterName(configuration.namespace, name);
            validateSecretValue(value);
            readParameter(
                await request(
                    'get-parameter',
                    { Name, WithDecryption: false },
                    signal,
                ),
                Name,
            );
            await put(Name, value, true, signal);
        },
        async delete(name, signal) {
            const Name = parameterName(configuration.namespace, name);
            await request('delete-parameter', { Name }, signal);
        },
    };
}
