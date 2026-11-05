/**
 * Measurement of the selected stack: counts, dependency edges, and declared
 * memory. Pure data — the values come from Compose declarations, not runtime
 * observation.
 */
export interface SelectionMeasurement {
    /** Every selected service, sorted: user selections plus base infrastructure. */
    services: string[];
    /** The base infrastructure subset of `services`, sorted. */
    baseServices: string[];
    /** Total selected service count, including base infrastructure. */
    serviceCount: number;
    /** Count of base infrastructure services in the selection. */
    baseServiceCount: number;
    /** Selected services by mode (Service, Development, Mock), keyed by mode name. */
    modeCounts: Record<string, number>;
    /** Dependency edges whose owner and target are both selected. */
    dependencyEdgeCount: number;
    /** Aggregate declared `mem_limit` in bytes; 0 when nothing declares one. */
    memoryLimitBytes: number;
    /** Aggregate declared `mem_reservation` in bytes; 0 when nothing declares one. */
    memoryReservationBytes: number;
    /** Services with at least one declared memory field. */
    servicesWithMemoryLimit: number;
    /** Sorted services that declare neither memory field. */
    servicesWithoutMemoryLimit: string[];
    /** Memory values the parser could not read; measurement still sums the rest. */
    unparsedMemory: Array<{
        service: string;
        field: 'mem_limit' | 'mem_reservation';
        value: unknown;
    }>;
    /** Selected services marked lazy, sorted. Absent from the list means eager. */
    lazyServices: string[];
}

/** The measured change a journey makes against the current selection. */
export interface JourneyDelta {
    /** Baseline service count minus journey service count; positive is fewer. */
    services: number;
    /** Baseline dependency edges minus journey dependency edges. */
    dependencyEdges: number;
    /** Baseline declared limit minus journey declared limit, in bytes. */
    memoryLimitBytes: number;
    /** Baseline declared reservation minus journey declared reservation, in bytes. */
    memoryReservationBytes: number;
}

/** A journey measured as the target selection against the current selection. */
export interface JourneyMeasurement {
    name: string;
    /** Target members that start eagerly (derived, label-aware), sorted. */
    started: string[];
    /** Target members held lazy (explicit or `chs.start-mode: lazy`), sorted. */
    lazy: string[];
    /** Current selection outside the journey closure: the membership reduction. */
    notInJourney: string[];
    /** Journey closure outside the current selection: the membership growth. */
    added: string[];
    /** The journey's full measured set: members, their closure, base infrastructure. */
    target: SelectionMeasurement;
    /** Measured baseline minus target; every reduction comes from `notInJourney`. */
    delta: JourneyDelta;
}

/** Result of `environment measure`: the current stack, plus a journey when asked. */
export interface StackMeasurement {
    /** The selection as currently configured — what apply would start. */
    baseline: SelectionMeasurement;
    /** Present when a journey was requested with `--journey`. */
    journey?: JourneyMeasurement;
}

export function measureJourneyDelta(
    baseline: SelectionMeasurement,
    target: SelectionMeasurement,
): JourneyDelta {
    return {
        services: baseline.serviceCount - target.serviceCount,
        dependencyEdges:
            baseline.dependencyEdgeCount - target.dependencyEdgeCount,
        memoryLimitBytes: baseline.memoryLimitBytes - target.memoryLimitBytes,
        memoryReservationBytes:
            baseline.memoryReservationBytes - target.memoryReservationBytes,
    };
}
