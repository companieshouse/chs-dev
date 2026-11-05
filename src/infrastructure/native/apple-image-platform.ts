import { LiveFailure } from '../../domain/live.js';
import type { ServiceSpec } from '../../domain/orchestration.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';

const platformErrors = [
    /does not support required platforms|no matching manifest|no match for platform in manifest/i,
    /unsupported:\s*["']?platform\s+linux\/(?:arm64|amd64)\b/i,
    /platform linux\/(?:arm64|amd64)(?:\/[\w.-]+)? for image \S+ not found/i,
];

function platformMismatch(error: unknown): error is Error {
    return (
        error instanceof Error &&
        (!(error instanceof LiveFailure) || error.kind === 'failed') &&
        platformErrors.some((pattern) => pattern.test(error.message))
    );
}

async function emulateOnAmd64(
    spec: ServiceSpec,
    operation: 'build' | 'pull',
    context: OperationContext,
    perform: (platform: string) => Promise<unknown>,
): Promise<void> {
    context.onOutput?.({
        stream: 'stdout',
        text: `${spec.name}: ${operation === 'build' ? 'a build image' : 'the image'} does not support linux/arm64; retrying ${operation} with linux/amd64 emulation.`,
    });
    context.signal?.throwIfAborted();
    try {
        await perform('linux/amd64');
    } catch (fallback) {
        context.signal?.throwIfAborted();
        if (!platformMismatch(fallback)) throw fallback;
        throw new LiveFailure(
            `${spec.name}: ${operation} failed for both linux/arm64 and linux/amd64. ${operation === 'build' ? 'Check that the Dockerfile base images support a common platform.' : 'Choose an image supporting one of these platforms.'} ${fallback.message}`,
            'blocked',
        );
    }
    context.signal?.throwIfAborted();
    spec.platform = 'linux/amd64';
}

/** Prefer native images, with one emulated retry when no platform was requested. */
export async function prepareAppleImagePlatform(
    spec: ServiceSpec,
    operation: 'build' | 'pull',
    context: OperationContext,
    perform: (platform: string) => Promise<unknown>,
): Promise<void> {
    const requested = spec.platform;
    const platform = requested ?? 'linux/arm64';
    context.signal?.throwIfAborted();
    try {
        await perform(platform);
    } catch (error) {
        context.signal?.throwIfAborted();
        if (!platformMismatch(error)) throw error;
        if (requested)
            throw new LiveFailure(
                `${spec.name}: cannot ${operation} for the configured platform ${requested}. ${operation === 'build' ? 'A Dockerfile base image' : 'The image'} does not support it. Check platform in ${spec.source} and choose a supported architecture. ${error.message}`,
                'blocked',
            );
        await emulateOnAmd64(spec, operation, context, perform);
    }
}
