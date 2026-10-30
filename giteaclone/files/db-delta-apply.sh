#!/bin/bash
set -euo pipefail
umask 077
export LC_ALL=C
fail() { printf '%s\n' 'DB_DELTA_STOP_APP_OFF' >&2; exit 78; }
[[ $(id -u) == 1000 && $(id -g) == 1000 ]] || fail
[[ -d /pgdata && ! -L /pgdata && -f /pgdata/PG_VERSION && $(cat /pgdata/PG_VERSION) == 15 ]] || fail
[[ ! -e /pgdata/postmaster.pid ]] || fail
[[ $(stat -c '%u:%g:%a:%h' /credentials/owner-password) == 1000:1000:600:1 ]] || fail
[[ $(stat -c '%u:%g:%a:%s:%h' /credentials/admin-password) == 1000:1000:600:65:1 ]] || fail
[[ ! -L /credentials/owner-password && ! -L /credentials/admin-password ]] || fail
[[ -d /delta && ! -L /delta && $(stat -c '%u:%g' /delta) == 1000:1000 ]] || fail
chmod 700 /delta
[[ ! -L /delta/action.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/action.csv) == 1000:1000:600:56525818:1 ]] || fail
[[ $(sha256sum /delta/action.csv | cut -d ' ' -f1) == 9bc020499f0c12221117fd0fb1c96acf5a61dccefbf513b0292b065a4e4c68f6 ]] || fail
[[ ! -L /delta/branch.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/branch.csv) == 1000:1000:600:150875:1 ]] || fail
[[ $(sha256sum /delta/branch.csv | cut -d ' ' -f1) == 58c8520e0a6ee4ee822c02bfb0a373a8ec13262549c2bfcc39496ad53c2a6ce5 ]] || fail
[[ ! -L /delta/language_stat.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/language_stat.csv) == 1000:1000:600:66292:1 ]] || fail
[[ $(sha256sum /delta/language_stat.csv | cut -d ' ' -f1) == 20e53da5f3ded586d6d2b9ff75f333a23317624c210ac4324118a1227ba02636 ]] || fail
[[ ! -L /delta/public_key.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/public_key.csv) == 1000:1000:600:8322:1 ]] || fail
[[ $(sha256sum /delta/public_key.csv | cut -d ' ' -f1) == e28df900c22d583fbe8165e8a03aeef3c6c1907a15a2a39c647c5dada1e3434d ]] || fail
[[ ! -L /delta/repo_indexer_status.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/repo_indexer_status.csv) == 1000:1000:600:13482:1 ]] || fail
[[ $(sha256sum /delta/repo_indexer_status.csv | cut -d ' ' -f1) == bdcc731cba1f01d8464fc2f8151888cf1578201f0b7cdd940bf921dfb4b323c5 ]] || fail
[[ ! -L /delta/repository.csv && $(stat -c '%u:%g:%a:%s:%h' /delta/repository.csv) == 1000:1000:600:66223:1 ]] || fail
[[ $(sha256sum /delta/repository.csv | cut -d ' ' -f1) == f113861471dc72e49cd87798e8ce23cec4a88196ff1fdcf59b432fa8daabfb40 ]] || fail
[[ ! -L /delta/manifest.json && $(stat -c '%u:%g:%a:%s:%h' /delta/manifest.json) == 1000:1000:600:29339:1 ]] || fail
[[ $(sha256sum /delta/manifest.json | cut -d ' ' -f1) == 6d4922e358a0935713203e0138de8d83cf13e282b9115b2767526395ff138443 ]] || fail
mkdir -m 700 /delta/apply-r1
printf '%s\n' 'DB_DELTA_APPLY_INTENT' > /delta/apply-r1/phase
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGHOST PGHOSTADDR PGPORT PGOPTIONS PGPASSFILE PGSSLMODE
export PGDATA=/pgdata POSTGRES_PASSWORD_FILE=/credentials/admin-password
export PGHOST=/socket PGUSER=clone_restore_admin PGDATABASE=postgres PGPORT=5432
child=''
cleanup() {
  if [[ -n "$child" ]] && kill -0 "$child" 2>/dev/null; then
    pg_ctl -D /pgdata -m fast -w -t 30 stop > /delta/apply-r1/stop.log 2>&1 || kill -INT "$child"
    wait "$child" || true
  fi
}
trap cleanup EXIT
/usr/local/bin/docker-entrypoint.sh postgres -c listen_addresses= -c unix_socket_directories=/socket -c unix_socket_permissions=0700 > /delta/apply-r1/postgres.log 2>&1 &
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
limited -f /code/db-schema.sql > /delta/apply-r1/schema.json 2> /delta/apply-r1/schema.stderr
[[ ! -s /delta/apply-r1/schema.stderr && $(sha256sum /delta/apply-r1/schema.json | cut -d ' ' -f1) == 280c63e74d903a50bd6706e91b617494e8333029a49bf08866418486b1ca41b1 ]] || fail
limited -f /code/db-readonly-verify.sql > /delta/apply-r1/verification.json 2> /delta/apply-r1/verification.stderr
[[ ! -s /delta/apply-r1/verification.stderr ]] || fail
printf '%s\n' 'DB_DELTA_TRANSACTION_STARTING' > /delta/apply-r1/phase
( export PGOPTIONS='-c statement_timeout=180000'; limited -f /code/db-delta-apply.sql ) > /delta/apply-r1/apply.stdout 2> /delta/apply-r1/apply.stderr
[[ ! -s /delta/apply-r1/apply.stderr ]] || fail
grep -qx DB_DELTA_COMMITTED_APP_OFF /delta/apply-r1/apply.stdout || fail
printf '%s\n' 'DB_DELTA_COMMITTED_VERIFYING' > /delta/apply-r1/phase
limited -f /code/db-readonly-verify.sql > /delta/apply-r1/after-verification.json 2> /delta/apply-r1/after-verification.stderr
[[ ! -s /delta/apply-r1/after-verification.stderr ]] || fail
limited -f /code/business-fingerprints.sql > /delta/apply-r1/business-fingerprints.jsonl 2> /delta/apply-r1/fingerprints.stderr
[[ ! -s /delta/apply-r1/fingerprints.stderr ]] || fail
[[ $(sha256sum /delta/apply-r1/business-fingerprints.jsonl | cut -d ' ' -f1) == 19ad296643c9b753b1bacbd2a26537bd2afa040787a609f2f5aac73835db78ef ]] || fail
sha256sum /delta/apply-r1/before-*.csv > /delta/apply-r1/backups.sha256
sync /delta/apply-r1/phase
cleanup
child=''
[[ ! -e /pgdata/postmaster.pid ]] || fail
printf '%s\n' 'DB_DELTA_VERIFIED_POSTGRES_STOPPED_GITEA_OFF' > /delta/apply-r1/phase
sync /delta/apply-r1/phase
cat /delta/apply-r1/after-verification.json
printf '%s\n' 'DB_DELTA_VERIFIED_POSTGRES_STOPPED_GITEA_OFF'
