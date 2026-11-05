#!/usr/bin/env node
if (process.argv.length === 2) {
    await import('./tui.js');
} else {
    const { runCli } = await import('../cli/run.js');
    process.exitCode = await runCli(process.argv.slice(2));
}
