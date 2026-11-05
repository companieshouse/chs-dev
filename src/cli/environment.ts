import { createInterface } from 'node:readline/promises';
import { ClientError } from '../protocol/types.js';
import { submit, type CliContext, type CliResult } from './context.js';

function startCommand(name: string) {
    return name === 'apply' || name === 'legacy up'
        ? 'environment.apply'
        : 'environment.start';
}

async function approve(
    context: CliContext,
    error: ClientError,
): Promise<CliResult> {
    if (
        context.invocation.options.json ||
        context.invocation.options.detach ||
        !process.stdin.isTTY ||
        !process.stdout.isTTY
    )
        throw error;
    const reviewed = error.detail.data as { plan: unknown; revision: string };
    context.err(`${JSON.stringify(reviewed.plan, null, 2)}\n`);
    const terminal = createInterface({
        input: process.stdin,
        output: process.stderr,
    });
    try {
        const answer = await terminal.question(
            'Apply this startup plan? [y/N] ',
            { signal: context.signal },
        );
        if (!/^y(?:es)?$/i.test(answer.trim())) throw error;
    } finally {
        terminal.close();
    }
    return submit(context, 'environment.confirm', {
        plan: JSON.stringify(reviewed),
    });
}

export async function environmentCommand(
    context: CliContext,
): Promise<CliResult> {
    const { name, options } = context.invocation;
    if (name === 'stop' || name === 'legacy down')
        return submit(context, 'environment.stop', {});
    await previewDetachedStart(context);
    return applyWithConfirmation(context);
}

/**
 * Applies the saved configuration; the existing stop safeguards apply, and a
 * pending plan raises CONFIRMATION_REQUIRED which interactive sessions can
 * approve.
 */
export async function applyWithConfirmation(
    context: CliContext,
): Promise<CliResult> {
    try {
        return await submit(context, 'environment.apply', {
            approveStops: context.invocation.options.yes === true,
        });
    } catch (error) {
        if (
            error instanceof ClientError &&
            error.detail.code === 'CONFIRMATION_REQUIRED'
        )
            return approve(context, error);
        throw error;
    }
}
async function previewDetachedStart(context: CliContext) {
    const options = context.invocation.options;
    if (
        !options.detach ||
        options.yes ||
        context.client.getSnapshot().live.running
    )
        return;
    const reviewed = await context.client.query(
        'environment.preview',
        {},
        context.signal,
        context.scope,
    );
    if (reviewed.plan.stop.length)
        throw new ClientError({
            code: 'CONFIRMATION_REQUIRED',
            message:
                'Starting will stop running services. Review the plan and use --yes to approve.',
            data: reviewed,
        });
}
