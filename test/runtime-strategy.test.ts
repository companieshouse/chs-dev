import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerComposeStrategy } from '../src/infrastructure/runtimes/docker-compose.js';
import { requireCapability } from '../src/domain/runtime-strategy.js';

test('Compose is the only production backend and supports the retained operations', () => {
    const runtime = new DockerComposeStrategy();
    assert.equal(runtime.id, 'docker');
    assert.equal(runtime.name, 'Docker Compose');
    assert.doesNotThrow(() => requireCapability(runtime, 'inspect'));
    assert.doesNotThrow(() => requireCapability(runtime, 'registryLogin'));
    assert.doesNotThrow(() => requireCapability(runtime, 'apply'));
    assert.doesNotThrow(() => requireCapability(runtime, 'logs'));
    assert.equal(typeof runtime.live, 'function');
});

test('Docker strategy checks daemon and Compose and scopes inspection to the requested project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-runtime-test-'));
    const oldPath = process.env.PATH;
    const oldProject = process.env.TEST_RUNTIME_PROJECT;
    try {
        process.env.PATH = directory;
        process.env.TEST_RUNTIME_PROJECT = directory;
        const cli = join(directory, 'docker');
        await writeFile(
            cli,
            `#!/bin/sh
case "$1" in
context) if [ "$2" = "show" ]; then echo fixture; else echo '{"Host":"unix:///fixture/docker.sock"}'; fi ;;
info) echo 28.0 ;;
compose) echo 2.0 ;;
ps) echo container-one ;;
inspect) printf '{"labels":{"com.docker.compose.service":"api","com.docker.compose.project.working_dir":"%s"},"state":{"Status":"running","Health":{"Status":"healthy"}}}\\n' "$TEST_RUNTIME_PROJECT" ;;
*) exit 1 ;;
esac
`,
            { mode: 0o755 },
        );
        const runtime = new DockerComposeStrategy();
        assert.equal((await runtime.checkAvailability()).available, true);
        assert.deepEqual(await runtime.inspect({ directory }), {
            api: 'Healthy',
        });
        assert.deepEqual(await runtime.inspect({ directory: tmpdir() }), {});
        await writeFile(
            cli,
            '#!/bin/sh\nif [ "$1" = "info" ]; then exit 0; fi\nexit 1\n',
        );
        assert.match(
            (await runtime.checkAvailability()).message,
            /Compose is unavailable/,
        );
        await writeFile(cli, '#!/bin/sh\nexit 1\n');
        assert.equal((await runtime.checkAvailability()).available, false);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(runtime.inspect({ directory }, controller.signal));
        await assert.rejects(runtime.checkAvailability(controller.signal));
    } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        if (oldProject === undefined) delete process.env.TEST_RUNTIME_PROJECT;
        else process.env.TEST_RUNTIME_PROJECT = oldProject;
        await rm(directory, { recursive: true, force: true });
    }
});
