# dsh-superagent 装在 Olares 上——发布手册

本目录装着把 dsh-superagent 装成 Olares 应用的容器镜像、入口脚本与 Helm chart，
外加 `release.sh`：出镜像、传 chart、升级应用、并自证结果的那一条命令。

## 脚本用法

```bash
export GITEA_TOKEN=<有 registry 写权限与包访问权限的令牌>

./release.sh build   dsh-superagent-0.1.0-r12   # 归档、在集群 dind 构建、自证、推送
./release.sh chart   0.1.22 dsh-superagent-0.1.0-r12   # 升版本、打包、上传到市场 upload 源
./release.sh deploy  0.1.22                     # 升级、重设入口策略、验证
./release.sh policy                             # 重设入口策略并验证真的生效
./release.sh taskhub wss://veren.top/v1/ws <key> dshsuperagent-olares   # 填 CMS 来源卡
./release.sh verify                             # 现在跑的是什么，健康吗
./release.sh all     dsh-superagent-0.1.0-r12 0.1.22   # build + chart + deploy
```

镜像那一半在 `release-image.sh` 里，由 `release.sh` 引入。

## 每一步各自证明什么

| 步骤 | 它不肯放过的失败 |
|---|---|
| 归档 | `git -C <子目录> archive rev:path` 会按子目录解析路径，**不报错**地写出一个**空归档**。归档里必须有 entrypoint。 |
| 构建 | CRLF 的 shebang（`#!/bin/sh\r`）能构建成功，却让每次 pod 启动都以 `exec /entrypoint.sh: no such file or directory` 死掉。推之前先打开镜像读一遍 shebang。 |
| 推送 | registry 按 tag 缓存层，所以每次重建都必须换 tag。 |
| chart | chart 版本、manifest 版本、镜像 tag 三者一起动；同一版本不能重传，市场会拒。 |
| 部署 | 升级会重渲染入口并**冲掉已存的子策略**：manifest 于是 302 到 auth，面板就报 CORS 错，直到重新设上策略。脚本会设策略并重试到 manifest 返回 200。 |
| 验证 | 启动日志里的 `image git_rev=` 必须等于预期的 revision，健康面必须全绿。 |

## 铁律

- 镜像从**已提交的树**构建（`git archive`），绝不用工作树——这样打进镜像的 revision 就是发布方
  打算发的那一个。
- `core.autocrlf=true` 会把归档里的 shell 脚本变成 CRLF；包内 `.gitattributes` 把 `*.sh` 钉成 LF，
  Dockerfile 再归一化一次 entrypoint 作为第二道防线。
- Gitea 构建仓（`comi-logic/dsh-superagent-build`）只是源码 tarball 的中转，不是源码的正本。
- registry 凭据与应用 `imagePullSecret` 里的是同一份；`GITEA_TOKEN` 里的 Gitea 令牌同时负责写
  构建仓与推镜像。
