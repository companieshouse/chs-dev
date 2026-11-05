// Shared with the telemetry server: keep this file free of imports.
export const schemaVersion = 1;

export const eventTypes = [
    'service-toggled',
    'provider-changed',
    'journey-selected',
    'command-completed',
    'error-occurred',
] as const;
export type TelemetryEventType = (typeof eventTypes)[number];

export type TelemetryEvent = {
    schemaVersion: typeof schemaVersion;
    installId: string;
    type: TelemetryEventType;
    timestamp: string;
    provider?: 'service' | 'development' | 'mock';
    version?: string;
    imageId?: string;
    commitId?: string;
    chsDevVersion?: string;
    os?: string;
    arch?: string;
    dockerVersion?: string;
    composeVersion?: string;
    journey?: string;
    service?: string;
    enabled?: boolean;
    command?: string;
    durationMs?: number;
    exitCode?: number;
    errorCode?: string;
    message?: string;
    environment?: Record<string, string>;
};

export type ValidationResult =
    { ok: true; event: TelemetryEvent } | { ok: false; error: string };

type FieldCheck = (value: unknown) => boolean;

const text =
    (max: number): FieldCheck =>
    (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= max &&
        !value.includes('\0');
const count: FieldCheck = (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isoTimestamp: FieldCheck = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value));
const isRecord: FieldCheck = (value) =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stringMap: FieldCheck = (value) =>
    isRecord(value) &&
    Object.entries(value as Record<string, unknown>).every(
        ([name, entry]) =>
            name.length > 0 && name.length <= 256 && text(65536)(entry),
    );

const fieldChecks: Record<string, FieldCheck> = {
    schemaVersion: (value) => value === schemaVersion,
    installId: text(64),
    type: (value) => eventTypes.includes(value as TelemetryEventType),
    timestamp: isoTimestamp,
    provider: (value) =>
        ['service', 'development', 'mock'].includes(String(value)),
    version: text(128),
    imageId: text(256),
    commitId: text(64),
    chsDevVersion: text(64),
    os: text(64),
    arch: text(64),
    dockerVersion: text(64),
    composeVersion: text(64),
    journey: text(128),
    service: text(128),
    enabled: (value) => typeof value === 'boolean',
    command: text(128),
    durationMs: count,
    exitCode: (value) => typeof value === 'number' && Number.isInteger(value),
    errorCode: text(128),
    message: text(2048),
    environment: stringMap,
};

const envelope = ['schemaVersion', 'installId', 'type', 'timestamp'];
const platform = [
    'chsDevVersion',
    'os',
    'arch',
    'dockerVersion',
    'composeVersion',
];

interface EventSchema {
    required: readonly string[];
    optional: readonly string[];
}

export const eventSchemas: Record<TelemetryEventType, EventSchema> = {
    'service-toggled': {
        required: [...envelope, 'service', 'enabled'],
        optional: [...platform, 'provider', 'version', 'imageId', 'commitId'],
    },
    'provider-changed': {
        required: [...envelope, 'service', 'provider'],
        optional: [...platform, 'version', 'imageId', 'commitId'],
    },
    'journey-selected': {
        required: [...envelope, 'journey'],
        optional: platform,
    },
    'command-completed': {
        required: [...envelope, 'command', 'durationMs', 'exitCode'],
        optional: [...platform, 'journey'],
    },
    'error-occurred': {
        required: [...envelope, 'errorCode', 'message'],
        optional: [
            ...platform,
            'command',
            'journey',
            'service',
            'provider',
            'version',
            'imageId',
            'commitId',
            'environment',
        ],
    },
};

function failure(error: string): ValidationResult {
    return { ok: false, error };
}

function schemaFor(type: unknown): EventSchema | undefined {
    if (typeof type !== 'string') return undefined;
    return eventSchemas[type as TelemetryEventType];
}

function firstFieldError(
    record: Record<string, unknown>,
    schema: EventSchema,
): string | undefined {
    const allowed = new Set([...schema.required, ...schema.optional]);
    const unknown = Object.keys(record).find((name) => !allowed.has(name));
    if (unknown) return `Unknown field: ${unknown}`;

    const missing = schema.required.find((name) => !(name in record));
    if (missing) return `Missing field: ${missing}`;

    const invalid = Object.keys(record).find(
        (name) => !fieldChecks[name](record[name]),
    );
    if (invalid) return `Invalid field: ${invalid}`;
    return undefined;
}

export function validateEvent(input: unknown): ValidationResult {
    if (!isRecord(input)) return failure('Expected an object.');
    const record = input as Record<string, unknown>;

    if (record.schemaVersion !== schemaVersion)
        return failure('Unsupported schemaVersion.');

    const schema = schemaFor(record.type);
    if (!schema) return failure('Unknown event type.');

    const error = firstFieldError(record, schema);
    if (error) return failure(error);
    return { ok: true, event: record as unknown as TelemetryEvent };
}
