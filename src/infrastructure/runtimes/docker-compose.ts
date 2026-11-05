import { rethrowIfAborted } from '../cancellation.js';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
    RuntimeStrategy,
    RuntimeProject,
    RuntimeAvailability,
    OperationResult,
} from '../../domain/runtime-strategy.js';
import { readDockerStatuses } from '../docker-status.js';
import { runInteractiveCommand } from '../interactive-command.js';
import { ComposeBackend } from './compose-backend.js';
import {
    createProcessExecutor,
    type ProcessExecutor,
} from '../live-process.js';
import { DockerConnection } from '../docker-connection.js';
import { LiveEnvironment } from '../live-environment.js';
import { awsProfile } from '../aws-status.js';
import { liveFiles } from '../live-files.js';
import { isProfileName } from '../../domain/settings.js';
import { DockerContainerManager } from '../docker-containers.js';

export function dockerRegistryCommand(
    profiles: readonly string[],
    command = 'l_docker',
) {
    if (!profiles.length || profiles.some((profile) => !isProfileName(profile)))
        throw new Error('Registry login requires valid AWS profile names.');
    return {
        command,
        args: [...new Set(profiles)].flatMap((profile) => ['-p', profile]),
    };
}

export class DockerComposeStrategy implements RuntimeStrategy {
    readonly id = 'docker';
    readonly name = 'Docker Compose';
    readonly capabilities = Object.freeze({
        inspect: true,
        registryLogin: true,
        apply: true,
        logs: true,
    });

    private readonly execute: ProcessExecutor;
    private readonly connection: DockerConnection;
    constructor(
        dependencies: {
            execute?: ProcessExecutor;
            environment?: NodeJS.ProcessEnv;
            directory?: string;
        } = {},
    ) {
        this.execute = dependencies.execute ?? createProcessExecutor();
        this.connection = new DockerConnection({
            execute: this.execute,
            environment: dependencies.environment ?? process.env,
            directory: dependencies.directory ?? process.cwd(),
        });
    }

    engineIdentity(signal?: AbortSignal) {
        return this.connection.identity(signal);
    }

    live(project: RuntimeProject): import('../../domain/live.js').LiveRuntime {
        const execute = this.execute;
        const environment =
            project.environment ??
            new LiveEnvironment(
                execute,
                project.directory,
                () => process.env,
                awsProfile,
                liveFiles,
            );
        return new ComposeBackend({
            directory: project.directory,
            get projectName() {
                if (!project.name)
                    throw new Error('Project identity has not been verified.');
                return project.name;
            },
            execute,
            realpath,
            environment: {
                resolve: async (requirements, signal) =>
                    this.connection.environment(
                        await environment.resolve(requirements, signal),
                        signal,
                    ),
            },
        });
    }

    containers(project: RuntimeProject) {
        return new DockerContainerManager({
            directory: project.directory,
            execute: this.execute,
            environment: async (signal) =>
                this.connection.environment(
                    await project.environment?.resolve([], signal),
                    signal,
                ),
        });
    }
    async checkAvailability(
        signal?: AbortSignal,
    ): Promise<RuntimeAvailability> {
        try {
            await this.checkCommand(
                ['info', '--format', '{{.ServerVersion}}'],
                signal,
            );
        } catch (error) {
            rethrowIfAborted(signal, error);
            return {
                available: false,
                message:
                    'Docker is unavailable. Check the CLI, daemon, and current context.',
            };
        }
        try {
            await this.checkCommand(['compose', 'version', '--short'], signal);
            return {
                available: true,
                message: 'Docker and Compose are available.',
            };
        } catch (error) {
            rethrowIfAborted(signal, error);
            return {
                available: false,
                message: 'Docker Compose is unavailable.',
            };
        }
    }

    private async checkCommand(args: string[], signal?: AbortSignal) {
        const result = await this.execute({
            command: 'docker',
            args,
            signal,
            cwd: process.cwd(),
            env: await this.connection.environment({}, signal),
            timeout: 5000,
            privateOutput: true,
        });
        if (result.code !== 0) throw new Error('Docker command failed.');
    }

    inspect(project: RuntimeProject, signal?: AbortSignal) {
        return readDockerStatuses(
            project.directory,
            {
                execute: this.execute,
                environment: (signal) =>
                    this.connection.environment({}, signal),
            },
            signal,
        );
    }

    async loginRegistry(
        { profiles }: { profiles: readonly string[] },
        signal?: AbortSignal,
    ): Promise<OperationResult> {
        const installed = join(homedir(), '.ch_dev', 'bin', 'l_docker');
        const executable = await access(installed, constants.X_OK).then(
            () => installed,
            () => 'l_docker',
        );
        const { command, args } = dockerRegistryCommand(profiles, executable);
        return runInteractiveCommand({
            command,
            args,
            label: 'Docker ECR login',
            missingMessage:
                'l_docker is not installed. Install it using dev-env-setup.',
            signal,
            environment: process.env,
        });
    }
}
