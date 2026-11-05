import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseEnv, promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import {
    parseEnvironmentProfile,
    profileChanges,
    profileSelections,
    validateEnvironmentSelections,
    type EnvironmentProfile,
    type ProfilePreview,
} from '../domain/environment-profile.js';
import {
    selectionKeys,
    type ProjectSelections,
} from '../domain/configuration.js';
import { validImage } from '../domain/image-versions.js';
import { selectedProvider } from '../domain/providers.js';
import { resolveServiceState } from '../domain/service-state.js';
import { serviceDefinitions, type ServiceGroup } from '../domain/services.js';
import type { InventoryEntry } from '../domain/live.js';
import type { ImageSelections } from '../domain/image-versions.js';
import { configurationSnapshot } from './configuration.js';
import {
    loadDocument,
    requireRevision,
    writeAtomically,
} from './service-configuration.js';
import { mockArtifactPath, readMockCatalogue } from './mock-catalogue.js';

const exec = promisify(execFile);
const configurationKeys = [
    ...selectionKeys,
    'excludedFiles',
    'serviceProviders',
    'mockScenarios',
    'serviceImages',
    'versionSource',
    'serviceVersionSources',
    'journey',
] as const;

export function profilePath(path: string, directory: string): string {
    if (!path.trim()) throw new Error('Choose an environment file path.');
    return path.startsWith('~/')
        ? join(homedir(), path.slice(2))
        : resolve(directory, path);
}

async function projectRevision(directory: string): Promise<string | undefined> {
    return exec('git', ['-C', directory, 'rev-parse', 'HEAD'], {
        timeout: 5000,
    }).then(
        (result) => result.stdout.trim(),
        () => undefined,
    );
}

async function imageEnvironment(directory: string) {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ['global.env', '.env']) {
        const text = await readFile(join(directory, name), 'utf8').catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return '';
                throw error;
            },
        );
        Object.assign(environment, parseEnv(text));
    }
    return { ...environment, ...process.env };
}

function resolveImage(image: string, environment: NodeJS.ProcessEnv) {
    const resolved = image.replace(
        /\$\{([A-Za-z_]\w*)(?:(:-|-)([^}]*))?\}|\$([A-Za-z_]\w*)/g,
        (
            _token,
            name: string,
            operator: string,
            fallback: string,
            short: string,
        ) => {
            const value = environment[name ?? short];
            return operator === ':-'
                ? value || fallback
                : (value ?? fallback ?? '');
        },
    );
    if (!validImage(resolved))
        throw new Error(`Cannot resolve container image: ${image}`);
    return resolved;
}

async function mockFingerprints(
    selections: ProjectSelections,
    groups: ServiceGroup[],
) {
    const catalogue = await readMockCatalogue();
    const hashes: Record<string, string> = {};
    for (const name of Object.keys(serviceDefinitions(groups))) {
        if (selectedProvider(name, selections) !== 'mock') continue;
        const contract = catalogue.services[name];
        if (!contract) throw new Error(`Missing mock contract for ${name}.`);
        hashes[name] = createHash('sha256')
            .update(await readFile(await mockArtifactPath(contract.artifact)))
            .digest('hex');
    }
    return hashes;
}

export class EnvironmentProfiles {
    constructor(
        private readonly directory: string,
        private readonly groups: ServiceGroup[],
        private readonly resolveImages?: (
            inventory: InventoryEntry[],
            selections: ImageSelections,
        ) => Promise<Record<string, string>>,
    ) {}

    async snapshot(resolveVersions = true): Promise<EnvironmentProfile> {
        const { selections } = await configurationSnapshot(this.directory);
        validateEnvironmentSelections(selections, this.groups);
        const definitions = serviceDefinitions(this.groups);
        const details = resolveServiceState(selections, this.groups);
        const environment = await imageEnvironment(this.directory);
        const inventory: InventoryEntry[] = Object.entries(details).flatMap(
            ([service, item]) =>
                item.enabled === 'Yes' && item.mode !== 'Unknown'
                    ? [{ service, mode: item.mode }]
                    : [],
        );
        const images =
            resolveVersions && this.resolveImages
                ? await this.resolveImages(inventory, selections)
                : { ...selections.serviceImages };
        for (const [name, item] of Object.entries(details)) {
            if (
                item.enabled !== 'Yes' ||
                item.mode !== 'Service' ||
                images[name]
            )
                continue;
            if (definitions[name].image)
                images[name] = resolveImage(
                    definitions[name].image!,
                    environment,
                );
        }
        return {
            format: 'chs-dev-environment',
            version: 1,
            createdAt: new Date().toISOString(),
            projectRevision: await projectRevision(this.directory),
            selections: { ...selections, serviceImages: images },
            mockContracts: await mockFingerprints(selections, this.groups),
        };
    }

    async preview(
        profile: EnvironmentProfile,
        versionsOnly = false,
    ): Promise<ProfilePreview> {
        const parsed = parseEnvironmentProfile(profile);
        const current = await configurationSnapshot(this.directory);
        const next = profileSelections(
            current.selections,
            parsed,
            versionsOnly,
        );
        validateEnvironmentSelections(next, this.groups);
        return {
            profile: parsed,
            revision: current.revision,
            changes: profileChanges(current.selections, next, this.groups),
            warnings: await this.warnings(parsed, next),
        };
    }

    private async warnings(
        profile: EnvironmentProfile,
        next: ProjectSelections,
    ) {
        const warnings: string[] = [];
        if (
            profile.projectRevision &&
            profile.projectRevision !== (await projectRevision(this.directory))
        )
            warnings.push(
                'The docker-chs-development revision differs from the exported environment.',
            );
        const fingerprints = await mockFingerprints(next, this.groups);
        for (const [name, hash] of Object.entries(
            profile.mockContracts ?? {},
        )) {
            if (fingerprints[name] !== hash)
                warnings.push(
                    `${name}: the local mock contract differs from the exported environment.`,
                );
        }
        const floating = Object.keys(next.serviceImages ?? {}).filter(
            (name) => !next.serviceImages![name].includes('@sha256:'),
        );
        if (floating.length)
            warnings.push(
                `Tags can move; ${floating.length} image pins use tags rather than immutable digests.`,
            );
        return warnings;
    }

    async read(path: string): Promise<EnvironmentProfile> {
        const target = profilePath(path, this.directory);
        if ((await stat(target)).size > 1024 * 1024)
            throw new Error('Environment files must be smaller than 1 MiB.');
        return parseEnvironmentProfile(parse(await readFile(target, 'utf8')));
    }

    async export(path: string, force = false, source?: EnvironmentProfile) {
        const profile = source
            ? parseEnvironmentProfile(source)
            : await this.snapshot();
        const target = profilePath(path, this.directory);
        const preview = await this.preview(profile);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, stringify(profile), {
            flag: force ? 'w' : 'wx',
            mode: 0o600,
        });
        return { path: target, warnings: preview.warnings };
    }

    async save(options: {
        profile: EnvironmentProfile;
        versionsOnly: boolean;
        revision: string;
        beforeCommit?: (revision: string) => Promise<void>;
    }) {
        const path = join(this.directory, '.chs-dev.yaml');
        const read = () =>
            readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
        const original = await read();
        requireRevision(original, options.revision);
        const document = loadDocument(original);
        const next = profileSelections(
            (await configurationSnapshot(this.directory)).selections,
            parseEnvironmentProfile(options.profile),
            options.versionsOnly,
        );
        validateEnvironmentSelections(next, this.groups);
        for (const key of configurationKeys) {
            if (next[key] === undefined) document.delete(key);
            else document.set(key, next[key]);
        }
        const revision = createHash('sha256')
            .update(document.toString())
            .digest('hex');
        await options.beforeCommit?.(revision);
        await writeAtomically(path, read, original, document);
        return configurationSnapshot(this.directory);
    }
}
