import { useClient, useSession } from '../context.js';
import type { ServiceEdit } from '../../domain/services.js';
export function useProject() {
    const client = useClient(),
        state = useSession();
    return {
        projectConfig: state.project,
        groups: state.groups,
        loading: !state.ready,
        error: state.project.valid ? '' : state.project.message,
        details: state.details,
        stateError: state.configurationError,
        stateLoading: !state.ready,
        save: (edit: ServiceEdit) =>
            client.command(
                'configuration.save',
                { edit, revision: state.configurationRevision },
                state.scope,
            ),
    };
}
