import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let endpoint: string | undefined;

/** A live connection binds command lifetime to this daemon, including SIGKILL. */
export async function startProcessGuard() {
    if (endpoint) throw new Error('Command supervision is already active.');
    const directory = await mkdtemp(
        `/tmp/chs-commands-${process.getuid?.() ?? 'user'}-`,
    );
    const socket = join(directory, 'owner.sock');
    const clients = new Set<Socket>();
    const server = createServer((client) => {
        clients.add(client);
        client.on('error', () => {});
        client.on('close', () => clients.delete(client));
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
    });
    endpoint = socket;
    return async () => {
        endpoint = undefined;
        for (const client of clients) client.destroy();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        await rm(directory, { recursive: true, force: true });
    };
}

export function guardedCommand(command: string, args: string[]) {
    if (!endpoint) return { command, args };
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const guardian = fileURLToPath(
        new URL(`./process-guardian.${extension}`, import.meta.url),
    );
    return {
        command: process.execPath,
        args: [guardian, endpoint, command, ...args],
    };
}
