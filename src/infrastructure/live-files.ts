import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { parse } from 'yaml';
import { resolveServiceState } from '../domain/service-state.js';
import type { ConfigurationRevision } from '../domain/live.js';
import { LiveFailure, withMockRuntime } from '../domain/live.js';
import type { ServiceGroup } from '../domain/services.js';

export interface LiveFiles {
    read(path: string): Promise<string>;
    writeExclusive(path: string, text: string): Promise<void>;
    mkdir(path: string, exclusive?: boolean): Promise<void>;
    remove(path: string): Promise<void>;
    realpath(path: string): Promise<string>;
}
export const liveFiles: LiveFiles = {
    read: (path) => readFile(path, 'utf8'),
    writeExclusive: (path, text) =>
        writeFile(path, text, { flag: 'wx', mode: 0o600 }),
    mkdir: async (path, exclusive = false) => {
        await mkdir(path, { recursive: !exclusive, mode: 0o700 });
    },
    remove: (path) => rm(path, { recursive: true, force: true }),
    realpath,
};
export function configurationStore(
    directory: string,
    groups: ServiceGroup[],
    files: LiveFiles,
) {
    return {
        async read(): Promise<ConfigurationRevision> {
            let yaml: string;
            try {
                yaml = await files.read(join(directory, '.chs-dev.yaml'));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
                yaml = '{}\n';
            }
            const details = resolveServiceState(parse(yaml), groups);
            return {
                identity: createHash('sha256').update(yaml).digest('hex'),
                yaml,
                inventory: withMockRuntime(
                    Object.entries(details).flatMap(([service, value]) =>
                        value.enabled === 'Yes' && value.mode !== 'Unknown'
                            ? [
                                  {
                                      service,
                                      mode: value.mode,
                                      ...(value.mockScenario
                                          ? { mockScenario: value.mockScenario }
                                          : {}),
                                  },
                              ]
                            : [],
                    ),
                ),
            };
        },
    };
}
/** An exclusive lock file in the project's state directory. */
export function projectLock(
    stateDirectory: string,
    files: LiveFiles,
    token = randomUUID(),
) {
    return {
        async acquire() {
            await files.mkdir(stateDirectory);
            const path = join(stateDirectory, 'live.lock');
            try {
                await files.writeExclusive(path, token);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    throw new LiveFailure(
                        `Another Live session owns this project (${path}). Close it first. Remove a stale lock only after confirming no Live session is running.`,
                        'blocked',
                    );
                }
                throw error;
            }
            return async () => {
                if ((await files.read(path)) !== token)
                    throw new Error(
                        'Project lock changed; refusing to remove it.',
                    );
                await files.remove(path);
            };
        },
    };
}
