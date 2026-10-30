"""Preserve source hooks/config in private quarantine; install minimal clone config.
Does not execute Git or any source hooks. Runs only after complete file increment.
"""
import configparser, hashlib, importlib.util, json, os, stat
spec=importlib.util.spec_from_file_location('fileops','/code/file-delta-apply.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT='/quarantine'

def minimal(raw):
    p=configparser.RawConfigParser(strict=True);p.read_string(raw.decode('utf-8'))
    f.check(p.has_section('core') and p['core'].getboolean('bare'),'bare_repository')
    version=p['core'].get('repositoryformatversion','');f.check(version in ('0','1'),'repository_format')
    extras=''
    if p.has_section('extensions'):
        f.check(set(p['extensions'])<={'objectformat'},'unknown_repository_extension')
        fmt=p['extensions'].get('objectformat','sha1').lower();f.check(fmt in ('sha1','sha256'),'object_format')
        extras='[extensions]\n\tobjectFormat = '+fmt+'\n'
    return ('[core]\n\trepositoryformatversion = '+version+'\n\tfilemode = true\n\tbare = true\n\tlogallrefupdates = true\n'+extras).encode()

def main():
    os.umask(0o077);f.check(os.getuid()==os.getgid()==1000,'identity')
    result=json.load(open('/delta/apply-r1/result.json'));f.check(result['status']=='FILE_DELTA_APPLIED_VERIFIED_APP_OFF' and result['files']==47095,'file_delta_required')
    index={e['path']:e for e in json.load(open('/delta/apply-r1/post-manifest.json'))['entries']};f.check(len(index)==47095,'index_count')
    configs=sorted(p for p in index if p.endswith('.git/config'))
    hooks=sorted(p for p in index if '/hooks/' in p)
    f.check(len(configs)==254 and len(hooks)==5124,'repository_inventory')
    f.check(not any('/custom_hooks/' in p or p.endswith(('/objects/info/alternates','/objects/info/http-alternates','/info/grafts')) for p in index),'unsafe_git_paths')
    s=os.lstat(OUT);f.check(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==1000 and os.listdir(OUT)==[],'fresh_quarantine')
    os.chmod(OUT,0o700);f.new_file(OUT+'/intent',b'REPOSITORY_ISOLATION_ONCE\n')
    candidates={};records=[]
    # Complete all verified backups before changing even one live repository file.
    for n,path in enumerate(configs+hooks):
        e=index[path];fd,name=f.parent(path)
        try:
            src=os.open(name,f.READ,dir_fd=fd)
            try:
                f.verify_fd(src,e);backup=OUT+'/source-%06d.bin'%n
                dst=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                try:f.copy_fd(src,dst,0o600)
                finally:os.close(dst)
                dst=os.open(backup,f.READ)
                try:f.verify_fd(dst,e,0o600)
                finally:os.close(dst)
                if path in configs:
                    f.check(e['size']<=1024*1024,'config_bound');os.lseek(src,0,0);candidates[path]=minimal(os.read(src,e['size']+1))
                records.append({'source':e,'backup':os.path.basename(backup),'action':'replace_config' if path in candidates else 'remove_hook'})
            finally:os.close(src)
        finally:os.close(fd)
    f.new_file(OUT+'/backups.json',json.dumps(records,sort_keys=True).encode())
    for n,path in enumerate(configs+hooks):
        f.verify_path(path,index[path]);fd,name=f.parent(path)
        try:
            if path in candidates:
                data=candidates[path];tmp='.clone-isolated-config-'+os.urandom(12).hex()
                dst=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
                with os.fdopen(dst,'wb') as stream:stream.write(data);stream.flush();os.fchmod(stream.fileno(),0o644);os.fsync(stream.fileno())
                os.replace(tmp,name,src_dir_fd=fd,dst_dir_fd=fd)
                index[path]={**index[path],'mode':0o644,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()};f.verify_path(path,index[path])
            else:os.unlink(name,dir_fd=fd);del index[path]
            os.fsync(fd)
            f.new_file(OUT+'/%06d.done'%n,b'VERIFIED\n')
        finally:os.close(fd)
    for path in configs:
        root=f.DATA+'/'+path[:-len('config')]+'hooks'
        for directory,dirs,files in os.walk(root,topdown=False,followlinks=False):
            f.check(not files and all(not os.path.islink(directory+'/'+d) for d in dirs),'hook_cleanup')
            os.rmdir(directory)
        os.mkdir(root,0o755)
    for e in (index[p] for p in configs):f.verify_path(e['path'],e)
    f.new_file(OUT+'/configs.sha256',''.join(index[p]['sha256']+'  /data/'+p+'\n' for p in configs).encode())
    output={'status':'REPOSITORIES_ISOLATED_APP_OFF','repository_configs':len(configs),'preserved_source_hooks':len(hooks),'remaining_files_before_regeneration':len(index),'remote_and_execution_config_removed':True}
    f.new_file(OUT+'/post-manifest.json',json.dumps({'entries':list(index.values())},sort_keys=True).encode())
    f.new_file(OUT+'/result.json',(json.dumps(output,sort_keys=True)+'\n').encode())
    fd=os.open(OUT,f.DIR);os.fsync(fd);os.close(fd)
    print(json.dumps(output),flush=True)

if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'status':'REPOSITORY_ISOLATION_STOP','error_class':type(e).__name__,'code':str(e) if isinstance(e,RuntimeError) else 'data_or_filesystem_error'}),flush=True);raise SystemExit(1)
