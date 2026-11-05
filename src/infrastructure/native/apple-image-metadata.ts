import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppleClient } from './apple-client.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';

export interface AppleImageMetadataRequest {
    client: AppleClient;
    reference: string;
    platform: string;
    digest: string;
    state: string;
    context: OperationContext;
}

export interface AppleImageMetadata {
    Volumes?: Record<string, unknown> | null;
    Healthcheck?: {
        Test?: string[];
        Interval?: number;
        Timeout?: number;
        Retries?: number;
        StartPeriod?: number;
        StartInterval?: number;
    } | null;
    Shell?: string[] | null;
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid OCI image metadata');
    return value as Record<string, unknown>;
}
function strings(value: unknown): string[] | null | undefined {
    if (value == null) return value;
    if (
        !Array.isArray(value) ||
        !value.every((entry) => typeof entry === 'string')
    )
        throw new Error('Invalid image metadata string array');
    return value;
}

function healthcheck(value: unknown): AppleImageMetadata['Healthcheck'] {
    if (value == null) return value;
    const input = object(value);
    const output: NonNullable<AppleImageMetadata['Healthcheck']> = {};
    if (input.Test !== undefined) {
        const test = strings(input.Test);
        if (!test) throw new Error('Invalid image healthcheck test');
        output.Test = test;
    }
    for (const key of [
        'Interval',
        'Timeout',
        'Retries',
        'StartPeriod',
        'StartInterval',
    ] as const) {
        const number = input[key];
        if (number === undefined) continue;
        if (typeof number !== 'number' || !Number.isFinite(number))
            throw new Error('Invalid image healthcheck metadata');
        output[key] = number;
    }
    return output;
}
export function parseImageMetadata(value: unknown): AppleImageMetadata {
    const input = object(value);
    return {
        Volumes: input.Volumes == null ? input.Volumes : object(input.Volumes),
        Healthcheck: healthcheck(input.Healthcheck),
        Shell: strings(input.Shell),
    };
}

function blob(value: unknown) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value))
        throw new Error('Invalid OCI descriptor');
    return 'blobs/sha256/' + value.slice(7);
}

function selectDescriptor(value: unknown, request: AppleImageMetadataRequest) {
    if (!Array.isArray(value)) throw new Error('Invalid OCI image index');
    const descriptors = value.map(object);
    const descriptor =
        descriptors.find((entry) => entry.digest === request.digest) ??
        descriptors.find((entry) => {
            if (!entry.platform) return false;
            const platform = object(entry.platform);
            return (
                `${platform.os}/${platform.architecture}` === request.platform
            );
        }) ??
        descriptors.find((entry) => !entry.platform);
    if (!descriptor)
        throw new Error(`No ${request.platform} metadata in image archive`);
    return descriptor;
}

async function archiveMetadata(
    request: AppleImageMetadataRequest,
    temporary: string,
) {
    const { client, reference, platform, context } = request;
    const archive = join(temporary, 'image.tar');
    context.onOutput?.({
        stream: 'stdout',
        text: `Reading image defaults: ${reference} (${platform})`,
    });
    await client.checked(
        [
            'image',
            'save',
            '--platform',
            platform,
            '--output',
            archive,
            reference,
        ],
        context,
        { timeout: 1800000 },
    );
    const member = async (path: string): Promise<Record<string, unknown>> => {
        const result = await client.dependencies.execute({
            command: '/usr/bin/tar',
            args: ['-xOf', archive, path],
            cwd: temporary,
            env: await client.dependencies.environment.resolve(
                [],
                context.signal,
            ),
            signal: context.signal,
            privateOutput: true,
            captureStderr: true,
            timeout: 60000,
        });
        if (result.code !== 0)
            throw new Error('Cannot read exported OCI image metadata');
        return object(JSON.parse(result.stdout));
    };
    let node = await member('index.json');
    for (let depth = 0; node.manifests && depth < 8; depth++)
        node = await member(
            blob(selectDescriptor(node.manifests, request).digest),
        );
    const config = node.config ? object(node.config) : undefined;
    if (!config?.digest)
        throw new Error('Image archive is missing its configuration');
    const original = await member(blob(config.digest));
    return parseImageMetadata(original.config ?? {});
}

/** OCI inspection drops Docker's Healthcheck extension; read the original config blob. */
export async function appleImageMetadata(
    request: AppleImageMetadataRequest,
): Promise<AppleImageMetadata> {
    const { digest, state } = request;
    if (!/^sha256:[a-f0-9]{64}$/.test(digest))
        throw new Error('Invalid image digest');
    const root = join(state, 'image-metadata');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const cache = join(root, digest.slice(7) + '.json');
    try {
        return parseImageMetadata(JSON.parse(await readFile(cache, 'utf8')));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = await mkdtemp(join(root, 'export-'));
    try {
        const metadata = await archiveMetadata(request, temporary);
        await writeFile(cache, JSON.stringify(metadata), { mode: 0o600 });
        return metadata;
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
