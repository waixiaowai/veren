"""Offline one-shot file increment. Requires completed base receiver, no app writers.
All business reads and writes stay on Olares. Unknown results are never replayed.
"""
import concurrent.futures, ctypes, hashlib, json, os, re, stat, time

DATA='/data'
DELTA='/delta'
QUEUE='/base-receipts'
RUN='0f708b720e425540712b8dc193f3dd24'
MANIFEST_SHA='f08ca3133cf051825c25701fe2d0a826da588904fb9a520ed5147e79a2ca17d9'
BASE_HASHES=['12266696c77d7ba2a60daca800f9cf08fddd8db189fab53456c15679f9ff802f','84a0adfd673e50aa839696cacfed5f42ad49e7bded0cd7e7161d292989dbaf4c']
ROOTS=('git/repositories','git/lfs','gitea/attachments','gitea/avatars','gitea/repo-avatars','gitea/packages','gitea/actions_artifacts')
PRESERVED='git/repositories/comi-logic/loomart.git/objects/pack/pack-f1cae389bc41df2afb1f6cef1489cd52c2c1b87a.pack.previous-download-31'
DIR=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
READ=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK

def check(ok,code):
    if not ok: raise RuntimeError(code)

def path_ok(path):
    check(isinstance(path,str) and any(path.startswith(r+'/') for r in ROOTS),'path_root')
    check(all(x not in ('','.','..') for x in path.split('/')) and '\\' not in path and '\x00' not in path,'path_component')

def parent(path,create=False):
    path_ok(path)
    fd=os.open(DATA,DIR)
    try:
        for part in path.split('/')[:-1]:
            if create:
                try: os.mkdir(part,0o755,dir_fd=fd)
                except FileExistsError: pass
            nxt=os.open(part,DIR,dir_fd=fd);os.close(fd);fd=nxt
        return fd,path.rsplit('/',1)[1]
    except BaseException:
        os.close(fd);raise

def verify_fd(fd,e,mode=None):
    a=os.fstat(fd)
    check(stat.S_ISREG(a.st_mode) and a.st_nlink==1 and a.st_uid==a.st_gid==1000,'file_identity')
    check(a.st_size==e['size'] and stat.S_IMODE(a.st_mode)==(e['mode'] if mode is None else mode),'file_size_mode')
    h=hashlib.sha256()
    while True:
        b=os.read(fd,1024*1024)
        if not b: break
        h.update(b)
    z=os.fstat(fd)
    check((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns),'file_changed')
    check(h.hexdigest()==e['sha256'],'file_hash')
    return (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)

def verify_path(path,e):
    fd,name=parent(path)
    try:
        f=os.open(name,READ,dir_fd=fd)
        try:return verify_fd(f,e)
        finally:os.close(f)
    finally:os.close(fd)

def new_file(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())

def copy_fd(src,dst,mode):
    os.lseek(src,0,os.SEEK_SET)
    while True:
        b=os.read(src,1024*1024)
        if not b:break
        view=memoryview(b)
        while view:view=view[os.write(dst,view):]
    os.fchmod(dst,mode);os.fsync(dst)

def load_base():
    pub=json.load(open(QUEUE+'/public.json'))
    check(pub['run']==RUN and pub['manifest_sha256']==BASE_HASHES,'receiver_binding')
    files=sorted(x for x in os.listdir(QUEUE) if re.fullmatch(r'\d{6}\.done',x))
    check(len(files)>2 and files==['%06d.done'%i for i in range(len(files))],'receipt_sequence')
    first=json.load(open(QUEUE+'/'+files[0]));check(first=={'seq':0,'coverage':46364,'manifest_sha256':BASE_HASHES},'bootstrap_receipt')
    finish=json.load(open(QUEUE+'/'+files[-1]));check(finish=={'seq':len(files)-1,'files_verified':46364},'finish_required')
    # Receiver exits 30 seconds after this durable finish receipt.
    check(time.time()-os.stat(QUEUE+'/'+files[-1]).st_mtime>=45,'receiver_exit_grace')
    index={}
    for seq,name in enumerate(files[1:-1],1):
        page=json.load(open(QUEUE+'/'+name));check(page['seq']==seq,'page_seq')
        for e in page['files']:
            path_ok(e['path']);check(e['path'] not in index,'duplicate_base_path');index[e['path']]=e
    check(len(index)==46364,'base_count')
    return index

def absent(path):
    try:
        fd,name=parent(path)
    except FileNotFoundError:return True
    try:
        try:os.stat(name,dir_fd=fd,follow_symlinks=False);return False
        except FileNotFoundError:return True
    finally:os.close(fd)

def inventory(index):
    seen=set();extras=[]
    for root in ROOTS:
        for directory,dirs,files in os.walk(DATA+'/'+root,followlinks=False):
            for name in dirs:
                check(not os.path.islink(directory+'/'+name),'symlink_directory')
            for name in files:
                path=os.path.relpath(directory+'/'+name,DATA)
                if path in index:seen.add(path)
                else:extras.append(path)
    check(seen==set(index),'file_coverage')
    check(extras==[PRESERVED] and PRESERVED[:-len('.previous-download-31')] in index,'unexpected_extra')
    verify_path(extras[0],{'size':0,'mode':0o644,'sha256':hashlib.sha256(b'').hexdigest()})
    return extras

def apply_one(n,e,work):
    path=e['path'];fd,name=parent(path,True)
    try:
        old=None
        if e['kind']=='modified':
            f=os.open(name,READ,dir_fd=fd)
            try:
                old=verify_fd(f,e['previous'])
                backup=work+'/before-%06d.bin'%n
                b=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                try:copy_fd(f,b,0o600)
                finally:os.close(b)
                b=os.open(backup,READ)
                try:verify_fd(b,e['previous'],0o600)
                finally:os.close(b)
            finally:os.close(f)
        else:check(absent(path),'new_file_exists')
        temp='.clone-increment-'+os.urandom(16).hex()
        src=os.open(DELTA+'/f%06d.bin'%n,READ)
        dst=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
        try:
            verify_fd(src,e,0o600);copy_fd(src,dst,e['mode'])
        finally:os.close(src);os.close(dst)
        tf=os.open(temp,READ,dir_fd=fd)
        try:verify_fd(tf,e)
        finally:os.close(tf)
        new_file(work+'/%06d.intent.json'%n,json.dumps(e,sort_keys=True).encode())
        if old:
            s=os.stat(name,dir_fd=fd,follow_symlinks=False)
            check(old==(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns),'replace_cas')
            os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)
        else:
            rename=ctypes.CDLL(None,use_errno=True).renameat2
            rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
            rename.restype=ctypes.c_int
            check(rename(fd,temp.encode(),fd,name.encode(),1)==0,'publish_noreplace')
        os.fsync(fd);verify_path(path,e)
        new_file(work+'/%06d.done'%n,b'VERIFIED\n')
    finally:os.close(fd)

def main():
    os.umask(0o077);check(os.getuid()==os.getgid()==1000,'identity')
    raw=open(DELTA+'/manifest.json','rb').read();check(hashlib.sha256(raw).hexdigest()==MANIFEST_SHA,'manifest_hash')
    manifest=json.loads(raw);check(manifest['base_manifest_sha256']==BASE_HASHES and manifest['deletions']==[],'manifest_scope')
    entries=manifest['entries'];check(len(entries)==739 and sum(e['kind']=='modified' for e in entries)==8,'delta_count')
    index=load_base();work=DELTA+'/apply-r1';os.mkdir(work,0o700)
    new_file(work+'/intent',b'FILE_DELTA_APPLY_ONCE\n')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda e:verify_path(e['path'],e),index.values()))
    extras=inventory(index)
    for n,e in enumerate(entries):
        path_ok(e['path']);check(e['kind'] in ('added','modified'),'delta_kind')
        if e['kind']=='modified':check(e['previous']=={k:index[e['path']][k] for k in ('size','sha256','mode')},'previous_binding')
        else:check(e['path'] not in index and absent(e['path']),'added_collision')
        f=os.open(DELTA+'/f%06d.bin'%n,READ)
        try:verify_fd(f,e,0o600)
        finally:os.close(f)
    new_file(work+'/preflight-verified',b'BASE_AND_DELTA_VERIFIED\n')
    # New Git objects are published before any mutable refs/reflogs.
    for n,e in sorted(enumerate(entries),key=lambda pair:pair[1]['kind']=='modified'):
        apply_one(n,e,work);index[e['path']]={k:e[k] for k in ('path','size','mode','sha256')}
    check(len(index)==47095,'result_count');inventory(index)
    output={'status':'FILE_DELTA_APPLIED_VERIFIED_APP_OFF','files':len(index),'added':731,'modified':8,'preserved_extras':extras,'manifest_sha256':MANIFEST_SHA}
    new_file(work+'/post-manifest.json',json.dumps({'entries':list(index.values())},sort_keys=True).encode())
    new_file(work+'/result.json',(json.dumps(output,sort_keys=True)+'\n').encode())
    fd=os.open(work,DIR);os.fsync(fd);os.close(fd)
    print(json.dumps(output),flush=True)

if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'status':'FILE_DELTA_STOP_APP_OFF','error_class':type(e).__name__,'code':str(e) if isinstance(e,RuntimeError) else 'filesystem_or_data_error'}),flush=True)
        raise SystemExit(1)
