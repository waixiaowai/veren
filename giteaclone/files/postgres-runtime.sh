#!/bin/bash
set -euo pipefail
umask 077
export LC_ALL=C
fail() { printf '%s\n' 'CLONE_DATABASE_GATE_FAILED' >&2; exit 78; }
[[ $(id -u) == 1000 && $(id -g) == 1000 && $(cat /pgdata/PG_VERSION) == 15 ]] || fail
[[ ! -L /pgdata && ! -e /pgdata/postmaster.pid ]] || fail
[[ $(stat -c '%u:%g:%a:%s:%h' /credentials/owner-password) == 1000:1000:600:64:1 ]] || fail
[[ $(stat -c '%u:%g:%a:%s:%h' /credentials/admin-password) == 1000:1000:600:65:1 ]] || fail
[[ ! -L /credentials/owner-password && ! -L /credentials/admin-password ]] || fail
chmod 700 /pg-guard
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGHOST PGHOSTADDR PGPORT PGOPTIONS PGPASSFILE PGSSLMODE
export PGDATA=/pgdata POSTGRES_PASSWORD_FILE=/credentials/admin-password
export PGHOST=/var/run/postgresql PGUSER=clone_restore_admin PGDATABASE=postgres PGPORT=5432
child=''
cleanup() {
  if [[ -n "$child" ]] && kill -0 "$child" 2>/dev/null; then
    pg_ctl -D /pgdata -m fast -w -t 30 stop >/dev/null 2>&1 || kill -INT "$child"
    wait "$child" || true
  fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT
/usr/local/bin/docker-entrypoint.sh postgres -c listen_addresses= -c unix_socket_directories=/var/run/postgresql -c unix_socket_permissions=0700 > /pg-guard/postgres.log 2>&1 &
child=$!
for n in $(seq 1 60); do
  if pg_isready -h "$PGHOST" -U clone_restore_admin -d postgres >/dev/null 2>&1; then break; fi
  kill -0 "$child" 2>/dev/null || fail
  sleep 1
done
[[ $(PGPASSWORD="$(</credentials/admin-password)" psql -X -w -At -v ON_ERROR_STOP=1 -c 'SELECT system_identifier FROM pg_control_system()') == 7700938444750458913 ]] || fail
export PGUSER=gitea_live_20261028_307ac94f2d6b_owner PGDATABASE=gitea_live_20261028_307ac94f2d6b
limited() ( export PGPASSWORD="$(</credentials/owner-password)"; psql -X -w -At -v ON_ERROR_STOP=1 "$@"; )
if [[ ! -f /pg-guard/initial-policy-complete ]]; then
  mkdir -m 700 /pg-guard/first-start
  export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'
  limited -f /code/db-readonly-verify.sql > /pg-guard/first-start/verification.json 2> /pg-guard/first-start/verification.stderr
  [[ ! -s /pg-guard/first-start/verification.stderr ]] || fail
  limited -f /code/business-fingerprints.sql > /pg-guard/first-start/fingerprints.jsonl 2> /pg-guard/first-start/fingerprints.stderr
  [[ ! -s /pg-guard/first-start/fingerprints.stderr && $(sha256sum /pg-guard/first-start/fingerprints.jsonl | cut -d ' ' -f1) == 19ad296643c9b753b1bacbd2a26537bd2afa040787a609f2f5aac73835db78ef ]] || fail
  export PGOPTIONS='-c statement_timeout=120000'
  limited -f /code/runtime-avatar-policy.sql > /pg-guard/first-start/avatar-policy.stdout 2> /pg-guard/first-start/avatar-policy.stderr
  [[ ! -s /pg-guard/first-start/avatar-policy.stderr ]] || fail
  grep -qx CLONE_AVATAR_POLICY_VERIFIED /pg-guard/first-start/avatar-policy.stdout || fail
  printf '%s\n' 'INITIAL_DATABASE_AND_AVATAR_POLICY_VERIFIED' > /pg-guard/initial-policy-complete
  sync /pg-guard/initial-policy-complete
fi
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'
[[ $(limited -c "SELECT current_user='gitea_live_20261028_307ac94f2d6b_owner' AND current_setting('listen_addresses')='' AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname=current_user") == t ]] || fail
limited -f /code/runtime-repository-inventory.sql > /pg-guard/inventory.stdout 2> /pg-guard/inventory.stderr
[[ ! -s /pg-guard/inventory.stderr ]] || fail
printf '%s\n' 'CLONE_DATABASE_READY' > /var/run/postgresql/clone-db-ready
printf '%s\n' 'CLONE_DATABASE_READY'
wait "$child"
