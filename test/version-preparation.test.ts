import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { prepareProject } from '../src/project/prepare.js';
import { nodeProjectFs } from '../src/project/files.js';
import { readServices } from '../src/project/catalog.js';
import { ServiceVersions } from '../src/infrastructure/service-versions.js';
import { readEnvironmentVersions } from '../src/infrastructure/cidev-versions.js';
import type { AwsEnvironment } from '../src/domain/version-sources.js';

const registry = '123456789012.dkr.ecr.eu-west-2.amazonaws.com';

test('real preparation uses selected ECS digests and pins while Development and Mock keep their implementations', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-version-preparation-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'checkout');
    const module = join(project, 'services/modules/example');
    await mkdir(module, { recursive: true });
    await mkdir(join(project, 'services/infrastructure'), { recursive: true });
    await writeFile(
        join(module, 'services.docker-compose.yaml'),
        stringify({
            services: {
                api: { image: `${registry}/api:project-default` },
                worker: {
                    image: `${registry}/worker:project-default`,
                    labels: { 'chs.local.builder': 'repository' },
                },
                'company-profile-api': {
                    image: `${registry}/company-profile-api:project-default`,
                },
            },
        }),
    );
    const groups = await readServices({
        directory: project,
        valid: true,
        message: 'Fixture checkout',
    });
    const reads: AwsEnvironment[] = [];
    const versions = new ServiceVersions(
        join(root, 'versions'),
        groups,
        async (source, signal) => {
            reads.push(source);
            return readEnvironmentVersions(source, groups, {
                signal,
                read: async (args) => {
                    if (args[1] === 'list-clusters')
                        return [
                            'utility-cidev',
                            'utility-staging',
                            'utility-live',
                        ];
                    assert.equal(
                        args[args.indexOf('--cluster') + 1],
                        `utility-${source}`,
                    );
                    if (args[1] === 'list-tasks') return ['api-task'];
                    return {
                        failures: [],
                        tasks: [
                            {
                                group: `service:${source}-api`,
                                lastStatus: 'RUNNING',
                                containers: [
                                    {
                                        name: 'api',
                                        image: `${registry}/api:${source}-tag`,
                                        imageDigest:
                                            'sha256:' +
                                            {
                                                cidev: 'a',
                                                staging: 'b',
                                                live: 'c',
                                            }[source].repeat(64),
                                        lastStatus: 'RUNNING',
                                    },
                                ],
                            },
                        ],
                    };
                },
            });
        },
    );
    const dependencies = {
        fs: nodeProjectFs,
        env: {},
        environment: { enforce: async () => {} },
        prepareRepository: async ({ directory }: { directory: string }) => {
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'Dockerfile'), 'FROM scratch\n');
            return directory;
        },
        serviceImages: versions.images.bind(versions),
    };
    for (const source of ['cidev', 'staging', 'live'] as const) {
        const prepared = await prepareProject(
            {
                projectDirectory: project,
                outputDirectory: join(root, source),
                configuration: stringify({
                    services: ['api', 'worker', 'company-profile-api'],
                    versionSource: source,
                    serviceProviders: {
                        worker: 'development',
                        'company-profile-api': 'mock',
                    },
                    serviceImages: {
                        worker: `${registry}/worker:dormant-pin`,
                        'company-profile-api': `${registry}/company-profile-api:dormant-pin`,
                    },
                }),
            },
            dependencies,
        );
        const services = parse(
            await readFile(prepared.composeFiles[0], 'utf8'),
        ).services;
        assert.equal(
            services.api.image,
            `${registry}/api@sha256:${{ cidev: 'a', staging: 'b', live: 'c' }[source].repeat(64)}`,
        );
        assert.equal(
            services.worker.image,
            `${registry}/worker:project-default`,
        );
        assert.equal(services.worker.pull_policy, 'build');
        assert.equal(
            services['company-profile-api'].image,
            'node:22.20.0-alpine',
        );
        assert.ok(services['chs-dev-microcks']);
    }
    assert.deepEqual(reads, ['cidev', 'staging', 'live']);
    const pinned = await prepareProject(
        {
            projectDirectory: project,
            outputDirectory: join(root, 'pinned'),
            configuration: stringify({
                services: ['api'],
                versionSource: 'live',
                serviceImages: { api: `${registry}/api:explicit-pin` },
            }),
        },
        dependencies,
    );
    assert.equal(
        parse(await readFile(pinned.composeFiles[0], 'utf8')).services.api
            .image,
        `${registry}/api:explicit-pin`,
    );
    assert.deepEqual(reads, ['cidev', 'staging', 'live']);
});

test('version refresh stays inactive during Reload and activates on explicit Apply without saving YAML', async (t) => {
    const { LiveController } =
        await import('../src/application/live-controller.js');
    const { ProjectPreparation } =
        await import('../src/project/preparation.js');
    const { configurationStore, liveFiles } =
        await import('../src/infrastructure/live-files.js');
    const { projectIdentity } = await import('../src/project/prepare.js');
    const root = await mkdtemp(join(tmpdir(), 'chs-version-apply-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'checkout');
    const module = join(project, 'services/modules/example');
    await mkdir(module, { recursive: true });
    await mkdir(join(project, 'services/infrastructure'), { recursive: true });
    await writeFile(
        join(module, 'api.docker-compose.yaml'),
        stringify({
            services: {
                api: { image: `${registry}/api:project-default` },
                worker: {
                    image: `${registry}/worker:project-default`,
                    labels: { 'chs.local.builder': 'repository' },
                },
            },
        }),
    );
    await mkdir(join(project, 'repositories/worker'), { recursive: true });
    await writeFile(
        join(project, 'repositories/worker/Dockerfile'),
        'FROM scratch\n',
    );
    const yaml =
        'services: [api, worker]\nserviceProviders: {worker: development}\nversionSource: cidev\n';
    await writeFile(join(project, '.chs-dev.yaml'), yaml);
    const groups = await readServices({
        directory: project,
        valid: true,
        message: 'Fixture checkout',
    });
    const identity = await projectIdentity(project, {
        fs: nodeProjectFs,
        env: {},
    });
    let generation = 'a';
    const versions = new ServiceVersions(
        join(root, 'versions'),
        groups,
        (source, signal) =>
            readEnvironmentVersions(source, groups, {
                signal,
                read: async (args) => {
                    if (args[1] === 'list-clusters') return ['utility-cidev'];
                    if (args[1] === 'list-tasks') return ['api-task'];
                    return {
                        failures: [],
                        tasks: [
                            {
                                group: 'service:cidev-api',
                                lastStatus: 'RUNNING',
                                containers: [
                                    {
                                        name: 'api',
                                        image: `${registry}/api:${generation}`,
                                        imageDigest:
                                            'sha256:' + generation.repeat(64),
                                        lastStatus: 'RUNNING',
                                    },
                                ],
                            },
                        ],
                    };
                },
            }),
    );
    const preparation = new ProjectPreparation({
        directory: project,
        stateDirectory: join(root, 'state'),
        files: liveFiles,
        execute: async () => {
            throw new Error(
                'No process execution needed for Service provider fixture',
            );
        },
        environment: { resolve: async () => ({}) },
        serviceImages: () => versions.images.bind(versions),
    });
    let containers: import('../src/domain/live.js').RuntimeContainer[] = [];
    const success = async () => ({
        outcome: 'success' as const,
        message: 'Done',
        affectedServices: ['api'],
    });
    let applied: import('../src/domain/live.js').PreparedProject | undefined;
    const activate = async (
        prepared: import('../src/domain/live.js').PreparedProject,
    ) => {
        const services = parse(
            await readFile(prepared.composeFiles[0], 'utf8'),
        ).services;
        containers = Object.entries(services).map(
            ([service, spec]: [string, any]) => ({
                ...identity,
                id: service,
                service,
                mode: spec.labels['chs.dev.mode'],
                lifecycle: 'running',
                image: spec.image,
            }),
        );
    };
    const controller = new LiveController({
        preparation,
        configuration: configurationStore(project, groups, liveFiles),
        verifyAws: async () => ({ state: 'active' }),
        lock: { acquire: async () => async () => {} },
        clock: { now: () => new Date() },
        runtime: {
            checkAvailability: async () => ({
                available: true,
                message: 'Fixture engine',
            }),
            snapshot: async () => ({ ...identity, containers }),
            apply: async (prepared) => {
                applied = prepared;
                await activate(prepared);
                return success();
            },
            reloadApplied: async () => {
                assert.ok(applied);
                await activate(applied);
                return success();
            },
            stop: success,
            stopProject: success,
            containerAction: success,
            reload: success,
            logs: async () => [],
        },
    });
    t.after(() => controller.shutdown());
    await controller.start();
    await controller.waitUntilIdle();
    assert.equal(
        controller.getSnapshot().phase,
        'Running',
        controller.getSnapshot().message,
    );
    assert.equal(
        controller.getSnapshot().observed!.containers[0].image,
        `${registry}/api@sha256:${'a'.repeat(64)}`,
    );
    generation = 'b';
    await versions.snapshot('cidev', undefined, true);
    assert.equal(
        controller.getSnapshot().observed!.containers[0].image,
        `${registry}/api@sha256:${'a'.repeat(64)}`,
    );
    const reloaded = await controller.reloadService('worker');
    assert.equal(reloaded.ok, true, reloaded.message);
    await controller.waitUntilIdle();
    assert.equal(
        controller
            .getSnapshot()
            .observed!.containers.find(
                (container) => container.service === 'api',
            )!.image,
        `${registry}/api@sha256:${'a'.repeat(64)}`,
    );
    await controller.apply();
    assert.equal(
        controller.getSnapshot().observed!.containers[0].image,
        `${registry}/api@sha256:${'b'.repeat(64)}`,
    );
    assert.equal(await readFile(join(project, '.chs-dev.yaml'), 'utf8'), yaml);
});
