import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
    completionEvents,
    type OperationCompletion,
    type SafeTelemetryEvent,
    type Telemetry,
} from '../domain/telemetry.js';

export interface TelemetryConfiguration {
    enabled: boolean;
    endpoint: string;
    installId: string;
}
export type TelemetrySender = (
    endpoint: URL,
    events: readonly SafeTelemetryEvent[],
    signal: AbortSignal,
) => Promise<void>;

const disabled: Telemetry = { record() {}, close() {} };
const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An inherited endpoint alone never enables collection; no state files are read. */
export function telemetryConfiguration(
    env: NodeJS.ProcessEnv = process.env,
): TelemetryConfiguration | undefined {
    if (env.CHS_DEV_TELEMETRY !== 'on' || env.DO_NOT_TRACK === '1')
        return undefined;
    return {
        enabled: true,
        endpoint: env.CHS_DEV_TELEMETRY_ENDPOINT ?? '',
        installId: env.CHS_DEV_TELEMETRY_INSTALL_ID ?? '',
    };
}

function acceptedEndpoint(endpoint: URL): boolean {
    if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
    )
        return false;
    if (endpoint.pathname !== '/events') return false;
    if (endpoint.protocol === 'https:') return true;
    return (
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    );
}

function safeEndpoint(
    configuration: TelemetryConfiguration | undefined,
): URL | undefined {
    if (!configuration?.enabled || !uuid.test(configuration.installId))
        return undefined;
    try {
        const endpoint = new URL(configuration.endpoint);
        return acceptedEndpoint(endpoint) ? endpoint : undefined;
    } catch {
        return undefined;
    }
}

/** Only validated non-secret startup inputs may enter a login-service file. */
export function telemetryEnvironment(
    env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
    const configuration = telemetryConfiguration(env);
    const endpoint = safeEndpoint(configuration);
    if (!endpoint) return { CHS_DEV_TELEMETRY: 'off' };
    return {
        CHS_DEV_TELEMETRY: 'on',
        CHS_DEV_TELEMETRY_ENDPOINT: endpoint.href,
        CHS_DEV_TELEMETRY_INSTALL_ID: configuration!.installId,
    };
}

/** One attempt, no redirects, no response bodies or provider diagnostics retained. */
const sendTelemetry: TelemetrySender = (endpoint, events, signal) =>
    new Promise((resolve, reject) => {
        const body = JSON.stringify(events);
        const request = (
            endpoint.protocol === 'https:' ? httpsRequest : httpRequest
        )(
            endpoint,
            {
                method: 'POST',
                signal,
                agent: false,
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(body),
                },
            },
            (response) => {
                response.destroy();
                if (response.statusCode === 202) resolve();
                else reject(new Error('Telemetry request rejected.'));
            },
        );
        request.once('error', () =>
            reject(new Error('Telemetry request failed.')),
        );
        request.end(body);
    });

class BufferedTelemetry implements Telemetry {
    private queue: SafeTelemetryEvent[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private active?: AbortController;
    private closed = false;
    constructor(
        private readonly endpoint: URL,
        private readonly installId: string,
        private readonly send: TelemetrySender,
    ) {}

    record(completion: OperationCompletion): void {
        if (this.closed) return;
        const available = 50 - this.queue.length;
        this.queue.push(
            ...completionEvents(completion, this.installId).slice(0, available),
        );
        this.schedule();
    }

    private schedule(): void {
        if (this.closed || this.timer || this.active || !this.queue.length)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, 1000);
        this.timer.unref();
    }

    private async flush(): Promise<void> {
        if (this.closed) return;
        const events = this.queue.splice(0, 20);
        const active = new AbortController();
        this.active = active;
        const timeout = setTimeout(() => active.abort(), 1000);
        try {
            await this.send(this.endpoint, events, active.signal);
        } catch {
            /* Telemetry is lossy and must never affect commands. */
        } finally {
            clearTimeout(timeout);
            this.active = undefined;
            this.schedule();
        }
    }

    close(): void {
        this.closed = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.queue = [];
        this.active?.abort();
    }
}

export function createTelemetry(
    configuration?: TelemetryConfiguration,
    send: TelemetrySender = sendTelemetry,
): Telemetry {
    const endpoint = safeEndpoint(configuration);
    return endpoint
        ? new BufferedTelemetry(endpoint, configuration!.installId, send)
        : disabled;
}
