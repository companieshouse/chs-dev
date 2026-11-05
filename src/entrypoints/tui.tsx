import { render } from 'ink';
import App from '../tui/app.js';
import { Client } from '../client/client.js';
import { environmentMismatch } from '../daemon-control/environment.js';
import { ensureDaemon } from '../daemon-control/discovery.js';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Run chs-dev in an interactive terminal.');
    process.exitCode = 1;
} else {
    let client: Client | undefined;
    try {
        const paths = await ensureDaemon();
        client = await new Client(paths.socket).connect();
        const mismatch = environmentMismatch(client.getSnapshot());
        if (mismatch) client.notice(mismatch);
        const application = render(<App client={client} />, {
            alternateScreen: true,
        });
        const terminate = () => application.unmount();
        process.once('SIGTERM', terminate);
        try {
            await application.waitUntilExit();
        } finally {
            process.off('SIGTERM', terminate);
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    } finally {
        client?.close();
    }
}
