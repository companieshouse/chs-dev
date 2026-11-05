import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { basename, dirname } from 'node:path';

export async function importContract(endpoint, artifact, signal) {
    const contents = await readFile(artifact);
    const form = new FormData();
    form.set(
        'file',
        new Blob([contents], { type: 'application/json' }),
        `${basename(dirname(artifact))}-${basename(artifact)}`,
    );
    const response = await fetch(
        `${endpoint}/api/artifact/upload?mainArtifact=true`,
        {
            method: 'POST',
            body: form,
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        },
    );
    if (!response.ok)
        throw new Error(
            `Microcks import returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
        );
    await response.arrayBuffer();
}

export async function waitForImport(options) {
    const deadline = Date.now() + (options.timeout ?? 180000);
    let lastError;
    while (Date.now() < deadline) {
        options.signal.throwIfAborted();
        try {
            await importContract(
                options.endpoint,
                options.artifact,
                options.signal,
            );
            return;
        } catch (error) {
            lastError = error;
        }
        await delay(1000, undefined, { signal: options.signal });
    }
    throw new Error(
        `Cannot import the mock contract into Microcks: ${lastError?.message}`,
    );
}
