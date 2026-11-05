import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { runCli } from '../src/cli/run.js';
import App from '../src/tui/app.js';
import { daemonFixture, eventually } from './daemon-fixture.js';
import { terminal } from './support/terminal.js';

test('CLI and App distinguish a saved next image from the observed container image and engine ID', async (t) => {
    const f = await daemonFixture(undefined, undefined, {
        mock: {
            defaultScenario: 'success',
            scenarios: [
                { name: 'success', description: 'Normal' },
                { name: 'error', description: 'Unavailable' },
            ],
        },
    });
    const client = await f.client();
    t.after(() => f.close());
    await client.command('environment.start', {});
    const container = f.stores.get(f.directory)!.containers[0];
    container.image = 'registry.example/api:observed-old';
    container.imageId = 'sha256:' + 'c'.repeat(64);
    await f.controller.poll();
    await client.command('configuration.save', {
        revision: client.getSnapshot().configurationRevision,
        edit: {
            name: 'api',
            enabled: true,
            development: false,
            exclusions: {},
            image: 'registry.example/api:saved-next',
        },
    });
    await eventually(
        () =>
            client.getSnapshot().details.api.image ===
            'registry.example/api:saved-next',
    );
    let output = '';
    assert.equal(
        await runCli(['service', 'show', 'api', '--json'], {
            connect: f.client,
            out: (text) => {
                output += text;
            },
            err: () => {},
        }),
        0,
    );
    const service = JSON.parse(output).data;
    assert.equal(service.image, 'registry.example/api:saved-next');
    assert.equal(
        service.observed[0].image,
        'registry.example/api:observed-old',
    );
    assert.equal(service.observed[0].imageId, 'sha256:' + 'c'.repeat(64));
    const view = terminal(createElement(App, { client }), {
        columns: 80,
        rows: 24,
    });
    t.after(() => view.app.unmount());
    await view.waitFor(/Observed image:/);
    assert.match(view.frame(), /registry.example\/api:observed-old/);
    assert.match(
        view.frame(),
        /Saved version: registry.example\/api:saved-next/,
    );
    await view.key('i');
    assert.ok(
        view
            .frame()
            .replace(/[\s│]/g, '')
            .includes('ImageID:sha256:' + 'c'.repeat(64)),
    );
    await view.key('\u001b');
    for (const provider of ['development', 'mock'] as const) {
        await client.command('configuration.save', {
            revision: client.getSnapshot().configurationRevision,
            edit: {
                name: 'api',
                enabled: true,
                development: provider === 'development',
                provider,
                ...(provider === 'mock' ? { mockScenario: 'error' } : {}),
                exclusions: {},
            },
        });
        await view.waitFor(
            new RegExp(
                `Saved: Yes ${provider === 'development' ? 'Development' : 'Mock'}`,
            ),
        );
        assert.match(
            view.frame(),
            /Inactive Service version: registry.example\/api:saved-next/,
        );
        assert.match(
            view.frame(),
            /Observed image: registry.example\/api:observed-old/,
        );
    }
});

test('client metadata refresh uses the real version cache without applying or replacing containers, and failure keeps the last snapshot', async (t) => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ServiceVersions } =
        await import('../src/infrastructure/service-versions.js');
    const { readEnvironmentVersions } =
        await import('../src/infrastructure/cidev-versions.js');
    const root = await mkdtemp(join(tmpdir(), 'chs-version-client-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let generation = 1;
    let incomplete = false;
    const registry = '123456789012.dkr.ecr.eu-west-2.amazonaws.com';
    const f = await daemonFixture(undefined, undefined, {
        image: `${registry}/api:project-default`,
        configure(backend) {
            const versions = new ServiceVersions(
                root,
                backend.groups,
                (source, signal) =>
                    readEnvironmentVersions(source, backend.groups, {
                        signal,
                        read: async (args) => {
                            if (args[1] === 'list-clusters')
                                return [`utility-${source}`];
                            if (args[1] === 'list-tasks') return ['api-task'];
                            return {
                                failures: [],
                                tasks: incomplete
                                    ? []
                                    : [
                                          {
                                              group: `service:${source}-api`,
                                              lastStatus: 'RUNNING',
                                              containers: [
                                                  {
                                                      name: 'api',
                                                      image: `${registry}/api:${generation}.0`,
                                                      imageDigest:
                                                          'sha256:' +
                                                          (generation === 1
                                                              ? 'a'
                                                              : 'b'
                                                          ).repeat(64),
                                                      lastStatus: 'RUNNING',
                                                  },
                                              ],
                                          },
                                      ],
                            };
                        },
                    }),
            );
            backend.versionSnapshot = (source, signal, refresh) =>
                versions.snapshot(source, signal, refresh);
            const read = backend.readConfiguration;
            backend.readConfiguration = async () => {
                const current = await read();
                return {
                    ...current,
                    details: await versions.decorate(current.details),
                };
            };
        },
    });
    t.after(() => f.close());
    const client = await f.client();
    await client.command('environment.start', {});
    const before = client.getSnapshot();
    const identity = before.configurationRevision;
    const observed = before.live.observed!.containers.map(
        (container) => container.id,
    );
    for (const source of ['cidev', 'staging', 'live'] as const) {
        const snapshot = await client.query('environment.versionSnapshot', {
            source,
            refresh: true,
        });
        assert.equal(
            snapshot.images.api,
            `${registry}/api@sha256:${'a'.repeat(64)}`,
        );
    }
    generation = 2;
    const refreshed = await client.query('environment.versionSnapshot', {
        source: 'cidev',
        refresh: true,
    });
    assert.equal(
        refreshed.images.api,
        `${registry}/api@sha256:${'b'.repeat(64)}`,
    );
    assert.equal(f.engine.applies, 1);
    assert.equal(client.getSnapshot().configurationRevision, identity);
    assert.deepEqual(
        client
            .getSnapshot()
            .live.observed!.containers.map((container) => container.id),
        observed,
    );
    incomplete = true;
    await assert.rejects(
        client.query('environment.versionSnapshot', {
            source: 'cidev',
            refresh: true,
        }),
        /tasks changed/,
    );
    const cached = await client.query('environment.versionSnapshot', {
        source: 'cidev',
    });
    assert.equal(cached.images.api, refreshed.images.api);
    assert.equal(f.engine.applies, 1);
});
