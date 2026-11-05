---
title: 产品原型
description: 框架内建产品端清单与消费方需自建页面的目录、页面流转与原型边界。
sidebar:
  order: 24
  label: 产品原型
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 8. Product Surfaces

本章回答"界面上有什么"。本方案所述系统是一个认证框架而非应用：它**不携带任何业务界面**，唯一的内建产品面是两个服务端直出的 HTML 页面——端点错误页与接口参考页（取证：`packages/better-auth/src/api/routes/error.ts`、`packages/better-auth/src/plugins/open-api/index.ts`）。登录、注册、二次验证、组织管理等一切面向终端用户的页面，全部由宿主应用基于客户端域调用面自建。本章先盘点全部产品面，再逐页定义内建面与消费方面，最后给出页面流转与原型边界。视觉与组件契约见 [UI 规范](./ui/) 与组件章。

### 8.1 Surface Inventory

框架产品端只有两个内建面，均挂在认证基路径 `/api/auth` 之下：

| 页面 | 路由 | 服务人群 | 入口 | 权限边界 |
|---|---|---|---|---|
| 端点错误页 | `GET /api/auth/error?error=&error_description=` | `anonymous`、`user`、宿主开发者 | 服务端在认证流程失败时经回调地址或默认跳转进入 | 无需会话；任何人可访问；只读，不承载任何写操作 |
| 接口参考页 | `GET /api/auth/reference`（路径可配） | `integration`、宿主开发者、`admin` | 开发者在浏览器直接输入地址 | 无需会话；仅暴露端点契约元数据，不含业务数据 |

消费方面是宿主应用需要自建的 15 类页面。它们不是本框架的交付物，而是框架的**服务对象**——框架为每一类页面提供端点与错误码，界面本身归宿主：

| 序号 | 页面 | 服务人群 | 入口 | 权限边界 |
|---|---|---|---|---|
| 1 | 登录 | `anonymous` | 直接访问或受保护页重定向（带 `callbackURL`） | 匿名可用；已登录者可跳过或重登 |
| 2 | 注册 | `anonymous` | 登录页引流或直接访问 | 匿名可用；注册即建档，归属身份域 |
| 3 | 忘记密码 | `anonymous` | 登录页引流 | 匿名可用；等时响应，不泄露账号存在性 |
| 4 | 重置密码 | `anonymous` | 邮件链接携带 `token` 进入 | 匿名可用；令牌一次性，核销后失效 |
| 5 | 邮箱校验落地 | `user`（多为刚注册） | 校验邮件链接携带 `token` 进入 | 令牌归属单一主体；无令牌不可核销 |
| 6 | 二次验证挑战 | 已通过第一因子校验的 `user` | 登录后服务端返回 `twoFactorRedirect: true` 时进入 | 受二次验证 Cookie 约束，默认 10 分钟内有效 |
| 7 | 二次验证设置 | `user` | 账号设置区入口 | 需有效会话；敏感操作建议要求新鲜会话 |
| 8 | 会话管理 | `user` | 账号设置区入口 | 只见自身会话；越权查询按 `UNAUTHORIZED` 拒绝 |
| 9 | 账号绑定 | `user` | 账号设置区入口 | 只操作自身绑定；最后一条绑定不可解绑 |
| 10 | 组织管理 | `member`、`admin` | 应用内组织切换或设置区 | 按组织作用域隔离；非成员按组织侧错误码拒绝 |
| 11 | 邀请接受 | 被邀 `user` | 邀请邮件或站内通知携带邀请标识 | 仅被邀邮箱匹配者可接受；`pending` 状态才可响应 |
| 12 | 管理端用户管理 | `admin` | 管理后台入口 | 需管理角色；操作面覆盖封禁、改角色、吊销会话 |
| 13 | 设备授权批准 | 已登录 `user` | 设备上显示引导地址携带 `user_code` 进入 | 需有效会话；批准/拒绝写入 `DeviceCode` 状态 |
| 14 | OAuth 同意 | 已登录 `user` | `oauth2` 扩展的授权请求重定向进入 | 需有效会话；仅 `oauth-provider` 扩展场景存在 |
| 15 | 错误展示 | 全部主体 | 各页失败分支、错误页跳转目标 | 无权限要求；按错误码呈现可恢复动作 |

两类面的关系是**承接**关系：内建错误页是消费方尚未自建错误展示时的兜底（生产环境未定制时甚至直接 302 到 `/?error=...` 交给宿主首页）；消费方页面失败时把错误码透传到错误展示区，文案映射用客户端域聚合的 `$ERROR_CODES`（取证：`packages/better-auth/src/client/vanilla.ts`）。

### 8.2 Built-in Surfaces

两个内建面逐页说明。

#### 8.2.1 Error Page

| 项 | 值 |
|---|---|
| 路由 | `GET /api/auth/error`，查询参数 `error`（错误码）与 `error_description`（描述，选填） |
| 功能边界 | 展示一次认证失败的码与描述，提供返回首页与查阅错误文档两个出口；不承载任何认证操作，不写任何状态 |
| 可用角色 | `anonymous` 与一切已认证主体，无需会话 |
| 响应分支 | 三选一：宿主配置了 `onAPIError.errorURL` → 302 重定向到该地址并附带错误参数；生产环境且未定制默认错误页 → 302 到 `/?error=...`；其余 → 渲染内建 HTML 页 |
| 页面结构 | `ERROR` 徽标（`--destructive` 色边框）、"Something went wrong" 标题、`CODE:` 芯片（等宽字体展示码）、描述段落、`Go Home` 与 `Ask AI` 两个按钮 |
| 输入净化 | 码经白名单正则 `^[\'A-Za-z0-9_-]+$` 校验，不合法一律回退为 `UNKNOWN`；描述经 HTML 转义后输出；文档链接对码做 `encodeURIComponent` |
| 缺省文案 | 无 `error_description` 时展示固定英文文案并链接到官方错误参考文档对应码页面 |
| 主题行为 | 深浅色跟随系统 `prefers-color-scheme`；可通过 `customizeDefaultErrorPage` 覆盖颜色、字号、字体、圆角，或关闭标题边框、四角装饰与背景网格 |
| 状态 | 只有两态：渲染 HTML，或 302 重定向。没有加载态、空态与权限态 |

设计边界：该页是**兜底**而非产品。多语言消费方应配置 `errorURL` 指向自建错误页（承接同样的 `error` / `error_description` 参数），而不是定制本页——本页文案为硬编码英文且无语言协商（取证：页面 `lang="en"`）。

#### 8.2.2 API Reference Page

| 项 | 值 |
|---|---|
| 路由 | `GET /api/auth/reference`（`open-api` 扩展默认路径，`path` 选项可改） |
| 功能边界 | 渲染运行时端点契约的接口参考：路径、方法、参数模式、响应模式；由 Scalar 控件加载渲染 |
| 可用角色 | 无权限门槛；目标人群是 `integration` 与宿主开发者，生产环境建议经网关关闭或加防护 |
| 数据来源 | 同扩展提供的 `GET /api/auth/open-api/generate-schema`，页面脚本内嵌该模式后交由 CDN 上的 Scalar 渲染 |
| 配置项 | `path` 改参考页路径；`theme` 选 12 个 Scalar 主题（默认 `default`）；`nonce` 为内联脚本附加 CSP 随机数；`disableDefaultReference` 关闭页面只留模式端点 |
| 外部依赖 | 控件脚本从 jsDelivr CDN 加载——离线或 CDN 不可达时页面无法渲染，这是该面的已知可用性边界 |
| 状态 | 单态：加载并渲染；无业务四态 |

设计边界：参考页属于参考域的产物，服务开发调试而非终端用户；它不是管理端，不提供任何写操作。机器可读的模式走 `generate-schema` 端点，页面只是模式的人读投影。

### 8.3 Consumer Surface Catalog

消费方需自建页面逐页定义。路由建议以宿主 SPA 常见结构为参照，宿主可自行调整；"接口"列给出页面依赖的核心端点（均挂认证基路径 `/api/auth` 之下，全部端点契约见 [服务端接口](./api/)）。

| 页面标识 | 路由建议 | 边界一句话 | 可用角色 | 主要操作 | 关键区域 | 状态 |
|---|---|---|---|---|---|---|
| `SignInPage` | `/sign-in` | 凭第一因子换会话，不做注册与找回 | `anonymous` | 邮箱口令登录、社交登录、跳注册与忘记密码 | 凭据表单、社交按钮组、二次验证跳转、错误区 | 加载、失败（`INVALID_EMAIL_OR_PASSWORD`）、二次验证待挑战、成功跳转 |
| `SignUpPage` | `/sign-up` | 建档并按配置决定是否自动登录 | `anonymous` | 邮箱口令注册、社交注册、跳登录 | 姓名邮箱口令表单、强度提示、错误区 | 加载、失败（`USER_ALREADY_EXISTS`）、待邮箱校验、成功跳转 |
| `ForgotPasswordPage` | `/forgot-password` | 触发重置邮件，不确认账号存在 | `anonymous` | 提交邮箱、重发 | 单字段表单、提交后提示区 | 加载、提交中、等时成功提示、失败 |
| `ResetPasswordPage` | `/reset-password` | 用一次性令牌设置新口令 | `anonymous`（持令牌） | 提交新口令 | 新口令与确认字段、强度提示、令牌失效提示 | 令牌缺失/失效（`INVALID_TOKEN`）、提交中、成功跳登录 |
| `VerifyEmailPage` | `/verify-email` | 核销校验令牌并落地结果 | 持令牌者 | 自动核销、失败后重发 | 自动处理区、结果提示、重发按钮 | 核销中、成功、失败（`TOKEN_EXPIRED`、`INVALID_TOKEN`）、已验证（`EMAIL_ALREADY_VERIFIED`） |
| `TwoFactorChallengePage` | `/two-factor` | 第二因子校验，不替代登录 | 已过第一因子者 | TOTP、OTP、备份码三选一提交，信任设备勾选 | 因子切换 Tab、码输入、备份码入口、信任设备勾选 | 加载、失败（`INVALID_CODE`、`INVALID_BACKUP_CODE`）、锁定（`ACCOUNT_TEMPORARILY_LOCKED`）、Cookie 失效（`INVALID_TWO_FACTOR_COOKIE`） |
| `TwoFactorSettingsPage` | `/settings/two-factor` | 开启、关闭与管理第二因子 | `user` | 启用 TOTP、发送 OTP、生成备份码、禁用 | QR 与 URI 展示、备份码列表、禁用确认 | 加载、未开启空态、已开启详情、禁用确认弹窗、失败 |
| `SessionsPage` | `/settings/sessions` | 列出并吊销自身会话 | `user` | 列出、吊销单条、吊销其他、吊销全部 | 会话列表（设备、时间、当前标记）、吊销按钮 | 加载、空态、吊销确认、吊销后局部刷新、失败 |
| `AccountsPage` | `/settings/accounts` | 管理自身账号绑定 | `user` | 列出绑定、解绑、发起绑定 | 绑定列表（提供方、账号标识）、解绑按钮 | 加载、空态、解绑确认（最后一条禁用）、失败（`FAILED_TO_UNLINK_LAST_ACCOUNT`） |
| `OrganizationPage` | `/organizations/:slug` | 组织与成员的日常管理 | `member`、`admin` | 建组织、看成员、邀成员、改角色 | 组织列表、成员表、邀请入口、角色列 | 加载、无组织空态、非成员拒绝（组织侧错误码）、失败 |
| `InvitationAcceptPage` | `/invitations/:invitationId` | 响应一条组织邀请 | 被邀 `user` | 接受、拒绝 | 邀请详情（组织、邀请人、角色）、接受与拒绝按钮 | 加载、已处理（终态拒绝）、过期（`INVITATION_NOT_FOUND`）、接受中、成功入组织 |
| `AdminUsersPage` | `/admin/users` | 管理全部主体 | `admin` | 检索、封禁、解禁、改角色、吊销会话、冒充 | 用户表、详情抽屉、封禁表单、危险操作确认 | 加载、空态、无权限拒绝、批量操作部分失败、失败 |
| `DeviceApprovalPage` | `/device` | 批准或拒绝设备授权请求 | `user` | 查码、批准、拒绝 | 用户码展示、请求方信息、批准与拒绝按钮 | 码缺失、码过期（`expired_token`）、已处理（`device_code_already_processed`）、待确认、已批准、已拒绝 |
| `OAuthConsentPage` | `/oauth-consent` | 第三方应用请求授权的确认 | `user` | 同意全部或部分范围、拒绝 | 应用信息、范围清单、账号选择、同意与拒绝按钮 | 加载、请求失效、范围展示、提交中、提交后重定向 |
| `ErrorFallbackPage` | `/error`（宿主自定） | 统一承接错误码并给出出路 | 全部主体 | 返回首页、重试、查阅错误文档 | 码芯片、描述、动作按钮 | 单态呈现，按码映射文案与动作 |

上表 15 页覆盖任务清单的 13 类页面并追加两项：二次验证的"挑战"与"设置"拆为两页（挑战页服务登录中态、设置页服务已登录态，权限边界与状态完全不同）；错误展示单列一页承接内建错误页的跳转。

### 8.4 Page Flow

页面流转覆盖"入口 → 详情 → 提交后跳转 → 无权限路径"四段。`callbackURL` 是本框架贯穿全部流程的回跳参数：受信校验由守卫域完成（`INVALID_CALLBACK_URL` 系列拒绝不受信跳转），页面只需透传。

| 来源 | 触发动作 | 目标 | 返回行为 |
|---|---|---|---|
| 受保护页（未认证） | 访问被宿主路由守卫拦截 | `SignInPage`，携带 `callbackURL` 指回原页 | 浏览器返回回到受保护页时仍被拦截，重新进入登录页 |
| `SignInPage` | 邮箱口令提交成功且无需二次验证 | `callbackURL` 或应用首页 | 返回键回到登录页，表单已清空，重复提交被拒绝 |
| `SignInPage` | 服务端返回 `twoFactorRedirect: true` | `TwoFactorChallengePage` | 返回回登录页；二次验证 Cookie 过期后挑战页作废 |
| `TwoFactorChallengePage` | 任一因子校验通过 | `callbackURL` 或应用首页 | 已建立完整会话，返回键留在目标页 |
| `SignInPage` | 社交登录按钮 | 外部提供方授权页，成功后回跳宿主回调地址 | 回跳目标由提供方回调参数决定，失败回登录页并带 `error` 参数 |
| `SignUpPage` | 注册成功且允许自动登录 | `callbackURL` 或引导页 | 返回键不再回到注册表单 |
| `SignUpPage` | 注册成功但要求邮箱校验 | `VerifyEmailPage` 提示态或"查收邮件"提示 | 无令牌不核销；重发按钮可用 |
| `ForgotPasswordPage` | 提交邮箱 | 本页提示态（等时成功文案） | 不跳转，防止以跳转差异泄露账号存在性 |
| 邮件重置链接 | 打开携带 `token` 的链接 | `ResetPasswordPage` | 令牌已核销后再返回该链接，页面呈现失效态 |
| `ResetPasswordPage` | 新口令提交成功 | `SignInPage` | 旧口令与会话按配置连带吊销，旧会话页面失效 |
| 校验邮件链接 | 打开携带 `token` 与 `callbackURL` 的链接 | 服务端核销后按 `callbackURL` 跳转；失败带 `error` 参数跳同址 | 返回键重放已核销链接，落地页呈现"已处理" |
| `SessionsPage` | 吊销当前会话之外的其他会话 | 本页局部刷新 | 返回键回本页，列表为吊销后状态 |
| `AccountsPage` | 解绑非最后一条绑定 | 本页局部刷新 | 最后一条绑定的解绑按钮禁用，无跳转 |
| `OrganizationPage` | 建组织成功 | 新组织详情 | 返回键回组织列表 |
| 邀请邮件链接 | 打开携带邀请标识的链接 | `InvitationAcceptPage` | 终态邀请再次进入呈现"已处理"，不再可响应 |
| `InvitationAcceptPage` | 接受成功 | 对应组织页 | 拒绝成功留在本页并呈现已拒绝 |
| 管理后台入口 | 非 `admin` 角色访问 | `ErrorFallbackPage` 或 403 提示，不重定向到登录 | 已认证但无权与未认证是两条路径，不得混用 |
| 设备引导地址 | 用户在浏览器打开携带 `user_code` 的地址 | `DeviceApprovalPage` | 码过期或已处理后再次进入呈现对应终态 |
| `DeviceApprovalPage` | 批准成功 | 本页成功态（设备侧轮询拿码继续） | 拒绝同理，均不跳离 |
| `oauth2` 扩展授权请求 | 未处理过同意的授权请求重定向 | `OAuthConsentPage`，携带原始授权查询 | 拒绝与同意都以重定向收尾，页面不留状态 |
| `OAuthConsentPage` | 同意或拒绝提交 | 服务端返回的重定向地址 | 返回键重进会重新走授权请求，不缓存同意结果 |
| 任一页面 | 认证端点失败且宿主配置了 `errorURL` | `ErrorFallbackPage`，携带 `error` 与 `error_description` | 未配置时生产环境落到 `/?error=...`，开发环境落内建错误页 |

流转铁律两条：一是**回跳必须受信**——所有跳转目标经守卫域校验，非法目标拒绝而不是静默改写；二是**令牌只走一次**——重置、校验、邀请、设备码都是一次性凭据，落地页对重放一律呈现"已处理"而非重复执行。

### 8.5 Prototype Boundary

原型与真实能力的界限，三条：

1. **框架不提供原型。** 本框架交付的是端点、错误码与两个内建兜底页；本章与组件章定义的是消费方页面的**契约**（路由、状态、参数、端点依赖），不是可运行的产品。宿主拿到的是"必须长什么样才能接得上框架"的约束清单，而不是界面本身。
2. **消费方原型不得接真实鉴权。** 原型阶段的所有表单提交、会话读取与错误呈现都应走模拟数据：错误码必须使用 [错误码](./errors/) 中的真实码名（经 `$ERROR_CODES` 同名映射），保证原型到实现的文案与状态零漂移；但原型不得调用真实端点、不得在真实存储上建档，避免原型数据污染主体与会话的权威源。
3. **原型不替代内建页的定制测试。** `customizeDefaultErrorPage` 与参考页主题的视觉效果属于真实服务端行为，原型无法呈现；对这两个内建面的改动验收必须起真实服务端逐项核对令牌覆盖与分支跳转（三个响应分支、深浅色、净化规则），原型结论不算数。
