import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonFixture } from './daemon-fixture.js';

const execute = promisify(execFile);
const entrypoint = fileURLToPath(
    new URL('../src/entrypoints/chs-dev.ts', import.meta.url),
);
async function command(args: string[], env: NodeJS.ProcessEnv) {
    try {
        return {
            code: 0,
            ...(await execute(
                process.execPath,
                ['--import', 'tsx', entrypoint, ...args],
                { env },
            )),
        };
    } catch (error: any) {
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
}

test('public executable dispatches CLI reads and legacy project checks without launching the TUI', async () => {
    const f = await daemonFixture();
    try {
        const env = {
            ...process.env,
            CHS_DEV_SOCKET: join(f.root, 'api.sock'),
            CHS_DEV_PROJECT: f.directory,
        };
        const status = await command(['status', '--json'], env);
        assert.equal(status.code, 0, status.stderr);
        assert.equal(
            JSON.parse(status.stdout).data.project.directory,
            f.directory,
        );
        const legacy = await command(
            ['legacy', 'services:available', '-j'],
            env,
        );
        assert.deepEqual(JSON.parse(legacy.stdout), { services: ['api'] });
        const mismatch = await command(
            ['legacy', 'services', 'enable', 'api', '-j'],
            { ...env, CHS_DEV_PROJECT: f.second },
        );
        assert.equal(mismatch.code, 1);
        assert.equal(
            JSON.parse(mismatch.stdout).error.code,
            'PROJECT_MISMATCH',
        );
        assert.equal(f.engine.applies, 0);
    } finally {
        await f.close();
    }
});

test('public executable leaves a stopped daemon stopped, and zero arguments select the TUI', async () => {
    const f = await daemonFixture();
    try {
        const env = {
            ...process.env,
            CHS_DEV_SOCKET: join(f.root, 'absent.sock'),
            XDG_CONFIG_HOME: f.root,
            XDG_STATE_HOME: f.root,
            CHS_DEV_DAEMON_MODE: 'detached',
        };
        const status = await command(['status', '-j'], env);
        assert.equal(status.code, 0);
        assert.equal(JSON.parse(status.stdout).data.daemon.running, false);
        assert.equal((await command(['service', 'list', '-j'], env)).code, 1);
        assert.equal(
            JSON.parse((await command(['daemon', 'status', '-j'], env)).stdout)
                .data.running,
            false,
        );
        const tui = await command([], env);
        assert.equal(tui.code, 1);
        assert.match(tui.stderr, /interactive terminal/);
        assert.equal((await command(['--help'], env)).code, 0);
    } finally {
        await f.close();
    }
});
