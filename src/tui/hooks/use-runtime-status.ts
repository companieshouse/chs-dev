import { useSession } from '../context.js';
import type { ServiceStatus } from '../../domain/runtime.js';
export function useRuntimeStatus() {
    const state = useSession();
    const defaultStatus: ServiceStatus =
        state.runtimeState === 'loading'
            ? 'Loading…'
            : state.runtimeState === 'error'
              ? 'Unknown'
              : 'Stopped';
    return {
        statuses: state.statuses,
        runtimeState: state.runtimeState,
        defaultStatus,
    };
}
