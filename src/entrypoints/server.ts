import { shutdown as closeResources } from '../server/shutdown.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { daemonPaths } from '../daemon-control/discovery.js';
import { safeLog } from '../domain/live-logs.js';

const paths = daemonPaths();
try {
    const { exclusiveLease } =
        await import('../infrastructure/daemon-state.js');
    const release = await exclusiveLease(join(paths.state, 'daemon.lock'));
    const { createApplication } = await import('../server/bootstrap.js');
    const { listenApi } = await import('../server/api.js');
    const application = await createApplication().catch(async (error) => {
        await release();
        throw error;
    });
    let closing: Promise<void> | undefined;
    const releaseLease = async () => {
        try {
            await release();
        } finally {
            process.off('SIGTERM', terminate);
            process.off('SIGINT', terminate);
        }
    };
    const shutdown = (): Promise<void> =>
        (closing ??= closeResources([
            () => application.close(),
            () => api.close(),
            releaseLease,
        ]));
    const terminate = () => {
        void shutdown().catch((error) => {
            console.error(safeLog(String(error)));
            process.exitCode = 1;
        });
    };
    const api = await listenApi(
        paths.socket,
        application.application,
        application.operations,
        process.env.CHS_DEV_DAEMON_MODE === 'detached' ? shutdown : undefined,
    ).catch(async (error) => {
        await application.close();
        await release();
        throw error;
    });
    await rm(join(paths.state, 'startup-error.txt'), { force: true });
    process.once('SIGTERM', terminate);
    process.once('SIGINT', terminate);
    console.log(`chs-dev daemon listening on ${paths.socket}`);
} catch (error) {
    const message = safeLog(
        error instanceof Error ? error.message : String(error),
    );
    await mkdir(paths.state, { recursive: true, mode: 0o700 });
    await writeFile(join(paths.state, 'startup-error.txt'), message, {
        mode: 0o600,
    });
    console.error(message);
    process.exitCode = 1;
}
