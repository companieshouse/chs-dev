import { useCallback, useState } from 'react';
import type { SettingKey } from '../../domain/settings.js';
import { overlayView, type WorkspaceOverlay } from '../models/overlay.js';

function useOverlaySetters(
    pushOverlay: (overlay: WorkspaceOverlay) => void,
    popOverlay: (kind: WorkspaceOverlay['kind']) => void,
) {
    const setModalService = useCallback(
        (name: string | undefined) =>
            name
                ? pushOverlay({ kind: 'service', name })
                : popOverlay('service'),
        [popOverlay, pushOverlay],
    );
    const setSelectedContainer = useCallback(
        (id: string | undefined) =>
            id
                ? pushOverlay({ kind: 'container', id })
                : popOverlay('container'),
        [popOverlay, pushOverlay],
    );
    const setLoginOpen = useCallback(
        (open: boolean) =>
            open ? pushOverlay({ kind: 'login' }) : popOverlay('login'),
        [popOverlay, pushOverlay],
    );
    const setEnvironmentOpen = useCallback(
        (open: boolean) =>
            open
                ? pushOverlay({ kind: 'environment' })
                : popOverlay('environment'),
        [popOverlay, pushOverlay],
    );
    const setSshSetupOpen = useCallback(
        (open: boolean) =>
            open ? pushOverlay({ kind: 'ssh' }) : popOverlay('ssh'),
        [popOverlay, pushOverlay],
    );
    const setConfigEditor = useCallback(
        (key: SettingKey | undefined) =>
            key ? pushOverlay({ kind: 'setting', key }) : popOverlay('setting'),
        [popOverlay, pushOverlay],
    );
    const setHelpOpen = useCallback(
        (open: boolean) =>
            open ? pushOverlay({ kind: 'help' }) : popOverlay('help'),
        [popOverlay, pushOverlay],
    );
    return {
        setModalService,
        setSelectedContainer,
        setLoginOpen,
        setEnvironmentOpen,
        setSshSetupOpen,
        setConfigEditor,
        setHelpOpen,
    };
}

export function useOverlayState() {
    const [overlayStack, setOverlayStack] = useState<WorkspaceOverlay[]>([]);
    const pushOverlay = useCallback(
        (overlay: WorkspaceOverlay) =>
            setOverlayStack((current) => {
                const active = current.at(-1);
                if (active?.kind === overlay.kind)
                    return [...current.slice(0, -1), overlay];
                return [...current, overlay];
            }),
        [],
    );
    const popOverlay = useCallback((kind: WorkspaceOverlay['kind']) => {
        setOverlayStack((current) => {
            let index = current.length - 1;
            while (index >= 0 && current[index]?.kind !== kind) index--;
            if (index < 0) return current;
            return [...current.slice(0, index), ...current.slice(index + 1)];
        });
    }, []);
    const clearOverlays = useCallback(() => setOverlayStack([]), []);
    const setters = useOverlaySetters(pushOverlay, popOverlay);
    const activeOverlay = overlayStack.at(-1);
    const loginOverlayOpen =
        activeOverlay !== undefined && activeOverlay.kind !== 'environment';
    return {
        ...overlayView(activeOverlay),
        ...setters,
        overlayStack,
        clearOverlays,
        loginOverlayOpen,
        overlayOpen: overlayStack.length > 0,
    };
}

export type OverlayState = ReturnType<typeof useOverlayState>;
