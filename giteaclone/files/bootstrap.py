"""Public offline bootstrap; no receiver input or private keys handled here."""
import os
import re
import resource
import subprocess
import sys

os.umask(0o077)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
if len(sys.argv) != 2 or not re.fullmatch(r'[a-f0-9]{32}', sys.argv[1]):
    raise SystemExit('invalid_run')
run = sys.argv[1]
# Fresh target-private runtime must be preprovisioned by the approved operator.
# Do not repair, recursively chown, or overwrite an old installation.
os.mkdir('/runtime/vendor', 0o700)
subprocess.run([
    sys.executable, '-B', '-m', 'pip', '--isolated', 'install',
    '--no-index', '--find-links', '/runtime/wheels', '--target', '/runtime/vendor/',
    '--require-hashes', '--only-binary=:all:', '--no-deps', '--no-compile',
    '--no-cache-dir', '--disable-pip-version-check',
    '-r', '/receiver/requirements.lock',
], check=True)
os.environ['PYTHONPATH'] = '/runtime/vendor'
os.execv(sys.executable, [
    sys.executable, '-B', '/receiver/receiver.py', 'serve',
    '--queue', '/runtime/queue/' + run, '--root', '/data', '--run', run,
    '--writers-quiesced', '--workers', '4',
])
