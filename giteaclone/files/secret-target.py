"""Target-only decryption. Only exact transport state and public wheels mounted.
Never starts Gitea, installs configuration, exports plaintext, or reuses a run.
"""
import base64
import hashlib
import http.client
import json
import os
import resource
import socket
import ssl
import stat
import time
import urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

OP = 'gitea-secret-20261029-f07c219d6eab'
DOMAIN = 'gitea.comilogic.olares.cn'
OBJECT = 'gitea-live-sync/' + OP + '/secret-key.rsa-oaep.bin'
PUBLIC_SHA = '03f44d7cc21571d5ccf562bc5adbba32a0cc85f45ab8d3f829568eeb8a047122'
HOST = 'bowong-ai.tos-s3-accelerate.volces.com'
IP = '122.228.29.101'
STATE = '/secret-transfer'
FEED = '/receiver/secret-feed.json'
LABEL = b'GITEA-SECRET-FEED-V2:' + OP.encode()
FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

def check(ok, code):
    if not ok: raise RuntimeError(code)

def read_owned(name, limit, mode=0o600):
    with os.fdopen(os.open(STATE + '/' + name, FLAGS), 'rb') as f:
        s = os.fstat(f.fileno())
        check(stat.S_ISREG(s.st_mode) and s.st_uid == 1000 and s.st_gid == 1000
              and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == mode, 'state_file_identity')
        data = f.read(limit + 1)
        check(len(data) <= limit, 'state_file_limit')
        return data

def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())

def oaep(label=None):
    return padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=label)

def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    check(os.getuid() == os.getgid() == 1000, 'identity')
    s = os.lstat(STATE)
    check(stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 1000 and stat.S_IMODE(s.st_mode) == 0o700, 'state_dir_identity')
    check(read_owned('phase', 32) == b'KEY_READY_APP_OFF\n', 'transport_phase')
    public = read_owned('public.pem', 1024)
    check(hashlib.sha256(public).hexdigest() == PUBLIC_SHA, 'public_hash')
    private = serialization.load_pem_private_key(read_owned('private.pem', 8192), password=None)
    derived = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    check(derived == public and private.key_size == 4096, 'private_binding')
    feed = json.load(open(FEED))
    check(feed['operation'] == OP and feed['public_sha256'] == PUBLIC_SHA, 'feed_binding')
    key = private.decrypt(base64.b64decode(feed['wrapped'], validate=True), oaep(LABEL))
    clear = AESGCM(key).decrypt(base64.b64decode(feed['nonce'], validate=True), base64.b64decode(feed['cipher'], validate=True), LABEL)
    payload = json.loads(clear); del clear, key
    check(set(payload) == {'url', 'cipher_sha256', 'operation'} and payload['operation'] == OP, 'payload_shape')
    url = urllib.parse.urlsplit(payload['url'])
    check(url.scheme == 'https' and url.netloc == HOST and url.path == '/' + OBJECT and not url.fragment, 'url_scope')
    check(len(payload['cipher_sha256']) == 64 and all(x in '0123456789abcdef' for x in payload['cipher_sha256']), 'cipher_digest_format')
    run = STATE + '/decrypt-v2'
    os.mkdir(run, 0o700)  # Explicitly refuse any prior intent or partial attempt.
    write_new(run + '/phase', b'DECRYPT_INTENT\n')
    conn = http.client.HTTPSConnection(HOST, timeout=60, context=ssl.create_default_context())
    raw = socket.create_connection((IP, 443), timeout=15)
    try:
        conn.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=HOST)
        conn.request('GET', url.path + '?' + url.query, headers={'Accept-Encoding': 'identity'})
        response = conn.getresponse()
        check(response.status == 200 and response.getheader('Content-Encoding', 'identity') == 'identity', 'cipher_http')
        cipher = response.read(513)
    finally:
        conn.close(); raw.close()
    check(len(cipher) == 512 and hashlib.sha256(cipher).hexdigest() == payload['cipher_sha256'], 'cipher_hash')
    write_new(run + '/cipher.rsa-oaep.bin', cipher)
    plain = private.decrypt(cipher, oaep())
    check(len(plain) <= 446, 'oaep_limit')
    fields = plain.split(b'\n', 5)
    check(len(fields) == 6 and fields[:3] == [b'GITEA-SECRET-V1', OP.encode(), DOMAIN.encode()], 'plaintext_scope')
    secret = fields[5]
    check(fields[3] == str(len(secret)).encode() and 1 <= len(secret) <= 128, 'secret_length')
    check(all(32 <= b <= 126 for b in secret) and secret.strip() == secret, 'secret_semantics')
    check(fields[4] == hashlib.sha256(secret).hexdigest().encode(), 'secret_digest')
    write_new(run + '/secret.key', secret)
    with os.fdopen(os.open(run + '/secret.key', FLAGS), 'rb') as f:
        s = os.fstat(f.fileno())
        check(s.st_uid == s.st_gid == 1000 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1, 'output_identity')
        check(f.read(129) == secret, 'output_readback')
    del secret, plain, fields, private
    write_new(run + '/verified', b'SECRET_VERIFIED_APP_OFF\n')
    fd = os.open(run, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    os.fsync(fd); os.close(fd)
    print(json.dumps({'status': 'SECRET_VERIFIED_APP_OFF', 'operation': OP, 'cipher_sha256': payload['cipher_sha256']}), flush=True)
    time.sleep(300)  # Allow independent metadata readback before controlled cleanup.

if __name__ == '__main__':
    try: main()
    except BaseException as error:
        # Never print exception strings, tracebacks, argv, URLs, or payloads.
        print(json.dumps({'status':'SECRET_STOP_DO_NOT_REPLAY','error_class':type(error).__name__}), flush=True)
        raise SystemExit(1)
