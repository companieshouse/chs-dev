import type { ServiceDetails, ServiceGroup } from './services.js';

export type ServiceEnabledFilter = 'All' | 'Enabled' | 'Disabled';

export function filterServices(
    groups: ServiceGroup[],
    query: string,
    options?: {
        enabled: ServiceEnabledFilter;
        details: Readonly<Record<string, ServiceDetails>>;
    },
): ServiceGroup[] {
    const term = query.trim().toLowerCase();
    const enabled =
        options?.enabled === 'Enabled'
            ? 'Yes'
            : options?.enabled === 'Disabled'
              ? 'No'
              : undefined;
    return groups
        .map((group) => ({
            ...group,
            services: group.services.filter(
                (name) =>
                    (group.name.toLowerCase().includes(term) ||
                        name.toLowerCase().includes(term)) &&
                    (!enabled || options?.details[name]?.enabled === enabled),
            ),
        }))
        .filter((group) => group.services.length > 0);
}
