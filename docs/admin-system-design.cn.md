# DSH 通用 AI 后台管理平台设计方案（草案 v3）

[English](admin-system-design.md) | 中文

状态：待评审。本文只确定方案，不包含实现代码。

本版在 v2“独立 `admin` profile”的基础上，补上**契约优先的平台内核**：认证、权限、菜单、路由、API、文档、任务、表单、AI、附件、主题、语言、图标、布局等基础设施，全部先定义接口，再由可替换的 provider 插件实现。`admin-app` 只是默认组合，不是写死的实现。

目标读者：DSH 插件开发者、后台平台架构师、需要替换/升级基础设施的团队。预备知识：DSH profile/bundle、Cordis Service、storage domain、Agent/Session、HTTP、RBAC、前端插件化。

阅读路径：只看结论 → 0、2、12；评审底座 → 2–7；评审人工闭环与 AI → 5、10；评审可替换性 → 2、7；评审安全 → 11。

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 运行形态 | 独立 profile `admin`，命令 `dsh --profile admin`；不是 DSH Web 的一个面板 |
| 平台内核 | `admin-kernel` 提供稳定的能力 façade、provider 注册、版本协商、替换/回滚、健康与目录 |
| 契约 | `admin-contract`（Host）与 `admin-ui-contract`（Browser）定义所有基础设施接口、token、错误码、版本 |
| 默认实现 | 每个能力有默认 provider 插件：auth/access/nav/api/audit/tasks/forms/assist/attachments/notifications/jobs/search/docs；可替换 |
| 前端 | `admin-layout` 只是默认 shell；shell、页面、主题、语言、图标、表单字段、附件渲染器都是 UI 插件 |
| 统一 API | 所有 provider/module 通过 `adminApi` 注册路由；统一鉴权、权限、审计、错误、分页、幂等、OpenAPI |
| 统一文档 | OpenAPI + capability catalog + UI manifest + 插件文档；`/api/admin/v1/capabilities`、`/api/admin/v1/ui-manifest` |
| 人工闭环 | Task/Approval/Form 引擎；审核、审批、退回、转交、评论、SLA、Outbox |
| AI 协助 | DSH Agent/LLM 产出摘要、风险、表单预填建议；人类决定，P1 不自动审批 |
| 可替换性 | 能力 provider、功能 module、UI 插件可独立安装/替换/升级；契约/kernel 是版本化稳定底座 |
| 首期重点 | 契约、kernel、profile、API、auth/access/nav/audit、默认 shell/theme/locale/icon、capability catalog |
| 非目标 | 不受控的远程脚本/iframe、多租户、AI 自动审批、跨实例集群、插件市场 |

一句话：**平台只暴露接口和稳定的能力 façade；默认实现只是插件；换实现不换消费者。**

### 0.1 八条铁律

1. 消费方只依赖 `admin-contract` / `admin-ui-contract`，不 import 任何 provider 实现。
2. 每个能力只有一个稳定 façade；provider 是 façade 后面的可替换实现。
3. 所有 API 走 `adminApi` 注册表；所有菜单/页面走 `adminNavigation`/UI registry。
4. 所有权限在服务端校验；菜单、路由、按钮隐藏只是体验。
5. 所有写操作有审计；破坏性操作有确认；AI 只给建议。
6. 所有插件可卸载；注册必须返回 disposer；逆序清理。
7. 契约有版本；provider 有兼容范围；不兼容显式拒绝，不静默降级。
8. 默认 bundle 只是组合；高级用户可以用 profile 行替换任意 provider。

### 0.2 v2 到 v3 的变化

| v2 | v3 |
|---|---|
| 固定 `admin-host` + 固定 `admin-layout` | 能力契约 + provider；shell 是插件 |
| 基础设施写在 host/UI 内部 | 每个基础设施有独立契约与默认 provider |
| 自定义页面 P2 构建期注册 | UI 插件运行时 + UI registry（P1/P2） |
| P3 才考虑运行时 UI 模块 | UI kernel 是底座的一部分 |
| 文档靠手写 | OpenAPI/capability catalog/UI manifest 生成 |
| 替换靠改代码 | 替换 provider、版本协商、drain/rollback |

## 1. 目标与边界

### 1.1 目标

- **通用**：不是只为论坛/内容写死，任何 AI 后端管理场景都能挂进来。
- **面向接口**：消费者看到的是能力接口，不是某个类、某个包、某张表。
- **可替换**：认证、权限、任务、表单、AI、附件、主题、语言、图标、shell 都能换实现。
- **可独立升级**：provider 与 kernel/contract 分开版本；升级一个 provider 不需要重写消费者。
- **统一**：一套 API、一套错误、一套权限、一套文档、一套 UI 运行时。
- **人工闭环**：审核/审批/表单/AI 协助是平台一等公民。
- **可运维**：健康、审计、限流、迁移、回滚、测试节点。

### 1.2 非目标

- 不做不受控的远程脚本/iframe 插件；UI 插件必须同源、声明契约、可卸载。
- 不做多租户 SaaS；P1 单组织单实例。
- 不做 AI 自动审批；P1 只建议。
- 不做可视化工作流设计器；工作流由插件代码定义、版本化。
- 不做跨 DSH 实例集群控制面；P3 再评估。
- 不做插件市场/计费/签名分发；P3 再评估。
- 不要求“任意 npm 包即插即用”；插件必须实现契约。

### 1.3 用户与场景

| 角色 | 场景 |
|---|---|
| 平台维护者 | 替换 auth/任务/主题/shell，升级 provider，不影响业务模块 |
| 管理员 | 初始化、用户/角色、审计、能力健康 |
| 审核员 | 任务箱、审核、审批、AI 建议、表单 |
| 运营 | 创建任务、补全表单、附件、评论、转交 |
| 终端用户 | 移动端/CLI 通过 terminal API 处理任务 |
| 插件作者 | 实现一个 capability provider 或一个业务 module |

## 2. 契约优先模型

### 2.1 什么是“能力”

一个能力 = **稳定接口 + 稳定 token + 能力清单 + 版本范围 + 默认 provider**。

| 组成 | 作用 |
|---|---|
| Interface | 消费方看到的纯类型契约；不依赖实现 |
| Token | Cordis 注入用的稳定服务名/令牌 |
| Manifest | provider 声明：能力、契约版本、优先级、必需/可选、数据域、配置 schema |
| Façade | kernel 提供的稳定对象，代理到当前 active provider |
| Provider | 真正实现能力的插件；可替换、可升级、可回滚 |
| Contract tests | 每个 provider 必须通过的公共行为测试 |

### 2.2 为什么用 façade，而不是让消费者直接注入 provider

如果消费者直接 `inject` 某个 provider 的 Service，替换实现时消费者要重新解析服务，in-flight 请求、缓存、UI 绑定都会抖动。Façade 模式：

- 消费者永远注入 `ctx.adminAuth` 这样的稳定 façade。
- kernel 在 façade 后面切换 active provider。
- 替换时先停止新请求进入旧 provider，等待 in-flight 完成，再切到新 provider；失败回滚。
- façade 统一做版本检查、健康、指标、错误归一化、审计。

这就是“面向接口而非实现”的落点。

### 2.3 必需能力与可选能力

| 类型 | 例子 | 缺失行为 |
|---|---|---|
| 必需 | auth、access、navigation、audit | 启动失败，列出缺失能力与候选 provider |
| 可选 | tasks、forms、assist、attachments、search、notifications、jobs、docs | 能力关闭；菜单/页面隐藏；其他功能正常 |

必需能力也允许替换，但必须有兼容 provider；不能“没有认证也启动”。API 网关/kernel 是平台基础设施，不属于可替换能力。

### 2.4 契约版本与能力协商

- 契约版本用 major.minor：major 不兼容，minor 只加字段/方法。
- Provider manifest 声明 `contract: '^1.2'`；kernel 只激活满足范围的 provider。
- API 用 `/v1` 路径版本；UI 插件用 `uiContract` 版本；不兼容显式拒绝。
- 废弃走弃用窗口：先标记 deprecated，再升 major；消费者有迁移期。
- 能力目录返回每个能力的 active provider、版本、健康、可用替代。

### 2.5 数据归属

- 每个 provider 拥有自己的 storage domain；不共享表。
- 替换 provider 时，数据迁移由 provider 声明：`migrateFrom` / `export` / `import`；没有迁移就明确要求人工导出，不静默丢数据。
- 业务 module 只存任务引用/表单值/审计等治理数据，业务数据仍归业务插件。
- 契约层不暴露表结构，只暴露操作。

## 3. 总体架构

```mermaid
flowchart TB
  Browser[👤 浏览器<br/>admin SPA] --> UIKernel["admin-ui-kernel<br/>UI 契约 / 插件加载 / registry"]
  Terminal[📱 其他终端<br/>mobile / CLI / 第三方] --> APIKernel["admin-api-kernel<br/>路由 / 鉴权 / 权限 / 审计 / OpenAPI"]

  subgraph Platform["dsh --profile admin"]
    UIKernel --> Shell["Shell 插件<br/>默认 admin-layout"]
    UIKernel --> Packs["Theme / Locale / Icon / Attachment / Form packs"]
    UIKernel --> UIPlugins["Page / Widget UI 插件"]

    APIKernel --> Facades["能力 façade<br/>auth / access / nav / tasks / forms / assist / attachments / audit ..."]
    Facades --> Providers["Provider 插件<br/>默认实现可替换"]
    Providers --> Store[(💾 各自 domain)]
    Providers --> DSH["DSH 能力<br/>Agent / Session / LLM / Tools"]
    Providers --> Biz["业务插件服务"]
    Kernel["admin-kernel<br/>provider 注册 / 版本 / 替换 / 健康"] --> Facades
    Docs["admin-docs<br/>OpenAPI / capability catalog / UI manifest"] --> APIKernel
  end

  APIKernel --> Browser
  APIKernel --> Terminal

  classDef actor fill:#FFE66D,stroke:#F08C00,color:#000
  classDef primary fill:#90EE90,stroke:#2B8A3E,color:#000
  classDef data fill:#E6E6FA,stroke:#5F3DC4,color:#000
  classDef platform fill:#87CEEB,stroke:#1864AB,color:#000
  class Browser,Terminal actor
  class Kernel,Facades,UIKernel,APIKernel,Shell,Packs,UIPlugins primary
  class Store data
  class Platform,Providers,DSH,Biz,Docs platform
```

### 3.1 分层

| 层 | 组件 | 负责 |
|---|---|---|
| 契约层 | `admin-contract` / `admin-ui-contract` | 接口、token、错误码、版本、manifest 类型 |
| 内核层 | `admin-kernel` / `admin-ui-kernel` | provider 注册、版本协商、替换/回滚、健康、目录 |
| 网关层 | `admin-api-kernel` | 路由表、鉴权、权限、审计、错误、OpenAPI、幂等 |
| 能力层 | auth/access/nav/tasks/forms/assist/attachments/... providers | 每个能力的实现 |
| UI 层 | shell/theme/locale/icon/form/attachment/page plugins | 所有可见基础设施与页面 |
| 业务层 | `admin-module-*` | 权限、路由、任务类型、表单、处理器 |
| 运行层 | `admin-app` | profile bundle、startup、webserver、静态 SPA |

### 3.2 消费者视角

业务 module 只做三件事：

1. 声明自己需要的权限、导航、API、任务类型、表单。
2. 通过 façade 调用能力（`ctx.adminTasks.create`、`ctx.adminAttachments.put`）。
3. 提供 handler/页面，不关心 auth 用 Better Auth 还是 OIDC，也不关心主题/图标用哪套 pack。

### 3.3 进程边界

- `admin` 与 `web` 是兄弟 profile；同一个 `DSH_HOME` 只允许一个写进程。
- admin profile 管理自己的数据与 profile；跨 profile/跨实例是 P3。
- 其他终端只调 admin API，不直接访问 storage。

## 4. Profile 与启动

### 4.1 安装与启动

```text
dsh plugin --profile admin add @veren/admin-app
dsh --profile admin --host 127.0.0.1 --port 3081 --no-open
```

`admin` 不是内置模板名，不要用 `--from-default-profile web` 创建。`dsh plugin` 会把 profile 初始化为默认 base 层，再把 `admin-app` 加入 `dsh.profile.bundles`。

### 4.2 默认组合不是硬编码

`admin-app` 只是默认 provider 的组合：

```text
dsh-base
admin-kernel
admin-api-kernel
admin-ui-kernel
admin-auth-better
admin-access-rbac
admin-navigation-default
admin-audit-default
admin-tasks-default
admin-forms-json-schema
admin-assist-dsh
admin-attachments-local
admin-notifications-default
admin-jobs-default
admin-settings-default
admin-docs-openapi
admin-web
admin-shell-default
admin-theme-default
admin-locale-zh-en
admin-icons-default
```

高级用户可以：

- 禁用 `admin-auth-better`，启用 `admin-auth-oidc`；
- 禁用 `admin-theme-default`，启用自有主题 pack；
- 禁用 `admin-shell-default`，启用自有 shell；
- 不装默认组合，自己用 profile patch 只装 kernel + 需要的 provider。

`admin-app` 的 patch 行只负责默认装配；替换 provider 不需要改 kernel/contract。

### 4.3 启动顺序

1. `admin-startup` 解析参数，提供 `adminStartup`。
2. `webserver` 启动 HTTP。
3. `admin-kernel` 建立能力 façade 与 provider 注册表。
4. 默认 provider 注册；kernel 选择 active provider，检查必需能力。
5. `admin-api-kernel` 注册 `/api/*` 路由。
6. `admin-ui-kernel` 提供 `/admin/ui-runtime` 与 `ui-manifest`。
7. `admin-web` 服务 SPA、深链、静态资源和 `/admin/ui-plugins/*`。
8. `admin-runtime` 打印 URL，健康自检。

### 4.4 关键配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `server.publicUrl` | 空 | 对外 URL；不改变监听 |
| `server.trustProxy` | false | 是否信任 forwarded header |
| `server.trustedOrigins` | [] | 浏览器 Origin 白名单 |
| `auth.sessionDays` | 7 | 会话时长 |
| `auth.idleHours` | 12 | 空闲过期 |
| `auth.setupTtlMinutes` | 15 | 首次 setup token |
| `auth.loginRateLimit` | 10/60s | 登录限流 |
| `api.maxBodyBytes` | 1 MiB | JSON body 上限 |
| `api.rateLimit` | 120/min | API 限流基线 |
| `attachments.maxBytes` | 25 MiB | 单附件上限 |
| `attachments.allowedMime` | 安全列表 | 允许的 MIME |
| `tasks.overdueScanSeconds` | 60 | 超时扫描 |
| `assist.enabled` | true | 是否允许 AI |
| `assist.model` | DSH 默认 | assist 模型 |
| `assist.timeoutMs` | 120000 | 单次超时 |
| `assist.maxConcurrency` | 2 | 并发上限 |
| `audit.retentionDays` | 180 | 审计保留 |
| `audit.maxEntries` | 100000 | 审计上限 |
| `storage.backend` | json | 生产验证后切 SQLite |
| `ui.defaultLocale` | zh | 默认语言 |

配置非法在加载时显式失败；秘密走 `ctx.credentials`。

### 4.5 包目录

```text
plugins/admin/
  contract/          @veren/admin-contract（Host 契约）
  ui-contract/       @veren/admin-ui-contract（Browser 契约）
  kernel/            @veren/admin-kernel
  ui-kernel/         @veren/admin-ui-kernel
  api/               @veren/admin-api-kernel
  providers/
    auth-better/     @veren/admin-auth-better
    auth-oidc/       @veren/admin-auth-oidc（可选）
    access-rbac/     @veren/admin-access-rbac
    nav-default/     @veren/admin-navigation-default
    audit-default/   @veren/admin-audit-default
    tasks-default/   @veren/admin-tasks-default
    forms-json/      @veren/admin-forms-json-schema
    assist-dsh/      @veren/admin-assist-dsh
    attachments-local/ @veren/admin-attachments-local
    notifications-default/ ...
    jobs-default/ ...
    settings-default/ ...
    docs-openapi/    @veren/admin-docs-openapi
  ui/
    shell-default/   @veren/admin-shell-default
    theme-default/   @veren/admin-theme-default
    locale-zh-en/    @veren/admin-locale-zh-en
    icons-default/   @veren/admin-icons-default
    ui-kit/          @veren/admin-ui-kit
  web/               @veren/admin-web
  app/               @veren/admin-app
  modules/           admin-module-*（业务）
```

对外入口只有 `admin-app`（安装/启动）、`admin-contract`（Host 契约）、`admin-ui-contract`（UI 契约）。其他是 provider/默认实现，随默认 bundle 安装，也可逐个替换。

### 4.6 DSH 依赖规则

- DSH 包只写 `peerDependencies` + `devDependencies`；版本契约写 `engines.dsh`。
- `dependencies` 只放非 DSH 库：Better Auth、Zod、Ajv、React Router 等。
- 绝不在 `dependencies` 放 `cordis`/`dsh-*`。
- 提供服务/能力的包默认导出 Service 类；只注册 provider/module 的函数插件用命名 `apply`；不要混用。
- 启动自检：缺 `webserver`、`storageDomain`、`agent` 等关键服务时，报缺失包并停止。

## 5. Host 能力层

### 5.1 能力清单

| 能力 | 契约接口 | 默认 provider | 必需 | 数据域 |
|---|---|---|---|---|
| `auth` | 用户、密码、会话、API Token | `auth-better` | 是 | `admin_auth` |
| `access` | 角色、权限、数据范围、授权 | `access-rbac` | 是 | `admin_access` |
| `navigation` | 菜单树、路由 manifest、badge | `navigation-default` | 是 | 代码/模块注册 |
| `audit` | intent/outcome/denied、查询、保留 | `audit-default` | 是 | `admin_audit` |
| `tasks` | 任务、状态机、Outbox、通知 | `tasks-default` | 可选 | `admin_tasks` |
| `forms` | 表单定义、校验、版本 | `forms-json-schema` | 可选 | 代码/模块 |
| `assist` | AI job、建议、预填 | `assist-dsh` | 可选 | `admin_assist` |
| `attachments` | 上传、元数据、下载、配额 | `attachments-local` | 可选 | `admin_attachments` + 文件 |
| `notifications` | 站内通知、未读、已读 | `notifications-default` | 可选 | `admin_notifications` |
| `jobs` | 后台任务、进度、取消 | `jobs-default` | 可选 | `admin_jobs` |
| `settings` | 模块配置 schema、读取、校验、revision | `settings-default` | 可选 | profile 配置 |
| `search` | 任务/审计/模块搜索 | `search-default` | 可选 | `admin_search` |
| `docs` | OpenAPI、能力目录、UI manifest | `docs-openapi` | 可选 | 无 |

必需能力缺失 -> 启动失败。可选能力缺失 -> `bootstrap.features` 标 false，菜单/页面隐藏。

### 5.2 Kernel：注册、选择、替换

Provider 包的 `package.json` 声明 `dsh.admin.provider`；kernel 扫描 active profile 的 provider，不维护硬编码列表。manifest 至少包含：

| 字段 | 含义 |
|---|---|
| `id` | provider 唯一 id |
| `capability` | 能力名 |
| `contract` | 兼容的契约范围 |
| `priority` | 同能力多 provider 时的选择优先级 |
| `essential` | 是否必需 |
| `dataDomain` | 拥有/迁移的 domain |
| `config` | Schemastery 配置 schema |
| `migrations` | 从哪些旧 provider/版本迁移 |
| `health` | 健康检查入口 |

替换流程：

1. 新 provider 注册，manifest 校验通过。
2. kernel 检查契约版本、能力冲突、必需能力覆盖。
3. 停止新请求进入旧 provider，等待 in-flight 完成（有超时）。
4. 激活新 provider；健康检查。
5. 失败则回滚旧 provider；成功则释放旧 provider。
6. 写审计：谁在什么时候替换了哪个能力、从哪个 provider 到哪个 provider。
7. 数据迁移按 manifest 的 `migrations` 执行；没有迁移则拒绝自动替换。

替换不是零成本：in-flight 请求、缓存、UI 订阅都要处理；P1 支持“重启后切换”，P2 再支持热替换。

### 5.3 统一 API 与文档

所有 provider/module 都通过 `adminApi` 注册路由：

- `audience`: `admin` / `terminal` / `public`
- `permission` / `scopes`
- `input` / `output` Zod schema
- `handler`
- `summary` / `tags`
- `idempotent`

`adminApi` 统一处理：requestId、CORS、body 限制、认证、CSRF、权限、限流、校验、审计、错误、分页、OpenAPI。

统一响应：

```text
{ items, nextCursor? }
{ error: { code, message, details?, requestId } }
```

统一文档：

- `/api/openapi.json`：当前路由表生成的 OpenAPI 3.1。
- `/api/admin/v1/capabilities`：能力、active provider、版本、健康、可替换候选。
- `/api/public/v1/ui-manifest`：登录前需要的核心 UI pack（shell/theme/locale/icons/login），不泄露业务数据。
- `/api/admin/v1/ui-manifest`：登录后的完整 UI 插件、契约版本、入口、贡献项。
- `/api/admin/v1/docs`：文档索引（OpenAPI、能力目录、插件说明）。
- 文档页在 admin shell 中渲染；不手写第二份 API spec。
- 由 OpenAPI + contract schema 生成 TypeScript 客户端，SPA/UI 插件只使用 runtime 提供的 client，不各自手写 fetch；外部 SDK 在 P2 生成。

### 5.4 身份、权限与数据范围

- 认证是能力；默认 `auth-better` 复用 Better Auth 的密码/会话能力，也可换 OIDC/LDAP provider。
- 首次启动 setup token；不开放公开注册。
- 会话 cookie `HttpOnly`、`SameSite=Lax`、`Secure` iff TLS；CSRF 双提交。
- API Token 给终端：只存哈希、前缀可见、可撤销、scope 收窄。
- 权限字符串：`admin.<domain>.<action>`、`terminal.<domain>.<action>`。
- 角色：owner/admin/reviewer/operator/auditor/viewer；数据范围 all/assigned/own。
- 每个 API/菜单/页面/任务迁移/附件操作都声明权限；服务端强制。
- 防自锁：最后 owner、最后管理角色、内置角色不可改。

### 5.5 Task / Approval / Form / AI

- `tasks` 能力：任务类型、状态机、领取、决定、评论、Outbox、SLA、通知。
- `forms` 能力：JSON Schema + UI Schema、服务端校验、版本化。
- `assist` 能力：隔离 DSH Agent 产出结构化建议；人类应用；不自动通过。
- DSH `ctx.approval` 只用于 Agent 工具放行；业务审批走 `tasks`，两者不混用。
- 任务事件权威、快照可重建；不假设跨表事务；reconciliation 修复。
- 副作用用 Outbox + 幂等 handler；失败可见可重试。
- AI 默认无 shell/fs/network 工具；任务类型声明只读工具；输出 schema 校验；P1 不自动审批。

### 5.6 附件能力

附件是平台基础设施，不是某个模块的私货。

Host 契约：

| 方法 | 作用 |
|---|---|
| `createUpload` | 创建上传会话：文件名、MIME、大小、配额、权限 |
| `put` | 写入字节（流式/分片） |
| `complete` | 完成上传，生成附件 id/元数据 |
| `get` | 读取元数据（按权限） |
| `open` | 认证下载流 |
| `delete` | 软删/硬删（按策略） |
| `list` | 按任务/表单/资源列出 |

能力点：

- 存储 provider 可替换：本地、S3、对象存储；附件 id 稳定，URL 不直接暴露物理路径。
- MIME/大小/数量配额；MIME sniff；可选病毒扫描 hook。
- 下载必须认证/授权；`Content-Disposition` 安全；禁止路径穿越。
- 附件可挂在任务、评论、表单字段；删除走引用计数/软删。
- 审计上传/下载/删除；敏感附件可要求额外权限。

UI 契约：

- `AttachmentRenderer` 按 MIME/kind 注册：image、pdf、text、audio、video、download fallback。
- 上传组件、附件列表、预览弹窗由 UI 插件提供；默认 ui-kit。
- 附件渲染器可替换，不能绕过下载鉴权。

### 5.7 数据与迁移

每个 provider 拥有自己的 domain；不共享表。

| Domain | 归属 |
|---|---|
| `admin_auth` | auth provider |
| `admin_access` | access provider |
| `admin_audit` | audit provider |
| `admin_tasks` | tasks provider |
| `admin_assist` | assist provider |
| `admin_attachments` | attachments provider（元数据） |
| `admin_notifications` | notifications provider |
| `admin_jobs` | jobs provider |
| `admin_search` | search provider（可选） |
| `admin_api` | api kernel（幂等/偏好） |
| 文件对象 | attachments provider |

- 契约层不暴露表结构；替换 provider 通过 `migrations`/export/import。
- 没有迁移的替换必须显式拒绝，不能静默丢数据。
- Domain 打开失败停止启动；审计不可用不允许写操作。

## 6. UI 内核与契约

### 6.1 UI kernel

`admin-ui-kernel` 是双半边：Host 半边扫描 UI 插件/生成 manifest/提供同源资源，Browser 半边加载插件并维护 UI registry。

- 提供稳定的 UI runtime 模块：通过 import map 把 `@veren/admin-ui-runtime` 映射到同源 `/admin/ui-runtime.js`，导出 React、ReactDOM、React Router、UI kit、API client、i18n、theme、icons；插件构建时 externalize 这些 specifier，不各自打包 React。
- `admin-ui-kernel` 的 Host 半边扫描 active profile 中声明 `dsh.admin.ui` 的包，解析 ESM 入口，由 `admin-web` 以 `/admin/ui-plugins/<id>/...` 同源提供；manifest 只列同源入口。
- 登录前从 `/api/public/v1/ui-manifest` 读取核心 shell/theme/locale/icon/login pack；登录后从 `/api/admin/v1/ui-manifest` 读取页面/模块插件。两者都是同源静态入口，动态 `import()` 加载。
- 校验 `uiContract` 版本、声明的能力、依赖；不兼容拒绝并显示错误。
- 插件导出 `activate(runtime)` / `deactivate()`；注册项返回 disposer。
- 插件加载失败隔离：一个页面/主题失败不拖垮整个后台。
- 卸载时逆序清理：页面、widget、字段渲染器、主题、语言、图标。
- 共享依赖通过 import map/全局运行时提供，插件不得自带第二份 React。

UI 插件 manifest：

| 字段 | 含义 |
|---|---|
| `id` / `version` | 插件标识 |
| `uiContract` | 兼容的 UI 契约版本 |
| `entry` | 同源 ESM 入口 |
| `capabilities` | 依赖的 Host 能力 |
| `contributions` | 页面/导航/主题/语言/图标/渲染器 |
| `integrity` | 可选校验 |

UI 插件包的 `package.json` 用 `dsh.admin.ui` 声明 `contract`、`entry`、`files`；没有该声明的包不会进入 manifest，也不会被加载。

### 6.2 UI 契约

| 契约 | 作用 | 默认实现 |
|---|---|---|
| `AdminShell` | 顶栏、侧栏、内容区、响应式、焦点管理 | `shell-default` |
| `PageContribution` | 路由页面、详情、表单、任务箱 | 内置通用页面 |
| `NavContribution` | 菜单项、分组、badge | `navigation-default` + shell |
| `ThemePack` | 颜色/间距/圆角/阴影 token、亮暗/系统 | `theme-default` |
| `LocalePack` | zh/en/其他语言字典、日期格式 | `locale-zh-en` |
| `IconPack` | 图标名 → React 图标 | `icons-default` |
| `FormFieldRenderer` | 字段类型 → 控件 | `ui-kit` |
| `AttachmentRenderer` | MIME/kind → 预览/下载 | `ui-kit` |
| `WidgetContribution` | 仪表盘卡片 | 模块 |
| `CommandContribution` | 命令面板动作 | 模块 |

契约规则：

- Shell 只负责布局和渲染，不 fetch、不鉴权；数据由页面/内核提供。
- 页面不接触 `window`/fetch 细节；使用 runtime 提供的 API client、i18n、theme、icons。
- 主题只接受 token/受控 CSS，不接受任意远程 CSS。
- 语言包只注册字典；缺失 key 回退英文/key。
- 图标包只提供本地组件；不接受远程 SVG。
- 附件渲染器必须走认证下载，不得直接拼物理路径。

### 6.3 替换 UI 基础设施

- 换 shell：禁用 `shell-default`，启用 `shell-compact`；页面/nav 注册不变。
- 换导航策略：替换 `navigation` provider；shell/页面不用改。
- 换主题：禁用 `theme-default`，启用品牌主题包；颜色 token 变化，页面不改。
- 换语言：启用新 locale pack；服务端 `labelKey` 不变。
- 换图标：启用新 icon pack；菜单只引用图标名。
- 换附件渲染器：注册新的 MIME renderer；任务/评论不改。

### 6.4 统一 UX

- 路由：History API + SPA fallback；`/login`/`/setup` 公开；未知路径 404；无权限 403。
- 菜单：服务端 manifest，按权限/范围过滤；shell 只渲染。
- 页面骨架：页头、工具条、内容、底部、抽屉、Toast；加载/空/错/403/冲突状态齐全。
- 主题：light/dark/system；只走 token；尊重 reduced motion。
- 语言：zh/en 起步；日期/数字 `Intl`。
- 可访问性：语义表格、焦点管理、键盘、`aria-live`、对比度。

## 7. 插件模型与替换升级

### 7.1 三类插件

| 类型 | 例子 | 职责 |
|---|---|---|
| Capability provider | `auth-better`、`tasks-default`、`theme-default` | 实现一个能力契约 |
| Feature module | `admin-module-content`、`admin-module-orders` | 注册权限/导航/API/任务/表单 |
| UI plugin | `shell-default`、`page-audit`、`icons-brand` | 注册 UI 贡献 |

### 7.2 模块注册

Module descriptor：

| 字段 | 含义 |
|---|---|
| `identity` | id、version、apiVersion |
| `permissions` | 新权限 |
| `navigation` | 菜单/路由 |
| `api` | admin/terminal 路由组 |
| `tasks` | 任务类型、工作流、表单、handler |
| `pages` | UI 页面 componentId（可选） |
| `settings` | 模块设置 schema |

`ctx.admin.registerModule(descriptor)` 先完整校验再提交；返回 disposer；卸载逆序清理。

### 7.3 独立替换/升级

- Provider 与 module 分离版本；module 只依赖契约版本。
- 替换 provider：安装新包、禁用旧包、kernel 选择新 provider；必要时迁移/重启。
- 升级 provider：契约兼容范围内直接升级；major 变更需消费者迁移。
- UI 插件：manifest + uiContract；不兼容拒绝；可独立启停。
- 默认 `admin-app` 只是组合；可用 profile patch 替换任意行。
- 回滚：保留旧 provider 行，切回即可；数据迁移需可逆或备份。
- 测试：契约测试 + provider swap 测试 + UI unload 测试。

### 7.4 不可替换的部分

- `admin-contract`/`admin-ui-contract`/`admin-kernel`/`admin-ui-kernel`/`admin-api-kernel` 是平台底座，不承诺“随便换”；它们通过版本升级。
- 业务 module 的 handler 逻辑属于该 module；换 module 不是“替换基础设施”，是换业务。
- 数据迁移不是自动的；provider 必须声明能力。

## 8. API 面

### 8.1 统一入口

| 受众 | 前缀 | 认证 |
|---|---|---|
| admin | `/api/admin/v1` | session cookie + CSRF |
| terminal | `/api/terminal/v1` | Bearer Token + scope |
| public | `/api/public/v1` | 无/轻量 |

核心端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET/POST` | `/api/public/v1/setup` | 首次 setup |
| `POST` | `/api/public/v1/login` | 登录 |
| `POST` | `/api/admin/v1/logout` | 退出 |
| `GET` | `/api/admin/v1/bootstrap` | 用户/权限/菜单/badge/CSRF/features |
| `GET` | `/api/admin/v1/capabilities` | 能力目录/健康/active provider |
| `GET` | `/api/public/v1/ui-manifest` | 登录前核心 UI pack |
| `GET` | `/api/admin/v1/ui-manifest` | 登录后完整 UI 插件清单 |
| `GET` | `/api/admin/v1/tasks` | 任务列表 |
| `GET` | `/api/admin/v1/tasks/:id` | 任务详情 |
| `POST` | `/api/admin/v1/tasks` | 创建任务 |
| `POST` | `/api/admin/v1/tasks/:id/claim` | 领取 |
| `POST` | `/api/admin/v1/tasks/:id/confirmations` | 高危确认 token |
| `POST` | `/api/admin/v1/tasks/:id/transitions` | 决定 |
| `POST` | `/api/admin/v1/tasks/:id/comments` | 评论 |
| `POST` | `/api/admin/v1/tasks/:id/assist` | AI 建议 |
| `GET/DELETE` | `/api/admin/v1/assist/jobs/:id` | 查询/取消 AI job |
| `POST` | `/api/admin/v1/suggestions/:id/apply` | 应用建议 |
| `GET/POST` | `/api/admin/v1/attachments` | 附件列表/上传 |
| `GET` | `/api/admin/v1/attachments/:id` | 元数据 |
| `GET` | `/api/admin/v1/attachments/:id/content` | 认证下载 |
| `DELETE` | `/api/admin/v1/attachments/:id` | 删除 |
| `GET` | `/api/admin/v1/audit` | 审计 |
| `GET` | `/api/admin/v1/notifications` | 通知 |
| `GET/PUT` | `/api/admin/v1/settings` | 模块配置读取/写入 |
| `GET` | `/api/terminal/v1/tasks` | 终端任务 |
| `POST` | `/api/terminal/v1/tasks/:id/transitions` | 终端决定 |
| `GET` | `/api/openapi.json` | OpenAPI |

### 8.2 统一语义

- 成功列表 `{ items, nextCursor? }`；错误 `{ error: { code, message, details?, requestId } }`。
- `Idempotency-Key` header；24 小时；同 key 不同 body 409。
- 写操作审计 intent/outcome；拒绝/CSRF/限流记 denied。
- 权限/范围在 API 层强制；分页/导出同范围。
- 错误码稳定：AUTH_REQUIRED / FORBIDDEN / CSRF_FAILED / VALIDATION_FAILED / CONFLICT / NOT_FOUND / TASK_STATE_INVALID / FORM_INVALID / ATTACHMENT_TOO_LARGE / ATTACHMENT_MIME / CAPABILITY_UNAVAILABLE / AI_UNAVAILABLE / INTERNAL。

## 9. 界面与交互

任务箱/详情/人工闭环采用以下约定，由 UI 插件/pack 渲染：

- 路由地图：`/login`、`/setup`、`/`、`/tasks`、`/tasks/:taskId`、`/audit`、`/settings`、`/system/*`。
- 壳：默认 shell 提供左侧菜单、顶栏、通知、用户菜单、主题/语言切换；可替换。
- 任务箱：我的待办/角色队列/全部/超时/已完成；筛选、领取、批量。
- 详情：表单、时间线、AI 建议面板、决定栏、附件、评论。
- 状态：加载/空/403/404/依赖不可用/冲突/审计不完整。
- 主题/语言/图标/附件渲染器全部来自 pack/UI 插件。

## 10. 关键流程

### 10.1 登录与 bootstrap

```mermaid
sequenceDiagram
  participant U as 👤 User
  participant SPA as admin SPA
  participant API as admin-api-kernel
  participant Auth as auth façade
  participant Access as access façade
  participant UI as ui-kernel

  U->>SPA: Open /
  SPA->>API: GET /api/public/v1/ui-manifest
  API-->>SPA: core shell/theme/locale/icon packs
  SPA->>UI: load core packs
  SPA->>API: GET /bootstrap
  API->>Auth: resolve session
  Auth-->>API: principal
  API->>Access: permissions + scope
  API-->>SPA: user / nav / badges / csrf / features
  SPA->>API: GET /api/admin/v1/ui-manifest
  API-->>SPA: page/module UI plugins
  SPA->>UI: load page plugins
  SPA-->>U: render
```

### 10.2 任务 + AI + 人工决定 + Outbox

```mermaid
sequenceDiagram
  participant U as 👤 Reviewer
  participant SPA as admin SPA
  participant API as admin-api-kernel
  participant Tasks as tasks façade
  participant Assist as assist façade
  participant DSH as DSH Agent
  participant Biz as Business plugin

  U->>SPA: Open task
  SPA->>API: GET /tasks/:id
  API->>Tasks: get task/events/suggestions
  U->>SPA: Request AI
  SPA->>API: POST /tasks/:id/assist
  API->>Assist: request job
  Assist->>DSH: isolated agent + read-only tools
  DSH-->>Assist: structured suggestions
  Assist->>Tasks: save suggestions
  U->>SPA: Apply + edit form
  U->>SPA: Approve
  SPA->>API: POST /tasks/:id/transitions
  API->>Tasks: authorize/state/revision
  Tasks->>Tasks: append event + outbox
  Tasks-->>API: result
  API-->>SPA: success
  Tasks->>Biz: dispatcher runs idempotent side effect
```

### 10.3 替换 provider

1. 安装新 provider 包，profile 行启用；旧 provider 行保留但禁用/降级。
2. kernel 校验 manifest/契约/能力/数据迁移。
3. 停止新请求进入旧 provider；等待 in-flight。
4. 激活新 provider；健康检查；失败回滚。
5. 审计替换；UI 能力目录刷新；消费者继续使用同一 façade。

## 11. 安全与运维

- 默认 loopback；非 loopback 要 TLS/可信代理；Cookie `Secure` 按协议。
- CSRF、CSP、CORS、限流、body 限制；密码强策略；登录锁定。
- API Token 哈希、scope、撤销；附件认证下载、MIME/大小/扫描。
- 服务端权限；防自锁；审计只追加。
- UI 插件同源、manifest 校验、uiContract 校验、无远程脚本、可卸载。
- AI 提示注入：任务内容不可信；只读工具；结构化输出；人类决定。
- 单写进程；domain 打开失败停止；Outbox 可见重试。
- 备份/恢复；审计导出 P2；能力目录/健康页。

## 12. 路线图

| 阶段 | 目标 | 交付 | 完成标准 |
|---|---|---|---|
| P0 契约与内核 | `dsh --profile admin` 跑起来 | contract/ui-contract、kernel、api-kernel、ui-kernel、auth/access/nav/audit 默认 provider、shell/theme/locale/icons 默认 pack、web/app、docs/capability catalog | 登录；菜单/权限/路由；换主题/语言/图标不换页面；缺必需能力显式失败 |
| P1 人工闭环 | 审核/审批/附件/AI 可用 | tasks/forms/assist/attachments/notifications/jobs providers、任务箱/详情、Outbox、UI 插件运行时、terminal token | 任务→AI→人工→副作用→审计；附件上传/下载；UI 插件可加载/卸载 |
| P2 可替换与治理 | 独立升级 | provider swap/rollback 工具、契约测试套件、OpenAPI/SDK、用户/角色高级治理、SLA 升级、文档页 | 替换 auth/nav/theme/shell provider 消费者不改；不兼容拒绝；回滚可用 |
| P3 平台化 | 运营与生态 | 插件市场/签名（评估）、Webhook/邮件、多实例、自动审批策略、分析 | 第三方按契约接入；策略有双人复核和审计 |

P1 不做：多租户、AI 自动审批、可视化工作流设计器、跨实例集群。

## 13. 测试与验收

### 13.1 契约测试

- 每个 capability 有一套共享 contract tests；默认 provider 和新 provider 都跑。
- API 路由 schema/错误/权限/审计一致。
- UI 契约：shell/theme/locale/icon/attachment renderer/form field 的公共行为。
- Provider manifest/version negotiation；不兼容拒绝。

### 13.2 替换测试

- 在 composition 测试里换 auth/access/nav/theme/shell provider，消费者不变。
- 缺必需能力启动失败；缺可选能力功能隐藏。
- 替换失败回滚；in-flight 请求完成；数据迁移缺失时拒绝。
- UI 插件卸载后无残留；重复加载幂等。

### 13.3 业务与安全

- 任务状态机/并发/幂等/Outbox/审计。
- 附件 MIME/大小/权限/路径穿越/下载授权。
- CSRF/越权/Token scope/AI 注入/UI 插件逃逸。
- E2E：测试节点安装、`dsh --profile admin`、登录、任务、附件、替换主题/shell、审计。
- 测试节点安全：独立 `DSH_HOME`、own store、copy、零共享 inode、绝不写 `~/.dsh`。

### 13.4 完成定义

- P0 能在真实 profile 启动；能力目录/健康可见。
- 换 theme/locale/icon/shell 不需要改页面。
- 换 auth provider 后业务 module 不改。
- 缺必需能力 fail loud；缺可选能力优雅降级。
- 所有写操作审计；所有权限服务端校验。
- UI 插件加载/卸载安全；契约不兼容拒绝。
- 测试节点安装/卸载通过；无 `~/.dsh` 写入。

## 14. 风险与待确认

| 风险 | 缓解 |
|---|---|
| 契约抽象过度 | 只抽真实有替换需求的能力；P0 只做 auth/access/nav/api/audit/tasks/forms/assist/attachments/ui |
| UI 插件安全 | 同源、manifest、uiContract、CSP、可卸载；P1 不做远程市场 |
| Provider 数据迁移 | manifest 声明；无迁移拒绝；备份/回滚 |
| 版本漂移 | 契约 semver + contract tests + capability catalog |
| 多 provider 冲突 | kernel 单 active + priority；冲突显式拒绝 |
| AI 成本/延迟 | 预算、并发、超时、取消、失败不阻塞人工 |
| 附件安全 | MIME/大小/扫描/认证下载/配额 |
| 单写进程 | 文档+启动检查；并行用独立 HOME |

### 14.1 需要确认

1. 首批要替换的基础设施优先级：auth、theme、shell、tasks，哪个先？
2. 其他终端具体是什么：移动端、CLI、第三方系统、DSH Desktop？
3. UI 插件 P1 是否就要允许第三方安装，还是 P1 只保证默认 pack 可替换、P2 再开放第三方？
4. 认证是否允许 OIDC/LDAP provider，还是先只做本地账号？
5. 附件存储是否 P1 就接对象存储，还是先本地文件？
6. 单实例后台，还是多实例控制面？
7. 是否接受“provider 默认 bundle + 高级用户自行替换”的交付方式？

## 15. 附录

### 15.1 能力/权限清单

| 权限 | 用途 |
|---|---|
| `admin.dashboard.read` | 仪表盘 |
| `admin.tasks.read/create/claim/decide/comment/assist` | 任务 |
| `admin.attachments.read/upload/delete` | 附件 |
| `admin.audit.read` | 审计 |
| `admin.users.manage` / `admin.roles.manage` | 用户/角色 |
| `admin.tokens.manage` | API Token |
| `admin.capabilities.read` | 能力目录 |
| `admin.settings.write` | 设置 |
| `admin.plugins.manage` | 当前 profile 插件 |
| `terminal.tasks.read/decide` | 终端 |

### 15.2 术语

| 术语 | 含义 |
|---|---|
| Capability | 稳定接口 + token + manifest + provider |
| Façade | kernel 提供的稳定代理对象 |
| Provider | 能力的可替换实现插件 |
| Contract | 消费方依赖的接口/版本/错误码 |
| UI kernel | 浏览器侧 UI 插件运行时 |
| Pack | theme/locale/icon 等可替换 UI 资源包 |
| Outbox | 决定后待执行的业务副作用队列 |
| Capability catalog | 能力、provider、版本、健康目录 |

### 15.3 参考

- [DSH Profile / app boot](../deepseek/deepseek-harness/packages/boot/app-boot/README.md)
- [Web Server 子系统](../deepseek/deepseek-harness/docs/subsystems/web-server.md)
- [Storage 子系统](../deepseek/deepseek-harness/docs/subsystems/storage.md)
- [Settings 子系统](../deepseek/deepseek-harness/docs/subsystems/settings.md)
- [登录门禁插件](../plugins/auth/README.cn.md)
- [CMS Bridge 插件](../plugins/cms-bridge/README.cn.md)
- [Notebook 插件](../plugins/notebook/README.cn.md)
