---
title: 权限与多主体
description: 七类主体的定义、唯一权限矩阵、授权判定机制与数据隔离规则。
sidebar:
  order: 20
  label: 权限与多主体
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 4. Actors and Permissions

权限与多主体回答"谁在请求、能对哪些资源做什么"。主体是发起动作的实体，权限是对"主体 × 资源 × 操作"三元组的判定结论；判定的时序在端点路由域的钩子管线中（拦截在处理器之前，见 [端点路由域](./modules/02-endpoint/)），失败码的语义见 [错误码](./errors/)。本章的权限矩阵（4.2）是全方案权限判定的唯一来源：模块章与接口章引用矩阵行号或行含义，不另立判定标准。

### 4.1 Actor Definitions

七类主体的名称来自 [统一命名清单](./index/#75-actor-names)。管理员不是独立的存储主体——`admin` 是 `user` 主体携带的一种权限态；组织成员同理，`member` 是 `user` 主体在某个组织作用域下的权限态。两层的角色来源不同：**管理员角色**由 admin 扩展的两个选项决定——`adminRoles`（默认 `["admin"]`）圈定哪些用户角色被视为管理员，`defaultRole`（默认 `"user"`）决定未显式赋角色时的落点（取证：`packages/better-auth/src/plugins/admin/types.ts:15-32`）；**组织角色**来自 `Member.role` 字段，逗号分隔的多角色列表（默认创建者为 `creatorRole` 即 `owner`，见 [数据字典](./data/#77-member-组织成员)）。

| 主体 | 数据归属字段 | 可否切换主体 | 跨主体可见性 | 默认主体确定方式 |
|---|---|---|---|---|
| `anonymous` 匿名访客 | `User.isAnonymous` 标记的主体行（anonymous 扩展贡献） | 不可；只能经正式登录升级为 `user` 并继承行 | 仅自身行；对外不可见 | 无有效会话凭据即视为 `anonymous` |
| `user` 已认证主体 | `User.id`，会话以 `Session.userId` 挂靠 | 可；多会话扩展开启时可切换本设备保存的其他会话（`/multi-session/set-active`） | 仅自身行与自身会话、绑定 | 会话 Cookie 解析出的会话记录（权威源优先） |
| `admin` 管理员 | 与 `user` 同一行；权限态存于 `User.role`（admin 扩展贡献字段） | 不可作为独立主体切换；冒充他人是另签会话而非切换 | 经 `hasPermission` 授权后可读任意主体 | 会话主体 `role` 拆分后命中 `adminRoles` 即为 admin |
| `member` 组织成员 | `Member` 行（`(organizationId, userId)` 唯一，`role` 逗号分隔多角色） | 可；`/organization/set-active` 切换的是会话上的活跃组织字段，主体本身不变 | 所在组织内可读组织、成员、邀请 | 会话 `activeOrganizationId` 指向的组织 + 当前主体在该组织下的 Member 行 |
| `organization` 组织 | `Organization` 行（`slug` 全局唯一） | 不发起请求；仅作为权限判定作用域 | 经成员关系间接可见 | 无默认；由请求参数或活跃组织字段提供 |
| `system` 系统进程 | 无存储归属行 | 不适用 | 不适用 | 服务端内嵌调用与 server-only 端点的调用方（见 [服务端接口](./api/#315-server-only-endpoint-inventory)） |
| `integration` 外部集成方 | `DeviceCode.clientId`、SSO 提供方记录等接入行 | 不可；只能在其授权范围内行动 | 仅其发起的授权流程内可见 | 设备码轮询凭 `device_code` 定位；SSO 凭提供方配置定位 |

切换主体的两条路径语义不同：多会话切换改的是"当前生效的是哪份会话凭据"，活跃组织切换改的是"当前会话挂哪个组织作用域"（写 `Session.activeOrganizationId`）；两者都不产生新的主体行，也不迁移任何资源归属。

### 4.2 Permission Matrix

判定只取三值：**允许**（无条件放行）、**拒绝**（无条件驳回）、**条件**（依据列写明的字段判定后放行或驳回）。接口标识对应 [服务端接口](./api/#32-interface-inventory) 清单。

#### 4.2.1 Session Resource Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `anonymous` | Session | 查看会话 | 拒绝 | 无会话凭据，`/get-session` 返回 `null`（API-03-01） |
| `user` | Session | 查看当前会话 | 允许 | 权威源优先，缓存副本默认可用 |
| `user` | Session | 查看自身会话列表 | 允许 | 以 `session.user.id` 过滤，仅活跃行（API-03-03） |
| `user` | Session | 查看列表 | 条件 | 会话创建时间在 `freshAge` 内，否则 `SESSION_NOT_FRESH` |
| `user` | Session | 吊销自身单会话 | 条件 | 目标令牌归属本人（`Session.userId === session.user.id`）；敏感端点读权威源（API-03-04） |
| `user` | Session | 吊销自身全部会话 | 允许 | 敏感端点，权威源读取（API-03-05） |
| `user` | Session | 吊销其余会话 | 允许 | 保留当前令牌，吊销其余活跃行（API-03-06） |
| `user` | Session | 切换活跃设备会话 | 条件 | 目标令牌存在于本设备 `_multi-` Cookie 集且未过期（API-09-14） |
| `admin` | Session | 吊销任意用户的会话 | 条件 | `hasPermission` 判定 `user.revoke-sessions`（API-09 组） |
| `system` | Session | 吊销与读写会话 | 允许 | 仅经 server-only 与内嵌调用通道（3.15） |

#### 4.2.2 User Profile Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `anonymous` | User | 读自身档案 | 拒绝 | 无会话 |
| `user` | User | 读自身档案 | 允许 | 会话响应携带（API-03-01） |
| `user` | User | 更新自身档案 | 允许 | 仅 `name`、`image` 与插件声明的可写附加字段；`email` 键一律拒绝（API-05-01） |
| `user` | User | 变更自身邮箱 | 条件 | 敏感会话 + `changeEmail.enabled` 未关闭；两步确认走校验链接（API-05-02） |
| `user` | User | 删除自身账号 | 条件 | `user.deleteUser.enabled` + 口令核对或新鲜会话（API-05-03） |
| `admin` | User | 读任意主体 | 条件 | `hasPermission` 判定 `user.get` |
| `admin` | User | 更新任意主体字段 | 条件 | `hasPermission` 判定 `user.update`；`set-role`、`set-email`、`set-password` 各有专属权限 |
| `admin` | User | 冒充 | 条件 | `hasPermission` 判定 `user.impersonate`，目标非管理员角色（除非 `allowImpersonatingAdmins` 或 `user.impersonate-admins`）（API-09-03） |
| `user` | User | 读/更新/删除他人档案 | 拒绝 | 归属过滤先行，处理逻辑只接受 `session.user.id` |

#### 4.2.3 Account Linking Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `user` | Account | 列自身绑定 | 允许 | 以 `session.user.id` 过滤；令牌字段永不外泄（API-05-06） |
| `user` | Account | 绑定社交账号 | 条件 | 敏感会话 + 目标第三方账号未被他人占用 + 邮箱一致或 `accountLinking.allowDifferentEmails`（API-05-07） |
| `user` | Account | 解绑账号 | 条件 | 新鲜会话 + 非最后一条绑定或 `accountLinking.allowUnlinkingAll`（API-05-08） |
| `anonymous` | Account | 列/绑/解绑 | 拒绝 | 无会话；`ACCOUNT_NOT_FOUND` 为统一"未命中"形态 |

#### 4.2.4 Two Factor Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `user` | TwoFactor | 启用 | 条件 | 口令核对通过（无密码部署豁免 `password` 参数）（API-14-01） |
| `user` | TwoFactor | 验证 TOTP 或备份码 | 条件 | 有效会话或登录中间态（`two-factor` 待验证 Cookie）（API-14-02、API-14-03） |
| `user` | TwoFactor | 停用 | 条件 | 有效会话 + 二次验证复核（two-factor 扩展的 disable 端点） |
| `anonymous` | TwoFactor | 启/停/验证 | 拒绝 | 两种主体态皆无即 `INVALID_TWO_FACTOR_COOKIE` |

#### 4.2.5 Organization Resource Rows

组织域的角色判定以 `Member.role`（逗号分隔）为依据，默认角色集为 `owner`、`admin`、`member`；下表"成员管理类角色"指 `owner` 或 `admin`。

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `user` | Organization | 创建 | 允许 | `slug` 全局唯一；创建者写入 `creatorRole`（默认 `owner`）成员行（API-13-01） |
| `user` | Organization | 列自己所属组织 | 允许 | 以自身 Member 行为准（organization 插件 list 端点） |
| `member` | Organization | 读取组织信息 | 允许 | 限本组织；活跃组织默认作用域 |
| `member` | Organization | 更新组织 | 条件 | `Member.role` 含 `owner` 或 `admin`（organization 插件 update 端点） |
| `owner` | Organization | 删除组织 | 条件 | `Member.role` 含 `owner`（organization 插件 delete 端点） |
| `member` | Member | 成员管理（移除、改角色） | 条件 | 操作者角色含 `owner` 或 `admin`；不可对同级或更高级角色越权操作 |
| `owner`、`admin` | OrganizationRole | 角色管理（建/删/改/查自定义角色） | 条件 | 动态角色开关开启；权限语句覆盖检查 |
| `owner`、`admin` | Invitation | 发起与取消邀请 | 条件 | `invitation.create` / `invitation.cancel` 权限判定（取证：`packages/better-auth/src/plugins/organization/routes/crud-invites.ts:273`） |
| `user`（被邀方） | Invitation | 接受邀请 | 条件 | `Invitation.email` 等于会话主体邮箱且 `status` 为 `pending`（API-13-03） |
| `user`（被邀方） | Invitation | 拒绝邀请 | 条件 | 同上；置 `rejected` |
| `member` | Organization | 跨组织读写 | 拒绝 | 非成员即 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` |

#### 4.2.6 Admin Surface Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `admin` | User | 列用户 | 条件 | `user.list`；查询面限 `limit`、`offset`、排序、检索、过滤（API-09-01） |
| `admin` | User | 封禁 | 条件 | `user.ban` 且目标非本人（`YOU_CANNOT_BAN_YOURSELF`）（API-09-02） |
| `admin` | User | 解封 | 条件 | `user.unban` |
| `admin` | User | 设角色 | 条件 | `user.set-role`；角色串写入 `User.role` |
| `admin` | User | 删除用户 | 条件 | `user.delete` 且目标非本人 |
| `admin` | Session | 吊销目标用户会话 | 条件 | `user.revoke-sessions` |
| `user` | 管理端任意操作 | 全部 | 拒绝 | `role` 不含 `adminRoles` 之一即权限不足，报 `YOU_ARE_NOT_ALLOWED_TO_*` 码 |

#### 4.2.7 Key Material and Device Authorization Rows

| 角色 | 资源 | 操作 | 判定 | 条件 |
|---|---|---|---|---|
| `user` | Jwks 相关 JWT | 为当前会话签发 JWT | 允许 | 有效会话（API-14-11） |
| `system` | JWT | 签发与校验 | 允许 | 仅 `signJWT`、`verifyJWT` 两个 server-only 端点（3.15） |
| `integration` | Jwks | 读取公钥集 | 允许 | 公钥本身是公开材料（API-14-10）；私钥任何主体都不可读 |
| `user` | Account 提供方令牌 | 取访问令牌 | 条件 | HTTP 调用须有效会话且账号归属本人；服务端内嵌调用可指定 `userId`（API-06-03） |
| `user` | Account 提供方令牌 | 刷新令牌 | 条件 | 同上 + 提供方支持刷新（API-06-04） |
| `integration` | DeviceCode | 发起设备授权与轮询 | 允许 | RFC 8628 语义；轮询须携带申请时获得的 `device_code` 与 `client_id`（API-14-04、API-14-05） |
| `user` | DeviceCode | 批准或拒绝 | 条件 | 有效会话 + `userCode` 命中 `pending` 状态行；行绑定会话主体（API-14-06、API-14-07） |
| `anonymous` | DeviceCode | 批准或拒绝 | 拒绝 | 无会话即 `unauthorized` 错误枚举 |

### 4.3 Authorization Mechanism

框架提供两个可复用的授权中间件，插件端点按需组合（取证：`packages/better-auth/src/api/middlewares/authorization.ts:16-166`）。两者都必须排在 `sessionMiddleware` 之后——先有主体，才有归属与角色可言。

**资源归属判定 `requireResourceOwnership`**：从请求体或查询取出资源 ID（`idParam` + `idSource`），按 `model` 查行，再核对资源行上的属主字段（`ownerField`，默认 `userId`）是否等于 `session.user.id`。三段失败语义：

| 失败点 | 结果 |
|---|---|
| 缺会话 | `UNAUTHORIZED` |
| 缺资源 ID 或资源行不存在 | `BAD_REQUEST` / `NOT_FOUND`（`notFoundError` 可定制）——资源缺失返回未找到，不区分"存在但不是你的" |
| 资源存在但属主不符 | `FORBIDDEN`（默认 403；`forbiddenStatus` 可改 `UNAUTHORIZED`，`forbiddenError` 可定制） |

判定通过的资源行挂到 `ctx.context.verifiedResource`，处理器直接复用，避免二次查询。

**组织角色判定 `requireOrgRole`**：从请求体或查询取出组织 ID（`orgIdParam` + `orgIdSource`），按 `(userId, organizationId)` 查 `Member` 行，再把行上的 `role` 逗号拆分（去空格、去空项），与 `allowedRoles` 求交集。三段失败语义：

| 失败点 | 结果 |
|---|---|
| 缺会话 | `UNAUTHORIZED` |
| 未装配 organization 扩展 / 缺组织 ID | `BAD_REQUEST` |
| 非该组织成员 | `FORBIDDEN`（"Not a member of this organization"） |
| 是成员但 `allowedRoles` 无交集 | `FORBIDDEN`（"Insufficient role for this operation"）；`allowedRoles` 省略或为空时任意成员身份即放行 |

判定通过的成员行挂到 `ctx.context.verifiedMember`。管理端不走这两个中间件，而是 `hasPermission` 纯函数：把会话主体的 `role`（逗号拆分）逐个喂给访问控制角色表，任一角色授权命中即放行；`adminUserIds` 列的固定管理员绕过角色表直接放行（取证：`packages/better-auth/src/plugins/admin/has-permission.ts:7-32`）。组织端点同理——操作者与目标组织的 Member 行角色决定 `invitation.create` 等语句是否授权。

### 4.4 Data Isolation

四条隔离铁律：

1. **默认主体范围附加**。凡"列出类"与"读取类"端点，查询范围一律以 `session.user.id`（或组织作用域下的 Member 行）为根追加过滤，不存在"全量列表 + 客户端自行过滤"的接口；`/admin/list-users` 是唯一的全量出口，由矩阵 4.2.6 的管理端条件把守。
2. **越权统一失败码**。无会话是 401 `UNAUTHORIZED`；会话有效但资源不属自己是 403 `FORBIDDEN`；绑定类资源把"不存在"与"非你的"统一为 `ACCOUNT_NOT_FOUND`（归属过滤先行后查询未命中，不泄露他人绑定存在性）；组织类越权是 403 或 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`。同一语义在全部扩展端点上保持一致，不因插件而异。
3. **主体切换后的失效路径**。切换活跃会话或活跃组织后，旧作用域的全部派生状态立即失效：被吊销的会话在权威源中删除，敏感端点强制绕过缓存副本读权威源（见 [会话域](./modules/03-session/#30-key-decisions)），因此吊销不存在缓存逃逸窗口；活跃组织切换重写 `Session.activeOrganizationId`，此前的组织上下文判定不再适用。
4. **跨主体聚合不出现**。任何端点都不提供跨主体聚合视图：会话列表只含本人，绑定列表只含本人，成员列表只限一个组织；聚合分析是宿主应用的职责，框架不开放越过归属边界的查询面。

### 4.5 Unauthorized Access Paths

三类典型越权路径与各自的失败形态（响应体统一为 `{ "code", "message", "status" }`，见 [错误码](./errors/#53-error-response-shape)）：

| 越权路径 | 触发方式 | 判定点 | 失败码与形态 |
|---|---|---|---|
| 未认证访问受保护端点 | 不携带或携带过期凭据调用会话要求端点 | `sessionMiddleware` / `sensitiveSessionMiddleware` 解析不出会话 | 401 `UNAUTHORIZED`；不泄露"凭据曾经有效"的任何信息 |
| 访问他人资源 | 提交指向他人资源的 ID（会话令牌、绑定 ID、扩展资源 ID） | 归属过滤先行：过滤后查不到即按不存在处理 | 绑定类 400 `ACCOUNT_NOT_FOUND`；通用资源类 403 `FORBIDDEN`（或定制 `NOT_FOUND`）；会话令牌类静默成功不泄露 |
| 访问非所属组织 | 携带非本人所属组织的 `organizationId` 调组织端点 | `requireOrgRole` 的 Member 行查询与角色交集 | 非成员 403（"Not a member of this organization"）或 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`；角色不足 403（"Insufficient role for this operation"） |

三条路径共享同一个设计取向：**失败响应不帮助攻击者缩小侦察范围**——第一条不区分凭据从未存在还是已过期，第二条不区分资源不存在还是属于别人（以资源类端点的码为准），第三条不区分组织不存在还是无权访问。攻击者能拿到的唯一可重试信号是 429 限流的 `X-Retry-After`（见 [守卫域](./modules/07-guard/)），它属于频率维度而非权限维度。
