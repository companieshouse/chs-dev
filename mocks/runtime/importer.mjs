import { readFile } from 'node:fs/promises';
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
