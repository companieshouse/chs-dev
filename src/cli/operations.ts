import { type CliContext, type CliResult } from './context.js';

export async function operationCommand(
    context: CliContext,
): Promise<CliResult> {
    const action = context.invocation.name.split(' ')[1];
    if (action === 'list') {
        const operations = context.client.getSnapshot().operations;
        return {
            data: { operations },
            text: operations.length
                ? operations
                      .map(
                          (operation) =>
                              `${operation.id}  ${operation.state}  ${operation.kind}`,
                      )
                      .join('\n')
                : 'No retained operations.',
        };
    }
    const [id] = context.invocation.args;
    context.operation = await context.client.operation(id, context.signal);
    if (action === 'show') return { data: context.operation };
    if (action === 'cancel') {
        await context.client.cancel(id);
        try {
            await context.client.wait(id, context.signal);
        } catch (error) {
            const operation = await context.client.operation(
                id,
                context.signal,
            );
            if (operation.state !== 'cancelled') throw error;
        }
    } else await context.client.wait(id, context.signal);
    context.operation = await context.client.operation(id, context.signal);
    return {
        data: context.operation,
        text: `Operation ${id}: ${context.operation.state}.`,
    };
}
