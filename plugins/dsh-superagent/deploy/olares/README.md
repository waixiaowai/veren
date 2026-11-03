# dsh-superagent on Olares — release runbook

This directory holds the container image, the entrypoint and the Helm chart that install
dsh-superagent as an Olares app, plus `release.sh`: the one command that cuts an image, ships the
chart, upgrades the app and proves the result.

本目录装着把 dsh-superagent 装成 Olares 应用的镜像、入口脚本与 Helm chart，
外加 `release.sh`：出镜像、传 chart、升级应用并自证结果的那一条命令。

## The script

```bash
export GITEA_TOKEN=<token with registry write and package access>

./release.sh build   dsh-superagent-0.1.0-r12   # archive, build in the cluster dind, prove, push
./release.sh chart   0.1.22 dsh-superagent-0.1.0-r12   # bump, package, upload to the market source
./release.sh deploy  0.1.22                     # upgrade, re-apply the entrance policy, verify
./release.sh policy                             # re-apply the entrance policy and prove it took
./release.sh taskhub wss://veren.top/v1/ws <key> dshsuperagent-olares   # fill the CMS Source card
./release.sh verify                             # what is running, and is it healthy
./release.sh all     dsh-superagent-0.1.0-r12 0.1.22   # build + chart + deploy
```

The image half lives in `release-image.sh`; `release.sh` sources it.

## What each step proves

| Step | The failure it refuses to pass on |
|---|---|
| archive | `git -C <subdir> archive rev:path` resolves the path against the subdirectory and writes an **empty** archive without an error. The archive must contain the entrypoint. |
| build | A CRLF shebang (`#!/bin/sh\r`) builds cleanly and then kills every pod boot with `exec /entrypoint.sh: no such file or directory`. The image is opened and the shebang is read before the push. |
| push | The registry caches layers per tag, so every rebuild needs a new tag. |
| chart | The chart version, the manifest version and the image tag move together; the market rejects a re-publish of the same version. |
| deploy | An upgrade re-renders the entrance and **drops the stored sub-policies**: the manifest answers 302 to auth and the panel throws a CORS error until the policy is set again. The script sets it and retries until the manifest answers 200. |
| verify | The boot log's `image git_rev=` line must match the revision that was intended; the health board must be green. |

## Ground rules

- The image is built from a **committed** tree (`git archive`), never from a working tree, so the
  revision stamped into the image is the one the operator meant to ship.
- `core.autocrlf=true` turns the archived shell scripts into CRLF; the package pins `*.sh` to LF in
  `.gitattributes` and the Dockerfile normalizes the entrypoint as a second line of defence.
- The Gitea build repo (`comi-logic/dsh-superagent-build`) is a carrier for the source tarball, not
  the source of record.
- The registry credential is the same one the app's `imagePullSecret` holds; the Gitea token in
  `GITEA_TOKEN` also writes the build repo and pushes the image.
