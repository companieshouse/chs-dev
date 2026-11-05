/** A service's start mode: started at Apply, or deferred until first use. */
export type StartMode = 'lazy' | 'always';

/** Where an effective start mode came from, highest precedence first. */
export type StartModeSource =
    | 'override'
    | 'journey'
    | 'manual'
    | 'label'
    | 'inherited'
    | 'learned'
    | 'default';

export interface StartModeSelections {
    serviceStartModes?: Record<string, StartMode>;
}

const startModes: readonly string[] = ['lazy', 'always'];

/** Parses the `serviceStartModes` map from raw `.chs-dev.yaml` state. */
export function startModeSelections(
    value: Record<string, unknown>,
): StartModeSelections {
    if (value.serviceStartModes === undefined) return {};
    const raw = value.serviceStartModes;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid serviceStartModes in .chs-dev.yaml');
    const result: Record<string, StartMode> = {};
    for (const [name, mode] of Object.entries(raw)) {
        if (
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) ||
            typeof mode !== 'string' ||
            !startModes.includes(mode)
        )
            throw new Error('Invalid serviceStartModes in .chs-dev.yaml');
        result[name] = mode as StartMode;
    }
    return { serviceStartModes: result };
}

/** Rejects overrides naming unknown or deprecated services. */
export function validateStartModeSelections(
    selections: StartModeSelections,
    definitions: Record<string, { deprecated: boolean }>,
): void {
    for (const name of Object.keys(selections.serviceStartModes ?? {})) {
        if (!definitions[name] || definitions[name].deprecated)
            throw new Error(`Unknown service: ${name}`);
    }
}
