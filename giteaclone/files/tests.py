"""Offline unit checks; no SSH, Olares, TOS, production or actual business bytes.
Linux-only tests exercise renameat2; skipped explicitly on macOS.
"""
import base64
import datetime
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, '/private/tmp/olares-ssh-inspect-lib-v2')
path = os.environ.get('RECEIVER_SCRIPT', '/private/tmp/gitea-job-receiver-1d3e6c9b.py')
spec = importlib.util.spec_from_file_location('r', path)
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

class Tests(unittest.TestCase):
    def test_encrypt_roundtrip_aad_tamper_restart(self):
        key = r.rsa.generate_private_key(public_exponent=65537, key_size=3072)
        public_key = key.public_key()
        der = public_key.public_bytes(r.serialization.Encoding.DER, r.serialization.PublicFormat.SubjectPublicKeyInfo)
        public = {'run': 'a' * 32, 'kid': hashlib.sha256(der).hexdigest(), 'manifest_sha256': r.HASHES,
                  'pem': public_key.public_bytes(r.serialization.Encoding.PEM, r.serialization.PublicFormat.SubjectPublicKeyInfo).decode()}
        payload = {'kind': 'objects', 'objects': [{'key': 'test', 'url': 'SENSITIVE_SENTINEL'}]}
        raw = r.seal(public, 1, payload)
        self.assertNotIn(b'SENSITIVE_SENTINEL', raw)
        envelope = json.loads(raw); ad = r.canonical(envelope['aad'])
        oaep = r.padding.OAEP(mgf=r.padding.MGF1(r.hashes.SHA256()), algorithm=r.hashes.SHA256(), label=ad)
        secret = key.decrypt(r.un64(envelope['wrapped']), oaep)
        cipher = r.un64(envelope['cipher']); nonce = r.un64(envelope['nonce'])
        self.assertEqual(json.loads(r.AESGCM(secret).decrypt(nonce, cipher, ad)), payload)
        with self.assertRaises(Exception):
            r.AESGCM(secret).decrypt(nonce, cipher, r.canonical(r.aad(public['run'], public['kid'], 2)))
        with self.assertRaises(Exception):
            r.AESGCM(secret).decrypt(nonce, cipher[:-1] + bytes([cipher[-1] ^ 1]), ad)
        replacement = r.rsa.generate_private_key(public_exponent=65537, key_size=3072)
        with self.assertRaises(Exception):
            replacement.decrypt(r.un64(envelope['wrapped']), oaep)

    def test_url_host_key_ttl(self):
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        url = 'https://' + r.HOSTS[0] + '/gitea-live-sync/test?X-Amz-Date=' + stamp + '&X-Amz-Expires=3600&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=host'
        r.url_ok(url, 'gitea-live-sync/test')
        for bad in [url.replace(r.HOSTS[0], 'example.com'), url.replace('https:', 'http:'), url + '#fragment', url.replace('3600', '4000'), url.replace('/test?', '/other?')]:
            with self.assertRaises(r.Stop): r.url_ok(bad, 'gitea-live-sync/test')

    def test_paths_and_symlink_parent(self):
        for bad in ['', '/absolute', '../escape', 'a//b', 'a/../b', 'a%2fb', 'a\\b', 'a\nb']:
            with self.assertRaises(r.Stop): r.path_ok(bad)
        with tempfile.TemporaryDirectory() as temp:
            temp = os.path.realpath(temp); fd = r.directory(temp)
            os.symlink('/tmp', temp + '/escape')
            with self.assertRaises(OSError): r.parent(fd, 'escape/anything')
            os.close(fd)

    def test_existing_verification_rejects_bad_sha_mode_link(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = os.path.realpath(temp); fd = r.directory(temp)
            with open(temp + '/x', 'wb') as f: f.write(b'fixture')
            os.chmod(temp + '/x', 0o644)
            e = {'size': 7, 'mode': 0o644, 'sha256': hashlib.sha256(b'fixture').hexdigest()}
            self.assertTrue(r.existing(fd, 'x', e)); self.assertFalse(r.existing(fd, 'missing', e))
            with self.assertRaises(r.Stop): r.existing(fd, 'x', {**e, 'sha256': '0' * 64})
            with self.assertRaises(r.Stop): r.existing(fd, 'x', {**e, 'mode': 0o444})
            os.link(temp + '/x', temp + '/link')
            with self.assertRaises(r.Stop): r.existing(fd, 'x', e)
            os.symlink('x', temp + '/sym')
            with self.assertRaises(OSError): r.existing(fd, 'sym', e)
            os.close(fd)

    def test_controller_reuses_source_without_network(self):
        cpath = '/private/tmp/gitea-job-feedcontroller-1d3e6c9b.py'
        if not os.path.exists(cpath):
            self.skipTest('Controller is Mac-only; absent in target image')
        spec = importlib.util.spec_from_file_location('controller', cpath)
        controller = importlib.util.module_from_spec(spec); spec.loader.exec_module(controller)
        source = controller.load('source', '/private/tmp/gitea-paged-source-1d3e6c9b.py')
        class Fake:
            def __init__(self, *args):
                self.binding = {'manifest_sha256': r.HASHES[0], 'companion_sha256': r.HASHES[1],
                                'entries': 46327, 'companion_entries': 37, 'combined_entries': 46364,
                                'total_bytes': 5974032339, 'covered_oversize': 37, 'coverage_verified': True}
        source.PagedSource = Fake
        with mock.patch.object(controller, 'load', return_value=source):
            controller.source_session()
        compile(source.REMOTE, '<remote in-memory template>', 'exec')
        self.assertIn("(small['entries']+large['entries'])[offset:offset+limit]", source.REMOTE)
        self.assertIn("initial['manifest_key'],initial['companion_key']", source.REMOTE)

    def test_pair_rejects_partial(self):
        with self.assertRaises(r.Stop): r.validate_pair([{}, {}])

    def test_complete_fixed_coverage_and_omissions(self):
        pair = []
        for n, (count, total) in enumerate([(46327, 5974032339), (37, 7490258770)]):
            unit, remainder = divmod(total, count)
            rows = []
            for i in range(count):
                path = ('git/lfs/' if n == 0 else 'git/repositories/') + ('fixture-%05d' % i)
                rows.append({'path': path, 'key': r.KEYS[n].rsplit('/', 1)[0] + '/files/' + path,
                             'size': unit + (1 if i < remainder else 0), 'mode': 0o644,
                             'sha256': '0' * 64, 'get_verified': True})
            pair.append({'entries': rows, 'database_included': False, 'hot_snapshot_atomic': False,
                         'omitted': {k: (37 if n == 0 and k == 'oversize' else 0) for k in
                                     ['unsafe', 'oversize', 'changed', 'error', 'limits', 'missing_roots']},
                         'max_file_bytes': 67108864 if n == 0 else 1073741824})
        pair[1].update(selected_range_complete=True, min_file_bytes=67108865, excluded_below_range=46327)
        self.assertEqual(len(r.validate_pair(pair)), 46364)
        pair[0]['omitted']['changed'] = 1
        with self.assertRaises(r.Stop): r.validate_pair(pair)
        pair[0]['omitted']['changed'] = 0
        pair[1]['excluded_below_range'] = 46326
        with self.assertRaises(r.Stop): r.validate_pair(pair)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux renameat2 required; do not substitute weaker rename')
    def test_atomic_no_replace(self):
        with tempfile.TemporaryDirectory() as temp:
            fd = r.directory(os.path.realpath(temp))
            r.exclusive(fd, 'test', b'first')
            with self.assertRaises(r.Stop): r.exclusive(fd, 'test', b'second')
            self.assertEqual(r.read_file(fd, 'test', 64), b'first')
            os.close(fd)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux atomic publish required')
    def test_stream_hash_mode_skip_and_refuse_overwrite(self):
        class Response(io.BytesIO):
            headers = {'Content-Length': '7'}
        with tempfile.TemporaryDirectory() as temp:
            fd = r.directory(os.path.realpath(temp))
            e = {'path': 'git/lfs/test', 'key': 'gitea-live-sync/test', 'size': 7,
                 'sha256': hashlib.sha256(b'fixture').hexdigest(), 'mode': 0o444}
            with mock.patch.object(r, 'get', return_value=Response(b'fixture')) as get:
                self.assertEqual(r.receive(fd, e, 'not_a_live_url'), 'received')
                self.assertEqual(r.receive(fd, e, 'not_a_live_url'), 'verified_existing')
                self.assertEqual(get.call_count, 1)
            with self.assertRaises(r.Stop): r.receive(fd, {**e, 'size': 0}, 'not_a_live_url')
            self.assertEqual(os.stat(temp + '/git/lfs/test').st_mode & 0o777, 0o444)
            os.close(fd)

if __name__ == '__main__':
    unittest.main()
