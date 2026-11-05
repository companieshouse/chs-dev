import { useMemo, useRef } from 'react';
import { EnvironmentClient } from '../../client/environment.js';
import { useClient, useSession } from '../context.js';
export function useLive() {
    const client = useClient(),
        session = useSession();
    // Snapshots rebuild `scope` on every event; hold the latest scope for the
    // current generation so the client is not recreated without a change.
    const generation = session.scope.generation;
    const scopeCache = useRef<{
        generation: typeof generation;
        scope: typeof session.scope;
    }>(undefined);
    if (!scopeCache.current || scopeCache.current.generation !== generation)
        scopeCache.current = { generation, scope: session.scope };
    const scope = scopeCache.current!.scope;
    const apply = session.runtime.capabilities.apply;
    const valid = session.project.valid;
    const controller = useMemo(
        () =>
            valid && apply ? new EnvironmentClient(client, scope) : undefined,
        [client, valid, apply, scope],
    );
    return { controller, state: session.live };
}
