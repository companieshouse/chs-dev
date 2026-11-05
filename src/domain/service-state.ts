import {
    serviceDefinitions,
    serviceMode,
    type ServiceGroup,
    type ServiceDetails,
} from './services.js';
import {
    providerSelections,
    selectedProvider,
    validateProviderSelections,
    type ProviderSelections,
} from './providers.js';
import {
    imageSelections,
    validateImageSelections,
    type ImageSelections,
} from './image-versions.js';
import { environmentVersioned } from './version-sources.js';
import {
    effectiveStartModes,
    type InventoryEntry,
    type StartModeFlags,
} from './live.js';
import {
    startModeSelections,
    validateStartModeSelections,
    type StartModeSelections,
} from './start-modes.js';

/** Parsed configuration state with the enabled closure over the catalogue. */
interface SelectionState {
    raw: Record<string, unknown>;
    modules: Set<string>;
    requested: Set<string>;
    development: Set<string>;
    excluded: Set<string>;
    definitions: ReturnType<typeof serviceDefinitions>;
    providers: ProviderSelections;
    selections: ProviderSelections & { servicesWithLiveUpdate: string[] };
    startModes: StartModeSelections;
    enabled: Set<string>;
}

function selectionState(
    value: unknown,
    groups: ServiceGroup[],
): SelectionState {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected a state mapping');
    const state = value as Record<string, unknown>;
    const names = (key: string): Set<string> => {
        const value = state[key] ?? [];
        if (
            !Array.isArray(value) ||
            value.some((item) => typeof item !== 'string')
        )
            throw new Error(`Invalid ${key} in .chs-dev.yaml`);
        return new Set(value);
    };
    const modules = names('modules');
    const requested = names('services');
    const development = names('servicesWithLiveUpdate');
    const excluded = new Set([
        ...names('excludedServices'),
        ...names('excludedFiles'),
    ]);
    const definitions = serviceDefinitions(groups);
    const providers = providerSelections(state);
    const startModes = startModeSelections(state);
    validateStartModeSelections(startModes, definitions);
    validateImageSelections(imageSelections(state), definitions);
    const selections = {
        ...providers,
        servicesWithLiveUpdate: [...development],
    };
    validateProviderSelections(providers, definitions);
    const enabled = new Set<string>();
    const visit = (name: string) => {
        if (
            enabled.has(name) ||
            excluded.has(name) ||
            definitions[name]?.deprecated
        )
            return;
        enabled.add(name);
        if (selectedProvider(name, selections) === 'mock') return;
        for (const dependency of definitions[name]?.dependencies ?? [])
            visit(dependency);
    };
    for (const [name, definition] of Object.entries(definitions)) {
        if (
            requested.has(name) ||
            modules.has(definition.module) ||
            definition.base
        )
            visit(name);
    }
    return {
        raw: state,
        modules,
        requested,
        development,
        excluded,
        definitions,
        providers,
        selections,
        startModes,
        enabled,
    };
}

export function resolveServiceState(
    value: unknown,
    groups: ServiceGroup[],
): Record<string, ServiceDetails> {
    const state = selectionState(value, groups);
    const modes = stateStartModeFlags(state, [...state.enabled]);
    return Object.fromEntries(
        groups.flatMap((group) =>
            group.services.map((name) => [
                name,
                {
                    ...resolvedDetails(name, state, modes.get(name)),
                    ...imageDetails(name, group, imageSelections(state.raw)),
                },
            ]),
        ),
    );
}

/** Effective start-mode flags for the enabled closure of a parsed state. */
export function stateStartModeFlags(
    state: SelectionState,
    names: readonly string[],
    learned: ReadonlySet<string> = new Set(),
): Map<string, StartModeFlags> {
    const dependencies = new Map(
        names.map((name) => [
            name,
            selectedProvider(name, state.selections) === 'mock'
                ? []
                : (state.definitions[name]?.dependencies ?? []).filter(
                      (dependency) => state.enabled.has(dependency),
                  ),
        ]),
    );
    const modes = effectiveStartModes(
        names.map((name) => {
            const definition = state.definitions[name];
            const mode = serviceMode(
                name,
                state.development.has(name),
                state.providers.serviceProviders?.[name],
            );
            return {
                service: name,
                pinned:
                    state.requested.has(name) ||
                    state.modules.has(definition.module) ||
                    definition.base,
                base: definition.base,
                development: mode === 'Development',
                mock: selectedProvider(name, state.selections) === 'mock',
                ...(definition.startMode
                    ? { label: definition.startMode }
                    : {}),
                ...(state.startModes.serviceStartModes?.[name]
                    ? {
                          override: state.startModes.serviceStartModes[name],
                      }
                    : {}),
                explicitLazy: false,
                learned: learned.has(name),
            };
        }),
        dependencies,
    );
    return modes;
}

/**
 * Inventory entries for the enabled services, matching the project
 * resolver's entry shape so revision snapshots compare equal to resolutions.
 */
export function resolveStateInventory(
    value: unknown,
    groups: ServiceGroup[],
    learned?: ReadonlySet<string>,
): InventoryEntry[] {
    const state = selectionState(value, groups);
    const names = groups
        .flatMap((group) => group.services)
        .filter((name) => state.enabled.has(name));
    const modes = stateStartModeFlags(state, names, learned);
    return names.map((name) => stateEntry(name, state, modes.get(name)));
}

function stateEntry(
    name: string,
    state: SelectionState,
    flags: StartModeFlags | undefined,
): InventoryEntry {
    const definition = state.definitions[name];
    const mock = selectedProvider(name, state.selections) === 'mock';
    return {
        service: name,
        mode: serviceMode(
            name,
            state.development.has(name),
            state.providers.serviceProviders?.[name],
        ) as InventoryEntry['mode'],
        ...(mock
            ? {
                  mockScenario:
                      state.providers.mockScenarios?.[name] ??
                      definition.mock!.defaultScenario,
              }
            : {}),
        ...flags,
    };
}

function imageDetails(
    name: string,
    group: ServiceGroup,
    selections: ImageSelections,
): Partial<ServiceDetails> {
    const definition = group.definitions?.[name];
    if (!definition?.image) return {};
    const available =
        group.name !== 'Infrastructure' && environmentVersioned(definition);
    const defaultSource = available
        ? (selections.versionSource ?? 'cidev')
        : 'compose';
    const override = selections.serviceVersionSources?.[name];
    return {
        versionSource: override ?? defaultSource,
        defaultVersionSource: defaultSource,
        environmentVersionsAvailable: available,
        versionSourceOverride: override,
        ...pinnedImageDetails(selections.serviceImages?.[name]),
    };
}

function pinnedImageDetails(image?: string): Partial<ServiceDetails> {
    return image ? { image, imagePinned: true } : {};
}

/** Start-mode fields for the details view: override, label and effective mode. */
function startModeDetails(
    name: string,
    state: SelectionState,
    definition: SelectionState['definitions'][string] | undefined,
    flags?: StartModeFlags,
): Partial<ServiceDetails> {
    return {
        ...(state.startModes.serviceStartModes?.[name]
            ? { startModeOverride: state.startModes.serviceStartModes[name] }
            : {}),
        ...(definition?.startMode
            ? { startModeLabel: definition.startMode }
            : {}),
        ...(state.enabled.has(name)
            ? {
                  effectiveStartMode: flags?.lazy
                      ? ('lazy' as const)
                      : ('always' as const),
                  startModeSource: startModeSource(name, state, flags),
              }
            : {}),
    };
}

/** Source label for the details view, covering eager outcomes too. */
function startModeSource(
    name: string,
    state: SelectionState,
    flags?: StartModeFlags,
): ServiceDetails['startModeSource'] {
    if (flags?.startModeSource) return flags.startModeSource;
    if (state.startModes.serviceStartModes?.[name]) return 'override';
    const definition = state.definitions[name];
    if (
        state.requested.has(name) ||
        state.modules.has(definition.module) ||
        definition.base
    )
        return 'manual';
    if (definition.startMode) return 'label';
    return 'default';
}

function resolvedDetails(
    name: string,
    state: SelectionState,
    flags?: StartModeFlags,
): ServiceDetails {
    const definition = state.definitions[name];
    const details: ServiceDetails = {
        enabled: state.enabled.has(name) ? 'Yes' : 'No',
        mode: serviceMode(
            name,
            state.development.has(name),
            state.providers.serviceProviders?.[name],
        ),
        ...startModeDetails(name, state, definition, flags),
    };
    if (state.providers.serviceProviders?.[name] === 'mock')
        details.mockScenario =
            state.providers.mockScenarios?.[name] ??
            state.definitions[name].mock!.defaultScenario;
    else if (state.providers.mockScenarios?.[name])
        details.savedMockScenario = state.providers.mockScenarios[name];
    if (state.excluded.has(name)) details.excluded = true;
    return details;
}
