import type { Client } from '../../client/client.js';
import { interact } from '../../client/interactions.js';
import type { LoginAction, LoginResult } from '../../domain/aws.js';
import { handOverTerminal } from '../components/terminal-handover.js';
import { useApp } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

export type TerminalControl = Pick<
    ReturnType<typeof useApp>,
    'suspendTerminal' | 'waitUntilRenderFlush'
>;

export interface LoginFlowUi {
    setLoginBusy(value: boolean): void;
    setLoginResult(value: LoginResult | undefined): void;
    setEnvironmentOpen(value: boolean): void;
    setLoginOpen(value: boolean): void;
}

export interface LoginFlowParams {
    client: Client;
    terminal: TerminalControl;
    refreshAws(): void;
    registryLogin: boolean;
    ui: LoginFlowUi;
}

async function performLogin(
    client: Client,
    action: LoginAction,
    reason?: string,
) {
    if (reason)
        process.stdout.write(
            `\nchs-dev: ${reason} Logging in automatically (Ctrl+C cancels).\n\n`,
        );
    return interact(client, 'authentication.login', {
        action,
        automatic: !!reason,
    });
}

function useLoginWork(params: LoginFlowParams) {
    const { client, terminal, refreshAws, ui } = params;
    const { setLoginBusy, setLoginResult } = ui;
    const { suspendTerminal, waitUntilRenderFlush } = terminal;
    const running = useRef(false);
    const loginWork = useCallback(
        async (
            action: LoginAction,
            reason?: string,
        ): Promise<LoginResult | undefined> => {
            if (running.current) return;
            running.current = true;
            setLoginBusy(true);
            setLoginResult(undefined);
            let result: LoginResult | undefined;
            try {
                await handOverTerminal(
                    { suspendTerminal, waitUntilRenderFlush },
                    async () => {
                        result = await performLogin(client, action, reason);
                    },
                );
                setLoginResult(result);
                refreshAws();
                return result;
            } catch (error) {
                result = {
                    outcome: 'failed',
                    message:
                        error instanceof Error ? error.message : String(error),
                };
                setLoginResult(result);
                return result;
            } finally {
                running.current = false;
                setLoginBusy(false);
            }
        },
        [
            client,
            refreshAws,
            setLoginBusy,
            setLoginResult,
            suspendTerminal,
            waitUntilRenderFlush,
        ],
    );
    return { loginWork, running };
}

export function useLoginFlow(params: LoginFlowParams) {
    const { registryLogin } = params;
    const { setEnvironmentOpen, setLoginOpen } = params.ui;
    const { loginWork, running } = useLoginWork(params);
    const [notice, setNotice] = useState<{
        text: string;
        tone: 'success' | 'muted';
    }>();
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(undefined), 8000);
        return () => clearTimeout(timer);
    }, [notice]);

    const login = loginWork;
    const quickLogin = useCallback(
        async (action: LoginAction, reason?: string) => {
            if (running.current) return;
            const effective =
                action === 'registry' && !registryLogin ? 'aws' : action;
            setNotice(undefined);
            const result = await login(effective, reason);
            if (!result || result.outcome === 'failed') {
                setEnvironmentOpen(false);
                setLoginOpen(true);
                return;
            }
            setNotice({
                text: result.message,
                tone: result.outcome === 'success' ? 'success' : 'muted',
            });
        },
        [login, running, registryLogin, setEnvironmentOpen, setLoginOpen],
    );
    return { login, quickLogin, notice };
}

export type LoginFlow = ReturnType<typeof useLoginFlow>;
