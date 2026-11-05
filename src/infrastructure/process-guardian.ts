import { connect } from 'node:net';
import { spawn } from 'node:child_process';

// This helper is a process-group leader. Its command cannot outlive the owner
// connection: no persisted PID is needed, so PID reuse cannot target other work.
// Initialise terminal streams while the PTY is alive. Opening them lazily after
// a hangup can block in the macOS TTY driver and prevent command cleanup.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const [socket, command, ...args] = process.argv.slice(2);
const owner = connect(socket!);
let stopping = false;
const stop = () => {
    if (stopping) return;
    stopping = true;
    try {
        process.kill(-process.pid, 'SIGTERM');
    } catch {}
    setTimeout(() => {
        try {
            process.kill(-process.pid, 'SIGKILL');
        } catch {}
        process.exit(130);
    }, 1500);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGHUP', stop);
owner.on('error', stop);
owner.on('end', stop);
owner.on('close', stop);
owner.resume();
owner.once('connect', () => {
    if (stopping) return;
    const child = spawn(command!, args, { stdio: 'inherit' });
    child.on('error', (error) => {
        console.error(error.message);
        process.exit(127);
    });
    child.on('exit', (code, signal) => {
        if (!stopping) process.exit(signal ? 130 : (code ?? 1));
    });
});
