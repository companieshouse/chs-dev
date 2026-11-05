import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import App from '../src/tui/app.js';
import { daemonFixture, eventually } from '../test/daemon-fixture.js';
import { terminal } from '../test/support/terminal.js';

function parseSize(value: string | undefined) {
    const match = /^(\d+)x(\d+)$/.exec(value ?? '120x34');
    if (!match) throw new Error('Use a terminal size such as 80x24.');
    const columns = Number(match[1]);
    const rows = Number(match[2]);
    if (columns < 20 || rows < 8)
        throw new Error('Preview terminals must be at least 20x8.');
    return { columns, rows };
}

async function main() {
    const size = parseSize(process.argv[2]);
    const fixture = await daemonFixture();
    try {
        const client = await fixture.client();
        const view = terminal(createElement(App, { client }), size);
        try {
            await eventually(() => view.frame().includes('Services'));
            const frames: Array<{ name: string; content: string }> = [
                { name: 'services', content: view.frame() },
            ];
            for (const name of [
                'containers',
                'modules',
                'enabled',
                'logs',
                'config',
            ]) {
                await view.key('\u001b[C');
                await delay(50);
                frames.push({ name, content: view.frame() });
            }
            await view.key('?');
            frames.push({ name: 'help', content: view.frame() });
            await view.key('\u001b');
            await view.key('\u0005');
            frames.push({ name: 'environment', content: view.frame() });
            for (const frame of frames) {
                process.stdout.write(
                    `\n--- ${frame.name} (${size.columns}x${size.rows}) ---\n${frame.content}\n`,
                );
            }
        } finally {
            view.app.unmount();
            client.close();
        }
    } finally {
        await fixture.close();
    }
}

await main();
