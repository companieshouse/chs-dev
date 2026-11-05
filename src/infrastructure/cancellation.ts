/** Cancellation must retain the error produced by the interrupted operation. */
export function rethrowIfAborted(
    signal: AbortSignal | undefined,
    error: unknown,
): void {
    if (signal?.aborted) throw error;
}
