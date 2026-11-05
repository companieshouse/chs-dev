import { isAbsolute } from 'node:path';
import {
    LiveFailure,
    type ContainerAction,
    type LiveRuntime,
    type PreparedProject,
    type RuntimeContainer,
    type RuntimeSnapshot,
    type RuntimeOperationResult,
    type ServiceMode,
} from '../domain/live.js';
import type {
    OperationContext,
    RuntimeEnvironment,
} from '../domain/runtime-strategy.js';
export type { RuntimeEnvironment } from '../domain/runtime-strategy.js';
import type { ProcessExecutor } from './live-process.js';

export interface DockerLiveDependencies {
    execute: ProcessExecutor;
    environment: RuntimeEnvironment;
    realpath(path: string): Promise<string>;
    directory: string;
    projectName: string;
}
export function composeArguments(project: PreparedProject): string[] {
    if (
        !project.projectName ||
        !isAbsolute(project.projectDirectory) ||
        !project.composeFiles.length ||
        project.composeFiles.some((file) => !isAbsolute(file))
    ) {
        throw new LiveFailure(
            'Preparation returned invalid Compose paths or project identity.',
            'blocked',
        );
    }
    return [
        'compose',
        '--project-name',
        project.projectName,
        '--project-directory',
        project.projectDirectory,
        '--env-file',
        '/dev/null',
        ...project.composeFiles.flatMap((file) => ['-f', file]),
    ];
}
const ecrHost = /\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/;
/** Returns the ECR registry from a line reporting an authorization failure. */
export function ecrAuthorizationFailure(stderr: string): string | undefined {
    for (const line of stderr.split(/\r?\n/)) {
        const host = ecrHost.exec(line)?.[0];
        if (host && /\b40[13]\b|forbidden|denied:/i.test(line)) return host;
    }
    return undefined;
}
function checkResult(
    result: { code: number; stderr: string },
    operation: string,
) {
    if (result.code === 0) return;
    const registry = ecrAuthorizationFailure(result.stderr);
    if (
        registry ||
        /no basic auth credentials|authorization token has expired|pull access denied|unauthorized|authentication required/i.test(
            result.stderr,
        )
    ) {
        throw new LiveFailure(
            `ECR authentication failed${registry ? ` for ${registry}` : ''}. Press Ctrl+L and choose AWS + registry login, then try again. Check the ECR login profiles in Config if this registry is not covered.`,
            'ecr',
        );
    }
    throw new LiveFailure(
        `${operation} failed (exit ${result.code}): ${result.stderr}`,
    );
}
interface DockerInspection {
    Id: string;
    Config: { Labels: Record<string, string> };
    State: {
        Status: string;
        Health?: { Status: string };
        ExitCode?: number;
        OOMKilled?: boolean;
    };
}
export class DockerLiveRuntime implements LiveRuntime {
    constructor(private readonly dependencies: DockerLiveDependencies) {}
    private async run(
        args: string[],
        context: OperationContext = {},
        requirements: readonly string[] = [],
        timeout?: number,
    ) {
        return this.dependencies.execute({
            command: 'docker',
            args,
            captureStdout:
                args[0] === 'ps' ||
                args[0] === 'inspect' ||
                args.includes('--services'),
            cwd: this.dependencies.directory,
            env: await this.dependencies.environment.resolve(
                requirements,
                context.signal,
            ),
            ...context,
            timeout,
        });
    }
    async checkAvailability(signal?: AbortSignal) {
        for (const args of [
            ['info', '--format', '{{.ServerVersion}}'],
            ['compose', 'version', '--short'],
        ]) {
            const result = await this.run(args, { signal }, [], 5000);
            if (result.code !== 0)
                return {
                    available: false,
                    message:
                        'Docker and Compose must be available to start the environment.',
                };
        }
        return {
            available: true,
            message: 'Docker and Compose are available.',
        };
    }
    private guardIds(stdout: string): string[] {
        const ids = stdout.trim().split(/\s+/).filter(Boolean);
        if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
            throw new Error('Docker returned an invalid container ID.');
        return ids;
    }
    private async inspectBatch(
        ids: string[],
        signal?: AbortSignal,
    ): Promise<unknown[]> {
        const values: unknown[] = [];
        for (let offset = 0; offset < ids.length; offset += 100) {
            const result = await this.run(
                ['inspect', ...ids.slice(offset, offset + 100)],
                { signal },
                [],
                5000,
            );
            checkResult(result, 'Docker inspection');
            const parsed: unknown = JSON.parse(result.stdout);
            if (!Array.isArray(parsed))
                throw new Error('Invalid Docker inspection response.');
            values.push(...parsed);
        }
        return values;
    }
    private foreignContainer(
        labels: Record<string, string> | undefined,
        projectName: string,
    ): boolean {
        return (
            !labels ||
            labels['com.docker.compose.project'] !== projectName ||
            labels['com.docker.compose.oneoff']?.toLowerCase() === 'true'
        );
    }
    private incompleteIdentity(
        container: DockerInspection,
        labels: Record<string, string>,
    ): boolean {
        return (
            !container.Id ||
            !/^[a-f0-9]{12,64}$/.test(container.Id) ||
            !labels['com.docker.compose.service'] ||
            !container.State?.Status
        );
    }
    private async matchesWorkingDirectory(working: string, directory: string) {
        let candidate: string;
        try {
            candidate = await this.dependencies.realpath(working);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ENOTDIR') return false;
            throw error;
        }
        return candidate === directory;
    }
    private async runtimeContainer(
        value: DockerInspection,
        projectName: string,
        directory: string,
    ): Promise<RuntimeContainer | undefined> {
        const labels = value.Config?.Labels;
        if (this.foreignContainer(labels, projectName)) return undefined;
        const working = labels['com.docker.compose.project.working_dir'];
        if (!working) return undefined;
        if (!(await this.matchesWorkingDirectory(working, directory)))
            return undefined;
        if (this.incompleteIdentity(value, labels))
            throw new Error('Incomplete Docker container identity.');
        const mode = labels['chs.dev.mode'];
        return {
            id: value.Id,
            service: labels['com.docker.compose.service'],
            projectName,
            projectDirectory: directory,
            configurationIdentity: labels['com.docker.compose.config-hash'],
            ownerService: labels['chs.dev.owner-service'],
            mode: ['Service', 'Development', 'Mock'].includes(mode)
                ? (mode as ServiceMode)
                : undefined,
            lifecycle: value.State.Status,
            health: value.State.Health?.Status,
            ...(typeof value.State.ExitCode === 'number'
                ? { exitCode: value.State.ExitCode }
                : {}),
            ...(typeof value.State.OOMKilled === 'boolean'
                ? { oomKilled: value.State.OOMKilled }
                : {}),
        };
    }
    async snapshot(signal?: AbortSignal): Promise<RuntimeSnapshot> {
        const { projectName } = this.dependencies;
        const directory = await this.dependencies.realpath(
            this.dependencies.directory,
        );
        const listing = await this.run(
            [
                'ps',
                '-aq',
                '--filter',
                `label=com.docker.compose.project=${projectName}`,
            ],
            { signal },
            [],
            5000,
        );
        checkResult(listing, 'Docker inspection');
        const ids = this.guardIds(listing.stdout);
        const containers: RuntimeContainer[] = [];
        for (const value of await this.inspectBatch(ids, signal)) {
            const container = await this.runtimeContainer(
                value as DockerInspection,
                projectName,
                directory,
            );
            if (container) containers.push(container);
        }
        return { projectName, projectDirectory: directory, containers };
    }
    private async owned(project: PreparedProject) {
        if (
            project.projectName !== this.dependencies.projectName ||
            project.projectDirectory !==
                (await this.dependencies.realpath(this.dependencies.directory))
        ) {
            throw new LiveFailure(
                'Prepared Compose project does not belong to this checkout.',
                'blocked',
            );
        }
    }
    async apply(
        project: PreparedProject,
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        await this.owned(project);
        const args = composeArguments(project);
        checkResult(
            await this.run(
                [...args, 'config', '--quiet'],
                context,
                project.environmentRequirements,
            ),
            'Compose validation',
        );
        context.signal?.throwIfAborted();
        const lazy = project.inventory
            .filter((entry) => entry.lazy)
            .map((entry) => entry.service);
        if (!lazy.length) {
            checkResult(
                await this.run(
                    [...args, 'up', '--detach'],
                    context,
                    project.environmentRequirements,
                ),
                'Compose apply',
            );
        } else {
            await this.applyWithLazy(project, args, lazy, context);
        }
        return {
            outcome: 'success',
            message: 'Compose configuration applied.',
            affectedServices: project.inventory.map((entry) => entry.service),
        };
    }
    /**
     * Applies with lazy services deferred: everything else starts, lazy
     * containers are created but not started until first use. Listing the
     * non-lazy services explicitly (with --no-deps) stops Compose pulling a
     * lazy dependency up with an eager dependent.
     */
    private async applyWithLazy(
        project: PreparedProject,
        args: string[],
        lazy: readonly string[],
        context: OperationContext,
    ): Promise<void> {
        const listing = await this.run(
            [...args, 'config', '--services'],
            context,
            project.environmentRequirements,
        );
        checkResult(listing, 'Compose service listing');
        const services = listing.stdout
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean);
        const deferred = services.filter((name) => lazy.includes(name));
        const starting = services.filter((name) => !lazy.includes(name));
        if (starting.length)
            checkResult(
                await this.run(
                    [...args, 'up', '--detach', '--no-deps', ...starting],
                    context,
                    project.environmentRequirements,
                ),
                'Compose apply',
            );
        context.signal?.throwIfAborted();
        if (deferred.length)
            checkResult(
                await this.run(
                    [...args, 'up', '--no-start', '--no-deps', ...deferred],
                    context,
                    project.environmentRequirements,
                ),
                'Compose create',
            );
    }
    async reload(
        project: PreparedProject,
        services: readonly string[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        await this.owned(project);
        const current = await this.snapshot(context.signal);
        const targets = [
            ...new Set(
                current.containers
                    .filter((container) =>
                        services.includes(
                            container.ownerService ?? container.service,
                        ),
                    )
                    .map((container) => container.service),
            ),
        ].sort();
        if (!targets.length)
            throw new LiveFailure(
                `${services.join(', ')} has no containers to reload.`,
            );
        context.signal?.throwIfAborted();
        // Listing builders explicitly with --force-recreate re-runs them; the
        // services still wait for their builders through depends_on.
        checkResult(
            await this.run(
                [
                    ...composeArguments(project),
                    'up',
                    '--detach',
                    '--build',
                    '--force-recreate',
                    '--no-deps',
                    ...targets,
                ],
                context,
                project.environmentRequirements,
            ),
            'Compose reload',
        );
        return {
            outcome: 'success',
            message: 'Services rebuilt.',
            affectedServices: targets,
        };
    }
    async stop(
        containers: RuntimeContainer[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        if (!containers.length)
            return {
                outcome: 'success',
                message: 'No obsolete containers.',
                affectedServices: [],
            };
        const current = await this.snapshot(context.signal);
        const ids = containers
            .filter((requested) =>
                current.containers.some(
                    (actual) =>
                        actual.id === requested.id &&
                        actual.service === requested.service &&
                        actual.projectDirectory ===
                            requested.projectDirectory &&
                        actual.projectName === requested.projectName &&
                        !['exited', 'dead', 'created'].includes(
                            actual.lifecycle,
                        ),
                ),
            )
            .map((container) => container.id);
        for (let offset = 0; offset < ids.length; offset += 100) {
            checkResult(
                await this.run(
                    ['stop', ...ids.slice(offset, offset + 100)],
                    context,
                ),
                'Docker stop',
            );
        }
        return {
            outcome: 'success',
            message: 'Obsolete containers stopped.',
            affectedServices: containers
                .filter((container) => ids.includes(container.id))
                .map((container) => container.service),
        };
    }
    private async verified(
        containers: RuntimeContainer[],
        signal?: AbortSignal,
    ): Promise<RuntimeContainer[]> {
        const current = await this.snapshot(signal);
        return current.containers.filter((actual) =>
            containers.some(
                (requested) =>
                    actual.id === requested.id &&
                    actual.service === requested.service &&
                    actual.projectDirectory === requested.projectDirectory &&
                    actual.projectName === requested.projectName,
            ),
        );
    }
    private async batch(
        command: 'stop' | 'rm' | 'restart' | 'start',
        ids: string[],
        context: OperationContext,
        label: string,
    ) {
        for (let offset = 0; offset < ids.length; offset += 100) {
            checkResult(
                await this.run(
                    [command, ...ids.slice(offset, offset + 100)],
                    context,
                ),
                label,
            );
        }
    }
    async stopProject(
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        const current = await this.snapshot(context.signal);
        const active = current.containers.filter(
            (container) =>
                !['exited', 'dead', 'created'].includes(container.lifecycle),
        );
        await this.batch(
            'stop',
            active.map((container) => container.id),
            context,
            'Docker stop',
        );
        context.signal?.throwIfAborted();
        // Without -v, anonymous and named volumes are kept.
        await this.batch(
            'rm',
            current.containers.map((container) => container.id),
            context,
            'Docker remove',
        );
        return {
            outcome: 'success',
            message: 'Containers stopped and removed.',
            affectedServices: [
                ...new Set(
                    current.containers.map((container) => container.service),
                ),
            ],
        };
    }
    async containerAction(
        action: ContainerAction,
        containers: RuntimeContainer[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        const targets = await this.verified(containers, context.signal);
        await this.batch(
            action,
            targets.map((container) => container.id),
            context,
            `Docker ${action}`,
        );
        return {
            outcome: 'success',
            message: `Docker ${action} completed.`,
            affectedServices: [
                ...new Set(targets.map((container) => container.service)),
            ],
        };
    }
    async logs(
        container: RuntimeContainer,
        options: { tail: number },
        signal?: AbortSignal,
    ): Promise<string[]> {
        const [target] = await this.verified([container], signal);
        if (!target) throw new Error('Container no longer exists.');
        const lines: string[] = [];
        const result = await this.run(
            [
                'logs',
                '--tail',
                String(Math.max(1, Math.min(2000, Math.floor(options.tail)))),
                '--timestamps',
                target.id,
            ],
            {
                signal,
                onOutput: (entry) => {
                    lines.push(entry.text);
                },
            },
            [],
            15000,
        );
        checkResult(result, 'Docker logs');
        return lines;
    }
}
