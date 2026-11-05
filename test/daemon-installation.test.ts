import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import {
    daemonEnvironment,
    environmentMismatch,
} from '../src/daemon-control/environment.js';
import { daemonProgram } from '../src/daemon-control/discovery.js';
import { launchAgentPlist } from '../src/daemon-control/macos/launch-agent.js';
import { daemonFixture } from './daemon-fixture.js';

test('login service uses stable paths and excludes ephemeral secrets', () => {
    const env = daemonEnvironment({
        PATH: '/fixture/bin',
        CHS_DEV_PROJECT: './fixture',
        AWS_PROFILE: 'fixture',
        AWS_SECRET_ACCESS_KEY: 'private',
        AWS_SESSION_TOKEN: 'private',
        SSH_AUTH_SOCK: '/private/agent',
    });
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.AWS_SESSION_TOKEN, undefined);
    assert.equal(env.SSH_AUTH_SOCK, undefined);
    assert.equal(isAbsolute(env.CHS_DEV_PROJECT!), true);
    const program = daemonProgram();
    assert.equal(isAbsolute(program.command), true);
    assert.equal(isAbsolute(program.args.at(-1)!), true);
    assert.equal(isAbsolute(program.cwd), true);
    const plist = launchAgentPlist();
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
    assert.doesNotMatch(plist, /AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);
});

test('a frontend override mismatch is reported without changing the shared session', async () => {
    const f = await daemonFixture();
    try {
        const before = f.app.snapshot();
        assert.match(
            environmentMismatch(before, {
                CHS_DEV_PROJECT: '/different-checkout',
            })!,
            /Project directory/,
        );
        assert.equal(environmentMismatch(before, {}), undefined);
        assert.deepEqual(f.app.snapshot().scope, before.scope);
    } finally {
        await f.close();
    }
});

test('retired runtime overrides are excluded from new daemon environments', () => {
    const env = daemonEnvironment({
        CHS_DEV_RUNTIME: 'apple',
        CHS_DEV_ORCHESTRATOR: 'native',
        CHS_DEV_APPLE_CLI: '/old/container',
    });
    assert.equal(env.CHS_DEV_RUNTIME, undefined);
    assert.equal(env.CHS_DEV_ORCHESTRATOR, undefined);
    assert.equal(env.CHS_DEV_APPLE_CLI, undefined);
    const settings = { resolved: {} } as any;
    assert.match(
        environmentMismatch({ settings } as any, { CHS_DEV_RUNTIME: 'apple' })!,
        /CHS_DEV_RUNTIME is retired and ignored/,
    );
});

test('daemon startup retains Docker selector and TLS configuration without cloud credentials', () => {
    const selected = {
        DOCKER_HOST: 'tcp://fixture:2376',
        DOCKER_CONTEXT: 'fixture',
        DOCKER_TLS: '1',
        DOCKER_TLS_VERIFY: '1',
        DOCKER_CERT_PATH: '/fixture/certs',
        DOCKER_CONFIG: '/fixture/docker',
        DOCKER_API_VERSION: '1.47',
    };
    const env = daemonEnvironment({
        ...selected,
        AWS_SESSION_TOKEN: 'temporary',
    });
    for (const [key, value] of Object.entries(selected))
        assert.equal(env[key], value);
    assert.equal(env.AWS_SESSION_TOKEN, undefined);
});
