import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serviceDefinitions, type ServiceGroup } from '../domain/services.js';
import { serviceDependencies } from '../domain/service-dependencies.js';
import { projectStateDirectory } from './settings.js';
import { createProcessExecutor } from './live-process.js';
import { ClientError } from '../protocol/types.js';

export function dependencyDot(groups: ServiceGroup[], root?: string) {
    const definitions = serviceDefinitions(groups);
    if (root && !Object.hasOwn(definitions, root))
        throw new ClientError({
            code: 'UNKNOWN_SERVICE',
            message: `Unknown service: ${root}`,
        });
    const names = root
        ? [root, ...serviceDependencies(root, groups).map((item) => item.name)]
        : Object.keys(definitions);
    const included = new Set(names);
    const rows = names.sort().map((name) => `  ${JSON.stringify(name)};`);
    for (const name of names) {
        for (const dependency of definitions[name]?.dependencies ?? []) {
            if (included.has(dependency))
                rows.push(
                    `  ${JSON.stringify(name)} -> ${JSON.stringify(dependency)};`,
                );
        }
    }
    return ['digraph dependencies {', '  rankdir=TB;', ...rows, '}'].join('\n');
}

export async function dependencyDiagrams(
    directory: string,
    groups: ServiceGroup[],
    services: string[],
    signal?: AbortSignal,
) {
    const roots = services.length ? [...new Set(services)] : [undefined];
    const artifacts = join(projectStateDirectory(directory), 'diagrams');
    const execute = createProcessExecutor();
    const paths: string[] = [];
    for (const root of roots) {
        const dot = dependencyDot(groups, root);
        const result = await execute({
            command: root ? 'dot' : 'fdp',
            args: ['-Tsvg'],
            cwd: directory,
            env: process.env,
            stdin: dot,
            signal,
            timeout: 30000,
            captureStdout: true,
            captureStderr: true,
            privateOutput: true,
        }).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new ClientError({
                    code: 'GRAPHVIZ_REQUIRED',
                    message:
                        'Install Graphviz to generate dependency diagrams.',
                });
            throw error;
        });
        if (result.code !== 0)
            throw new ClientError({
                code: 'DIAGRAM_FAILED',
                message: result.stderr || 'Graphviz failed.',
            });
        await mkdir(artifacts, { recursive: true, mode: 0o700 });
        const path = join(
            artifacts,
            `${root ? encodeURIComponent(root) : 'system'}-dependency_diagram.svg`,
        );
        await writeFile(path, result.stdout, { mode: 0o600 });
        paths.push(path);
    }
    return { paths };
}
