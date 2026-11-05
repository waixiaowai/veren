---
title: 页面组件
description: 13 个页面的薄封装契约：路由参数、查询参数契约、四态呈现与转场规则。
sidebar:
  order: 29
  label: 页面组件
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 10.4 Page Components

页面组件是**薄封装**：路由层加业务组件，页面自身只负责三件事——解析路由与查询参数并交给业务组件、把四态（加载、空、失败、无权限）落到页面条目、定义转场规则。界面组合与端点调用全部下沉到 [业务组件](./business/)，视觉规则见 [UI 规范](../ui/)，页面清单与流转见 [产品原型](../product/)。

### 10.4.1 Page Inventory and Common Rules

| 页面 | 路由建议 | 承载的业务组件 |
|---|---|---|
| `SignInPage` | `/sign-in` | SignInForm |
| `SignUpPage` | `/sign-up` | SignUpForm |
| `ForgotPasswordPage` | `/forgot-password` | ForgotPasswordForm |
| `ResetPasswordPage` | `/reset-password` | ResetPasswordForm |
| `VerifyEmailPage` | `/verify-email` | EmailVerificationLanding |
| `TwoFactorPage` | `/two-factor` | TwoFactorChallenge |
| `SessionsPage` | `/settings/sessions` | SessionManager |
| `AccountsPage` | `/settings/accounts` | AccountManager |
| `OrganizationPage` | `/organizations/:slug` | OrganizationPage 内的组织详情 |
| `InvitationPage` | `/invitations/:invitationId` | InvitationAccept |
| `AdminUsersPage` | `/admin/users` | 管理端用户表 |
| `DeviceApprovalPage` | `/device` | DeviceApproval |
| `ErrorFallbackPage` | `/error` | 错误展示块 |

三条全页公共契约，各页条目只写差异：

1. **URL 是输入不是输出**。页面只读路由与查询参数，任何用户交互（输入、勾选、Tab 切换、展开）都不回写 URL；只有"提交后跳转"这类转场由代码导航产生新 URL。这保证刷新与分享链接的语义稳定。
2. **敏感令牌只来自查询且用后即换**。`token` 类参数（重置、校验、设备码）只从 URL 查询读取一次，交给服务端核销后即失效；页面不缓存、不存储、不回显完整令牌，刷新已核销的链接一律得到"已处理"终态而非重复执行。
3. **转场三规则**。刷新可重放——页面刷新后按同一 URL 重新解析参数并重走加载态，不允许依赖内存态才能渲染；幂等——重复进入、重复刷新不产生副作用累积，写操作由服务端原子语义兜底；视觉恢复优先——刷新或返回时先呈现上次的稳定视图（列表页保留骨架位），再被最新数据替换，不做整页白屏重建。

四态在每页的落法：加载态用 Skeleton 或 Spinner 占位；空态给出下一步动作；失败态用 `ErrorCallout` 呈现码与文案，可重试类带重试按钮；无权限态按两条路径分化——未认证转登录并携带回跳参数，已认证但越权呈现 403 语义不重定向。部分失败降级只在列表与批量操作页出现：单行失败不拖垮整页，失败行就地标注。

### 10.4.2 SignInPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `callbackURL` | string | 应用首页 | 不在受信表时服务端拒绝并回 `INVALID_CALLBACK_URL`，页面按失败态呈现 | 登录成功后的回跳地址，经守卫域校验 |
| `error` | string | 无 | 白名单外按 `UNKNOWN` 展示 | 社交回调失败或错误页 302 承接而来 |
| `error_description` | string | 无 | 原样展示（页面渲染层转义） | 与 `error` 配对的描述 |

四态：加载 = 会话检查（已登录直接按 `callbackURL` 放行离开）；空态不适用；失败 = 表单错误或承接的 `error` 参数；无权限不适用（匿名可进）。转场：提交成功跳 `callbackURL` 或首页；刷新重放会话检查，无副作用；视觉恢复 = 表单清空重建（凭据不残留）。

```tsx
function SignInPage() {
  const { callbackURL, error } = readSearchParams();
  const { data, isPending } = authClient.useSession();
  if (isPending) return <Card><Skeleton variant="row" count={3} /></Card>;
  if (data) return <Redirect to={callbackURL ?? "/"} />;
  return <SignInForm callbackURL={callbackURL} initialError={error} />;
}
```

### 10.4.3 SignUpPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `callbackURL` | string | 注册后引导页 | 同 `SignInPage` 规则 | 注册成功回跳 |

四态：加载 = 会话检查（已登录提示"已登录，如需新账号请先登出"，不自动登出——防误伤现有会话）；空态不适用；失败 = 表单错误（`USER_ALREADY_EXISTS` 系给出跳登录入口）；无权限不适用。转场：注册成功自动登录时跳 `callbackURL`；要求邮箱校验时转"查收邮件"提示态（同 URL，交互不回写）；刷新重放为空表单。

```tsx
function SignUpPage() {
  const { callbackURL } = readSearchParams();
  const { data, isPending } = authClient.useSession();
  if (isPending) return <Card><Skeleton variant="row" count={4} /></Card>;
  if (data) return <AlreadySignedInNotice />;
  return <SignUpForm callbackURL={callbackURL} />;
}
```

### 10.4.4 ForgotPasswordPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| 无 | — | — | — | 本页不消费查询参数；`redirectTo` 由宿主配置注入，不暴露在 URL |

四态：加载态瞬时（纯表单）；空态不适用；失败 = `VALIDATION_ERROR` 兜底；无权限不适用。转场：提交后原地转提示态（等时成功），不跳转不泄露账号存在性；刷新回到空表单——提交结果不持久，重发按钮重新可用。

```tsx
function ForgotPasswordPage() {
  return <ForgotPasswordForm redirectTo="/reset-password" />;
}
```

### 10.4.5 ResetPasswordPage

Props：无路由参数（令牌在查询）。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `token` | string | 无 | 缺失或空白 → 表单锁定并呈现"链接不完整" | 一次性重置令牌，来自邮件链接 |
| `error` | string | 无 | 白名单外按 `UNKNOWN` | 邮件链接回跳携带的失败码，如 `INVALID_TOKEN` |

四态：加载态瞬时；**空态 = 令牌缺失或已失效**（表单禁用，给重新申请入口）——这是本页最常见态；失败 = 提交期核销冲突码呈现；无权限不适用。转场：提交成功跳登录页；刷新已核销令牌 → 服务端 `INVALID_TOKEN` → 落空态（幂等，不会二次改密）；令牌用后即换，页面不回显。

```tsx
function ResetPasswordPage() {
  const { token, error } = readSearchParams();
  if (!token || error === "INVALID_TOKEN") return <ResetLinkInvalidNotice />;
  return <ResetPasswordForm token={token} />;
}
```

### 10.4.6 VerifyEmailPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `token` | string | 无 | 缺失或空白 → 空态"链接不完整"并给重发入口 | 一次性校验令牌，挂载即核销 |
| `callbackURL` | string | 本页成功态 | 不受信时服务端不跳转，页面呈现结果态 | 核销成功后的回跳 |
| `error` | string | 无 | 白名单外按 `UNKNOWN` | 服务端核销失败回跳携带，如 `TOKEN_EXPIRED` |

四态：加载 = 核销进行中（Spinner 与状态文案）；空 = 令牌缺失；失败 = `TOKEN_EXPIRED`、`INVALID_TOKEN` 分文案；无权限不适用（令牌即授权）；`EMAIL_ALREADY_VERIFIED` 按成功语义呈现。转场：成功带 `callbackURL` 跳转；刷新重放已核销链接呈现"已处理"（服务端原子消费保证幂等，见 [状态模型](../states/#62-verification-lifecycle)）；令牌不回显不缓存。

```tsx
function VerifyEmailPage() {
  const { token, callbackURL, error } = readSearchParams();
  if (!token) return <VerificationLinkIncomplete />;
  return <EmailVerificationLanding token={token} callbackURL={callbackURL} initialError={error} />;
}
```

### 10.4.7 TwoFactorPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `callbackURL` | string | 应用首页 | 受信校验同前 | 挑战通过后的回跳 |

四态：加载态瞬时；**空态 = 无待挑战的登录中态**（二次验证 Cookie 缺失或过期）——呈现"挑战已失效，请重新登录"，属本页的无权限等价物；失败 = 因子校验错误码（`INVALID_CODE`、`ACCOUNT_TEMPORARILY_LOCKED` 锁定倒计时）；无权限态并入空态处理。转场：通过后跳 `callbackURL`；刷新重放——Cookie 仍在则挑战表单重建（码不残留），过期则落空态；Tab 切换因子不回写 URL。

```tsx
function TwoFactorPage() {
  const { callbackURL } = readSearchParams();
  return <TwoFactorChallenge callbackURL={callbackURL} />;
}
```

### 10.4.8 SessionsPage

Props：无路由参数，也不消费查询参数。

四态：加载 = Skeleton 会话行；空 = 会话清单为空（正常登录态至少一条，全空意味着并发吊销后的窗口期，呈现空态并给刷新按钮）；失败 = `FAILED_TO_GET_SESSION` 重试型错误块；无权限 = 未认证转登录（带 `callbackURL` 回本页）。部分失败降级：单条吊销失败只在行内标注并保留该行，不拖垮列表。转场：吊销后行内收起；刷新重放列表（幂等，已吊销的不在）；其他标签页经广播同步刷新，视觉恢复优先保留列表骨架。

```tsx
function SessionsPage() {
  const { data, error, isPending, refetch } = useSessionsList();
  if (!requireSignedIn()) return <Redirect toSignInWithCallback="/settings/sessions" />;
  if (isPending) return <Skeleton variant="row" count={3} />;
  if (error) return <ErrorCallout code={error.code} onRetry={() => refetch()} />;
  if (!data?.length) return <EmptySessionsNotice />;
  return data.map((s) => <SessionListItem key={s.token} session={s} onRevoke={revoke} />);
}
```

### 10.4.9 AccountsPage

Props：无路由参数，也不消费查询参数。

四态：加载 = Skeleton 绑定行；空 = "尚未绑定任何第三方账号"并给绑定入口；失败 = `ErrorCallout`；无权限 = 未认证转登录。部分失败降级：解绑失败（`FAILED_TO_UNLINK_LAST_ACCOUNT`）行内标注且列表保持原样。转场：解绑后行移除；绑定发起走社交登录流（离页再回），刷新重放列表幂等。

```tsx
function AccountsPage() {
  const { data, error, isPending, refetch } = useAccountsList();
  return (
    <>
      {!isPending && !data?.length && <EmptyAccountsNotice />}
      {data?.map((a) => (
        <AccountListItem key={`${a.providerId}:${a.accountId}`} account={a} isLast={data.length === 1} onUnlink={unlink} />
      ))}
    </>
  );
}
```

### 10.4.10 OrganizationPage

Props：路由参数 `slug`（组织标识，string，必填；未匹配到可读组织时按无权限路径处理）。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| 无必需项 | — | — | — | 成员与邀请操作在页内完成，不落查询参数 |

四态：加载 = 组织详情 Skeleton；空 = 用户无任何组织时呈现"创建第一个组织"引导（组织列表场景）；失败 = `ErrorCallout`（组织侧码透传，如 `ORGANIZATION_NOT_FOUND`）；无权限 = `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` 呈现 403 语义，不重定向到登录（已认证但越权，与未认证是两条路径）。部分失败降级：成员列表单条操作失败行内标注。转场：建组织成功跳新组织详情；邀请发送原地 Toast；刷新重放详情，视觉恢复保留骨架。

```tsx
function OrganizationPage({ slug }: { slug: string }) {
  const { data, error, isPending } = useOrganizationDetail(slug);
  if (isPending) return <Skeleton variant="block" />;
  if (error?.code === "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION") return <ForbiddenNotice />;
  if (error) return <ErrorCallout code={error.code} onRetry={refetch} />;
  return <OrganizationDetail organization={data} />;
}
```

### 10.4.11 InvitationPage

Props：路由参数 `invitationId`（string，必填；非法格式按失效态处理，不调接口）。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| 无 | — | — | — | 邀请标识走路由参数，详情经 `GET /organization/get-invitation` 获取 |

四态：加载 = 邀请详情 Skeleton；空与失效合并 = `INVITATION_NOT_FOUND` 或终态呈现"邀请不存在、已过期或已处理"；失败 = 组织侧码透传；无权限 = 当前主体邮箱与被邀邮箱不匹配，详情可见、动作禁用并说明（见 [业务组件](./business/)）。转场：接受成功跳组织页；拒绝成功原地转已拒绝态；刷新重放——终态幂等，重复接受不产生第二个成员行（服务端原子认领兜底）。

```tsx
function InvitationPage({ invitationId }: { invitationId: string }) {
  const { data, error, isPending } = useInvitationDetail(invitationId);
  if (isPending) return <Skeleton variant="row" count={3} />;
  if (error || isInvitationClosed(data)) return <InvitationClosedNotice detail={error} />;
  return <InvitationAccept invitation={data} />;
}
```

### 10.4.12 AdminUsersPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `search` | string | 空 | 原样作为检索词透传 | 管理端检索框的初始值；检索动作本身不回写 URL |
| `page` | number | 1 | 非数字回退 1，越界回退 1 | 分页初始位；翻页由页内组件管理不回写 |

四态：加载 = 用户表 Skeleton；空 = 检索无结果呈现"无匹配用户"并给清空检索动作；失败 = `ErrorCallout` 重试；无权限 = 非 `admin` 呈现 403 语义，不重定向。部分失败降级：批量封禁或吊销部分失败时逐行标注失败原因，成功行保持变更。转场：行内详情抽屉开关不产生导航；刷新重放列表与检索词，视觉恢复优先保留表格骨架。

```tsx
function AdminUsersPage() {
  const { search, page } = readSearchParams();
  const { data, error, isPending, refetch } = useAdminUsers({ searchValue: search, page });
  if (!requireAdmin()) return <ForbiddenNotice />;
  if (isPending) return <Skeleton variant="row" count={10} />;
  if (error) return <ErrorCallout code={error.code} onRetry={() => refetch()} />;
  if (!data?.users.length) return <EmptyUsersNotice />;
  return <AdminUserTable users={data.users} onPartialFail={annotateRow} />;
}
```

### 10.4.13 DeviceApprovalPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `user_code` | string | 无 | 缺失或空白 → 空态"请核对设备上显示的地址"；格式非法 → 同空态并提示重输 | 设备端展示的用户码，标准设备授权流参数 |

四态：加载 = 查码进行中；空 = `user_code` 缺失；失败 = `expired_token`、`device_code_already_processed`、`access_denied` 均按终态呈现（非错误措辞）；无权限 = 未认证先转登录，回跳携带 `user_code`，登录后原样回到本页。转场：批准或拒绝后原地转终态，不跳离（设备侧凭轮询继续）；刷新重放——已终态的码呈现对应终态（幂等，不会二次批准）；用户码用后即换，页面不缓存完整码到本地存储。

```tsx
function DeviceApprovalPage() {
  const { user_code: userCode } = readSearchParams();
  const { data, error, isPending } = useDeviceStatus(userCode);
  if (!userCode) return <DeviceCodeMissingNotice />;
  if (!requireSignedIn()) return <Redirect toSignInWithCallback="/device" />;
  if (isPending) return <Spinner label="Verifying code" />;
  if (error || data?.status !== "pending") return <DeviceFinalStatus status={data?.status} detail={error} />;
  return <DeviceApproval userCode={userCode} clientInfo={data} />;
}
```

### 10.4.14 ErrorFallbackPage

Props：无路由参数。

| URL search params | 类型 | 默认 | 非法值处理 | 说明 |
|---|---|---|---|---|
| `error` | string | `UNKNOWN` | 不匹配白名单 `^[\'A-Za-z0-9_-]+$` 时按 `UNKNOWN` 呈现，正则与内建错误页一致（取证：`packages/better-auth/src/api/routes/error.ts:404`） | 失败码 |
| `error_description` | string | 无 | 渲染层 HTML 转义后展示 | 与码配对的描述，缺省时按码映射三要素文案 |

四态：本页是四态的**终点**——加载态不适用（纯静态呈现）；空态不适用（有码即有内容）；失败态即本体；无权限态不适用（任何人可见）。码到文案的映射走 `$ERROR_CODES` 与宿主文案表，不内联。转场：动作按码分化——可重试码给重试（回来源页），凭据类给登录或重置入口，兜底给返回首页；刷新重放同一呈现（幂等）；本页承接内建错误页的 302 目标角色，配置方式见 [产品原型](../product/#82-built-in-surfaces)。

```tsx
function ErrorFallbackPage() {
  const { error, error_description: description } = readSearchParams();
  const safeCode = /^[\'A-Za-z0-9_-]+$/.test(error) ? error : "UNKNOWN";
  const copy = mapErrorCodeToCopy(safeCode); // 走 $ERROR_CODES 与宿主文案表，不内联
  return (
    <Card>
      <Badge tone="error">ERROR</Badge>
      <ErrorCallout code={safeCode} message={description ?? copy.message} onRetry={copy.retry} />
    </Card>
  );
}
```
