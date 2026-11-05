import { useState } from 'react';
import type { ServiceDetails, ServiceEdit } from '../../domain/services.js';
import { imageVersion } from '../../domain/containers.js';
import { versionImage } from '../../domain/image-versions.js';
import {
    versionSources,
    versionSourceLabels,
    type VersionSource,
} from '../../domain/version-sources.js';

type Selection = VersionSource | 'default' | 'custom';

export function useServiceVersions(details?: ServiceDetails, image?: string) {
    const initial = initialSelection(details);
    const [selection, setSelection] = useState<Selection>(initial);
    const [pinned, setPinned] = useState(details?.image ?? '');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [inputOpen, setInputOpen] = useState(false);
    const changed = selectionChanged({ selection, initial, pinned }, details);
    const label = selectionLabel(selection, pinned, details);
    return {
        changed,
        pickerOpen,
        inputOpen,
        pinned,
        selection,
        label: `${label}${!changed && details?.versionLabel ? ` · ${details.versionLabel}` : ''}`,
        choices: sourceChoices(details),
        open: () => setPickerOpen(true),
        closePicker: () => setPickerOpen(false),
        closeInput: () => setInputOpen(false),
        choose: async (value: string | undefined) => {
            if (value === 'custom') setInputOpen(true);
            else setSelection(value as Selection);
        },
        saveInput: async (value: string | undefined) => {
            if (!value) {
                setSelection('default');
                return;
            }
            if (!image) throw new Error('This service has no container image.');
            setPinned(versionImage(value, image));
            setSelection('custom');
        },
        edit: () => selectionEdit(changed, selection, pinned),
    };
}

function initialSelection(details?: ServiceDetails): Selection {
    return details?.imagePinned
        ? 'custom'
        : (details?.versionSourceOverride ?? 'default');
}

function selectionChanged(
    state: { selection: Selection; initial: Selection; pinned: string },
    details?: ServiceDetails,
) {
    return (
        state.selection !== state.initial ||
        (state.selection === 'custom' && state.pinned !== details?.image)
    );
}

function selectionLabel(
    selection: Selection,
    pinned: string,
    details?: ServiceDetails,
) {
    if (selection === 'custom') return `Version: ${imageVersion(pinned)}`;
    if (selection === 'default')
        return `Versions: ${versionSourceLabels[details?.defaultVersionSource ?? 'cidev']} (environment default)`;
    return `Versions: ${versionSourceLabels[selection]}`;
}

function sourceChoices(details?: ServiceDetails) {
    const sources = details?.environmentVersionsAvailable
        ? versionSources
        : (['latest', 'compose'] as const);
    return [
        {
            value: 'default',
            label: `Environment default (${versionSourceLabels[details?.defaultVersionSource ?? 'cidev']})`,
        },
        ...sources.map((source) => ({
            value: source,
            label: versionSourceLabels[source],
        })),
        { value: 'custom', label: 'Specific version…' },
    ];
}

function selectionEdit(
    changed: boolean,
    selection: Selection,
    pinned: string,
): Pick<ServiceEdit, 'image' | 'versionSource'> {
    if (!changed) return {};
    if (selection === 'custom') return { image: pinned, versionSource: null };
    return {
        image: null,
        versionSource: selection === 'default' ? null : selection,
    };
}
