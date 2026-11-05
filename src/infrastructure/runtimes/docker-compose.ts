import { rethrowIfAborted } from '../cancellation.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { createProcessExecutor } from '../live-process.js';
import { LiveEnvironment } from '../live-environment.js';
import { awsProfile } from '../aws-status.js';
import { liveFiles } from '../live-files.js';
import { isProfileName } from '../../domain/settings.js';
import { DockerContainerManager } from '../docker-containers.js';

const exec = promisify(execFile);

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
    readonly name: string = 'Docker';
    readonly capabilities = Object.freeze({
        inspect: true,
        registryLogin: true,
        apply: true,
        logs: true,
    });

    live(project: RuntimeProject): import('../../domain/live.js').LiveRuntime {
        const execute = createProcessExecutor();
        return new ComposeBackend({
            directory: project.directory,
            get projectName() {
                if (!project.name)
                    throw new Error('Project identity has not been verified.');
                return project.name;
            },
            execute,
            realpath,
            environment:
                project.environment ??
                new LiveEnvironment(
                    execute,
                    project.directory,
                    () => process.env,
                    awsProfile,
                    liveFiles,
                ),
        });
    }

    containers(project: RuntimeProject) {
        return new DockerContainerManager({
            directory: project.directory,
            execute: createProcessExecutor(),
            environment: (signal) => this.containerEnvironment(project, signal),
        });
    }
    protected async containerEnvironment(
        project: RuntimeProject,
        signal?: AbortSignal,
    ): Promise<NodeJS.ProcessEnv> {
        return project.environment
            ? project.environment.resolve([], signal)
            : { ...process.env };
    }

    async checkAvailability(
        signal?: AbortSignal,
    ): Promise<RuntimeAvailability> {
        try {
            await exec('docker', ['info', '--format', '{{.ServerVersion}}'], {
                signal,
                timeout: 5000,
            });
        } catch (error) {
            rethrowIfAborted(signal, error);
            return {
                available: false,
                message:
                    'Docker is unavailable. Check the CLI, daemon, and current context.',
            };
        }
        try {
            await exec('docker', ['compose', 'version', '--short'], {
                signal,
                timeout: 5000,
            });
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

    inspect(project: RuntimeProject, signal?: AbortSignal) {
        return readDockerStatuses(project.directory, signal);
    }

    protected async registryEnvironment(
        signal?: AbortSignal,
    ): Promise<NodeJS.ProcessEnv> {
        return process.env;
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
            environment: await this.registryEnvironment(signal),
        });
    }
}
