import { useSession } from '../context.js';
export function useSettings() {
    return useSession().settings;
}
