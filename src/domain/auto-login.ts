import type { BlockedReason, LivePhase } from './live.js';
import type { LoginChoice } from './settings.js';

/** When chs-dev starts a login by itself. */
export const autoLoginModes = ['off', 'needed', 'expired'] as const;
export type AutoLoginMode = (typeof autoLoginModes)[number];

export function parseAutoLogin(value: string): AutoLoginMode | undefined {
    const normalized = value.trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalized)) return 'off';
    if (
        ['1', 'true', 'yes', 'on', 'needed', 'when-needed'].includes(normalized)
    )
        return 'needed';
    if (['expired', 'immediately', 'always'].includes(normalized))
        return 'expired';
    return undefined;
}

/** Tracks what has already been attempted so failed logins are not retried. */
export interface AutoLoginMemory {
    blocks: readonly ('aws' | 'ecr')[];
    expiry: boolean;
}
export const initialAutoLoginMemory: AutoLoginMemory = {
    blocks: [],
    expiry: false,
};

export interface AutoLoginInput {
    mode: AutoLoginMode;
    /** AWS credential state from the status poll. */
    aws: string;
    phase: LivePhase;
    blocked?: BlockedReason;
    /** False while another modal, a login, or an environment operation is active. */
    idle: boolean;
    /** The progress window may stay open while recovering an authentication block. */
    environmentOpen?: boolean;
    preference?: LoginChoice;
}
export interface AutoLoginDecision {
    memory: AutoLoginMemory;
    login?: { kind: 'aws' | 'registry'; reason: string };
}

const operationPhases: readonly LivePhase[] = [
    'Checking',
    'Preparing',
    'Applying',
    'Stopping',
    'Cancelling',
];

function blockedLogin(
    input: AutoLoginInput,
    next: AutoLoginMemory,
    preferred: 'aws' | 'registry',
): AutoLoginDecision | undefined {
    const blocked = input.blocked;
    if (
        input.phase === 'Blocked' &&
        (blocked === 'aws' || blocked === 'ecr') &&
        !next.blocks.includes(blocked)
    )
        return {
            memory: { blocks: [...next.blocks, blocked], expiry: true },
            login: {
                kind: blocked === 'ecr' ? 'registry' : preferred,
                reason:
                    blocked === 'ecr'
                        ? 'The environment needs a container registry login.'
                        : 'The environment needs an AWS login.',
            },
        };
    return undefined;
}

function shouldRefreshExpired(
    input: AutoLoginInput,
    next: AutoLoginMemory,
): boolean {
    return (
        input.mode === 'expired' &&
        !input.environmentOpen &&
        input.aws === 'expired' &&
        !next.expiry &&
        !operationPhases.includes(input.phase)
    );
}

/**
 * Decides whether to log in automatically. Each block reason and each expiry
 * is attempted once; memory resets when the environment settles or AWS
 * credentials become active again.
 */
export function autoLoginStep(
    input: AutoLoginInput,
    memory: AutoLoginMemory,
): AutoLoginDecision {
    let next = memory;
    if (input.phase === 'Running' || input.phase === 'Stopped')
        next = { ...next, blocks: [] };
    if (input.aws === 'active') next = { ...next, expiry: false };
    if (input.mode === 'off' || !input.idle) return { memory: next };
    const preferred =
        input.preference === 'aws' || input.preference === 'registry'
            ? input.preference
            : 'registry';
    const blocked = blockedLogin(input, next, preferred);
    if (blocked) return blocked;
    if (shouldRefreshExpired(input, next))
        return {
            memory: { ...next, expiry: true },
            login: { kind: preferred, reason: 'Your AWS session expired.' },
        };
    return { memory: next };
}
