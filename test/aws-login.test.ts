import { dockerRegistryCommand } from '../src/infrastructure/runtimes/docker-compose.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAwsLogin } from '../src/infrastructure/aws-login.js';

test('registry login passes each ECR profile once, without a shell', () => {
    assert.deepEqual(
        dockerRegistryCommand(['development-eu-west-2'], '/custom/l_docker'),
        {
            command: '/custom/l_docker',
            args: ['-p', 'development-eu-west-2'],
        },
    );
    assert.deepEqual(
        dockerRegistryCommand([
            'development-eu-west-2',
            'shared-services-ecr-eu-west-2-ro',
            'development-eu-west-2',
        ]).args,
        [
            '-p',
            'development-eu-west-2',
            '-p',
            'shared-services-ecr-eu-west-2-ro',
        ],
    );
    assert.throws(() => dockerRegistryCommand([]), /valid AWS profile/);
    assert.throws(
        () => dockerRegistryCommand(['ok', '$(evil)']),
        /valid AWS profile/,
    );
});

test('login reports success, failure, missing CLI and cancellation while cleaning signal handlers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-login-test-'));
    const originalPath = process.env.PATH;
    const handlers = process.listenerCount('SIGINT');
    try {
        process.env.PATH = directory;
        const cli = join(directory, 'aws');
        await writeFile(
            cli,
            '#!/bin/sh\ntest "$1 $2 $3 $4" = "sso login --profile test-profile"\n',
            { mode: 0o755 },
        );
        assert.equal((await runAwsLogin('test-profile')).outcome, 'success');
        await writeFile(cli, '#!/bin/sh\nexit 1\n');
        assert.equal((await runAwsLogin('test-profile')).outcome, 'failed');
        await writeFile(cli, '#!/bin/sh\nexit 130\n');
        assert.equal((await runAwsLogin('test-profile')).outcome, 'cancelled');
        await writeFile(cli, '#!/bin/sh\nwhile :; do :; done\n');
        const pending = runAwsLogin('test-profile');
        process.emit('SIGINT');
        assert.equal((await pending).outcome, 'cancelled');
        await rm(cli);
        assert.match(
            (await runAwsLogin('test-profile')).message,
            /not installed/,
        );
        assert.equal(process.listenerCount('SIGINT'), handlers);
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        await rm(directory, { recursive: true, force: true });
    }
});
