import os, pty, subprocess, tempfile, pathlib, select, time, shutil, fcntl, termios, struct
os.chdir(pathlib.Path(__file__).resolve().parent.parent)
with tempfile.TemporaryDirectory(prefix='chs-login-pty-') as directory:
    root=pathlib.Path(directory)
    aws=root/'aws'
    aws.write_text("""#!/bin/sh
if [ "$1" = "sts" ]; then
  echo '{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/test/test"}'
else
  echo 'STUB_LOGIN_WAITING'
  read answer
  exit 0
fi
""")
    aws.chmod(0o755)
    docker=root/'docker';docker.write_text('#!/bin/sh\nexit 1\n');docker.chmod(0o755)
    master,slave=pty.openpty()
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,140,0,0))
    env=dict(os.environ,PATH=directory+os.pathsep+os.environ['PATH'],AWS_PROFILE='test-profile',CHS_DEV_PROJECT='../docker-chs-development',XDG_CONFIG_HOME=directory,XDG_STATE_HOME=directory,CHS_DEV_DAEMON_MODE='detached',CHS_DEV_SOCKET=str(root/'daemon.sock'),CHS_DEV_TEST_SESSION='fixture')
    def setup():
        os.setsid()
        fcntl.ioctl(0,termios.TIOCSCTTY,0)
    child=subprocess.Popen([shutil.which('node'),'dist/entrypoints/chs-dev.js'],stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=setup)
    os.close(slave)
    output=b''
    def expect(text):
        global output
        deadline=time.monotonic()+8
        while text.encode() not in output:
            if time.monotonic()>deadline: raise AssertionError('Missing '+text+'; output: '+repr(output[-500:]))
            if select.select([master],[],[],0.1)[0]:
                try: output+=os.read(master,65536)
                except OSError: raise AssertionError('Exited early: '+repr(output[-700:]))
        output=b''
        print('PASS',text,flush=True)
        drain(0.4)
    def drain(seconds):
        until=time.monotonic()+seconds
        while time.monotonic()<until:
            if select.select([master],[],[],0.05)[0]:
                try: os.read(master,65536)
                except OSError: break
    try:
        expect('Session active')
        # The modal shows every time by default; "Don't ask again" starts unchecked.
        os.write(master,b'\x0c');expect("[ ] Don't ask again")
        os.write(master,b'\x1b[B');drain(0.2)
        os.write(master,b'\r');expect('STUB_LOGIN_WAITING')
        os.write(master,b'\r');expect('AWS login completed.')
        os.write(master,b'\r');expect('STUB_LOGIN_WAITING')
        os.write(master,b'\x03');expect('login cancelled.')
        assert not (root/'chs-dev'/'tui.yaml').exists()
        # The checkbox row toggles with Enter; the modal then remembers the choice.
        os.write(master,b'\x1b[B');drain(0.2);os.write(master,b'\r');expect("[x] Don't ask again")
        os.write(master,b'\r');expect("[ ] Don't ask again")
        os.write(master,b' ');expect("[x] Don't ask again")
        os.write(master,b'\x1b[A');drain(0.2)
        os.write(master,b'\r');expect('STUB_LOGIN_WAITING')
        os.write(master,b'\r');expect('AWS login completed.')
        saved=(root/'chs-dev'/'tui.yaml').read_text()
        assert 'action: aws' in saved, saved
        print('PASS remembered login choice',flush=True)
        # Ctrl+L now logs in straight away without the modal.
        os.write(master,b'\x0c');expect('STUB_LOGIN_WAITING')
        os.write(master,b'\r');expect('AWS login completed.')
        drain(0.3);os.write(master,b'\x1b[C');drain(0.3);os.write(master,b'\x1b[C');expect('Depends on');os.write(master,b'q')
        deadline=time.monotonic()+5
        while child.poll() is None and time.monotonic()<deadline:
            if select.select([master],[],[],0.1)[0]:
                try: os.read(master,65536)
                except OSError: break
        child.wait(timeout=2)
        assert child.returncode==0, child.returncode
        print('PTY passed: prompt by default, remembered login, cancellation, restoration and clean exit.')
    finally:
        if child.poll() is None: child.kill();child.wait()
        os.close(master)
        subprocess.run([shutil.which('node'),'dist/entrypoints/chs-dev.js','daemon','stop'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
