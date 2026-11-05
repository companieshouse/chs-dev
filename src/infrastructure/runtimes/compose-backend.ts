import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
    DockerLiveRuntime,
    type DockerLiveDependencies,
} from '../live-runtime.js';
import { optionalJson } from '../state-files.js';
import { projectStateDirectory } from '../settings.js';
import { LiveFailure, type PreparedProject } from '../../domain/live.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';

const transition =
    'Use the pre-upgrade chs-dev build to Stop environment with the old backend selected, then stop that daemon and restart this version. Data volumes are preserved.';

function checkLegacyMarker(marker: unknown): void {
    if (marker === undefined) return;
    if (!marker || typeof marker !== 'object' || Array.isArray(marker))
        throw new LiveFailure(
            `Invalid legacy environment ownership. ${transition}`,
            'blocked',
        );
    const backend = (marker as { backend?: unknown }).backend;
    if (backend === null || backend === 'docker/compose') return;
    throw new LiveFailure(
        `Legacy environment ownership has not been released. ${transition}`,
        'blocked',
    );
}

/** Read-only transition checks; all execution is delegated to Compose. */
export class ComposeBackend extends DockerLiveRuntime {
    constructor(
        private readonly connection: DockerLiveDependencies,
        private readonly state = projectStateDirectory(connection.directory),
    ) {
        super(connection, {
            directory: join(state, 'operations'),
            read: (path) => readFile(path, 'utf8'),
        });
    }
    private async checkLegacy(context: OperationContext) {
        context.signal?.throwIfAborted();
        let marker: unknown;
        try {
            marker = await optionalJson(
                join(this.state, 'active-backend.json'),
            );
        } catch {
            throw new LiveFailure(
                `Cannot read legacy environment ownership. ${transition}`,
                'blocked',
            );
        }
        checkLegacyMarker(marker);
        const directory = await this.connection.realpath(
            this.connection.directory,
        );
        // This label is fixed by the retired native backend; include stopped containers.
        const namespace = `chs-native-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`;
        const result = await this.connection.execute({
            command: 'docker',
            args: [
                'ps',
                '--all',
                '--quiet',
                '--filter',
                `label=chs.dev.project=${namespace}`,
                '--filter',
                'label=chs.dev.backend=native',
            ],
            cwd: this.connection.directory,
            env: await this.connection.environment.resolve([], context.signal),
            signal: context.signal,
            captureStdout: true,
            privateOutput: true,
        });
        context.signal?.throwIfAborted();
        if (result.code !== 0)
            throw new LiveFailure(
                'Cannot check legacy native Docker containers. Check Docker availability and retry.',
                'blocked',
            );
        if (result.stdout.trim())
            throw new LiveFailure(
                `Native containers still exist for this checkout. ${transition}`,
                'blocked',
            );
    }
    override async startApplied(service: string, context: OperationContext) {
        await this.checkLegacy(context);
        return super.startApplied(service, context);
    }
    override async apply(project: PreparedProject, context: OperationContext) {
        await this.checkLegacy(context);
        return super.apply(project, context);
    }
    override async reload(
        project: PreparedProject,
        services: readonly string[],
        context: OperationContext,
    ) {
        await this.checkLegacy(context);
        return super.reload(project, services, context);
    }
}
