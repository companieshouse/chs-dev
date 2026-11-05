import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awsFailure, readAwsStatus } from '../src/infrastructure/aws-status.js';

test('distinguishes expired sessions, missing credentials, configuration and connection failures', () => {
    for (const stderr of [
        'The SSO session associated with this profile has expired or is otherwise invalid',
        'Error loading SSO Token: Token for example does not exist',
        'An error occurred (ExpiredToken) when calling the GetCallerIdentity operation',
    ])
        assert.equal(awsFailure({ stderr }).state, 'expired');
    assert.equal(
        awsFailure({ stderr: 'Unable to locate credentials' }).state,
        'signed-out',
    );
    assert.equal(
        awsFailure({
            stderr: 'The config profile (example) could not be found',
        }).state,
        'unconfigured',
    );
    assert.equal(awsFailure({ code: 'ENOENT' }).state, 'missing-cli');
    assert.equal(
        awsFailure({ stderr: 'Could not connect to the endpoint URL' }).state,
        'unavailable',
    );
    assert.equal(awsFailure({ killed: true }).state, 'unavailable');
});

test('checks identity through CLI without prompts, preserves profile and supports cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-aws-test-'));
    const originalPath = process.env.PATH;
    const originalProfile = process.env.AWS_PROFILE;
    try {
        process.env.PATH = directory;
        process.env.AWS_PROFILE = 'test-profile';
        const cli = join(directory, 'aws');
        await writeFile(
            cli,
            `#!/bin/sh
test "$AWS_PROFILE" = "test-profile" || exit 1
test "$AWS_CLI_AUTO_PROMPT" = "off" || exit 1
test "$AWS_PAGER" = "" || exit 1
test "$1 $2" = "sts get-caller-identity" || exit 1
echo '{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/example/test"}'
`,
            { mode: 0o755 },
        );
        assert.equal((await readAwsStatus()).state, 'active');
        await writeFile(cli, '#!/bin/sh\necho invalid-json\n', { mode: 0o755 });
        assert.equal((await readAwsStatus()).state, 'unavailable');
        await writeFile(
            cli,
            '#!/bin/sh\necho "SSO session has expired" >&2\nexit 1\n',
            { mode: 0o755 },
        );
        assert.equal((await readAwsStatus()).state, 'expired');
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(readAwsStatus(controller.signal));
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalProfile === undefined) delete process.env.AWS_PROFILE;
        else process.env.AWS_PROFILE = originalProfile;
        await rm(directory, { recursive: true, force: true });
    }
});
