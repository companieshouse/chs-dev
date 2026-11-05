import { useEffect } from 'react';

/** Serial polling; the caller owns error reporting and abort-aware state updates. */
export function usePollingEffect(
    enabled: boolean,
    refresh: (signal: AbortSignal) => Promise<void>,
    interval = 5000,
    revision = 0,
) {
    useEffect(() => {
        if (!enabled) return;
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
            if (!abort.signal.aborted) timer = setTimeout(poll, interval);
        };
        const poll = () => refresh(abort.signal).finally(schedule);
        void poll();
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [enabled, refresh, interval, revision]);
}
