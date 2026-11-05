/** Values and identifiers from requests/results must never enter this interface. */
export interface OperationCompletion {
    command: string;
    state: 'succeeded' | 'failed' | 'cancelled';
    durationMs: number;
    errorCode?: string;
}

export interface Telemetry {
    record(completion: OperationCompletion): void;
    close(): void;
}

export type SafeTelemetryEvent = {
    schemaVersion: 1;
    installId: string;
    timestamp: string;
    command: string;
} & (
    | { type: 'command-completed'; durationMs: number; exitCode: number }
    | {
          type: 'error-occurred';
          errorCode: string;
          message: 'Operation failed.';
      }
);

const commands = new Set([
    'environment.start',
    'environment.apply',
    'environment.stop',
    'environment.cancel',
    'environment.confirm',
    'environment.dismiss',
    'environment.profileImport',
    'environment.profileExport',
    'service.action',
    'service.reload',
    'container.action',
    'configuration.save',
    'configuration.legacyEdit',
    'project.saveJourney',
    'project.deleteJourney',
    'project.clone',
    'settings.save',
    'usage.cacheClear',
    'ssh.setup',
    'authentication.login',
]);
const errorCodes = new Set([
    'OPERATION_FAILED',
    'STATE_WRITE_FAILED',
    'STALE_PROJECT',
    'REVISION_CONFLICT',
    'PROJECT_UNAVAILABLE',
    'BUSY',
]);

/** Construct a fresh minimal payload: redaction never relies on guessing secrets. */
export function completionEvents(
    completion: OperationCompletion,
    installId: string,
): SafeTelemetryEvent[] {
    if (
        !commands.has(completion.command) ||
        typeof completion.durationMs !== 'number' ||
        !Number.isFinite(completion.durationMs)
    )
        return [];
    if (!['succeeded', 'failed', 'cancelled'].includes(completion.state))
        return [];
    const envelope = {
        schemaVersion: 1 as const,
        installId,
        timestamp: new Date().toISOString(),
        command: completion.command,
    };
    const event: SafeTelemetryEvent = {
        ...envelope,
        type: 'command-completed',
        durationMs: Math.min(
            86400000,
            Math.max(0, Math.round(completion.durationMs)),
        ),
        exitCode:
            completion.state === 'succeeded'
                ? 0
                : completion.state === 'cancelled'
                  ? 130
                  : 1,
    };
    if (completion.state !== 'failed') return [event];
    const errorCode = errorCodes.has(completion.errorCode ?? '')
        ? completion.errorCode!
        : 'OPERATION_FAILED';
    return [
        event,
        {
            ...envelope,
            type: 'error-occurred',
            errorCode,
            message: 'Operation failed.',
        },
    ];
}
