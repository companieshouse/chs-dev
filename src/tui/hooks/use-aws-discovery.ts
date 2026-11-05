import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfileDiscovery } from '../../domain/aws-profiles.js';
import { useClient } from '../context.js';

interface DiscoveryState {
    key: string;
    discovery?: ProfileDiscovery;
    error?: string;
}

/**
 * Discovers AWS profiles and project registries on demand. Results are cached
 * until the project or primary profile changes, or `refresh` is called.
 */
export function useAwsDiscovery(
    projectDirectory: string | undefined,
    primary: string,
    wanted: boolean,
) {
    const client = useClient();
    const key = `${projectDirectory ?? ''}\0${primary}`;
    const [state, setState] = useState<DiscoveryState>();
    const pending = useRef<{
        key: string;
        promise: Promise<ProfileDiscovery | undefined>;
    }>(undefined);
    const ensure = useCallback(() => {
        if (pending.current?.key === key) return pending.current.promise;
        const promise = client.query('aws.discovery', {}).then(
            (discovery) => {
                if (pending.current?.key === key) setState({ key, discovery });
                return discovery;
            },
            (error: unknown) => {
                if (pending.current?.key === key)
                    setState({
                        key,
                        error: `AWS profile detection failed: ${error instanceof Error ? error.message : String(error)}`,
                    });
                return undefined;
            },
        );
        pending.current = { key, promise };
        return promise;
    }, [client, key]);
    const refresh = useCallback(() => {
        pending.current = undefined;
        setState(undefined);
        return ensure();
    }, [ensure]);
    useEffect(() => {
        if (wanted) void ensure();
    }, [wanted, ensure]);
    const current = state?.key === key ? state : undefined;
    return {
        discovery: current?.discovery,
        error: current?.error,
        ensure,
        refresh,
    };
}
