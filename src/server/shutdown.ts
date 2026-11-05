/** Attempt every teardown in order, retaining initialization and cleanup failures. */
export async function shutdown(
    steps: readonly (() => Promise<void>)[],
    failure?: { error: unknown },
): Promise<void> {
    const errors: unknown[] = [];
    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            errors.push(error);
        }
    }
    if (failure && !errors.length) throw failure.error;
    if (failure)
        throw new AggregateError(
            [failure.error, ...errors],
            'Application initialization and cleanup failed',
            { cause: failure.error },
        );
    if (errors.length)
        throw new AggregateError(errors, 'Application shutdown failed');
}
