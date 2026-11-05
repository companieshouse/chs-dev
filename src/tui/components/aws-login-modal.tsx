import ModalFrame from './modal-frame.js';
import type { RuntimeStrategy } from '../../domain/runtime-strategy.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';
import type { LoginAction, LoginResult } from '../../domain/aws.js';
import type { AwsStatus } from '../../domain/aws.js';
import KeyboardHints from './keyboard-hints.js';
import SelectableRow from './selectable-row.js';
import { theme } from './theme.js';

type ModalOption = {
    id: LoginAction | 'remember' | 'close';
    label: string;
};

const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

const isDismissal = (input: string, key: Key) => key.escape || input === 'q';

const isNavigation = (key: Key) => key.upArrow || key.downArrow || key.tab;

const selectionStep = (key: Key, optionCount: number) =>
    key.upArrow || key.shift ? optionCount - 1 : 1;

const buildOptions = (
    runtimeName: string,
    registry: boolean,
    remember: boolean,
): ModalOption[] => [
    {
        id: 'registry',
        label: `AWS + ${runtimeName} login${registry ? '' : ' (unavailable)'}`,
    },
    { id: 'aws', label: 'AWS login' },
    {
        id: 'remember',
        label: `${remember ? '[x]' : '[ ]'} Don't ask again`,
    },
    { id: 'close', label: 'Close' },
];

function EcrProfileHints({
    registryLogin,
    ecr,
}: {
    registryLogin: boolean;
    ecr?: { profiles: string[]; source: string; unmatched: string[] };
}) {
    if (!registryLogin) return null;
    return (
        <>
            <Text color={theme.muted} wrap="wrap">
                ECR profiles:{' '}
                {ecr
                    ? `${clean(ecr.profiles.join(', '))} (${ecr.source})`
                    : 'detecting…'}
            </Text>
            {ecr && ecr.unmatched.length > 0 && (
                <Text color={theme.development} wrap="truncate-end">
                    No local profile matches: {clean(ecr.unmatched.join(', '))}
                </Text>
            )}
        </>
    );
}

function LoginResultStatus({
    result,
    aws,
}: {
    result?: LoginResult;
    aws: AwsStatus;
}) {
    if (!result) return null;
    return (
        <>
            <Text
                color={
                    result.outcome === 'success'
                        ? theme.enabled
                        : result.outcome === 'failed'
                          ? theme.error
                          : theme.muted
                }
            >
                {result.message}
            </Text>
            <Text color={aws.state === 'active' ? theme.enabled : theme.muted}>
                {aws.state === 'checking'
                    ? 'Checking AWS credentials…'
                    : aws.state === 'active'
                      ? 'AWS credentials: active.'
                      : 'AWS credentials are not verified as active; see the status bar.'}
            </Text>
        </>
    );
}

function LoginHints({ remember }: { remember: boolean }) {
    return (
        <>
            {remember && (
                <Text color={theme.muted} wrap="wrap">
                    Ctrl+L will run the login you choose without asking. Change
                    this in Config.
                </Text>
            )}
            <Text color={theme.muted}>
                Login temporarily returns to the terminal for browser
                authentication.
            </Text>
            <Text color={theme.muted}>
                Ctrl+C cancels login and returns here.
            </Text>
        </>
    );
}

export default function AwsLoginModal({
    runtime,
    profile,
    ecr,
    busy,
    result,
    aws,
    onLogin,
    onClose,
}: {
    runtime: Pick<RuntimeStrategy, 'name' | 'capabilities'>;
    profile: string;
    /** ECR profiles registry login will use; undefined while detecting. */
    ecr?: { profiles: string[]; source: string; unmatched: string[] };
    busy: boolean;
    result?: LoginResult;
    aws: AwsStatus;
    /** remember saves the action as the Ctrl+L default. */
    onLogin: (action: LoginAction, remember: boolean) => void;
    onClose: () => void;
}) {
    const registry = runtime.capabilities.registryLogin;
    const [selected, setSelected] = useState(registry ? 0 : 1);
    const [remember, setRemember] = useState(false);
    const options = buildOptions(runtime.name, registry, remember);
    const activate = (id: ModalOption['id']) => {
        if (id === 'close') {
            onClose();
            return;
        }
        if (id === 'aws' || (id === 'registry' && registry))
            onLogin(id, remember);
    };
    useInput((input, key) => {
        if (busy) return;
        if (isDismissal(input, key)) {
            onClose();
            return;
        }
        if (isNavigation(key)) {
            const step = selectionStep(key, options.length);
            setSelected((value) => (value + step) % options.length);
            return;
        }
        const { id } = options[selected]!;
        if (input === ' ' || (key.return && id === 'remember')) {
            setRemember((value) => !value);
            return;
        }
        if (key.return) activate(id);
    });
    const profileLabel = clean(profile);
    return (
        <ModalFrame title="Log in" width={76}>
            <Text color={theme.muted}>Profile: {profileLabel}</Text>
            <EcrProfileHints registryLogin={registry} ecr={ecr} />
            <Box flexDirection="column" marginY={1}>
                {options.map(({ id, label }, index) => (
                    <SelectableRow key={id} selected={selected === index}>
                        {label}
                    </SelectableRow>
                ))}
            </Box>
            <LoginHints remember={remember} />
            <LoginResultStatus result={result} aws={aws} />
            <KeyboardHints>
                ↑ ↓ choose · Enter select · Space don't ask again · Esc close
            </KeyboardHints>
        </ModalFrame>
    );
}
