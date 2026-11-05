import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { activeSettings } from '../infrastructure/settings.js';

export type { ProjectConfig } from '../domain/project.js';
import type { ProjectConfig } from '../domain/project.js';

export async function readProjectConfig(
    value = activeSettings().project.value,
    cwd = process.cwd(),
): Promise<ProjectConfig> {
    const directory = resolve(cwd, value?.trim() ? value : '.');
    try {
        if (!(await stat(directory)).isDirectory()) {
            return {
                directory,
                valid: false,
                message: 'Project path is not a directory.',
            };
        }
        await access(directory, constants.R_OK | constants.X_OK);
    } catch {
        return {
            directory,
            valid: false,
            message: 'Project directory does not exist or is not accessible.',
        };
    }

    const markers = [
        ['global.env', 'file'],
        ['bin/chs-dev', 'file'],
        ['services/modules', 'directory'],
        ['services/infrastructure', 'directory'],
    ] as const;
    const invalid: string[] = [];
    for (const [name, kind] of markers)
        if (!(await accessibleMarker(directory, name, kind)))
            invalid.push(name);

    return {
        directory,
        valid: invalid.length === 0,
        message:
            invalid.length === 0
                ? 'Valid docker-chs-development directory.'
                : `Expected docker-chs-development structure. Missing, inaccessible, or wrong type: ${invalid.join(', ')}.`,
    };
}

async function accessibleMarker(
    directory: string,
    name: string,
    kind: 'file' | 'directory',
) {
    try {
        const path = join(directory, name);
        const info = await stat(path);
        if (kind === 'file' ? !info.isFile() : !info.isDirectory())
            return false;
        await access(
            path,
            kind === 'file' ? constants.R_OK : constants.R_OK | constants.X_OK,
        );
        return true;
    } catch {
        return false;
    }
}
