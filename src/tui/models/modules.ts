import type { ServiceGroup } from '../../domain/services.js';

export interface BrowserRow {
    kind: 'module' | 'service';
    name: string;
    module: string;
    expanded?: boolean;
}

export function moduleRows(
    groups: ServiceGroup[],
    query: string,
    expanded: Record<string, boolean>,
): BrowserRow[] {
    const term = query.trim().toLowerCase();
    return groups.flatMap((group) => {
        const services = group.services.filter(
            (name) =>
                group.name.toLowerCase().includes(term) ||
                name.toLowerCase().includes(term),
        );
        if (
            term &&
            !services.length &&
            !group.name.toLowerCase().includes(term)
        )
            return [];
        const open = expanded[group.name] ?? Boolean(term);
        return [
            {
                kind: 'module' as const,
                name: group.name,
                module: group.name,
                expanded: open,
            },
            ...(open
                ? services.map((name) => ({
                      kind: 'service' as const,
                      name,
                      module: group.name,
                  }))
                : []),
        ];
    });
}

export function centeredStart(
    selected: number,
    capacity: number,
    count: number,
) {
    return Math.max(
        0,
        Math.min(selected - Math.floor(capacity / 2), count - capacity),
    );
}
