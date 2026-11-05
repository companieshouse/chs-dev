import type { Document } from 'yaml';
import type { ServiceDefinition } from '../domain/services.js';
import { validateProvider, type ServiceProvider } from '../domain/providers.js';

export interface ProviderEdit {
    name: string;
    development: boolean;
    provider?: ServiceProvider;
    mockScenario?: string;
}

export function validateProviderEdit(
    edit: ProviderEdit,
    definition: ServiceDefinition,
): void {
    const provider =
        edit.provider ?? (edit.development ? 'development' : 'service');
    validateProvider(edit.name, provider, definition, edit.mockScenario);
    if (edit.mockScenario && provider !== 'mock')
        throw new Error(
            'Choose the mock provider before selecting a mock scenario.',
        );
    if (edit.provider && edit.development !== (edit.provider === 'development'))
        throw new Error('Provider and development selections disagree.');
}

export function applyProviderEdit(
    document: Document,
    edit: ProviderEdit,
): void {
    const provider =
        edit.provider ?? (edit.development ? 'development' : 'service');
    if (edit.provider || document.hasIn(['serviceProviders', edit.name]))
        document.setIn(['serviceProviders', edit.name], provider);
    if (edit.mockScenario)
        document.setIn(['mockScenarios', edit.name], edit.mockScenario);
}
