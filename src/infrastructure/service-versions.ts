import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImageSelections } from '../domain/image-versions.js';
import { versionImage } from '../domain/image-versions.js';
import type { InventoryEntry } from '../domain/live.js';
import {
    serviceDefinitions,
    type ServiceDetails,
    type ServiceGroup,
} from '../domain/services.js';
import {
    environmentVersioned,
    isAwsEnvironment,
    serviceVersionSource,
    versionSourceLabels,
    type AwsEnvironment,
} from '../domain/version-sources.js';
import { readEnvironmentVersions } from './cidev-versions.js';
import { imageVersion } from '../domain/containers.js';
import type { VersionSnapshot } from '../domain/aws-versions.js';

export type EnvironmentVersions = VersionSnapshot;
export type VersionRead = (
    source: AwsEnvironment,
    signal?: AbortSignal,
) => Promise<Awaited<ReturnType<typeof readEnvironmentVersions>>>;

export class ServiceVersions {
    private readonly definitions: ReturnType<typeof serviceDefinitions>;
    private cache = new Map<AwsEnvironment, EnvironmentVersions>();
    private pending = new Map<AwsEnvironment, Promise<EnvironmentVersions>>();
    private readonly managed: Set<string>;

    constructor(
        private readonly directory: string,
        groups: ServiceGroup[],
        private readonly read: VersionRead = (source, signal) =>
            readEnvironmentVersions(source, groups, { signal }),
        private readonly now: () => number = Date.now,
    ) {
        this.definitions = serviceDefinitions(groups);
        this.managed = new Set(
            groups
                .filter((group) => group.name !== 'Infrastructure')
                .flatMap((group) =>
                    group.services.filter((name) =>
                        environmentVersioned(this.definitions[name]),
                    ),
                ),
        );
    }

    private async load(source: AwsEnvironment) {
        if (this.cache.has(source)) return this.cache.get(source);
        const raw = await readFile(
            join(this.directory, `${source}.json`),
            'utf8',
        ).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        });
        if (!raw) return undefined;
        const snapshot = JSON.parse(raw) as EnvironmentVersions;
        if (
            !Array.isArray(snapshot.matches) ||
            !snapshot.images ||
            typeof snapshot.retrievedAt !== 'string'
        )
            throw new Error(
                `Invalid cached ${source} versions. Refresh versions to repair it.`,
            );
        this.cache.set(source, snapshot);
        return snapshot;
    }

    async snapshot(
        source: AwsEnvironment,
        signal?: AbortSignal,
        refresh = false,
    ): Promise<EnvironmentVersions> {
        signal?.throwIfAborted();
        if (!refresh) {
            const cached = await this.load(source);
            signal?.throwIfAborted();
            if (cached && this.now() - Date.parse(cached.retrievedAt) < 300_000)
                return cached;
        }
        const pending = this.pending.get(source);
        if (pending) {
            const result = await pending;
            signal?.throwIfAborted();
            return result;
        }
        const work = this.fetch(source, signal);
        this.pending.set(source, work);
        try {
            return await work;
        } finally {
            this.pending.delete(source);
        }
    }

    private async fetch(source: AwsEnvironment, signal?: AbortSignal) {
        const result = {
            ...(await this.read(source, signal)),
            retrievedAt: new Date(this.now()).toISOString(),
        };
        signal?.throwIfAborted();
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, `${source}.json`);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(result), {
                flag: 'wx',
                mode: 0o600,
                signal,
            });
            signal?.throwIfAborted();
            await rename(temporary, path);
        } finally {
            await rm(temporary, { force: true });
        }
        this.cache.set(source, result);
        return result;
    }

    async images(
        inventory: InventoryEntry[],
        selections: ImageSelections,
        signal?: AbortSignal,
        warning?: (message: string) => void,
    ) {
        const images = { ...selections.serviceImages };
        for (const item of inventory) {
            if (
                item.mode !== 'Service' ||
                images[item.service] ||
                !this.definitions[item.service]?.image
            )
                continue;
            const image = await this.imageForService(
                item.service,
                selections,
                signal,
                warning,
            );
            if (image) images[item.service] = image;
        }
        return images;
    }

    async decorate(details: Record<string, ServiceDetails>) {
        const sources = new Set(
            Object.values(details)
                .map((item) => item.versionSource)
                .filter(isAwsEnvironment),
        );
        for (const source of sources) await this.load(source);
        for (const [name, item] of Object.entries(details)) {
            if (item.imagePinned || !isAwsEnvironment(item.versionSource))
                continue;
            const snapshot = this.cache.get(item.versionSource);
            const match = snapshot?.matches.find(
                (match) => match.service === name,
            );
            if (match)
                Object.assign(item, {
                    image: match.pinnedImage,
                    versionLabel: imageVersion(match.image),
                });
            else if (snapshot) item.versionLabel = 'Unmapped; project default';
        }
        return details;
    }

    private latestImage(name: string, selections: ImageSelections) {
        if (serviceVersionSource(name, selections) !== 'latest')
            return undefined;
        if (
            !this.managed.has(name) &&
            selections.serviceVersionSources?.[name] !== 'latest'
        )
            return undefined;
        return versionImage('latest', this.definitions[name].image!);
    }

    private async imageForService(
        name: string,
        selections: ImageSelections,
        signal?: AbortSignal,
        warning?: (message: string) => void,
    ) {
        const latest = this.latestImage(name, selections);
        if (latest) return latest;
        const source = serviceVersionSource(name, selections);
        if (!isAwsEnvironment(source) || !this.managed.has(name))
            return undefined;
        const snapshot = await this.snapshot(source, signal);
        const image = snapshot.images[name];
        if (image) return image;
        const message = `${name}: ${versionSourceLabels[source]} has no unambiguous running image.`;
        if (selections.serviceVersionSources?.[name])
            throw new Error(
                `${message} Choose Project default or pin an explicit image.`,
            );
        warning?.(`${message} Using the project default image.`);
        return undefined;
    }
}
