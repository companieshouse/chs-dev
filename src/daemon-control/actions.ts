import { requestJson } from '../client/connection.js';
import {
    ClientError,
    operationFinished,
    type SessionSnapshot,
} from '../protocol/types.js';
import {
    daemonPaths,
    ensureDaemon,
    waitUntilDaemonStops,
} from './discovery.js';

export async function probeDaemon() {
    try {
        return await requestJson<SessionSnapshot>(
            daemonPaths().socket,
            '/v1/session',
            'GET',
            undefined,
            AbortSignal.timeout(1500),
        );
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ECONNREFUSED') return undefined;
        throw error;
    }
}

async function install() {
    if (
        process.platform !== 'darwin' ||
        process.env.CHS_DEV_DAEMON_MODE === 'detached'
    ) {
        await ensureDaemon();
        return {
            message: 'Daemon started. Environment startup remains explicit.',
        };
    }
    const status = await probeDaemon();
    if (
        status?.live.busy ||
        status?.operations.some((operation) => !operationFinished(operation))
    )
        throw new ClientError({
            code: 'BUSY',
            message:
                'Wait for current work to finish before updating the login service.',
        });
    const { stopLaunchAgent, ensureLaunchAgent } =
        await import('./macos/launch-agent.js');
    await stopLaunchAgent();
    await waitUntilDaemonStops();
    await ensureLaunchAgent(true);
    await ensureDaemon();
    return {
        message:
            'Login service installed using this package and startup environment.',
    };
}

async function stop(action: string) {
    if (
        process.platform === 'darwin' &&
        process.env.CHS_DEV_DAEMON_MODE !== 'detached'
    ) {
        const { stopLaunchAgent } = await import('./macos/launch-agent.js');
        await stopLaunchAgent(action === 'uninstall');
    } else if (await probeDaemon()) {
        await requestJson(daemonPaths().socket, '/v1/shutdown', 'POST', {});
    }
    await waitUntilDaemonStops();
    if (action === 'restart') await ensureDaemon();
    return {
        message:
            action === 'restart'
                ? 'Daemon restarted.'
                : 'Daemon stopped. Container data is unchanged.',
    };
}

async function status() {
    const status = await probeDaemon();
    return {
        running: !!status,
        daemonId: status?.daemonId,
        project: status?.project.directory,
        runtime: status?.runtime.name,
        environment: status?.live.phase,
        operations:
            status?.operations.filter(
                (operation) => !operationFinished(operation),
            ) ?? [],
    };
}
export async function daemonAction(action: string) {
    if (action === 'status') return status();
    if (action === 'install') return install();
    if (action === 'start') {
        await ensureDaemon();
        return {
            message: 'Daemon started. Environment startup remains explicit.',
        };
    }
    if (['stop', 'restart', 'uninstall'].includes(action)) return stop(action);
    throw new ClientError({
        code: 'INVALID_USAGE',
        message: 'Use status, start, install, stop, restart or uninstall.',
    });
}
