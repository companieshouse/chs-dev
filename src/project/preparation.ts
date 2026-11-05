import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    LiveFailure,
    type ConfigurationRevision,
    type PreparationApi,
    type PreparedProject,
} from '../domain/live.js';
import type { OperationContext } from '../domain/runtime-strategy.js';
import { ProjectError } from './compose.js';
import { nodeProjectFs, type ProjectFs } from './files.js';
import {
    cloneRepository,
    prepareProject,
    projectIdentity,
    resolveProject,
} from './prepare.js';
import type { LiveFiles } from '../infrastructure/live-files.js';
import type { ProcessExecutor } from '../infrastructure/live-process.js';
import type { RuntimeEnvironment } from '../infrastructure/live-runtime.js';

export interface ProjectPreparationDependencies {
    /** The project checkout; only read, except for cloning `repositories/<service>`. */
    directory: string;
    /** Where prepared Compose files are written. */
    stateDirectory: string;
    files: Pick<LiveFiles, 'mkdir' | 'remove'>;
    execute: ProcessExecutor;
    environment: RuntimeEnvironment;
    projectFs?: ProjectFs;
    operationId?: () => string;
}

type ResolvedProject = Awaited<ReturnType<PreparationApi['resolve']>>;

function failure(
    error: unknown,
    kind: 'blocked' | 'failed',
    signal?: AbortSignal,
): unknown {
    if (signal?.aborted || error instanceof LiveFailure) return error;

    const message = error instanceof Error ? error.message : String(error);

    return new LiveFailure(
        error instanceof ProjectError
            ? message
            : `Project preparation failed: ${message}`,
        kind,
    );
}

/** Resolves and prepares the project in-process, without running code from it. */
export class ProjectPreparation implements PreparationApi {
    private operations: string[] = [];
    private retained = new Set<string>();
    private identity?: { projectName: string; projectDirectory: string };
    private readonly fs: ProjectFs;

    constructor(private readonly dependencies: ProjectPreparationDependencies) {
        this.fs = dependencies.projectFs ?? nodeProjectFs;
    }

    get projectName() {
        return this.identity?.projectName;
    }

    async check(signal?: AbortSignal) {
        try {
            await this.dependencies.environment.refresh?.();
            this.identity = await projectIdentity(this.dependencies.directory, {
                fs: this.fs,
                env: await this.dependencies.environment.resolve([], signal),
            });
        } catch (error) {
            throw failure(error, 'blocked', signal);
        }
    }

    private resolved(
        value: ResolvedProject,
        revision: ConfigurationRevision,
    ): ResolvedProject {
        if (
            !this.identity ||
            value.projectName !== this.identity.projectName ||
            value.projectDirectory !== this.identity.projectDirectory ||
            value.configurationIdentity !== revision.identity
        ) {
            throw new LiveFailure(
                'Project or configuration identity changed.',
                'blocked',
            );
        }

        return value;
    }

    async resolve(
        revision: ConfigurationRevision,
        context: OperationContext,
    ): Promise<ResolvedProject> {
        let value: ResolvedProject;

        try {
            value = await resolveProject(
                {
                    projectDirectory: this.dependencies.directory,
                    configuration: revision.yaml,
                },
                {
                    fs: this.fs,
                    env: await this.dependencies.environment.resolve(
                        [],
                        context.signal,
                    ),
                },
            );
        } catch (error) {
            throw failure(error, 'blocked', context.signal);
        }

        return this.resolved(value, revision);
    }

    private repositoryCloner(
        env: NodeJS.ProcessEnv,
        context: OperationContext,
    ) {
        return cloneRepository(
            this.fs,
            async (command, args, runEnv) => {
                context.onOutput?.({
                    stream: 'stderr',
                    text: `Cloning ${args.at(-1)}`,
                });

                const result = await this.dependencies.execute({
                    command,
                    args,
                    cwd: this.dependencies.directory,
                    env: runEnv,
                    signal: context.signal,
                    onOutput: context.onOutput,
                });
                if (result.code === 0) return;

                throw new ProjectError(
                    `git clone failed: ${result.stderr.trim().slice(-800) || `exit ${result.code}`}`,
                );
            },
            env,
        );
    }

    async prepare(
        revision: ConfigurationRevision,
        context: OperationContext,
    ): Promise<PreparedProject> {
        const id = this.dependencies.operationId?.() ?? randomUUID();
        if (!/^[a-zA-Z0-9-]+$/.test(id))
            throw new Error('Invalid operation directory identity.');

        const parent = join(this.dependencies.stateDirectory, 'operations');
        const root = join(parent, id);
        const { signal } = context;
        const progress = (text: string) =>
            context.onOutput?.({ stream: 'stderr', text });
        let prepared: PreparedProject;

        try {
            await this.dependencies.files.mkdir(parent);
            this.operations.push(root);

            const env = await this.dependencies.environment.resolve([], signal);
            prepared = await prepareProject(
                {
                    projectDirectory: this.dependencies.directory,
                    configuration: revision.yaml,
                    outputDirectory: root,
                },
                {
                    fs: this.fs,
                    env,
                    progress,
                    environment: async (names) => {
                        await this.dependencies.environment.resolve(
                            names,
                            signal,
                        );
                    },
                    prepareRepository: this.repositoryCloner(env, context),
                },
            );
        } catch (error) {
            throw failure(error, 'failed', signal);
        }

        this.resolved(prepared, revision);
        // Running containers may bind-mount generated files even after Compose exits.
        this.retained.add(root);

        return prepared;
    }

    async cleanup() {
        const roots = this.operations.splice(0);

        for (const root of roots) {
            if (this.retained.has(root)) continue;

            await this.dependencies.files.remove(root);
        }

        this.retained.clear();
    }
}
