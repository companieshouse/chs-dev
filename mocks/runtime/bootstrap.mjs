import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { importContract } from './importer.mjs';

async function services(options) {
    const response = await fetch(`${options.endpoint}/api/services`, {
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok)
        throw new Error(
            `Microcks service discovery returned HTTP ${response.status}.`,
        );
    const value = await response.json();
    if (!Array.isArray(value))
        throw new Error('Microcks returned an invalid service catalogue.');
    return value;
}

function hasContract(available, contract) {
    return available.some(
        (service) =>
            service.name === contract.title &&
            service.version === contract.version,
    );
}

export async function reconcileContracts(options, cache) {
    const bootstrap = JSON.parse(await readFile(options.bootstrapFile, 'utf8'));
    const available = await services(options);
    if (bootstrap.importer !== options.service)
        return hasContract(available, options);
    for (const contract of bootstrap.contracts) {
        const artifact = join(options.mocksRoot, contract.artifact);
        const digest = createHash('sha256')
            .update(await readFile(artifact))
            .digest('hex');
        if (cache.get(artifact) === digest && hasContract(available, contract))
            continue;
        await importContract(options.endpoint, artifact, options.signal);
        cache.set(artifact, digest);
    }
    return true;
}

export async function waitForBootstrap(options, cache) {
    const deadline = Date.now() + 180000;
    let lastError;
    while (Date.now() < deadline) {
        options.signal.throwIfAborted();
        try {
            if (await reconcileContracts(options, cache)) return;
        } catch (error) {
            lastError = error;
        }
        await delay(1000, undefined, { signal: options.signal });
    }
    throw new Error(
        `Cannot load mock contracts into Microcks: ${lastError?.message ?? 'contract not available'}`,
    );
}
