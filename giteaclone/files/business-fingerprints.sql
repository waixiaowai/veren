\set ON_ERROR_STOP on
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='3s';
SET LOCAL bytea_output='hex';
WITH excluded(table_name,columns,delete_rows) AS (VALUES
 ('access_token','{}',true),('auth_token','{}',true),('session','{}',true),
 ('oauth2_authorization_code','{}',true),('oauth2_grant','{}',true),('oauth2_application','{}',true),
 ('action_runner_token','{}',true),('secret','{}',true),
 ('action_runner','{token_hash,token_salt}',false),
 ('action_task','{token_hash,token_salt,token_last_eight}',false),
 ('user','{rands}',false),
 ('webhook','{url,secret,meta,header_authorization_encrypted,is_active}',false),
 ('hook_task','{payload_content,request_content,response_content,is_delivered}',false),
 ('mirror','{remote_address,lfs_endpoint,interval,next_update_unix}',false),
 ('push_mirror','{remote_address,interval,sync_on_commit,last_error}',false),
 ('repository','{original_url,is_mirror}',false),
 ('login_source','{cfg,is_active,is_sync_enabled}',false),
 ('external_login_user','{raw_data,access_token,access_token_secret,refresh_token,expires_at}',false),
 ('task','{payload_content,message}',false)
)
SELECT format($f$SELECT json_build_object('table',%L,'rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to((to_jsonb(t)-%L::text[])::text,'UTF8')),'hex') h FROM public.%I t)x;$f$,c.relname,coalesce(e.columns,'{}'),c.relname)
FROM pg_class c LEFT JOIN excluded e ON e.table_name=c.relname
WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT coalesce(e.delete_rows,false)
ORDER BY c.relname
\gexec
COMMIT;
