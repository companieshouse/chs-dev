import type { Client } from './client.js';
import type {
    ContainerManager,
    ContainerSummary,
} from '../domain/containers.js';
import type { ContainerAction } from '../domain/live.js';
import type { Scope } from '../protocol/types.js';

export class EnvironmentClient {
    constructor(
        private readonly client: Client,
        private readonly scope: Scope,
    ) {}
    private async action(
        kind:
            | 'environment.start'
            | 'environment.apply'
            | 'environment.stop'
            | 'environment.cancel'
            | 'environment.dismiss',
    ) {
        try {
            await this.client.command(kind, {}, this.scope);
        } catch (error) {
            this.client.notice(
                error instanceof Error ? error.message : String(error),
            );
        }
    }
    start = () => this.action('environment.start');
    apply = () => this.action('environment.apply');
    stop = () => this.action('environment.stop');
    cancel = () => this.action('environment.cancel');
    dismissPlan = () => this.action('environment.dismiss');
    confirmStart = async () => {
        const state = this.client.getSnapshot();
        try {
            await this.client.command(
                'environment.confirm',
                {
                    plan: JSON.stringify({
                        plan: state.live.plan,
                        revision: state.configurationRevision,
                    }),
                },
                this.scope,
            );
        } catch (error) {
            this.client.notice(
                error instanceof Error ? error.message : String(error),
            );
        }
    };
    poll = () =>
        this.client.query('refresh', {}, undefined, this.scope).catch(() => {});
    serviceAction = (services: readonly string[], action: ContainerAction) =>
        this.client.command(
            'service.action',
            { services: [...services], action },
            this.scope,
        );
    reloadService = (service: string) =>
        this.client.command('service.reload', { service }, this.scope);
    serviceLogs = (service: string, tail = 200, signal?: AbortSignal) =>
        this.client.query(
            'services.logs',
            { service, tail },
            signal,
            this.scope,
        );
    setupSsh = (input: {
        keyPath: string;
        passphrase: string;
        replace: boolean;
    }) => this.client.command('ssh.setup', input, this.scope);
    manageContainer = (
        _manager: ContainerManager,
        container: ContainerSummary,
        action: ContainerAction,
    ) =>
        this.client.command(
            'container.action',
            { container, action },
            this.scope,
        );
}
export function containerClient(
    client: Client,
    scope: Scope,
): ContainerManager {
    return {
        list: (signal) => client.query('containers.list', {}, signal, scope),
        inspect: (id, signal) =>
            client.query('containers.inspect', { id }, signal, scope),
        logs: (id, tail, signal) =>
            client.query('containers.logs', { id, tail }, signal, scope),
        action: async (action, container) => {
            const result = await client.command(
                'container.action',
                { container, action },
                scope,
            );
            return {
                outcome: result.ok ? 'success' : 'failed',
                message: result.message,
            };
        },
    };
}
