import { usePollingEffect } from './use-polling-effect.js';
import { useCallback, useEffect, useState } from 'react';
import type {
    ContainerManager,
    ContainerSummary,
} from '../../domain/containers.js';

export function useContainers(
    manager: ContainerManager | undefined,
    active: boolean,
) {
    const [containers, setContainers] = useState<ContainerSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        setContainers([]);
        setError('');
    }, [manager]);
    const poll = useCallback(
        async (signal: AbortSignal) => {
            if (!manager) return;
            setLoading(true);
            try {
                const next = await manager.list(signal);
                if (signal.aborted) return;
                setContainers(next);
                setError('');
            } catch (error) {
                if (!signal.aborted)
                    setError(
                        error instanceof Error ? error.message : String(error),
                    );
            } finally {
                if (!signal.aborted) setLoading(false);
            }
        },
        [manager],
    );
    usePollingEffect(!!manager && active, poll, 5000, revision);
    return {
        containers,
        loading: !!manager && loading,
        error,
        refresh: () => setRevision((n) => n + 1),
    };
}
