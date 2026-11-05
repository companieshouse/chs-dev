import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppleRuntimeAdapter } from '../src/infrastructure/native/apple-adapter.js';
import { LiveFailure } from '../src/domain/live.js';
import type {
    ResolvedProject,
    ServiceSpec,
} from '../src/domain/orchestration.js';
import type {
    ProcessRequest,
    ProcessResult,
} from '../src/infrastructure/live-process.js';

const mismatch =
    'Error: unsupported: "image sha256:3241b2658cb83a6ec245bdb16a4710460e7a5bec490653a09bdefa43a67a2b9f does not support required platforms"';
const digest = 'sha256:' + 'a'.repeat(64);

async function fixture(
    t: any,
    options: {
        build?: boolean;
        platform?: string;
        fail?: (platform: string) => string | undefined;
        cached?: boolean;
        onPrepare?: () => void;
    } = {},
) {
    const directory = await mkdtemp(join(tmpdir(), 'chs-apple-platform-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const spec: ServiceSpec = {
        name: 'app',
        source: 'fixture.yaml',
        owner: 'app',
        mode: 'Development',
        kind: 'service',
        image: 'fixture/app:dev',
        platform: options.platform,
        pullPolicy: options.build === false ? 'always' : 'build',
        build:
            options.build === false
                ? undefined
                : {
                      context: directory,
                      dockerfile: 'Node.Dockerfile',
                      args: { LANGUAGE_MAJOR_VERSION: '24' },
                      target: 'development',
                  },
        environment: {},
        labels: {},
        mounts: [],
        ports: [],
        expose: [],
        networks: { chs: { aliases: ['app'] } },
        aliases: ['app'],
        dns: [],
        dnsSearch: [],
        extraHosts: [],
        restart: 'no',
        stopSeconds: 1,
        dependencies: {},
    };
    const project: ResolvedProject = {
        identity: 'fixture',
        directory,
        namespace: 'fixture',
        services: { app: spec },
        networks: { chs: {} },
        volumes: {},
    };
    const calls: ProcessRequest[] = [];
    const events: string[] = [];
    let architecture = options.cached ? 'amd64' : undefined;
    const adapter = new AppleRuntimeAdapter({
        directory,
        projectName: 'fixture',
        stateDirectory: directory,
        environment: { resolve: async () => ({ FIXTURE: 'yes' }) },
        execute: async (request): Promise<ProcessResult> => {
            calls.push(request);
            if (request.args[0] === 'build' || request.args[1] === 'pull') {
                options.onPrepare?.();
                const platform =
                    request.args[request.args.indexOf('--platform') + 1];
                const stderr = options.fail
                    ? options.fail(platform)
                    : platform === 'linux/arm64'
                      ? mismatch
                      : undefined;
                if (stderr) return { code: 1, stdout: '', stderr };
                architecture = platform.split('/')[1];
                return { code: 0, stdout: '', stderr: '' };
            }
            assert.equal(request.args[1], 'inspect');
            return architecture
                ? {
                      code: 0,
                      stderr: '',
                      stdout: JSON.stringify([
                          {
                              configuration: {
                                  name: spec.image,
                                  descriptor: { digest },
                              },
                              variants: [
                                  {
                                      digest,
                                      platform: { os: 'linux', architecture },
                                      config: {
                                          config: {
                                              Entrypoint: ['/bin/sh'],
                                              Cmd: ['-c', 'true'],
                                          },
                                      },
                                  },
                              ],
                          },
                      ]),
                  }
                : { code: 1, stdout: '', stderr: 'Image not found' };
        },
    });
    await mkdir(join(adapter.state, 'image-metadata'), { recursive: true });
    await writeFile(
        join(adapter.state, 'image-metadata', digest.slice(7) + '.json'),
        '{}',
    );
    const prepare = (signal?: AbortSignal, reload: string[] = []) =>
        adapter.images.prepare(project, reload, {
            signal,
            onOutput: (event) => events.push(event.text),
        });
    const preparations = () =>
        calls.filter((c) => c.args[0] === 'build' || c.args[1] === 'pull');
    return { spec, calls, events, prepare, preparations };
}

test('Apple builds retry AMD64-only base images and retain build inputs and runtime platform', async (t) => {
    const f = await fixture(t);
    await f.prepare();
    const builds = f.preparations();
    assert.equal(builds.length, 2);
    assert.deepEqual(
        builds.map((c) => c.args[c.args.indexOf('--platform') + 1]),
        ['linux/arm64', 'linux/amd64'],
    );
    assert.deepEqual(
        builds[0].args.map((a) => (a === 'linux/arm64' ? 'linux/amd64' : a)),
        builds[1].args,
    );
    assert.ok(builds[1].args.includes('LANGUAGE_MAJOR_VERSION=24'));
    assert.equal(
        builds[1].args[builds[1].args.indexOf('--target') + 1],
        'development',
    );
    assert.deepEqual(builds[0].env, builds[1].env);
    assert.equal(f.spec.platform, 'linux/amd64');
    assert.equal(f.spec.imageId, digest);
    assert.deepEqual(f.spec.entrypoint, ['/bin/sh']);
    assert.match(
        f.events.join('\n'),
        /app:.*retrying build with linux\/amd64 emulation/,
    );
});

test('native builds use ARM64 without a second attempt', async (t) => {
    const f = await fixture(t, { fail: () => undefined });
    await f.prepare();
    assert.equal(f.preparations().length, 1);
    assert.equal(f.spec.platform, 'linux/arm64');
});

test('cached AMD64-only bases also recover from Apple unsupported-platform diagnostics', async (t) => {
    for (const message of [
        'Error: unsupported: "platform linux/arm64"',
        'no matching manifest for linux/arm64/v8',
        'no match for platform in manifest',
        'Error: platform linux/arm64 for image docker.io/amd64/alpine:3.22 not found',
    ]) {
        const f = await fixture(t, {
            fail: (platform) =>
                platform === 'linux/arm64' ? message : undefined,
        });
        await f.prepare();
        assert.equal(f.preparations().length, 2);
        assert.equal(f.spec.platform, 'linux/amd64');
    }
});

test('pulls use the same bounded platform fallback as builds', async (t) => {
    const f = await fixture(t, { build: false });
    await f.prepare();
    assert.equal(f.preparations().length, 2);
    assert.equal(f.spec.platform, 'linux/amd64');
    assert.match(f.events.join('\n'), /retrying pull/);
});

test('explicit platforms are honored and mismatches identify the service and definition', async (t) => {
    for (const platform of ['linux/arm64', 'linux/amd64']) {
        const f = await fixture(t, { platform, fail: () => mismatch });
        await assert.rejects(f.prepare(), (error) => {
            assert.ok(error instanceof LiveFailure);
            assert.equal(error.kind, 'blocked');
            assert.ok(
                error.message.includes(`configured platform ${platform}`),
            );
            assert.match(error.message, /app:.*fixture.yaml/);
            return true;
        });
        assert.equal(f.preparations().length, 1);
        assert.equal(f.spec.platform, platform);
    }
});

test('auth, Dockerfile and build command failures do not trigger an architecture retry', async (t) => {
    for (const message of [
        '401 Unauthorized',
        'Dockerfile parse error on line 4',
        'process did not complete successfully: exit code: 1',
    ]) {
        const f = await fixture(t, { fail: () => message });
        await assert.rejects(f.prepare(), (error) => {
            assert.ok(error instanceof LiveFailure);
            assert.equal(
                error.kind,
                message.includes('401') ? 'ecr' : 'failed',
            );
            return true;
        });
        assert.equal(f.preparations().length, 1);
    }
});

test('no compatible platform stops after two attempts with an actionable error', async (t) => {
    const f = await fixture(t, { fail: () => mismatch });
    await assert.rejects(
        f.prepare(),
        /app: build failed for both linux\/arm64 and linux\/amd64/,
    );
    assert.equal(f.preparations().length, 2);
    assert.equal(f.spec.platform, undefined);
});

test('authentication failure during the emulated retry still requests registry login', async (t) => {
    const f = await fixture(t, {
        fail: (platform) =>
            platform === 'linux/arm64' ? mismatch : '401 Unauthorized',
    });
    await assert.rejects(f.prepare(), (error) => {
        assert.ok(error instanceof LiveFailure);
        assert.equal(error.kind, 'ecr');
        return true;
    });
    assert.equal(f.preparations().length, 2);
    assert.equal(f.spec.platform, undefined);
});

test('cancellation does not start an emulated build', async (t) => {
    const abort = new AbortController();
    const f = await fixture(t, { onPrepare: () => abort.abort() });
    await assert.rejects(f.prepare(abort.signal), { name: 'AbortError' });
    assert.equal(f.preparations().length, 1);
});

test('cached development images are reused until reload and reload retains emulation', async (t) => {
    const f = await fixture(t, { cached: true });
    f.spec.pullPolicy = 'missing';
    await f.prepare();
    assert.equal(f.preparations().length, 0);
    assert.equal(f.spec.platform, 'linux/amd64');
    await f.prepare(undefined, ['app']);
    assert.equal(f.preparations().length, 1);
    assert.equal(
        f.preparations()[0].args[
            f.preparations()[0].args.indexOf('--platform') + 1
        ],
        'linux/amd64',
    );
});
