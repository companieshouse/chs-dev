import { useCallback } from 'react';
import { useClient, useSession } from '../context.js';
export function useAwsStatus(_paused = false) {
    const client = useClient(),
        session = useSession();
    const refresh = useCallback(() => {
        void client.query('aws.refresh', {}).catch(() => {});
    }, [client]);
    return {
        status: session.aws,
        refresh,
    };
}
