\set ON_ERROR_STOP on
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\copy (SELECT id,lower(owner_name),lower_name,CASE WHEN is_empty THEN 'true' ELSE 'false' END,object_format_name FROM public.repository ORDER BY id) TO '/var/run/postgresql/repositories.tsv' WITH (FORMAT TEXT)
\copy (SELECT lower(r.owner_name),r.lower_name,b.commit_id FROM public.branch b JOIN public.repository r ON r.id=b.repo_id WHERE NOT b.is_deleted ORDER BY r.id,b.id) TO '/var/run/postgresql/branch-commits.tsv' WITH (FORMAT TEXT)
SELECT (SELECT setting_value='true' FROM public.system_setting WHERE setting_key='picture.disable_gravatar')
 AND (SELECT setting_value='false' FROM public.system_setting WHERE setting_key='picture.enable_federated_avatar') AS gate \gset
\if :gate
\else
SELECT 1/0;
\endif
COMMIT;
