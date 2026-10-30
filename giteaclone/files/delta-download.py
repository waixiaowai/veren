"""Target-only private TOS downloader. Feed contains ciphertext, never plain URLs.
Only exact operation objects, fixed TLS destination, and a separate delta stage.
"""
import base64, concurrent.futures, ctypes, hashlib, http.client, json, os, re, resource
import socket, ssl, stat, time, urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HOST='bowong-ai.tos-s3-accelerate.volces.com'
IP='122.228.29.101'
ROOT='/delta'
PUBLIC_SHA='03f44d7cc21571d5ccf562bc5adbba32a0cc85f45ab8d3f829568eeb8a047122'
def check(ok,code):
 if not ok:raise RuntimeError(code)
def read_owned(path,limit,mode=0o600):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());check(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==1000 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode,'owned_file')
  data=f.read(limit+1);check(len(data)<=limit,'read_limit');return data
def write_new(path,data):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
def existing(path,e):
 try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 except FileNotFoundError:return False
 with os.fdopen(fd,'rb') as f:
  a=os.fstat(f.fileno());check(stat.S_ISREG(a.st_mode) and a.st_uid==a.st_gid==1000 and stat.S_IMODE(a.st_mode)==0o600 and a.st_nlink==1 and a.st_size==e['size'],'existing_file')
  h=hashlib.sha256()
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
  z=os.fstat(f.fileno());check((a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns),'existing_changed')
  check(h.hexdigest()==e['sha256'],'existing_hash')
 return True
def receive(e):
 path=ROOT+'/'+e['local']
 if existing(path,e):return
 url=urllib.parse.urlsplit(e['url']);check(url.scheme=='https' and url.netloc==HOST and url.path=='/'+e['key'] and not url.fragment,'url_scope')
 for attempt in range(3):
  temp=path+'.part-'+os.urandom(12).hex();conn=None
  try:
   conn=http.client.HTTPSConnection(HOST,timeout=60,context=ssl.create_default_context())
   raw=socket.create_connection((IP,443),timeout=15)
   conn.sock=ssl.create_default_context().wrap_socket(raw,server_hostname=HOST)
   conn.request('GET',url.path+'?'+url.query,headers={'Accept-Encoding':'identity'})
   response=conn.getresponse();check(response.status==200 and response.getheader('Content-Encoding','identity')=='identity','http_status')
   if response.getheader('Content-Length') is not None:check(int(response.getheader('Content-Length'))==e['size'],'content_length')
   fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as f:
    h=hashlib.sha256();count=0
    while True:
     b=response.read(1024*1024)
     if not b:break
     count+=len(b);check(count<=e['size'],'body_limit');h.update(b);f.write(b)
    check(count==e['size'] and h.hexdigest()==e['sha256'],'body_hash');f.flush();os.fsync(f.fileno())
   libc=ctypes.CDLL(None,use_errno=True);rename=libc.renameat2
   rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
   rename.restype=ctypes.c_int
   check(rename(-100,temp.encode(),-100,path.encode(),1)==0,'publish_refused')
   fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
   check(existing(path,e),'readback');return
  except (TimeoutError,ConnectionError,http.client.IncompleteRead):
   if attempt==2:raise
   time.sleep(2*(attempt+1))
  finally:
   if conn is not None:conn.close()
   try:os.unlink(temp)
   except FileNotFoundError:pass
def main():
 os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 check(os.getuid()==os.getgid()==1000,'identity')
 config=json.load(open('/code/delta-download-contract.json'))
 op=config['operation'];check(re.fullmatch(r'production-delta-(?:db|files)-[a-f0-9]{32}',op),'operation')
 s=os.lstat('/delta');check(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==1000,'delta_dir');os.chmod('/delta',0o700)
 feedraw=open('/feed/encrypted.json','rb').read(4*1024*1024+1)
 check(hashlib.sha256(feedraw).hexdigest()==config['feed_sha256'],'feed_hash')
 feed=json.loads(feedraw);check(feed['operation']==op,'feed_operation')
 public=read_owned('/transport/public.pem',1024);check(hashlib.sha256(public).hexdigest()==PUBLIC_SHA,'public_hash')
 private=serialization.load_pem_private_key(read_owned('/transport/private.pem',8192),password=None)
 check(private.key_size==4096 and private.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)==public,'private_binding')
 label=b'GITEA-DELTA-FEED-V1:'+op.encode()
 key=private.decrypt(base64.b64decode(feed['wrapped'],validate=True),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=label))
 payload=json.loads(AESGCM(key).decrypt(base64.b64decode(feed['nonce'],validate=True),base64.b64decode(feed['cipher'],validate=True),label));del key,private
 check(set(payload)=={'operation','entries'} and payload['operation']==op,'payload')
 entries=payload['entries'];check(1<=len(entries)<=1024 and len(entries)==len(config['entries']),'entry_count')
 seen=set()
 for e,expected in zip(entries,config['entries']):
  check(set(e)=={'local','key','size','sha256','url'} and {k:v for k,v in e.items() if k!='url'}==expected,'entry_binding')
  check(re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}',e['local']) and e['local'] not in seen,'local_name');seen.add(e['local'])
  check(e['key'].startswith('gitea-live-sync/'+op+'/') and '/..' not in e['key'],'key_scope')
  check(type(e['size']) is int and 0<=e['size']<=128*1024*1024 and re.fullmatch('[a-f0-9]{64}',e['sha256']),'file_bounds')
 write_new('/delta/download-intent',op.encode()+b'\n')
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(receive,entries))
 result={'status':'DELTA_DOWNLOADED_VERIFIED','operation':op,'files':len(entries),'bytes':sum(e['size'] for e in entries),'contract_sha256':hashlib.sha256(open('/code/delta-download-contract.json','rb').read()).hexdigest()}
 write_new('/delta/download-result.json',(json.dumps(result,sort_keys=True)+'\n').encode())
 fd=os.open('/delta',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
 print(json.dumps(result),flush=True)
if __name__=='__main__':
 try:main()
 except BaseException as e:
  print(json.dumps({'status':'DELTA_DOWNLOAD_STOP','error_class':type(e).__name__}),flush=True);raise SystemExit(1)
