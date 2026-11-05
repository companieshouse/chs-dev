import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeTable, lookupRoute } from '../src/proxy/routes.js';

function source(
    service: string,
    labels: string[],
    containerPorts: number[] = [],
) {
    return {
        service,
        labels: Object.fromEntries(
            labels.map((label) => {
                const index = label.indexOf('=');
                return [label.slice(0, index), label.slice(index + 1)];
            }),
        ),
        containerPorts,
    };
}

test('routes carry the LB port, default service name, and priorities', () => {
    const rule =
        'Host(`api.chs.local`) && PathRegexp(`^/company/[a-zA-Z0-9]{8}/registers`)';
    const routes = routeTable([
        source('registers-data-api', [
            `traefik.http.routers.registers-data-api.rule=${rule}`,
            'traefik.http.services.registers-data-api.loadbalancer.server.port=8080',
        ]),
    ]);
    assert.equal(routes.length, 1);
    assert.equal(routes[0]!.service, 'registers-data-api');
    assert.equal(routes[0]!.port, 8080);
    assert.equal(routes[0]!.priority, rule.length);
    assert.ok(
        routes[0]!.matches('api.chs.local', '/company/OC123456/registers'),
    );
});

test('an explicit router service label picks the named LB port', () => {
    const routes = routeTable([
        source('psc-discrepancies-web', [
            'traefik.http.routers.pscdiscrepancies.rule=Host(`psc-discrepancies.chs.local`)',
            'traefik.http.routers.pscdiscrepancies.service=pscdiscrepancies-web',
            'traefik.http.services.pscdiscrepancies-web.loadbalancer.server.port=18636',
        ]),
    ]);
    assert.equal(routes[0]!.port, 18636);
});

test('priority labels override the rule-length default and win lookups', () => {
    const short = source('alpha', [
        'traefik.http.routers.alpha.rule=Host(`api.chs.local`)',
        'traefik.http.routers.alpha.priority=100',
        'traefik.http.services.alpha.loadbalancer.server.port=4001',
    ]);
    const long = source('beta', [
        'traefik.http.routers.beta.rule=Host(`api.chs.local`) && PathPrefix(`/deeply/nested/prefix`)',
        'traefik.http.services.beta.loadbalancer.server.port=4002',
    ]);
    const mid = source('gamma', [
        'traefik.http.routers.gamma.rule=Host(`api.chs.local`) && PathPrefix(`/deep`)',
        'traefik.http.services.gamma.loadbalancer.server.port=4003',
    ]);
    const routes = routeTable([long, short, mid]);
    assert.deepEqual(
        routes.map((route) => route.router),
        ['alpha', 'beta', 'gamma'],
    );
    assert.equal(
        lookupRoute(routes, 'api.chs.local', '/deeply/nested/prefix')?.service,
        'alpha',
    );
});

test('routers without a rule are skipped; missing LB port falls back to the container', () => {
    const routes = routeTable([
        source('registers-delta-consumer', [
            'traefik.http.services.registers-delta-consumer.loadbalancer.server.port=8080',
        ]),
        source(
            'address-lookup-api',
            [
                'traefik.http.routers.address-lookup-api.rule=Host(`api.chs.local`) && PathPrefix(`/address`) ',
            ],
            [8088],
        ),
        source(
            'orphan',
            ['traefik.http.services.orphan.loadbalancer.server.port=9'],
            [9],
        ),
    ]);
    assert.deepEqual(
        routes.map((route) => [route.service, route.port]),
        [['address-lookup-api', 8088]],
    );
    assert.equal(
        lookupRoute(routes, 'api.chs.local', '/address?q=1')?.service,
        'address-lookup-api',
    );
});

test('no matching route is undefined, and an empty table looks up cleanly', () => {
    assert.equal(lookupRoute(routeTable([]), 'api.chs.local', '/'), undefined);
});
