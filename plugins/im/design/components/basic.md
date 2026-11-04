---
title: 基础组件
description: "第 24 章基础组件：29 个原子的清单、Props 契约、微交互、六态呈现与验收约定。"
sidebar:
  order: 24
  label: 24 基础组件
draft: false
lastUpdated: 2026-11-04
---

## 24. Basic Components

基础组件是四层组件体系的最底层，也是唯一可以直接决定像素的地方：往上一层的复合组件只负责排列它们，再往上的业务组件只负责给它们喂数据。本章逐个登记 29 个原子，约定 Props、微交互与状态呈现，供 [第 25 章](./composite/) 及后续章节引用。颜色、间距、字体与动效的取值来自 [界面规范](../ui/)，本章只引用令牌，不重复定义。

### 24.1 Layer Rules

基础组件回答两个问题：长什么样，以及按下之后立刻发生什么。它不回答第三个问题——这份数据属于谁、这个人能不能看。判定标准写成两列，任何一条越界都应在评审时退回。

| 允许 | 禁止 |
| --- | --- |
| 接收受控值与回调，维护纯视觉的局部状态，如展开、按下、悬停 | 取业务数据、调用接口、直接读写全局 store |
| 引用令牌决定颜色、圆角、阴影、时长与曲线 | 写死色值、毫秒数与魔法像素 |
| 用 props 暴露尺寸档、语气与密度变体 | 在组件内部按角色、权限或租户分支 |
| 把原始事件上抛给父层 | 自行决定重试、跳转、导航或弹提示 |
| 用 ARIA 属性表达控件语义与状态 | 用颜色单独表达禁用、错误或选中 |

尺寸与颜色只有两个来源：全局令牌，或调用方通过 props 传入的档位。同一个原子在桌面、移动与后台三个壳里必须共用同一份令牌；后台的独立样式表可以重写布局，但不能另造一套色值。

### 24.2 Inventory

清单按输入与选择、头像、图标与展示、交互原语、边界与结构五组排列，与源码目录一一对应。Props 表合并同类项：同名字段在多个原子上同义时写在一行。

| 组件 | 文件 | 用途 | 关键 Props |
| --- | --- | --- | --- |
| Input | components/Input.tsx | 单行文本输入，全站唯一的输入外观 | value, onChange, invalid, inputSize |
| TextArea | components/TextArea.tsx | 多行纯文本输入 | value, onChange, rows |
| Checkbox | components/Checkbox.tsx | 卡片式勾选，带标签与说明 | checked, onCheckedChange, label, description |
| Select | components/Select.tsx | 列表选择触发器，完整 combobox 语义 | value, options, onValueChange |
| Combobox | components/Combobox.tsx | 可搜索的 Select | 继承 Select，另有 placeholder, searchPlaceholder |
| Avatar | components/Avatar.tsx | 成员头像与在线状态点 | p, size, showStatus, statusOverride, ringColor |
| AvatarMini | components/Avatar.tsx | 紧凑尺寸头像，用于密集列表 | p, size, ringColor |
| AvatarStack | components/Avatar.tsx | 重叠成员栈 | ps, size, max |
| HiveAvatar | components/HiveAvatar.tsx | 群组拼贴头像，n 个成员铺成网格 | ps, size, ringColor, showStatusOnSingle |
| HumanBadge | components/HumanBadge.tsx | 姓名旁的人类标记 | 无 |
| CloudLogo | components/Avatar.tsx | 品牌云标，用于空态与登录页 | size |
| 图标集 | components/icons.tsx, components/EditorIcons.tsx | 30 个导航图标与 15 个编辑器图标 | SVGProps |
| Pressable | mobile/Pressable.tsx | 移动端按钮原语，替代原生 button | haptic, noScale, scale, as |
| TwEmoji | components/TwEmoji.tsx | 按码点渲染彩色 emoji | emoji, size |
| SkypeEmoji | components/SkypeEmoji.tsx | 动画表情逐帧精灵图 | name, size, autoPlaySound |
| PreviewText | components/PreviewText.tsx | 会话预览行，含行内表情 | body, emojiSize |
| ResizeHandle | components/ResizeHandle.tsx | 1px 列宽拖拽手柄 | onMouseDown |
| ScrollToLatestButton | components/ScrollToLatestButton.tsx | 悬浮的回到底部胶囊 | visible, onClick, bottomOffset |
| WindowDragStrip | components/WindowDragStrip.tsx | 无边框窗口的拖拽带 | 无 |
| ErrorBoundary | components/ErrorBoundary.tsx | 桌面整壳渲染兜底 | children, fallback |
| ViewBoundary | mobile/ViewBoundary.tsx | 按标签页兜底并提供重试 | name, children, onRetry |
| Pager | admin/Pager.tsx | 后台分页条 | offset, limit, total, onChange |
| Pill | components/ShippingWorkspace.tsx | 语气胶囊，用于状态与分类 | tone, children |
| Divider | components/WhisperRoom.tsx | 带文案的分隔线 | label |
| FullScreenNote | admin 局部 | 后台全屏说明与主操作 | title, description, action |
| SettingRow | admin 局部 | 后台设置行，左说明右控件 | label, description, children |
| NavLink | admin 局部 | 后台侧栏导航项 | href, active, children |
| useLongPress | mobile/useLongPress.ts | 450ms 长按，容忍 10px 偏移 | onLongPress, delay, tolerance |
| useSwipeBack | mobile/useSwipeBack.ts | 边缘滑动返回，按速度提交 | onBack, enabled |

共享类型只列一次，Props 表直接引用这些名字。

```ts
type Size = number
type InputSize = 'sm' | 'md'
type Haptic = 'light' | 'medium' | 'none'
type Tone = 'blue' | 'good' | 'warn' | 'bad' | 'neutral'
type PresenceStatus = 'avail' | 'working' | 'thinking' | 'waiting' | 'resting'
interface Option { value: string; label: string; hint?: string; disabled?: boolean }
interface Participant { id: string; name: string; avatarUrl: string | null; kind: 'human' | 'agent' }
```

**输入与选择**

| 组件与字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| value（Input 与 TextArea） | string | 是 | — |
| onChange（Input 与 TextArea） | (value: string) => void | 是 | — |
| invalid（Input） | boolean | 否 | false |
| inputSize（Input） | InputSize | 否 | md |
| placeholder 与 disabled（Input 与 TextArea） | string，boolean | 否 | 空，false |
| rows（TextArea） | number | 是 | — |
| checked 与 onCheckedChange（Checkbox） | boolean，(checked: boolean) => void | 是 | — |
| label，description，ariaLabel（Checkbox） | ReactNode，ReactNode，string | 否 | — |
| value，options，onValueChange（Select） | string，Option[]，(value: string) => void | 是 | — |
| placeholder，searchPlaceholder（Combobox） | string | 否 | 空 |

**头像与徽标**

| 组件与字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| p 与 ps（Avatar, AvatarMini, AvatarStack, HiveAvatar） | Participant，Participant[] | 是 | — |
| size（同上四个） | Size | 否 | 由调用方给定 |
| showStatus（Avatar） | boolean | 否 | true |
| statusOverride（Avatar） | PresenceStatus | 否 | 取成员实时状态 |
| ringColor（Avatar, AvatarMini, HiveAvatar） | string | 否 | 无描边 |
| max（AvatarStack） | number | 否 | — |
| showStatusOnSingle（HiveAvatar） | boolean | 否 | true |
| size（CloudLogo） | Size | 否 | — |
| HumanBadge | 无 Props，语义由父层姓名决定 | — | — |

**图标与展示**

| 组件与字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| 图标集（30 个导航图标与 15 个编辑器图标） | SVGProps | 否 | viewBox 24，strokeWidth 1.5 |
| emoji（TwEmoji） | string | 是 | — |
| name（SkypeEmoji） | string | 是 | — |
| size 与 emojiSize（TwEmoji, SkypeEmoji, PreviewText） | Size | 否 | — |
| autoPlaySound（SkypeEmoji） | boolean | 否 | false |
| body（PreviewText） | string | 是 | — |
| tone 与 children（Pill） | Tone，ReactNode | 是 | — |
| label（Divider） | ReactNode | 否 | 纯线 |

**交互原语**

| 组件与字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| haptic（Pressable） | Haptic | 否 | light |
| scale 与 noScale（Pressable） | number，boolean | 否 | 0.97，false |
| as（Pressable） | ElementType | 否 | button |
| onMouseDown（ResizeHandle） | (e: MouseEvent) => void | 是 | — |
| visible 与 onClick（ScrollToLatestButton） | boolean，() => void | 是 | — |
| bottomOffset（ScrollToLatestButton） | number | 否 | 由布局给定 |
| onLongPress（useLongPress） | () => void | 是 | — |
| delay 与 tolerance（useLongPress） | number，number | 否 | 450，10 |
| onBack 与 enabled（useSwipeBack） | () => void，boolean | 是，否 | —，true |
| WindowDragStrip | 无 Props | — | — |

**边界与结构**

| 组件与字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| children 与 fallback（ErrorBoundary） | ReactNode，ReactNode | 是，否 | —，内置错误卡片 |
| name，children，onRetry（ViewBoundary） | string，ReactNode，() => void | 是，是，否 | — |
| offset，limit，total，onChange（Pager） | number，number，number，(offset: number) => void | 是 | — |
| title，description，action（FullScreenNote） | ReactNode | 是，否，否 | — |
| label，description，children（SettingRow） | ReactNode | 是，否，是 | — |
| href，active，children（NavLink） | string，boolean，ReactNode | 是，否，是 | —，false |

### 24.3 Interaction and Microinteraction

微交互只反馈“操作已被接收”，不承载业务状态，也不改变占位。每条都写清触发、变化属性、时长与曲线、可中断性与降级。

| 组件 | 触发 | 变化属性 | 时长与曲线 | 可中断 | 减少动态降级 |
| --- | --- | --- | --- | --- | --- |
| Input 与 TextArea | 获得焦点 | 外环出现，边框由弱转主色 | fast，standard | 是，焦点移走即回退 | 只换颜色，不做过渡 |
| Input | 校验失败 | 边框转警示色，错误行出现 | fast，standard | 是，输入即清除 | 直接切换 |
| Checkbox | 点击或空格 | 底色与勾选描边进度 | instant，standard | 否，一次到位 | 直接跳变 |
| Select | 展开触发器 | 弹层透明度与 4px 上移 | base，enter | 是，再次点击立即收起 | 直接显示 |
| Combobox | 输入过滤 | 高亮项底色，列表不重排 | fast，standard | 是，继续输入即重算 | 直接跳变 |
| Avatar | 成员状态变化 | 状态点颜色与描边 | base，standard | 是 | 直接跳变 |
| Pressable | 指针按下 | 整体缩放至 0.97 | instant，standard | 是，抬起或移出立即复位 | 去掉缩放，只保留颜色 |
| ScrollToLatestButton | 离底超过一屏 | 透明度与 8px 上移 | base，enter | 是，回底立即消失 | 直接显隐 |
| ResizeHandle | 拖拽中 | 列宽实时跟随，手柄高亮 | 拖拽无过渡，高亮 fast | 是 | 无过渡 |

统一规则如下，任何新原子都按这套取值，不另造第五档时长。

- 同一原子同一时刻只允许一个属性族在动：颜色、位移、缩放三选一，避免叠帧。
- 时长只取 instant、fast、base、slow 四档，即 80、150、200、300ms；反馈用 instant 与 fast，进场用 base，整块面板用 slow。
- 曲线只有 standard、enter、leave 三条；spring 只用于移动端整屏推入与弹层，不用在原子层。
- 反馈不得改变占位：焦点环用外环加偏移而非加粗边框，按下用缩放而非改尺寸。
- 减少动态时取消全部位移，弹簧与视差降为不超过 120ms 的淡入或直接切换，循环装饰动画停在首帧；焦点环、状态色与文案提示不降级，判定由同一入口完成。

### 24.4 States

六种状态在三个壳里语义一致，只允许密度与命中区域不同。

| 状态 | 呈现 | 硬性要求 |
| --- | --- | --- |
| 禁用 | 内容降透明度并保留轮廓，指针为禁止光标 | 不接收点击与聚焦；仍可被读屏读出，带 disabled 语义 |
| 悬停 | 背景或边框升一档，不改变尺寸 | 只在有指针的设备出现；触屏不依赖悬停传递信息 |
| 聚焦 | 2px 外环加 2px 偏移，颜色取 sky-deep | 用外环与偏移实现，不挤压布局；键盘与鼠标聚焦同款 |
| 加载 | 原位骨架或进行中文案，尺寸与行高不变 | 加载不改变占位；按钮保持原宽度并挡二次触发 |
| 错误 | 警示色边框加一行说明，配图标而非仅颜色 | 错误说明写清发生了什么与下一步，不用泛指失败 |
| 只读 | 保留选中与复制，去掉可编辑暗示 | 不显示禁止光标；只读不等于禁用，值仍需可读 |

### 24.5 Usage

受控输入：值、校验与提交都在父层，基础组件只负责显示与上抛。

```tsx
const [name, setName] = useState('')
const invalid = name.trim().length === 0
<Input value={name} onChange={setName} invalid={invalid} inputSize="sm" aria-label="房间名称" />
```

成员行：头像栈、人类标记与语气胶囊靠复合层排列，原子之间不互相感知。

```tsx
<div className="flex items-center gap-2">
  <AvatarStack ps={members} size={24} max={4} />
  <HumanBadge />
  <Pill tone={room.kind === 'whisper' ? 'warn' : 'neutral'}>{kindLabel}</Pill>
</div>
```

移动行：Pressable 负责触感与缩放，长按菜单由 hook 提供属性，打开哪一层由父层决定。

```tsx
const longPress = useLongPress({ onLongPress: () => openMenu(convo.id) })
<Pressable {...longPress} haptic="light" onClick={() => openChat(convo.id)}>
  <PreviewText body={convo.preview} />
</Pressable>
```

### 24.6 Acceptance

| 编号 | 操作 | 可观察结果 |
| --- | --- | --- |
| B-01 | 只用键盘遍历一个含 Input、Checkbox、Select、Pressable 的表单 | 每个控件可聚焦、可操作；Select 支持方向键、Home、End、回车与空格；Esc 收起弹层 |
| B-02 | 在两套主题下用键盘聚焦同一控件 | 焦点环均清晰可见，不被裁切，不引起布局位移 |
| B-03 | 抽查任一原子的颜色、圆角、阴影与时长 | 全部来自令牌，无内联色值与裸毫秒数 |
| B-04 | 打开系统减少动态偏好后重放上述交互 | 位移与缩放消失，仅保留不超过 120ms 的淡入或直接切换；循环装饰动画停在首帧，功能不受影响 |
