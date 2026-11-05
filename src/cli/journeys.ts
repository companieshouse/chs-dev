import type { ProjectSelections } from '../domain/configuration.js';
import type {
    StackMeasurement,
    JourneyMeasurement,
} from '../domain/measurements.js';
import { submit, type CliContext, type CliResult } from './context.js';
import { ClientError } from '../protocol/types.js';
import { applyWithConfirmation } from './environment.js';
import { baselineLines, journeyLines } from './measurement-text.js';

interface SelectionsSnapshot {
    revision: string;
    selections: ProjectSelections;
}

function listText(result: {
    journeys: Array<{ name: string; services: string[]; lazy: string[] }>;
    invalid: Array<{ file: string; error: string }>;
    active?: string;
}) {
    return [
        ...(result.journeys.length
            ? result.journeys.map(
                  ({ name, services, lazy }) =>
                      `${name}${result.active === name ? ' (active)' : ''} - ${services.length} always start, ${lazy.length} lazy`,
              )
            : [
                  'No journeys found. Create one on the Journeys tab in the TUI or by hand.',
              ]),
        ...result.invalid.map(({ file, error }) => `Invalid ${file}: ${error}`),
    ].join('\n');
}

async function list(context: CliContext): Promise<CliResult> {
    const result = await context.client.query(
        'journey.list',
        {},
        context.signal,
        context.scope,
    );
    return { data: result, text: listText(result) };
}

function membershipUnchanged(journey: JourneyMeasurement) {
    return journey.notInJourney.length === 0 && journey.added.length === 0;
}

async function preview(
    context: CliContext,
    name: string,
): Promise<StackMeasurement> {
    return context.client.query(
        'environment.measure',
        { journey: name },
        context.signal,
        context.scope,
    );
}

function previewText(measurement: StackMeasurement): string[] {
    if (!measurement.journey) return [];
    return [
        ...baselineLines(measurement.baseline),
        ...journeyLines(measurement.journey),
    ];
}

async function saveSelections(
    context: CliContext,
    snapshot: SelectionsSnapshot,
    update: { journey: string; services?: string[] },
) {
    await submit(context, 'environment.profileImport', {
        profile: {
            format: 'chs-dev-environment',
            version: 1,
            createdAt: new Date().toISOString(),
            selections: {
                ...snapshot.selections,
                services: update.services ?? snapshot.selections.services,
                journey: update.journey,
            },
        },
        versionsOnly: false,
        revision: snapshot.revision,
    });
}

async function start(context: CliContext): Promise<CliResult> {
    const name = context.invocation.args[0];
    const measurement = await preview(context, name);
    const journey = measurement.journey;
    if (!journey)
        throw new ClientError({
            code: 'INVALID_REQUEST',
            message: 'Measurement did not include the journey.',
        });
    const snapshot: SelectionsSnapshot = await context.client.query(
        'configuration.snapshot',
        {},
        context.signal,
        context.scope,
    );
    if (membershipUnchanged(journey)) {
        if (snapshot.selections.journey === name) {
            return {
                data: measurement,
                text: `Journey ${name} is already selected; membership is unchanged, so nothing starts or stops.`,
            };
        }
        await saveSelections(context, snapshot, { journey: name });
        return {
            data: measurement,
            text: [
                ...previewText(measurement),
                `Journey ${name} selected; membership is unchanged, so nothing starts or stops.`,
            ].join('\n'),
        };
    }
    await saveSelections(context, snapshot, {
        journey: name,
        services: journey.started,
    });
    const applied = await applyWithConfirmation(context);
    return {
        data: { ...measurement, applied: applied.data },
        text: [
            ...previewText(measurement),
            `Saved journey ${name}. Applying: ${journey.added.length} to start, ${journey.notInJourney.length} to stop.`,
            applied.text ?? '',
        ]
            .filter(Boolean)
            .join('\n'),
    };
}

export async function journeyCommand(context: CliContext): Promise<CliResult> {
    if (context.invocation.name === 'journey list') return list(context);
    return start(context);
}
