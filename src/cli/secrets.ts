import { ClientError } from '../protocol/types.js';
import {
    SecretStoreError,
    type SecretStore,
    type SecretStoreConfiguration,
} from '../domain/secrets.js';
import { createSecretStore, readSecretInput } from '../secret-control/index.js';
import type { Invocation } from './parse.js';
import type { CliResult } from './context.js';

export interface SecretDependencies {
    secretStore?(configuration: SecretStoreConfiguration): SecretStore;
    readSecretInput?(signal: AbortSignal): Promise<string>;
}

function secretConfiguration(invocation: Invocation): SecretStoreConfiguration {
    const configuration = {
        namespace: String(invocation.options.namespace ?? ''),
        profile: String(invocation.options.profile ?? ''),
        region: String(invocation.options.region ?? ''),
        keyId: invocation.options['key-id'] as string | undefined,
    };
    if (
        !configuration.namespace ||
        !configuration.profile ||
        !configuration.region
    )
        throw new SecretStoreError(
            'SECRET_CONFIGURATION',
            'Supply --namespace, --profile and --region explicitly. See docs/secrets.md for an example; ask Platform for the approved namespace and access.',
        );
    return configuration;
}

export async function secretCommand(
    invocation: Invocation,
    dependencies: SecretDependencies,
    signal: AbortSignal,
    out: (text: string) => void,
): Promise<CliResult> {
    try {
        const configuration = secretConfiguration(invocation);
        const store = (dependencies.secretStore ?? createSecretStore)(
            configuration,
        );
        const action = invocation.name.split(' ')[1]!;
        const name = invocation.args[0]!;
        if (action === 'get') {
            const value = await store.get(name, signal);
            signal.throwIfAborted();
            out(value);
            return { data: null, streamed: true };
        }
        if (action === 'delete') await store.delete(name, signal);
        else {
            const value = await (
                dependencies.readSecretInput ?? readSecretInput
            )(signal);
            await store[action as 'create' | 'update'](name, value, signal);
        }
        signal.throwIfAborted();
        return {
            data: { action, completed: true },
            text: `Secret ${action} completed.`,
        };
    } catch (error) {
        if (error instanceof SecretStoreError)
            throw new ClientError({ code: error.code, message: error.message });
        throw new ClientError({
            code: 'SECRET_FAILED',
            message:
                'Secret request failed. No private provider details were displayed.',
        });
    }
}
