import type { ServiceDefinition } from './services.js';
import {
    versionSelections,
    type VersionSelections,
} from './version-sources.js';

export interface ImageSelections extends VersionSelections {
    serviceImages?: Record<string, string>;
}

export function validImage(reference: unknown): reference is string {
    return (
        typeof reference === 'string' &&
        reference.length <= 1024 &&
        /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/.test(
            reference,
        ) &&
        !reference.includes('//') &&
        !reference.endsWith('/')
    );
}

export function imageSelections(
    value: Record<string, unknown>,
): ImageSelections {
    const sources = versionSelections(value);
    if (value.serviceImages === undefined) return sources;
    const images = value.serviceImages;
    if (!images || typeof images !== 'object' || Array.isArray(images))
        throw new Error('Invalid serviceImages in .chs-dev.yaml');
    const entries = Object.entries(images);
    if (entries.length > 500) throw new Error('Too many service image pins.');
    for (const [name, image] of entries) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || !validImage(image))
            throw new Error(`Invalid image pin for ${name}.`);
    }
    return { ...sources, serviceImages: Object.fromEntries(entries) };
}

export function validateImageSelections(
    selections: ImageSelections,
    definitions: Record<
        string,
        Pick<ServiceDefinition, 'deprecated' | 'image'>
    >,
) {
    const names = new Set([
        ...Object.keys(selections.serviceVersionSources ?? {}),
        ...Object.keys(selections.serviceImages ?? {}),
    ]);
    for (const name of names) {
        if (
            !definitions[name] ||
            definitions[name].deprecated ||
            !definitions[name].image
        )
            throw new Error(`Cannot pin an image for ${name}.`);
    }
}

export function imageRepository(image: string): string {
    const reference = image.split('@')[0];
    const colon = reference.lastIndexOf(':');
    return colon > reference.lastIndexOf('/')
        ? reference.slice(0, colon)
        : reference;
}

export function versionImage(value: string, image: string): string {
    const repository = imageRepository(
        image.replace(/\$\{[^}]*\}/g, 'placeholder'),
    );
    const trimmed = value.trim();
    const reference = trimmed.startsWith('sha256:')
        ? `${repository}@${trimmed}`
        : /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(trimmed)
          ? `${repository}:${trimmed}`
          : trimmed;
    if (!validImage(reference))
        throw new Error(
            'Enter a version tag, SHA256 digest or full image reference.',
        );
    return reference;
}
