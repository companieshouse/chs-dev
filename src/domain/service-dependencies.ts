import { serviceDefinitions } from './services.js';
import type { ServiceGroup } from './services.js';

export interface DependencyTreeRow {
    name: string;
    prefix: string;
    required: boolean;
    reference?: 'shared' | 'cycle';
}

export function dependencyTree(
    name: string,
    groups: ServiceGroup[],
    direction: 'dependencies' | 'dependents' = 'dependencies',
): DependencyTreeRow[] {
    const definitions = serviceDefinitions(groups);
    const edges: Record<string, string[]> = {};
    for (const [service, definition] of Object.entries(definitions)) {
        if (direction === 'dependencies')
            edges[service] = definition.dependencies;
        else
            for (const dependency of definition.dependencies)
                (edges[dependency] ??= []).push(service);
    }
    const expanded = new Set([name]);
    const rows: DependencyTreeRow[] = [];
    const walk = (parent: string, prefix: string, ancestors: Set<string>) => {
        const children = [...new Set(edges[parent] ?? [])].sort();
        children.forEach((child, index) => {
            const last = index === children.length - 1;
            const reference = ancestors.has(child)
                ? 'cycle'
                : expanded.has(child)
                  ? 'shared'
                  : undefined;
            rows.push({
                name: child,
                prefix: `${prefix}${last ? '└─ ' : '├─ '}`,
                required: definitions[child]?.base ?? false,
                reference,
            });
            if (reference) return;
            expanded.add(child);
            walk(
                child,
                `${prefix}${last ? '   ' : '│  '}`,
                new Set([...ancestors, child]),
            );
        });
    };
    walk(name, '', new Set([name]));
    return rows;
}

export function serviceDependencies(name: string, groups: ServiceGroup[]) {
    const definitions = serviceDefinitions(groups);
    const direct = new Set(definitions[name]?.dependencies ?? []);
    const visited = new Set([name]);
    const visit = (service: string) => {
        if (visited.has(service)) return;
        visited.add(service);
        for (const dependency of definitions[service]?.dependencies ?? [])
            visit(dependency);
    };
    for (const dependency of direct) visit(dependency);
    return [...visited]
        .filter((service) => service !== name)
        .sort()
        .map((service) => ({
            name: service,
            direct: direct.has(service),
            required: definitions[service]?.base ?? false,
        }));
}
