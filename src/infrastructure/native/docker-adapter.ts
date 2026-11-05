import { rethrowIfAborted } from '../cancellation.js';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RuntimeContainer, RuntimeSnapshot } from '../../domain/live.js';
import { LiveFailure } from '../../domain/live.js';
import type {
    OperationContext,
    RuntimeEnvironment,
} from '../../domain/runtime-strategy.js';
import type {
    ResolvedProject,
    ResourceSpec,
    ServiceSpec,
} from '../../domain/orchestration.js';
import { executeGraph } from '../../domain/orchestration.js';
import type {
    RuntimeAdapter,
    ObservedContainer,
} from '../../domain/runtime-adapter.js';
import type { ProcessExecutor } from '../live-process.js';
import { namespace, type CompilationContext } from './compiler.js';
import {
    DockerHttpClient,
    DockerError,
    resolveDockerConnection,
    containerBody,
    desktopLabels,
    ownership,
    dockerCommand,
    type DockerApi,
    type DockerConnection,
} from './docker.js';

export interface DockerAdapterDependencies {
    directory: string;
    projectName: string;
    execute: ProcessExecutor;
    environment: RuntimeEnvironment;
    api?: DockerApi;
    policy?: { pulls?: number };
}
export function immutableImageReference(
    image: { Id: string; RepoDigests?: string[] },
    reference?: string,
): string {
    const repository = (value: string) =>
        value
            .split('@')[0]
            .replace(/:[^/:]+$/, '')
            .replace(/^(?:docker.io|index.docker.io)\//, '')
            .replace(/^library\//, '');
    return (
        image.RepoDigests?.find(
            (digest) =>
                reference && repository(digest) === repository(reference),
        ) ?? image.Id
    );
}
function dockerFailureHint(error: unknown, detail: string) {
    let hint: string | undefined;
    if (error instanceof DockerError) {
        if (/invalid IP address in add-host/i.test(detail))
            hint =
                'Check extra_hosts: each hostname must map to an IP address or host-gateway.';
        else if (
            /port is already allocated|address already in use/i.test(detail)
        )
            hint =
                'Another process or container is using a requested host port. Free that port or change the service port mapping, then try again.';
        else if (/bind source path does not exist/i.test(detail))
            hint =
                'Check that the service bind-mount paths exist and are accessible to Docker, then try again.';
    }
    return hint;
}
function requestedBuild(spec: ServiceSpec, reload: readonly string[]) {
    return (
        spec.build &&
        (spec.pullPolicy === 'build' ||
            reload.includes(spec.owner) ||
            !spec.image)
    );
}
async function containerOperation<T>(
    action: string,
    service: string,
    context: OperationContext,
    work: () => Promise<T>,
    source?: string,
): Promise<T> {
    try {
        return await work();
    } catch (error) {
        rethrowIfAborted(context.signal, error);
        const detail =
            error instanceof DockerError && error.detail
                ? `Docker: ${error.detail} (HTTP ${error.status})`
                : error instanceof Error
                  ? error.message
                  : String(error);
        const hint = dockerFailureHint(error, detail);
        const failure = new LiveFailure(
            [
                `Could not ${action} container for ${service}.`,
                detail,
                source ? `Definition: ${source}` : undefined,
                hint,
            ]
                .filter(Boolean)
                .join('\n'),
            error instanceof LiveFailure ? error.kind : 'failed',
            error instanceof LiveFailure ? error.reason : undefined,
        );
        failure.cause = error;
        throw failure;
    }
}
const filters = (labels: string[]) =>
    encodeURIComponent(JSON.stringify({ label: labels }));
function canBuildMissingImage(spec: ServiceSpec) {
    return Boolean(spec.build) && spec.pullPolicy !== 'never';
}

export class DockerRuntimeAdapter implements RuntimeAdapter {
    readonly name = 'Docker';
    private connection?: Promise<DockerConnection>;
    private client?: Promise<DockerApi>;
    constructor(private readonly dependencies: DockerAdapterDependencies) {}
    private async connect(signal?: AbortSignal) {
        if (!this.connection)
            this.connection = resolveDockerConnection(
                this.dependencies.execute,
                this.dependencies.directory,
                await this.dependencies.environment.resolve([], signal),
                signal,
            ).catch((error) => {
                this.connection = undefined;
                throw error;
            });
        return this.connection;
    }
    private async api(signal?: AbortSignal): Promise<DockerApi> {
        if (this.dependencies.api) return this.dependencies.api;
        if (!this.client)
            this.client = this.connect(signal)
                .then(async (connection) => {
                    const client = new DockerHttpClient(connection.socket);
                    await client.negotiate(
                        signal,
                        connection.environment.DOCKER_API_VERSION,
                    );
                    return client;
                })
                .catch((error) => {
                    this.client = undefined;
                    throw error;
                });
        return this.client;
    }
    async commandEnvironment(signal?: AbortSignal) {
        return (await this.connect(signal)).environment;
    }
    private async context(
        context: OperationContext,
        requirements: readonly string[] = [],
    ): Promise<CompilationContext> {
        const connection = await this.connect(context.signal);
        const environment: NodeJS.ProcessEnv = {
            ...(await this.dependencies.environment.resolve(
                requirements,
                context.signal,
            )),
            DOCKER_HOST: connection.environment.DOCKER_HOST,
        };
        delete environment.DOCKER_CONTEXT;
        return { ...context, environment };
    }
    async checkAvailability(signal?: AbortSignal) {
        try {
            await this.api(signal);
            return {
                available: true,
                message: 'Docker is available.',
            };
        } catch (error) {
            rethrowIfAborted(signal, error);
            return {
                available: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
    private owns(inspect: any) {
        const labels = inspect.Config?.Labels ?? {};
        return (
            labels['chs.dev.project'] ===
                namespace(this.dependencies.directory) &&
            labels['chs.dev.directory'] === this.dependencies.directory &&
            labels['chs.dev.backend'] === 'native'
        );
    }
    private async inspected(signal?: AbortSignal) {
        const api = await this.api(signal);
        const listed = await api.call<any[]>(
            'GET',
            `/containers/json?all=true&filters=${filters([`chs.dev.project=${namespace(this.dependencies.directory)}`])}`,
            undefined,
            signal,
        );
        const result: any[] = [];
        for (const c of listed) {
            try {
                const detail = await api.call(
                    'GET',
                    `/containers/${c.Id}/json`,
                    undefined,
                    signal,
                );
                if (this.owns(detail)) result.push(detail);
            } catch (error) {
                if (!(error instanceof DockerError && error.status === 404))
                    throw error;
            }
        }
        return result;
    }
    private normalize(c: any): RuntimeContainer {
        const l = c.Config.Labels;
        const presentation = desktopLabels(
            {
                identity: this.dependencies.projectName,
                namespace: namespace(this.dependencies.directory),
            },
            l['chs.dev.service'],
        );
        const currentPresentation =
            c.Name?.replace(/^\//, '') === l['chs.dev.service'] &&
            Object.entries(presentation).every(
                ([key, value]) => l[key] === value,
            );
        return {
            id: c.Id,
            service: l['chs.dev.service'],
            projectName: this.dependencies.projectName,
            projectDirectory: this.dependencies.directory,
            configurationIdentity: currentPresentation
                ? l['chs.dev.fingerprint']
                : undefined,
            mode: l['chs.dev.mode'],
            ownerService: l['chs.dev.owner-service'],
            kind: l['chs.dev.kind'],
            lifecycle: c.State.Status,
            health: c.State.Health?.Status,
            exitCode: c.State.ExitCode,
            oomKilled: c.State.OOMKilled,
        };
    }
    async snapshot(signal?: AbortSignal): Promise<RuntimeSnapshot> {
        return {
            projectName: this.dependencies.projectName,
            projectDirectory: this.dependencies.directory,
            containers: (await this.inspected(signal)).map((c) =>
                this.normalize(c),
            ),
        };
    }
    private async verify(id: string, signal?: AbortSignal) {
        const c = await (
            await this.api(signal)
        ).call(
            'GET',
            `/containers/${encodeURIComponent(id)}/json`,
            undefined,
            signal,
        );
        if (!this.owns(c))
            throw new LiveFailure(
                'Container ownership changed; refusing operation.',
                'blocked',
            );
        return c;
    }
    private async checkBackend(signal?: AbortSignal) {
        const containers = await (
            await this.api(signal)
        ).call<any[]>(
            'GET',
            `/containers/json?all=true&filters=${filters(['com.docker.compose.project'])}`,
            undefined,
            signal,
        );
        for (const c of containers) {
            const directory =
                c.Labels?.['com.docker.compose.project.working_dir'];
            if (
                directory &&
                (await realpath(directory).catch(() => directory)) ===
                    this.dependencies.directory
            )
                throw new LiveFailure(
                    'Compose containers still exist for this checkout. Stop the Compose environment before using native Docker. Its data volumes will be kept.',
                    'blocked',
                );
        }
    }
    private async existingResource(
        api: DockerApi,
        kind: 'networks' | 'volumes',
        name: string,
        context: OperationContext,
    ) {
        try {
            return await api.call(
                'GET',
                `/${kind}/${encodeURIComponent(name)}`,
                undefined,
                context.signal,
            );
        } catch (error) {
            if (!(error instanceof DockerError && error.status === 404))
                throw error;
            return undefined;
        }
    }
    private assertResourceOwnership(
        existing: any,
        name: string,
        project: ResolvedProject,
        hash: string,
    ) {
        if (
            existing.Labels?.['chs.dev.project'] !== project.namespace ||
            existing.Labels?.['chs.dev.backend'] !== 'native' ||
            existing.Labels?.['chs.dev.directory'] !== project.directory
        )
            throw new LiveFailure(
                `Resource ${name} is not owned by this native environment.`,
                'blocked',
            );
        if (existing.Labels?.['chs.dev.resource-hash'] !== hash)
            throw new LiveFailure(
                `Resource ${name} configuration changed; automatic storage/network replacement is not supported.`,
                'blocked',
            );
    }
    private resourceCreateBody(
        kind: 'networks' | 'volumes',
        name: string,
        spec: ResourceSpec,
        project: ResolvedProject,
        hash: string,
    ) {
        return {
            Name: name,
            Driver: spec.driver,
            DriverOpts: kind === 'volumes' ? spec.options : undefined,
            Options: kind === 'networks' ? spec.options : undefined,
            Internal: spec.internal,
            Labels: {
                ...spec.labels,
                ...ownership(project),
                'chs.dev.resource-hash': hash,
            },
        };
    }
    private async ensureResources(
        project: ResolvedProject,
        context: OperationContext,
        create: boolean,
        fingerprint: (value: unknown) => string,
    ) {
        const api = await this.api(context.signal);
        for (const kind of ['networks', 'volumes'] as const)
            for (const [key, spec] of Object.entries(project[kind])) {
                const name = `${project.namespace}-${key}`;
                const existing = await this.existingResource(
                    api,
                    kind,
                    name,
                    context,
                );
                const hash = fingerprint(spec);
                if (existing) {
                    this.assertResourceOwnership(existing, name, project, hash);
                    continue;
                }

                if (!create) continue;

                const body = this.resourceCreateBody(
                    kind,
                    name,
                    spec,
                    project,
                    hash,
                );
                await api.call('POST', `/${kind}/create`, body, context.signal);
            }
    }
    private async inspectImage(
        project: ResolvedProject,
        context: CompilationContext,
        image: string,
        platform?: string,
    ) {
        const api = await this.api(context.signal);
        let detail: any;
        try {
            detail = await api.call(
                'GET',
                `/images/${encodeURIComponent(image)}/json`,
                undefined,
                context.signal,
            );
        } catch (error) {
            if (error instanceof DockerError && error.status === 404)
                return undefined;
            throw error;
        }
        if (
            platform &&
            `${detail.Os}/${detail.Architecture}${detail.Variant ? `/${detail.Variant}` : ''}` !==
                platform
        ) {
            const result = await this.dependencies.execute({
                command: 'docker',
                args: ['image', 'inspect', '--platform', platform, image],
                cwd: project.directory,
                env: context.environment,
                signal: context.signal,
                captureStdout: true,
                privateOutput: true,
            });
            if (result.code !== 0) return undefined;
            detail = JSON.parse(result.stdout)[0];
        }
        return detail;
    }
    private needsPull(spec: ServiceSpec, image: any) {
        return (
            !!spec.image &&
            spec.pullPolicy !== 'never' &&
            (spec.pullPolicy === 'always' ||
                !image ||
                /(?:^|:)latest$/.test(spec.image) ||
                (!spec.image.includes('@') &&
                    !spec.image.split('/').at(-1)!.includes(':')))
        );
    }
    /** Pulls the service image; returns false when the failure queued a build instead. */
    private async pullImage(
        spec: ServiceSpec,
        directory: string,
        context: CompilationContext,
        builds: ServiceSpec[],
    ): Promise<boolean> {
        context.onOutput?.({
            stream: 'stdout',
            text: `Pull ${spec.name}`,
        });
        try {
            await dockerCommand(
                this.dependencies.execute,
                [
                    'pull',
                    ...(spec.platform ? ['--platform', spec.platform] : []),
                    spec.image!,
                ],
                directory,
                context,
            );
        } catch (error) {
            context.signal?.throwIfAborted();
            if (spec.build && spec.pullPolicy === 'missing') {
                builds.push(spec);
                return false;
            }
            throw error;
        }
        return true;
    }
    private applyImageMetadata(
        spec: ServiceSpec,
        image: any,
        reference: string,
    ) {
        spec.imageId = image.Id;
        spec.imageReference = immutableImageReference(image, reference);
        spec.imageVolumes = Object.keys(image.Config?.Volumes ?? {});
        spec.imageHasHealth =
            !!image.Config?.Healthcheck?.Test?.length &&
            image.Config.Healthcheck.Test[0] !== 'NONE';
    }
    private async prepareServiceImage(
        spec: ServiceSpec,
        project: ResolvedProject,
        context: CompilationContext,
        reload: readonly string[],
        builds: ServiceSpec[],
    ) {
        let image = spec.image
            ? await this.inspectImage(
                  project,
                  context,
                  spec.image,
                  spec.platform,
              )
            : undefined;
        if (requestedBuild(spec, reload)) {
            builds.push(spec);
            return;
        }
        if (spec.pullPolicy === 'build' && !spec.build)
            throw new Error(
                `${spec.name}: build policy requires a build definition`,
            );
        if (this.needsPull(spec, image)) {
            if (
                !(await this.pullImage(
                    spec,
                    project.directory,
                    context,
                    builds,
                ))
            )
                return;
            image = await this.inspectImage(
                project,
                context,
                spec.image!,
                spec.platform,
            );
        }
        if (!image && canBuildMissingImage(spec)) {
            builds.push(spec);
            return;
        }
        if (!image) throw new Error(`${spec.name}: required image is missing`);
        this.applyImageMetadata(spec, image, spec.image!);
    }
    private async buildImages(
        project: ResolvedProject,
        context: CompilationContext,
        builds: ServiceSpec[],
    ) {
        for (const spec of builds) {
            context.onOutput?.({
                stream: 'stdout',
                text: `Build ${spec.name}`,
            });
            const build = spec.build!;
            const tag = `${project.namespace}/${spec.name}:dev`;
            const environment = { ...context.environment };
            const args = [
                'build',
                '--provenance=false',
                '--tag',
                tag,
                ...(build.dockerfile
                    ? ['--file', resolve(build.context, build.dockerfile)]
                    : []),
                ...(build.target ? ['--target', build.target] : []),
                ...(spec.platform ? ['--platform', spec.platform] : []),
            ];
            for (const [key, value] of Object.entries(build.args)) {
                environment[key] = value;
                args.push('--build-arg', key);
            }
            args.push(build.context);
            await dockerCommand(
                this.dependencies.execute,
                args,
                project.directory,
                { ...context, environment },
                true,
            );
            this.applyImageMetadata(
                spec,
                await this.inspectImage(project, context, tag, spec.platform),
                tag,
            );
        }
    }
    private async prepareImages(
        project: ResolvedProject,
        context: CompilationContext,
        reload: readonly string[],
    ) {
        const builds: ServiceSpec[] = [];
        await executeGraph(
            Object.values(project.services).map((spec) => ({
                id: spec.name,
                dependencies: [],
                run: () =>
                    this.prepareServiceImage(
                        spec,
                        project,
                        context,
                        reload,
                        builds,
                    ),
            })),
            this.dependencies.policy?.pulls ?? 2,
            context.signal,
        );
        await this.buildImages(project, context, builds);
    }

    async environment(requirements: readonly string[], signal?: AbortSignal) {
        return (await this.context({ signal }, requirements)).environment;
    }
    private observation(detail: any): ObservedContainer {
        const volumePrefix = namespace(this.dependencies.directory) + '-';

        return {
            ...this.normalize(detail),
            addresses: Object.fromEntries(
                Object.entries(detail.NetworkSettings?.Networks ?? {}).map(
                    ([name, value]: [string, any]) => [name, value.IPAddress],
                ),
            ),
            dependencies: JSON.parse(
                detail.Config.Labels['chs.dev.dependencies'] ?? '{}',
            ),
            anonymousVolumes: Object.fromEntries(
                (detail.Mounts ?? [])
                    .filter(
                        (m: any) =>
                            m.Type === 'volume' &&
                            !m.Name.startsWith(volumePrefix),
                    )
                    .map((m: any) => [m.Destination, m.Name]),
            ),
            stopSeconds: detail.Config.StopTimeout ?? 10,
        };
    }
    private async validateSavedVolumes(
        volumes: Record<string, string>,
        context: OperationContext,
    ) {
        for (const name of Object.values(volumes)) {
            try {
                await (
                    await this.api(context.signal)
                ).call(
                    'GET',
                    `/volumes/${encodeURIComponent(name)}`,
                    undefined,
                    context.signal,
                );
            } catch (error) {
                if (error instanceof DockerError && error.status === 404)
                    throw new LiveFailure(
                        'A saved anonymous volume is missing on the selected Docker engine. Restore the volume or return to its original engine before starting.',
                        'blocked',
                    );
                throw error;
            }
        }
    }

    private static async mountStorageIdentity(
        mount: any,
        item: any,
        api: DockerApi,
        signal?: AbortSignal,
    ) {
        if (mount.Type === 'volume') {
            const volume = await api.call(
                'GET',
                `/volumes/${encodeURIComponent(mount.Name)}`,
                undefined,
                signal,
            );
            return [mount.Destination, mount.Name, volume.CreatedAt];
        }

        if (mount.Type === 'bind') {
            const info = await stat(mount.Source);
            return [
                mount.Destination,
                mount.Source,
                info.ino,
                info.birthtimeMs,
            ];
        }

        return [mount.Destination, item.Id];
    }

    readonly containers: RuntimeAdapter['containers'] = {
        storageIdentity: async (id, signal) => {
            const item = await this.verify(id, signal),
                api = await this.api(signal);

            return Promise.all(
                (item.Mounts ?? [])
                    .filter((m: any) => m.RW)
                    .map((mount: any) =>
                        DockerRuntimeAdapter.mountStorageIdentity(
                            mount,
                            item,
                            api,
                            signal,
                        ),
                    ),
            );
        },
        exec: async (id, args, context, stdin) => {
            await this.verify(id, context.signal);
            return this.dependencies.execute({
                command: 'docker',
                args: [
                    'exec',
                    ...(stdin !== undefined ? ['-i'] : []),
                    id,
                    ...args,
                ],
                cwd: this.dependencies.directory,
                env: await this.commandEnvironment(context.signal),
                signal: context.signal,
                onOutput: context.onOutput,
                stdin,
                privateOutput: true,
                captureStderr: true,
            });
        },
        copyTo: async (id, source, target, context) => {
            await this.verify(id, context.signal);
            const result = await this.dependencies.execute({
                command: 'docker',
                args: ['cp', source, `${id}:${target}`],
                cwd: this.dependencies.directory,
                env: await this.commandEnvironment(context.signal),
                signal: context.signal,
                privateOutput: true,
                captureStderr: true,
            });
            if (result.code !== 0)
                throw new Error(result.stderr || 'Docker file copy failed');
        },
        list: async (signal) =>
            (await this.inspected(signal)).map((c) => this.observation(c)),
        inspectOwned: async (id, signal) =>
            this.observation(await this.verify(id, signal)),
        create: async (project, spec, volumes, context) =>
            containerOperation(
                'create',
                spec.name,
                context,
                async () => {
                    await this.validateSavedVolumes(volumes, context);
                    const result = await (
                        await this.api(context.signal)
                    ).call(
                        'POST',
                        `/containers/create?name=${encodeURIComponent(spec.name)}${spec.platform ? `&platform=${encodeURIComponent(spec.platform)}` : ''}`,
                        containerBody(project, spec, volumes),
                        context.signal,
                    );
                    return this.observation(
                        await this.verify(result.Id, context.signal),
                    );
                },
                spec.source,
            ),
        action: async (action, container, context) =>
            containerOperation(action, container.service, context, async () => {
                await this.verify(container.id, context.signal);
                const api = await this.api(context.signal);
                if (container.lifecycle === 'paused' && action === 'stop')
                    await api.call(
                        'POST',
                        `/containers/${container.id}/unpause`,
                        undefined,
                        context.signal,
                    );
                await api.call(
                    'POST',
                    `/containers/${container.id}/${action}${action === 'start' ? '' : `?t=${container.stopSeconds}`}`,
                    undefined,
                    context.signal,
                );
            }),
        remove: async (container, context) =>
            containerOperation(
                'remove',
                container.service,
                context,
                async () => {
                    await this.verify(container.id, context.signal);
                    await (
                        await this.api(context.signal)
                    ).call(
                        'DELETE',
                        `/containers/${container.id}?v=false`,
                        undefined,
                        context.signal,
                    );
                },
            ),
        logs: async (id, tail, signal) => {
            await this.verify(id, signal);
            return (await this.api(signal)).logs(id, tail, signal);
        },
    };
    readonly images: RuntimeAdapter['images'] = {
        prepare: async (project, reload, context) =>
            this.prepareImages(project, await this.context(context), reload),
    };
    readonly resources: RuntimeAdapter['resources'] = {
        ensure: async (project, create, fingerprint, context) =>
            this.ensureResources(project, context, create, fingerprint),
    };
    async preflight(project?: ResolvedProject, signal?: AbortSignal) {
        await this.checkBackend(signal);
        if (!project) return;
        for (const spec of Object.values(project.services)) {
            try {
                const existing = await (
                    await this.api(signal)
                ).call(
                    'GET',
                    `/containers/${encodeURIComponent(spec.name)}/json`,
                    undefined,
                    signal,
                );
                if (
                    !this.owns(existing) ||
                    existing.Config?.Labels?.['chs.dev.service'] !== spec.name
                )
                    throw new LiveFailure(
                        `Container name "${spec.name}" is already in use. Native containers use exact service names, which must be unique on this Docker engine. Stop the owning environment or rename that container, then try again.`,
                        'blocked',
                    );
            } catch (error) {
                if (!(error instanceof DockerError && error.status === 404))
                    throw error;
            }
        }
    }
}
