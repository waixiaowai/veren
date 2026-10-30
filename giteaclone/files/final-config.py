"""Create clone-only config once, entirely on target; never print secret material."""
import base64, configparser, hashlib, json, os, re, stat

def check(ok,code):
    if not ok:raise RuntimeError(code)

def owned_read(path,size=None):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        check(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==s.st_gid==1000 and stat.S_IMODE(s.st_mode)==0o600,'private_file')
        b=f.read(8193);check(0<len(b)<=8192 and (size is None or len(b)==size),'private_size');return b

def write(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())

def render(template,password,secret):
    check(re.fullmatch(rb'[a-f0-9]{64}',password) is not None,'owner_password_format')
    # Gitea 1.25.5 loadSecret trims URI file content. Require exact equivalence.
    check(secret.decode('utf-8').strip().encode('utf-8')==secret and b'\x00' not in secret,'secret_uri_exactness')
    b64=lambda n:base64.urlsafe_b64encode(os.urandom(n)).decode().rstrip('=')
    values={'__EXISTING_RESTRICTED_CLONE_PASSWORD_PRIVATE_INJECTION__':password.decode(),
            '__NEW_CLONE_INTERNAL_TOKEN_PRIVATE_INJECTION__':b64(64),
            '__NEW_CLONE_BASE64URL_LFS_SECRET__':b64(32),
            '__NEW_CLONE_BASE64URL_GENERAL_SIGNING_SECRET__':b64(32)}
    result=template
    for k,v in values.items():check(result.count(k)==1,'placeholder_count');result=result.replace(k,v)
    check('__' not in result,'unresolved_placeholder')
    p=configparser.RawConfigParser(strict=True);p.read_string('[DEFAULT]\n'+result)
    check('secret_key' not in p['security'] and p['security']['secret_key_uri']=='file:/reviewed/secret.key','secret_uri')
    check(p['database']['passwd']==password.decode(),'password_roundtrip')
    check(p['server']['root_url']=='https://gitea.comilogic.olares.cn/' and p['server']['http_addr']=='127.0.0.1','server_scope')
    for section,key in [('security','install_lock'),('security','disable_git_hooks'),('security','disable_webhooks'),('service','disable_registration'),('server','disable_ssh')]:check(p[section].getboolean(key),'disabled_feature')
    for section in ('actions','mirror','mailer','email.incoming','oauth2'):check(not p[section].getboolean('enabled'),'outgoing_feature')
    cron=[s for s in p.sections() if s.startswith('cron.')];check(len(cron)==29 and all(not p[s].getboolean('enabled') and not p[s].getboolean('run_at_start') for s in cron),'cron')
    check(secret not in result.encode(),'original_secret_in_ini')
    return result.encode()

def main():
    os.umask(0o077);check(os.getuid()==os.getgid()==1000,'identity')
    s=os.lstat('/output');check(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==1000,'output_directory');os.chmod('/output',0o700)
    check(os.listdir('/output')==[],'output_not_empty')
    write('/output/intent',b'FINAL_CONFIG_GENERATE_ONCE\n')
    secret=owned_read('/credentials/secret.key');password=owned_read('/credentials/owner-password',64)
    data=render(open('/code/final-app.ini.template').read(),password,secret)
    write('/output/app.ini',data);check(owned_read('/output/app.ini')==data,'config_readback')
    report={'status':'FINAL_CONFIG_GENERATED_APP_OFF','sha256':hashlib.sha256(data).hexdigest(),'secret_uri_exact':True,'ssh_disabled':True,'external_features_disabled':True,'cron_disabled':29}
    write('/output/result.json',(json.dumps(report,sort_keys=True)+'\n').encode())
    fd=os.open('/output',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    print(json.dumps(report),flush=True)

if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'status':'FINAL_CONFIG_STOP','error_class':type(e).__name__,'code':str(e) if isinstance(e,RuntimeError) else 'private_render_failed'}),flush=True);raise SystemExit(1)
