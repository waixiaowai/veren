#!/bin/sh
set -eu
umask 077
stage=identity
trap 'rc=$?; if [ "$rc" != 0 ] && [ -d /runtime/prestart ]; then printf "FAILED stage=%s exit=%s\n" "$stage" "$rc" >> /runtime/prestart/failure-r4; fi' EXIT
fail() { printf 'CLONE_GITEA_GATE_FAILED stage=%s\n' "$stage" >&2; exit 78; }
[ "$(id -u):$(id -g)" = 1000:1000 ] || fail
stage=config
[ "$(stat -c '%u:%g:%a:%h' /reviewed/app.ini)" = 1000:1000:600:1 ] || fail
[ "$(stat -c '%u:%g:%a:%h' /reviewed/secret.key)" = 1000:1000:600:1 ] || fail
[ "$(sha256sum /reviewed/app.ini | cut -d ' ' -f1)" = 762f39577ea9ce80964e66ab0f52c5e2cab4d3f3783a0d048b067eced5e1f40a ] || fail
[ ! -L /reviewed/app.ini ] && [ ! -L /reviewed/secret.key ] || fail
grep -q 'REPOSITORIES_ISOLATED_APP_OFF' /isolation/result.json || fail
grep -q 'FILE_DELTA_APPLIED_VERIFIED_APP_OFF' /file-result/result.json || fail
stage=business_roots
for root in git/repositories git/lfs gitea/attachments gitea/avatars gitea/repo-avatars gitea/packages gitea/actions_artifacts; do
  [ -d "/data/$root" ] && [ ! -L "/data/$root" ] && [ "$(stat -c '%u:%g' "/data/$root")" = 1000:1000 ] || fail
done
chmod 700 /runtime
for sub in work custom data tmp git-home prestart; do mkdir -p "/runtime/$sub"; chmod 700 "/runtime/$sub"; done
export HOME=/runtime/git-home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_GLOBAL=/runtime/git-home/.gitconfig
unset GIT_CONFIG GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
stage=egress_block
command -v curl >/dev/null 2>&1 || fail
for endpoint in https://150.5.143.84/ https://122.228.29.101/ https://1.1.1.1/; do
  rc=0
  curl --noproxy '*' --silent --output /dev/null --connect-timeout 3 --max-time 4 "$endpoint" || rc=$?
  [ "$rc" = 28 ] || fail
done
printf '%s\n' 'PRODUCTION_TOS_AND_PUBLIC_EGRESS_BLOCKED' > /runtime/prestart/egress-blocked
stage=database_ready
for n in $(seq 1 180); do
  [ -f /var/run/postgresql/clone-db-ready ] && break
  sleep 1
done
[ "$(cat /var/run/postgresql/clone-db-ready)" = CLONE_DATABASE_READY ] || fail
stage=binary_version
version=$(/usr/local/bin/gitea --version)
printf '%s\n' "$version" > /runtime/prestart/binary-version.txt
printf '%s\n' "$version" | grep -Eqi '^Gitea version 1\.25\.5([ +]|$)' || fail
if [ ! -f /runtime/prestart/verified ]; then
  stage=first_start_exclusive
  mkdir -m 700 /runtime/prestart/attempt-r4
  stage=repository_config_hashes
  sha256sum -c /isolation/configs.sha256 > /runtime/prestart/attempt-r4/configs.log 2>&1 || fail
  [ "$(wc -l < /var/run/postgresql/repositories.tsv | tr -d ' ')" = 253 ] || fail
  count=0
  tab=$(printf '\t')
  stage=required_empty_directories
  find /data/git/repositories -type f -name config | LC_ALL=C sort > /runtime/prestart/attempt-r4/config-paths.list
  [ "$(wc -l < /runtime/prestart/attempt-r4/config-paths.list | tr -d ' ')" = 254 ] || fail
  while IFS= read -r config; do
    repo=${config%/config}
    case "$repo" in /data/git/repositories/*/*.git) ;; *) fail ;; esac
    for sub in refs objects objects/info objects/pack; do
      dir="$repo/$sub"
      [ ! -L "$dir" ] || fail
      if [ ! -e "$dir" ]; then mkdir -m 700 "$dir"; printf '%s\n' "$dir" >> /runtime/prestart/attempt-r4/created-empty-directories; fi
      [ -d "$dir" ] && [ "$(stat -c '%u:%g' "$dir")" = 1000:1000 ] || fail
    done
  done < /runtime/prestart/attempt-r4/config-paths.list
  stage=database_repository_paths
  while IFS="$tab" read -r ident owner repo empty format; do
    printf '%s\n' "$owner" "$repo" | LC_ALL=C grep -Eqv '^[a-z0-9_][a-z0-9_.-]*$' && fail
    stage=database_repository_path_$ident
    path="/data/git/repositories/$owner/$repo.git"
    [ -d "$path" ] && [ ! -L "$path" ] || fail
    [ "$(git --git-dir="$path" rev-parse --is-bare-repository 2>/runtime/prestart/attempt-r4/git-repository-check.stderr)" = true ] || fail
    count=$((count+1))
  done < /var/run/postgresql/repositories.tsv
  [ "$count" = 253 ] || fail
  find /data/git/repositories -type d -name '*.git' | LC_ALL=C sort > /runtime/prestart/attempt-r4/repositories.list
  [ "$(wc -l < /runtime/prestart/attempt-r4/repositories.list | tr -d ' ')" = 254 ] || fail
  count=0
  while IFS= read -r repo; do
    count=$((count+1))
    stage=git_fsck_$count
    git --git-dir="$repo" fsck --full --no-dangling > "/runtime/prestart/attempt-r4/fsck-$count.log" 2>&1 || fail
  done < /runtime/prestart/attempt-r4/repositories.list
  count=0
  stage=database_branch_commits
  while IFS="$tab" read -r owner repo oid; do
    printf '%s\n' "$owner" "$repo" | LC_ALL=C grep -Eqv '^[a-z0-9_][a-z0-9_.-]*$' && fail
    printf '%s\n' "$oid" | LC_ALL=C grep -Eq '^([a-f0-9]{40}|[a-f0-9]{64})$' || fail
    git --git-dir="/data/git/repositories/$owner/$repo.git" cat-file -e "$oid^{commit}" 2>/dev/null || fail
    count=$((count+1))
  done < /var/run/postgresql/branch-commits.tsv
  printf '%s\n' "$count" > /runtime/prestart/attempt-r4/branch-commits-verified
  stage=regenerate_hooks
  /usr/local/bin/gitea --work-path /runtime/work --custom-path /runtime/custom --config /reviewed/app.ini admin regenerate hooks > /runtime/prestart/attempt-r4/regenerate-hooks.log 2>&1 || fail
  count=0
  while IFS= read -r repo; do
    stage=verify_generated_hooks
    [ "$(find "$repo/hooks" -type f | wc -l | tr -d ' ')" = 8 ] || fail
    for name in pre-receive update post-receive proc-receive; do
      [ -x "$repo/hooks/$name" ] && [ ! -L "$repo/hooks/$name" ] || fail
      cmp -s "$repo/hooks/$name" "/code/hook-$name" || fail
      if [ "$name" = proc-receive ]; then
        [ -f "$repo/hooks/$name.d/gitea" ] && [ ! -s "$repo/hooks/$name.d/gitea" ] || fail
      else
        cmp -s "$repo/hooks/$name.d/gitea" "/code/hook-$name-delegate" || fail
      fi
      sha256sum "$repo/hooks/$name" "$repo/hooks/$name.d/gitea" >> /runtime/prestart/attempt-r4/hooks.sha256
    done
    count=$((count+1))
  done < /runtime/prestart/attempt-r4/repositories.list
  [ "$count" = 254 ] || fail
  printf '%s\n' 'GIT_FSCK_254_AND_BRANCH_COMMITS_AND_HOOKS_VERIFIED' > /runtime/prestart/verified
  sync /runtime/prestart/verified
fi
[ "$(cat /runtime/prestart/verified)" = GIT_FSCK_254_AND_BRANCH_COMMITS_AND_HOOKS_VERIFIED ] || fail
stage=current_hooks_guard
# Gitea rewrites its own generated hook config path when web starts with the
# derived runtime INI. Accept only either exact reviewed template, never an
# arbitrary changed hook or an extra hook file.
count=0
while IFS= read -r repo; do
  [ "$(find "$repo/hooks" -type f | wc -l | tr -d ' ')" = 8 ] || fail
  for name in pre-receive update post-receive proc-receive; do
    for suffix in "" ".d/gitea"; do
      hook="$repo/hooks/$name$suffix"
      [ -f "$hook" ] && [ ! -L "$hook" ] || fail
      if [ "$suffix" = ".d/gitea" ] && [ "$name" = proc-receive ]; then
        [ ! -s "$hook" ] || fail
      else
        template="/code/hook-$name"
        [ -z "$suffix" ] || template="$template-delegate"
        if ! cmp -s "$hook" "$template"; then
          sed 's|--config=/reviewed/app.ini|--config=/runtime/active/app.ini|g' "$template" > /runtime/prestart/expected-hook
          cmp -s "$hook" /runtime/prestart/expected-hook || fail
        fi
      fi
    done
    [ -x "$repo/hooks/$name" ] || fail
  done
  count=$((count+1))
done < /runtime/prestart/attempt-r4/repositories.list
[ "$count" = 254 ] || fail
printf '%s\n' 'EXACT_REVIEWED_OR_RUNTIME_HOOK_TEMPLATES_254_VERIFIED' > /runtime/prestart/hooks-runtime-verified
printf '%s\n' 'CLONE_WEB_STARTING_AFTER_GATES'
stage=ssh_runtime_config
mkdir -p /runtime/active /runtime/ssh
chmod 700 /runtime/active /runtime/ssh
awk -f /code/ssh-runtime-config.awk /reviewed/app.ini > /runtime/active/app.ini.next || fail
chmod 600 /runtime/active/app.ini.next
mv /runtime/active/app.ini.next /runtime/active/app.ini
exec /usr/local/bin/gitea --work-path /runtime/work --custom-path /runtime/custom --config /runtime/active/app.ini web
