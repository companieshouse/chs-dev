import type {
    JourneyDelta,
    JourneyMeasurement,
    SelectionMeasurement,
} from '../domain/measurements.js';

export const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

export function memoryText(m: SelectionMeasurement) {
    const memory = m.servicesWithMemoryLimit
        ? `${gib(m.memoryLimitBytes)} limit across ${m.servicesWithMemoryLimit} services`
        : 'no declared limits';
    return `Declared memory: ${memory}${
        m.memoryReservationBytes
            ? `, ${gib(m.memoryReservationBytes)} reserved`
            : ''
    }.`;
}

export function baselineLines(m: SelectionMeasurement) {
    const modes = Object.entries(m.modeCounts)
        .map(([mode, count]) => `${mode} ${count}`)
        .join(', ');
    return [
        `${m.serviceCount} selected services (${m.baseServiceCount} base infrastructure), ${m.dependencyEdgeCount} dependency edges.`,
        memoryText(m),
        ...(modes ? [`Modes: ${modes}.`] : []),
        ...(m.lazyServices.length
            ? [`Lazy: ${m.lazyServices.join(', ')}.`]
            : []),
        ...(m.servicesWithoutMemoryLimit.length
            ? [
                  `${m.servicesWithoutMemoryLimit.length} services declare no memory limit: ${m.servicesWithoutMemoryLimit.join(', ')}.`,
              ]
            : []),
        ...(m.unparsedMemory.length
            ? [
                  `Unparsed memory values: ${m.unparsedMemory
                      .map(
                          (item) =>
                              `${item.service}.${item.field}=${String(item.value)}`,
                      )
                      .join(', ')}.`,
              ]
            : []),
    ];
}

export function reduction(
    value: number,
    label: string,
    format: (n: number) => string,
) {
    if (!value) return `${label} unchanged`;
    const sign = value > 0 ? '-' : '+';
    return `${sign}${format(Math.abs(value))} ${label}`;
}

export function deltaLine(delta: JourneyDelta) {
    return `Measured delta vs the current selection: ${reduction(delta.services, 'services', String)}, ${reduction(delta.dependencyEdges, 'dependency edges', String)}, ${reduction(delta.memoryLimitBytes, 'declared limit', gib)}, ${reduction(delta.memoryReservationBytes, 'reservation', gib)}.`;
}

export function journeyLines(j: JourneyMeasurement) {
    return [
        `Journey ${j.name}: ${j.target.serviceCount} selected services (${j.target.baseServiceCount} base infrastructure), ${j.target.dependencyEdgeCount} dependency edges.`,
        `Members started eagerly (${j.started.length}): ${j.started.join(', ') || 'none'}.`,
        `Members lazy (${j.lazy.length}): ${j.lazy.join(', ') || 'none'} - lazy members stay in the set and start on first request.`,
        ...(j.notInJourney.length
            ? [
                  `Outside the journey (${j.notInJourney.length}, not started under it): ${j.notInJourney.join(', ')}.`,
              ]
            : []),
        ...(j.added.length
            ? [
                  `Added by the journey (${j.added.length}): ${j.added.join(', ')}.`,
              ]
            : []),
        memoryText(j.target),
        deltaLine(j.delta),
        'Membership explains every difference: services outside the journey are the reduction, services the journey adds are the growth; lazy marking defers start without changing the measured set.',
    ];
}
