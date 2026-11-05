import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSeq, type Document } from 'yaml';
import {
    projectSelections,
    editSelections,
    selectionKeys,
    type LegacyEdit,
} from '../domain/configuration.js';
import type { ServiceGroup } from '../domain/services.js';
import {
    loadDocument,
    requireRevision,
    writeAtomically,
} from './service-configuration.js';

async function readState(path: string) {
    return readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
}

export async function configurationSnapshot(directory: string) {
    const original = await readState(join(directory, '.chs-dev.yaml'));
    return {
        revision: createHash('sha256')
            .update(original ?? '{}\n')
            .digest('hex'),
        selections: projectSelections(loadDocument(original).toJS()),
    };
}

export async function saveLegacyChanges(
    directory: string,
    groups: ServiceGroup[],
    edit: LegacyEdit,
    revision: string,
    beforeCommit?: (revision: string) => Promise<void>,
) {
    const path = join(directory, '.chs-dev.yaml');
    const read = () => readState(path);
    const original = await read();
    requireRevision(original, revision);
    const document = loadDocument(original);
    const next = editSelections(
        projectSelections(document.toJS()),
        edit,
        groups,
    );
    for (const key of selectionKeys) updateSelection(document, key, next[key]);
    if (edit.topic === 'development' && next.serviceProviders) {
        for (const name of edit.names)
            document.setIn(
                ['serviceProviders', name],
                next.serviceProviders[name],
            );
    }
    const nextRevision = createHash('sha256')
        .update(document.toString())
        .digest('hex');
    await beforeCommit?.(nextRevision);
    await writeAtomically(path, read, original, document);
    return configurationSnapshot(directory);
}
function updateSelection(document: Document, key: string, names: string[]) {
    const existing = document.get(key, true);
    if (!isSeq(existing)) {
        document.set(key, names);
        return;
    }
    existing.items = names.map(
        (name) =>
            existing.items.find(
                (item) => document.createNode(item).toJSON() === name,
            ) ?? document.createNode(name),
    );
}
