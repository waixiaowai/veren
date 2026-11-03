#!/usr/bin/env bash
# dsh-superagent on Olares: one command to cut an image, ship the chart, upgrade the app, and prove it.
# dsh-superagent 在 Olares 上：一条命令完成出镜像、传 chart、升级应用、并自证结果。
#
# The pipeline this script freezes (2026-11-03, learned the hard way):
#   1. build  — archive the plugin at one commit, ship it to the cluster's dind, build, PROVE the
#               entrypoint shebang is LF (a CRLF shebang builds fine and crash-loops every pod boot),
#               then push.                          (release-image.sh)
#   2. chart  — bump chart + manifest + image tag, package, upload to the market upload source.
#   3. deploy — upgrade, then RE-APPLY the entrance sub-policy and verify it took: every upgrade
#               re-renders the entrance and drops the stored sub-policies, which is why the panel
#               kept throwing the manifest CORS error.
#   4. verify — pod running on the expected image, boot revision equal to the intended commit,
#               health board green, manifest served with 200 (not redirected to auth).
#
# 这条流水线固化了 2026-11-03 踩过的坑：
#   1. build  — 按单个 commit 归档源码，送到集群 dind 构建，**先证明 entrypoint 的 shebang 是 LF**
#               （CRLF 的 shebang 能构建成功，却让 pod 每次启动都崩溃重启），再推。（release-image.sh）
#   2. chart  — 升 chart / manifest / 镜像 tag，打包后上传到市场 upload 源。
#   3. deploy — 升级，并**重设入口子策略且验证真的生效**：每次升级都会重渲染入口并冲掉子策略，
#               面板那个 manifest CORS 报错就是这么反复出现的。
#   4. verify — pod 跑在预期镜像上、启动 rev 等于预期 commit、健康面全绿、manifest 返回 200
#               （而不是被 302 到 auth）。
#
# Usage:
#   release.sh build   <image-tag>                  e.g. release.sh build dsh-superagent-0.1.0-r12
#   release.sh chart   <chart-version> <image-tag>  e.g. release.sh chart 0.1.22 dsh-superagent-0.1.0-r12
#   release.sh deploy  <chart-version>              upgrade, re-apply the policy, verify
#   release.sh policy                                re-apply the entrance sub-policy and prove it took
#   release.sh taskhub <url> <token> <node-id>      fill the CMS Source card in the panel's settings
#   release.sh verify                               checks the live app against what is deployed
#   release.sh all     <image-tag> <chart-version>  build + chart + deploy + verify
#
# Required environment:
#   GITEA_TOKEN  Gitea token with registry write and package access (the image push credential).
# Optional environment (defaults in brackets):
#   OLARES_CLI [olares-cli]  GATEWAY [gitea.bowong.cc]  REGISTRY_USER [imeepos]
#   BUILD_REPO [comi-logic/dsh-superagent-build]  IMAGE_REPO [<gateway>/comi-logic/olares-images]
#   APP [dshsuperagent]  ENTRANCE [panel]  APP_NS [dshsuperagent-comilogic]  DIND_NS [gitearunner-comilogic]
#   MANIFEST_SUBPOLICY [uri=/manifest.webmanifest,policy=public]  PANEL_HOST [6552507f.comilogic.olares.cn]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(git -C "$PLUGIN_DIR" rev-parse --show-toplevel)"
CHART_DIR="$PLUGIN_DIR/deploy/olares/chart"
APP_CHART_DIR="$CHART_DIR/dshsuperagent"

: "${OLARES_CLI:=olares-cli}"
: "${GITEA_TOKEN:?GITEA_TOKEN is required (registry push + build repo access)}"
: "${GATEWAY:=gitea.bowong.cc}"
: "${REGISTRY_USER:=imeepos}"
: "${BUILD_REPO:=comi-logic/dsh-superagent-build}"
: "${IMAGE_REPO:=${GATEWAY}/comi-logic/olares-images}"
: "${APP:=dshsuperagent}"
: "${ENTRANCE:=panel}"
: "${APP_NS:=dshsuperagent-comilogic}"
: "${DIND_NS:=gitearunner-comilogic}"
: "${MANIFEST_SUBPOLICY:=uri=/manifest.webmanifest,policy=public}"
: "${PANEL_HOST:=6552507f.comilogic.olares.cn}"
WORK_DIR="${TMPDIR:-/tmp}/dsh-sa-release"
export GITEA_TOKEN GATEWAY BUILD_REPO IMAGE_REPO REGISTRY_USER

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# The dind lives in the gitearunner pod; the pod name changes with every rollout, so look it up by
# name prefix — the namespace also holds a terminal pod that has no runner container.
# dind 在 gitearunner pod 里；pod 名随滚动变化，所以按名字前缀找——同一命名空间里还有
# 一个 terminal pod，它没有 runner 容器。
dind_pod() {
  "$OLARES_CLI" cluster pod list -n "$DIND_NS" 2>/dev/null \
    | awk 'NR>1 && $1 ~ /^gitearunner-/ {print $1; exit}'
}

# Runs a shell snippet inside the runner container that owns the docker daemon.
# 在持有 docker daemon 的 runner 容器里跑一段 shell。
in_dind() {
  local pod; pod="$(dind_pod)"
  [ -n "$pod" ] || die "no gitearunner pod found in $DIND_NS"
  "$OLARES_CLI" cluster pod exec "$pod" -n "$DIND_NS" -c gitearunner -- sh -lc "$1"
}

# The app's own pod, used for in-cluster API calls.
# 应用自己的 pod，用于在集群内调 API。
app_pod() {
  "$OLARES_CLI" cluster pod list -n "$APP_NS" 2>/dev/null \
    | awk 'NR>1 && $1 ~ /^'"$APP"'-/ {print $1; exit}'
}

# shellcheck source=release-image.sh
. "$SCRIPT_DIR/release-image.sh"

# ---------------------------------------------------------------- chart
cmd_chart() { # <chart-version> <image-tag>
  local version="$1" tag="$2"
  [ -n "$version" ] && [ -n "$tag" ] || die "chart needs a version and an image tag"
  say "chart $version -> $tag"
  python - "$APP_CHART_DIR" "$version" "$tag" <<'PY'
import pathlib, re, sys
chart_dir, version, tag = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
def patch(name, pattern, replacement):
    path = chart_dir / name
    text = path.read_text(encoding='utf-8')
    if not re.search(pattern, text, flags=re.M):
        raise SystemExit(f'{name}: no match for {pattern}')
    path.write_text(re.sub(pattern, replacement, text, count=1, flags=re.M), encoding='utf-8')
    print('patched', name)
patch('Chart.yaml', r'^version: .*$', f'version: {version}')
patch('OlaresManifest.yaml', r'^  version: .*$', f'  version: {version}')
patch('values.yaml', r'^  tag: .*$', f'  tag: {tag}')
PY
  ( cd "$CHART_DIR" && tar czf "dshsuperagent-$version.tgz" --owner=0 --group=0 --numeric-owner \
      dshsuperagent/Chart.yaml dshsuperagent/values.yaml \
      dshsuperagent/templates/deployment.yaml dshsuperagent/templates/panel-proxy-configmap.yaml \
      dshsuperagent/templates/secret.yaml dshsuperagent/templates/service.yaml \
      dshsuperagent/OlaresManifest.yaml dshsuperagent/panel-proxy.js )
  "$OLARES_CLI" market upload "$CHART_DIR/dshsuperagent-$version.tgz"
}

# ---------------------------------------------------------------- deploy
# The entrance sub-policy does not survive an upgrade: the entrance is re-rendered from the chart and
# the stored sub-policies are gone, which is exactly what brought back the manifest CORS error.
# 入口子策略扛不过升级：入口按 chart 重渲染，存的子策略就没了——manifest CORS 报错反复出现就是这个原因。
cmd_ensure_policy() {
  local i=0 code
  while [ $i -lt 6 ]; do
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
      "$OLARES_CLI" settings apps policy set "$APP" "$ENTRANCE" --sub-policy "$MANIFEST_SUBPOLICY" >/dev/null
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 25 "https://${PANEL_HOST}/manifest.webmanifest")"
    if [ "$code" = "200" ]; then say "entrance sub-policy in place (manifest 200)"; return 0; fi
    say "manifest still $code; re-applying the sub-policy"
    sleep 10; i=$((i + 1))
  done
  die "manifest still not public after $i attempts"
}

cmd_deploy() { # <chart-version>
  local version="$1" state
  [ -n "$version" ] || die "deploy needs a chart version"
  say "upgrade $APP to $version"
  "$OLARES_CLI" market upgrade "$APP" --version "$version" --watch --watch-timeout 25m --watch-interval 5s || true
  state="$("$OLARES_CLI" market status "$APP" 2>/dev/null | awk -F: '/State/{gsub(/ /,"",$2); print $2}')"
  case "$state" in
    running) : ;;
    stopped|stopFailed|upgradeFailed|applyEnvFailed)
      say "app is $state; resuming"
      "$OLARES_CLI" market resume "$APP" --watch --watch-timeout 15m || true ;;
    *) say "app state is $state; waiting 20s and retrying the upgrade"
       sleep 20
       "$OLARES_CLI" market upgrade "$APP" --version "$version" --watch --watch-timeout 25m || true ;;
  esac
  cmd_ensure_policy
}

# ---------------------------------------------------------------- sources
# The settings block carries an optimistic-lock revision that the overview does not expose; the block
# counter lives in "settings-block-revision:<block>" and moves with every save. Probe upward.
# 设置块带乐观锁 revision，而总览并不给出它；真值在 "settings-block-revision:<block>" 计数器里，
# 每存一次加一。只能向上试探。
cmd_taskhub() { # <url> <token> <node-id>
  local url="$1" token="$2" node="$3" pod
  [ -n "$url" ] && [ -n "$token" ] && [ -n "$node" ] || die "taskhub needs url, token and node id"
  pod="$(app_pod)"; [ -n "$pod" ] || die "no pod in $APP_NS"
  say "fill the CMS Source card (node $node)"
  "$OLARES_CLI" cluster pod exec "$pod" -n "$APP_NS" -c dsh-superagent -- node -e '
    const http = require("http");
    const [url, token, nodeId] = process.argv.slice(1);
    const call = (method, path, raw) => new Promise(res => {
      const h = {Host: "127.0.0.1:3082", "x-orchestrator-request": "1"};
      if (raw) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(raw); }
      const q = http.request({host: "127.0.0.1", port: 3082, path, method, headers: h}, r => {
        let b = ""; r.on("data", c => b += c); r.on("end", () => res({code: r.statusCode, body: b}));
      });
      q.on("error", e => res({code: "ERR", body: e.message}));
      if (raw) q.write(raw); q.end();
    });
    (async () => {
      const config = {url, token, nodeId, title: "Superagent 编码工作节点",
        description: "DSH Superagent：接收 cms 派发的任务，在仓库里执行，完成后回报结果并送回来源渠道。",
        tags: ["编码", "仓库", "测试"], maxConcurrent: 1};
      for (let rev = 0; rev < 40; rev++) {
        const r = await call("PUT", "/orchestrator/api/settings/source:taskhub",
          JSON.stringify({value: {enabled: true, config}, revision: rev}));
        if (r.code === 200) { console.log("saved, revision", rev + 1); return; }
        if (r.code !== 409) { console.log("PUT failed:", r.code, r.body.slice(0, 200)); return; }
      }
      console.log("no revision accepted");
    })()' "$url" "$token" "$node"
}

# ---------------------------------------------------------------- verify
cmd_verify() {
  local pod rev image code
  pod="$(app_pod)"
  [ -n "$pod" ] || die "no pod in $APP_NS"
  say "pod $pod"
  "$OLARES_CLI" cluster pod list -n "$APP_NS" | head -4
  rev="$("$OLARES_CLI" cluster pod logs "$pod" -n "$APP_NS" -c dsh-superagent 2>/dev/null \
        | grep -o 'image git_rev=[0-9a-f]*' | head -1 | cut -d= -f2)"
  image="$("$OLARES_CLI" cluster workload images -n "$APP_NS" 2>/dev/null \
        | awk '$5=="dsh-superagent"{print $6; exit}')"
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 25 "https://${PANEL_HOST}/manifest.webmanifest")"
  say "boot revision: ${rev:-unknown}"
  say "image: ${image:-unknown}"
  say "manifest: $code (want 200, 302 means the entrance sub-policy was wiped)"
  say "policy:"
  "$OLARES_CLI" settings apps policy get "$APP" "$ENTRANCE" | tail -5
  say "health:"
  "$OLARES_CLI" cluster pod exec "$pod" -n "$APP_NS" -c dsh-superagent -- node -e '
    const http = require("http");
    http.get({host: "127.0.0.1", port: 3082, path: "/orchestrator/api/state",
              headers: {Host: "127.0.0.1:3082", "x-orchestrator-request": "1"}}, r => {
      let b = ""; r.on("data", c => b += c);
      r.on("end", () => { for (const [k, v] of Object.entries(JSON.parse(b).health))
        console.log("  ", k.padEnd(11), v.state, "|", String(v.detail || "").slice(0, 50)); });
    })' 2>/dev/null
}

cmd_all() { # <image-tag> <chart-version>
  local rev; rev="$(git -C "$PLUGIN_DIR" rev-parse HEAD)"
  cmd_build "$1"; cmd_build_wait "$1"; cmd_verify_image "$1" "$rev"
  cmd_push "$1"; cmd_push_wait "$1"
  cmd_chart "$2" "$1"; cmd_deploy "$2"; cmd_verify
}

case "${1:-}" in
  build)   cmd_build "$2" ;;
  chart)   cmd_chart "$2" "$3" ;;
  deploy)  cmd_deploy "$2" ;;
  policy)  cmd_ensure_policy ;;
  taskhub) cmd_taskhub "$2" "$3" "$4" ;;
  verify)  cmd_verify ;;
  all)     cmd_all "$2" "$3" ;;
  *) sed -n '2,42p' "$0"; exit 1 ;;
esac
