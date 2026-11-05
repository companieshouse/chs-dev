import { runInteractiveCommand } from './interactive-command.js';
import type { OperationResult } from '../domain/runtime-strategy.js';

export type LoginAction = 'aws' | 'registry';
export type LoginResult = OperationResult;

export function runAwsLogin(
    profile: string,
    signal?: AbortSignal,
): Promise<LoginResult> {
    return runInteractiveCommand({
        command: 'aws',
        args: ['sso', 'login', '--profile', profile],
        label: 'AWS login',
        missingMessage: 'AWS CLI is not installed.',
        signal,
    });
}
