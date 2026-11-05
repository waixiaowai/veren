---
title: 专用名词与技术术语
description: 业务名词与技术术语分表：统一标识、简短解释与易混边界。
sidebar:
  order: 31
  label: 名词表
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 12. Glossary

业务名词与技术术语分表列出，只收正文实际使用的条目。全部状态名称与实体关系与正文一致。

### 12.1 Business Terms

| 中文名 | 统一标识 | 解释 | 易混边界 |
|---|---|---|---|
| 主体 | `User` | 被认证的档案单位，持有唯一邮箱与档案字段 | 主体不是"账号"：一个主体可挂多个账号绑定 |
| 账号绑定 | `Account` | 主体与某个外部身份源（或凭证）的归属记录 | 绑定存在不代表主体可登录（孤儿绑定被拒） |
| 凭证账号 | credential account | `providerId: "credential"` 的绑定行，存口令散列 | 是账号绑定的特例，不是独立实体 |
| 会话 | `Session` | 一次已认证状态的物化记录，凭令牌引用 | 会话不是登录：登录是产生会话的动作 |
| 会话凭据 | session token cookie | 客户端持有的会话引用（签名 Cookie） | 凭据是引用不是权威；敏感操作读权威源 |
| 缓存副本 | cookie cache | 签名的会话+主体快照 Cookie，省读取 | 副本可用于识别，不可用于敏感操作 |
| 校验凭据 | `Verification` | 一次性时效凭据（校验邮件、重置、状态值） | 与"账号绑定"无关；核销必须原子 |
| 匿名访客 | `anonymous` | 未携有效会话的请求来源 | 与匿名登录扩展（anonymous sign-in）区分 |
| 已认证主体 | `user` | 携带有效会话的主体 | 经冒充登录时，冒充者持有的是他人会话 |
| 管理员 | `admin` | `role` 命中 `adminRoles`（默认 `["admin"]`）的主体 | 管理员是主体角色；组织角色是组织内身份 |
| 组织成员 | `member` | 在组织内持有成员行的主体 | 成员不必然是管理员；角色为逗号分隔多值 |
| 组织 | `organization` | 多租户隔离单位 | 隔离边界是成员行，不是邮箱域 |
| 邀请 | `Invitation` | 邀请邮箱加入组织的时效凭据 | 状态拼写为 `canceled`（单 l，源码原样） |
| 团队 | `Team` | 组织内的二级作用域 | 团队成员是成员行的子集标注，不是新主体 |
| 设备码 | `DeviceCode` | 受限设备的授权申请记录 | 落库状态仅 `pending`/`approved`/`denied` |
| 冒充 | impersonation | 管理员以他人身份建立受管会话 | 冒充会话带 `impersonatedBy`，与正常登录区分 |
| 新鲜会话 | fresh session | 创建时间在 `freshAge` 内的会话 | 新鲜不是有效：有效是存在性，新鲜是时效窗口 |
| 等时失败 | equal-time failure | 账号不存在时仍执行散列以抹平时长差 | 是反侧信道策略，不是重试策略 |
| 隐式绑定 | implicit linking | 邮箱匹配下自动并入既有主体 | 需三门槛全过；显式绑定指已登录用户主动绑定 |
| 孤儿绑定 | orphaned binding | 存在但不归属任何主体的绑定行 | 遇到即拒绝登录，不静默重建 |
| 主体切换 | subject switching | 多会话或多组织上下文的切换 | 切换后旧作用域上下文失效（见 [权限](./permissions/#44-data-isolation)） |

### 12.2 Technical Terms

| 术语 | 解释 | 本方案中的用途 |
|---|---|---|
| 共享上下文（AuthContext） | 装配产物：配置、密钥、存储契约与扩展声明的单一事实来源 | [1 章](./architecture/)；所有能力从中取依赖 |
| 上下文补丁 | 扩展 `init` 返回的 `context` 增量，合并进共享上下文 | 插件贡献能力的唯一运行时通道 |
| 端点（Endpoint） | 带 path/method/模式校验/元数据的能力注册单元 | [2 章](./modules/02-endpoint/) |
| 分派器（dispatch） | 钩子管线 + 端点处理器的统一执行入口 | HTTP 与服务端调用共用（`dispatchAuthEndpoint`） |
| server-only 端点 | 带 `SERVER_ONLY` 元数据的端点，不进 HTTP 路由 | 服务端专用能力（8 个，见 [接口](./api/#315-server-only-endpoint-inventory)） |
| 拦截钩子 / 加工钩子 | before/after 钩子；before 可短路，after 可改写返回值 | 扩展接入请求时序的机制 |
| 适配器契约（DBAdapter） | 存储域的读写接口：CRUD + 原子原语 + 事务 | [8 章](./modules/08-storage/) |
| 原子消费（consumeOne） | 删除并返回单行的原子操作，重复消费只有一方成功 | 校验凭据核销、设备码兑换的基础原语 |
| 守卫式自增（incrementOne） | where 同时作选择器与守卫的原子自增 | 限流计数、失败计数 |
| 二级存储（secondaryStorage） | 外部 KV 契约（get/set/delete/getAndDelete/increment） | 会话与限流的可选权威存储 |
| 受信来源表 | 允许的 Origin 集合，支持通配与自定义协议 | 来源校验与跳转校验共用同一信任根 |
| Fetch Metadata | 浏览器附带的 `Sec-Fetch-*` 请求头 | 跨站导航登录拦截的判据 |
| PKCE | 授权码交换证明密钥（S256 挑战） | 联合授权的授权码防截取 |
| 状态值（state） | OAuth 防伪造随机值，两种存储策略 | 数据库策略（签名 Cookie + 校验行）/ Cookie 策略（加密 Cookie） |
| 断言直登（idToken sign-in） | 客户端直接提交第三方身份断言换取会话 | `/sign-in/social` 的 idToken 分支 |
| 签名 Cookie / 加密 Cookie | HMAC 签名 / 对称加密的 Cookie 载荷 | 会话凭据、状态值、账号数据 Cookie |
| 哈希派生密钥（purpose key） | 以密钥 + 用途串派生的独立子密钥 | 状态值、代理、链接会话令牌各自隔离密钥 |
| scrypt | 口令散列算法（默认参数 N=16384, r=16, p=1, dkLen=64） | 凭证域默认散列 |
| 广播频道（broadcast channel） | 基于 localStorage storage 事件的跨标签消息 | 会话变更跨标签同步 |
| 原子信号（atom signal） | 客户端布尔原子，动作成功后延迟翻转 | 触发会话等共享状态的重新获取 |
| SSR 水合 | 服务端渲染后客户端接管状态 | 会话原子的服务端快照重放 |
| OpenAPI 导出 | 运行时契约的机器可读文档 | 参考域（16 章） |
| 观测埋点（instrumentation） | 请求级链路与属性埋点 | 诊断域可选能力 |
| 遥测（telemetry） | 匿名使用统计，默认关闭 | 诊断域外围能力 |
