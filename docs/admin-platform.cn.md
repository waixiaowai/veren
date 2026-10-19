# DSH 后台平台（P0）

[English](admin-platform.md) | 中文

后台平台是一组 DSH 插件，把一个 profile 变成通用后台：能力契约、provider 内核、统一
API 网关与可替换的浏览器 UI。消费方接触到的一切都是契约；每个实现都是 façade 之后的
provider。

本文说明当前交付内容、安装方式、扩展方式，以及实现有意尚未完成的边界。

## 架构

```text
                 ┌──────────── 浏览器 SPA（/admin）────────────┐
                 │  包：shell / theme / locale / icons / page   │
                 └───────────────┬──────────────────────────────┘
                     同源 ESM + /api/* JSON
┌────────────────────────────────▼───────────────────────────────┐
│ admin-web          壳、资源、UI 包文件、bootstrap                │
│ admin-ui-kernel    包注册表、清单、资源路径收敛                   │
├─────────────────────────────────────────────────────────────────┤
│ admin-api-kernel   单一管道：认证 → CSRF → 权限 → 审计            │
├─────────────────────────────────────────────────────────────────┤
│ admin-kernel       注册表、协商、façade、启动门禁                  │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│ data-kv  │ auth     │ access   │ nav      │ audit / docs        │
└──────────┴──────────┴──────────┴──────────┴─────────────────────┘
                   DSH 存储域（profile 的 storage 组）
```

## 包

| 包 | 作用 |
|---|---|
| `@veren/admin-contract` | 稳定 Host 类型：能力、错误、数据端口、路由词汇、能力接口 |
| `@veren/admin-kernel` | provider 注册表、优先级/版本协商、façade、目录、健康、启动门禁 |
| `@veren/admin-api-kernel` | 唯一 HTTP 网关：认证、CSRF、权限、限流、校验、审计、OpenAPI |
| `@veren/admin-data-dsh-kv` | `data`，基于单个 DSH 存储域（事务降级） |
| `@veren/admin-auth-local` | `auth`：初始化、登录、会话、用户、API token |
| `@veren/admin-access-rbac` | `access`：内置与自定义角色、绑定、防自锁 |
| `@veren/admin-navigation-default` | `navigation`：默认菜单贡献 |
| `@veren/admin-audit-default` | `audit`：只追加轨迹、保留策略、游标分页 |
| `@veren/admin-docs-openapi` | `docs`：目录、后端健康、OpenAPI、文档索引 |
| `@veren/admin-ui-contract` | 浏览器包与运行时契约 |
| `@veren/admin-ui-kernel` | 包注册表、按受众清单、资源服务规则 |
| `@veren/admin-web` | SPA 载体、bootstrap、静态收敛、启动门禁 |
| `@veren/admin-app` | 组合上述全部行的 patch |

## 请求生命周期

1. `admin-api-kernel` 匹配 `/api/<受众>/v1<路径>` 并分配请求 id。
2. 来源与预检检查先于一切执行。
3. 限流（按 ip + 路由的固定窗口）。
4. 请求体大小与 JSON 解析；先校验 `query`，再校验 `input`。
5. 认证：`admin_session` Cookie 或 `Authorization: Bearer`。
6. 非安全非公开方法的 CSRF 双提交。
7. 由主体解析并强制权限与 scope。
8. 审计意图 → handler → 审计结果（尽力而为）。
9. JSON 响应，带 `no-store` 与 `nosniff`。

失败一律渲染 `{ error: { code, message, details?, requestId } }`；错误码映射到固定 HTTP
状态。

## 数据路径

`api.adminData` 暴露 `table<T>(name)`：同步的 `find`/`list`/`size`，异步的
`save`/`remove`。内嵌适配器把所有集合放在一个 DSH 存储域（`admin_data`，单表
`records`，键为 `<集合>:<id>`），并报告 `features.transactions = false`。

`transaction(work)` 通过一条 promise 链串行化，因此并发事务不会交错，但**不回滚**：失败时
先前的写入保留，错误继续向上抛出。需要原子性的场景应运行在 SQL 引擎上。

## 安装

```bash
dsh plugin --profile admin add @veren/admin-app
dsh --profile admin --host 127.0.0.1 --port 3081 --no-open
```

profile 必须提供 `webServer`、`storage`（至少一个后端）与 `storageDomain`。
`admin-data-dsh-kv` 默认 `{ backend: 'json' }`；若 profile 的后端名不同，请在其行上设置
`storage.backend`。后端缺失会显式加载失败，并列出该后端名与已注册名称。

打开 `/admin`，完成首次初始化，仪表盘即出现。

## 替换 provider 或 UI 包

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

替换实现必须为同一能力声明**不同的**优先级；两个相同优先级会被拒绝，因此当前实现永远
不会产生歧义。消费方仍持有同一个 façade，业务代码无需改动。

## 新增能力或模块

1. 在 `@veren/admin-contract` 声明能力接口（没有契约的 provider 无法被消费）。
2. 实现它，并在 `ctx.effect` 内用 `ctx.admin.register(manifest, implementation)` 注册。
3. 通过内核挂载的 façade 暴露给消费方，或直接
   `ctx.admin.require<YourCap>(name)`。
4. 用 `ctx.adminApi.register` 注册 HTTP 路由，声明所需权限以及是否审计。

## 安全模型

- 每条路由都在服务端校验权限；隐藏 UI 从来不是授权。
- 每个非安全非公开方法都做 CSRF 双提交。
- Cookie 为 `HttpOnly` + `SameSite=Lax`；TLS 后必须启用 `secureCookies`。
- 口令用 scrypt；会话与 token 密钥只存散列。
- SPA 壳携带严格 CSP；包是同源的 ESM 数据。
- 审计在策略上只追加；内嵌存储不是 WORM。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/<包>
pnpm check:plugins
```

组合包包含一次全栈组合测试：初始化 → 登录 → bootstrap → 用户管理 → 审计 → 能力目录，
全部跑在真实 HTTP 服务器与真实 provider 上。

## 实现与设计文档的差异

设计文档（`admin-system-design.cn.md`）覆盖 P0–P3；本代码是 P0 切片，以下细节有意不同：

| 设计 | 实现 |
|---|---|
| 从 `package.json` 的 `dsh.admin.provider` / `dsh.admin.ui` 扫描 provider | provider 与包通过 `ctx.admin.register` / `ctx.adminUi.register` 自行注册 |
| `auth-better` + `data-drizzle`（默认 SQLite） | `auth-local` + `data-dsh-kv`；SQL 适配器为后续工作 |
| `/api/openapi.json` | `/api/public/v1/openapi.json`（受众前缀路由） |
| 支持 `Idempotency-Key` | 未实现；CORS 仅声明允许该请求头 |
| 带 TTL 的 setup token | 无用户时 setup 开放 |
| `ctx.admin.registerModule(descriptor)` | 模块直接注册路由与导航 |
| provider 热替换含 drain 与回滚 | 按优先级实时替换，无 drain，无自动回滚 |
| 集合 `auth_users`、`access_roles`、`audit_entries` 等 | `admin_users`、`admin_roles`、`admin_audit` 等 |

## 推迟到 P1 及以后

任务、表单、AI 协助、附件、通知、后台作业与设置 provider；带真实事务的 SQL（Drizzle）与
MongoDB 适配器；provider drain/回滚；provider 与 UI 包的 package.json 声明扫描；端到端
限定到 terminal 路由的 API token scope；口令重置与 MFA。
