import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeDockerRuntime } from '../src/infrastructure/native/runtime.js';
import { translate, namespace } from '../src/infrastructure/native/compiler.js';
import {
    DockerError,
    type DockerApi,
} from '../src/infrastructure/native/docker.js';
import { ComposeBackend } from '../src/infrastructure/runtimes/compose-backend.js';
import { LiveFailure, type PreparedProject } from '../src/domain/live.js';

class Engine implements DockerApi {
    containers = new Map<string, any>();
    resources = new Map<string, any>();
    commands: string[] = [];
    count = 0;
    loseCreateResponse = false;
    failJob = false;
    failure?: { request: string; error: Error };
    async call(method: string, path: string, body?: any): Promise<any> {
        const request = `${method} ${path.split('?')[0]}`;
        this.commands.push(request);
        if (this.failure?.request === request) throw this.failure.error;
        if (path.startsWith('/images/'))
            return { Id: 'sha256:image', Config: {} };
        if (path.startsWith('/containers/json'))
            return [...this.containers.values()].map((c) => ({
                Id: c.Id,
                Labels: c.Config.Labels,
            }));
        if (path.startsWith('/containers/create')) {
            const id = `container-${++this.count}`;
            this.containers.set(id, {
                Id: id,
                Name: new URL('http://docker' + path).searchParams.get('name'),
                Config: body,
                State: { Status: 'created', Running: false, ExitCode: 0 },
                Mounts: [],
            });
            if (this.loseCreateResponse) {
                this.loseCreateResponse = false;
                throw new Error('connection lost after create');
            }
            return { Id: id };
        }
        const container = /^\/containers\/([^/?]+)(?:\/([^?]+))?/.exec(path);
        if (container) {
            const [, id, action] = container;
            const c =
                this.containers.get(id) ??
                [...this.containers.values()].find((c) => c.Name === id);
            if (!c) throw new DockerError(404, 'missing');
            if (method === 'DELETE') {
                this.containers.delete(id);
                return;
            }
            if (action === 'json') return structuredClone(c);
            if (action === 'start' || action === 'restart') {
                const job = c.Config.Labels['chs.dev.kind'] === 'job';
                c.State = {
                    Status: job ? 'exited' : 'running',
                    Running: !job,
                    ExitCode: job && this.failJob ? 7 : 0,
                };
                if (c.Config.Healthcheck)
                    c.State.Health = { Status: 'healthy' };
                return;
            }
            if (action === 'stop') {
                c.State.Running = false;
                c.State.Status = 'exited';
                return;
            }
        }
        const resource = /^\/(networks|volumes)\/([^?]+)/.exec(path);
        if (resource) {
            const [, kind, name] = resource;
            if (method === 'POST') {
                this.resources.set(`${kind}/${body.Name}`, { ...body });
                return { Id: body.Name };
            }
            const r = this.resources.get(`${kind}/${name}`);
            if (!r) throw new DockerError(404, 'missing');
            return r;
        }
        throw new Error(`Unexpected request ${method} ${path}`);
    }
    async logs() {
        return ['output'];
    }
}
async function fixture(t: any, document: any) {
    const directory = await mkdtemp(join(tmpdir(), 'chs-native-recovery-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const project: PreparedProject = {
        protocolVersion: 1,
        projectName: 'test',
        projectDirectory: directory,
        configurationIdentity: 'one',
        composeFiles: [join(directory, 'compose.yaml')],
        inventory: [],
        environmentRequirements: [],
    };
    const engine = new Engine();
    const runtime = new NativeDockerRuntime({
        directory,
        projectName: 'test',
        stateDirectory: join(directory, 'state'),
        api: engine,
        execute: async () => ({ code: 0, stdout: '[]', stderr: '' }),
        environment: {
            resolve: async () => ({ DOCKER_HOST: 'unix:///fake.sock' }),
        },
        compiler: { compile: async () => translate(document, project) },
        policy: { pollMs: 1, readinessMs: 50, jobMs: 50, progressMs: 5 },
    });
    return { engine, runtime, project };
}
const single = () => ({
    services: { app: { image: 'alpine', pull_policy: 'never' } },
});

test('retry discovers a container created before its response was received', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    engine.loseCreateResponse = true;
    await assert.rejects(runtime.apply(project, {}), /connection lost/);
    assert.equal(engine.count, 1);
    await runtime.apply(project, {});
    assert.equal(engine.count, 1);
    assert.equal((await runtime.snapshot()).containers[0].lifecycle, 'running');
});
test('foreign containers and volumes are never adopted or removed', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    await runtime.apply(project, {});
    const container = (await runtime.snapshot()).containers[0];
    engine.containers.get(container.id).Config.Labels['chs.dev.directory'] =
        '/other';
    await assert.rejects(runtime.logs(container, { tail: 10 }), /ownership/);
    await runtime.stopProject({});
    assert.equal(engine.containers.size, 1);
});
test('a failed job prevents dependent services from starting, then explicit retry recovers', async (t) => {
    const { engine, runtime, project } = await fixture(t, {
        services: {
            seed: { image: 'alpine', pull_policy: 'never' },
            app: {
                image: 'alpine',
                pull_policy: 'never',
                depends_on: {
                    seed: { condition: 'service_completed_successfully' },
                },
            },
        },
    });
    engine.failJob = true;
    await assert.rejects(runtime.apply(project, {}), /job exited 7/);
    assert.equal(engine.count, 1);
    engine.failJob = false;
    await runtime.apply(project, {});
    assert.equal(engine.count, 2);
    assert.equal(
        (await runtime.snapshot()).containers.find((c) => c.service === 'app')
            ?.lifecycle,
        'running',
    );
});
test('a long-running service exiting zero is not treated as a completed job', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    await runtime.apply(project, {});
    const c = [...engine.containers.values()][0];
    c.State = { Status: 'exited', Running: false, ExitCode: 0 };
    await runtime.apply(project, {});
    assert.equal(engine.count, 1);
    assert.equal(c.State.Status, 'running');
});
test('removal guard returns a revised plan before deleting newly discovered services', async (t) => {
    const doc = single();
    const { engine, runtime, project } = await fixture(t, doc);
    await runtime.apply(project, {});
    doc.services = {} as any;
    runtime.allowedRemovals = [];
    await assert.rejects(
        runtime.apply(project, {}),
        /Review the revised stop plan/,
    );
    assert.equal(engine.containers.size, 1);
});
test('Compose refuses a checkout with native containers before invoking compose up', async () => {
    const commands: string[][] = [];
    const backend = new ComposeBackend({
        directory: '/project',
        projectName: 'test',
        realpath: async (p) => p,
        environment: { resolve: async () => ({}) },
        execute: async (request) => {
            commands.push(request.args);
            return { code: 0, stdout: 'native-container\n', stderr: '' };
        },
    });
    await assert.rejects(
        backend.apply({ projectDirectory: '/project' } as any, {}),
        /Native containers still exist/,
    );
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], 'ps');
});

test('container create failures report service, definition, daemon reason and useful guidance', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    project.sources = { app: '/services/app.yaml' };
    const detail =
        'invalid IP address in add-host: "account.chs.local=host-gateway"';
    const cause = new DockerError(
        400,
        'Docker POST /containers/create failed',
        detail,
    );
    engine.failure = { request: 'POST /containers/create', error: cause };
    await assert.rejects(runtime.apply(project, {}), (error: unknown) => {
        assert.ok(error instanceof LiveFailure);
        assert.equal(error.kind, 'failed');
        assert.equal(error.cause, cause);
        assert.equal(
            error.message,
            [
                'Could not create container for app.',
                `Docker: ${detail} (HTTP 400)`,
                'Definition: /services/app.yaml',
                'Check extra_hosts: each hostname must map to an IP address or host-gateway.',
            ].join('\n'),
        );
        return true;
    });
    assert.equal(engine.containers.size, 0);
});
test('start errors identify the service and explain a host-port conflict', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    engine.failure = {
        request: 'POST /containers/container-1/start',
        error: new DockerError(
            500,
            'Docker start failed',
            'Bind for 0.0.0.0:8080 failed: port is already allocated',
        ),
    };
    await assert.rejects(runtime.apply(project, {}), (error: unknown) => {
        assert.ok(error instanceof LiveFailure);
        assert.match(error.message, /^Could not start container for app\./);
        assert.match(error.message, /port is already allocated/);
        assert.match(
            error.message,
            /Free that port or change the service port mapping/,
        );
        return true;
    });
    engine.failure = undefined;
    await runtime.apply(project, {});
    assert.equal(engine.count, 1);
    assert.equal((await runtime.snapshot()).containers[0].lifecycle, 'running');
});
test('container errors preserve blocked failures and cancellation', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    const blocked = new LiveFailure(
        'Engine ownership changed.',
        'blocked',
        'mismatch',
    );
    engine.failure = { request: 'POST /containers/create', error: blocked };
    await assert.rejects(runtime.apply(project, {}), (error: unknown) => {
        assert.ok(error instanceof LiveFailure);
        assert.equal(error.kind, 'blocked');
        assert.equal(error.reason, 'mismatch');
        return true;
    });
    const abort = new AbortController();
    const original = engine.call.bind(engine);
    engine.call = async (method, path, body) => {
        if (path.startsWith('/containers/create')) {
            abort.abort();
            throw abort.signal.reason;
        }
        return original(method, path, body);
    };
    await assert.rejects(
        runtime.apply(project, { signal: abort.signal }),
        (error: unknown) => error === abort.signal.reason,
    );
});

test('native containers use exact service names and a separate Desktop group', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    await runtime.apply(project, {});
    const current = [...engine.containers.values()][0];
    assert.equal(current.Name, 'app');
    const labels = current.Config.Labels;
    assert.equal(labels['com.docker.compose.service'], 'app');
    assert.equal(
        labels['com.docker.compose.project'],
        `test-native-${namespace(project.projectDirectory).slice(-12)}`,
    );
    assert.notEqual(labels['com.docker.compose.project'], project.projectName);
    assert.equal(labels['com.docker.compose.config-hash'], undefined);
    await runtime.apply(project, {});
    assert.equal(engine.count, 1);
});
test('Apply migrates old container names and grouping once, preserving volume mappings', async (t) => {
    const { engine, runtime, project } = await fixture(t, {
        services: {
            app: {
                image: 'alpine',
                pull_policy: 'never',
                volumes: [{ type: 'volume', target: '/data' }],
            },
        },
    });
    await runtime.apply(project, {});
    const old = [...engine.containers.values()][0];
    old.Name = `${namespace(project.projectDirectory)}-app-1`;
    delete old.Config.Labels['com.docker.compose.project'];
    delete old.Config.Labels['com.docker.compose.service'];
    old.Mounts = [{ Type: 'volume', Name: 'saved-data', Destination: '/data' }];
    engine.resources.set('volumes/saved-data', { Name: 'saved-data' });
    await runtime.apply(project, {});
    assert.equal(engine.containers.size, 1);
    const current = [...engine.containers.values()][0];
    assert.notEqual(current.Id, old.Id);
    assert.equal(current.Name, 'app');
    assert.ok(current.Config.Labels['com.docker.compose.project']);
    assert.equal(engine.resources.has('volumes/saved-data'), true);
    assert.equal(current.Config.HostConfig.Mounts[0].Source, 'saved-data');
    await runtime.apply(project, {});
    assert.equal(engine.count, 2);
});
test('a service-name collision blocks Apply before changing either environment', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    const foreign = {
        Id: 'foreign',
        Name: 'app',
        Config: { Labels: {} },
        State: { Status: 'running' },
    };
    engine.containers.set(foreign.Id, foreign);
    await assert.rejects(
        runtime.apply(project, {}),
        /Container name "app" is already in use.*Stop the owning environment/,
    );
    assert.equal(engine.containers.get(foreign.Id), foreign);
    assert.equal(engine.count, 0);
    assert.ok(engine.commands.every((command) => command.startsWith('GET ')));
});

test('native stop reports progress and removes dependents before dependencies', async (t) => {
    const { engine, runtime, project } = await fixture(t, {
        services: {
            db: { image: 'alpine', pull_policy: 'never' },
            app: {
                image: 'alpine',
                pull_policy: 'never',
                depends_on: { db: { condition: 'service_started' } },
            },
        },
    });
    await runtime.apply(project, {});
    const original = engine.call.bind(engine);
    engine.call = async (method, path, body) => {
        if (method === 'POST' && path.includes('/stop?'))
            await new Promise((resolve) => {
                setTimeout(resolve, 25);
            });
        return original(method, path, body);
    };
    const output: string[] = [];
    await runtime.stopProject({ onOutput: ({ text }) => output.push(text) });
    assert.ok(output[0].startsWith('Inspecting native containers'));
    assert.ok(
        output.some((line) => line.includes('Stopping 2 native containers')),
    );
    assert.ok(
        output.some((line) =>
            /Stopping: app \[1\/2\] \(grace period 10s\)/.test(line),
        ),
    );
    assert.ok(
        output.some((line) =>
            line.includes('elapsed; still waiting for Docker'),
        ),
    );
    assert.ok(
        output.indexOf('Removed: app [1/2]; volumes kept.') <
            output.findIndex((line) => line.startsWith('Stopping: db')),
    );
    assert.ok(output.includes('Removed: db [2/2]; volumes kept.'));
    assert.equal(engine.containers.size, 0);
    assert.ok(output.every((line) => !line.startsWith('Wait:')));
    const length = output.length;
    await new Promise((resolve) => {
        setTimeout(resolve, 20);
    });
    assert.equal(output.length, length);
});
test('native stop cancels without removing the waiting container or leaving progress timers', async (t) => {
    const { engine, runtime, project } = await fixture(t, single());
    await runtime.apply(project, {});
    const original = engine.call.bind(engine);
    engine.call = async (method, path, body, signal?: AbortSignal) => {
        if (method === 'POST' && path.includes('/stop?')) {
            await new Promise((_, reject) => {
                signal!.addEventListener(
                    'abort',
                    () => reject(signal!.reason),
                    { once: true },
                );
            });
        }
        return original(method, path, body);
    };
    const abort = new AbortController();
    const output: string[] = [];
    await assert.rejects(
        runtime.stopProject({
            signal: abort.signal,
            onOutput: ({ text }) => {
                output.push(text);
                if (text.startsWith('Stopping:') && text.includes('elapsed'))
                    abort.abort();
            },
        }),
        (error: unknown) => error === abort.signal.reason,
    );
    assert.equal(engine.containers.size, 1);
    assert.ok(output.every((line) => !line.startsWith('Removed:')));
    const length = output.length;
    await new Promise((resolve) => {
        setTimeout(resolve, 20);
    });
    assert.equal(output.length, length);
});
