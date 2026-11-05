import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ServiceGroup } from './catalog.js';

import type { ServiceDetails } from '../domain/services.js';
export type { ServiceDetails } from '../domain/services.js';
import { resolveServiceState } from '../domain/service-state.js';

export async function readServiceState(
    directory: string,
    groups: ServiceGroup[],
): Promise<Record<string, ServiceDetails>> {
    let state: Record<string, unknown> = {};
    try {
        const value: unknown = parse(
            await readFile(join(directory, '.chs-dev.yaml'), 'utf8'),
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Expected a state mapping');
        state = value as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new Error('Cannot read .chs-dev.yaml configuration');
    }
    return resolveServiceState(state, groups);
}
