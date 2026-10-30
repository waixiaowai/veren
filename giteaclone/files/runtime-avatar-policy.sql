\set ON_ERROR_STOP on
\set QUIET on
BEGIN;
SET LOCAL lock_timeout='3s';
LOCK TABLE public.system_setting IN EXCLUSIVE MODE;
\copy (SELECT * FROM public.system_setting WHERE setting_key IN ('picture.disable_gravatar','picture.enable_federated_avatar','revision')) TO '/pg-guard/first-start/before-avatar-policy.csv' WITH (FORMAT CSV, FORCE_QUOTE *)
INSERT INTO public.system_setting(setting_key,setting_value,version,created,updated)
VALUES ('picture.disable_gravatar','true',1,extract(epoch from now())::bigint,extract(epoch from now())::bigint),
       ('picture.enable_federated_avatar','false',1,extract(epoch from now())::bigint,extract(epoch from now())::bigint)
ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,version=system_setting.version+1,updated=excluded.updated;
UPDATE public.system_setting SET version=version+1 WHERE setting_key='revision';
COMMIT;
\echo CLONE_AVATAR_POLICY_VERIFIED
