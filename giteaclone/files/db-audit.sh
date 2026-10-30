#!/bin/bash
set -euo pipefail
umask 077
export LC_ALL=C
fail() { printf '%s\n' 'DB_AUDIT_STOP_APP_OFF' >&2; exit 78; }
[[ $(id -u) == 1000 && $(id -g) == 1000 ]] || fail
[[ -d /pgdata && ! -L /pgdata && -f /pgdata/PG_VERSION && $(cat /pgdata/PG_VERSION) == 15 ]] || fail
[[ ! -e /pgdata/postmaster.pid ]] || fail
[[ $(stat -c '%u:%g:%a:%h' /credentials/owner-password) == 1000:1000:600:1 ]] || fail
[[ $(stat -c '%u:%g:%a:%s:%h' /credentials/admin-password) == 1000:1000:600:65:1 ]] || fail
[[ ! -L /credentials/owner-password && ! -L /credentials/admin-password ]] || fail
[[ -d /audit && ! -L /audit && $(stat -c '%u:%g' /audit) == 1000:1000 ]] || fail
chmod 700 /audit
mkdir -m 700 /audit/attempt
printf '%s\n' 'READONLY_AUDIT_INTENT' > /audit/attempt/phase
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGHOST PGHOSTADDR PGPORT PGOPTIONS PGPASSFILE PGSSLMODE
export PGDATA=/pgdata POSTGRES_PASSWORD_FILE=/credentials/admin-password
export PGHOST=/socket PGUSER=clone_restore_admin PGDATABASE=postgres PGPORT=5432
child=''
cleanup() {
  if [[ -n "$child" ]] && kill -0 "$child" 2>/dev/null; then
    pg_ctl -D /pgdata -m fast -w -t 30 stop > /audit/attempt/stop.log 2>&1 || kill -INT "$child"
    wait "$child" || true
  fi
}
trap cleanup EXIT
/usr/local/bin/docker-entrypoint.sh postgres -c listen_addresses= -c unix_socket_directories=/socket -c unix_socket_permissions=0700 > /audit/attempt/postgres.log 2>&1 &
child=$!
for n in $(seq 1 60); do
  if pg_isready -h /socket -U clone_restore_admin -d postgres >/dev/null 2>&1; then break; fi
  kill -0 "$child" 2>/dev/null || fail
  sleep 1
done
[[ $(PGPASSWORD="$(</credentials/admin-password)" psql -X -w -At -v ON_ERROR_STOP=1 -c 'SELECT system_identifier FROM pg_control_system()') == 7700938444750458913 ]] || fail
export PGUSER=gitea_live_20261028_307ac94f2d6b_owner PGDATABASE=gitea_live_20261028_307ac94f2d6b
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'
limited() ( export PGPASSWORD="$(</credentials/owner-password)"; psql -X -w -At -v ON_ERROR_STOP=1 "$@"; )
limited -f /code/db-schema.sql > /audit/attempt/schema.json 2> /audit/attempt/schema.stderr
[[ ! -s /audit/attempt/schema.stderr && $(sha256sum /audit/attempt/schema.json | cut -d ' ' -f1) == 280c63e74d903a50bd6706e91b617494e8333029a49bf08866418486b1ca41b1 ]] || fail
limited -f /code/db-readonly-verify.sql > /audit/attempt/verification.json 2> /audit/attempt/verification.stderr
[[ ! -s /audit/attempt/verification.stderr ]] || fail
limited -f /code/business-fingerprints.sql > /audit/attempt/business-fingerprints.jsonl 2> /audit/attempt/fingerprints.stderr
[[ ! -s /audit/attempt/fingerprints.stderr ]] || fail
cleanup
child=''
[[ ! -e /pgdata/postmaster.pid ]] || fail
printf '%s\n' 'READONLY_DB_VERIFIED_POSTGRES_STOPPED_GITEA_OFF' > /audit/attempt/phase
cat /audit/attempt/verification.json
printf '%s\n' 'READONLY_DB_VERIFIED_POSTGRES_STOPPED_GITEA_OFF'
