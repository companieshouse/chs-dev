import { Client } from '../client/client.js';
import { ensureDaemon, daemonPaths } from '../daemon-control/discovery.js';
import { probeDaemon } from '../daemon-control/actions.js';
import { legacyProject } from '../daemon-control/package.js';
import { ClientError } from '../protocol/types.js';
import type { Invocation } from './parse.js';

export async function connectCli(invocation: Invocation) {
    const legacy = invocation.name.startsWith('legacy ');
    const target = legacy ? await legacyProject() : undefined;
    const existing = await probeDaemon();
    if (!existing && !invocation.definition?.autostart) return undefined;
    if (!existing)
        await ensureDaemon(
            target ? { ...process.env, CHS_DEV_PROJECT: target } : process.env,
        );
    const client = await new Client(daemonPaths().socket).connect();
    if (target && client.getSnapshot().project.directory !== target) {
        client.close();
        throw new ClientError({
            code: 'PROJECT_MISMATCH',
            message: `The daemon manages ${client.getSnapshot().project.directory}; legacy commands target ${target}. Select the checkout in the TUI.`,
        });
    }
    return client;
}
