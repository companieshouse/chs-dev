import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type {
    RuntimeStrategy,
    RuntimeProject,
    OperationResult,
} from '../../domain/runtime-strategy.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import { isProfileName } from '../../domain/settings.js';
import { NativeOrchestrator } from '../native/runtime.js';
import {
    AppleRuntimeAdapter,
    appleNamespace,
} from '../native/apple-adapter.js';
import {
    PortableChsAdapter,
    adaptPortableProject,
} from '../native/portable-chs.js';
import { PortableDefinitionCompiler } from '../native/portable-compiler.js';
import { AppleClient } from '../native/apple-client.js';
import { AppleContainerManager } from '../apple-containers.js';
import {
    createProcessExecutor,
    type ProcessExecutor,
} from '../live-process.js';
import { LiveEnvironment } from '../live-environment.js';
import { awsFailure, awsProfile } from '../aws-status.js';
import { runAwsLogin } from '../aws-login.js';
import { liveFiles } from '../live-files.js';
import { projectStateDirectory } from '../settings.js';
import { safeLog } from '../../domain/live-logs.js';

function requireLoginSuccess(login: OperationResult, cancel: () => void) {
    if (login.outcome !== 'success') {
        if (login.outcome === 'cancelled') cancel();
        throw new Error(login.message);
    }
}

export class AppleNativeStrategy implements RuntimeStrategy {
    readonly id = 'apple';
    readonly name = 'Apple containers / Native';
    readonly capabilities = Object.freeze({
        inspect: true,
        registryLogin: true,
        apply: true,
        logs: true,
    });
    private readonly sessions = new Map<
        string,
        { runtime: NativeOrchestrator; manager: AppleContainerManager }
    >();
    private readonly projects = new Map<string, RuntimeProject>();
    private readonly execute: ProcessExecutor;
    private readonly client: AppleClient;
    constructor(
        execute = createProcessExecutor(),
        private readonly loginAws = runAwsLogin,
    ) {
        this.execute = execute;
        this.client = new AppleClient({
            directory: process.cwd(),
            execute,
            environment: { resolve: async () => ({ ...process.env }) },
        });
    }
    private session(project: RuntimeProject) {
        const directory = realpathSync(project.directory);
        if (project.environment || !this.projects.has(directory))
            this.projects.set(directory, project);
        let session = this.sessions.get(directory);
        if (!session) {
            const projects = this.projects,
                fallback = new LiveEnvironment(
                    this.execute,
                    directory,
                    () => process.env,
                    awsProfile,
                    liveFiles,
                );
            const adapter = new AppleRuntimeAdapter({
                directory,
                get projectName() {
                    return projects.get(directory)?.name ?? 'unverified';
                },
                stateDirectory: projectStateDirectory(directory),
                execute: this.execute,
                environment: {
                    resolve: (names, signal) =>
                        (
                            projects.get(directory)?.environment ?? fallback
                        ).resolve(names, signal),
                },
            });
            const portable = new PortableChsAdapter(
                adapter,
                adapter.state,
                true,
            );
            const compiler = new PortableDefinitionCompiler();
            const runtime = new NativeOrchestrator({
                directory,
                get projectName() {
                    return projects.get(directory)?.name ?? 'unverified';
                },
                stateDirectory: projectStateDirectory(directory),
                adapter: portable,
                compiler: {
                    compile: async (prepared, context) => {
                        const result = await compiler.compile(
                            prepared,
                            context,
                        );
                        result.namespace = appleNamespace(directory);
                        return result;
                    },
                },
                adapt: adaptPortableProject,
            });
            session = {
                runtime,
                manager: new AppleContainerManager(adapter, (context) =>
                    portable.publish(context),
                ),
            };
            this.sessions.set(directory, session);
        }
        return session;
    }
    live(project: RuntimeProject) {
        return this.session(project).runtime;
    }
    containers(project: RuntimeProject) {
        return this.session(project).manager;
    }
    checkAvailability(signal?: AbortSignal) {
        return this.client.availability(signal);
    }
    async startService(signal?: AbortSignal): Promise<OperationResult> {
        try {
            const installation = await this.client.installation(signal);
            if (!installation.available)
                return { outcome: 'failed', message: installation.message };
            await this.client.checked(
                ['system', 'start', '--enable-kernel-install'],
                { signal },
                { timeout: 180000 },
            );
            return {
                outcome: 'success',
                message: 'Apple container service started.',
            };
        } catch (error) {
            return {
                outcome: signal?.aborted ? 'cancelled' : 'failed',
                message: safeLog(
                    error instanceof Error ? error.message : String(error),
                ),
            };
        }
    }
    async inspect(
        project: RuntimeProject,
        signal?: AbortSignal,
    ): Promise<Record<string, ServiceStatus>> {
        const snapshot = await this.live(project).snapshot(signal);
        return Object.fromEntries(
            snapshot.containers.map((c) => [
                c.service,
                c.lifecycle === 'running'
                    ? c.health === 'healthy'
                        ? 'Healthy'
                        : c.health === 'unhealthy'
                          ? 'Unhealthy'
                          : c.health === 'starting'
                            ? 'Starting'
                            : 'Running'
                    : c.kind === 'job' && c.exitCode === 0
                      ? 'Completed'
                      : 'Stopped',
            ]),
        );
    }
    private async awsCommand(
        profile: string,
        args: string[],
        context: {
            signal: AbortSignal;
            renewed: Set<string>;
            cancel: () => void;
        },
    ): Promise<string> {
        const { signal, renewed, cancel } = context;
        signal.throwIfAborted();
        const result = await this.execute({
            command: 'aws',
            args: [...args, '--profile', profile],
            cwd: process.cwd(),
            env: {
                ...process.env,
                AWS_PAGER: '',
                AWS_CLI_AUTO_PROMPT: 'off',
            },
            signal,
            timeout: 30000,
            privateOutput: true,
            captureStderr: true,
        });
        signal.throwIfAborted();
        if (result.code !== 0) {
            const { state } = awsFailure({ stderr: result.stderr });
            if (
                (state === 'expired' || state === 'signed-out') &&
                !renewed.has(profile)
            ) {
                renewed.add(profile);
                const login = await this.loginAws(profile, signal);
                requireLoginSuccess(login, cancel);
                return this.awsCommand(profile, args, context);
            }
            throw new Error(
                result.stderr ||
                    'AWS credentials are unavailable. Log into AWS and retry.',
            );
        }
        return result.stdout.trim();
    }
    private loginFailureMessage(
        currentProfile: string | undefined,
        error: unknown,
        secrets: string[],
    ): string {
        const scope = currentProfile
            ? ` for AWS profile ${currentProfile}`
            : '';
        const detail = safeLog(
            error instanceof Error ? error.message : String(error),
            secrets,
        );
        return `Apple registry login${scope} failed: ${detail}`;
    }
    private async loginRegistryProfile(
        profile: string,
        context: {
            signal: AbortSignal;
            renewed: Set<string>;
            cancel: () => void;
        },
        secrets: string[],
    ) {
        const { signal } = context;
        const account = await this.awsCommand(
            profile,
            [
                'sts',
                'get-caller-identity',
                '--query',
                'Account',
                '--output',
                'text',
            ],
            context,
        );
        const region = await this.awsCommand(
            profile,
            ['configure', 'get', 'region'],
            context,
        );
        if (!/^\d{12}$/.test(account) || !/^([a-z]+-)+\d+$/.test(region))
            throw new Error(`Profile ${profile} has no valid account/region.`);
        const password = await this.awsCommand(
            profile,
            ['ecr', 'get-login-password', '--region', region],
            context,
        );
        if (!password) throw new Error('AWS returned an empty ECR password.');
        secrets.push(password);
        await this.client.checked(
            [
                'registry',
                'login',
                '--username',
                'AWS',
                '--password-stdin',
                `${account}.dkr.ecr.${region}.amazonaws.com`,
            ],
            { signal },
            { stdin: password + '\n' },
        );
    }
    private registryLoginFailure(
        signal: AbortSignal,
        profile: string | undefined,
        error: unknown,
        secrets: string[],
    ): OperationResult {
        return signal.aborted
            ? {
                  outcome: 'cancelled',
                  message: 'Apple registry login cancelled.',
              }
            : {
                  outcome: 'failed',
                  message: this.loginFailureMessage(profile, error, secrets),
              };
    }
    async loginRegistry(
        { profiles }: { profiles: readonly string[] },
        parentSignal?: AbortSignal,
    ): Promise<OperationResult> {
        if (!profiles.length || profiles.some((p) => !isProfileName(p)))
            return {
                outcome: 'failed',
                message: 'Registry login requires valid AWS profiles.',
            };
        const abort = new AbortController();
        const cancel = () => abort.abort();
        parentSignal?.addEventListener('abort', cancel, { once: true });
        if (parentSignal?.aborted) cancel();
        process.on('SIGINT', cancel);
        const signal = abort.signal;
        const renewed = new Set<string>();
        const secrets: string[] = [];
        let currentProfile: string | undefined;
        const context = { signal, renewed, cancel };
        try {
            for (const profile of new Set(profiles)) {
                currentProfile = profile;
                await this.loginRegistryProfile(profile, context, secrets);
            }
            return {
                outcome: 'success',
                message: 'Apple registry login completed.',
            };
        } catch (error) {
            return {
                ...this.registryLoginFailure(
                    signal,
                    currentProfile,
                    error,
                    secrets,
                ),
            };
        } finally {
            process.off('SIGINT', cancel);
            parentSignal?.removeEventListener('abort', cancel);
        }
    }
}
