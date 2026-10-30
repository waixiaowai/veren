"""Public offline bootstrap; no receiver input or private keys handled here."""
import os
import re
import resource
import stat
import json
import socket
import ssl
import subprocess
import sys

os.umask(0o077)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
if len(sys.argv) != 2 or not re.fullmatch(r'[a-f0-9]{32}', sys.argv[1]):
    raise SystemExit('invalid_run')
run = sys.argv[1]
# Dedicated fresh runtime created by Files; restrict only these exact dirs.
for path in ('/runtime', '/runtime/queue', '/runtime/queue/' + run):
    s = os.lstat(path)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 1000 or s.st_gid != 1000:
        raise SystemExit('runtime_identity')
    os.chmod(path, 0o700)
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
os.environ['RECEIVER_SCRIPT'] = '/receiver/receiver.py'
subprocess.run([sys.executable, '-B', '/receiver/tests.py'], check=True)
with socket.create_connection(('122.228.29.101',443),timeout=10) as raw:
    with ssl.create_default_context().wrap_socket(raw,server_hostname='bowong-ai.tos-s3-accelerate.volces.com') as tls:
        print(json.dumps({'pinned_tls':tls.version(),'host_verified':True}),flush=True)
try:
    s=socket.create_connection(('1.1.1.1',443),timeout=3)
except OSError:
    print('NON_TOS_DENIED',flush=True)
else:
    s.close();raise SystemExit('non_tos_not_denied')
os.execv(sys.executable, [
    sys.executable, '-B', '/receiver/receiver.py', 'serve',
    '--queue', '/runtime/queue/' + run, '--root', '/data', '--run', run,
    '--writers-quiesced', '--workers', '4',
])
