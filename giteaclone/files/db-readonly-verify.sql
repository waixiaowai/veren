\set ON_ERROR_STOP on
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='120s';
SELECT coalesce(current_database()='gitea_live_20261028_307ac94f2d6b'
 AND current_user='gitea_live_20261028_307ac94f2d6b_owner' AND session_user=current_user
 AND current_setting('listen_addresses')=''
 AND (SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname=current_user)
 AND (SELECT shobj_description(oid,'pg_database')='operation=gitea_live_20261028_307ac94f2d6b;input=367a1630622d17f08a5bef79131ce744b3dc12536926904d33d2b605699f3e76' FROM pg_database WHERE datname=current_database()),false) AS gate \gset
\if :gate
\else
SELECT 1/0;
\endif
SELECT (NOT EXISTS(SELECT FROM public.access_token) AND NOT EXISTS(SELECT FROM public.auth_token) AND NOT EXISTS(SELECT FROM public.session) AND NOT EXISTS(SELECT FROM public.oauth2_authorization_code) AND NOT EXISTS(SELECT FROM public.oauth2_grant) AND NOT EXISTS(SELECT FROM public.oauth2_application) AND NOT EXISTS(SELECT FROM public.action_runner_token) AND NOT EXISTS(SELECT FROM public.secret)) AND NOT (EXISTS(SELECT FROM public.action_runner WHERE token_hash IS DISTINCT FROM 'revoked-clone:'||id::text OR token_salt IS DISTINCT FROM '')
 OR EXISTS(SELECT FROM public.action_task WHERE token_hash IS DISTINCT FROM 'revoked-clone:'||id::text OR token_salt IS DISTINCT FROM '' OR token_last_eight IS DISTINCT FROM '')
 OR EXISTS(SELECT FROM public.webhook WHERE is_active IS DISTINCT FROM false OR url IS DISTINCT FROM '' OR secret IS DISTINCT FROM '' OR meta IS DISTINCT FROM '' OR header_authorization_encrypted IS DISTINCT FROM '')
 OR EXISTS(SELECT FROM public.hook_task WHERE is_delivered IS DISTINCT FROM true OR payload_content IS DISTINCT FROM '' OR request_content IS DISTINCT FROM '' OR response_content IS DISTINCT FROM '')
 OR EXISTS(SELECT FROM public.mirror WHERE remote_address IS DISTINCT FROM '' OR lfs_endpoint IS DISTINCT FROM '' OR "interval" IS DISTINCT FROM 0 OR next_update_unix IS DISTINCT FROM 0)
 OR EXISTS(SELECT FROM public.push_mirror WHERE remote_address IS DISTINCT FROM '' OR "interval" IS DISTINCT FROM 0 OR sync_on_commit IS DISTINCT FROM false OR last_error IS DISTINCT FROM '')
 OR EXISTS(SELECT FROM public.repository WHERE original_url IS DISTINCT FROM '' OR is_mirror IS DISTINCT FROM false)
 OR EXISTS(SELECT FROM public.login_source WHERE cfg IS DISTINCT FROM '{}' OR is_active IS DISTINCT FROM false OR is_sync_enabled IS DISTINCT FROM false)
 OR EXISTS(SELECT FROM public.external_login_user WHERE raw_data::text IS DISTINCT FROM '{}' OR access_token IS DISTINCT FROM '' OR access_token_secret IS DISTINCT FROM '' OR refresh_token IS DISTINCT FROM '' OR expires_at IS DISTINCT FROM timestamp '1970-01-01 00:00:00')
 OR EXISTS(SELECT FROM public.task WHERE payload_content IS DISTINCT FROM '' OR message IS DISTINCT FROM '')) AND NOT EXISTS(SELECT FROM public."user" WHERE rands IS NULL OR length(rands)<>32) AS safe \gset
\if :safe
\else
SELECT 1/0;
\endif
SELECT json_build_object('identity_verified',true,'credential_neutralization_verified',true,'users',(SELECT count(*) FROM public."user"),'repositories',(SELECT count(*) FROM public.repository),'issues',(SELECT count(*) FROM public.issue),'comments',(SELECT count(*) FROM public.comment));
COMMIT;
