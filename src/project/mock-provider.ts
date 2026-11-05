import { join } from 'node:path';
import type { InventoryEntry } from '../domain/live.js';
import { mockRuntimeService } from '../domain/live.js';
import { labels, ProjectError, type Mapping } from './compose.js';
import {
    mocksDirectory,
    readMockCatalogue,
    type MockContract,
} from './mock-catalogue.js';
import type { ServiceDefinition } from './resolve.js';
import type { ProjectFs } from './files.js';

export async function mockProviderSpec(
    item: InventoryEntry,
    definition: ServiceDefinition,
    output: string,
    fs: ProjectFs,
): Promise<Mapping> {
    const catalogue = await readMockCatalogue();
    const contract = catalogue.services[item.service];
    if (!contract)
        throw new ProjectError(`No mock contract for ${item.service}.`);
    const config = join(output, `${item.service}.json`);
    await writeMockConfiguration(
        output,
        config,
        { ...contract, service: item.service, scenario: item.mockScenario },
        fs,
    );
    return {
        image: 'node:22.20.0-alpine',
        command: ['node', '/opt/chs-mocks/runtime/server.mjs'],
        labels: mockLabels(definition, contract),
        environment: {
            CHS_MOCK_ENDPOINT: `http://${mockRuntimeService}:8080`,
            CHS_MOCK_CONTRACT: `/opt/chs-mock-contract/${item.service}.json`,
            CHS_MOCK_BOOTSTRAP: '/opt/chs-mock-contract/bootstrap.json',
        },
        volumes: [
            {
                type: 'bind',
                source: mocksDirectory,
                target: '/opt/chs-mocks',
                read_only: true,
            },
            {
                type: 'bind',
                source: output,
                target: '/opt/chs-mock-contract',
                read_only: true,
            },
        ],
        networks: definition.spec.networks ?? ['chs'],
        expose: contract.ports,
        restart: 'unless-stopped',
        depends_on: { [mockRuntimeService]: { condition: 'service_started' } },
        healthcheck: {
            test: [
                'CMD',
                'node',
                '-e',
                `fetch('http://127.0.0.1:${contract.ports[0]}/__chs_mock/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`,
            ],
            interval: '5s',
            timeout: '3s',
            retries: 3,
            start_period: '180s',
        },
    };
}

function mockLabels(
    definition: ServiceDefinition,
    contract: MockContract,
): Mapping {
    const result = Object.fromEntries(
        Object.entries(labels(definition.spec.labels)).filter(
            ([key]) => key.startsWith('traefik.') || key === 'chs.description',
        ),
    );
    result['traefik.enable'] = 'true';
    const ports = Object.entries(result).filter(([key]) =>
        key.endsWith('.loadbalancer.server.port'),
    );
    if (ports.some(([, port]) => !contract.ports.includes(Number(port))))
        throw new ProjectError(
            `${contract.title}: mock ports must cover every ingress service port.`,
        );
    return result;
}

async function writeMockConfiguration(
    directory: string,
    path: string,
    value: unknown,
    fs: ProjectFs,
) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const contents = JSON.stringify(value);
    if (fs.replaceFile) await fs.replaceFile(path, contents);
    else await fs.writeFile(path, contents, { flag: 'wx', mode: 0o600 });
}

export async function prepareMockBootstrap(
    inventory: readonly InventoryEntry[],
    directory: string,
    fs: ProjectFs,
) {
    const selected = inventory.filter((item) => item.mockScenario);
    if (!selected.length) return;
    const catalogue = await readMockCatalogue();
    await writeMockConfiguration(
        directory,
        join(directory, 'bootstrap.json'),
        {
            importer: selected.map((item) => item.service).sort()[0],
            contracts: selected.map((item) => catalogue.services[item.service]),
        },
        fs,
    );
}

export async function microcksSpec(): Promise<Mapping> {
    const catalogue = await readMockCatalogue();
    return {
        image: catalogue.image,
        labels: {
            'traefik.enable': 'false',
            'chs.dev.mode': 'Mock',
            'chs.dev.owner-service': mockRuntimeService,
        },
        networks: ['chs'],
        expose: [8080],
        ports: ['127.0.0.1:8585:8080'],
        restart: 'unless-stopped',
    };
}
