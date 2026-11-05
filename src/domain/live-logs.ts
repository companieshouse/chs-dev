import { stripVTControlCharacters } from 'node:util';

export function safeLog(
    text: string,
    secrets: readonly string[] = [],
    maxLength = 2000,
): string {
    let value = text;
    for (const secret of secrets) {
        if (secret) value = value.split(secret).join('[REDACTED]');
    }
    return stripVTControlCharacters(value)
        .replace(
            /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
            '[REDACTED PRIVATE KEY]',
        )
        .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED]')
        .replace(
            /((?:aws_)?(?:secret_access_key|session_token|access_key_id)|password|token|secret)(\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi,
            '$1$2[REDACTED]',
        )
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
        .slice(0, maxLength);
}

export function logWindow<T>(
    lines: readonly T[],
    height: number,
    offset: number,
): readonly T[] {
    const boundedOffset = Math.min(
        Math.max(0, lines.length - Math.max(1, height)),
        Math.max(0, offset),
    );
    const end = lines.length - boundedOffset;
    return lines.slice(Math.max(0, end - Math.max(1, height)), end);
}
