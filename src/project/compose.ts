import { join, resolve } from 'node:path';

/** A failure caused by the project's definitions or the requested configuration. */
export class ProjectError extends Error {
    override name = 'ProjectError';
}

/** Compose documents are untyped YAML. */
export type Mapping = Record<string, any>;

export const mapping = (value: unknown): value is Mapping =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export function labels(value: unknown): Record<string, unknown> {
    if (Array.isArray(value))
        return Object.fromEntries(
            value
                .filter((item): item is string => typeof item === 'string')
                .map((item) => {
                    const separator = item.indexOf('=');
                    return separator < 0
                        ? [item, '']
                        : [item.slice(0, separator), item.slice(separator + 1)];
                }),
        );
    return mapping(value) ? { ...value } : {};
}

export function merge(base: unknown, override: unknown): Mapping {
    if (!mapping(base) || !mapping(override))
        return structuredClone(override) as Mapping;
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(override)) {
        result[key] =
            mapping(value) && mapping(result[key])
                ? merge(result[key], value)
                : structuredClone(value);
    }
    return result;
}

/** Makes relative paths absolute against `base`; `./out` and `.touch` go to the operation output. */
export function normalizePaths(spec: Mapping, base: string, output: string) {
    const path = (value: string) =>
        value.includes('${') ||
        /^[a-z]+:\/\//i.test(value) ||
        value.startsWith('git@')
            ? value
            : resolve(base, value);
    if (spec.extends || spec.include)
        throw new ProjectError('Nested service imports are unsupported');
    if (typeof spec.build === 'string')
        spec.build = { context: path(spec.build) };
    if (spec.build?.context) spec.build.context = path(spec.build.context);
    if (spec.env_file) {
        spec.env_file = (
            Array.isArray(spec.env_file) ? spec.env_file : [spec.env_file]
        ).map((file: string | Mapping) =>
            typeof file === 'string'
                ? path(file)
                : { ...file, path: path(file.path) },
        );
    }
    normalizeMountPaths(spec, path, output);
    if (Array.isArray(spec.develop?.watch)) {
        spec.develop.watch = spec.develop.watch.map((watch: Mapping) => ({
            ...watch,
            path:
                watch.path === '.touch'
                    ? join(output, '.touch')
                    : path(watch.path),
        }));
    }
}

/** Interpolation requirements; bare environment entries inherit a value or remain unset. */
export function requiredEnvironment(document: unknown): string[] {
    const names = new Set<string>();
    const visit = (value: unknown) => {
        if (typeof value === 'string') {
            for (const match of value.matchAll(
                /(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::?\?[^}]*)?\}|([A-Za-z_][A-Za-z0-9_]*))/g,
            ))
                names.add((match[1] ?? match[2])!);
        } else if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (mapping(value)) Object.values(value).forEach(visit);
    };
    visit(document);
    return [...names].sort();
}

function normalizeMountPaths(
    spec: Mapping,
    path: (value: string) => string,
    output: string,
) {
    if (Array.isArray(spec.volumes)) {
        spec.volumes = spec.volumes.map((volume: string | Mapping) => {
            if (typeof volume !== 'string') {
                return volume.type === 'bind'
                    ? { ...volume, source: path(volume.source) }
                    : volume;
            }
            const [source = '', ...rest] = volume.split(':');
            if (source === './out')
                return [join(output, 'out'), ...rest].join(':');
            return source.startsWith('.')
                ? [path(source), ...rest].join(':')
                : volume;
        });
    }
}
