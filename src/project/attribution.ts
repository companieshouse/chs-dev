import { mapping, requiredEnvironment, type Mapping } from './compose.js';

/**
 * Where required environment variables come from: the service whose own spec
 * interpolates them, or nobody in particular (`unattributable` — document
 * top level, initialization extras, `env_file` contents).
 */
export interface EnvironmentAttribution {
    /** Required variable → services whose own spec interpolates it, sorted. */
    owners: Record<string, string[]>;
    /** Required variables no service spec interpolates. */
    unattributable: string[];
}

export interface BlockedVariables {
    /** Missing variable → its owning services and all transitive dependents, sorted. */
    blocked: Record<string, string[]>;
    /** Missing variables attributable to no service. */
    unattributable: string[];
}

/** Maps each required variable to the services whose own spec interpolates it. */
export function attributeEnvironment(
    document: Mapping,
    required: readonly string[],
): EnvironmentAttribution {
    const owners: Record<string, Set<string>> = {};
    const services = mapping(document.services) ? document.services : {};
    for (const [service, spec] of Object.entries(services)) {
        for (const variable of requiredEnvironment(spec)) {
            (owners[variable] ??= new Set()).add(service);
        }
    }
    const attributable = new Set(Object.keys(owners));
    return {
        owners: Object.fromEntries(
            Object.entries(owners).map(([variable, names]) => [
                variable,
                [...names].sort(),
            ]),
        ),
        unattributable: dedupedSorted(
            required.filter((variable) => !attributable.has(variable)),
        ),
    };
}

/**
 * Maps missing variables to blocked services: the owning services plus every
 * transitive dependent. Unattributable variables block nothing and are
 * reported as such. When `selected` is given, only those services are
 * considered.
 */
export function blockedSet(
    missing: readonly string[],
    attribution: EnvironmentAttribution,
    dependencies: ReadonlyMap<string, readonly string[]>,
    selected?: ReadonlySet<string>,
): BlockedVariables {
    const reversed = reversedDependencies(dependencies);
    const allowed = (name: string) => !selected || selected.has(name);
    const blocked: Record<string, string[]> = {};
    const unattributable = new Set(attribution.unattributable);
    for (const variable of dedupedSorted(missing)) {
        const services = blockedServices(
            variable,
            attribution,
            reversed,
            allowed,
        );
        if (services.length) blocked[variable] = services;
    }
    return {
        blocked,
        unattributable: dedupedSorted(
            missing.filter((variable) => unattributable.has(variable)),
        ),
    };
}

function dedupedSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

/** service → the services that depend on it. */
function reversedDependencies(
    dependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
    const reversed = new Map<string, string[]>();
    for (const [service, deps] of dependencies) {
        for (const dep of deps) {
            const known = reversed.get(dep);
            if (known) known.push(service);
            else reversed.set(dep, [service]);
        }
    }
    return reversed;
}

function blockedServices(
    variable: string,
    attribution: EnvironmentAttribution,
    reversed: ReadonlyMap<string, readonly string[]>,
    allowed: (name: string) => boolean,
): string[] {
    const hit = new Set<string>();
    const queue = (attribution.owners[variable] ?? []).filter(allowed);
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        if (hit.has(current)) continue;
        hit.add(current);
        for (const next of reversed.get(current) ?? []) {
            if (allowed(next) && !hit.has(next)) queue.push(next);
        }
    }
    return [...hit].sort();
}
