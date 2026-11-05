# @veren/auth-core

可嵌入的认证框架，实现 `plugins/auth/design` 设计方案（Better Auth 1.7.16 的
逆向设计，按本工作区规格重新成文）。宿主应用需要在**自己的数据库上**拥有
注册、登录、会话、口令策略、来源/限流守卫与身份权威，同时把每一条安全边界
（来源校验、限流、敏感会话读权威源、等时失败、凭据原子核销）收敛在一份装配
里而不是散落在业务代码中——用它。托管式认证服务已经替应用回答了这些调用时，
跳过它。

装配遵循设计的四个职责平面：`context` 把配置、密钥、表模型与扩展声明合并为
单一共享运行时上下文；`endpoint` 把每个能力注册为可路由端点，前置来源校验、
限流与会话中间件；`identity`、`credential`、`session` 三域排他地持有各自权威；
`storage` 以 `DBAdapter` 契约落库——本包内置 `@veren/orm` 实现
（`createOrmAdapter`），带原子 `consumeOne`/`incrementOne` 原语。

## 何时用哪个入口

- `createAuth({ adapter, options })`——装配一个 auth 实例。产物暴露
  `handler(request)`（HTTP 入口）与 `api.<key>(input)`（内嵌入口），两条入口
  共享完全一致的钩子管线。
- `createOrmAdapter(dataSource, tables)`——`@veren/orm` DataSource 之上的
  `DBAdapter`。用 `getAuthTables(...)` 产出模型，并把
  `createAuthEntities(tables)` 注册进 DataSource 再 `initialize()`。
- `createAuthEndpoint` / `AuthPlugin`——扩展契约：插件可以注册端点、贡献表
  模型（`schema`）、挂载请求钩子、声明限流规则；不得直接写会话行或主体档案。

## 对照设计的覆盖面（plugins/auth/design）

| 设计模块 | 状态 |
|---|---|
| 01 上下文装配域 | 已实现（选项归一、多版本密钥、请求级克隆、插件 init 合并） |
| 02 端点路由域 | 已实现（路由表、中间件、钩子管线、路径参数、禁用路径、server-only） |
| 03 会话域 | 已实现（签发、解析、节流续期、新鲜度、吊销族） |
| 04 凭证域 | 已实现（scrypt `salt:key`、长度策略、等时失败、重置原子核销） |
| 05 身份域 | 已实现（user/account/verification 权威、事务化注册、绑定先行解析） |
| 07 守卫域 | 已实现（来源/跳转校验、跨站导航拦截、限流） |
| 08 存储域 | 已实现（DBAdapter 契约、ORM 适配器、原子原语、表模型合并） |
| 12 诊断域 | 已实现（49 个基础错误码、`APIError`、响应体形态） |
| 09 插件域 | 以扩展契约实现（endpoints/schema/hooks/rateLimit/init 补丁） |
| 06 oauth / 13 organization / 14 strongauth / 15 enterprise / 11 cli / 10 client / 16 reference | 未实现——外围域，待宿主需要时再落地 |

已交付核心端点：API-02-01/02、API-03-01..07、API-04-01..07、
API-05-01/02/04/05/06/08（`change-email` 默认答 `CHANGE_EMAIL_DISABLED`；
`delete-user` 按设计的开关语义默认 404）。

## 测试

`pnpm test`——sqlite 内存库上的单元/集成套件；每个用例对齐设计各模块章的
验收行（§1.5/2.5/3.5/4.5/5.5/7.5/8.5）与跨模块契约表（§11.2）。

英文文档见 [README.md](./README.md)。
