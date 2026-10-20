# 后台平台组合包 — 安装与组合

## 它是什么

`@veren/admin-app` 是一个只含配置的组合包。它的 `cordis.patch.yml` 按依赖顺序把
P0 技术栈插入 profile：

```text
admin-kernel → admin-api-kernel → admin-data-postgres → admin-access-rbac
→ admin-auth-local → admin-navigation-default → admin-audit-default
→ admin-docs-openapi → admin-ui-kernel → 默认包 → admin-web
```

成员是本组合包的普通依赖，因此安装组合包即安装整套栈，且本 patch 始终是该 profile
唯一的后台层。行顺序仍按依赖排列以便阅读；真正的激活顺序由注入保证：`admin-web` 等待
内核在最后一个必需 provider 注册后发布的 `adminReadiness` 服务。

## 数据后端

PostgreSQL 是推荐默认。组合包启用 `admin-data-postgres` 行，并禁用
`admin-data-dsh-kv` 行。在 profile 中（或该行上）配置连接：

```yaml
- id: admin-data-postgres
  name: '@veren/admin-data-postgres'
  config:
    host: 127.0.0.1
    port: 5432
    user: veren
    password: !!js process.env.VEREN_PG_PASSWORD ?? ''
    database: veren_admin
    schema: public
    migrateOnBoot: true
```

数据库与登录必须在首次启动前存在；schema 引导是幂等的。若 profile 提供 `storage` 与
`storageDomain`，禁用 PostgreSQL 行并启用 KV 行即可使用嵌入式 JSON 后端：

```yaml
- id: admin-data-postgres
  disabled: true
- id: admin-data-dsh-kv
  disabled: false
  config:
    storage:
      backend: json
```

## 对 profile 的要求

- 一个 `webServer` 行（后台对外是 HTTP）。
- 默认 provider 需要一个可达的 PostgreSQL 数据库。请在 `admin-data-postgres` 行上配置；
  默认值（`127.0.0.1:5432`、用户 `veren`、数据库 `veren_admin`）只是开发便利，不是
  部署设置。
- 仅使用 JSON 回退时：一个注册了至少一个后端的 `storage` 组，以及 `storageDomain`。
  `admin-data-dsh-kv` 默认 `{ backend: 'json', routes: {} }`；若你的 profile 用别的
  后端名，请在该行上设置 `storage.backend`。后端缺失会显式加载失败，并列出该后端名与
  已注册名称。

其余无需准备：`auth`、`access`、`navigation`、`audit`、`docs`、`ui-kernel`
与各默认包都由本 patch 插入。

## 安装

```text
dsh plugin --profile admin add @veren/admin-app
dsh --profile admin --host 127.0.0.1 --port 3081 --no-open
```

`admin` 不是内置模板名；`dsh plugin` 会用默认基础层初始化该 profile，并把本组合包
加入 `dsh.profile.bundles`。

## 替换 provider 或 UI 包

禁用默认行并启用你的实现。同一能力的替换实现必须声明**不同的** `priority`；内核拒绝
两个同优先级 provider，因此当前实现永远不会产生歧义。

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

## 尚未包含

任务、表单、AI 协助、附件、通知、后台作业与设置为 P1 能力；契约里有它们的名字，但本
组合包尚未提供 provider。由于 `features` 将其标记为缺失，`admin-web` 会把它们渲染为
隐藏。
