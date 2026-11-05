import { rm } from 'node:fs/promises';
import type { LiveRuntime } from '../../src/domain/live.js';
import { AppleClient } from '../../src/infrastructure/native/apple-client.js';
import { appleNamespace } from '../../src/infrastructure/native/apple-adapter.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { projectStateDirectory } from '../../src/infrastructure/settings.js';

/** Delete only resources carrying the fixture's random checkout namespace. */
export async function cleanupAppleFixture(
    runtime: LiveRuntime,
    directory: string,
) {
    await runtime.stopProject({});
    await runtime.close?.();
    const client = new AppleClient({
            directory,
            execute: createProcessExecutor(),
            environment: { resolve: async () => ({ ...process.env }) },
        }),
        namespace = appleNamespace(directory);
    for (const kind of ['network', 'volume']) {
        const resources = await client.json([kind, 'list', '--format', 'json']);
        for (const resource of resources) {
            const config = resource.configuration ?? resource;
            if (config.labels?.['chs.dev.project'] !== namespace) continue;
            await client.checked([kind, 'delete', resource.id ?? config.name]);
        }
    }
    const images = await client.json(['image', 'list', '--format', 'json']);
    for (const image of images) {
        const reference = image.name ?? image.configuration?.name;
        if (
            typeof reference === 'string' &&
            (reference.startsWith(namespace + '/') ||
                reference.startsWith('docker.io/' + namespace + '/'))
        )
            await client.checked(['image', 'delete', reference]);
    }
    await rm(projectStateDirectory(directory), {
        recursive: true,
        force: true,
    });
}
