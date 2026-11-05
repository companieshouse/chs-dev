import { rethrowIfAborted } from './cancellation.js';
import { randomUUID } from 'node:crypto';
import {
    chmod,
    lstat,
    mkdir,
    readlink,
    realpath,
    rename,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
    SshFileState,
    SshSecretRequirement,
    SshSetupStatus,
} from '../domain/live.js';
import type { ProcessExecutor } from './live-process.js';

export interface SshFileInfo {
    isFile: boolean;
    isSymbolicLink: boolean;
    mode: number;
}

export interface SshSetupFiles {
    lstat(path: string): Promise<SshFileInfo>;
    stat(path: string): Promise<SshFileInfo>;
    readlink(path: string): Promise<string>;
    realpath(path: string): Promise<string>;
    symlink(target: string, path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    writeExclusive(path: string, text: string): Promise<void>;
    chmod(path: string, mode: number): Promise<void>;
    rename(source: string, destination: string): Promise<void>;
}

function info(value: {
    isFile(): boolean;
    isSymbolicLink(): boolean;
    mode: number;
}): SshFileInfo {
    return {
        isFile: value.isFile(),
        isSymbolicLink: value.isSymbolicLink(),
        mode: value.mode,
    };
}

export const sshSetupFiles: SshSetupFiles = {
    lstat: async (path) => info(await lstat(path)),
    stat: async (path) => info(await stat(path)),
    readlink,
    realpath,
    symlink: (target, path) => symlink(target, path),
    unlink,
    mkdir: async (path) => {
        await mkdir(path, { recursive: true, mode: 0o700 });
    },
    writeExclusive: (path, text) =>
        writeFile(path, text, { flag: 'wx', mode: 0o600 }),
    chmod: (path, mode) => chmod(path, mode),
    rename,
};

export interface SshSetupApi {
    inspect(
        requirements: readonly SshSecretRequirement[],
        signal?: AbortSignal,
    ): Promise<SshSetupStatus>;
    setup(
        requirements: readonly SshSecretRequirement[],
        input: {
            keyPath: string;
            passphrase: string;
            replace: boolean;
        },
        signal?: AbortSignal,
    ): Promise<void>;
}

export class SshSetupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SshSetupError';
    }
}
function setupError(error: unknown): SshSetupError {
    return error instanceof SshSetupError
        ? error
        : new SshSetupError(
              'Cannot create Container SSH secret files. Check project permissions and retry.',
          );
}

function missing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function secureFile(info: SshFileInfo): boolean {
    return (
        info.isFile &&
        !info.isSymbolicLink &&
        (info.mode & 0o400) !== 0 &&
        (info.mode & 0o077) === 0
    );
}
function securePassphraseFile(info: SshFileInfo): boolean {
    return info.isFile && !info.isSymbolicLink && (info.mode & 0o777) === 0o600;
}

function safeTargetPath(path: string, base = homedir()): string {
    const expanded =
        path === '~' || path.startsWith('~/')
            ? join(homedir(), path.slice(2))
            : path;
    return resolve(base, expanded);
}

function normalizedRequirements(
    requirements: readonly SshSecretRequirement[],
): SshSecretRequirement {
    if (!requirements.length)
        throw new SshSetupError('No SSH setup is required for this project.');
    const first = requirements[0];
    if (
        requirements.some(
            (requirement) =>
                !['container-ssh-secrets', 'docker-ssh-secrets'].includes(
                    requirement.kind,
                ) ||
                requirement.keyPath !== first.keyPath ||
                requirement.passphrasePath !== first.passphrasePath,
        )
    )
        throw new SshSetupError(
            'The project has conflicting SSH requirements.',
        );
    if (
        first.keyPath !== 'local/.ssh_key' ||
        first.passphrasePath !== 'local/.ssh_key_passphrase'
    )
        throw new SshSetupError('The project has invalid SSH secret paths.');
    return {
        kind: first.kind,
        services: [
            ...new Set(
                requirements.flatMap((requirement) => requirement.services),
            ),
        ].sort(),
        keyPath: first.keyPath,
        passphrasePath: first.passphrasePath,
    };
}

function projectPath(directory: string, value: string): string {
    const path = resolve(directory, value);
    const outside = relative(directory, path);
    if (isAbsolute(value) || outside === '..' || outside.startsWith(`..${sep}`))
        throw new SshSetupError(
            'SSH secret paths must remain inside the project.',
        );
    return path;
}

function operationArtifact(
    artifacts: string | undefined,
    path: string,
): boolean {
    if (!artifacts) return false;
    const child = relative(artifacts, path);
    return (
        child === '' ||
        (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
    );
}

async function regularKey(
    files: SshSetupFiles,
    path: string,
): Promise<boolean> {
    try {
        return secureFile(await files.stat(path));
    } catch (error) {
        if (missing(error)) return false;
        throw error;
    }
}

export class SshSetupService implements SshSetupApi {
    constructor(
        private readonly dependencies: {
            directory: string;
            execute: ProcessExecutor;
            files: SshSetupFiles;
            /** chs-dev's own state; keys found there are never offered. */
            artifacts?: string;
        },
    ) {}

    private async discoverKey(
        signal?: AbortSignal,
    ): Promise<string | undefined> {
        let result;
        try {
            result = await this.dependencies.execute({
                command: 'ssh',
                args: ['-G', 'github.com'],
                cwd: this.dependencies.directory,
                env: { ...process.env },
                signal,
                timeout: 5000,
                captureStdout: true,
            });
        } catch (error) {
            rethrowIfAborted(signal, error);
            return undefined;
        }
        if (result.code !== 0) return undefined;
        for (const candidate of this.identityCandidates(result.stdout)) {
            if (await this.usableIdentity(candidate, signal)) return candidate;
        }
        return undefined;
    }

    private identityCandidates(output: string): string[] {
        return output.split(/\r?\n/).flatMap((line) => {
            const raw = /^identityfile\s+(.+)$/i.exec(line.trim())?.[1].trim();
            return !raw || raw === 'none' || raw.includes('%')
                ? []
                : [safeTargetPath(raw)];
        });
    }

    private async usableIdentity(candidate: string, signal?: AbortSignal) {
        if (operationArtifact(this.dependencies.artifacts, candidate))
            return false;
        try {
            return await regularKey(this.dependencies.files, candidate);
        } catch (error) {
            rethrowIfAborted(signal, error);
            return false;
        }
    }

    private async fileState(
        path: string,
        kind: 'key' | 'passphrase',
    ): Promise<SshFileState> {
        try {
            const link = await this.dependencies.files.lstat(path);
            if (kind === 'key') {
                if (!link.isSymbolicLink) return 'invalid';
                return (await regularKey(this.dependencies.files, path))
                    ? 'valid'
                    : 'invalid';
            }
            if (!securePassphraseFile(link)) return 'invalid';
            return 'valid';
        } catch (error) {
            if (missing(error)) return 'missing';
            return 'invalid';
        }
    }

    async inspect(
        requirements: readonly SshSecretRequirement[],
        signal?: AbortSignal,
    ): Promise<SshSetupStatus> {
        const requirement = normalizedRequirements(requirements);
        const keyPath = projectPath(
            this.dependencies.directory,
            requirement.keyPath,
        );
        const passphrasePath = projectPath(
            this.dependencies.directory,
            requirement.passphrasePath,
        );
        const [initialKeyState, passphraseState, discoveredKey] =
            await Promise.all([
                this.fileState(keyPath, 'key'),
                this.fileState(passphrasePath, 'passphrase'),
                this.discoverKey(signal),
            ]);
        let keyState = initialKeyState;
        let existingKey: string | undefined;
        if (keyState === 'valid') {
            try {
                existingKey = await this.dependencies.files.realpath(keyPath);
                if (
                    operationArtifact(this.dependencies.artifacts, existingKey)
                ) {
                    keyState = 'invalid';
                    existingKey = undefined;
                }
            } catch {
                existingKey = undefined;
            }
        }
        const ready = keyState === 'valid' && passphraseState === 'valid';
        const message = ready
            ? 'Container SSH secrets are ready.'
            : keyState !== 'valid'
              ? discoveredKey
                  ? 'A GitHub SSH key was detected, but Live needs permission to create its container secret link.'
                  : 'Live needs a readable GitHub SSH private key to create the container secrets.'
              : 'The Container SSH passphrase file is missing or has unsafe permissions.';
        return {
            requirements: [requirement],
            keyState,
            passphraseState,
            ...(existingKey ? { existingKey } : {}),
            ...(discoveredKey ? { discoveredKey } : {}),
            ready,
            message,
        };
    }

    private async resolveSelectedKey(input: {
        keyPath: string;
        passphrase: string;
        replace: boolean;
    }): Promise<string> {
        const selectedKey = safeTargetPath(
            input.keyPath,
            this.dependencies.directory,
        );
        if (operationArtifact(this.dependencies.artifacts, selectedKey))
            throw new SshSetupError(
                'The SSH key cannot be stored in Live operation artifacts.',
            );
        let selectedIsRegular = false;
        try {
            selectedIsRegular = await regularKey(
                this.dependencies.files,
                selectedKey,
            );
        } catch {
            selectedIsRegular = false;
        }
        if (!selectedIsRegular)
            throw new SshSetupError(
                'The selected SSH key is missing, unreadable, or has unsafe permissions.',
            );
        let selectedRealpath: string;
        try {
            selectedRealpath =
                await this.dependencies.files.realpath(selectedKey);
        } catch {
            throw new SshSetupError(
                'The selected SSH key is missing, unreadable, or has unsafe permissions.',
            );
        }
        if (operationArtifact(this.dependencies.artifacts, selectedRealpath))
            throw new SshSetupError(
                'The SSH key cannot be stored in Live operation artifacts.',
            );
        return selectedRealpath;
    }

    private async reconcileExistingKey(
        keyPath: string,
        selectedRealpath: string,
        replace: boolean,
    ): Promise<{ keyExists: boolean; sameKey: boolean }> {
        let keyExists = false;
        let sameKey = false;
        try {
            const existing = await this.dependencies.files.lstat(keyPath);
            keyExists = true;
            if (existing.isSymbolicLink) {
                try {
                    sameKey =
                        (await this.dependencies.files.realpath(keyPath)) ===
                        selectedRealpath;
                } catch {
                    sameKey = false;
                }
            }
            if (!sameKey && !replace)
                throw new SshSetupError(
                    'Existing Container SSH setup differs. Choose repair to replace it.',
                );
            if (!sameKey) {
                await this.dependencies.files.unlink(keyPath);
                keyExists = false;
            }
        } catch (error) {
            if (!missing(error)) throw setupError(error);
        }
        return { keyExists, sameKey };
    }

    private async inspectPassphrase(
        passphrasePath: string,
        replace: boolean,
    ): Promise<{ passphraseExists: boolean; passphraseSecure: boolean }> {
        let passphraseExists = false;
        let passphraseSecure = false;
        try {
            const existing =
                await this.dependencies.files.lstat(passphrasePath);
            passphraseExists = true;
            passphraseSecure = securePassphraseFile(existing);
            if (!passphraseSecure && !replace)
                throw new SshSetupError(
                    'Existing Container SSH passphrase setup requires explicit repair.',
                );
        } catch (error) {
            if (!missing(error)) throw setupError(error);
        }
        return { passphraseExists, passphraseSecure };
    }

    private async installSecrets(options: {
        selectedRealpath: string;
        keyPath: string;
        passphrasePath: string;
        keyExists: boolean;
        passphraseExists: boolean;
        passphrase: string;
        replace: boolean;
    }): Promise<void> {
        const {
            selectedRealpath,
            keyPath,
            passphrasePath,
            keyExists,
            passphraseExists,
            passphrase,
            replace,
        } = options;
        if (passphraseExists && !replace)
            throw new SshSetupError(
                'Existing Container SSH passphrase setup requires explicit repair.',
            );
        const created = new Set<string>();
        const temporary = `${passphrasePath}.tmp-${randomUUID()}`;
        try {
            if (!keyExists) {
                const temporaryKey = `${keyPath}.tmp-${randomUUID()}`;
                await this.dependencies.files.symlink(
                    selectedRealpath,
                    temporaryKey,
                );
                created.add(temporaryKey);
                await this.dependencies.files.rename(temporaryKey, keyPath);
                created.delete(temporaryKey);
                created.add(keyPath);
            }
            await this.dependencies.files.writeExclusive(temporary, passphrase);
            created.add(temporary);
            await this.dependencies.files.chmod(temporary, 0o600);
            await this.dependencies.files.rename(temporary, passphrasePath);
        } catch (error) {
            const cleanupErrors = await this.removeCreatedSecrets(created);
            const failure = setupError(error);
            if (cleanupErrors.length)
                failure.cause = new AggregateError(
                    cleanupErrors,
                    'Secret cleanup failed',
                );
            throw failure;
        }
    }

    private async removeCreatedSecrets(paths: Set<string>): Promise<unknown[]> {
        const errors: unknown[] = [];
        for (const path of [...paths].reverse()) {
            try {
                await this.dependencies.files.unlink(path);
            } catch (error) {
                if (!missing(error)) errors.push(error);
            }
        }
        return errors;
    }

    async setup(
        requirements: readonly SshSecretRequirement[],
        input: {
            keyPath: string;
            passphrase: string;
            replace: boolean;
        },
        signal?: AbortSignal,
    ): Promise<void> {
        const requirement = normalizedRequirements(requirements);
        if (signal?.aborted) throw new SshSetupError('SSH setup cancelled.');
        const keyPath = projectPath(
            this.dependencies.directory,
            requirement.keyPath,
        );
        const passphrasePath = projectPath(
            this.dependencies.directory,
            requirement.passphrasePath,
        );
        const selectedRealpath = await this.resolveSelectedKey(input);
        const { keyExists, sameKey } = await this.reconcileExistingKey(
            keyPath,
            selectedRealpath,
            input.replace,
        );
        const { passphraseExists, passphraseSecure } =
            await this.inspectPassphrase(passphrasePath, input.replace);
        if (sameKey && passphraseSecure && !input.replace) return;
        await this.dependencies.files.mkdir(
            join(this.dependencies.directory, 'local'),
        );
        await this.installSecrets({
            selectedRealpath,
            keyPath,
            passphrasePath,
            keyExists,
            passphraseExists,
            passphrase: input.passphrase,
            replace: input.replace,
        });
    }
}
