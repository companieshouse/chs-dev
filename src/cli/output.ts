import {
    ClientError,
    type ApiError,
    type Operation,
} from '../protocol/types.js';
import type { CliResult } from './context.js';

export function errorDetail(error: unknown): ApiError {
    if (error instanceof ClientError) return error.detail;
    return {
        code: 'CLI_FAILED',
        message: error instanceof Error ? error.message : String(error),
    };
}
export function exitCode(error: ApiError) {
    const codes: Record<string, number> = {
        INVALID_USAGE: 2,
        CONFIRMATION_REQUIRED: 3,
        WAIT_TIMEOUT: 124,
        SIGINT: 130,
        SIGTERM: 143,
    };
    return codes[error.code] ?? 1;
}
export function textResult(result: CliResult) {
    if (result.text !== undefined) return result.text;
    const data = result.data as Record<string, unknown> | null;
    if (!data) return 'Done.';
    if (Array.isArray(data.lines)) return data.lines.join('\n');
    if (typeof data.message === 'string') return data.message;
    for (const name of ['services', 'modules', 'exclusions']) {
        const names = data[name];
        if (
            Array.isArray(names) &&
            names.every((item) => typeof item === 'string')
        )
            return `${name[0].toUpperCase()}${name.slice(1)}:\n${names.map((item) => ` - ${item}`).join('\n')}`;
    }
    return JSON.stringify(data, null, 2);
}
export function envelope(
    command: string,
    data: unknown,
    warnings: string[],
    operation?: Operation,
    error?: ApiError,
) {
    return {
        version: 1,
        ok: !error,
        command,
        data,
        warnings,
        ...(operation ? { operation } : {}),
        ...(error ? { error } : {}),
    };
}
