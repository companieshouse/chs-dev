import type { RuntimeEnvironment } from './live-runtime.js';
import type { ProcessExecutor } from './live-process.js';
import { LiveFailure } from '../domain/live.js';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import type { LiveFiles } from './live-files.js';

export class LiveEnvironment implements RuntimeEnvironment {
    private snapshot?: NodeJS.ProcessEnv;
    constructor(
        private readonly execute: ProcessExecutor,
        private readonly directory: string,
        private readonly base: () => NodeJS.ProcessEnv,
        private readonly profile: () => string,
        private readonly files: Pick<LiveFiles, 'read' | 'realpath'>,
    ) {}
    async refresh(): Promise<void> {
        const values: NodeJS.ProcessEnv = {};
        for (const name of ['global.env', '.env']) {
            try {
                Object.assign(
                    values,
                    parseEnv(await this.files.read(join(this.directory, name))),
                );
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw new LiveFailure(
                        `Cannot read project environment file ${name}.`,
                        'blocked',
                    );
                }
            }
        }
        this.snapshot = Object.freeze({
            ...values,
            ...this.base(),
            CHS_DEV_ROOT: await this.files.realpath(this.directory),
            AWS_PAGER: '',
            AWS_CLI_AUTO_PROMPT: 'off',
        });
    }
    async resolve(
        requirements: readonly string[],
        signal?: AbortSignal,
    ): Promise<NodeJS.ProcessEnv> {
        if (!this.snapshot) await this.refresh();
        const env: NodeJS.ProcessEnv = { ...this.snapshot };
        if (requirements.some((name) => name.startsWith('AWS_'))) {
            const result = await this.execute({
                command: 'aws',
                args: [
                    'configure',
                    'export-credentials',
                    '--profile',
                    this.profile(),
                    '--format',
                    'process',
                ],
                cwd: this.directory,
                env,
                signal,
                timeout: 12000,
            });
            if (result.code !== 0)
                throw new LiveFailure(
                    'Cannot acquire AWS credentials. Press Ctrl+L to log in.',
                    'aws',
                );
            mergeCredentials(env, result.stdout);
        }
        for (const requirement of requirements) {
            if (!/^[A-Z_][A-Z0-9_]*$/.test(requirement) || !env[requirement]) {
                throw new LiveFailure(
                    `Required environment variable ${requirement} is unavailable. Set it in this checkout's .env file and retry. The daemon does not inherit exports from a connected frontend's shell.`,
                    'blocked',
                );
            }
        }
        return env;
    }
}

function mergeCredentials(env: NodeJS.ProcessEnv, output: string) {
    const credentials: unknown = JSON.parse(output);
    if (!credentials || typeof credentials !== 'object')
        throw new LiveFailure('Invalid AWS credential response.', 'blocked');
    const values = credentials as Record<string, unknown>;
    for (const [key, source] of [
        ['AWS_ACCESS_KEY_ID', 'AccessKeyId'],
        ['AWS_SECRET_ACCESS_KEY', 'SecretAccessKey'],
        ['AWS_SESSION_TOKEN', 'SessionToken'],
    ] as const) {
        if (typeof values[source] === 'string') env[key] = values[source];
    }
}
