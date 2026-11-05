import { useState } from 'react';
import type {
    ServiceDefinition,
    ServiceDetails,
} from '../../domain/services.js';
import {
    detailsProvider,
    mockScenarioFor,
    type ServiceProvider,
    type MockScenario,
} from '../../domain/providers.js';

function providerChoices(definition?: ServiceDefinition): ServiceProvider[] {
    const choices: ServiceProvider[] = ['service'];
    if (definition?.development) choices.push('development');
    if (definition?.mock) choices.push('mock');
    return choices;
}

function selectionChanged(
    provider: ServiceProvider,
    initial: ServiceProvider,
    scenario?: string,
    originalScenario?: string,
) {
    return (
        provider !== initial ||
        (provider === 'mock' && scenario !== originalScenario)
    );
}

function nextScenario(scenarios: MockScenario[], current?: string) {
    return scenarios[
        (scenarios.findIndex((item) => item.name === current) + 1) %
            scenarios.length
    ]?.name;
}

export function useProviderSelection(
    details?: ServiceDetails,
    definition?: ServiceDefinition,
) {
    const initial = detailsProvider(details, definition);
    const [provider, setProvider] = useState(initial);
    const originalScenario = mockScenarioFor(details, definition);
    const [scenario, setScenario] = useState(originalScenario);
    const choices = providerChoices(definition);
    const scenarios = definition?.mock?.scenarios ?? [];
    const changed = selectionChanged(
        provider,
        initial,
        scenario,
        originalScenario,
    );
    return {
        provider,
        scenario,
        description: scenarios.find((item) => item.name === scenario)
            ?.description,
        fixed: choices.length === 1,
        changed,
        cycleProvider: () =>
            setProvider(
                (current) =>
                    choices[(choices.indexOf(current) + 1) % choices.length],
            ),
        cycleScenario: () =>
            setScenario((current) => nextScenario(scenarios, current)),
    };
}
