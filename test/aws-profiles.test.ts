import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    discoverAwsProfiles,
    effectiveEcrProfiles,
    matchProfiles,
    parseAwsConfig,
    scanRegistries,
} from '../src/infrastructure/aws-profiles.js';

const config = `
[default]
region = eu-west-2
[sso-session CompaniesHouse]
sso_region = eu-west-2
[profile dev]
sso_session = CompaniesHouse
sso_account_id = 111111111111
region = eu-west-2
# sso_account_id = 999999999999
[profile shared]
; comment
sso_account_id = 222222222222
region = eu-west-2
[profile shared-ireland]
sso_account_id = 222222222222
region = eu-west-1
[profile assumed]
role_arn = arn:aws:iam::333333333333:role/Reader
region = eu-west-2
[profile bad name!]
region = eu-west-2
`;

test('AWS config parsing reads profile accounts and regions without evaluating it', () => {
    const profiles = parseAwsConfig(config);
    assert.deepEqual(
        [...profiles.keys()],
        ['default', 'dev', 'shared', 'shared-ireland', 'assumed'],
    );
    assert.deepEqual(profiles.get('dev'), {
        name: 'dev',
        account: '111111111111',
        region: 'eu-west-2',
    });
    assert.equal(profiles.get('assumed')?.account, '333333333333');
    assert.equal(profiles.get('default')?.account, undefined);
});

test('registry matching recommends one profile per registry, preferring the primary', () => {
    const profiles = [...parseAwsConfig(config).values()];
    const registries = [
        {
            host: '111111111111.dkr.ecr.eu-west-2.amazonaws.com',
            account: '111111111111',
            region: 'eu-west-2',
        },
        {
            host: '222222222222.dkr.ecr.eu-west-2.amazonaws.com',
            account: '222222222222',
            region: 'eu-west-2',
        },
        {
            host: '444444444444.dkr.ecr.eu-west-2.amazonaws.com',
            account: '444444444444',
            region: 'eu-west-2',
        },
    ];
    const result = matchProfiles(profiles, registries, 'default');
    assert.deepEqual(result.recommended, ['dev', 'shared']);
    assert.deepEqual(result.unmatched, [
        '444444444444.dkr.ecr.eu-west-2.amazonaws.com',
    ]);
    const shared = result.profiles.find((profile) => profile.name === 'shared');
    assert.equal(shared?.required, true);
    assert.deepEqual(shared?.registries, [registries[1].host]);
    assert.equal(
        result.profiles.find((profile) => profile.name === 'shared-ireland')
            ?.required,
        false,
    );
    const duplicate = matchProfiles(
        [
            ...profiles,
            { name: 'dev-copy', account: '111111111111', region: 'eu-west-2' },
        ],
        registries.slice(0, 1),
        'dev-copy',
    );
    assert.deepEqual(duplicate.recommended, ['dev-copy']);
});

test('registry scanning covers service and builder files and skips repositories', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-registries-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'services/modules/a'), { recursive: true });
    await mkdir(join(root, 'local/builders/node/v3'), { recursive: true });
    await mkdir(join(root, 'services/node_modules'), { recursive: true });
    await mkdir(join(root, 'repositories/app'), { recursive: true });
    await writeFile(
        join(root, 'services/modules/a/a.docker-compose.yaml'),
        'image: 111111111111.dkr.ecr.eu-west-2.amazonaws.com/a:latest\n',
    );
    await writeFile(
        join(root, 'local/builders/node/v3/dev.Dockerfile'),
        'FROM 222222222222.dkr.ecr.eu-west-2.amazonaws.com/ci-node-build-24\n',
    );
    await writeFile(
        join(root, 'services/node_modules/x.yaml'),
        'image: 555555555555.dkr.ecr.eu-west-2.amazonaws.com/x\n',
    );
    await writeFile(
        join(root, 'repositories/app/compose.yaml'),
        'image: 666666666666.dkr.ecr.eu-west-2.amazonaws.com/x\n',
    );
    const registries = await scanRegistries(root);
    assert.deepEqual(
        registries.map((registry) => registry.host),
        [
            '111111111111.dkr.ecr.eu-west-2.amazonaws.com',
            '222222222222.dkr.ecr.eu-west-2.amazonaws.com',
        ],
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(scanRegistries(root, controller.signal));
});

test('discovery falls back to config profiles and effective profiles follow precedence', async () => {
    const discovery = await discoverAwsProfiles(
        { projectDirectory: '/project', primary: 'dev' },
        {
            listProfiles: async () => {
                throw new Error('missing aws');
            },
            readConfig: async () => config,
            scanRegistries: async () => [
                {
                    host: '222222222222.dkr.ecr.eu-west-2.amazonaws.com',
                    account: '222222222222',
                    region: 'eu-west-2',
                },
            ],
        },
    );
    assert.match(discovery.warnings[0], /list-profiles failed/);
    assert.equal(discovery.profiles.length, 5);
    assert.deepEqual(discovery.recommended, ['shared']);
    assert.deepEqual(effectiveEcrProfiles(['x'], discovery, 'dev'), ['x']);
    assert.deepEqual(effectiveEcrProfiles(undefined, discovery, 'dev'), [
        'shared',
    ]);
    assert.deepEqual(
        effectiveEcrProfiles(undefined, { recommended: [] }, 'dev'),
        ['dev'],
    );
});
