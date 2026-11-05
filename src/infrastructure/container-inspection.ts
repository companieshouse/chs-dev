import { safeLog } from '../domain/live-logs.js';

export function redactInspection(value: unknown, key = ''): unknown {
    if (/^(env|environment)$/i.test(key) && Array.isArray(value))
        return value.map((entry) => `${String(entry).split('=')[0]}=[hidden]`);
    if (/password|secret|token|credential|private.?key|access.?key/i.test(key))
        return '[hidden]';
    if (Array.isArray(value))
        return value.map((entry) => redactInspection(entry));
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([name, entry]) => [
                name,
                redactInspection(entry, name),
            ]),
        );
    return typeof value === 'string' ? safeLog(value, [], 20000) : value;
}
