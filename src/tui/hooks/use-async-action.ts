import { useCallback, useEffect, useRef, useState } from 'react';

export interface ActionNotice {
    ok: boolean;
    message: string;
}

export function useAsyncAction<Action extends string>(
    onNotice?: (notice: ActionNotice | undefined) => void,
) {
    const [busy, setBusy] = useState<Action>();
    const [notice, setNotice] = useState<ActionNotice>();
    const pending = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const notify = useCallback(
        (value?: ActionNotice) => {
            if (!mounted.current) return;
            setNotice(value);
            onNotice?.(value);
        },
        [onNotice],
    );
    const run = useCallback(
        async (
            action: Action,
            work: () => Promise<ActionNotice>,
            progress?: ActionNotice,
        ) => {
            if (pending.current) return;
            pending.current = true;
            setBusy(action);
            notify(progress);
            try {
                const result = await work();
                notify(result);
            } catch (error) {
                notify({
                    ok: false,
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            } finally {
                pending.current = false;
                if (mounted.current) setBusy(undefined);
            }
        },
        [notify],
    );
    return { busy, notice, run };
}

export const containerActionLabel = {
    start: 'Starting',
    stop: 'Stopping',
    restart: 'Restarting',
} as const;
