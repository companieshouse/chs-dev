/**
 * Traefik docker-provider label parsing, scoped to what the checkout uses
 * (see .scratch/chs-dev-remediation/assets/router-label-inventory.md): http
 * routers with rule/priority/service, and load-balancer ports. No
 * entrypoints, TLS, middlewares, or tcp/udp routers exist.
 */
export interface RouterLabel {
    name: string;
    rule: string;
    priority?: number;
    service?: string;
}

export interface ParsedRouterLabels {
    routers: RouterLabel[];
    /** Traefik service name to load-balancer port. */
    ports: Record<string, number>;
}

const routerKey =
    /^traefik\.http\.routers\.([^.]+)\.(rule|priority|service|ruleSyntax|entrypoints)$/;

export function routerLabels(
    labels: Record<string, unknown>,
): ParsedRouterLabels {
    const routers = new Map<string, RouterLabel>();
    const ports: Record<string, number> = {};
    for (const [key, value] of Object.entries(labels)) {
        const router = routerKey.exec(key);
        if (router) {
            collectRouter(routers, router[1]!, router[2]!, value);
            continue;
        }
        const port =
            /^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/.exec(
                key,
            );
        if (port && value !== undefined) ports[port[1]!] = Number(value);
    }
    return { routers: [...routers.values()].sort(byName), ports };
}

function collectRouter(
    routers: Map<string, RouterLabel>,
    name: string,
    field: string,
    value: unknown,
) {
    const router = routers.get(name) ?? { name, rule: '' };
    if (field === 'rule') router.rule = String(value ?? '');
    if (field === 'priority') {
        const priority = Number(value);
        if (Number.isFinite(priority) && priority > 0)
            router.priority = priority;
    }
    if (field === 'service') router.service = String(value ?? '');
    routers.set(name, router);
}

const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
