import { createHash } from 'node:crypto';
import type { ProcessExecutor } from './live-process.js';

/** Docker selectors are daemon startup inputs, never per-project credentials. */
export const dockerEnvironmentKeys = [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'DOCKER_API_VERSION',
] as const;

/** One selected engine for Compose, status inspection, proxy and exact-container controls. */
export class DockerConnection {
    private readonly startup: NodeJS.ProcessEnv;
    private selected?: Promise<NodeJS.ProcessEnv>;
    constructor(
        private readonly dependencies: {
            execute: ProcessExecutor;
            environment: NodeJS.ProcessEnv;
            directory: string;
        },
    ) {
        this.startup = { ...dependencies.environment };
    }

    private async command(
        args: string[],
        env: NodeJS.ProcessEnv,
        signal?: AbortSignal,
    ) {
        const result = await this.dependencies.execute({
            command: 'docker',
            args,
            env,
            signal,
            cwd: this.dependencies.directory,
            timeout: 5000,
            captureStdout: true,
            privateOutput: true,
        });
        signal?.throwIfAborted();
        if (result.code !== 0)
            throw new Error('Cannot verify the selected Docker engine.');
        return result.stdout.trim();
    }

    private async select(signal?: AbortSignal) {
        const env = { ...this.startup };
        if (env.DOCKER_HOST && !env.DOCKER_CONTEXT) return env;
        const context =
            env.DOCKER_CONTEXT ||
            (await this.command(['context', 'show'], env, signal));
        if (!context) throw new Error('Cannot determine the Docker context.');
        env.DOCKER_CONTEXT = context;
        const endpoint = JSON.parse(
            await this.command(
                [
                    'context',
                    'inspect',
                    context,
                    '--format',
                    '{{json .Endpoints.docker}}',
                ],
                env,
                signal,
            ),
        ) as { Host?: string };
        // Local sockets need no context-held transport credentials. Pin the endpoint itself.
        if (
            /^(unix|npipe):\/\//.test(endpoint.Host ?? '') &&
            !env.DOCKER_TLS_VERIFY &&
            !env.DOCKER_TLS
        ) {
            env.DOCKER_HOST = endpoint.Host;
            delete env.DOCKER_CONTEXT;
        }
        return env;
    }

    async environment(base: NodeJS.ProcessEnv = {}, signal?: AbortSignal) {
        this.selected ??= this.select(signal).catch((error) => {
            this.selected = undefined;
            throw error;
        });
        const selected = await this.selected;
        const env = { ...this.startup, ...base };
        for (const key of dockerEnvironmentKeys) delete env[key];
        for (const key of dockerEnvironmentKeys) {
            if (selected[key] !== undefined) env[key] = selected[key];
        }
        return env;
    }

    /** Undefined means explicit use is supported, but automatic recovery is unsafe. */
    async identity(signal?: AbortSignal): Promise<string | undefined> {
        const env = await this.environment({}, signal);
        if (
            !/^(unix|npipe):\/\//.test(env.DOCKER_HOST ?? '') ||
            env.DOCKER_CONTEXT ||
            env.DOCKER_TLS ||
            env.DOCKER_TLS_VERIFY
        )
            return undefined;
        const id = await this.command(
            ['info', '--format', '{{.ID}}'],
            env,
            signal,
        );
        if (!id) throw new Error('Docker engine identity is unavailable.');
        return createHash('sha256')
            .update(`${env.DOCKER_HOST}\n${id}`)
            .digest('hex');
    }
}
