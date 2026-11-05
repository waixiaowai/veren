---
title: 复合组件
description: 由基础组件组合而成的 8 个复合组件契约：组成、布局、Props、事件与响应式行为。
sidebar:
  order: 27
  label: 复合组件
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 10.2 Composite Components

本章定义消费方认证界面的复合组件：它们由 [基础组件](./basic/) 组合而成，自身不发请求、不持有业务数据，只把输入组织成可交互的结构。依据与基础组件相同：框架不提供 UI 库，本章是消费方组件契约。公共约定沿用基础组件章的三条（语义令牌、150ms 标准曲线 `cubic-bezier(0.4, 0, 0.2, 1)`、`prefers-reduced-motion` 瞬变），另加一条：**同区域内多个复合组件的过渡节奏必须一致**——同一表单里字段错误出现、按钮 loading、提示淡入共用同一时长与曲线，禁止混用两套节奏。

### 10.2.1 Component Inventory

| 组件 | 组成 | 一句话职责 |
|---|---|---|
| FormField | Field、Label、Input 系控件 | 标签、控件、错误文案的可访问关联单元 |
| OAuthButtonGroup | Button 组 | 多提供方登录按钮的排布与触发 |
| CodeInput | Input 组 | 一次性码的分格输入 |
| SessionListItem | Badge、Button、文本行 | 单条会话的呈现与吊销入口 |
| AccountListItem | Badge、Button、文本行 | 单条账号绑定的呈现与解绑入口 |
| PasswordStrengthHint | 文本、色条 | 新口令强度规则的就地提示 |
| ErrorCallout | Alert、Button | 码加文案加重试的错误块 |

### 10.2.2 FormField

组成：`Field` 容器加任一输入控件（Input、PasswordInput、CodeInput）。布局：标签在上、控件居中、提示与错误紧贴控件下方，垂直间距 6px（1.5 步）；错误出现时提示让位。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `label` | string | 是 | — | 字段名 |
| `error` | string 或 null | 否 | `null` | 错误文案，非空时关联控件 |
| `hint` | string | 否 | — | 常驻提示 |
| `children` | ReactNode | 是 | — | 输入控件 |

事件：透传控件的 `onValueChange`。响应式：移动端标签与控件整行排布，错误文案允许两行。微交互：错误替换提示 150ms 淡换，与同表单按钮 loading 同节奏。

```tsx
<FormField label="Email" error={errors.email}>
  <Input type="email" value={email} onValueChange={setEmail} />
</FormField>
```

### 10.2.3 OAuthButtonGroup

组成：一组 `Button`（variant `outline`），每个按钮带提供方 SVG 标识与固定文案 `Continue with <provider>`。布局：桌面按提供方数量横排（两枚各占一半、三枚及以上等分），移动端纵向整行堆叠，间距 12px。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `providers` | `{ id: string; label: string } 数组` | 是 | — | 提供方清单，顺序即装配顺序 |
| `onSelect` | `(providerId: string) => void` | 是 | — | 选中回调，发起社交登录 |
| `disabled` | boolean | 否 | `false` | 整组禁用（表单提交中） |

事件：`onSelect`。响应式：横排与堆叠断点同全局 640px。微交互：按钮 hover opacity 0.8（沿用错误页取值）；整组 disabled 时同时置灰，防止用户在邮箱表单提交中又点社交按钮形成双会话竞态。

```tsx
<OAuthButtonGroup
  providers={[
    { id: "github", label: "GitHub" },
    { id: "google", label: "Google" },
  ]}
  onSelect={startSocialSignIn}
/>
```

### 10.2.4 CodeInput

组成：多个单字符 `Input`（`inputMode: numeric`、`maxLength` 与档位一致）横向排布。布局：单行等宽格子，间距 8px，TOTP 与 OTP 默认 6 格、备份码为单格长输入（备份码格式 `XXXXX-XXXXX`，用连字符分段的普通输入更合适）。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | number | 是 | — | 格数，如 6 |
| `value` | string | 是 | — | 已输入码拼接值 |
| `onValueChange` | `(value: string) => void` | 否 | — | 拼接值回调 |
| `onComplete` | `(value: string) => void` | 否 | — | 填满即回调，驱动自动提交 |
| `invalid` | boolean | 否 | `false` | 错误态整组描边 `--destructive` |

事件：`onValueChange`、`onComplete`。响应式：6 格在 320px 宽内仍单行（格宽约 40px），不换行。交互与微交互：输入后焦点自动右移一格、退格左移一格，焦点环 150ms；`invalid` 置位时整组做一次短抖动（reduced-motion 下降级为仅变色），随后清空并把焦点送回第一格。粘贴完整码时一次性分发到各格。

```tsx
<CodeInput
  length={6}
  value={code}
  onValueChange={setCode}
  onComplete={(v) => submitCode(v)}
/>
```

### 10.2.5 SessionListItem

组成：一行文本主体（`userAgent` 摘要、`ipAddress`、`createdAt`）加 Badge（当前会话标记）加吊销 Button（ghost 变体）。布局：桌面单行三段式（设备信息、元数据、操作），移动端堆叠两行。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `session` | `{ token: string; userAgent: string; ipAddress: string; createdAt: string }` | 是 | — | 会话行数据 |
| `isCurrent` | boolean | 否 | `false` | 当前会话：Badge 标记 `current`，默认不给吊销按钮 |
| `onRevoke` | `(token: string) => void` | 是 | — | 吊销回调，父层负责确认弹窗 |

事件：`onRevoke`。响应式：移动端操作按钮整行。微交互：hover 底色变化 150ms；吊销后行移除采用高度收起 150ms，与列表刷新节奏一致。

```tsx
<SessionListItem session={s} isCurrent={s.token === currentToken} onRevoke={revoke} />
```

### 10.2.6 AccountListItem

组成：一行文本主体（提供方名、`accountId`、`scope` 摘要）加解绑 Button（ghost 变体）。布局与 SessionListItem 同构，保持两个设置页的行节奏一致。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `account` | `{ providerId: string; accountId: string; scope: string }` | 是 | — | 绑定行数据 |
| `isLast` | boolean | 否 | `false` | 最后一条绑定：解绑按钮禁用并给出原因文案 |
| `onUnlink` | `(account: { providerId: string; accountId: string }) => void` | 是 | — | 解绑回调，父层负责确认弹窗 |

事件：`onUnlink`。响应式：同 SessionListItem。微交互：同 10.2.5。

```tsx
<AccountListItem account={a} isLast={accounts.length === 1} onUnlink={unlink} />
```

### 10.2.7 PasswordStrengthHint

组成：一条分段色条与一段规则文案；纯提示组件，**强度判定不做服务端承诺**——服务端的长度边界（默认最短 8、最长 128，见 [数据字典](../data/)）与错误码才是事实，本组件只做输入时的前端提示。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `value` | string | 是 | — | 当前口令 |
| `minLength` | number | 否 | `8` | 与服务端配置一致 |

事件：无。响应式：色条整行宽。交互与微交互：随输入实时重算，档位变化时色条颜色 150ms 过渡；色条颜色只作辅助，档位必配文字（弱、中、强），遵守 9.6 不靠颜色原则。

```tsx
<PasswordStrengthHint value={newPassword} />
```

### 10.2.8 ErrorCallout

组成：`Alert`（tone `error`）加可选重试 `Button`；码芯片沿用错误页的 `CODE:` 呈现（等宽族、描边芯片）。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | string 或 null | 否 | `null` | 服务端错误码原文，经 `$ERROR_CODES` 映射文案 |
| `message` | string | 否 | — | 映射失败的回退文案（服务端 message 原文） |
| `onRetry` | `() => void` | 否 | — | 提供时渲染重试按钮，仅可重试类错误传 |
| `retryLabel` | string | 否 | `Try again` | 重试按钮文案 |

事件：`onRetry`。响应式：正文整行流式排布，码芯片允许换行断词（`word-break: break-all`，沿用错误页取值）。微交互：出现淡入 150ms，与表单错误同节奏。文案铁律沿用 9.5：码映射走 `$ERROR_CODES`，组件不内联码到文案的映射表；全部码语义见 [错误码](../errors/)。

```tsx
<ErrorCallout
  code={error?.code}
  message={error?.message}
  onRetry={canRetry ? retry : undefined}
/>
```
