import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ComposeBackend } from '../src/infrastructure/runtimes/compose-backend.js';
import type { PreparedProject } from '../src/domain/live.js';
import type { ProcessRequest } from '../src/infrastructure/live-process.js';

async function fixture(
    t: TestContext,
    result = { code: 0, stdout: '', stderr: '' },
) {
    const state = await mkdtemp(join(tmpdir(), 'chs-compose-transition-'));
    t.after(() => rm(state, { recursive: true, force: true }));
    const requests: ProcessRequest[] = [];
    const runtime = new ComposeBackend(
        {
            directory: '/alias',
            projectName: 'test',
            realpath: async () => '/canonical',
            environment: {
                resolve: async () => ({ DOCKER_CONTEXT: 'fixture' }),
            },
            execute: async (request) => {
                requests.push(request);
                return result;
            },
        },
        state,
    );
    const project: PreparedProject = {
        protocolVersion: 1,
        projectName: 'test',
        projectDirectory: '/canonical',
        configurationIdentity: 'test',
        composeFiles: ['/canonical/compose.yaml'],
        inventory: [],
        environmentRequirements: [],
    };
    return {
        state,
        requests,
        runtime,
        project,
        marker: join(state, 'active-backend.json'),
    };
}

test('Compose applies fresh and released checkouts without writing ownership state', async (t) => {
    for (const marker of [
        undefined,
        { backend: null },
        { backend: 'docker/compose' },
    ]) {
        const f = await fixture(t);
        const raw = marker && `${JSON.stringify(marker)}\n`;
        if (raw) await writeFile(f.marker, raw);
        await f.runtime.apply(f.project, {});
        assert.deepEqual(
            f.requests.map((request) => request.args[0]),
            ['ps', 'compose', 'compose'],
        );
        assert.ok(f.requests[2].args.includes('up'));
        assert.equal(f.requests[0].env.DOCKER_CONTEXT, 'fixture');
        if (raw) assert.equal(await readFile(f.marker, 'utf8'), raw);
        else assert.deepEqual(await readdir(f.state), []);
    }
});

test('legacy ownership blocks Apply and Reload before any executable is invoked', async (t) => {
    for (const backend of ['docker/native', 'apple/native', 'unknown']) {
        const f = await fixture(t);
        const raw = JSON.stringify({ backend });
        await writeFile(f.marker, raw);
        await assert.rejects(
            f.runtime.apply(f.project, {}),
            /pre-upgrade.*Stop environment/,
        );
        await assert.rejects(
            f.runtime.reloadApplied('api', {}),
            /pre-upgrade.*Stop environment/,
        );
        assert.deepEqual(f.requests, []);
        assert.equal(await readFile(f.marker, 'utf8'), raw);
    }
});

test('unreadable or malformed ownership fails closed without modifying the marker', async (t) => {
    for (const raw of ['{', 'null', '[]', '{}', '{"backend":1}']) {
        const f = await fixture(t);
        await writeFile(f.marker, raw);
        await assert.rejects(f.runtime.apply(f.project, {}), /ownership/);
        assert.deepEqual(f.requests, []);
        assert.equal(await readFile(f.marker, 'utf8'), raw);
    }
});

test('native Docker containers, including stopped containers, block creation for this canonical checkout only', async (t) => {
    const f = await fixture(t, {
        code: 0,
        stdout: 'stopped-native-container\n',
        stderr: '',
    });
    await assert.rejects(
        f.runtime.apply(f.project, {}),
        /Native containers still exist/,
    );
    await assert.rejects(
        f.runtime.reloadApplied('api', {}),
        /Native containers still exist/,
    );
    const namespace = `chs-native-${createHash('sha256').update('/canonical').digest('hex').slice(0, 12)}`;
    for (const request of f.requests) {
        assert.deepEqual(request.args, [
            'ps',
            '--all',
            '--quiet',
            '--filter',
            `label=chs.dev.project=${namespace}`,
            '--filter',
            'label=chs.dev.backend=native',
        ]);
    }
});

test('failed inspection blocks Compose and cancellation issues no commands', async (t) => {
    const f = await fixture(t, { code: 1, stdout: '', stderr: 'unavailable' });
    await assert.rejects(
        f.runtime.apply(f.project, {}),
        /Cannot check legacy native/,
    );
    assert.equal(f.requests.length, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        f.runtime.apply(f.project, { signal: controller.signal }),
        { name: 'AbortError' },
    );
    assert.equal(f.requests.length, 1);
});
