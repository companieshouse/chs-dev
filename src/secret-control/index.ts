import type { Readable } from 'node:stream';
import { SecretStoreError } from '../domain/secrets.js';
export { createSsmSecretStore as createSecretStore } from '../infrastructure/ssm-secrets.js';

/** Bounded private pipe input. Never use a terminal (which would echo secrets). */
export function readSecretInput(
    signal: AbortSignal,
    input: Readable & { isTTY?: boolean } = process.stdin,
): Promise<string> {
    if (input.isTTY)
        return Promise.reject(
            new SecretStoreError(
                'SECRET_INPUT_REQUIRED',
                'Pipe secret input on stdin from your secret source; terminal input is refused.',
            ),
        );
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const close = () => {
            input.pause();
            input.off('data', data);
            input.off('end', end);
            input.off('error', error);
            signal.removeEventListener('abort', abort);
        };
        const error = () => {
            close();
            reject(
                new SecretStoreError(
                    'SECRET_INPUT_FAILED',
                    'Cannot read private stdin input.',
                ),
            );
        };
        const abort = () => {
            close();
            reject(
                new SecretStoreError(
                    'SECRET_CANCELLED',
                    'Secret input cancelled.',
                ),
            );
        };
        const end = () => {
            close();
            try {
                resolve(decodeSecretInput(chunks));
            } catch (error) {
                reject(error);
            }
        };
        const data = (chunk: Buffer | string) => {
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size <= 4096) {
                chunks.push(buffer);
                return;
            }
            close();
            reject(
                new SecretStoreError(
                    'INVALID_SECRET_VALUE',
                    'Secret input exceeds 4096 UTF-8 bytes.',
                ),
            );
        };
        if (signal.aborted) {
            abort();
            return;
        }
        input.on('data', data);
        input.once('end', end);
        input.once('error', error);
        signal.addEventListener('abort', abort, { once: true });
    });
}

function decodeSecretInput(chunks: Buffer[]): string {
    try {
        return new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
        }).decode(Buffer.concat(chunks));
    } catch {
        throw new SecretStoreError(
            'INVALID_SECRET_VALUE',
            'Secret input must be valid UTF-8.',
        );
    }
}
