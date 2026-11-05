/**
 * Pure, deterministic classification of container and stack evidence into a
 * failure class. Ordered rules: engine-confirmed OOM first; exit 137 without
 * engine OOM confirmation is an application exit, not an OOM; an unmet
 * dependency names its blocker; a missing variable is configuration;
 * inconclusive evidence stays unknown and names the missing inspections.
 */
export type FailureClass =
    | 'oom'
    | 'health'
    | 'dependency'
    | 'configuration'
    | 'application-exit'
    | 'unknown';

export interface UnmetDependency {
    /** The service this one depends on. */
    service: string;
    /** The Compose condition that is not met, e.g. `service_healthy`. */
    condition: string;
}

export interface FailureEvidence {
    /** Engine-confirmed OOM state; undefined means not observed. */
    oomKilled?: boolean;
    exitCode?: number;
    /** Container health verdict, e.g. `unhealthy`. */
    health?: string;
    unmetDependency?: UnmetDependency;
    /** A start-blocking environment variable that is not set. */
    missingVariable?: string;
}

export interface FailureClassification {
    class: FailureClass;
    reason: string;
    /** For unknown: the inspections that would decide a class. */
    missingInspections?: string[];
}

export function classifyFailure(
    evidence: FailureEvidence,
): FailureClassification {
    if (evidence.oomKilled === true)
        return found(
            'oom',
            'The engine confirmed the container was OOM-killed.',
        );
    if (evidence.exitCode !== undefined)
        return exited(evidence.exitCode, evidence.oomKilled);
    if (evidence.unmetDependency)
        return found(
            'dependency',
            `Dependency ${evidence.unmetDependency.service} is not ${evidence.unmetDependency.condition}.`,
        );
    if (evidence.missingVariable)
        return found(
            'configuration',
            `Required variable ${evidence.missingVariable} is not set.`,
        );
    if (isUnhealthy(evidence.health))
        return found('health', 'The container health check reports unhealthy.');
    return unknown(evidence);
}

function found(
    classification: FailureClass,
    reason: string,
): FailureClassification {
    return { class: classification, reason };
}

function exited(exitCode: number, oomKilled: boolean | undefined) {
    if (exitCode === 137 && oomKilled !== true)
        return found(
            'application-exit',
            'The container exited with code 137; the engine did not confirm an OOM kill.',
        );
    return found(
        'application-exit',
        `The container exited with code ${exitCode}.`,
    );
}

function unknown(evidence: FailureEvidence): FailureClassification {
    const missing = missingInspections(evidence);
    return {
        class: 'unknown',
        reason: `Evidence is inconclusive; missing ${joinList(missing)}.`,
        missingInspections: missing,
    };
}

function missingInspections(evidence: FailureEvidence): string[] {
    const missing: string[] = [];
    if (evidence.oomKilled === undefined)
        missing.push('docker inspect State.OOMKilled');
    if (evidence.exitCode === undefined)
        missing.push('docker inspect State.ExitCode');
    if (evidence.health === undefined) missing.push('container health status');
    if (!evidence.unmetDependency && !evidence.missingVariable)
        missing.push('dependency conditions and required variables');
    return missing.length ? missing : ['any failure evidence'];
}

function joinList(items: string[]): string {
    return items.join(', ');
}

function isUnhealthy(health: string | undefined) {
    return (health ?? '').toLowerCase() === 'unhealthy';
}
