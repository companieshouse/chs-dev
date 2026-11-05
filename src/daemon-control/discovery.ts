import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { stateDirectory, settingsPath } from '../infrastructure/settings.js';
import { requestJson } from '../client/connection.js';
import { daemonEnvironment } from './environment.js';
import { protocolVersion, type SessionSnapshot } from '../protocol/types.js';

export function daemonPaths() {
    const state = join(stateDirectory(), 'daemon');
    const identity = createHash('sha256')
        .update(`${settingsPath()}\0${stateDirectory()}`)
        .digest('hex')
        .slice(0, 12);
    const directory = join(
        '/tmp',
        `chs-dev-${process.getuid?.() ?? 'user'}-${identity}`,
    );
    const socket = process.env.CHS_DEV_SOCKET
        ? resolve(process.env.CHS_DEV_SOCKET)
        : join(directory, 'daemon.sock');
    return { state, socket, identity };
}
export function daemonProgram() {
    const source = import.meta.url.endsWith('.ts');
    const entry = fileURLToPath(
        new URL(
            `../entrypoints/server.${source ? 'ts' : 'js'}`,
            import.meta.url,
        ),
    );
    const root = fileURLToPath(new URL('../../', import.meta.url));
    return {
        command: process.execPath,
        args: [
            ...(source
                ? [
                      '--import',
                      fileURLToPath(
                          new URL(
                              '../../node_modules/tsx/dist/loader.mjs',
                              import.meta.url,
                          ),
                      ),
                  ]
                : []),
            entry,
        ],
        cwd: root,
    };
}
export async function ensureDaemon(
    startupEnvironment: NodeJS.ProcessEnv = process.env,
) {
    const paths = daemonPaths();
    const probe = () =>
        requestJson<SessionSnapshot>(
            paths.socket,
            '/v1/session',
            'GET',
            undefined,
            AbortSignal.timeout(1500),
        );
    const existing = await probe().catch(() => undefined);
    if (existing) {
        if (existing.protocol !== protocolVersion)
            throw new Error(
                'The daemon protocol differs from this frontend. Restart the daemon after current work finishes.',
            );
        return paths;
    }
    await mkdir(paths.state, { recursive: true, mode: 0o700 });
    if (
        process.platform === 'darwin' &&
        process.env.CHS_DEV_DAEMON_MODE !== 'detached'
    ) {
        const { ensureLaunchAgent } = await import('./macos/launch-agent.js');
        await ensureLaunchAgent(false, startupEnvironment);
    } else {
        const program = daemonProgram();
        const child = spawn(program.command, program.args, {
            cwd: program.cwd,
            env: {
                ...startupEnvironment,
                ...daemonEnvironment(startupEnvironment),
            },
            detached: true,
            stdio: 'ignore',
        });
        child.on('error', () => {});
        child.unref();
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const snapshot = await probe().catch(() => undefined);
        if (snapshot) {
            if (snapshot.protocol !== protocolVersion)
                throw new Error(
                    'The daemon protocol differs from this frontend. Restart the daemon.',
                );
            return paths;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 150);
        });
    }
    const detail = await readFile(
        join(paths.state, 'startup-error.txt'),
        'utf8',
    ).catch(() => undefined);
    throw new Error(
        detail ??
            'The daemon did not become ready. Run npm run server to inspect its startup error.',
    );
}

export async function waitUntilDaemonStops() {
    const { socket } = daemonPaths();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const running = await requestJson(
            socket,
            '/v1/session',
            'GET',
            undefined,
            AbortSignal.timeout(1500),
        ).then(
            () => true,
            () => false,
        );
        if (!running) return;
        await new Promise((resolve) => {
            setTimeout(resolve, 100);
        });
    }
    throw new Error(
        'The daemon is still shutting down. Wait for its commands to finish before restarting.',
    );
}
