import { rethrowIfAborted } from '../cancellation.js';
import { randomUUID, createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
    RuntimeAdapter,
    ObservedContainer,
} from '../../domain/runtime-adapter.js';
import type {
    ResolvedProject,
    ResourceSpec,
    ServiceSpec,
} from '../../domain/orchestration.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';
import { LiveFailure } from '../../domain/live.js';
import {
    AppleClient,
    appleIncarnation,
    type AppleInspection,
    type AppleClientDependencies,
} from './apple-client.js';
import { namespace } from './compiler.js';
import { appleImageMetadata } from './apple-image-metadata.js';
import { prepareAppleImagePlatform } from './apple-image-platform.js';
import { optionalJson, privateJson } from './state-files.js';

export interface AppleDependencies extends AppleClientDependencies {
    projectName: string;
    stateDirectory: string;
}
type Control = {
    incarnation: string;
    fingerprint?: string;
    health?: ServiceSpec['health'];
    restart: string;
    stopped: boolean;
    result?: number;
    stopSeconds: number;
    stopSignal?: string;
    kind: string;
    retry?: { count: number; next: number };
};
type HealthEntry = {
    incarnation: string;
    state: string;
    failures: number;
    next: number;
    started: number;
};
export function appleNamespace(directory: string) {
    return namespace(directory).replace('chs-native-', 'chs-apple-');
}
export function appleMac(identity: string) {
    return [
        '02',
        ...createHash('sha256')
            .update(identity)
            .digest('hex')
            .slice(0, 10)
            .match(/../g)!,
    ].join(':');
}
export class AppleRuntimeAdapter implements RuntimeAdapter {
    readonly name = 'Apple';
    readonly stateKey = 'native-apple';
    readonly client: AppleClient;
    readonly state: string;
    private health = new Map<string, HealthEntry>();
    private volumeQueue: Promise<void> = Promise.resolve();
    private probes = new Map<string, Promise<void>>();

    constructor(readonly dependencies: AppleDependencies) {
        this.client = new AppleClient(dependencies);
        this.state = join(dependencies.stateDirectory, this.stateKey);
    }
    environment(requirements: readonly string[], signal?: AbortSignal) {
        return this.dependencies.environment.resolve(requirements, signal);
    }
    checkAvailability(signal?: AbortSignal) {
        return this.client.availability(signal);
    }
    owns(item: AppleInspection) {
        const labels = item.configuration.labels ?? {};
        return (
            labels['chs.dev.directory'] === this.dependencies.directory &&
            labels['chs.dev.project'] ===
                appleNamespace(this.dependencies.directory) &&
            labels['chs.dev.runtime'] === 'apple' &&
            labels['chs.dev.backend'] === 'native'
        );
    }
    controlPath(id: string) {
        return join(
            this.state,
            'control',
            `${createHash('sha256').update(id).digest('hex')}.json`,
        );
    }
    async control(item: AppleInspection) {
        const value = await optionalJson<Control>(
            this.controlPath(item.configuration.id),
        );
        return value?.incarnation === appleIncarnation(item)
            ? value
            : undefined;
    }
    private observedHealth(
        item: AppleInspection,
        control: Control | undefined,
    ) {
        if (!control?.health?.test?.length || control.health.test[0] === 'NONE')
            return undefined;
        const current = this.health.get(item.configuration.id);
        return current && current.incarnation === appleIncarnation(item)
            ? current.state
            : 'starting';
    }
    private static networkAddresses(
        networks: AppleInspection['networks'],
        selector: (
            network: NonNullable<AppleInspection['networks']>[number],
        ) => string | undefined,
    ) {
        return Object.fromEntries(
            (networks ?? [])
                .filter((n) => selector(n))
                .map((n) => [n.network, selector(n)!.split('/')[0]]),
        );
    }
    async normalize(item: AppleInspection): Promise<ObservedContainer> {
        const l = item.configuration.labels ?? {},
            control = await this.control(item);
        return {
            id: item.configuration.id,
            incarnation: appleIncarnation(item),
            service: l['chs.dev.service'],
            projectName: this.dependencies.projectName,
            projectDirectory: this.dependencies.directory,
            ownerService: l['chs.dev.owner-service'],
            mode: l['chs.dev.mode'] as any,
            kind: l['chs.dev.kind'] as any,
            configurationIdentity: control
                ? l['chs.dev.fingerprint']
                : undefined,
            lifecycle: item.status === 'stopped' ? 'exited' : item.status,
            health:
                item.status === 'running'
                    ? this.observedHealth(item, control)
                    : undefined,
            exitCode: control?.result,
            dependencies: JSON.parse(l['chs.dev.dependencies'] ?? '{}'),
            anonymousVolumes: JSON.parse(l['chs.dev.volumes'] ?? '{}'),
            stopSeconds: control?.stopSeconds ?? 10,
            ipv6Addresses: AppleRuntimeAdapter.networkAddresses(
                item.networks,
                (n) => n.ipv6Address,
            ),
            addresses: AppleRuntimeAdapter.networkAddresses(
                item.networks,
                (n) => n.ipv4Address,
            ),
        };
    }
    async verify(container: ObservedContainer, signal?: AbortSignal) {
        const item = await this.client.verify(
            container.id,
            container.incarnation,
            signal,
        );
        if (!this.owns(item))
            throw new LiveFailure(
                'Apple container ownership changed. Refresh before trying again.',
                'blocked',
            );
        return item;
    }
    private rejectSpec(spec: ServiceSpec, message: string): never {
        throw new LiveFailure(
            `${spec.source}: ${spec.name}: ${message}`,
            'blocked',
        );
    }
    private validateServiceRequirements(spec: ServiceSpec) {
        const reject = (message: string) => this.rejectSpec(spec, message);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(spec.name))
            reject('invalid Apple container name.');
        if (/^on-failure/.test(spec.restart))
            reject(
                'on-failure restart policies require exit-code observation and are not supported by Apple yet.',
            );
        if (spec.hostname && spec.hostname !== spec.name)
            reject(
                'custom hostnames differing from the service name are not supported by Apple yet.',
            );
    }
    private validateServiceNetworking(
        spec: ServiceSpec,
        project: ResolvedProject,
    ) {
        const reject = (message: string) => this.rejectSpec(spec, message);
        if (Object.keys(spec.networks).length !== 1)
            reject('Apple currently supports one project network per service.');
        if (
            spec.mounts.some(
                (m) =>
                    m.source === '/var/run/docker.sock' ||
                    m.source === '/var/lib/docker/containers',
            )
        )
            reject(
                'requires the Docker API or Docker log storage. Disable this service or select Docker.',
            );
        if (
            spec.extraHosts.some(
                (h) =>
                    h.endsWith(':host-gateway') &&
                    !/^([a-z0-9-]+\.)*chs\.local:/.test(h),
            )
        )
            reject(
                'arbitrary host-gateway integrations are not supported by Apple yet.',
            );
        if (
            spec.extraHosts.some((h) => h.endsWith(':host-gateway')) &&
            !project.services['ingress-proxy']
        )
            reject('CHS gateway aliases require ingress-proxy in the project.');
    }
    private async validateServiceStorage(spec: ServiceSpec) {
        const reject = (message: string) => this.rejectSpec(spec, message);
        for (const mount of spec.mounts)
            if (
                mount.type === 'bind' &&
                mount.source &&
                !(await stat(mount.source)).isDirectory()
            )
                reject(
                    `Apple requires a directory bind mount: ${mount.source}`,
                );
        if (
            spec.mounts.some((m) =>
                /[\n,]/.test(`${m.source ?? ''}${m.target}`),
            )
        )
            reject(
                'mount paths containing commas or newlines cannot be represented by the Apple CLI.',
            );
    }
    private validateServiceLimits(spec: ServiceSpec) {
        const reject = (message: string) => this.rejectSpec(spec, message);
        if (spec.memory !== undefined && spec.memory < 200 * 1024 * 1024)
            reject(
                'Apple virtual machines require at least 200 MiB of memory.',
            );
        if (spec.ports.some((p) => !p.published || p.published === '0'))
            reject(
                'automatic host-port allocation is not supported by Apple yet; declare a published port.',
            );
    }
    private async validateServiceForApple(
        spec: ServiceSpec,
        project: ResolvedProject,
    ) {
        this.validateServiceRequirements(spec);
        this.validateServiceNetworking(spec, project);
        await this.validateServiceStorage(spec);
        this.validateServiceLimits(spec);
    }
    async preflight(project?: ResolvedProject, signal?: AbortSignal) {
        const available = await this.checkAvailability(signal);
        if (!available.available)
            throw new LiveFailure(available.message, 'blocked');
        if (!project) return;
        project.namespace = appleNamespace(project.directory);
        for (const spec of Object.values(project.services))
            await this.validateServiceForApple(spec, project);
        if (Object.keys(project.networks).length !== 1)
            throw new LiveFailure(
                'Apple currently supports one isolated CHS project network.',
                'blocked',
            );
        for (const item of await this.client.list(signal))
            if (project.services[item.configuration.id] && !this.owns(item))
                throw new LiveFailure(
                    `Container name ${item.configuration.id} is already used by another Apple environment. Stop or rename it before applying.`,
                    'blocked',
                );
    }
    readonly resources: RuntimeAdapter['resources'] = {
        ensure: async (project, create, fingerprint, context) => {
            for (const kind of ['network', 'volume'] as const)
                for (const [name, spec] of Object.entries(
                    kind === 'network' ? project.networks : project.volumes,
                ))
                    await this.ensureResource(project, kind, name, spec, {
                        create,
                        fingerprint,
                        context,
                    });
        },
    };
    private static resourceLabels(value: {
        configuration?: { labels?: Record<string, string> };
        labels?: Record<string, string>;
    }) {
        return value.configuration?.labels ?? value.labels ?? {};
    }
    private static validateResource(
        kind: 'network' | 'volume',
        name: string,
        spec: ResourceSpec,
    ) {
        if (
            (spec.driver &&
                spec.driver !== (kind === 'network' ? 'bridge' : 'local')) ||
            Object.keys(spec.options ?? {}).length
        )
            throw new LiveFailure(
                `${kind} ${name}: custom drivers/options are not supported by Apple.`,
                'blocked',
            );
    }
    private async ensureResource(
        project: ResolvedProject,
        kind: 'network' | 'volume',
        name: string,
        spec: ResourceSpec,
        options: {
            create: boolean;
            fingerprint: (value: unknown) => string;
            context: OperationContext;
        },
    ) {
        const { create, fingerprint, context } = options;
        AppleRuntimeAdapter.validateResource(kind, name, spec);
        const id = `${project.namespace}-${name}`;
        const listed = await this.client.json(
            [kind, 'list', '--format', 'json'],
            context,
        );
        const existing = listed.find(
            (v: any) => (v.name ?? v.id ?? v.configuration?.name) === id,
        );
        if (existing) {
            const details = (
                await this.client.json([kind, 'inspect', id], context)
            )[0];
            const labels = AppleRuntimeAdapter.resourceLabels(details);
            if (
                labels['chs.dev.project'] !== project.namespace ||
                labels['chs.dev.fingerprint'] !== fingerprint(spec)
            )
                throw new LiveFailure(
                    `${kind} ${id} is foreign or its definition changed; existing data will not be replaced.`,
                    'blocked',
                );
        } else if (create) {
            await this.client.checked(
                [
                    kind,
                    'create',
                    '--label',
                    `chs.dev.project=${project.namespace}`,
                    '--label',
                    `chs.dev.fingerprint=${fingerprint(spec)}`,
                    ...(spec.internal && kind === 'network'
                        ? ['--internal']
                        : []),
                    id,
                ],
                context,
            );
        }
    }
    readonly images: RuntimeAdapter['images'] = {
        prepare: async (project, reload, context) => {
            for (const spec of Object.values(project.services)) {
                const image =
                    spec.image ?? `${project.namespace}/${spec.name}:dev`;
                const inspected = await this.prepareImageSource(
                    spec,
                    image,
                    reload,
                    context,
                );
                const record = JSON.parse(inspected.stdout)[0];
                const desired = AppleRuntimeAdapter.desiredPlatform(
                    spec,
                    record,
                );
                if (!spec.platform && desired === 'linux/amd64')
                    context.onOutput?.({
                        stream: 'stdout',
                        text: `Using linux/amd64 emulation: ${spec.name}`,
                    });
                spec.platform = desired;
                const variant = AppleRuntimeAdapter.requireVariant(
                    spec,
                    image,
                    record,
                    desired,
                );
                const config = {
                    ...variant.config?.config,
                    ...(await appleImageMetadata({
                        client: this.client,
                        reference: image,
                        platform: desired,
                        digest: variant.digest,
                        state: this.state,
                        context,
                    })),
                };
                await this.registerImageReference(
                    spec,
                    image,
                    variant,
                    record,
                    context,
                );
                spec.image = image;
                spec.imageVolumes = Object.keys(config.Volumes ?? {});
                AppleRuntimeAdapter.inheritHealthcheck(spec, config);
                AppleRuntimeAdapter.resolveEntryCommand(spec, config);
            }
        },
    };
    private async prepareImageSource(
        spec: ServiceSpec,
        image: string,
        reload: readonly string[],
        context: OperationContext,
    ) {
        let inspected = await this.client.run(
            ['image', 'inspect', image],
            context,
        );
        const build = spec.build;
        if (build && AppleRuntimeAdapter.needsBuild(spec, inspected, reload))
            inspected = await this.buildImage(spec, image, build, context);
        else if (
            !spec.build &&
            AppleRuntimeAdapter.needsPull(spec, image, inspected)
        )
            inspected = await this.pullImage(spec, image, context);
        if (inspected.code !== 0)
            throw new LiveFailure(
                `${spec.name}: image ${image} is unavailable and pull policy is ${spec.pullPolicy}.`,
                'blocked',
            );
        return inspected;
    }
    private static needsBuild(
        spec: ServiceSpec,
        inspected: { code: number },
        reload: readonly string[],
    ) {
        return (
            spec.pullPolicy === 'build' ||
            inspected.code !== 0 ||
            reload.includes(spec.owner)
        );
    }
    private static needsPull(
        spec: ServiceSpec,
        image: string,
        inspected: { code: number },
    ) {
        return (
            spec.pullPolicy === 'always' ||
            (spec.pullPolicy === 'missing' &&
                (!/[@]|:[^/:]+$/.test(image) || image.endsWith(':latest'))) ||
            (inspected.code !== 0 && spec.pullPolicy !== 'never')
        );
    }

    private static imageBuildArgs(
        image: string,
        build: NonNullable<ServiceSpec['build']>,
        platform: string,
    ) {
        return [
            'build',
            '--progress',
            'plain',
            '--memory',
            process.env.CHS_DEV_APPLE_BUILD_MEMORY ?? '4g',
            '--cpus',
            process.env.CHS_DEV_APPLE_CPUS ?? '2',
            '--tag',
            image,
            ...(build.dockerfile
                ? ['--file', resolve(build.context, build.dockerfile)]
                : []),
            '--platform',
            platform,
            ...Object.entries(build.args).flatMap(([k, v]) => [
                '--build-arg',
                `${k}=${v}`,
            ]),
            ...(build.target ? ['--target', build.target] : []),
            build.context,
        ].flat();
    }

    private async buildImage(
        spec: ServiceSpec,
        image: string,
        build: NonNullable<ServiceSpec['build']>,
        context: OperationContext,
    ) {
        context.onOutput?.({
            stream: 'stdout',
            text: `Building: ${spec.name}`,
        });
        await prepareAppleImagePlatform(
            spec,
            'build',
            context,
            async (platform) =>
                this.client.checked(
                    AppleRuntimeAdapter.imageBuildArgs(image, build, platform),
                    context,
                    {
                        timeout: 1800000,
                        env: {
                            ...(await this.environment([], context.signal)),
                            ...build.args,
                        },
                    },
                ),
        );
        return this.client.checked(['image', 'inspect', image], context);
    }
    private async pullImage(
        spec: ServiceSpec,
        image: string,
        context: OperationContext,
    ) {
        context.onOutput?.({
            stream: 'stdout',
            text: `Pulling: ${spec.name} (${image})`,
        });
        await prepareAppleImagePlatform(spec, 'pull', context, (platform) =>
            this.client.checked(
                [
                    'image',
                    'pull',
                    '--progress',
                    'plain',
                    '--platform',
                    platform,
                    image,
                ],
                context,
                { timeout: 1800000 },
            ),
        );
        return this.client.checked(['image', 'inspect', image], context);
    }
    private static desiredPlatform(spec: ServiceSpec, record: any) {
        return (
            spec.platform ??
            (record.variants?.some(
                (v: any) =>
                    v.platform.os === 'linux' &&
                    v.platform.architecture === 'arm64',
            )
                ? 'linux/arm64'
                : 'linux/amd64')
        );
    }
    private static requireVariant(
        spec: ServiceSpec,
        image: string,
        record: any,
        desired: string,
    ) {
        const variant = record.variants?.find(
            (v: any) =>
                `${v.platform.os}/${v.platform.architecture}` === desired,
        );
        if (!variant)
            throw new LiveFailure(
                `${spec.name}: image ${image} has no ${desired} variant. Set platform: linux/amd64 for an AMD64-only image.`,
                'blocked',
            );
        return variant;
    }
    private async registerImageReference(
        spec: ServiceSpec,
        image: string,
        variant: any,
        record: any,
        context: OperationContext,
    ) {
        spec.imageId = variant.digest;
        spec.imageReference = `${record.configuration.name.replace(/:[^/:]+$/, '').split('@')[0]}@${record.configuration.descriptor.digest}`;
        // The image store may synthesize an OCI index or retain only the tag. Register its immutable reference locally.
        if (
            (
                await this.client.run(
                    ['image', 'inspect', spec.imageReference],
                    context,
                )
            ).code !== 0
        )
            await this.client.checked(
                ['image', 'tag', image, spec.imageReference],
                context,
            );
    }
    private static inheritHealthcheck(spec: ServiceSpec, config: any) {
        if (config.Healthcheck) {
            const inherited = {
                test: config.Healthcheck.Test,
                interval: config.Healthcheck.Interval,
                timeout: config.Healthcheck.Timeout,
                retries: config.Healthcheck.Retries,
                startPeriod: config.Healthcheck.StartPeriod,
                startInterval: config.Healthcheck.StartInterval,
            };
            spec.health = {
                ...inherited,
                ...Object.fromEntries(
                    Object.entries(spec.health ?? {}).filter(
                        ([, v]) => v !== undefined,
                    ),
                ),
            };
        }
        if (spec.health) spec.health.shell = config.Shell;
        spec.stopSignal ??= config.StopSignal;
        spec.imageHasHealth =
            !!spec.health?.test?.length && spec.health.test[0] !== 'NONE';
    }
    private static resolveEntryCommand(spec: ServiceSpec, config: any) {
        // Resolve entrypoint vectors before translating to Apple's single --entrypoint argument.
        const entry = spec.entrypoint ?? config.Entrypoint ?? [];
        const command =
            spec.command ??
            (spec.entrypoint === undefined || spec.entrypoint === null
                ? (config.Cmd ?? [])
                : []);
        if (entry.length) {
            spec.entrypoint = [entry[0]];
            spec.command = [...entry.slice(1), ...command];
        } else {
            spec.entrypoint = [];
            spec.command = command;
        }
    }
    private async initializeVolume(
        project: ResolvedProject,
        spec: ServiceSpec,
        mount: { target: string; name: string },
        identity: string,
        context: OperationContext,
    ) {
        const { target, name } = mount;
        const file = join(
            this.state,
            'volume-initialization',
            createHash('sha256').update(name).digest('hex') + '.json',
        );
        if (
            (await optionalJson<{ identity: string }>(file))?.identity ===
            identity
        )
            return;
        const helper = `chs-volume-${randomUUID()}`;
        context.onOutput?.({
            stream: 'stdout',
            text: `Preparing volume: ${spec.name} ${target}`,
        });
        try {
            // Mount at a separate path so the image's original directory remains visible.
            // Positional arguments keep image paths out of shell syntax. Never replace existing data.
            await this.client.checked(
                [
                    'run',
                    '--rm',
                    '--name',
                    helper,
                    '--user',
                    '0',
                    '--memory',
                    '256m',
                    '--cpus',
                    '1',
                    '--label',
                    `chs.dev.helper=${project.namespace}`,
                    '--network',
                    `${project.namespace}-${Object.keys(spec.networks)[0]}`,
                    '--mount',
                    `type=volume,source=${name},target=/.__chs_volume`,
                    ...(spec.platform ? ['--platform', spec.platform] : []),
                    '--entrypoint',
                    '/bin/sh',
                    spec.imageReference ?? spec.image!,
                    '-ec',
                    'if [ -d "$1" ] && [ -z "$(ls -A /.__chs_volume | sed "/^lost+found$/d")" ]; then cp -a "$1/." /.__chs_volume/; fi',
                    'chs-volume',
                    target,
                ],
                context,
                { timeout: 300000 },
            );
            await privateJson(file, { identity });
        } catch (error) {
            throw new LiveFailure(
                `${spec.name}: cannot initialize volume ${target}. Apple volume initialization requires /bin/sh, ls, sed and cp in the image. ${error instanceof Error ? error.message : String(error)}`,
                'blocked',
            );
        } finally {
            await this.deleteVolumeHelper(project, helper);
        }
    }
    private async deleteVolumeHelper(project: ResolvedProject, helper: string) {
        // Cancellation may leave the VM alive after its CLI process exits.
        const item = await this.client.inspect(helper).catch(() => undefined);
        if (
            item?.configuration.labels?.['chs.dev.helper'] === project.namespace
        ) {
            if (item.status === 'running')
                await this.client
                    .checked(['stop', '--time', '1', helper])
                    .catch(() => {});
            await this.client.checked(['delete', helper]).catch(() => {});
        }
    }
    private populateVolumes(
        project: ResolvedProject,
        spec: ServiceSpec,
        anonymous: Record<string, string>,
        context: OperationContext,
    ) {
        const run = this.volumeQueue
            .catch(() => {})
            .then(async () => {
                const mounts = [
                    ...spec.mounts
                        .filter((m) => m.type === 'volume' && m.source)
                        .map((m) => ({
                            target: m.target,
                            name: `${project.namespace}-${m.source}`,
                        })),
                    ...Object.entries(anonymous).map(([target, name]) => ({
                        target,
                        name,
                    })),
                ];
                for (const { target, name } of mounts) {
                    const volume = (
                        await this.client.json(
                            ['volume', 'inspect', name],
                            context,
                        )
                    )[0];
                    await this.initializeVolume(
                        project,
                        spec,
                        { target, name },
                        JSON.stringify([
                            volume.configuration.creationDate,
                            spec.imageId,
                            target,
                        ]),
                        context,
                    );
                }
            });
        this.volumeQueue = run;
        return run;
    }

    private async mountStorageIdentity(
        mount: NonNullable<AppleInspection['configuration']['mounts']>[number],
        item: AppleInspection,
        signal?: AbortSignal,
    ) {
        const name = mount.type?.volume?.name;
        if (name) {
            const volume = (
                await this.client.json(['volume', 'inspect', name], { signal })
            )[0];
            return [mount.destination, name, volume.configuration.creationDate];
        }

        if (mount.type?.virtiofs) {
            const info = await stat(mount.source);
            return [
                mount.destination,
                mount.source,
                info.ino,
                info.birthtimeMs,
            ];
        }

        return [mount.destination, item.configuration.creationDate];
    }

    readonly containers: RuntimeAdapter['containers'] = {
        storageIdentity: async (id, signal) => {
            const item = await this.client.inspect(id, signal);
            if (!this.owns(item))
                throw new Error('Container ownership changed');

            return Promise.all(
                (item.configuration.mounts ?? [])
                    .filter((mount) => !(mount.options ?? []).includes('ro'))
                    .map((mount) =>
                        this.mountStorageIdentity(mount, item, signal),
                    ),
            );
        },
        list: async (signal) =>
            await Promise.all(
                (await this.client.list(signal))
                    .filter((i) => this.owns(i))
                    .map((i) => this.normalize(i)),
            ),
        inspectOwned: async (id, signal) => {
            const item = await this.client.inspect(id, signal);
            if (!this.owns(item))
                throw new LiveFailure(
                    'Apple container is not owned by this checkout.',
                    'blocked',
                );
            await this.checkHealth(item, { signal });
            return this.normalize(item);
        },
        create: async (project, spec, saved, context) => {
            const volumes = { ...saved };
            await this.ensureContainerVolumes(
                project,
                spec,
                saved,
                volumes,
                context,
            );
            await this.populateVolumes(project, spec, volumes, context);
            const labels = AppleRuntimeAdapter.containerLabels(
                project,
                spec,
                volumes,
            );
            const args = AppleRuntimeAdapter.containerCreateArgs(
                project,
                spec,
                labels,
                volumes,
            );
            context.onOutput?.({
                stream: 'stdout',
                text: `Creating: ${spec.name}`,
            });
            await this.client.checked(args, context, {
                env: {
                    ...(await this.environment([], context.signal)),
                    ...spec.environment,
                },
            });
            const item = await this.client.inspect(spec.name, context.signal);
            await privateJson(this.controlPath(spec.name), {
                incarnation: appleIncarnation(item)!,
                fingerprint: spec.fingerprint,
                health: spec.health,
                restart: spec.restart,
                stopped: false,
                stopSeconds: spec.stopSeconds,
                stopSignal: spec.stopSignal,
                kind: spec.kind,
            } satisfies Control);
            return this.normalize(item);
        },
        action: async (action, container, context) => {
            let item = await this.verify(container, context.signal);
            const control = await this.control(item);
            if (!control) {
                if (action === 'stop') {
                    await this.stopContainer(
                        item,
                        container.id,
                        container,
                        context,
                    );
                    return;
                }
                throw new LiveFailure(
                    `${container.service}: Apple lifecycle metadata is missing. Apply to recreate this container.`,
                    'blocked',
                );
            }
            control.stopped = action === 'stop';
            control.result = undefined;
            await this.persistControl(container.id, control);
            context.onOutput?.({
                stream: 'stdout',
                text: `${action}: ${container.service}`,
            });
            if (action !== 'start')
                await this.stopContainer(item, container.id, control, context);
            if (action !== 'stop') {
                item = await this.verify(container, context.signal);
                this.health.delete(container.id);
                if (control.kind === 'job') {
                    const result = await this.client.run(
                        ['start', '--attach', container.id],
                        context,
                        {
                            timeout: 1800000,
                            privateOutput: false,
                            captureStdout: false,
                        },
                    );
                    await this.verify(container, context.signal);
                    control.result = result.code;
                    await this.persistControl(container.id, control);
                } else
                    await this.client.checked(
                        ['start', container.id],
                        context,
                        { timeout: 120000 },
                    );
            }
        },
        remove: async (container, context) => {
            await this.verify(container, context.signal);
            await this.client.checked(['delete', container.id], context);
            await rm(this.controlPath(container.id), { force: true });
            this.health.delete(container.id);
        },
        logs: async (id, tail, signal) => {
            const result = await this.client.checked(
                ['logs', '-n', String(tail), id],
                { signal },
            );
            return `${result.stdout}${result.stderr}`
                .split('\n')
                .filter(Boolean)
                .slice(-tail);
        },
        exec: async (id, args, context, stdin) => {
            const item = await this.client.inspect(id, context.signal);
            if (!this.owns(item))
                throw new Error('Container ownership changed');
            return this.client.run(
                [
                    'exec',
                    ...(stdin !== undefined ? ['--interactive'] : []),
                    id,
                    ...args,
                ],
                context,
                { stdin, timeout: 1800000 },
            );
        },
        copyTo: async (id, source, target, context) => {
            const item = await this.client.inspect(id, context.signal);
            if (!this.owns(item))
                throw new Error('Container ownership changed');
            await this.client.checked(
                ['copy', source, `${id}:${target}`],
                context,
            );
        },
    };
    private persistControl(id: string, control: Control) {
        return privateJson(this.controlPath(id), control);
    }
    private async stopContainer(
        item: Awaited<ReturnType<AppleRuntimeAdapter['verify']>>,
        id: string,
        options: { stopSeconds: number; stopSignal?: string },
        context: OperationContext,
    ) {
        if (item.status === 'stopped') return;
        await this.client.checked(
            [
                'stop',
                '--time',
                String(options.stopSeconds),
                ...(options.stopSignal ? ['--signal', options.stopSignal] : []),
                id,
            ],
            context,
            { timeout: (options.stopSeconds + 20) * 1000 },
        );
    }
    private async ensureContainerVolumes(
        project: ResolvedProject,
        spec: ServiceSpec,
        saved: Record<string, string>,
        volumes: Record<string, string>,
        context: OperationContext,
    ) {
        for (const target of new Set([
            ...(spec.imageVolumes ?? []),
            ...spec.mounts
                .filter((m) => m.type === 'volume' && !m.source)
                .map((m) => m.target),
        ])) {
            if (spec.mounts.some((m) => m.target === target && m.source))
                continue;
            const name =
                volumes[target] ??
                `${project.namespace}-${spec.name}-${createHash('sha256').update(target).digest('hex').slice(0, 10)}`;
            const list = await this.client.json(
                ['volume', 'list', '--format', 'json'],
                context,
            );
            const exists = list.some(
                (v: any) => (v.id ?? v.name ?? v.configuration?.name) === name,
            );
            if (saved[target] && !exists)
                throw new LiveFailure(
                    `${spec.name}: a retained anonymous volume is missing; restore it before starting.`,
                    'blocked',
                );
            if (!exists)
                await this.client.checked(
                    [
                        'volume',
                        'create',
                        '--label',
                        `chs.dev.project=${project.namespace}`,
                        name,
                    ],
                    context,
                );
            else {
                const v = (
                    await this.client.json(['volume', 'inspect', name], context)
                )[0];
                if (
                    AppleRuntimeAdapter.resourceLabels(v)['chs.dev.project'] !==
                    project.namespace
                )
                    throw new Error(
                        `Volume ${name} is not owned by this checkout`,
                    );
            }
            volumes[target] = name;
        }
    }
    private static containerLabels(
        project: ResolvedProject,
        spec: ServiceSpec,
        volumes: Record<string, string>,
    ): Record<string, string> {
        return {
            ...spec.labels,
            'chs.dev.project': project.namespace,
            'chs.dev.directory': project.directory,
            'chs.dev.runtime': 'apple',
            'chs.dev.backend': 'native',
            'chs.dev.instance': randomUUID(),
            'chs.dev.service': spec.name,
            'chs.dev.owner-service': spec.owner,
            'chs.dev.mode': spec.mode,
            'chs.dev.kind': spec.kind,
            'chs.dev.fingerprint': spec.fingerprint ?? '',
            'chs.dev.image': spec.image ?? '',
            'chs.dev.dependencies': JSON.stringify(spec.dependencies),
            'chs.dev.volumes': JSON.stringify(volumes),
        };
    }
    private static containerCreateArgs(
        project: ResolvedProject,
        spec: ServiceSpec,
        labels: Record<string, string>,
        volumes: Record<string, string>,
    ) {
        const mounts = spec.mounts.filter(
            (m) => !(m.type === 'volume' && !m.source),
        );
        return [
            'create',
            '--name',
            spec.name,
            '--cpus',
            process.env.CHS_DEV_APPLE_CPUS ?? '2',
            '--memory',
            String(spec.memory ?? process.env.CHS_DEV_APPLE_MEMORY ?? '2g'),
            ...Object.entries(labels).flatMap(([k, v]) => [
                '--label',
                `${k}=${v}`,
            ]),
            ...Object.keys(spec.environment).flatMap((k) => ['--env', k]),
            ...Object.keys(spec.networks).flatMap((n) => [
                '--network',
                `${project.namespace}-${n},mac=${appleMac(`${project.namespace}:${n}:${spec.name}`)}`,
            ]),
            ...spec.dns.flatMap((v) => ['--dns', v]),
            ...(spec.dns.length
                ? ['--dns-option', 'timeout:1', '--dns-option', 'attempts:2']
                : []),
            ...spec.dnsSearch.flatMap((v) => ['--dns-search', v]),
            ...mounts.flatMap((m) => [
                '--mount',
                `type=${m.type},${m.source ? `source=${m.type === 'volume' ? `${project.namespace}-${m.source}` : m.source},` : ''}target=${m.target}${m.readOnly ? ',readonly' : ''}`,
            ]),
            ...Object.entries(volumes).flatMap(([target, source]) => [
                '--mount',
                `type=volume,source=${source},target=${target}`,
            ]),
            ...spec.ports.flatMap((p) => [
                '--publish',
                `${p.hostIp ? `${p.hostIp}:` : ''}${p.published}:${p.target}/${p.protocol}`,
            ]),
            ...AppleRuntimeAdapter.executionArgs(spec),
        ];
    }
    private static executionArgs(spec: ServiceSpec) {
        return [
            ...(spec.user ? ['--user', spec.user] : []),
            ...(spec.workingDir ? ['--workdir', spec.workingDir] : []),
            ...(spec.platform ? ['--platform', spec.platform] : []),
            ...(spec.entrypoint
                ? ['--entrypoint', spec.entrypoint[0] ?? '']
                : []),
            spec.imageReference ?? spec.image!,
            ...(spec.command ?? []),
        ];
    }
    private checkHealth(item: AppleInspection, context: OperationContext) {
        const key = `${item.configuration.id}:${appleIncarnation(item)}:${item.startedDate}`;
        const existing = this.probes.get(key);
        if (existing) return existing;
        const probe = this.performHealthCheck(item, context).finally(() =>
            this.probes.delete(key),
        );
        this.probes.set(key, probe);
        return probe;
    }
    private refreshHealthState(
        item: AppleInspection,
        id: string,
        incarnation: string,
    ) {
        const boot = Date.parse(item.startedDate ?? '');
        let state = this.health.get(id);
        if (
            !state ||
            state.incarnation !== incarnation ||
            (boot && boot !== state.started)
        ) {
            state = {
                incarnation,
                state: 'starting',
                failures: 0,
                next: 0,
                started: boot || Date.now(),
            };
            this.health.set(id, state);
        }
        return state;
    }
    private superseded(
        item: AppleInspection,
        current: AppleInspection | undefined,
        incarnation: string,
        id: string,
        state: HealthEntry,
    ) {
        return (
            !current ||
            appleIncarnation(current) !== incarnation ||
            current.startedDate !== item.startedDate ||
            current.status !== 'running' ||
            this.health.get(id) !== state
        );
    }
    private static scheduleNext(
        state: HealthEntry,
        h: NonNullable<ServiceSpec['health']>,
        inStart: boolean,
    ) {
        state.next =
            Date.now() +
            ((inStart ? h.startInterval : undefined) ?? h.interval ?? 30e9) /
                1e6;
    }
    private static probeArgs(
        test: readonly string[],
        h: NonNullable<ServiceSpec['health']>,
    ) {
        return test[0] === 'CMD-SHELL'
            ? [...(h.shell ?? ['/bin/sh', '-c']), test.slice(1).join(' ')]
            : test.slice(1);
    }
    private static markFailure(
        state: HealthEntry,
        inStart: boolean,
        h: NonNullable<ServiceSpec['health']>,
    ) {
        if (!inStart && ++state.failures >= (h.retries ?? 3))
            state.state = 'unhealthy';
    }
    private static probeRequired(
        control: Control | undefined,
        item: AppleInspection,
    ) {
        const test = control?.health?.test;
        return (
            !!test?.length && test[0] !== 'NONE' && item.status === 'running'
        );
    }
    private async performHealthCheck(
        item: AppleInspection,
        context: OperationContext,
    ) {
        const control = await this.control(item);
        if (!AppleRuntimeAdapter.probeRequired(control, item)) return;
        const test = control!.health!.test;
        const id = item.configuration.id,
            incarnation = appleIncarnation(item)!;
        const state = this.refreshHealthState(item, id, incarnation);
        if (state.next > Date.now()) return;
        const h = control!.health!,
            inStart = Date.now() - state.started < (h.startPeriod ?? 0) / 1e6;
        AppleRuntimeAdapter.scheduleNext(state, h, inStart);
        const args = AppleRuntimeAdapter.probeArgs(test!, h);
        try {
            const result = await this.client.run(
                ['exec', id, ...args],
                context,
                { timeout: Math.max(1, (h.timeout ?? 30e9) / 1e6) },
            );
            const current = await this.client.inspect(id, context.signal);
            if (this.superseded(item, current, incarnation, id, state)) return;
            if (result.code === 0) {
                state.state = 'healthy';
                state.failures = 0;
            } else AppleRuntimeAdapter.markFailure(state, inStart, h);
        } catch (error) {
            rethrowIfAborted(context.signal, error);
            const current = await this.client
                .inspect(id, context.signal)
                .catch(() => undefined);
            if (this.superseded(item, current, incarnation, id, state)) return;
            AppleRuntimeAdapter.markFailure(state, inStart, h);
        }
    }
    async probe(context: OperationContext) {
        const items = (await this.client.list(context.signal)).filter((i) =>
            this.owns(i),
        );
        let next = 0;
        await Promise.all(
            Array.from({ length: Math.min(4, items.length) }, async () => {
                while (next < items.length) {
                    context.signal?.throwIfAborted();
                    await this.checkHealth(items[next++]!, context);
                }
            }),
        );
    }
    private async resetRestartBackoff(
        item: AppleInspection,
        control: Control | undefined,
    ) {
        if (
            control?.retry &&
            item.status === 'running' &&
            Date.now() - Date.parse(item.startedDate ?? '') > 60000
        ) {
            delete control.retry;
            await privateJson(this.controlPath(item.configuration.id), control);
        }
    }
    async monitor(context: OperationContext) {
        for (const item of (await this.client.list(context.signal)).filter(
            (i) => this.owns(i),
        )) {
            const control = await this.control(item);
            await this.resetRestartBackoff(item, control);
            await this.checkHealth(item, context);
            if (
                !control ||
                control.kind === 'job' ||
                control.stopped ||
                !['always', 'unless-stopped'].includes(control.restart) ||
                item.status !== 'stopped'
            )
                continue;
            const id = item.configuration.id,
                retry = control.retry ?? { count: 0, next: 0 };
            if (retry.next > Date.now()) continue;
            retry.count++;
            retry.next =
                Date.now() +
                Math.min(60000, 1000 * 2 ** Math.min(retry.count, 6));
            control.retry = retry;
            await privateJson(this.controlPath(id), control);
            await this.containers.action(
                'start',
                await this.normalize(item),
                context,
            );
        }
    }
    async close() {
        this.health.clear();
        await Promise.allSettled(this.probes.values());
        this.probes.clear();
    }
}
