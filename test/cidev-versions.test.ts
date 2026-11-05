import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    matchCidevImages,
    type RunningServiceImage,
} from '../src/domain/aws-versions.js';
import {
    cidevReader,
    readCidevVersions,
    type AwsRead,
} from '../src/infrastructure/cidev-versions.js';
import type { ServiceGroup } from '../src/domain/services.js';

const digest = `sha256:${'a'.repeat(64)}`;
const otherDigest = `sha256:${'b'.repeat(64)}`;
const groups: ServiceGroup[] = [
    {
        name: 'fixture',
        services: ['api', 'company-api-ch-gov-uk', 'eric', 'eric-web'],
        definitions: Object.fromEntries(
            [
                ['api', 'registry.example/api:${TAG:-latest}'],
                [
                    'company-api-ch-gov-uk',
                    'registry.example/company.api.ch.gov.uk:latest',
                ],
                ['eric', 'registry.example/eric:latest'],
                ['eric-web', 'registry.example/eric:latest'],
            ].map(([name, image]) => [
                name,
                { module: 'fixture', dependencies: [], base: false, image },
            ]),
        ),
    },
];

function row(
    ecsService: string,
    image = 'registry.example/api:1.2.3',
    imageDigest = digest,
): RunningServiceImage {
    return {
        cluster: 'utility-cidev-cluster',
        ecsService,
        image,
        container: 'api',
        digest: imageDigest,
        architecture: 'x86_64',
    };
}

test('CIDEV matching prefers canonical deployments and never chooses a shared sidecar by order', () => {
    const result = matchCidevImages(groups, [
        row('cidev-api-old-kafka', 'registry.example/api:1.1.0', otherDigest),
        row('cidev-green-api', 'registry.example/api:1.1.1', otherDigest),
        row('cidev-api'),
        row('cidev-api'),
        row(
            'cidev-company-api',
            'registry.example/company.api.ch.gov.uk:3.0.0',
        ),
        row('cidev-api', 'registry.example/eric:4.0.0'),
        row('staging-api', 'registry.example/api:9.0.0', otherDigest),
    ]);
    assert.deepEqual(result.images, {
        api: `registry.example/api@${digest}`,
        'company-api-ch-gov-uk': `registry.example/company.api.ch.gov.uk@${digest}`,
    });
    assert.equal(result.matches[0].image, 'registry.example/api:1.2.3');
    assert.deepEqual(
        result.ambiguous.map((item) => item.service),
        ['eric', 'eric-web'],
    );
});

test('rolling deployments and missing digests stay unpinned for explicit review', () => {
    const rolling = matchCidevImages(groups, [
        row('cidev-api'),
        row('cidev-api', 'registry.example/api:1.2.4', otherDigest),
    ]);
    assert.deepEqual(rolling.images, {});
    assert.equal(rolling.ambiguous[0].candidates.length, 2);
    const missing = { ...row('cidev-api'), digest: undefined };
    const result = matchCidevImages(groups, [missing]);
    assert.deepEqual(result.images, {});
    assert.match(result.warnings[0], /usable image digest/);
});

test('ECS discovery reads only CIDEV clusters, batches tasks and ignores stopped containers', async () => {
    const calls: string[][] = [];
    const clusters = [
        'utility-cidev-cluster',
        'data-reconciliation-cidev',
        'utility-staging-cluster',
        'phoenix-cluster',
        'cidevish-cluster',
    ];
    const read: AwsRead = async (args) => {
        calls.push(args);
        if (args[1] === 'list-clusters')
            return clusters.map(
                (name) => `arn:aws:ecs:eu-west-2:123:cluster/${name}`,
            );
        if (args[1] === 'list-tasks')
            return Array.from(
                { length: 101 },
                (_item, index) => `task-${index}`,
            );
        const arns = args.slice(args.indexOf('--tasks') + 1);
        assert.ok(arns.length <= 100);
        return {
            failures: [],
            tasks: arns.map((arn) => ({
                group: 'service:cidev-api',
                lastStatus: arn === 'task-100' ? 'STOPPED' : 'RUNNING',
                architecture: 'x86_64',
                containers: [
                    {
                        name: 'api',
                        image: 'registry.example/api:1.2.3',
                        imageDigest: digest,
                        lastStatus: 'RUNNING',
                    },
                    {
                        name: 'unused',
                        image: 'registry.example/api:9.0.0',
                        imageDigest: otherDigest,
                        lastStatus: 'STOPPED',
                    },
                ],
            })),
        };
    };
    const result = await readCidevVersions({}, groups, undefined, read);
    assert.equal(result.clusters, 2);
    assert.equal(result.runningTasks, 200);
    assert.equal(result.matches[0].architecture, 'x86_64');
    assert.equal(result.images.api, `registry.example/api@${digest}`);
    assert.equal(
        calls.filter((call) => call[1] === 'describe-tasks').length,
        4,
    );
    assert.ok(
        calls.every(
            (call) =>
                call[0] === 'ecs' &&
                ['list-clusters', 'list-tasks', 'describe-tasks'].includes(
                    call[1],
                ),
        ),
    );
    assert.ok(
        calls
            .slice(1)
            .every((call) =>
                /cidev(?:-|$)/.test(call[call.indexOf('--cluster') + 1]),
            ),
    );
});

test('CIDEV discovery reports missing clusters, changed tasks and cancellation without writing AWS', async () => {
    await assert.rejects(
        readCidevVersions({}, groups, undefined, async () => []),
        /No CIDEV/,
    );
    const read: AwsRead = async (args) => {
        if (args[1] === 'list-clusters') return ['cidev-cluster'];
        if (args[1] === 'list-tasks') return ['task-1'];
        return { failures: [{ arn: 'task-1', reason: 'MISSING' }] };
    };
    await assert.rejects(
        readCidevVersions({}, groups, undefined, read),
        /changed while reading/,
    );
    const controller = new AbortController();
    controller.abort(new Error('Cancelled'));
    await assert.rejects(
        readCidevVersions({}, groups, controller.signal, read),
        /Cancelled/,
    );
    assert.throws(
        () => cidevReader({ profile: '../invalid' }),
        /valid AWS profile/,
    );
});
