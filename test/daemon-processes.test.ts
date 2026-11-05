import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eventually } from './daemon-fixture.js';

for (const terminal of [false, true]) {
    test(
        `a killed daemon terminates its ${terminal ? 'terminal' : 'background'} command group`,
        { timeout: 15000 },
        async () => {
            const directory = await mkdtemp(join(tmpdir(), 'chs-guard-test-'));
            const marker = join(directory, 'children');
            const guard = new URL(
                '../src/infrastructure/process-guard.ts',
                import.meta.url,
            ).href;
            const executor = new URL(
                `../src/infrastructure/${terminal ? 'terminal-process' : 'live-process'}.ts`,
                import.meta.url,
            ).href;
            const request = {
                command: '/bin/sh',
                args: [
                    '-c',
                    'echo $$ > "$1"; sleep 60 & echo $! >> "$1"; wait',
                    'fixture',
                    marker,
                ],
                cwd: directory,
                env: { PATH: process.env.PATH },
                environment: { PATH: process.env.PATH },
                label: 'Fixture',
                missingMessage: 'Missing shell',
            };
            const script = `import { startProcessGuard } from ${JSON.stringify(guard)};
            import * as executor from ${JSON.stringify(executor)};
            await startProcessGuard();
            const request = ${JSON.stringify(request)};
            ${terminal ? 'await (await executor.createTerminal(request, () => {})).result;' : 'await executor.createProcessExecutor()(request);'}`;
            const owner = spawn(
                process.execPath,
                ['--import', 'tsx', '--input-type=module', '-e', script],
                { stdio: ['ignore', 'ignore', 'pipe'] },
            );
            let errors = '';
            owner.stderr.on('data', (chunk) => {
                errors += chunk;
            });
            const exited = once(owner, 'exit');
            let pids: number[] = [];
            try {
                for (
                    let attempt = 0;
                    attempt < 100 && pids.length < 2;
                    attempt++
                ) {
                    pids = (await readFile(marker, 'utf8').catch(() => ''))
                        .trim()
                        .split('\n')
                        .map(Number)
                        .filter(Boolean);
                    if (owner.exitCode !== null)
                        assert.fail(
                            errors ||
                                'Owner exited before spawning the command',
                        );
                    if (pids.length < 2)
                        await new Promise((resolve) => {
                            setTimeout(resolve, 30);
                        });
                }
                assert.equal(pids.length, 2, errors);
                owner.kill('SIGKILL');
                await exited;
                await eventually(
                    () =>
                        pids.every((pid) => {
                            try {
                                process.kill(pid, 0);
                                return false;
                            } catch {
                                return true;
                            }
                        }),
                    6000,
                );
            } finally {
                if (owner.exitCode === null && owner.signalCode === null) {
                    owner.kill('SIGKILL');
                    await exited;
                }
                await rm(directory, { recursive: true, force: true });
            }
        },
    );
}
