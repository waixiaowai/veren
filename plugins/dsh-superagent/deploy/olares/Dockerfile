# dsh-superagent on Olares: DSH runtime + the fork's bundle + the gitea CLI.
# Olares 上的 dsh-superagent：DSH 运行时 + 本 fork 的 bundle + gitea CLI。
# `node:24-bookworm` (full) ships git, which workers need; the slim image lacks it.
# `node:24-bookworm`（完整版）自带执行器需要的 git；slim 版没有。
FROM node:24-bookworm

# The DSH release pinned by docs/006-deployment.md; its bundles carry the web frontend prebuilt.
# docs/006-deployment.md 钉住的 DSH 版本；其 bundle 自带预构建的前端产物。
RUN npm install -g @deepseek-ai/dsh@0.2.1-rc.3 && corepack enable

# The fork's bundle: source in, built in place, installed by the entrypoint as a link: dependency.
# The bundle loads via link:, so its runtime dependencies (zod, proper-lockfile) must stay
# resolvable from /opt/dsh-superagent/node_modules — prune dev dependencies instead of removing.
# 本 fork 的 bundle：源码拷入、原地构建，由入口脚本以 link: 依赖安装。
# bundle 经 link: 装载，运行时依赖（zod、proper-lockfile）必须能从
# /opt/dsh-superagent/node_modules 解析——用 --prod 修剪开发依赖，而不是删除。
COPY . /opt/dsh-superagent
RUN cd /opt/dsh-superagent && pnpm --ignore-workspace install --frozen-lockfile && pnpm --ignore-workspace build \
  && pnpm --ignore-workspace install --frozen-lockfile --prod && rm -f /opt/dsh-superagent/lib/*.map

# The gitea CLI acts as the agent's Gitea account; a shell launcher keeps the entry modules
# next to the bin. The entrypoint writes its config file (url + token) at first boot.
# gitea CLI 以智能体的 Gitea 账号行事；shell 启动器让入口模块跟着可执行文件走。
# 入口脚本在首次启动时写它的配置文件（url + token）。
COPY tools/gitea-cli /opt/gitea-cli
RUN printf '#!/bin/sh\nexec node /opt/gitea-cli/gitea.mjs "$@"\n' > /usr/local/bin/gitea && chmod +x /usr/local/bin/gitea

COPY deploy/olares/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# L3① deployment-integrity anchor: the build stamps the git revision it was cut
# from, the entrypoint prints it at boot, and the operator compares it with the
# revision the deploy intended. A mismatch means an old artifact is running.
# Declared after the heavy build layers on purpose: an ARG before them would
# invalidate the whole cache and re-upload a multi-GB layer per revision.
# L3① 部署完整性锚：构建时写入 git rev，入口启动打印，部署方与预期 rev 核对；
# 不一致 = 跑的是旧产物。位置刻意放在重层之后：ARG 在前会整体失效缓存，
# 每个 revision 都要重传数 GB 的层。
ARG GIT_REV=unknown
ENV DSH_IMAGE_GIT_REV=$GIT_REV
LABEL org.opencontainers.image.revision=$GIT_REV

ENV DSH_HOME=/dsh/home
VOLUME /dsh
EXPOSE 3082
ENTRYPOINT ["/entrypoint.sh"]
