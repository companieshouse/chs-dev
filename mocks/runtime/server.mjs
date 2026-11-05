import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { waitForBootstrap, reconcileContracts } from './bootstrap.mjs';
import { proxyMock, mockFailure } from './proxy.mjs';
import { handleCallback } from './callback.mjs';

export function createMockServer(options) {
    return createServer((incoming, outgoing) => {
        handleRequest(incoming, outgoing, options).catch((error) =>
            mockFailure(outgoing, error.message),
        );
    });
}

async function requestOptions(options) {
    if (!options.configFile) return options;
    const selection = JSON.parse(await readFile(options.configFile, 'utf8'));
    if (
        !options.scenarios.some(
            (scenario) => scenario.name === selection.scenario,
        )
    )
        throw new Error('The saved mock scenario is not in this contract.');
    return { ...options, scenario: selection.scenario };
}

async function handleRequest(incoming, outgoing, configuration) {
    const options = await requestOptions(configuration);
    const path = (incoming.url ?? '/').split('?')[0];
    if (path === '/__chs_mock/health' || options.healthPaths.includes(path)) {
        outgoing.writeHead(200, { 'content-type': 'application/json' });
        outgoing.end(
            JSON.stringify({
                provider: 'mock',
                scenario: options.scenario,
            }),
        );
        return;
    }
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(400);
        outgoing.end();
        return;
    }
    if (
        incoming.method === 'POST' &&
        path === options.asyncCallback?.requestPath
    )
        return handleCallback(incoming, outgoing, options);
    proxyMock(incoming, outgoing, options);
}

async function refreshImport(options, cache) {
    try {
        await reconcileContracts(options, cache);
    } catch (error) {
        if (!options.signal.aborted)
            console.error(`Mock contract refresh failed: ${error.message}`);
    }
}

export async function startMockServers(environment = process.env) {
    const contract = JSON.parse(
        await readFile(environment.CHS_MOCK_CONTRACT, 'utf8'),
    );
    const controller = new AbortController();
    const options = {
        ...contract,
        endpoint: environment.CHS_MOCK_ENDPOINT,
        scenario: contract.scenario,
        configFile: environment.CHS_MOCK_CONTRACT,
        bootstrapFile: environment.CHS_MOCK_BOOTSTRAP,
        mocksRoot: '/opt/chs-mocks',
        signal: controller.signal,
    };
    const servers = [];
    const stop = () => {
        controller.abort();
        for (const server of servers) server.closeAllConnections();
        for (const server of servers) server.close();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    const cache = new Map();
    await waitForBootstrap(options, cache);
    for (const port of contract.ports) {
        const server = createMockServer(options);
        server.on('error', (error) => {
            console.error(error.message);
            stop();
            process.exitCode = 1;
        });
        server.listen(port, '0.0.0.0');
        servers.push(server);
    }
    let timer;
    const refresh = async () => {
        await refreshImport(options, cache);
        if (controller.signal.aborted) return;
        timer = setTimeout(refresh, 15000);
        timer.unref();
    };
    timer = setTimeout(refresh, 15000);
    timer.unref();
    controller.signal.addEventListener('abort', () => clearTimeout(timer), {
        once: true,
    });
    console.log(`Mock provider ready: ${contract.title} (${options.scenario})`);
    return { servers, stop };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    startMockServers().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
