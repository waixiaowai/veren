#!/bin/sh
# Entrypoint for the dsh-superagent Olares image: initialize the DSH profile on first boot,
# write the machine configuration, then serve the panel on the pod's own address.
# dsh-superagent Olares 镜像的入口：首次启动初始化 DSH profile、写机器配置，
# 然后在 Pod 自身地址上提供面板。
set -e

# L3① boot identity line: the runtime rev travels from the image label to the
# container log, so "which commit is this worker running" is one grep away.
# L3① 启动身份行：运行时 rev 从镜像标签走到容器日志——"这个 worker 跑的是哪个
# commit" 一次 grep 可答。
echo "[boot] image git_rev=${DSH_IMAGE_GIT_REV:-unknown} dsh=$(dsh --version 2>/dev/null || echo unknown)"

PROFILE_DIR="$DSH_HOME/profiles/superagent"

# dsh-superagent requires a loopback Web server (its management API fences Host to
# 127.0.0.1), so dsh binds 127.0.0.1 and the chart's proxy sidecar exposes the panel
# to the entrance via the Service.
# dsh-superagent 要求 Web 服务绑在 loopback（管理 API 的 Host 栅栏），因此 dsh 绑
# 127.0.0.1，由 chart 的代理 sidecar 经 Service 对入口暴露面板。

if [ ! -f "$PROFILE_DIR/package.json" ]; then
  # One-time profile creation from the web template, then the bundle, as docs/006-deployment.md says.
  # 按 docs/006-deployment.md：从 web 模板一次性创建 profile，再装 bundle。
  dsh --profile superagent --from-default-profile web --dump-config > /dev/null
fi
# Idempotent bundle install: the first boot may fail on a cold corepack download, so every
# boot makes sure the bundle is in the profile's bundles list before serving.
# 幂等装 bundle：首次启动可能因 corepack 冷下载失败，因此每次启动都确认
# bundle 已在 profile 的 bundles 列表里。
node -e "const fs=require('fs');const p='$PROFILE_DIR/package.json';const j=JSON.parse(fs.readFileSync(p));process.exit(j.dsh.profile.bundles.includes('dsh-superagent')?0:1)" \
  || dsh plugin --profile superagent add /opt/dsh-superagent

# The gitea CLI reads its account from this file; DSH strips credential-shaped environment
# variables, so a file is the only carrier that reaches setup probes and workers.
# gitea CLI 从该文件读取账号；DSH 会剥掉凭据形状的环境变量，文件是能到达
# setup 探针与执行器的唯一载体。
GITEA_CLI_DIR=${GITEA_CLI_CONFIG_DIR:-/dsh/state/gitea-cli}
mkdir -p "$GITEA_CLI_DIR"
printf '{"url": "%s", "token": "%s", "login": "%s"}\n' "$GITEA_URL" "$GITEA_TOKEN" "$GITEA_LOGIN" \
  > "$GITEA_CLI_DIR/config.json"
chmod 600 "$GITEA_CLI_DIR/config.json"
export GITEA_CLI_CONFIG="$GITEA_CLI_DIR/config.json"

# The machine configuration: panel port, the state directory, the model route, and the Gitea row on.
# 机器配置：面板端口、状态目录、模型路由，以及打开的 Gitea 行。
mkdir -p "$(dirname "$PROFILE_DIR/cordis.patch.yml")"
cat > "$PROFILE_DIR/cordis.patch.yml" <<EOF
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082
- id: dsh-superagent
  config:
    stateDir: /dsh/state
# The Gitea Source of this fork, on by default in the Olares deployment.
# 本 fork 的 Gitea 来源，在 Olares 部署里默认打开。
- id: dsh-superagent-gitea
  disabled: false
# The CMS task-router Source of this fork, on by default in the Olares deployment.
# Its url, API Key and node id live in the panel's Source card (settings), not here:
# the row only decides whether the Source kind is loaded at all.
# 本 fork 的 CMS 任务路由来源，在 Olares 部署里默认打开。端点、API Key 与节点 ID 放在
# 面板的来源卡（设置）里，不写在这里——这一行只决定该来源 kind 是否被装载。
- id: dsh-superagent-taskhub
  disabled: false
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash
            contextWindow: 1000000
            maxTokens: 384000
            input:
              - text
              - image
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
EOF

exec dsh --profile superagent --no-open --public-url "$PUBLIC_URL" ${TRUSTED_HOST:+--trusted-host "$TRUSTED_HOST"}
