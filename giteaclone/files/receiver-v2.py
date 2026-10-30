"""Review-only receiver. No deployment. Python >=3.9 + cryptography.
serve needs exclusive, pre-quiesced destination; restart MUST use new run ID.
No signed URL, plaintext feed or private key is ever persisted/logged.
"""
import argparse
import base64
import concurrent.futures
import ctypes
import datetime
import fcntl
import hashlib
import http.client
import socket
import ssl
import json
import os
import re
import stat
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEYS = ['gitea-live-sync/production-files-b3150763ca474ac7a9d842c52d64c828/manifest.json',
        'gitea-live-sync/production-largefiles-408f5b2c1c724736ac6b7c092398138f/manifest.json']
HASHES = ['12266696c77d7ba2a60daca800f9cf08fddd8db189fab53456c15679f9ff802f',
          '84a0adfd673e50aa839696cacfed5f42ad49e7bded0cd7e7161d292989dbaf4c']
ROOTS = ('git/repositories', 'git/lfs', 'gitea/attachments', 'gitea/avatars',
         'gitea/repo-avatars', 'gitea/packages', 'gitea/actions_artifacts')
HOSTS = ('bowong-ai.tos-s3-cn-hongkong.volces.com', 'bowong-ai.tos-s3-accelerate.volces.com')
MAX_PAGE = 4 * 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

class Stop(Exception):
    pass

def check(ok, code):
    if not ok:
        raise Stop(code)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()

def b64(value):
    return base64.b64encode(value).decode()

def un64(value):
    return base64.b64decode(value, validate=True)

def path_ok(path):
    check(isinstance(path, str) and bool(path), 'path_type')
    check(not path.startswith('/') and not path.endswith('/'), 'path_absolute')
    check(all(x not in ('', '.', '..') for x in path.split('/')), 'path_component')
    check(not any(x in path for x in '\\?#%'), 'path_encoding')
    check(not any(unicodedata.category(x).startswith('C') for x in path), 'path_control')
    check(path == unicodedata.normalize('NFC', path), 'path_unicode')

def validate_pair(pair):
    check(isinstance(pair, list) and len(pair) == 2 and all(isinstance(m, dict) for m in pair), 'manifest_pair')
    maximum = pair[0].get('max_file_bytes'); upper = pair[1].get('max_file_bytes')
    check(type(maximum) is int and type(upper) is int and 0 < maximum < upper <= 5368709120, 'manifest_limits')
    paths, keys, index = set(), set(), {}
    required = {'unsafe', 'oversize', 'changed', 'error', 'limits', 'missing_roots'}
    for n, manifest in enumerate(pair):
        check(isinstance(manifest, dict), 'manifest_shape')
        check(manifest.get('database_included') is False and manifest.get('hot_snapshot_atomic') is False, 'manifest_scope')
        entries = manifest.get('entries')
        check(isinstance(entries, list) and len(entries) == (46327, 37)[n], 'manifest_count')
        omissions = manifest.get('omitted')
        check(isinstance(omissions, dict) and set(omissions) == required, 'omission_fields')
        check(all(type(v) is int and v == (37 if n == 0 and k == 'oversize' else 0)
                  for k, v in omissions.items()), 'omissions')
        for row in entries:
            check(isinstance(row, dict), 'entry_shape')
            path_ok(row.get('path')); path_ok(row.get('key'))
            path, key = row['path'], row['key']
            check(any(path.startswith(root + '/') for root in ROOTS), 'root_scope')
            check(key == KEYS[n].rsplit('/', 1)[0] + '/files/' + path, 'object_key')
            check(path not in paths and key not in keys, 'duplicate')
            check(type(row.get('size')) is int and 0 <= row['size'] <= 5368709120, 'size')
            check((row['size'] <= maximum) == (n == 0) and row['size'] <= upper, 'range')
            check(isinstance(row.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'sha')
            check(type(row.get('mode')) is int and 0 <= row['mode'] <= 0o777, 'mode')
            check(type(row.get('get_verified')) is bool, 'source_verified_type')
            check(row.get('isSymlink', False) is False and row.get('is_symlink', False) is False, 'symlink')
            paths.add(path); keys.add(key); index[key] = row
    small, large = pair
    check(large.get('selected_range_complete') is True and large.get('min_file_bytes') == maximum + 1, 'large_range')
    check(large.get('excluded_below_range') == 46327, 'large_coverage')
    check(sum(e['size'] for e in small['entries']) == 5974032339, 'small_bytes')
    check(sum(e['size'] for e in large['entries']) == 7490258770, 'large_bytes')
    for path in paths:
        parts = path.split('/')
        check(all('/'.join(parts[:n]) not in paths for n in range(1, len(parts))), 'file_directory_conflict')
    return index

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

# This IP is the exact independently verified Calico destination. TLS still
# verifies the approved TOS hostname; no DNS rotation may widen the connection.
TOS_PIN = '122.228.29.101'
TOS_HOST = 'bowong-ai.tos-s3-accelerate.volces.com'
class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        check(self.host == TOS_HOST and self.port == 443 and not self._tunnel_host, 'tls_destination')
        raw = socket.create_connection((TOS_PIN, 443), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=TOS_HOST)
        except BaseException:
            raw.close()
            raise
class PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PinnedHTTPSConnection, req, context=self._context)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                    PinnedHTTPSHandler(context=ssl.create_default_context()))

def url_ok(url, key):
    check(isinstance(url, str), 'url_type')
    p = urllib.parse.urlsplit(url)
    check(p.scheme == 'https' and p.netloc in HOSTS and not p.fragment, 'url_host')
    check(p.path == '/' + urllib.parse.quote(key, safe='/-_.~'), 'url_key')
    pairs = urllib.parse.parse_qsl(p.query, strict_parsing=True)
    check(len(pairs) == len(dict(pairs)), 'query_duplicate')
    q = dict(pairs)
    check(q.get('X-Amz-Algorithm') == 'AWS4-HMAC-SHA256' and q.get('X-Amz-SignedHeaders') == 'host', 'url_signature')
    ttl = int(q['X-Amz-Expires'])
    check(900 <= ttl <= 3600, 'url_ttl')
    stamp = datetime.datetime.strptime(q['X-Amz-Date'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
    check(stamp <= time.time() + 60 and stamp + ttl > time.time() + 60, 'url_expired')

def get(url, key):
    url_ok(url, key)
    try:
        response = OPENER.open(urllib.request.Request(url, headers={'Accept-Encoding': 'identity'}), timeout=60)
        check(response.status == 200 and response.headers.get('Content-Encoding', 'identity') == 'identity', 'http_response')
        return response
    except urllib.error.HTTPError as error:
        raise Stop('source_http_' + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError):
        reason = getattr(sys.exc_info()[1], 'reason', sys.exc_info()[1])
        code = type(reason).__name__
        if isinstance(reason, ssl.SSLError):
            raise Stop('source_tls_' + code) from None
        raise Stop('source_network_' + code) from None

def manifest_bytes(response):
    chunks = []; count = 0; deadline = time.monotonic() + 300
    while True:
        check(time.monotonic() < deadline, 'manifest_deadline')
        data = response.read1(1024 * 1024)
        if not data:
            return b''.join(chunks)
        count += len(data)
        check(count <= 64 * 1024 * 1024, 'manifest_oversize')
        chunks.append(data)

def directory(path):
    check(os.path.isabs(path), 'absolute_directory_required')
    fd = os.open('/', DIR_FLAGS)
    try:
        for part in path.split('/')[1:]:
            check(part not in ('', '.', '..'), 'absolute_component')
            nxt = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd); fd = nxt
        return fd
    except BaseException:
        os.close(fd); raise

def parent(rootfd, path):
    path_ok(path)
    fd = os.dup(rootfd)
    try:
        for part in path.split('/')[:-1]:
            try:
                os.mkdir(part, 0o755, dir_fd=fd)
                os.fsync(fd)
            except FileExistsError:
                pass
            nxt = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd); fd = nxt
        return fd, path.rsplit('/', 1)[-1]
    except BaseException:
        os.close(fd); raise

def read_file(fd, name, maximum):
    f = os.open(name, FILE_FLAGS, dir_fd=fd)
    with os.fdopen(f, 'rb') as stream:
        st = os.fstat(stream.fileno())
        check(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= maximum, 'input_file')
        raw = stream.read(maximum + 1)
        check(len(raw) <= maximum, 'input_size')
        return raw

def exclusive(fd, name, raw):
    temp = '.publish-' + os.urandom(16).hex()
    f = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(f, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        rename_new(fd, temp, name)
    except BaseException:
        try:
            os.unlink(temp, dir_fd=fd)
        except FileNotFoundError:
            pass  # rename succeeded but directory fsync failed: preserve original failure.
        raise

def rename_new(fd, old, new):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(fd, old.encode(), fd, new.encode(), 1):
        raise Stop('atomic_publish_refused')
    os.fsync(fd)

def existing(fd, name, entry):
    try:
        f = os.open(name, FILE_FLAGS, dir_fd=fd)
    except FileNotFoundError:
        return False
    with os.fdopen(f, 'rb') as stream:
        before = os.fstat(stream.fileno())
        check(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'existing_type')
        check(before.st_uid == os.geteuid() and before.st_gid == os.getegid(), 'existing_owner')
        check(before.st_size == entry['size'] and stat.S_IMODE(before.st_mode) == entry['mode'], 'existing_size_mode_mismatch')
        h = hashlib.sha256()
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
        after = os.fstat(stream.fileno())
        check((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
              (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'existing_changed')
        current = os.stat(name, dir_fd=fd, follow_symlinks=False)
        check((current.st_dev, current.st_ino) == (after.st_dev, after.st_ino), 'existing_replaced')
        check(h.hexdigest() == entry['sha256'], 'existing_sha_mismatch')
        return True

def receive_once(rootfd, entry, url, cancel=None):
    check(cancel is None or not cancel.is_set(), 'batch_cancelled')
    fd, name = parent(rootfd, entry['path'])
    tmp = '.gitea-receive-' + os.urandom(16).hex() + '.tmp'
    made = False
    try:
        if existing(fd, name, entry):
            return 'verified_existing'
        f = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        made = True
        with os.fdopen(f, 'wb') as stream, get(url, entry['key']) as response:
            if response.headers.get('Content-Length') is not None:
                check(int(response.headers['Content-Length']) == entry['size'], 'content_length')
            count = 0; h = hashlib.sha256(); deadline = time.monotonic() + 3600
            while True:
                check(time.monotonic() < deadline, 'object_deadline')
                check(cancel is None or not cancel.is_set(), 'batch_cancelled')
                data = response.read1(1024 * 1024)
                if not data:
                    break
                count += len(data); check(count <= entry['size'], 'oversize_body')
                stream.write(data); h.update(data)
            check(count == entry['size'] and h.hexdigest() == entry['sha256'], 'download_size_sha')
            stream.flush(); os.fchmod(stream.fileno(), entry['mode']); os.fsync(stream.fileno())
        check(cancel is None or not cancel.is_set(), 'batch_cancelled')
        rename_new(fd, tmp, name); made = False
        check(existing(fd, name, entry), 'publish_readback')
        return 'received'
    finally:
        if made:
            os.unlink(tmp, dir_fd=fd)
            os.fsync(fd)
        os.close(fd)

def receive(rootfd, entry, url, cancel=None):
    # GET-only retry, after receive_once removes its own unpublished tempfile.
    # Existing canonical files are always reverified and never overwritten.
    for attempt in range(3):
        try:
            return receive_once(rootfd, entry, url, cancel)
        except BaseException as error:
            retryable = (isinstance(error, Stop) and str(error).startswith('source_network_')) or isinstance(error, (TimeoutError, ConnectionError, http.client.IncompleteRead))
            if not retryable or attempt == 2 or (cancel is not None and cancel.is_set()):
                raise
            print(json.dumps({'network_retry': attempt + 1, 'error_type': type(error).__name__}), flush=True)
            time.sleep(2 * (attempt + 1))

def aad(run, kid, seq):
    return {'version': 1, 'run': run, 'kid': kid, 'seq': seq, 'manifest_sha256': HASHES}

def seal(public, seq, payload):
    key = serialization.load_pem_public_key(public['pem'].encode())
    check(isinstance(key, rsa.RSAPublicKey) and key.key_size == 3072, 'rsa_public')
    der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    check(hashlib.sha256(der).hexdigest() == public['kid'] and public['manifest_sha256'] == HASHES, 'public_binding')
    binding = aad(public['run'], public['kid'], seq); ad = canonical(binding)
    secret = AESGCM.generate_key(bit_length=256); nonce = os.urandom(12)
    cipher = AESGCM(secret).encrypt(nonce, canonical(payload), ad)
    wrapped = key.encrypt(secret, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=ad))
    return canonical({'aad': binding, 'nonce': b64(nonce), 'wrapped': b64(wrapped), 'cipher': b64(cipher)})

def serve(args):
    check(args.writers_quiesced, 'writers_not_confirmed')
    check(os.geteuid() == 1000 and os.getegid() == 1000, 'receiver_identity')
    check(sys.platform == 'linux', 'receiver_platform')
    # Must already exist; runtime directory unique per run, writable only by receiver/operator.
    qfd = directory(args.queue); rootfd = directory(args.root)
    lock = os.open('.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=qfd)
    lock_stat = os.fstat(lock)
    check(stat.S_ISREG(lock_stat.st_mode) and lock_stat.st_nlink == 1, 'lock_type')
    check(lock_stat.st_uid == os.geteuid() and lock_stat.st_gid == os.getegid(), 'lock_owner')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    check(not os.path.samefile(args.queue, args.root), 'queue_equals_root')
    # Refuse reuse, including after crash: RSA key is process-memory only, never serialized.
    private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    key = private.public_key(); der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    kid = hashlib.sha256(der).hexdigest()
    public = {'run': args.run, 'kid': kid, 'manifest_sha256': HASHES,
              'pem': key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()}
    exclusive(qfd, 'public.json', canonical(public))
    seq = 0; index = None; completed = set(); stop_at = time.monotonic() + args.idle_timeout
    while True:
        marker = '%06d.ready' % seq
        try:
            ready = json.loads(read_file(qfd, marker, 4096))
        except FileNotFoundError:
            check(time.monotonic() < stop_at, 'queue_idle_timeout'); time.sleep(2); continue
        check(ready == {'run': args.run, 'seq': seq, 'sha256': ready.get('sha256')}, 'ready_binding')
        check(re.fullmatch('[a-f0-9]{64}', ready['sha256']), 'cipher_hash_type')
        raw = read_file(qfd, '%06d.cipher' % seq, MAX_PAGE)
        check(hashlib.sha256(raw).hexdigest() == ready['sha256'], 'cipher_sha')
        envelope = json.loads(raw); binding = aad(args.run, kid, seq)
        check(envelope.get('aad') == binding, 'page_binding')
        ad = canonical(binding)
        secret = private.decrypt(un64(envelope['wrapped']), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=ad))
        payload = json.loads(AESGCM(secret).decrypt(un64(envelope['nonce']), un64(envelope['cipher']), ad))
        del secret, envelope, raw
        if seq == 0:
            check(payload.get('kind') == 'bootstrap' and len(payload.get('urls', [])) == 2, 'bootstrap_shape')
            pair = []
            for n, url in enumerate(payload['urls']):
                with get(url, KEYS[n]) as response:
                    data = manifest_bytes(response)
                check(len(data) <= 64 * 1024 * 1024 and hashlib.sha256(data).hexdigest() == HASHES[n], 'manifest_hash')
                pair.append(json.loads(data))
            index = validate_pair(pair); del pair, data
            report = {'seq': seq, 'coverage': 46364, 'manifest_sha256': HASHES}
        elif payload.get('kind') == 'finish':
            check(len(completed) == 46364, 'finish_incomplete')
            exclusive(qfd, '%06d.done' % seq, canonical({'seq': seq, 'files_verified': len(completed)}))
            # Permit the controller's bounded receipt poll before the Job exits.
            time.sleep(30)
            return
        else:
            rows = payload.get('objects')
            check(payload.get('kind') == 'objects' and isinstance(rows, list) and 1 <= len(rows) <= 256, 'page_shape')
            check(len({r['key'] for r in rows}) == len(rows), 'page_duplicate')
            for row in rows:
                check(set(row) == {'key', 'url'} and row['key'] in index, 'page_key')
                url_ok(row['url'], row['key'])
            report = {'seq': seq, 'files': []}
            # Bounded outstanding work: a failed item cancels all not-yet-started items.
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                pending = {}; remaining = iter(rows); cancel = threading.Event()
                def submit():
                    row = next(remaining, None)
                    if row is not None:
                        pending[pool.submit(receive, rootfd, index[row['key']], row['url'], cancel)] = row['key']
                for _ in range(args.workers): submit()
                try:
                    while pending:
                        done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
                        for future in done:
                            object_key = pending.pop(future); status = future.result(); entry = index[object_key]
                            completed.add(object_key)
                            report['files'].append({k: entry[k] for k in ('path', 'size', 'sha256', 'mode')})
                        for _ in done: submit()
                except BaseException:
                    cancel.set()
                    for future in pending: future.cancel()
                    raise
        del payload
        exclusive(qfd, '%06d.done' % seq, canonical(report))
        print(json.dumps({'seq': seq, 'verified_this_run': len(completed), 'ok': True}), flush=True)
        seq += 1; stop_at = time.monotonic() + args.idle_timeout

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('serve'); p.add_argument('--queue', required=True); p.add_argument('--root', required=True)
    p.add_argument('--run', required=True); p.add_argument('--writers-quiesced', action='store_true')
    p.add_argument('--workers', type=int, default=4); p.add_argument('--idle-timeout', type=int, default=1800)
    p = sub.add_parser('inspect'); p.add_argument('--queue', required=True); p.add_argument('--run', required=True)
    p.add_argument('--seq', type=int)
    p = sub.add_parser('commit'); p.add_argument('--queue', required=True); p.add_argument('--run', required=True)
    p.add_argument('--seq', type=int, required=True); p.add_argument('--sha256', required=True)
    p.add_argument('--staged', required=True, help='Unique completed Files upload basename, never a canonical .cipher name')
    args = parser.parse_args()
    check(re.fullmatch('[a-f0-9]{32}', args.run), 'run_id')
    if args.command == 'serve':
        check(1 <= args.workers <= 8 and 60 <= args.idle_timeout <= 86400, 'limits')
        serve(args)
    elif args.command == 'inspect':
        fd = directory(args.queue)
        public = json.loads(read_file(fd, 'public.json', 8192))
        check(public['run'] == args.run, 'inspect_run')
        if args.seq is None:
            print(json.dumps(public))
        else:
            check(0 <= args.seq <= 100000, 'inspect_seq')
            try:
                raw = read_file(fd, '%06d.done' % args.seq, 512 * 1024)
            except FileNotFoundError:
                print(json.dumps({'seq': args.seq, 'done': False}))
            else:
                report = json.loads(raw)
                print(json.dumps({'seq': args.seq, 'done': True, 'sha256': hashlib.sha256(raw).hexdigest(),
                                  'files': len(report.get('files', [])), 'coverage': report.get('coverage'),
                                  'files_verified': report.get('files_verified')}))
        os.close(fd)
    else:
        check(0 <= args.seq <= 100000 and re.fullmatch('[a-f0-9]{64}', args.sha256), 'commit_fields')
        fd = directory(args.queue)
        check(re.fullmatch(r'[a-f0-9]{32}\.upload', args.staged), 'staged_name')
        raw = read_file(fd, args.staged, MAX_PAGE)
        check(hashlib.sha256(raw).hexdigest() == args.sha256, 'commit_hash')
        public = json.loads(read_file(fd, 'public.json', 8192))
        check(public['run'] == args.run and public['manifest_sha256'] == HASHES, 'commit_run')
        # Copy verified ciphertext to a fresh no-replace canonical file: even if
        # upload inode changes afterwards it cannot mutate the queued ciphertext.
        try:
            queued = read_file(fd, '%06d.cipher' % args.seq, MAX_PAGE)
        except FileNotFoundError:
            exclusive(fd, '%06d.cipher' % args.seq, raw)
        else:
            check(queued == raw, 'sequence_already_used')
        marker = canonical({'run': args.run, 'seq': args.seq, 'sha256': args.sha256})
        try:
            previous = read_file(fd, '%06d.ready' % args.seq, 4096)
        except FileNotFoundError:
            exclusive(fd, '%06d.ready' % args.seq, marker)
        else:
            check(previous == marker, 'ready_already_used')
        os.close(fd)

if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as error:
        # Never print traceback / urllib exception / argv / payload.
        code = str(error) if isinstance(error, Stop) else type(error).__name__
        print(json.dumps({'stopped': code}), file=sys.stderr)
        sys.exit(1)
