import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    matchEnvironmentImages,
    type CidevVersionOptions,
    type RunningServiceImage,
} from '../domain/aws-versions.js';
import type { ServiceGroup } from '../domain/services.js';
import { isProfileName } from '../domain/settings.js';
import {
    versionProfiles,
    versionSourceLabels,
    type AwsEnvironment,
} from '../domain/version-sources.js';

const exec = promisify(execFile);
export type AwsRead = (
    args: string[],
    query: string,
    signal?: AbortSignal,
) => Promise<any>;

export function cidevReader(options: CidevVersionOptions): AwsRead {
    return environmentReader('cidev', options);
}

export function environmentReader(
    environment: AwsEnvironment,
    options: CidevVersionOptions,
): AwsRead {
    const profile = options.profile ?? versionProfiles[environment];
    const label = versionSourceLabels[environment];
    const region = options.region ?? 'eu-west-2';
    if (!isProfileName(profile) || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region))
        throw new Error('Choose a valid AWS profile and region.');
    return async (args, query, signal) => {
        try {
            const { stdout } = await exec(
                'aws',
                [
                    ...args,
                    '--profile',
                    profile,
                    '--region',
                    region,
                    '--output',
                    'json',
                    '--query',
                    query,
                    '--cli-connect-timeout',
                    '5',
                    '--cli-read-timeout',
                    '15',
                    '--no-cli-pager',
                ],
                {
                    signal,
                    timeout: 30_000,
                    maxBuffer: 8 * 1024 * 1024,
                    env: {
                        ...process.env,
                        AWS_PAGER: '',
                        AWS_CLI_AUTO_PROMPT: 'off',
                        AWS_MAX_ATTEMPTS: '1',
                    },
                },
            );
            return JSON.parse(stdout);
        } catch (error) {
            signal?.throwIfAborted();
            const reason = error as { code?: string; stderr?: string };
            if (reason.code === 'ENOENT')
                throw new Error(
                    `Install the AWS CLI to read ${label} versions.`,
                );
            throw new Error(
                `${label} read failed for AWS profile ${profile}. Check login and ECS read permissions. ${reason.stderr?.trim().slice(0, 400) ?? ''}`,
            );
        }
    };
}

interface Task {
    group: string;
    lastStatus: string;
    architecture?: string;
    containers: {
        name: string;
        image: string;
        imageDigest?: string;
        lastStatus: string;
    }[];
}

async function readCluster(
    cluster: string,
    read: AwsRead,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    const arns: string[] = await read(
        [
            'ecs',
            'list-tasks',
            '--cluster',
            cluster,
            '--desired-status',
            'RUNNING',
        ],
        'taskArns',
        signal,
    );
    const images: RunningServiceImage[] = [];
    let runningTasks = 0;
    for (let offset = 0; offset < arns.length; offset += 100) {
        const batch = arns.slice(offset, offset + 100);
        const result = await read(
            [
                'ecs',
                'describe-tasks',
                '--cluster',
                cluster,
                '--tasks',
                ...batch,
            ],
            '{tasks:tasks[].{group:group,lastStatus:lastStatus,architecture:attributes[?name==`ecs.cpu-architecture`].value|[0],containers:containers[].{name:name,image:image,imageDigest:imageDigest,lastStatus:lastStatus}},failures:failures}',
            signal,
        );
        if (result.failures?.length || result.tasks?.length !== batch.length)
            throw new Error(
                `ECS tasks changed while reading ${cluster}. Retry the snapshot.`,
            );
        const tasks: Task[] = result.tasks ?? [];
        for (const task of tasks.filter(
            (task) => task.lastStatus === 'RUNNING',
        )) {
            runningTasks++;
            images.push(...taskImages(cluster, task));
        }
    }
    return { images, runningTasks };
}

function taskImages(cluster: string, task: Task): RunningServiceImage[] {
    return task.containers
        .filter((container) => container.lastStatus === 'RUNNING')
        .map((container) => ({
            cluster: cluster.split('/').at(-1)!,
            ecsService: task.group.replace(/^service:/, ''),
            container: container.name,
            image: container.image,
            digest: container.imageDigest,
            architecture: task.architecture,
        }));
}

export async function readCidevVersions(
    options: CidevVersionOptions,
    groups: ServiceGroup[],
    signal?: AbortSignal,
    read: AwsRead = cidevReader(options),
) {
    return readEnvironmentVersions('cidev', groups, { options, signal, read });
}

export async function readEnvironmentVersions(
    environment: AwsEnvironment,
    groups: ServiceGroup[],
    request: {
        options?: CidevVersionOptions;
        signal?: AbortSignal;
        read?: AwsRead;
    } = {},
) {
    const { signal } = request;
    signal?.throwIfAborted();
    const read =
        request.read ?? environmentReader(environment, request.options ?? {});
    const all: string[] = await read(
        ['ecs', 'list-clusters'],
        'clusterArns',
        signal,
    );
    const clusters = all.filter((arn) =>
        new RegExp(`(?:^|-)${environment}(?:-|$)`).test(arn.split('/').at(-1)!),
    );
    if (!clusters.length)
        throw new Error(
            `No ${versionSourceLabels[environment]} ECS clusters were found for this AWS profile and region.`,
        );
    const results = await readClusters(clusters, read, signal);
    const matched = matchEnvironmentImages(
        groups,
        results.flatMap((result) => result.images),
        environment,
    );
    if (!matched.matches.length)
        throw new Error(
            `No ${versionSourceLabels[environment]} running service images matched this checkout. Check the AWS profile and cluster names.`,
        );
    return {
        ...matched,
        clusters: clusters.length,
        runningTasks: results.reduce(
            (total, result) => total + result.runningTasks,
            0,
        ),
    };
}

async function readClusters(
    clusters: string[],
    read: AwsRead,
    signal?: AbortSignal,
) {
    const results: Awaited<ReturnType<typeof readCluster>>[] = [];
    let next = 0;
    const worker = async () => {
        while (next < clusters.length) {
            signal?.throwIfAborted();
            results.push(await readCluster(clusters[next++], read, signal));
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(4, clusters.length) }, worker),
    );
    return results;
}
