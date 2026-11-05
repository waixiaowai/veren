---
title: 业务组件
description: 13 个业务组件契约：端点依赖、字段映射、四态、提交中态与重复提交竞态处理。
sidebar:
  order: 28
  label: 业务组件
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 10.3 Business Components

业务组件是"组合 + 调用"的单元：由 [复合组件](./composite/) 与 [基础组件](./basic/) 组装界面，并经客户端域调用面发起请求。调用形态统一为 `authClient.<action>(payload, { onSuccess, onError })` 两参形式，路径与方法由客户端域属性链代理翻译（取证：`packages/better-auth/src/client/proxy.ts`）；错误文案经 `$ERROR_CODES` 映射（见 [客户端域](../modules/10-client/)）。全部端点挂认证基路径 `/api/auth` 之下，路径即本章的接口标识，端点全表见 [服务端接口](../api/)。

每个组件固定写六件事：调用的接口标识与字段映射、加载态、空态、失败态、无权限态、提交中与提交后行为（含重复提交与竞态处理）。竞态处理统一口径：**旧响应不覆盖新状态**——表单类组件提交按钮 loading 期间禁点，天然无竞态；列表类组件以请求序号守门，只有最新一次请求的结果可写入组件状态。

### 10.3.1 Component Inventory

| 组件 | 主端点 | 场景 |
|---|---|---|
| SignInForm | `POST /sign-in/email`、`POST /sign-in/social` | 登录 |
| SignUpForm | `POST /sign-up/email` | 注册 |
| ForgotPasswordForm | `POST /request-password-reset` | 忘记密码 |
| ResetPasswordForm | `POST /reset-password` | 重置密码 |
| ChangePasswordForm | `POST /change-password` | 已登录改密 |
| UpdateUserForm | `POST /update-user` | 资料维护 |
| EmailVerificationLanding | `GET /verify-email` | 邮箱校验落地 |
| TwoFactorChallenge | `POST /two-factor/verify-totp` 等 | 二次验证挑战 |
| SessionManager | `GET /list-sessions` 等 | 会话管理 |
| AccountManager | `GET /list-accounts`、`POST /unlink-account` | 账号绑定 |
| InvitationAccept | `GET /organization/get-invitation` 等 | 邀请接受 |
| DeviceApproval | `GET /device`、`POST /device/approve` | 设备授权批准 |
| OAuthConsent | `POST /oauth2/consent` | OAuth 同意 |

### 10.3.2 SignInForm

组成：`FormField`（邮箱）+ `FormField`（PasswordInput）+ "remember me" Checkbox + Button（提交）+ `OAuthButtonGroup` + 辅助链接（注册、忘记密码）。

| 接口 | 字段映射 |
|---|---|
| `POST /sign-in/email` | 表单 email → `email`；PasswordInput → `password`；Checkbox → `rememberMe`；页面 `callbackURL` 参数 → `callbackURL` |
| `POST /sign-in/social` | 按钮提供方 id → `provider`；页面 `callbackURL` → `callbackURL`，成功按服务端指示跳转外部提供方 |

状态：加载态为会话检查中的整卡 Skeleton（已登录用户可直接离开）；空态不适用（表单即本体）；失败态为表单顶部 `ErrorCallout`，码 `INVALID_EMAIL_OR_PASSWORD` 映射三要素文案（不泄露账号存在性）；无权限态不适用（匿名可进）。提交中：按钮 loading 并整表单禁点——**重复提交靠按钮禁用阻断**；提交后分支三条：成功带 `callbackURL` 跳转目标页、成功无参跳应用首页、服务端返回 `twoFactorRedirect: true` 时跳二次验证挑战页（取证：`packages/better-auth/src/plugins/two-factor/index.ts:665`）。社交按钮在邮箱表单飞行期间整组禁用，防止双通道并发签发。

```tsx
function SignInForm({ callbackURL }: { callbackURL?: string }) {
  const { data, isPending } = authClient.useSession();
  // 调用面职责：组装载荷并发起请求
  async function submit() {
    await authClient.signIn.email(
      { email, password, callbackURL },
      {
        onSuccess: (ctx) => {
          // 上下文含 twoFactorRedirect 时由页面层跳挑战页，这里只翻状态
          setStatus(ctx.data?.user ? "done" : "needs-two-factor");
        },
        onError: (ctx) => setError(ctx.error),
      },
    );
  }
  // 界面职责：FormField 与 OAuthButtonGroup 的组合，见复合组件章
}
```

### 10.3.3 SignUpForm

组成：`FormField`（姓名）+ `FormField`（邮箱）+ `FormField`（PasswordInput，配 `PasswordStrengthHint`）+ Button + 链接登录页。

| 接口 | 字段映射 |
|---|---|
| `POST /sign-up/email` | 表单 name → `name`；email → `email`；password → `password`；页面 `callbackURL` → `callbackURL` |

状态：加载态同登录；失败态按码分化——`USER_ALREADY_EXISTS` 或 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` 映射为"该邮箱已注册，请直接登录或换邮箱"，`PASSWORD_TOO_SHORT`、`PASSWORD_TOO_LONG` 由前端预校验先行拦截（最短 8、最长 128，与 [错误码](../errors/) 表一致），`VALIDATION_ERROR` 兜底；无权限态不适用。提交中按钮禁点；提交后分支两条：响应含会话 token（自动登录开启）跳引导页或 `callbackURL`；`token: null`（要求邮箱校验，取证：`packages/better-auth/src/api/routes/sign-up.ts:410-413`）进入"查收邮件"提示态，不视为失败。

```tsx
async function submit() {
  await authClient.signUp.email(
    { name, email, password, callbackURL },
    {
      onSuccess: (ctx) => setOutcome(ctx.data.token ? "signed-in" : "verify-email"),
      onError: (ctx) => setError(ctx.error),
    },
  );
}
```

### 10.3.4 ForgotPasswordForm

组成：`FormField`（邮箱）+ Button + 返回登录链接。

| 接口 | 字段映射 |
|---|---|
| `POST /request-password-reset` | 表单 email → `email`；重置页路由 → `redirectTo`（宿主注入） |

状态：加载态同前；空态不适用；失败态 `ErrorCallout`，码 `VALIDATION_ERROR` 兜底；无权限态不适用。提交中按钮禁点；提交后**等时成功**——无论邮箱是否存在，一律呈现"如果该邮箱已注册，重置邮件已发出"提示态（服务端等时失败语义，防止账号枚举，见 [错误码](../errors/#54-retry-semantics)）。重发按钮 60 秒倒计时防轰炸。

```tsx
await authClient.requestPasswordReset(
  { email, redirectTo },
  { onSuccess: () => setSent(true), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.5 ResetPasswordForm

组成：`FormField`（新 PasswordInput）+ `FormField`（确认 PasswordInput）+ `PasswordStrengthHint` + Button。

| 接口 | 字段映射 |
|---|---|
| `POST /reset-password` | 查询参数 `token` → `token`；新口令 → `newPassword` |

状态：**令牌预检失败即锁定表单**——`token` 缺失或服务端返回 `INVALID_TOKEN`、`TOKEN_EXPIRED` 时，表单禁用并呈现"链接已失效"与重新申请入口，这是本组件的空态等价物；失败态 `ErrorCallout` 覆盖核销期冲突；无权限态不适用（持令牌即授权）。提交中按钮禁点；提交后跳登录页——口令已变，旧凭据不再有效。令牌只从 URL 查询取一次，组件不回写、不缓存。

```tsx
await authClient.resetPassword(
  { newPassword, token },
  { onSuccess: () => navigate("/sign-in"), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.6 ChangePasswordForm

组成：`FormField`（当前 PasswordInput）+ `FormField`（新 PasswordInput）+ Checkbox（`revokeOtherSessions`，默认勾选）+ Button。

| 接口 | 字段映射 |
|---|---|
| `POST /change-password` | 当前口令 → `currentPassword`；新口令 → `newPassword`；Checkbox → `revokeOtherSessions` |

状态：加载态取会话；空态不适用；失败态按码分化——`INVALID_PASSWORD`（当前口令错）、`PASSWORD_TOO_SHORT`、`SESSION_EXPIRED`（会话过期则整页转登录）；**无权限态 = 未认证**，`useSession` 为空时整卡转登录提示。提交中按钮禁点；提交后呈现成功 Toast，勾选吊销其他会话时同步广播触发其他标签页会话失效（跨标签广播见 [客户端域](../modules/10-client/)），当前会话凭服务端下发的会话翻新保持登录。

```tsx
await authClient.changePassword(
  { currentPassword, newPassword, revokeOtherSessions },
  { onSuccess: () => toast({ tone: "success", message: "Password updated" }), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.7 UpdateUserForm

组成：`FormField`（姓名）+ 头像上传或 URL 输入 + Button。变更邮箱走独立流程（`POST /change-email`），不在本表单混装。

| 接口 | 字段映射 |
|---|---|
| `POST /update-user` | 表单 name → `name`；头像 → `image` |

状态：加载态以 `useSession` 数据预填；空态不适用；失败态 `FIELD_NOT_ALLOWED`（附加字段被拒）、`VALIDATION_ERROR` 兜底；无权限态同 10.3.6。提交中按钮禁点且仅对脏字段提交；提交后 Toast 成功并触达会话刷新（`/update-user` 命中广播监听，其他标签页同步更新，取证：`packages/better-auth/src/client/config.ts` 原子监听器）。

```tsx
await authClient.updateUser(
  { name },
  { onSuccess: () => toast({ tone: "success", message: "Profile updated" }), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.8 EmailVerificationLanding

组成：自动处理区（Spinner + 状态文案）+ 结果 Alert + 失败时的重发 Button。页面挂载即核销，不设表单。

| 接口 | 字段映射 |
|---|---|
| `GET /verify-email` | 查询 `token` 原样透传 → `token`；查询 `callbackURL` → `callbackURL` |

状态：加载态即核销进行中；空态 = `token` 缺失，呈现"链接不完整"并给出重发入口；失败态按码分化——`TOKEN_EXPIRED`、`INVALID_TOKEN` 转"链接已失效"，`EMAIL_ALREADY_VERIFIED` 转"邮箱已验证"的成功语义（不算错误）；无权限态不适用（令牌即授权）。**提交中与竞态**：核销只发一次，`StrictMode` 双挂载等重复触发由请求序号守门，旧响应不覆盖；服务端原子消费保证令牌只被一方核销成功（见 [状态模型](../states/#62-verification-lifecycle)）。提交后：成功带 `callbackURL` 跳转，无参则呈现成功态留在本页；失败带 `error` 参数回跳时由页面层呈现，组件不静默吞掉。

```tsx
useEffect(() => {
  if (!token || consumedRef.current) return;
  consumedRef.current = true;
  void authClient.verifyEmail(
    { query: { token, callbackURL } },
    {
      onSuccess: () => setStatus("verified"),
      onError: (ctx) => setFailure(ctx.error),
    },
  );
}, [token]);
```

### 10.3.9 TwoFactorChallenge

组成：`Tabs`（TOTP、OTP、备份码三分支）+ 各分支 `CodeInput` 或单格长输入 + Button + "trust device" Checkbox + 返回登录链接。

| 接口 | 字段映射 |
|---|---|
| `POST /two-factor/verify-totp` | TOTP 分支 6 或 8 位码 → `code`；Checkbox → `trustDevice` |
| `POST /two-factor/verify-otp` | OTP 分支码 → `code`；OTP 需先经 `POST /two-factor/send-otp` 发码 |
| `POST /two-factor/verify-backup-code` | 备份码分支 `XXXXX-XXXXX` 格式 → `code` |

状态：加载态不适用（进入即待输入）；空态不适用；失败态按码分化——`INVALID_CODE`（TOTP/OTP 码错，剩余尝试次数随文案递减提示）、`INVALID_BACKUP_CODE`、`OTP_HAS_EXPIRED`（提示重发）、`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`、`ACCOUNT_TEMPORARILY_LOCKED`（锁定倒计时，表单整体禁用，属本组件的禁用空态）、`INVALID_TWO_FACTOR_COOKIE`（第一因子态已失效，转回登录页——这是本组件的无权限等价物）。**提交中与竞态**：码填满自动提交一次，按钮随即 loading 禁点；失败清空码并回焦第一格；分支切换时在飞请求被序号守门丢弃，切回分支不误报前一分支的结果。提交后：完整会话建立，跳 `callbackURL` 或首页；勾选信任设备后该设备在 `trustDeviceMaxAge`（默认 30 天）内免二次挑战（取证：`packages/better-auth/src/plugins/two-factor/constant.ts`）。

```tsx
const submitByMethod = {
  totp: (code: string) => authClient.twoFactor.verifyTotp({ code }, handlers),
  otp: (code: string) => authClient.twoFactor.verifyOtp({ code }, handlers),
  backup: (code: string) => authClient.twoFactor.verifyBackupCode({ code }, handlers),
};
```

### 10.3.10 SessionManager

组成：`SessionListItem` 列表 + 列表头动作（`Revoke others`、`Revoke all`）+ 每行吊销经 Dialog 确认。

| 接口 | 字段映射 |
|---|---|
| `GET /list-sessions` | 无参，返回自身会话集 |
| `POST /revoke-session` | 行数据 → `token`（或 `id`） |
| `POST /revoke-other-sessions` | 无体；强制 POST 路径（取证：`packages/better-auth/src/client/config.ts` 强制表） |
| `POST /revoke-sessions` | 无体，吊销全部 |

状态：加载态 Skeleton 行；空态"当前没有其他活动会话"（全部被吊销后）；失败态 `ErrorCallout` + 重试（`FAILED_TO_GET_SESSION` 可重试类）；无权限态 = 未认证转登录（越权查询服务端按 `UNAUTHORIZED` 拒绝，见 [数据字典](../data/)）。**提交中与竞态**：行内吊销按 token 定点置 loading，其余行仍可操作；列表刷新走请求序号守门——快速连吊两行时旧列表响应不覆盖新列表；吊销当前会话的场景（列表不含当前会话的吊销按钮）由 `isCurrent` 标记规避。提交后：被吊销行收起移除，其余行不动；其他标签页经广播触发会话重取。

```tsx
const { data, error, isPending, refetch } = useSessionsList();
// useSessionsList: 基于 useAuthQuery 的 GET /list-sessions 原子，序号守门见客户端域
async function revoke(token: string) {
  await authClient.revokeSession({ token }, { onSuccess: () => refetch() });
}
```

### 10.3.11 AccountManager

组成：`AccountListItem` 列表 + "Add sign-in method" 动作区（发起绑定走社交登录流）+ 解绑 Dialog 确认。

| 接口 | 字段映射 |
|---|---|
| `GET /list-accounts` | 无参，返回自身绑定集 |
| `POST /unlink-account` | 行数据 → `providerId` 与 `accountId` |

状态：加载态 Skeleton；空态"尚未绑定任何第三方账号"并给绑定入口；失败态 `ErrorCallout`——`FAILED_TO_UNLINK_LAST_ACCOUNT`（最后一条，前端已用 `isLast` 禁用，此码为并发兜底）、`ACCOUNT_NOT_FOUND`；无权限态 = 未认证转登录（越权按 `ACCOUNT_NOT_FOUND` 拒绝）。**提交中与竞态**：解绑按 `(providerId, accountId)` 定点置 loading；列表响应序号守门；确认弹窗打开期间数据变化时以弹窗内快照为准，提交前不重读列表。提交后行移除；最后一条的禁用态随列表长度重算。

```tsx
await authClient.unlinkAccount(
  { providerId, accountId },
  { onSuccess: () => refetch(), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.12 InvitationAccept

组成：邀请信息 Card（组织名、邀请人、角色）+ Button（`Accept invitation`）+ Button（`Reject`，outline）。

| 接口 | 字段映射 |
|---|---|
| `GET /organization/get-invitation` | 页面查询邀请标识 → `id`，用于预览详情 |
| `POST /organization/accept-invitation` | 邀请标识 → `invitationId` |
| `POST /organization/reject-invitation` | 邀请标识 → `invitationId` |

状态：加载态详情 Skeleton；空态与失效合并——`INVITATION_NOT_FOUND`（含过期清理后的缺失）呈现"邀请不存在或已过期"；已处理态呈现终态文案（`accepted`、`rejected`、`canceled` 各自措辞，状态名见 [状态模型](../states/#63-invitation-lifecycle)）；失败态接受时组织侧满员或角色类错误按服务端码透传；**无权限态 = 邮箱不匹配**——当前登录主体邮箱与被邀邮箱不一致时，详情可见但两个动作禁用并说明原因。**提交中与竞态**：接受走服务端两段式（原子认领后建成员行），前端接受按钮 loading 禁点且拒绝按钮同禁；"已处理"重复提交（双击、双页签）由服务端原子认领保证只有一方成功，后者收到已处理拒绝，前端呈现终态而非错误。提交后：接受成功跳组织页，拒绝成功留在本页呈现已拒绝。

```tsx
await authClient.organization.acceptInvitation(
  { invitationId },
  { onSuccess: (ctx) => navigateToOrganization(ctx.data.member), onError: (ctx) => setError(ctx.error) },
);
```

### 10.3.13 DeviceApproval

组成：用户码展示区（等宽族大字分段）+ 请求方信息 Card（`client_id`、请求范围）+ Button（`Approve`）+ Button（`Deny`，outline）。

| 接口 | 字段映射 |
|---|---|
| `GET /device` | 页面查询 `user_code` → `user_code`，轮询或一次查询取状态与请求方信息 |
| `POST /device/approve` | 用户码 → `userCode` |
| `POST /device/deny` | 用户码 → `userCode` |

状态：加载态查询进行中；空态 = `user_code` 缺失或格式非法，呈现"请核对设备上显示的地址"；终态四分支——`expired_token`（码过期，提示设备侧重走流程）、`device_code_already_processed`（已处理过）、`access_denied`（已拒绝）、`approved`（已批准），四者都是终态呈现而非错误；失败态 `ErrorCallout` 覆盖网络类；**无权限态 = 未认证**，设备批准必须已登录，未认证先转登录并回跳本页（`user_code` 保留在回跳参数里）。**提交中与竞态**：批准与拒绝互斥置 loading；设备端轮询与页面操作并发由服务端原子消费裁决，页面收到已处理后立即转终态不重试。提交后：留在本页呈现终态（设备侧凭轮询拿到结果继续），不跳离。

```tsx
const status = useDeviceStatus(userCode); // GET /device?user_code=... 的查询原子
await authClient.deviceApprove(
  { userCode },
  { onSuccess: () => setStatusView("approved"), onError: (ctx) => setFailure(ctx.error) },
);
```

### 10.3.14 OAuthConsent

组成：请求方 Card（应用名、`client_id`）+ 范围清单（逐项可勾选，部分范围可收缩）+ 账号确认区（当前会话主体）+ Button（`Authorize`）+ Button（`Deny`，outline）。

| 接口 | 字段映射 |
|---|---|
| `POST /oauth2/consent` | 同意与否 → `accept`（boolean）；收缩后的范围 → `scope`（空格分隔，缺省接受全部请求范围）；原始授权查询串 → `oauth_query`（页面从进入 URL 透传） |

状态：加载态解析授权请求中；空态 = 授权请求已失效（`oauth_query` 缺失或已消费），呈现"请求已过期，请回到发起方重试"；失败态 `ErrorCallout`；无权限态 = 未认证转登录（授权请求查询参数随回跳保留，登录后原样回到本页）。**提交中与竞态**：同意与拒绝互斥置 loading；响应固定为 `{ redirect: true, url }`（取证：`packages/oauth-provider/src/oauth.ts:796-850`），前端只按 `url` 跳转，不自行拼装回跳——重复提交由服务端授权事务一次性裁决。提交后：整页跳转服务端给定的地址，本页不留状态。

```tsx
await authClient.oauth2.consent(
  { accept: true, scope: selectedScopes.join(" "), oauth_query: entryQuery },
  { onSuccess: (ctx) => { window.location.assign(ctx.data.url); }, onError: (ctx) => setError(ctx.error) },
);
```
