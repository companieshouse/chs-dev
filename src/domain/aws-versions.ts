import { imageRepository } from './image-versions.js';
import { serviceDefinitions, type ServiceGroup } from './services.js';
import type { EnvironmentProfile } from './environment-profile.js';
import type { AwsEnvironment } from './version-sources.js';

export interface RunningServiceImage {
    cluster: string;
    ecsService: string;
    container: string;
    image: string;
    digest?: string;
    architecture?: string;
}

export interface VersionMatch extends RunningServiceImage {
    service: string;
    pinnedImage: string;
}

export interface VersionAmbiguity {
    service: string;
    candidates: RunningServiceImage[];
}

export interface CidevVersionResult {
    profile: EnvironmentProfile;
    matches: VersionMatch[];
    ambiguous: VersionAmbiguity[];
    warnings: string[];
    clusters: number;
    runningTasks: number;
}

export interface CidevVersionOptions {
    profile?: string;
    region?: string;
}

export interface VersionSnapshot {
    images: Record<string, string>;
    matches: VersionMatch[];
    ambiguous: VersionAmbiguity[];
    warnings: string[];
    clusters: number;
    runningTasks: number;
    retrievedAt: string;
}

function repository(reference: string) {
    return imageRepository(
        reference.replace(/\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*/g, 'placeholder'),
    );
}

function candidatesFor(
    name: string,
    rows: RunningServiceImage[],
    shared: boolean,
    environment: AwsEnvironment,
) {
    const canonical = `${environment}-${name.replace(/-ch-gov-uk$/, '')}`;
    const exact = rows.filter(
        (row) =>
            row.ecsService === canonical ||
            (environment !== 'cidev' && row.ecsService === name),
    );
    if (exact.length) return exact;
    // Shared images such as eric need a source service, rather than a sidecar chosen by order.
    return shared ? [] : rows;
}

function uniqueImages(rows: RunningServiceImage[]) {
    return [
        ...new Map(
            rows.map((row) => [
                `${repository(row.image)}@${row.digest ?? row.image}`,
                row,
            ]),
        ).values(),
    ];
}

export function matchCidevImages(
    groups: ServiceGroup[],
    rows: RunningServiceImage[],
) {
    return matchEnvironmentImages(groups, rows, 'cidev');
}

export function matchEnvironmentImages(
    groups: ServiceGroup[],
    rows: RunningServiceImage[],
    environment: AwsEnvironment,
) {
    const definitions = serviceDefinitions(groups);
    const repositories = new Map<string, string[]>();
    for (const [name, definition] of Object.entries(definitions)) {
        if (!definition.image || definition.deprecated) continue;
        const key = repository(definition.image);
        repositories.set(key, [...(repositories.get(key) ?? []), name]);
    }
    const matches: VersionMatch[] = [];
    const ambiguous: VersionAmbiguity[] = [];
    const warnings: string[] = [];
    for (const [image, names] of repositories) {
        const sources = rows.filter(
            (row) =>
                repository(row.image) === image &&
                (environment !== 'cidev' ||
                    row.ecsService.startsWith('cidev-')),
        );
        if (!sources.length) continue;
        for (const name of names)
            matchService(
                { name, sources, shared: names.length > 1, environment },
                { matches, ambiguous, warnings },
            );
    }
    return {
        matches,
        ambiguous,
        warnings,
        images: Object.fromEntries(
            matches.map((match) => [match.service, match.pinnedImage]),
        ),
    };
}

function matchService(
    source: {
        name: string;
        sources: RunningServiceImage[];
        shared: boolean;
        environment: AwsEnvironment;
    },
    result: {
        matches: VersionMatch[];
        ambiguous: VersionAmbiguity[];
        warnings: string[];
    },
) {
    const candidates = uniqueImages(
        candidatesFor(
            source.name,
            source.sources,
            source.shared,
            source.environment,
        ),
    );
    if (candidates.length !== 1) {
        result.ambiguous.push({
            service: source.name,
            candidates: source.sources,
        });
        result.warnings.push(
            `${source.name}: multiple deployments or shared images need an explicit source; no version copied.`,
        );
        return;
    }
    const row = candidates[0];
    if (!row.digest || !/^sha256:[a-f0-9]{64}$/.test(row.digest)) {
        result.warnings.push(
            `${source.name}: ECS did not report a usable image digest; no version copied.`,
        );
        return;
    }
    result.matches.push({
        ...row,
        service: source.name,
        pinnedImage: `${repository(row.image)}@${row.digest}`,
    });
}
