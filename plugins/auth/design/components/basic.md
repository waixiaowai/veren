---
title: 基础组件
description: 消费方认证界面的 14 个基础组件契约：用途、Props、事件、交互状态与微交互声明。
sidebar:
  order: 26
  label: 基础组件
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 10.1 Basic Components

本章定义的是**消费方组件契约**，不是框架交付物。依据：框架不提供任何 UI 组件库——仓库中不存在面向消费方的组件导出，唯一内建界面是错误页与接口参考页（见 [产品原型](../product/)），它们的视觉参数构成这些组件的取值基线（见 [UI 规范](../ui/)）。全部组件遵循三条公共约定：视觉取值走语义令牌不写死色值；微交互统一 150ms 与标准曲线 `cubic-bezier(0.4, 0, 0.2, 1)`（取值来源为内建错误页）；`prefers-reduced-motion` 命中时全部过渡瞬变。

### 10.1.1 Component Inventory

| 组件 | 一句话职责 | 依赖 |
|---|---|---|
| Button | 动作触发与提交 | Spinner（loading 态） |
| Input | 单行文本输入 | — |
| PasswordInput | 口令输入与显示切换 | Input、IconButton |
| Checkbox | 勾选与多选 | Label |
| Label | 字段标题与可访问名称来源 | — |
| Field | 字段容器：标签、控件、错误文案、提示的组织者 | Label、Input 系 |
| Card | 内容分块的描边容器 | — |
| Alert | 语义块级提示（错误、成功、警告、信息） | — |
| Spinner | 进行中指示 | — |
| Badge | 状态短标签 | — |
| Tabs | 同一区域内平级视图切换 | — |
| Dialog | 模态确认与关键信息 | Button |
| Toast | 操作结果的轻量回执 | — |
| Skeleton | 加载占位 | — |

公共交互状态基线（各条目只写差异）：hover 透明度或底色变化 150ms 标准曲线；focus 显示 2px 焦点环，键盘可达；disabled 置灰且移出 Tab 序、保留可访问名称；loading 态禁触发但保留布局；error 态以文字与图标呈现不靠颜色。

### 10.1.2 Button

用途：触发动作或提交表单；认证界面区分主按钮（`primary`，对应 `--primary`）与次按钮（`outline`，对应 `--border` 描边），内建错误页的两枚按钮是取值范本。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `variant` | enum `primary` `outline` `ghost` `danger` | 否 | `primary` | 视觉分级 |
| `type` | enum `button` `submit` | 否 | `button` | 表单语义 |
| `loading` | boolean | 否 | `false` | 提交中：换 Spinner 并禁触发 |
| `disabled` | boolean | 否 | `false` | 禁用 |
| `fullWidth` | boolean | 否 | `false` | 整行铺开（移动端） |

事件：`onClick`（`loading` 与 `disabled` 时不触发）。交互状态：hover opacity 0.8（150ms，沿用错误页取值）；focus 焦点环；loading 中不响应点击且不可中断；danger 变体用 `--destructive`。微交互：loading 接入瞬变、Spinner 转出 150ms；reduced-motion 下 Spinner 静态化。

```tsx
<Button type="submit" loading={isPending} fullWidth>
  Sign in
</Button>
```

### 10.1.3 Input

用途：单行文本输入，邮箱、姓名、用户码等。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `type` | string | 否 | `text` | 原生类型，如 `email` |
| `value` | string | 是 | — | 受控值 |
| `onValueChange` | `(value: string) => void` | 否 | — | 受控回调 |
| `invalid` | boolean | 否 | `false` | 错误态描边换 `--destructive` |
| `describedBy` | string | 否 | — | 错误或提示文案的关联 id |
| `autoComplete` | string | 否 | — | 口令管理器提示，如 `email`、`current-password` |
| `inputMode` | string | 否 | — | 移动键盘提示，码输入用 `numeric` |

事件：`onValueChange`、`onBlur`、`onKeyDown`。交互状态：focus 焦点环 150ms；invalid 描边 `--destructive` 且与 `aria-invalid` 同步；disabled 置灰。微交互：仅描边与焦点环过渡 150ms。`autoComplete` 是认证界面的硬要求：登录口令 `current-password`、新口令 `new-password`、邮箱 `email`，缺失会导致口令管理器误判。

```tsx
<Input
  type="email"
  value={email}
  onValueChange={setEmail}
  autoComplete="email"
  invalid={!!error}
  describedBy="email-error"
/>
```

### 10.1.4 PasswordInput

用途：口令输入，内置显示与隐藏切换；切换按钮必须有可访问名称。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `value` | string | 是 | — | 受控值 |
| `onValueChange` | `(value: string) => void` | 否 | — | 受控回调 |
| `autoComplete` | enum `current-password` `new-password` | 否 | `current-password` | 口令管理器语义 |
| `invalid` | boolean | 否 | `false` | 错误态 |
| `describedBy` | string | 否 | — | 关联提示 id |

事件：`onValueChange`、`onToggle`（显示状态翻转后回调）。交互状态：切换按钮 focus 焦点环；切换时输入类型在 `password` 与 `text` 间瞬变。微交互：图标切换 150ms 标准曲线；类型切换不做过渡（避免口令闪现错觉）；reduced-motion 瞬变。

```tsx
<PasswordInput
  value={password}
  onValueChange={setPassword}
  autoComplete="new-password"
/>
```

### 10.1.5 Checkbox

用途：单项勾选，如"信任此设备""吊销其他会话"。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `checked` | boolean | 是 | — | 受控选中 |
| `onCheckedChange` | `(checked: boolean) => void` | 否 | — | 受控回调 |
| `disabled` | boolean | 否 | `false` | 禁用 |

事件：`onCheckedChange`。交互状态：focus 焦点环作用于勾选框本体；选中态用 `--primary` 填充加对勾图形。微交互：勾选填充 150ms；reduced-motion 瞬变。

```tsx
<Checkbox checked={trustDevice} onCheckedChange={setTrustDevice} />
```

### 10.1.6 Label

用途：字段标题，是控件可访问名称的来源；与控件经 `htmlFor` 关联。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `htmlFor` | string | 是 | — | 关联控件 id |
| `required` | boolean | 否 | `false` | 渲染必填标记，标记同时有文字说明 |

交互状态：无交互；点击把焦点交给关联控件。微交互：无。认证表单全部字段必须有 Label，占位文案不得替代标签（占位在输入后消失，违反可访问名称常驻原则）。

```tsx
<Label htmlFor="email">Email</Label>
```

### 10.1.7 Field

用途：字段容器，把 Label、输入控件、提示与错误文案组织成一个语义单元；错误与字段的可访问关联在这里完成，是 9.6 无障碍第 4 条的落点。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `label` | string | 是 | — | 渲染 Label |
| `htmlFor` | string | 是 | — | 关联控件 id |
| `error` | string 或 null | 否 | `null` | 非空时渲染错误文案并置 `aria-invalid` |
| `hint` | string | 否 | — | 常驻提示，错误出现时让位于错误 |
| `children` | ReactNode | 是 | — | 输入控件（容器负责注入 describedBy） |

交互状态：error 态错误文案紧贴控件下方，颜色 `--destructive` 但必带文字；hint 用 `--muted-foreground`。微交互：hint 与错误文案互替时 150ms 淡换；reduced-motion 瞬变。

```tsx
<Field label="Email" htmlFor="email" error={errors.email}>
  <Input id="email" type="email" value={email} onValueChange={setEmail} />
</Field>
```

### 10.1.8 Card

用途：内容分块的描边容器；取值沿用错误页卡片——2px `--border` 描边、内边距 1.5rem、直角。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `title` | string | 否 | — | 可选标题，`--text-2xl` semibold |
| `description` | string | 否 | — | 标题下说明，`--muted-foreground` |
| `children` | ReactNode | 是 | — | 内容 |

交互状态：容器本身无交互；内含交互元素按各自规则。微交互：无（容器不承担动效）。表单页布局见 9.3：单列 28rem 宽度即一张 Card。

```tsx
<Card title="Sign in" description="Use your email and password">
  {form}
</Card>
```

### 10.1.9 Alert

用途：块级语义提示，承载错误、成功、警告、信息四档；表单顶部与落地页结果区的主呈现。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tone` | enum `error` `success` `warning` `info` | 否 | `info` | 语义档 |
| `title` | string | 否 | — | 短标题 |
| `children` | ReactNode | 是 | — | 正文，含三要素文案 |
| `action` | ReactNode | 否 | — | 动作区，如重试按钮 |

交互状态：无 hover 语义；`tone: error` 用 `--destructive` 描边加图标加文字三重信号（9.6 第 5 条）。微交互：出现淡入 150ms；reduced-motion 瞬变。错误档的内容组装建议直接用复合组件 ErrorCallout（见 [复合组件](./composite/)），Alert 是它的底座。

```tsx
<Alert tone="error" title="Sign in failed">
  The email or password is incorrect. Try again or reset your password.
</Alert>
```

### 10.1.10 Spinner

用途：进行中指示，出现在提交按钮与列表刷新。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `size` | enum `sm` `md` | 否 | `sm` | 按钮内 sm、独立 md |
| `label` | string | 是 | — | 可访问名称，如 `Submitting` |

交互状态：无交互；必须有可访问名称，纯图形不承担语义。微交互：旋转 800ms 线性循环；reduced-motion 下换静态省略号并保留 `label`。

```tsx
<Spinner size="md" label="Loading sessions" />
```

### 10.1.11 Badge

用途：状态短标签，如会话列表的 `current`、邀请的 `pending`。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tone` | enum `neutral` `success` `warning` `error` | 否 | `neutral` | 语义档 |
| `children` | string | 是 | — | 状态词，必为文字 |

交互状态：无交互。微交互：无。状态词必须是文字（对应 [状态模型](../states/) 的小写下划线状态名），不允许只用色点；底色为对应语义的低饱和投影，文字保持对比度达标。

```tsx
<Badge tone="neutral">current</Badge>
```

### 10.1.12 Tabs

用途：同区域内平级视图切换，典型是二次验证的 TOTP、OTP、备份码三分支。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `value` | string | 是 | — | 当前激活项 |
| `onValueChange` | `(value: string) => void` | 否 | — | 切换回调 |
| `items` | `{ value: string; label: string } 数组` | 是 | — | 页签清单 |

事件：`onValueChange`；键盘左右箭头切换。交互状态：激活页签底部 2px 指示条；focus 焦点环。微交互：指示条位移 150ms 标准曲线；面板内容切换瞬变（不做滑动）；reduced-motion 瞬变。切换不回写 URL。

```tsx
<Tabs
  value={method}
  onValueChange={setMethod}
  items={[
    { value: "totp", label: "Authenticator app" },
    { value: "otp", label: "Email code" },
    { value: "backup", label: "Backup code" },
  ]}
/>
```

### 10.1.13 Dialog

用途：模态确认与关键信息呈现；危险操作（吊销、解绑、封禁）的确认落点。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `open` | boolean | 是 | — | 受控开关 |
| `onOpenChange` | `(open: boolean) => void` | 否 | — | 开关回调 |
| `title` | string | 是 | — | 标题复述动作与对象 |
| `children` | ReactNode | 是 | — | 后果说明 |
| `actions` | ReactNode | 是 | — | 按钮，危险动作用 danger 变体 |

事件：`onOpenChange`；Escape 关闭；遮罩点击默认不关闭（防误触）。交互状态：打开时焦点移入面板、关闭归还触发元素；遮罩 `--background` 80% 覆盖。微交互：开合 150ms 标准曲线；关闭可被 Escape 打断；reduced-motion 瞬变。

```tsx
<Dialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  title="Revoke this session?"
  actions={confirmActions}
>
  The next access from this device will require a new sign in.
</Dialog>
```

### 10.1.14 Toast

用途：操作结果的轻量回执，复制备份码、吊销成功这类无需页面跳转的反馈。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tone` | enum `success` `error` `info` | 否 | `info` | 语义档 |
| `message` | string | 是 | — | 一句话结果 |
| `duration` | number | 否 | `2000` | 停留毫秒 |

交互状态：hover 暂停倒计时；可手动关闭（关闭按钮带可访问名称）。微交互：滑入 150ms、停留默认 2000ms、滑出 150ms；新 Toast 打断旧滑出；reduced-motion 瞬入瞬出、停留不变。

```tsx
<Toast tone="success" message="Backup codes copied" />
```

### 10.1.15 Skeleton

用途：加载占位，列表与卡片首屏数据未达时的骨架。

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `variant` | enum `text` `block` `row` | 否 | `text` | 占位形态 |
| `count` | number | 否 | `1` | row 形态的行数 |

交互状态：无交互、不拦截焦点。微交互：光泽扫过 1200ms 循环；reduced-motion 下换静态 `--border` 底色块。占位尺寸须与真实内容一致，避免数据到达后布局跳动。

```tsx
<Skeleton variant="row" count={4} />
```
