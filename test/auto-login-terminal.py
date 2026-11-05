"""Exercise automatic Apple login from the real Environment window with fake CLIs."""
import fcntl
import json
import os
import pathlib
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

repo = pathlib.Path(__file__).resolve().parent.parent


def scenario(outcome):
    with tempfile.TemporaryDirectory(prefix='chs-auto-login-pty-') as directory:
        root = pathlib.Path(directory).resolve()
        project = root / 'project'
        for part in ['bin', 'services/modules', 'services/infrastructure']:
            (project / part).mkdir(parents=True, exist_ok=True)
        (project / 'bin/chs-dev').write_text('')
        (project / 'global.env').write_text('')
        (project / 'services/infrastructure/docker-compose.yaml').write_text(
            'services:\n  app:\n    image: example/app:latest\n')
        (root / 'aws').write_text('''#!/bin/sh
case "$1" in
  sts)
    case "$*" in
      *secondary*)
        if [ ! -f "$CHS_LOGIN_TEST_ROOT/sso" ]; then
          echo 'Error loading SSO Token: Token does not exist' >&2
          exit 255
        fi
        echo 111111111111 ;;
      *) echo '{"Account":"111111111111","Arn":"fixture"}' ;;
    esac ;;
  sso)
    echo STUB_LOGIN_WAITING
    read answer
    touch "$CHS_LOGIN_TEST_ROOT/sso" ;;
  configure)
    case "$2" in
      get) echo eu-west-2 ;;
      list-profiles) echo secondary ;;
      *) exit 1 ;;
    esac ;;
  ecr) echo fixture-private-password ;;
  *) exit 1 ;;
esac
''')
        (root / 'container').write_text('''#!/bin/sh
if [ "$1 $2" != 'registry login' ]; then exit 1; fi
read password
if [ "$password" != fixture-private-password ]; then exit 1; fi
echo login >> "$CHS_LOGIN_TEST_ROOT/registry-attempts"
if [ "$CHS_LOGIN_TEST_OUTCOME" = failed ]; then
  echo '401 Unauthorized for 111111111111.dkr.ecr.eu-west-2.amazonaws.com' >&2
  exit 1
fi
touch "$CHS_LOGIN_TEST_ROOT/registry"
''')
        for name in ['aws', 'container']:
            (root / name).chmod(0o755)
        runner = root / 'runner.mjs'
        runner.write_text('const dist = ' + json.dumps((repo / 'dist').as_uri()) + ';\n' + '''
const { createRequire } = await import('node:module');
const require = createRequire(dist + '/index.js');
const { createElement } = require('react');
const { render } = await import(require.resolve('ink'));
const { existsSync, appendFileSync } = await import('node:fs');
const { default: App } = await import(dist + '/tui/app.js');
const { initializeSettings } = await import(dist + '/infrastructure/settings.js');
const { createApplication } = await import(dist + '/server/bootstrap.js');
const { listenApi } = await import(dist + '/server/api.js');
const { Client } = await import(dist + '/client/client.js');
const { AppleNativeStrategy } = await import(dist + '/infrastructure/runtimes/apple-native.js');
await initializeSettings();
const root = process.env.CHS_LOGIN_TEST_ROOT;
const engine = new AppleNativeStrategy();
const available = async () => ({ available: true, message: 'Fixture engine ready.' });
const success = async () => ({ outcome: 'success', affectedServices: [], message: 'Done.' });
let started = false;
engine.checkAvailability = available;
engine.containers = () => undefined;
engine.inspect = async () => ({ app: started ? 'Running' : 'Stopped' });
engine.live = (project) => ({
  checkAvailability: available,
  snapshot: async () => ({
    projectName: project.name ?? 'project', projectDirectory: project.directory,
    containers: started ? [{ id: 'app', service: 'app', lifecycle: 'running', mode: 'Service', projectName: project.name, projectDirectory: project.directory }] : []
  }),
  apply: async () => {
    appendFileSync(root + '/apply-attempts', 'apply\\n');
    if (!existsSync(root + '/registry')) return { outcome: 'failed', failureKind: 'ecr', message: 'Registry credentials required.', affectedServices: [] };
    started = true;
    return success();
  },
  stop: success, stopProject: success, containerAction: success, reload: success,
  logs: async () => [],
});
const server = await createApplication({ runtime: () => engine });
const socket = root + '/api.sock';
const api = await listenApi(socket, server.application, server.operations);
const client = await new Client(socket).connect();
const app = render(createElement(App, { client }), { alternateScreen: true });
try { await app.waitUntilExit(); } finally { client.close(); await server.close(); await api.close(); }
''')
        env = dict(os.environ, PATH=directory + os.pathsep + os.environ['PATH'],
                   CHS_DEV_PROJECT=str(project), CHS_DEV_RUNTIME='apple',
                   CHS_DEV_ORCHESTRATOR='native', CHS_DEV_AUTO_LOGIN='needed',
                   CHS_DEV_LOGIN='registry', AWS_PROFILE='primary',
                   CHS_DEV_ECR_PROFILES='secondary', CHS_DEV_APPLE_CLI=str(root / 'container'),
                   XDG_CONFIG_HOME=directory, XDG_STATE_HOME=directory,
                   CHS_LOGIN_TEST_ROOT=str(root), CHS_LOGIN_TEST_OUTCOME=outcome)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 110, 0, 0))

        def setup():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        child = subprocess.Popen([shutil.which('node'), str(runner)], cwd=repo,
                                 stdin=slave, stdout=slave, stderr=slave, env=env,
                                 preexec_fn=setup)
        os.close(slave)
        output = b''

        def expect(text):
            nonlocal output
            deadline = time.monotonic() + 12
            while text.encode() not in output:
                if time.monotonic() > deadline:
                    raise AssertionError('Missing ' + text + ': ' + repr(output[-2500:]))
                if select.select([master], [], [], 0.1)[0]:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        raise AssertionError('Exited before ' + text + ': ' + repr(output[-2500:]))
                    output += chunk
            output = output.split(text.encode(), 1)[1]

        def drain(seconds):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                if select.select([master], [], [], 0.05)[0]:
                    if not os.read(master, 65536):
                        break

        try:
            expect('Session active')
            os.write(master, b'\x05')
            expect('Start environment')
            os.write(master, b'\r')
            # No Escape or Ctrl+L: recovery must start with Environment still open.
            expect('Logging in automatically')
            expect('STUB_LOGIN_WAITING')
            drain(0.3)
            os.write(master, b'\x03' if outcome == 'cancelled' else b'\r')
            if outcome == 'success':
                expect('Running 1/1')
                assert (root / 'apply-attempts').read_text().splitlines() == ['apply', 'apply']
                assert (root / 'registry-attempts').read_text().splitlines() == ['login']
            else:
                expect('Log in to AWS + registry' if outcome == 'cancelled'
                       else 'AWS profile secondary')
                drain(0.4)
                assert (root / 'apply-attempts').read_text().splitlines() == ['apply']
                if outcome == 'failed':
                    assert (root / 'registry-attempts').read_text().splitlines() == ['login']
                else:
                    assert not (root / 'registry-attempts').exists()
            # Close the restored Environment window or the failed-login dialog.
            drain(0.3)
            os.write(master, b'q')
            drain(0.3)
            os.write(master, b'q')
            deadline = time.monotonic() + 5
            while child.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master, 65536)
                        if not chunk:
                            break
                        output += chunk
                    except OSError:
                        break
            os.close(master)
            master = None
            child.wait(timeout=3)
            assert child.returncode == 0
            print('PASS automatic Apple login from Environment:', outcome, flush=True)
        finally:
            if master is not None:
                os.close(master)
            if child.poll() is None:
                child.kill()
                child.wait(timeout=3)


for outcome in ['success', 'failed', 'cancelled']:
    scenario(outcome)
