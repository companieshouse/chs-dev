import { spawn } from 'node:child_process';

export function openArtifacts(paths: string[]) {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    for (const path of paths) {
        const child = spawn(command, [path], {
            stdio: 'ignore',
            detached: true,
        });
        child.on('error', () => {});
        child.unref();
    }
}
