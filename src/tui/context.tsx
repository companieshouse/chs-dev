import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Client } from '../client/client.js';

const context = createContext<Client | undefined>(undefined);
export const ClientProvider = context.Provider;
export function useClient() {
    const client = useContext(context);
    if (!client) throw new Error('The TUI needs a daemon client.');
    return client;
}

/** The client when one is mounted; standalone component tests render without. */
export function useOptionalClient() {
    return useContext(context);
}
export function useSession() {
    const client = useClient();
    return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
