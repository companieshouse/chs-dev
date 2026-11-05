import { daemonAction } from '../daemon-control/actions.js';

try {
    const result = await daemonAction(process.argv[2] ?? 'status');
    console.log(
        'message' in result ? result.message : JSON.stringify(result, null, 2),
    );
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
