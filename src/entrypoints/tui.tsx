import { render } from 'ink';
import App from '../tui/app.js';
import { Client } from '../client/client.js';
import { environmentMismatch } from '../daemon-control/environment.js';
import { ensureDaemon } from '../daemon-control/discovery.js';

function printExitHandoff(terminated: boolean) {
    if (terminated) return;
    process.stdout.write(
        '\nchs-dev: TUI closed; the daemon continues monitoring. Run `chs-dev status` to check it.\n',
    );
}

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
        let terminated = false;
        const terminate = () => {
            terminated = true;
            application.unmount();
        };
        process.once('SIGTERM', terminate);
        try {
            await application.waitUntilExit();
            printExitHandoff(terminated);
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
