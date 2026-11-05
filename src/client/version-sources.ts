import type { Client } from './client.js';
import type { Scope } from '../protocol/types.js';
import type { VersionSource } from '../domain/version-sources.js';

export async function saveVersionSource(
    client: Client,
    source: VersionSource,
    scope: Scope,
    signal?: AbortSignal,
) {
    const current = await client.query(
        'configuration.snapshot',
        {},
        signal,
        scope,
    );
    signal?.throwIfAborted();
    return client.command(
        'environment.profileImport',
        {
            profile: {
                format: 'chs-dev-environment',
                version: 1,
                createdAt: new Date().toISOString(),
                selections: { ...current.selections, versionSource: source },
            },
            versionsOnly: false,
            revision: current.revision,
        },
        scope,
    );
}
