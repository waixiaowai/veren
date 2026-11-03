#!/usr/bin/env bash
# The image half of the Olares release: archive the plugin at one commit, carry it to the cluster's
# dind, build it, prove the entrypoint is executable-safe, and push it to the registry.
# Olares 发布的镜像那一半：按单个 commit 归档插件源码，送到集群 dind 构建，
# 证明 entrypoint 可安全执行，再推送到 registry。
#
# Sourced by release.sh; not meant to be run directly.
# 由 release.sh 引入，不单独执行。

# Puts one file in the Gitea build repo, base64 in the JSON body. A file that already exists is
# replaced with a PUT carrying its sha; the Contents API answers 422 to a blind POST.
# 把一个文件放进 Gitea 构建仓，JSON body 走 base64。已存在的文件带 sha 走 PUT 覆盖；
# 直接 POST 会得到 422。
upload_to_gitea() { # <local file> <remote path>
  local src="$1" dst="$2" win
  win="$(cygpath -w "$src" 2>/dev/null || printf '%s' "$src")"
  python - "$win" "$dst" <<'PY'
import base64, json, os, sys, urllib.error, urllib.request
src, dst = sys.argv[1], sys.argv[2]
token = f'token {os.environ["GITEA_TOKEN"]}'
url = f'https://{os.environ["GATEWAY"]}/api/v1/repos/{os.environ["BUILD_REPO"]}/contents/{dst}'
sha = None
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': token})) as r:
        sha = json.load(r).get('sha')
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
payload = {'content': base64.b64encode(open(src, 'rb').read()).decode(),
           'branch': 'main', 'message': f'release source context {dst}'}
method = 'POST'
if sha:
    payload['sha'] = sha
    method = 'PUT'
req = urllib.request.Request(url, data=json.dumps(payload).encode(), method=method,
                             headers={'Authorization': token, 'Content-Type': 'application/json'})
with urllib.request.urlopen(req) as r:
    print(json.load(r).get('content', {}).get('path', '?'), f'({method})')
PY
}

# Archive the committed tree, not the working tree: the image must match a revision we can name.
# Archive from the repository root: "git -C <subdir> archive rev:plugins/dsh-superagent" resolves
# that path against the subdirectory and silently writes an EMPTY archive.
# 归档已提交的树而不是工作树：镜像必须对应一个能说清名字的 revision。
# 必须从仓根归档：带 -C <子目录> 时 rev:plugins/dsh-superagent 会按子目录解析，
# git 会静默写出一个**空归档**。
cmd_build() { # <image-tag>
  local tag="$1" rev short out listing
  [ -n "$tag" ] || die "build needs an image tag"
  rev="$(git -C "$PLUGIN_DIR" rev-parse HEAD)"
  short="${rev:0:7}"
  say "build $tag from $rev"
  mkdir -p "$WORK_DIR"
  out="$WORK_DIR/dsh-sa-$rev.tgz"
  git -C "$REPO_DIR" archive --format=tar.gz -o "$out" "$rev" plugins/dsh-superagent
  listing="$(tar tzf "$out")"
  case "$listing" in
    *plugins/dsh-superagent/deploy/olares/entrypoint.sh*) : ;;
    *) die "archive has no entrypoint - the path did not resolve" ;;
  esac
  tar -xzOf "$out" plugins/dsh-superagent/deploy/olares/entrypoint.sh > "$WORK_DIR/entrypoint.sh"
  head -c 16 "$WORK_DIR/entrypoint.sh" | od -c | head -2
  if grep -q $'\r' "$WORK_DIR/entrypoint.sh"; then die "archived entrypoint has CRLF - git archive applied autocrlf"; fi
  upload_to_gitea "$out" "dsh-superagent-src-$short.tgz"
  in_dind "set -e; cd /data/check; rm -f src-$short.tgz; \
    wget -q --timeout=60 --header=\"Authorization: token $GITEA_TOKEN\" -O src-$short.tgz \
      \"https://$GATEWAY/$BUILD_REPO/raw/branch/main/dsh-superagent-src-$short.tgz\"; \
    rm -rf b$short; mkdir -p b$short; tar xzf src-$short.tgz -C b$short; cd b$short/plugins/dsh-superagent; \
    nohup docker build --build-arg GIT_REV=$rev -f deploy/olares/Dockerfile -t $IMAGE_REPO:$tag . \
      > /data/check/build-$tag.log 2>&1 & echo started"
}

# The build runs in the background inside the dind; wait for the image to appear.
# 构建在 dind 里后台跑；等镜像出现。
cmd_build_wait() { # <image-tag>
  local tag="$1" i=0 ids
  while [ $i -lt 120 ]; do
    ids="$(in_dind "docker images -q $IMAGE_REPO:$tag | head -1")"
    [ -n "$ids" ] && return 0
    sleep 10; i=$((i + 1))
    if [ $((i % 6)) -eq 0 ]; then say "still building $tag (${i}0s)"; fi
  done
  die "image $tag did not appear in the dind"
}

# A CRLF shebang builds cleanly and then kills every pod boot; refuse to push such an image.
# CRLF 的 shebang 能构建成功，却让每次 pod 启动都死；这种镜像不许推。
cmd_verify_image() { # <image-tag> <expected-rev>
  local tag="$1" rev="$2" probe stamped
  probe="$(in_dind "docker run --rm --entrypoint sh $IMAGE_REPO:$tag -c 'head -c 16 /entrypoint.sh | od -c | head -2'")"
  printf '%s\n' "$probe"
  case "$probe" in *'\r'*) die "entrypoint shebang is CRLF in $tag - refusing to push" ;; esac
  stamped="$(in_dind "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $IMAGE_REPO:$tag | grep DSH_IMAGE_GIT_REV")"
  printf '%s\n' "$stamped"
  case "$stamped" in *"$rev"*) : ;; *) die "$tag does not carry the intended revision $rev" ;; esac
}

cmd_push() { # <image-tag>
  local tag="$1"
  say "push $tag"
  in_dind "printf '%s' '$GITEA_TOKEN' | docker login $GATEWAY -u $REGISTRY_USER --password-stdin >/dev/null; \
    nohup docker push $IMAGE_REPO:$tag > /data/check/push-$tag.log 2>&1 & echo started"
}

cmd_push_wait() { # <image-tag>
  local tag="$1" i=0
  while [ $i -lt 120 ]; do
    if in_dind "grep -q 'digest:' /data/check/push-$tag.log 2>/dev/null"; then
      in_dind "tail -2 /data/check/push-$tag.log"; return 0
    fi
    sleep 10; i=$((i + 1))
  done
  die "push of $tag did not finish"
}
