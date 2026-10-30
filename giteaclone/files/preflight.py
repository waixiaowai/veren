import os,sys,subprocess,json,socket,unittest,importlib.util
assert os.geteuid()==1000 and os.getegid()==1000
os.umask(0o077)
subprocess.run([sys.executable,'-B','-m','pip','--isolated','install','--no-index','--find-links','/wheels','--target','/tmp/vendor','--require-hashes','--only-binary=:all:','--no-deps','--no-compile','--no-cache-dir','--disable-pip-version-check','-r','/receiver/requirements.lock'],check=True)
sys.path.insert(0,'/tmp/vendor');os.environ['RECEIVER_SCRIPT']='/receiver/receiver.py'
spec=importlib.util.spec_from_file_location('tests','/receiver/tests.py');tests=importlib.util.module_from_spec(spec);spec.loader.exec_module(tests)
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(tests))
assert result.wasSuccessful() and result.testsRun==9 and len(result.skipped)==1
host='bowong-ai.tos-s3-accelerate.volces.com'
addresses=sorted({a[4][0] for a in socket.getaddrinfo(host,443,socket.AF_INET,socket.SOCK_STREAM)})
assert addresses
print(json.dumps({'linux_tests':9,'passed':8,'skipped_mac_controller':1,'uid':os.geteuid(),'gid':os.getegid(),'tos_host':host,'tos_ipv4':addresses}),flush=True)
for host in [addresses[0],'1.1.1.1']:
 try:
  with socket.create_connection((host,443),timeout=3): pass
 except (TimeoutError,OSError) as e: print(json.dumps({'dns_only_egress_check':host,'connected':False,'error_class':type(e).__name__}),flush=True)
 else: raise RuntimeError('dns_only_policy_unexpected_443_connection')
print('LINUX_PREFLIGHT_PASSED_APP_OFF',flush=True)
