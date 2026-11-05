import { resolve } from 'node:path';
import { imageVersion } from '../domain/containers.js';
import type { ProfilePreview } from '../domain/environment-profile.js';
import { submit, type CliContext, type CliResult } from './context.js';
import {
    versionSourceLabels,
    type VersionSource,
} from '../domain/version-sources.js';

function previewText(preview: ProfilePreview) {
    const lines = preview.changes.map(
        (change) =>
            `${change.service} · ${change.field}: ${change.before} → ${change.after}`,
    );
    return [
        ...(lines.length ? lines : ['No configuration changes.']),
        ...preview.warnings.map((warning) => `Warning: ${warning}`),
    ].join('\n');
}

function pathArgument(context: CliContext) {
    const path = context.invocation.args[0];
    return path.startsWith('~/') ? path : resolve(path);
}

async function fileProfile(context: CliContext): Promise<CliResult> {
    const profile = await context.client.query(
        'environment.profileRead',
        { path: pathArgument(context) },
        context.signal,
        context.scope,
    );
    const versionsOnly = context.invocation.options['versions-only'] === true;
    const preview = await context.client.query(
        'environment.profilePreview',
        { profile, versionsOnly },
        context.signal,
        context.scope,
    );
    if (
        context.invocation.name === 'environment diff' ||
        !context.invocation.options.yes
    )
        return {
            data: preview,
            text:
                previewText(preview) +
                `\nPreview only. Use environment import <file>${versionsOnly ? ' --versions-only' : ''} --yes to save; then Apply or Start.`,
        };
    const result = await submit(context, 'environment.profileImport', {
        profile,
        versionsOnly,
        revision: preview.revision,
    });
    return {
        data: result.data,
        text: context.invocation.options.detach
            ? result.text
            : 'Environment configuration saved. Choose Apply or Start when ready.',
    };
}

async function cidevVersions(context: CliContext): Promise<CliResult> {
    const options = context.invocation.options;
    const versions = await context.client.query(
        'environment.cidevVersions',
        {
            ...(options.profile ? { profile: String(options.profile) } : {}),
            ...(options.region ? { region: String(options.region) } : {}),
        },
        context.signal,
        context.scope,
    );
    const preview = await context.client.query(
        'environment.profilePreview',
        { profile: versions.profile, versionsOnly: true },
        context.signal,
        context.scope,
    );
    const lines = [
        `CIDEV: ${versions.clusters} clusters, ${versions.runningTasks} running tasks, ${versions.matches.length} matched services.`,
        ...versions.matches.map(
            (match) =>
                `${match.service}: ${imageVersion(match.image)} → ${match.digest}`,
        ),
        ...[...versions.warnings, ...preview.warnings].map(
            (warning) => `Warning: ${warning}`,
        ),
    ];
    if (options.output) {
        const output = String(options.output);
        const exported = await submit(context, 'environment.profileExport', {
            path: output.startsWith('~/') ? output : resolve(output),
            force: options.force === true,
            profile: versions.profile,
        });
        lines.push(
            `Exported CIDEV versions to ${JSON.stringify(exported.data)}.`,
        );
    }
    if (options.yes) {
        await submit(context, 'environment.profileImport', {
            profile: versions.profile,
            versionsOnly: true,
            revision: preview.revision,
        });
        lines.push(
            'Version pins saved; enabled services, providers and scenarios preserved. Choose Apply or Start when ready.',
        );
    } else
        lines.push(
            'Preview only. Add --yes to save version pins; enabled services, providers and scenarios are preserved.',
        );
    return {
        data: {
            ...versions,
            changes: preview.changes,
            saved: options.yes === true,
        },
        text: lines.join('\n'),
    };
}

export async function profileCommand(context: CliContext): Promise<CliResult> {
    if (context.invocation.name === 'environment source')
        return sourceCommand(context);
    if (context.invocation.name === 'environment versions')
        return cidevVersions(context);
    if (context.invocation.name === 'environment export') {
        const result = await submit(context, 'environment.profileExport', {
            path: pathArgument(context),
            force: context.invocation.options.force === true,
        });
        return {
            data: result.data,
            text: context.invocation.options.detach
                ? result.text
                : JSON.stringify(result.data, null, 2),
        };
    }
    return fileProfile(context);
}

async function sourceCommand(context: CliContext): Promise<CliResult> {
    const source = context.invocation.args[0] as VersionSource;
    const current = await context.client.query(
        'configuration.snapshot',
        {},
        context.signal,
        context.scope,
    );
    const result = await submit(context, 'environment.profileImport', {
        profile: {
            format: 'chs-dev-environment',
            version: 1,
            createdAt: new Date().toISOString(),
            selections: { ...current.selections, versionSource: source },
        },
        versionsOnly: false,
        revision: current.revision,
    });
    return {
        data: result.data,
        text: context.invocation.options.detach
            ? result.text
            : `${versionSourceLabels[source]} selected for Service providers. Choose Apply or Start when ready.`,
    };
}
