import type { useApp } from 'ink';

type TerminalControl = Pick<
    ReturnType<typeof useApp>,
    'suspendTerminal' | 'waitUntilRenderFlush'
>;

/** Suspends Ink so an interactive child process owns the terminal. */
export async function handOverTerminal(
    { suspendTerminal, waitUntilRenderFlush }: TerminalControl,
    work: () => Promise<void>,
): Promise<void> {
    // Finish modal changes and their input effects before Ink releases stdin.
    // Otherwise a pending useInput effect can reclaim it during authentication.
    await waitUntilRenderFlush();
    await suspendTerminal(async () => {
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        // Ink detaches its readable listener; transition out of readable mode
        // before pausing so Node also stops the underlying TTY read.
        process.stdin.resume();
        process.stdin.pause();
        try {
            await work();
        } finally {
            process.stdin.resume();
        }
    });
}
