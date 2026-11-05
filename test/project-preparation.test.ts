import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import type { ProjectFs } from '../src/project/files.js';
import { standardAwsExportLines } from '../src/project/initialization.js';
import {
    cloneRepository,
    prepareProject,
    projectIdentity,
    resolveProject,
    type ProjectDependencies,
} from '../src/project/prepare.js';
import { dependencyClosure, readState } from '../src/project/resolve.js';
import { ProjectPreparation } from '../src/project/preparation.js';
import { projectStateDirectory } from '../src/infrastructure/settings.js';
import { LiveFailure } from '../src/domain/live.js';
import { LiveEnvironment } from '../src/infrastructure/live-environment.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const standardInit =
    '#!/usr/bin/env bash\nSCRIPT_DIR=$(cd "$(dirname -- "$0")" && pwd)\nCUSTOM_SCRPTS_DIR=\'custom-init-scripts\'\n"${SCRIPT_DIR}/${CUSTOM_SCRPTS_DIR}/set_aws_session_vars.sh" > aws-session.env\n';

test('image pins reach generated services without changing project source definitions', async () => {
    const image = 'registry.example/app@sha256:' + 'a'.repeat(64);
    const f = fixture({ services: ['app'], serviceImages: { app: image } });
    const prepared = await prepareProject(f.request, f.dependencies);
    assert.equal(
        parse(f.files.get(prepared.composeFiles[0]!)!).services.app.image,
        image,
    );
    assert.equal(
        parse(
            f.files.get(
                '/project/services/modules/example/app.docker-compose.yaml',
            )!,
        ).services.app.image,
        'app:${TAG:-latest}',
    );
});

test('automatic environment images reach artifacts while retaining the source configuration identity', async () => {
    const f = fixture({ services: ['app'], versionSource: 'cidev' });
    const image = 'registry.example/app@sha256:' + 'b'.repeat(64);
    const prepared = await prepareProject(f.request, {
        ...f.dependencies,
        serviceImages: async (inventory, selections) => {
            assert.equal(selections.versionSource, 'cidev');
            assert.ok(
                inventory.some(
                    (item) => item.service === 'app' && item.mode === 'Service',
                ),
            );
            return { app: image };
        },
    });
    assert.equal(
        parse(f.files.get(prepared.composeFiles[0]!)!).services.app.image,
        image,
    );
    assert.equal(prepared.configurationIdentity, sha(f.request.configuration));
});

function fixture(state: unknown = { services: ['app'] }) {
    const files = new Map<string, string>();
    const directories = new Set([
        '/project',
        '/state',
        '/project/services',
        '/project/services/modules',
        '/project/services/modules/example',
        '/project/services/infrastructure',
    ]);
    const addDirectory = (path: string) => {
        for (let current = path; current !== '/'; current = dirname(current))
            directories.add(current);
    };
    const put = (path: string, value: unknown) => {
        files.set(path, typeof value === 'string' ? value : stringify(value));
        addDirectory(dirname(path));
    };
    put('/project/services/infrastructure/docker-compose.yaml', {
        services: {
            'ingress-proxy': {
                image: 'proxy',
                volumes: ['/var/run/docker.sock:/var/run/docker.sock'],
            },
        },
        networks: { chs: {} },
        secrets: { key: { file: './local/key' } },
    });
    put('/project/services/modules/example/app.docker-compose.yaml', {
        services: {
            app: {
                image: 'app:${TAG:-latest}',
                labels: [
                    'chs.local.builder=node',
                    'chs.repository.url=git@github.com:example/app.git',
                    'traefik.http.routers.app.rule=Host(`app`)',
                ],
                depends_on: { database: { condition: 'service_healthy' } },
                env_file: 'app.env',
            },
        },
    });
    put('/project/services/modules/example/database.docker-compose.yaml', {
        services: {
            database: { image: 'db', healthcheck: { test: ['CMD', 'true'] } },
        },
    });
    const missing = () =>
        Object.assign(new Error('missing'), { code: 'ENOENT' });
    const fs: ProjectFs = {
        realpath: async (path) => path,
        readFile: async (path) => {
            if (!files.has(path)) throw missing();
            return files.get(path)!;
        },
        writeFile: async (path, value, options) => {
            assert.equal(options.flag, 'wx');
            assert.equal(options.mode, 0o600);
            assert.ok(path.startsWith('/state/'), path);
            if (files.has(path))
                throw Object.assign(new Error('exists'), { code: 'EEXIST' });
            files.set(path, value);
        },
        mkdir: async (path, options) => {
            if (directories.has(path) && !options.recursive)
                throw Object.assign(new Error('exists'), { code: 'EEXIST' });
            directories.add(path);
        },
        readdir: async (path) => {
            if (!directories.has(path)) throw missing();
            return [...directories, ...files.keys()]
                .filter((entry) => dirname(entry) === path && entry !== path)
                .map((entry) => ({
                    name: entry.slice(path.length + 1),
                    isDirectory: () => directories.has(entry),
                    isFile: () => files.has(entry),
                }));
        },
        access: async (path) => {
            if (!files.has(path) && !directories.has(path)) throw missing();
        },
        stat: async (path) => {
            if (!directories.has(path)) throw missing();
            return { isDirectory: () => true };
        },
    };
    const calls: [string, unknown][] = [];
    const dependencies: ProjectDependencies = {
        fs,
        env: {},
        progress: () => {},
        prepareRepository: async (request) => {
            calls.push(['repository', request]);
            return request.directory;
        },
        environment: {
            enforce: async (names) => {
                calls.push(['environment', names]);
            },
        },
        validate: async () => {},
    };
    const configuration = stringify(state);
    const request = {
        projectDirectory: '/project',
        configuration,
        outputDirectory: '/state/one',
    };
    return {
        files,
        directories,
        addDirectory,
        put,
        fs,
        dependencies,
        request,
        calls,
    };
}

test('mock preparation replaces the service, omits its dependencies and preserves routing without AWS or builders', async () => {
    const f = fixture({
        services: ['company-profile-api'],
        serviceProviders: { 'company-profile-api': 'mock' },
        mockScenarios: { 'company-profile-api': 'error' },
    });
    f.put(
        '/project/services/modules/example/company-profile-api.docker-compose.yaml',
        {
            services: {
                'company-profile-api': {
                    image: 'private-registry/real-api',
                    depends_on: ['database'],
                    labels: [
                        'traefik.http.routers.profile.rule=Host(`api.chs.local`)',
                        'traefik.http.services.profile.loadbalancer.server.port=8080',
                        'chs.local.builder=node',
                    ],
                    environment: {
                        AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID:?login}',
                    },
                    networks: ['chs'],
                    ports: ['40001:40001'],
                },
            },
        },
    );
    const prepared = await prepareProject(f.request, f.dependencies);
    const document = parse(f.files.get(prepared.composeFiles[0])!);
    assert.deepEqual(Object.keys(document.services).sort(), [
        'chs-dev-microcks',
        'company-profile-api',
    ]);
    const mock = document.services['company-profile-api'];
    assert.equal(
        mock.labels['traefik.http.routers.profile.rule'],
        'Host(`api.chs.local`)',
    );
    assert.equal(
        JSON.parse(
            f.files.get('/state/one/mock-config/company-profile-api.json')!,
        ).scenario,
        'error',
    );
    assert.equal(mock.environment.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(mock.labels['chs.dev.mode'], 'Mock');
    assert.deepEqual(Object.keys(mock.depends_on), ['chs-dev-microcks']);
    assert.deepEqual(
        JSON.parse(mock.labels['chs.dev.lifecycle']).dependencies,
        ['chs-dev-microcks'],
    );
    assert.deepEqual(prepared.environmentRequirements, []);
    assert.deepEqual(prepared.sshRequirements, []);
    assert.equal(
        f.calls.some(([type]) => type === 'repository'),
        false,
    );
    assert.equal(document.services['ingress-proxy'], undefined);
    assert.equal(
        document.services['chs-dev-microcks'].labels['traefik.enable'],
        'false',
    );
    assert.deepEqual(
        (await resolveProject(f.request, f.dependencies)).inventory,
        prepared.inventory,
    );
});

test('the Felix mock needs no validation dependencies, private credentials, debug port or builder', async () => {
    const f = fixture({
        services: ['felixvalidator'],
        serviceProviders: { felixvalidator: 'mock' },
        mockScenarios: { felixvalidator: 'validation-failed' },
    });
    f.put(
        '/project/services/modules/example/felixvalidator.docker-compose.yaml',
        {
            services: {
                felixvalidator: {
                    image: 'private-registry/felixvalidator',
                    depends_on: [
                        'eric',
                        'authentication-service',
                        'execute-mongo-scripts',
                    ],
                    labels: {
                        'chs.local.builder': 'java',
                        'chs.local.builder.requiresSecrets': 'true',
                        'traefik.http.routers.felixvalidator.rule':
                            'Host(`api.chs.local`) && PathPrefix(`/validate`)',
                        'traefik.http.services.felixvalidator.loadbalancer.server.port':
                            '8080',
                    },
                    environment: {
                        REQUIRED_REAL_TOKEN: '${REQUIRED_REAL_TOKEN:?required}',
                    },
                    ports: ['50191:50191'],
                },
            },
        },
    );
    const prepared = await prepareProject(f.request, f.dependencies);
    assert.deepEqual(prepared.inventory.map((item) => item.service).sort(), [
        'chs-dev-microcks',
        'felixvalidator',
    ]);
    const mock = parse(f.files.get(prepared.composeFiles[0])!).services
        .felixvalidator;
    assert.deepEqual(Object.keys(mock.depends_on), ['chs-dev-microcks']);
    assert.deepEqual(
        JSON.parse(mock.labels['chs.dev.lifecycle']).dependencies,
        ['chs-dev-microcks'],
    );
    assert.match(String(mock.ports[0]), /^127\.0\.0\.1:\d{4,5}:8080$/);
    assert.deepEqual(prepared.environmentRequirements, []);
    assert.deepEqual(prepared.sshRequirements, []);
    assert.equal(
        f.calls.some(([type]) => type === 'repository'),
        false,
    );
    const configuration = JSON.parse(
        f.files.get('/state/one/mock-config/felixvalidator.json')!,
    );
    assert.equal(configuration.scenario, 'validation-failed');
    assert.equal(configuration.asyncCallback.method, 'PATCH');
});

test('prepares an isolated Compose file with effective dependencies and absolute paths', async () => {
    const f = fixture();
    const result = await prepareProject(f.request, f.dependencies);
    assert.deepEqual(result, {
        protocolVersion: 1,
        projectName: 'project',
        projectDirectory: '/project',
        configurationIdentity: sha(f.request.configuration),
        composeFiles: ['/state/one/docker-compose.yaml'],
        sources: {
            app: '/project/services/modules/example/app.docker-compose.yaml',
            database:
                '/project/services/modules/example/database.docker-compose.yaml',
        },
        inventory: [
            { service: 'app', mode: 'Service' },
            { service: 'database', mode: 'Service', reclaimable: true },
        ],
        sshRequirements: [],
        environmentRequirements: [],
    });
    assert.ok(
        ![...f.files.keys()].some((path) => /^\/project\/.*chs-dev/.test(path)),
    );
    const document = parse(f.files.get(result.composeFiles[0]!)!);
    assert.equal(document.name, 'project');
    assert.equal(document.services.app.labels['chs.dev.mode'], 'Service');
    assert.equal(document.services.app.labels['chs.dev.owner-service'], 'app');
    assert.equal(
        document.services.app.env_file[0],
        '/project/services/modules/example/app.env',
    );
    assert.equal(document.secrets.key.file, '/project/local/key');
    assert.equal(document.services['ingress-proxy'], undefined);
});

test('exclusions remove dependencies; modules and mock modes are resolved', async () => {
    const f = fixture({ modules: ['example'], excludedServices: ['database'] });
    f.put('/project/services/modules/example/sockpuppet.docker-compose.yaml', {
        services: { sockpuppet: { image: 'mock' } },
    });
    const result = await prepareProject(f.request, f.dependencies);
    assert.equal(
        result.inventory.some((item) => item.service === 'database'),
        false,
    );
    assert.deepEqual(
        result.inventory.find((item) => item.service === 'sockpuppet'),
        { service: 'sockpuppet', mode: 'Mock' },
    );
    assert.deepEqual(
        parse(f.files.get(result.composeFiles[0]!)!).services.app.depends_on,
        {},
    );
});

test('development uses the newest builder template with repository mounts', async () => {
    const f = fixture({ services: ['app'], servicesWithLiveUpdate: ['app'] });
    f.addDirectory('/project/local/builders/node/v2');
    f.put('/project/local/builders/node/v3/builder.docker-compose.yaml', {
        services: {
            '<service>': {
                build: {
                    context: '<chs_dev_root>',
                    dockerfile: 'local/builders/node/v3/dev.Dockerfile',
                },
                volumes: ['<absolute_repository_path>:/app'],
            },
        },
    });
    const result = await prepareProject(f.request, f.dependencies);
    const spec = parse(f.files.get(result.composeFiles[0]!)!).services.app;
    assert.deepEqual(spec.volumes, ['/project/repositories/app:/app']);
    assert.equal(spec.build.context, '/project');
    assert.equal(
        spec.build.dockerfile,
        'local/builders/node/v3/dev.Dockerfile',
    );
    assert.equal(spec.env_file[0], '/project/services/modules/example/app.env');
    assert.equal(result.inventory[0]!.mode, 'Development');
    assert.equal(f.calls.filter(([name]) => name === 'repository').length, 1);
});

test('builder helpers keep ordering and write out and touch paths to the operation directory', async () => {
    const f = fixture({ services: ['app'], servicesWithLiveUpdate: ['app'] });
    f.put('/project/local/builders/node/v2/builder.docker-compose.yaml', {
        services: {
            '<service>-builder': {
                build: { context: '<chs_dev_root>' },
                volumes: ['./out:/opt/out'],
                develop: { watch: [{ path: '.touch', action: 'rebuild' }] },
            },
            '<service>': {
                depends_on: {
                    '<service>-builder': {
                        condition: 'service_completed_successfully',
                    },
                },
            },
        },
    });
    const result = await prepareProject(f.request, f.dependencies);
    const services = parse(f.files.get(result.composeFiles[0]!)!).services;
    assert.deepEqual(services['app-builder'].volumes, [
        '/state/one/out:/opt/out',
    ]);
    assert.equal(
        services['app-builder'].develop.watch[0].path,
        '/state/one/.touch',
    );
    assert.ok(f.files.has('/state/one/.touch'));
    assert.ok(services.app.depends_on['app-builder']);
    assert.ok(services.app.depends_on.database);
    assert.deepEqual(
        JSON.parse(
            services.app.labels['chs.dev.lifecycle'],
        ).dependencies.sort(),
        ['app-builder', 'database'],
    );
    assert.equal(
        services.app.depends_on['app-builder'].condition,
        'service_completed_successfully',
    );
    assert.deepEqual(
        JSON.parse(services['app-builder'].labels['chs.dev.lifecycle'])
            .dependencies,
        [],
    );
    assert.equal(
        services['app-builder'].labels['chs.dev.owner-service'],
        'app',
    );
});

test('repository builder uses the repository context, which must stay inside it', async () => {
    for (const context of ['app', '../outside']) {
        const f = fixture({
            services: ['app'],
            servicesWithLiveUpdate: ['app'],
        });
        f.put('/project/services/modules/example/app.docker-compose.yaml', {
            services: {
                app: {
                    image: 'app',
                    labels: [
                        'chs.local.builder=repository',
                        `chs.local.repoContext=${context}`,
                        'chs.local.dockerfile=development.Dockerfile',
                        'chs.local.builder.requiresSecrets=true',
                    ],
                },
            },
        });
        if (context.startsWith('..')) {
            await assert.rejects(
                prepareProject(f.request, f.dependencies),
                /context/,
            );
            continue;
        }
        const result = await prepareProject(f.request, f.dependencies);
        const spec = parse(f.files.get(result.composeFiles[0]!)!).services.app;
        assert.deepEqual(spec.build, {
            context: '/project/repositories/app/app',
            dockerfile: 'development.Dockerfile',
        });
        assert.equal(spec.pull_policy, 'build');
        assert.deepEqual(spec.secrets, [
            'ssh-private-key',
            'ssh-private-key-passphrase',
        ]);
        assert.deepEqual(result.sshRequirements, [
            {
                kind: 'container-ssh-secrets',
                services: ['app'],
                keyPath: 'local/.ssh_key',
                passphrasePath: 'local/.ssh_key_passphrase',
            },
        ]);
    }
});

test('failures never publish a Compose file and output directories are never reused', async () => {
    for (const key of ['validate', 'environment'] as const) {
        const f = fixture();
        f.dependencies[key] = async () => {
            throw new Error('failure');
        };
        await assert.rejects(prepareProject(f.request, f.dependencies));
        assert.equal(f.files.has('/state/one/docker-compose.yaml'), false);
    }
    const f = fixture();
    await prepareProject(f.request, f.dependencies);
    await assert.rejects(prepareProject(f.request, f.dependencies), /exists/);
    await assert.rejects(
        prepareProject({ ...f.request, outputDirectory: '/' }, f.dependencies),
        /must not contain/,
    );
});

test('invalid configuration, unknown names and base exclusions fail', async () => {
    for (const state of [
        [],
        { services: 'app' },
        { services: ['unknown'] },
        { modules: ['unknown'] },
        { excludedServices: ['ingress-proxy'] },
    ]) {
        const f = fixture(state);
        await assert.rejects(resolveProject(f.request, f.dependencies));
    }
    assert.throws(() => readState('services: [a]\nservices: [b]'));
    for (const excludedServices of ['app', [false], [12]])
        assert.throws(
            () => readState(stringify({ excludedServices })),
            /excludedServices/,
        );
    const f = fixture({ services: ['app'] });
    f.put('/project/services/modules/example/app.docker-compose.yaml', {
        services: { app: { image: 'app', depends_on: ['missing'] } },
    });
    await assert.rejects(resolveProject(f.request, f.dependencies), /missing/);
    assert.deepEqual(
        dependencyClosure(
            new Map([
                ['a', ['b']],
                ['b', ['a']],
            ]),
            ['a'],
        ),
        ['a', 'b'],
    );
});

test('deprecated services are excluded from the inventory', async () => {
    const f = fixture({ modules: ['example'], excludedServices: ['database'] });
    f.put('/project/services/modules/example/old.docker-compose.yaml', {
        services: {
            old: { image: 'old', labels: { 'chs.deprecated': 'true' } },
        },
    });
    const result = await resolveProject(f.request, f.dependencies);
    assert.deepEqual(
        result.inventory.map((item) => item.service),
        ['app'],
    );
});

test('environment requirements list names only, skipping pass-through entries, defaults and escapes', async () => {
    const f = fixture({ services: ['env'] });
    f.put('/project/services/modules/example/env.docker-compose.yaml', {
        services: {
            env: {
                image: 'env',
                environment: [
                    'AWS_SECRET_ACCESS_KEY',
                    'OPTION=${DEFAULT:-ok}',
                    'REQUIRED=${TOKEN:?required}',
                    'UNBRACED=$UNBRACED_TOKEN',
                    'ESCAPED=$${NOT_REQUIRED}',
                    'SHELL=$$ESCAPED',
                ],
            },
        },
    });
    const result = await prepareProject(f.request, f.dependencies);
    assert.deepEqual(result.environmentRequirements, [
        'TOKEN',
        'UNBRACED_TOKEN',
    ]);
    assert.deepEqual(f.calls.find(([name]) => name === 'environment')?.[1], [
        'TOKEN',
        'UNBRACED_TOKEN',
    ]);
});

test('preparation permits an unset Felix secret in list and map environment syntax', async () => {
    for (const environment of [
        ['KEYCLOAK_SECRET'],
        { KEYCLOAK_SECRET: null },
    ]) {
        const f = fixture({ services: ['felixvalidator'] });
        f.put(
            '/project/services/modules/example/felixvalidator.docker-compose.yaml',
            {
                services: {
                    felixvalidator: {
                        image: 'fixture/felixvalidator',
                        environment,
                    },
                },
            },
        );
        const runtimeEnvironment = new LiveEnvironment(
            async () => {
                throw new Error('No credentials or commands needed');
            },
            '/project',
            () => ({}),
            () => 'fixture',
            {
                read: (path) => f.fs.readFile(path),
                realpath: (path) => f.fs.realpath(path),
            },
        );
        f.dependencies.environment = {
            enforce: async (names) => {
                await runtimeEnvironment.resolve(names);
            },
        };
        const result = await prepareProject(f.request, f.dependencies);
        assert.deepEqual(result.environmentRequirements, []);
        assert.deepEqual(
            parse(f.files.get(result.composeFiles[0]!)!).services.felixvalidator
                .environment,
            environment,
        );
    }
});

test('the standard custom-init.sh is recognised, never run, and credentials stay out of files', async () => {
    const f = fixture();
    f.put('/project/services/modules/example/app.docker-compose.yaml', {
        services: {
            app: {
                image: 'app',
                env_file: ['app.env', '../../../aws-session.env'],
                environment: ['A=1'],
            },
        },
    });
    f.put('/project/custom-init.sh', 'aws login\n');
    await assert.rejects(
        prepareProject(f.request, f.dependencies),
        /custom-init\.sh/,
    );
    f.put('/project/custom-init.sh', standardInit);
    await assert.rejects(
        prepareProject(
            { ...f.request, outputDirectory: '/state/two' },
            f.dependencies,
        ),
        /set_aws_session_vars/,
    );
    f.put(
        '/project/custom-init-scripts/set_aws_session_vars.sh',
        standardAwsExportLines.join('\n'),
    );
    const result = await prepareProject(
        { ...f.request, outputDirectory: '/state/three' },
        f.dependencies,
    );
    assert.deepEqual(result.environmentRequirements, [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
    ]);
    const app = parse(f.files.get(result.composeFiles[0]!)!).services.app;
    assert.deepEqual(app.env_file, [
        '/project/services/modules/example/app.env',
    ]);
    assert.deepEqual(app.environment, {
        A: '1',
        AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}',
        AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}',
        AWS_SESSION_TOKEN: '${AWS_SESSION_TOKEN}',
    });
    assert.equal(f.files.has('/project/aws-session.env'), false);
});

test('project name precedence: environment, .env, docker-compose.yaml, directory', async () => {
    const f = fixture();
    const name = async (env: NodeJS.ProcessEnv = {}) =>
        (await projectIdentity('/project', { fs: f.fs, env })).projectName;
    assert.equal(await name(), 'project');
    f.put('/project/docker-compose.yaml', { name: 'manual-project' });
    assert.equal(await name(), 'manual-project');
    f.put('/project/.env', 'COMPOSE_PROJECT_NAME=dotenv-project\n');
    assert.equal(await name(), 'dotenv-project');
    assert.equal(
        await name({ COMPOSE_PROJECT_NAME: 'environment-project' }),
        'environment-project',
    );
    await assert.rejects(name({ COMPOSE_PROJECT_NAME: 'Bad Name' }), /Invalid/);
});

test('repositories are cloned once non-interactively and existing checkouts are reused', async () => {
    const f = fixture();
    const runs: [string, string[], NodeJS.ProcessEnv][] = [];
    const prepare = cloneRepository(
        f.fs,
        async (command, args, env) => {
            runs.push([command, args, env]);
            f.directories.add('/project/repositories/app');
        },
        { PATH: '/bin' },
    );
    const request = {
        service: 'app',
        directory: '/project/repositories/app',
        url: 'git@github.com:example/app.git',
        branch: 'main',
    };
    assert.equal(await prepare(request), '/project/repositories/app');
    assert.deepEqual(runs[0]![1], [
        'clone',
        '--branch',
        'main',
        '--',
        'git@github.com:example/app.git',
        '/project/repositories/app',
    ]);
    assert.equal(runs[0]![2].GIT_TERMINAL_PROMPT, '0');
    assert.equal(runs[0]![2].GIT_SSH_COMMAND, 'ssh -oBatchMode=yes');
    await prepare({ ...request, branch: 'other' });
    assert.equal(runs.length, 1);
    await assert.rejects(
        prepare({
            ...request,
            directory: '/project/repositories/x',
            url: 'file:///x',
        }),
        /chs\.repository\.url/,
    );
});

test('in-process preparation writes only to the state directory and retains applied operations', async () => {
    const f = fixture();
    f.put('/project/services/modules/example/app.env', '');
    const removed: string[] = [];
    const resolved: string[][] = [];
    let id = 0;
    const preparation = new ProjectPreparation({
        directory: '/project',
        stateDirectory: '/state/project-abc',
        projectFs: f.fs,
        files: {
            mkdir: async (path) => {
                f.directories.add(path);
            },
            remove: async (path) => {
                removed.push(path);
            },
        },
        execute: async () => assert.fail('No commands expected'),
        environment: {
            resolve: async (names) => {
                resolved.push([...names]);
                return {};
            },
        },
        operationId: () => `op${++id}`,
    });
    const revision = {
        identity: sha(f.request.configuration),
        yaml: f.request.configuration,
        inventory: [],
    };
    await assert.rejects(preparation.resolve(revision, {}), /identity changed/);
    await preparation.check();
    assert.equal(preparation.projectName, 'project');
    const inventory = await preparation.resolve(revision, {});
    assert.equal(inventory.inventory.length, 2);
    const prepared = await preparation.prepare(revision, {});
    assert.deepEqual(prepared.composeFiles, [
        '/state/project-abc/operations/op1/docker-compose.yaml',
    ]);
    await assert.rejects(
        preparation.prepare({ ...revision, yaml: 'services: [missing]\n' }, {}),
        (error: Error) =>
            error instanceof LiveFailure &&
            error.kind === 'failed' &&
            /unknown service: missing/.test(error.message),
    );
    await assert.rejects(
        preparation.resolve({ ...revision, identity: 'other' }, {}),
        /identity changed/,
    );
    await preparation.cleanup();
    assert.deepEqual(removed, ['/state/project-abc/operations/op2']);
    assert.ok(
        ![...f.files.keys()].some(
            (path) =>
                path.startsWith('/project/') && !path.includes('services/'),
        ),
    );
});

test('project state directories are stable, per checkout and outside the project', () => {
    const one = projectStateDirectory(
        '/work/docker-chs-development',
        '/state/chs-dev',
    );
    assert.match(
        one,
        /^\/state\/chs-dev\/projects\/docker-chs-development-[a-f0-9]{12}$/,
    );
    assert.equal(
        projectStateDirectory('/work/docker-chs-development', '/state/chs-dev'),
        one,
    );
    assert.notEqual(
        projectStateDirectory(
            '/other/docker-chs-development',
            '/state/chs-dev',
        ),
        one,
    );
});

test('a missing variable excludes its owner and dependents; the rest start', async () => {
    const f = fixture({
        services: ['configurable', 'dependent', 'standalone'],
    });
    f.put(
        '/project/services/modules/example/configurable.docker-compose.yaml',
        {
            services: {
                configurable: {
                    image: 'cfg',
                    environment: { PASSWORD: '${DB_PASSWORD}' },
                },
            },
        },
    );
    f.put('/project/services/modules/example/dependent.docker-compose.yaml', {
        services: { dependent: { image: 'dep', depends_on: ['configurable'] } },
    });
    f.put('/project/services/modules/example/standalone.docker-compose.yaml', {
        services: { standalone: { image: 'solo' } },
    });
    const prepared = await prepareProject(f.request, {
        ...f.dependencies,
        environment: {
            enforce: async () => {
                throw new Error(
                    'enforce must not run when variables are missing',
                );
            },
            missing: async () => ['DB_PASSWORD'],
        },
    });
    assert.deepEqual(
        prepared.inventory.map((entry) => entry.service),
        ['standalone'],
    );
    assert.deepEqual(prepared.exclusions, [
        {
            variable: 'DB_PASSWORD',
            services: ['configurable', 'dependent'],
            cause: 'DB_PASSWORD is not set',
            remediation:
                "Set DB_PASSWORD in this checkout's .env file, then apply the environment again.",
        },
    ]);
    assert.equal(prepared.unattributable, undefined);
    assert.deepEqual(prepared.environmentRequirements, []);
    const document = parse(f.files.get(prepared.composeFiles[0]!)!);
    assert.equal(document.services.configurable, undefined);
    assert.equal(document.services.dependent, undefined);
    assert.ok(document.services.standalone);
});

test('without the missing capability, or with nothing missing, prepare is unchanged', async () => {
    const f = fixture();
    const prepared = await prepareProject(f.request, f.dependencies);
    assert.equal(prepared.exclusions, undefined);
    assert.equal(prepared.unattributable, undefined);
    assert.deepEqual(
        f.calls.some(([type]) => type === 'environment'),
        true,
    );
    const document = parse(f.files.get(prepared.composeFiles[0]!)!);
    assert.ok(document.services.app);
    assert.ok(document.services.database);
});

test('multiple missing variables produce one exclusion each, sorted', async () => {
    const f = fixture({ services: ['alpha', 'beta', 'standalone'] });
    f.put('/project/services/modules/example/alpha.docker-compose.yaml', {
        services: {
            alpha: { image: 'a', environment: { NAME: '${VAR_A}' } },
        },
    });
    f.put('/project/services/modules/example/beta.docker-compose.yaml', {
        services: {
            beta: { image: 'b', environment: { NAME: '${VAR_B}' } },
        },
    });
    f.put('/project/services/modules/example/standalone.docker-compose.yaml', {
        services: { standalone: { image: 'solo' } },
    });
    const prepared = await prepareProject(f.request, {
        ...f.dependencies,
        environment: {
            enforce: async () => {
                throw new Error(
                    'enforce must not run when variables are missing',
                );
            },
            missing: async () => ['VAR_B', 'VAR_A'],
        },
    });
    assert.deepEqual(
        prepared.exclusions?.map((exclusion) => exclusion.variable),
        ['VAR_A', 'VAR_B'],
    );
    assert.deepEqual(prepared.exclusions?.[0].services, ['alpha']);
    assert.deepEqual(prepared.exclusions?.[1].services, ['beta']);
    assert.deepEqual(
        prepared.inventory.map((entry) => entry.service),
        ['standalone'],
    );
});

test('a variable attributable to no service is reported and blocks nothing', async () => {
    const f = fixture({ services: ['app', 'extra'] });
    f.put('/project/services/modules/example/shared.docker-compose.yaml', {
        services: { extra: { image: 'extra' } },
        volumes: { shared: { driver: '${TOP_VAR}' } },
    });
    const prepared = await prepareProject(f.request, {
        ...f.dependencies,
        environment: {
            enforce: async () => {
                throw new Error(
                    'enforce must not run when variables are missing',
                );
            },
            missing: async () => ['TOP_VAR'],
        },
    });
    assert.deepEqual(prepared.unattributable, ['TOP_VAR']);
    assert.equal(prepared.exclusions, undefined);
    assert.deepEqual(
        prepared.inventory.map((entry) => entry.service),
        ['app', 'database', 'extra'],
    );
    assert.deepEqual(prepared.environmentRequirements, ['TOP_VAR']);
});

test('after the variable is fixed a retry prepares the full stack', async () => {
    const f = fixture({
        services: ['configurable', 'dependent', 'standalone'],
    });
    f.put(
        '/project/services/modules/example/configurable.docker-compose.yaml',
        {
            services: {
                configurable: {
                    image: 'cfg',
                    environment: { PASSWORD: '${DB_PASSWORD}' },
                },
            },
        },
    );
    f.put('/project/services/modules/example/dependent.docker-compose.yaml', {
        services: { dependent: { image: 'dep', depends_on: ['configurable'] } },
    });
    f.put('/project/services/modules/example/standalone.docker-compose.yaml', {
        services: { standalone: { image: 'solo' } },
    });
    let missing = ['DB_PASSWORD'];
    const environment = {
        enforce: async () => {},
        missing: async () => missing,
    };
    const first = await prepareProject(f.request, {
        ...f.dependencies,
        environment,
    });
    assert.equal(first.exclusions?.length, 1);
    missing = [];
    const retried = await prepareProject(
        { ...f.request, outputDirectory: '/state/retry' },
        { ...f.dependencies, environment },
    );
    assert.equal(retried.exclusions, undefined);
    assert.deepEqual(retried.inventory.map((entry) => entry.service).sort(), [
        'configurable',
        'dependent',
        'standalone',
    ]);
});

test('routed services publish their load-balancer port on loopback once', async () => {
    const f = fixture({ services: ['published', 'unpublished'] });
    f.files.set(
        '/project/services/modules/example/published.docker-compose.yaml',
        stringify({
            services: {
                published: {
                    image: 'p',
                    labels: [
                        'traefik.http.routers.published.rule=Host(`p`)',
                        'traefik.http.services.published.loadbalancer.server.port=8080',
                    ],
                    ports: ['8080:8080'],
                },
            },
        }),
    );
    f.files.set(
        '/project/services/modules/example/unpublished.docker-compose.yaml',
        stringify({
            services: {
                unpublished: {
                    image: 'u',
                    labels: [
                        'traefik.http.routers.unpublished.rule=Host(`u`)',
                        'traefik.http.services.unpublished.loadbalancer.server.port=18636',
                    ],
                },
            },
        }),
    );
    const prepared = await prepareProject(f.request, f.dependencies);
    const services = parse(f.files.get(prepared.composeFiles[0])!).services;
    assert.deepEqual(services.published.ports, ['8080:8080']);
    assert.match(
        String(services.unpublished.ports[0]),
        /^127\.0\.0\.1:\d{4,5}:18636$/,
    );
    assert.equal(services['ingress-proxy'], undefined);
});

test('services forwarding to the retired ingress-proxy are pointed at the daemon proxy', async () => {
    const f = fixture({ services: ['listed', 'mapped', 'other'] });
    const add = (name: string, environment: unknown) =>
        f.files.set(
            `/project/services/modules/example/${name}.docker-compose.yaml`,
            stringify({ services: { [name]: { image: name, environment } } }),
        );
    add('listed', [
        'PROXY_TARGET_URLS=http://ingress-proxy',
        'MODE=api',
        'PASSTHROUGH',
    ]);
    add('mapped', { PROXY_TARGET_URLS: 'http://ingress-proxy', PORT: 4001 });
    add('other', ['UPSTREAM=http://ingress-proxy/path']);
    const prepared = await prepareProject(f.request, f.dependencies);
    const services = parse(f.files.get(prepared.composeFiles[0])!).services;
    assert.deepEqual(services.listed.environment, [
        'PROXY_TARGET_URLS=http://host.docker.internal',
        'MODE=api',
        'PASSTHROUGH',
    ]);
    assert.deepEqual(services.mapped.environment, {
        PROXY_TARGET_URLS: 'http://host.docker.internal',
        PORT: 4001,
    });
    assert.deepEqual(services.other.environment, [
        'UPSTREAM=http://ingress-proxy/path',
    ]);
});

test('prepared lifecycle metadata records resolved lazy policy and generated dependencies', async () => {
    const f = fixture({
        services: ['app'],
        serviceStartModes: { app: 'lazy' },
    });
    const result = await prepareProject(f.request, f.dependencies);
    const services = parse(f.files.get(result.composeFiles[0]!)!).services;
    assert.deepEqual(JSON.parse(services.app.labels['chs.dev.lifecycle']), {
        version: 1,
        lazy: true,
        reclaimable: false,
        dependencies: ['database'],
    });
    assert.deepEqual(
        JSON.parse(services.database.labels['chs.dev.lifecycle']),
        {
            version: 1,
            lazy: true,
            reclaimable: true,
            dependencies: [],
        },
    );
    assert.deepEqual(services.app.depends_on.database, {
        condition: 'service_healthy',
    });
});

function docgenFixture() {
    const f = fixture({ modules: ['docgen'], versionSource: 'compose' });
    f.put('/project/services/modules/docgen/services.docker-compose.yaml', {
        services: {
            'document-generator-consumer': {
                image: 'fixture/consumer:1',
                depends_on: ['kafka', 'kafka3'],
            },
            'data-document-rendering-api': {
                image: 'fixture/rendering:1',
                depends_on: {
                    kafka: { condition: 'service_healthy' },
                    kafka3: { condition: 'service_healthy' },
                    'kafka-init': {
                        condition: 'service_completed_successfully',
                    },
                },
                environment: { PROXY_TARGET_URLS: 'http://ingress-proxy' },
            },
            kafka: {
                image: 'fixture/kafka:1',
                healthcheck: { test: ['CMD', 'true'] },
            },
            kafka3: {
                image: 'fixture/kafka:3',
                environment: { PASSWORD: '${KAFKA_TEST_PASSWORD}' },
                healthcheck: { test: ['CMD', 'true'] },
            },
            'kafka-init': {
                image: 'fixture/init:1',
                depends_on: { kafka3: { condition: 'service_healthy' } },
            },
        },
    });
    return f;
}

test('representative docgen selection preserves both Kafka generations, readiness conditions and host ingress', async () => {
    const f = docgenFixture();
    const prepared = await prepareProject(f.request, f.dependencies);
    const services = parse(f.files.get(prepared.composeFiles[0]!)!).services;
    assert.deepEqual(Object.keys(services).sort(), [
        'data-document-rendering-api',
        'document-generator-consumer',
        'kafka',
        'kafka-init',
        'kafka3',
    ]);
    const consumer = services['document-generator-consumer'];
    assert.deepEqual(consumer.depends_on, ['kafka', 'kafka3']);
    const api = services['data-document-rendering-api'];
    assert.deepEqual(api.depends_on, {
        kafka: { condition: 'service_healthy' },
        kafka3: { condition: 'service_healthy' },
        'kafka-init': { condition: 'service_completed_successfully' },
    });
    assert.deepEqual(
        JSON.parse(api.labels['chs.dev.lifecycle']).dependencies.sort(),
        ['kafka', 'kafka-init', 'kafka3'],
    );
    assert.equal(
        api.environment.PROXY_TARGET_URLS,
        'http://host.docker.internal',
    );
    assert.equal(services['ingress-proxy'], undefined);
});

test('docgen missing Kafka configuration identifies the causal variable and dependent exclusions', async () => {
    const f = docgenFixture();
    const prepared = await prepareProject(f.request, {
        ...f.dependencies,
        environment: {
            enforce: async () =>
                assert.fail('missing configuration cannot be enforced'),
            missing: async () => ['KAFKA_TEST_PASSWORD'],
        },
    });
    assert.deepEqual(
        prepared.inventory.map((entry) => entry.service),
        ['kafka'],
    );
    assert.deepEqual(prepared.exclusions, [
        {
            variable: 'KAFKA_TEST_PASSWORD',
            services: [
                'data-document-rendering-api',
                'document-generator-consumer',
                'kafka-init',
                'kafka3',
            ],
            cause: 'KAFKA_TEST_PASSWORD is not set',
            remediation:
                "Set KAFKA_TEST_PASSWORD in this checkout's .env file, then apply the environment again.",
        },
    ]);
    const services = parse(f.files.get(prepared.composeFiles[0]!)!).services;
    assert.deepEqual(Object.keys(services), ['kafka']);
});
