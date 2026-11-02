# gitea-cli

面向 Gitea 实例 `/api/v1` 的最小零依赖命令行，为 [dsh-superagent](../../README.cn.md) 而写。它是 Gitea 来源与执行器调用的 `cli`：插件通过它读取通知、Issue、PR、评论与 CI 状态；执行器用它推分支、开 PR。

令牌放在**配置文件里，绝不放环境变量**：DSH 会从子进程环境剥掉凭据形状的变量名（`KEY`、`PASSWORD`、`SECRET`、`TOKEN`），文件是唯一可靠的载体。

## 配置

`--config <path>`，或 `GITEA_CLI_CONFIG`，或 `~/.config/gitea-cli/config.json`：

```json
{ "url": "https://gitea.example.com", "token": "<访问令牌>", "login": "agent-account" }
```

`login` 可省略；`gitea api user` 可解析它。访问令牌在 Gitea 的 设置 → 应用 里创建，至少给 `repository` 读写范围。

## 命令

- `gitea api <path> [--method GET|POST|PUT|PATCH|DELETE] [-f key=value]... [-H 'Header: value']...` —— 一次带鉴权的调用。路径可以是实例相对（`user`）或仓库相对（`repos/owner/name/issues/1`）。响应体原样打印。HTTP 失败在 stderr 打印 `gitea: <message> (HTTP <status>)` 并以 1 退出——这正是 dsh-superagent 错误解析器读取的形状。
- `gitea auth status` —— 以 JSON 打印 `{host, login, id}`。
- `gitea auth git-credential get|store|erase` —— git 凭据 helper；请求站点与配置匹配时，`get` 从配置文件应答 `username=`/`password=`。`store` 与 `erase` 是空操作。

## 安装

脚本需要 `PATH` 上有 Node.js 18+，并带可执行位。dsh-superagent 的执行器环境把它包装成 `gitea` shim，执行器的 git 配置把 Gitea 站点的凭据 helper 指到它（`gitea auth git-credential`）。
