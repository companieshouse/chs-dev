/** Private values cross only this interface and deliberate CLI stdout. */
export interface SecretStore {
    create(name: string, value: string, signal?: AbortSignal): Promise<void>;
    get(name: string, signal?: AbortSignal): Promise<string>;
    update(name: string, value: string, signal?: AbortSignal): Promise<void>;
    delete(name: string, signal?: AbortSignal): Promise<void>;
}

export interface SecretStoreConfiguration {
    namespace: string;
    profile: string;
    region: string;
    keyId?: string;
}

export class SecretStoreError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export function validateSecretValue(value: string): void {
    if (!value || Buffer.byteLength(value, 'utf8') > 4096)
        throw new SecretStoreError(
            'INVALID_SECRET_VALUE',
            'Secret input must contain 1–4096 UTF-8 bytes.',
        );
}
