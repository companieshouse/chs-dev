import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppleNativeStrategy } from '../src/infrastructure/runtimes/apple-native.js';
import { AppleClient } from '../src/infrastructure/native/apple-client.js';
import { LiveFailure } from '../src/domain/live.js';
import type {
    ProcessRequest,
    ProcessResult,
} from '../src/infrastructure/live-process.js';
import type { OperationResult } from '../src/domain/runtime-strategy.js';

const ok = (stdout = ''): ProcessResult => ({ code: 0, stdout, stderr: '' });
const expired = (): ProcessResult => ({
    code: 255,
    stdout: '',
    stderr: 'Error loading SSO Token: Token does not exist',
});
function fixture(
    options: {
        fail?: (
            request: ProcessRequest,
            renewed: string[],
        ) => ProcessResult | undefined;
        login?: OperationResult;
        onRequest?: (request: ProcessRequest) => void;
    } = {},
) {
    const calls: ProcessRequest[] = [];
    const renewed: string[] = [];
    const runtime = new AppleNativeStrategy(
        async (request) => {
            calls.push(request);
            options.onRequest?.(request);
            const failed = options.fail?.(request, renewed);
            if (failed) return failed;
            const profile = request.args[request.args.indexOf('--profile') + 1];
            switch (request.args[0]) {
                case 'sts':
                    return ok(
                        profile === 'secondary'
                            ? '222222222222'
                            : '111111111111',
                    );
                case 'configure':
                    return ok('eu-west-2');
                case 'ecr':
                    return ok(`private-ecr-password-${profile}`);
                default:
                    return ok();
            }
        },
        async (profile) => {
            renewed.push(profile);
            return (
                options.login ?? {
                    outcome: 'success',
                    message: 'AWS login completed.',
                }
            );
        },
    );
    return { runtime, calls, renewed };
}

test('Apple registry login renews expired SSO for each selected profile and then logs into Apple', async () => {
    const handlers = process.listenerCount('SIGINT');
    const f = fixture({
        fail: (request, renewed) => {
            const profile = request.args[request.args.indexOf('--profile') + 1];
            if (request.args[0] === 'sts' && !renewed.includes(profile))
                return expired();
        },
    });
    assert.equal(
        (
            await f.runtime.loginRegistry({
                profiles: ['primary', 'secondary', 'primary'],
            })
        ).outcome,
        'success',
    );
    assert.deepEqual(f.renewed, ['primary', 'secondary']);
    const logins = f.calls.filter((c) => c.args[0] === 'registry');
    assert.deepEqual(
        logins.map((c) => c.args.at(-1)),
        [
            '111111111111.dkr.ecr.eu-west-2.amazonaws.com',
            '222222222222.dkr.ecr.eu-west-2.amazonaws.com',
        ],
    );
    assert.deepEqual(
        logins.map((c) => c.stdin),
        ['private-ecr-password-primary\n', 'private-ecr-password-secondary\n'],
    );
    assert.ok(
        f.calls.every(
            (c) =>
                c.privateOutput &&
                c.command !== 'docker' &&
                !c.args.join(' ').includes('private-ecr-password'),
        ),
    );
    assert.equal(process.listenerCount('SIGINT'), handlers);
});

test('active AWS credentials only need registry login, without a browser prompt', async () => {
    const f = fixture();
    assert.equal(
        (await f.runtime.loginRegistry({ profiles: ['primary'] })).outcome,
        'success',
    );
    assert.deepEqual(f.renewed, []);
    assert.equal(f.calls.filter((c) => c.args[0] === 'registry').length, 1);
});

test('SSO expiry during ECR token retrieval is recovered once', async () => {
    const f = fixture({
        fail: (request, renewed) => {
            if (request.args[0] === 'ecr' && !renewed.length) return expired();
        },
    });
    assert.equal(
        (await f.runtime.loginRegistry({ profiles: ['primary'] })).outcome,
        'success',
    );
    assert.deepEqual(f.renewed, ['primary']);
});

test('repeated expiry stops after one renewal and identifies the failing profile', async () => {
    const f = fixture({ fail: () => expired() });
    const result = await f.runtime.loginRegistry({
        profiles: ['primary', 'secondary'],
    });
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /AWS profile primary/);
    assert.deepEqual(f.renewed, ['primary']);
    assert.equal(f.calls.length, 2);
});

test('permission and network errors do not trigger an SSO login loop', async () => {
    for (const stderr of [
        'AccessDeniedException: not authorized to perform ecr:GetAuthorizationToken',
        'Could not connect to the endpoint URL',
    ]) {
        const f = fixture({ fail: () => ({ code: 1, stdout: '', stderr }) });
        const result = await f.runtime.loginRegistry({ profiles: ['primary'] });
        assert.equal(result.outcome, 'failed');
        assert.ok(result.message.includes(stderr));
        assert.deepEqual(f.renewed, []);
        assert.equal(f.calls.length, 1);
    }
});

test('cancelled or failed SSO stops before obtaining or storing registry credentials', async () => {
    for (const outcome of ['cancelled', 'failed'] as const) {
        const f = fixture({
            fail: () => expired(),
            login: { outcome, message: `AWS login ${outcome}.` },
        });
        assert.equal(
            (await f.runtime.loginRegistry({ profiles: ['primary'] })).outcome,
            outcome,
        );
        assert.equal(f.calls.length, 1);
    }
});

test('Ctrl+C and an aborted request cancel Apple login and release their signal handlers', async () => {
    const handlers = process.listenerCount('SIGINT');
    const f = fixture({
        onRequest: () => {
            process.emit('SIGINT');
        },
    });
    assert.equal(
        (await f.runtime.loginRegistry({ profiles: ['primary'] })).outcome,
        'cancelled',
    );
    assert.equal(f.calls.length, 1);
    assert.equal(process.listenerCount('SIGINT'), handlers);
    const untouched = fixture();
    assert.equal(
        (
            await untouched.runtime.loginRegistry(
                { profiles: ['primary'] },
                AbortSignal.abort(),
            )
        ).outcome,
        'cancelled',
    );
    assert.equal(untouched.calls.length, 0);
    assert.equal(process.listenerCount('SIGINT'), handlers);
});

test('Apple authentication failures name the registry and recovery action without progress noise', async () => {
    const registry = '416670754337.dkr.ecr.eu-west-2.amazonaws.com';
    for (const stderr of [
        `[1/2] Fetching image [0s]\nError: HTTP request to https://${registry}/v2/account-validator-api/manifests/latest failed with response: 401 Unauthorized. Reason: access denied or wrong credentials, no credentials found for host ${registry}`,
        `Error: no credentials found for host ${registry}`,
        `https://${registry}/v2/app/manifests/latest: 403 Forbidden`,
    ]) {
        const client = new AppleClient({
            directory: '/fixture',
            environment: { resolve: async () => ({}) },
            execute: async () => ({ code: 1, stdout: '', stderr }),
        });
        await assert.rejects(
            client.checked(['image', 'pull', `${registry}/app:latest`]),
            (error) => {
                assert.ok(error instanceof LiveFailure);
                assert.equal(error.kind, 'ecr');
                assert.ok(error.message.includes(registry));
                assert.match(error.message, /AWS \+ registry login/);
                assert.doesNotMatch(error.message, /Fetching|manifests/);
                return true;
            },
        );
    }
});
