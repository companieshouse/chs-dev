import assert from 'node:assert/strict';
import { daemonFixture } from '../daemon-fixture.js';
import {
    profileChanges,
    profileSelections,
    validateEnvironmentSelections,
    type EnvironmentProfile,
} from '../../src/domain/environment-profile.js';
import type { BackendSession } from '../../src/application/ports.js';
import { resolveServiceState } from '../../src/domain/service-state.js';

export async function profileFixture() {
    const files = new Map<string, EnvironmentProfile>();
    let reads = 0;
    const configure = (backend: BackendSession) => {
        const current = () => fixture.stores.get(backend.project.directory)!;
        const snapshot = async (): Promise<EnvironmentProfile> => ({
            format: 'chs-dev-environment',
            version: 1,
            createdAt: '2026-10-03T00:00:00Z',
            selections: structuredClone(current().selections),
        });
        backend.profiles = {
            snapshot,
            read: async (path) => {
                const profile = files.get(path);
                if (!profile) throw new Error('Environment file missing');
                return profile;
            },
            export: async (path, force, profile) => {
                if (files.has(path) && !force) throw new Error('File exists');
                files.set(path, profile ?? (await snapshot()));
                return { path, warnings: [] };
            },
            preview: async (profile, versionsOnly) => {
                const next = profileSelections(
                    current().selections,
                    profile,
                    !!versionsOnly,
                );
                validateEnvironmentSelections(next, backend.groups);
                return {
                    profile,
                    revision: `revision-${current().revision}`,
                    changes: profileChanges(
                        current().selections,
                        next,
                        backend.groups,
                    ),
                    warnings: [],
                };
            },
            save: async (options) => {
                assert.equal(
                    options.revision,
                    `revision-${current().revision}`,
                );
                const next = profileSelections(
                    current().selections,
                    options.profile,
                    options.versionsOnly,
                );
                validateEnvironmentSelections(next, backend.groups);
                current().selections = next;
                current().enabled =
                    resolveServiceState(next, backend.groups).api.enabled ===
                    'Yes';
                current().revision++;
                return {
                    selections: next,
                    revision: `revision-${current().revision}`,
                };
            },
        };
        backend.cidevVersions = async (options) => {
            reads++;
            assert.equal(
                options.profile ?? 'development-eu-west-2',
                'development-eu-west-2',
            );
            const digest = `sha256:${'a'.repeat(64)}`;
            const pinnedImage = `registry.example/api@${digest}`;
            const profile = await snapshot();
            return {
                profile: {
                    ...profile,
                    selections: {
                        ...profile.selections,
                        services: [],
                        serviceProviders: {},
                        mockScenarios: {},
                        serviceImages: { api: pinnedImage },
                    },
                },
                matches: [
                    {
                        service: 'api',
                        cluster: 'utility-cidev-cluster',
                        ecsService: 'cidev-api',
                        container: 'api',
                        image: 'registry.example/api:2.0.0',
                        digest,
                        pinnedImage,
                        architecture: 'x86_64',
                    },
                ],
                ambiguous: [],
                warnings: [],
                clusters: 1,
                runningTasks: 2,
            };
        };
        backend.versionSnapshot = async (source) => {
            assert.equal(source, 'cidev');
            const result = await backend.cidevVersions!({});
            return {
                ...result,
                images: result.profile.selections.serviceImages!,
                retrievedAt: new Date().toISOString(),
            };
        };
    };
    const fixture: Awaited<ReturnType<typeof daemonFixture>> =
        await daemonFixture(undefined, undefined, {
            configure,
            image: '123456789012.dkr.ecr.eu-west-2.amazonaws.com/api:latest',
            mock: {
                defaultScenario: 'success',
                scenarios: [
                    { name: 'success', description: 'Normal' },
                    { name: 'error', description: 'Unavailable' },
                ],
            },
        });
    return Object.assign(fixture, { files, reads: () => reads });
}
