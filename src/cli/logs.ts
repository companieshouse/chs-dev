import { streamLogs } from '../client/logs.js';
import type { CliContext, CliResult } from './context.js';

export async function legacyLogs(context: CliContext): Promise<CliResult> {
    const { options, args } = context.invocation;
    const tail =
        options.tail === undefined || options.tail === 'all'
            ? 'all'
            : Number(options.tail);
    await streamLogs(
        context.client.socket,
        {
            scope: context.scope,
            source: options.compose ? 'environment' : 'services',
            services: args,
            follow: options.follow === true,
            tail,
        },
        (entry) =>
            context.out(
                `${entry.service ? `${entry.service} | ` : ''}${entry.text}\n`,
            ),
        context.signal,
    );
    return { data: null, streamed: true };
}
