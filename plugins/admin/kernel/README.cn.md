# `@veren/admin-kernel`

适用于 DSH 后台部署必须为每个能力只选一个实现、并让消费方依赖稳定 façade 的场景：
它按 provider 清单注册实现、协商契约范围、拒绝不兼容或冲突的 provider、推导能力目录
与健康状态，并执行必需能力启动门禁；只需要契约类型时不要使用本包。

## 提供什么

- `ctx.admin` — 内核：`register`、`require`、`has`、`catalog`、`features`、
  `refreshHealth`、`ready`。
- 稳定 façade：`ctx.adminData`、`ctx.adminAuth`、`ctx.adminAccess`、
  `ctx.adminNavigation`、`ctx.adminAudit`、`ctx.adminSettings`、`ctx.adminDocs`。
- `ctx.adminReadiness` — 全部必需能力都有激活 provider 后发布。消费方在 `inject`
  中声明它，即排在 provider 行之后；服务名以 `ADMIN_READINESS_SERVICE` 导出。

façade 是**每次访问**都解析当前 provider 的 `Proxy`，因此进行中的请求与实时 UI 订阅都能
跨 provider 替换存活。symbol 与 `then` 不会被转发（façade 不能被当成 thenable）。

## 选择与冲突

| 情况 | 结果 |
|---|---|
| 范围不包含 `1.0.0` | 注册时 `CONTRACT_INCOMPATIBLE` |
| provider id 重复 | `PROVIDER_CONFLICT` |
| 同一能力优先级重复 | `PROVIDER_CONFLICT` |
| 多个兼容 provider | `priority` 最高者胜出；同优先级取最近注册者 |
| 调用 façade 时无 provider | `CAPABILITY_UNAVAILABLE`，并带上已注册 id |

因此替换 provider 意味着用**不同的**优先级注册新实现并释放旧注册；消费方始终持有同一个
façade 对象。

## 目录、健康与启动门禁

`catalog()` 返回 `{ contractVersion, capabilities, features }`，健康取最近一次探测结果；
`refreshHealth()` 探测每个能力可选的 `health()` 钩子与 `data` 后端，然后更新该缓存。
`features` 是逐能力布尔值，始终由目录推导（不单独存储）。

`ready()` 在 `data`、`auth`、`access`、`navigation`、`audit` 以及配置追加项中列出全部缺口，
并抛出 `ESSENTIAL_CAPABILITY_MISSING`。

最后一个必需 provider 注册时，`register()` 立即发布 `adminReadiness`。`@veren/admin-web`
注入该服务，因此 Cordis 会让 Web 行保持 pending，直到 provider 行执行完毕——即使 loader
并发挂载各行，也与 patch 的行顺序无关。该服务是单向启动闩锁：之后移除 provider 不会撤回；
实时门禁仍是 `ready()`（`@veren/admin-web` 在 `apply` 中依然调用它）。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `essential` | `[]` | 本部署额外视为必需的能力名。未知名称会让加载失败。 |

## 已知限制

- 替换是实时的（优先级 + disposer），但**不是事务性的**：没有 drain/在途请求屏障，也不自动回滚。
- 健康是拉取式的；后台不做轮询。
- 数据引擎能力由 `data` provider 自报，内核不做强制校验。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/kernel
```
