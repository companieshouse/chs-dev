import { serviceDefinitions } from './services.js';
import type { ServiceGroup } from './services.js';
import type { ServiceDetails } from './services.js';

export interface EnabledTreeRow {
    kind: 'module' | 'service';
    name: string;
    prefix: string;
    reference?: 'shared' | 'cycle';
}

export function enabledTree(
    groups: ServiceGroup[],
    details: Record<string, ServiceDetails>,
): EnabledTreeRow[] {
    const definitions = serviceDefinitions(groups);
    const modules = new Map(
        groups.flatMap((group) =>
            group.services.map((name) => [name, group.name] as const),
        ),
    );
    const enabled = [...modules.keys()]
        .filter((name) => details[name]?.enabled === 'Yes')
        .sort();
    const enabledSet = new Set(enabled);
    const children = (name: string) =>
        [...new Set(definitions[name]?.dependencies ?? [])]
            .filter((child) => enabledSet.has(child))
            .sort();
    const referenced = new Set(enabled.flatMap(children));
    const roots = enabled.filter((name) => !referenced.has(name));
    const covered = new Set<string>();
    const cover = (name: string) => {
        if (covered.has(name)) return;
        covered.add(name);
        children(name).forEach(cover);
    };
    roots.forEach(cover);
    // Components made entirely of cycles still need a visible root.
    for (const name of enabled)
        if (!covered.has(name)) {
            roots.push(name);
            cover(name);
        }

    const rows: EnabledTreeRow[] = [];
    const expanded = new Set<string>();
    const append = (
        names: string[],
        prefix: string,
        ancestors: Set<string>,
    ) => {
        names.forEach((name, index) => {
            const last = index === names.length - 1;
            const reference = ancestors.has(name)
                ? 'cycle'
                : expanded.has(name)
                  ? 'shared'
                  : undefined;
            rows.push({
                kind: 'service',
                name,
                prefix: `${prefix}${last ? '└─ ' : '├─ '}`,
                reference,
            });
            if (reference) return;
            expanded.add(name);
            append(
                children(name),
                `${prefix}${last ? '   ' : '│  '}`,
                new Set([...ancestors, name]),
            );
        });
    };
    for (const group of groups) {
        const moduleRoots = roots
            .filter((name) => modules.get(name) === group.name)
            .sort();
        if (!moduleRoots.length) continue;
        rows.push({ kind: 'module', name: group.name, prefix: '' });
        append(moduleRoots, '', new Set());
    }
    return rows;
}
