import { routerLabels, type RouterLabel } from './labels.js';
import { compileRule, type RuleMatcher } from './rule.js';

/** What the proxy needs to know about one running container. */
export interface RouteSource {
    service: string;
    labels: Record<string, unknown>;
    /** Container ports observed on the container, for the no-LB-label fallback. */
    containerPorts: number[];
    /** URL paths the container's own healthcheck probes. */
    healthcheckPaths: string[];
}

export interface Route {
    router: string;
    service: string;
    port: number;
    priority: number;
    matches(host: string, path: string): boolean;
    /** URL paths this service's healthcheck probes, for accounting. */
    healthcheckPaths: string[];
}

const DEFAULT_LB_PORT = 80;

/**
 * Builds the route table the way the docker provider would: one route per
 * router with a rule, priority from the label or the rule length (the
 * provider default), and the upstream port from the router's service, the
 * same-named service, or the container's own ports.
 */
export function routeTable(sources: RouteSource[]): Route[] {
    const routes: Route[] = [];
    for (const source of sources) {
        const { routers, ports } = routerLabels(source.labels);
        for (const router of routers) {
            if (!router.rule) continue;
            routes.push(route(source, router, ports, compileRule(router.rule)));
        }
    }
    return routes.sort(byPrecedence);
}

function route(
    source: RouteSource,
    router: RouterLabel,
    ports: Record<string, number>,
    matches: RuleMatcher,
): Route {
    return {
        router: router.name,
        service: source.service,
        port: routeFor(router, ports, source.containerPorts),
        priority: router.priority ?? router.rule.length,
        matches,
        healthcheckPaths: source.healthcheckPaths,
    };
}

function routeFor(
    router: { name: string; service?: string },
    ports: Record<string, number>,
    containerPorts: number[],
): number {
    const port = ports[router.service ?? router.name];
    if (port !== undefined) return port;
    return containerPorts[0] ?? DEFAULT_LB_PORT;
}

function byPrecedence(a: Route, b: Route): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.router.localeCompare(b.router);
}

/** Highest-priority matching route wins; ties break on router name. */
export function lookupRoute(
    routes: Route[],
    host: string,
    path: string,
): Route | undefined {
    return routes.find((route) => route.matches(host, path));
}

/**
 * Merges routes from running containers with routes for stopped lazy
 * services (authored in the checkout definitions); the running view wins so
 * a running service is never shadowed by its definition.
 */
export function mergeRoutes(running: Route[], lazy: Route[]): Route[] {
    const runningServices = new Set(running.map((route) => route.service));
    return [
        ...running,
        ...lazy.filter((route) => !runningServices.has(route.service)),
    ].sort(byPrecedence);
}
