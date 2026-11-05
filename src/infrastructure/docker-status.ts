import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const exec = promisify(execFile);
import { mergeStatus, type ServiceStatus } from '../domain/runtime.js';
import {
    containerStatus,
    type ContainerSnapshot,
} from './runtimes/docker-state.js';
export { mergeStatus } from '../domain/runtime.js';
export type { ServiceStatus } from '../domain/runtime.js';
export {
    containerStatus,
    type ContainerSnapshot,
} from './runtimes/docker-state.js';

export async function readDockerStatuses(
    directory: string,
    signal?: AbortSignal,
): Promise<Record<string, ServiceStatus>> {
    const options = { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal };
    const { stdout } = await exec(
        'docker',
        ['ps', '-aq', '--filter', 'label=com.docker.compose.service'],
        options,
    );
    const ids = stdout.trim().split(/\s+/).filter(Boolean);
    const containers: ContainerSnapshot[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const { stdout: snapshots } = await exec(
            'docker',
            [
                'inspect',
                '--format',
                '{"labels":{{json .Config.Labels}},"state":{{json .State}}}',
                ...ids.slice(offset, offset + 100),
            ],
            options,
        );
        for (const line of snapshots.trim().split('\n').filter(Boolean)) {
            containers.push(JSON.parse(line) as ContainerSnapshot);
        }
    }
    return statusesForProject(directory, containers);
}

export async function statusesForProject(
    directory: string,
    containers: ContainerSnapshot[],
): Promise<Record<string, ServiceStatus>> {
    const projectPath = await realpath(directory);
    const statuses: Record<string, ServiceStatus> = {};
    for (const snapshot of containers) {
        const labels = snapshot.labels;
        const workingDirectory =
            labels['com.docker.compose.project.working_dir'];
        if (
            !workingDirectory ||
            labels['com.docker.compose.oneoff']?.toLowerCase() === 'true'
        )
            continue;
        const canonical = await realpath(workingDirectory).catch(() =>
            resolve(workingDirectory),
        );
        if (canonical !== projectPath) continue;
        const name = labels['com.docker.compose.service'];
        if (name)
            statuses[name] = mergeStatus(
                statuses[name],
                containerStatus(snapshot.state),
            );
    }
    return statuses;
}
