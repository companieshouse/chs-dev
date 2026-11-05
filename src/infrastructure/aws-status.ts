import { rethrowIfAborted } from './cancellation.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { currentSettings } from './settings.js';

const exec = promisify(execFile);

export type { AwsState, AwsStatus } from '../domain/aws.js';
import type { AwsStatus } from '../domain/aws.js';

export function awsFailure(error: unknown): AwsStatus {
    const failure = error as { code?: string; stderr?: string };
    if (failure?.code === 'ENOENT') return { state: 'missing-cli' };
    const message = failure?.stderr ?? '';
    if (
        /expired|SSO session.*invalid|Error loading SSO Token|Token.*does not exist|UnauthorizedSSOToken|InvalidGrantException/i.test(
            message,
        )
    )
        return { state: 'expired' };
    if (
        /Unable to locate credentials|InvalidClientTokenId|UnrecognizedClientException|security token included.*invalid/i.test(
            message,
        )
    )
        return { state: 'signed-out' };
    if (
        /config profile.*could not be found|Missing.*sso_|Unable to parse config|You must specify a region/i.test(
            message,
        )
    )
        return { state: 'unconfigured' };
    return { state: 'unavailable' };
}

export function awsProfile(): string {
    return currentSettings().awsProfile.value;
}

export async function readAwsStatus(signal?: AbortSignal): Promise<AwsStatus> {
    try {
        const { stdout } = await exec(
            'aws',
            [
                'sts',
                'get-caller-identity',
                '--profile',
                awsProfile(),
                '--output',
                'json',
                '--cli-connect-timeout',
                '5',
                '--cli-read-timeout',
                '5',
            ],
            {
                signal,
                timeout: 12000,
                maxBuffer: 64 * 1024,
                env: {
                    ...process.env,
                    AWS_PAGER: '',
                    AWS_CLI_AUTO_PROMPT: 'off',
                    AWS_MAX_ATTEMPTS: '1',
                },
            },
        );
        const identity = JSON.parse(stdout) as {
            Account?: string;
            Arn?: string;
        };
        return {
            state: identity.Account && identity.Arn ? 'active' : 'unavailable',
        };
    } catch (error) {
        rethrowIfAborted(signal, error);
        return awsFailure(error);
    }
}
