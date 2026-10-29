# 无人值守页面工作面契约（18 页达标）

[English](unattended-page-contract.md) | 中文

**状态**：契约定稿，实现照表。授权矩阵（§5）先行落地；各应用的达标测试以本文件的字段与矩阵为准。

## 0. 目的与合格判据（设计原意，不重新发明）

docs/application-concept.cn.md §0/§0.1：**页面会话是任务被执行和结算的场所**——
投递 → 打开 URL 会话 → 页面工具挂载 → 在页面里完成 → `task_complete` 写结果 →
回报来源应用。页面的合格判据只有两条：

- **(a) 端到端可完成**：投递任务能用本页挂载的工具接取、执行、完成——不借任何
  本页不存在的"宿主全局工具"；
- **(b) 不依赖人在场**：做不完时有出路——重试、租约到期回队（§4.4）、稳定
  code 的失败回报。**任何路径不得以"等用户"结尾。**

本文把这两条判据落成五个可检查的面：动作分级（§1）、页面契约字段（§2）、
完成证据（§3）、自主预算（§4）、18 页授权矩阵（§5）。检查器是可复用测试面
`@veren/test-support` 的 `assertUnattendedPage` / `assertNoUnattendedStall`，
各应用 `tests/` 里的契约 spec 实例化自己的矩阵行。

## 1. 动作三级与同意策略（分级推导，不逐页拍脑袋）

| 级 | 定义 | 判据 | 同意策略（无人时） |
| --- | --- | --- | --- |
| **L0 只读** | 不改变任何记录，无外部副作用 | list/get/查询/盘点；错误路径也不写 | 自主执行，无需同意 |
| **L1 可逆写** | 租约/会话生命周期内的可逆变更，或有对应反向操作/软删除 | take/release（租约可到期回收）、create/update、revoke（有 restore）、vote（重复即收回）、archive/pin（可逆） | 自主执行；完成后带证据回报（§3）。来源授权 = 投递指令（按任务 id 收窄）或本回合用户消息 |
| **L2 破坏性/对外** | 不可逆删除、对外资金/通知副作用、销毁他人工作 | delete、refund、永久撤稿、清账务 | **走回滚或拒绝（稳定 code），不许挂起等确认**。拒绝码 `unattended/l2-refused`；回滚路 = 先落可逆草稿或两步一致（先建新再撤旧） |

两条推导规则：

1. **同意策略是分级的推导结果**：L0/L1 无人自主执行；L2 无人时回滚或拒绝。
   人在场时的确认门**仅是 L2 的可选增强**，不是无人路径的一部分——把
   "写前先向用户确认"写进 L0/L1 页面的说明句，等于宣布该页面无人时全部
   写任务停摆，违反判据 (b)。
2. **写工具的合法触发（L1）= 不可伪造的同意信号**，词汇表与
   docs/task-workbench-modes-dispatch.cn.md §2 相同：本回合用户消息
   (`kind:'user'`)、投递通知（`task-center/notice` 或 `app/task` 块，按任务 id
   收窄）。读面是 `session.deriveMessages()`——**不是** `ownEvents()`
   （同步历史读已被 DSH 决策 2026-09-09 禁止新调用）。首屏自主回合
   （只有 `app/page` / `runtime-context`）= 零写权限。

## 2. 页面契约字段（ComponentPageMeta 扩展）

`@veren/prompt-page` 的 `ComponentPageMeta` 增加 `unattended` 字段（类型面，
不改变任何行为；缺省 = 该页未参与无人值守面，`assertUnattendedPage` 对它沉默）：

```ts
/** 无人值守工作面契约（docs/unattended-page-contract.cn.md §2） */
export interface UnattendedContract {
  /** 本页服务哪类投递任务（一句话）/ the kind of delivered tasks this page serves */
  readonly serves: string
  /** 本页动作级上限 / the page's action-level ceiling */
  readonly level: 'L0' | 'L1' | 'L2'
  /** 完成证据形态（§3；L0 填 'read-only'）/ the completion-evidence shape */
  readonly evidence: string
  /** 失败出路（§0(b)；L0 填 'none-needed'）/ the failure escape */
  readonly escape: string
  /** 自主预算（§4；缺省 = 租约即上界）/ the autonomy budget */
  readonly budget?: string
}
```

校验规则（`assertUnattendedPage`）：

- L0 页面说明句不得引导写动作；L2 页面必须在 `escape` 里点名稳定拒绝码或
  回滚路；
- 页面挂载的写工具级 ≤ 页面级上限（挂载面按各包 spec 提供的"页面 → 工具 →
  级"清单核对）；
- `writes: true` 与挂写工具一致（§3.10.1 规则 3 的既有校验继续生效）。

## 3. 完成证据（definition of done）

完成回报必须带**机器可查证据**，纯口头的 "done" 不算：

- **任务类**：`task_complete` 的 `summary` 必填 + `artifacts`（id/路径/URL 引用
  列表，不搬正文）；记录落在任务中心 `result` 字段，事件
  `task-center/completed` 可订阅、存储可机查；
- **失败类**：`task_fail` 带**稳定 code**（闭集见 task-center `TaskErrorCode`
  或应用自定义 `<app>/<code>`）+ message；记录落在 `failure` 字段；
- **非任务类**（forum 回帖、notebook 写笔记等）：完成后**一句话证据回报**——
  点名产物（帖子 id / 笔记 id / 状态字段前后值），模型从工具返回值取，不编造。

页面说明句的措辞义务：写工具完成后必须"点名产物的一句话回报"，而不是
"已完成"。

## 4. 自主预算

- **时间上界 = 租约**（§4.4 已有）：30 分钟，每次调任务工具续租；到期懒回收
  回 open 队列——这是任务不悬置的兜底，不是失败；
- **轮次/调用上界 = 结算看守**（已有人：person-agent 的
  `createSettlementWatch`，`WATCH_DEFAULTS` 是单一来源）：派发出去的工作有
  回报上界，到界结清，回报不悬空；
- **每页声明的预算**写进 `unattended.budget`（一句话），由页面说明句转述给
  模型；不在宿主新增强制机制——现有可执行面（租约 + 看守）就是边界，
  缺口先"遍历既有面确认不存在"再另行立项。

## 5. 授权矩阵（18 页 × 动作级；现状格 → 目标格）

分级现状的证据行号见各括号内（2026-10-29 取证）。"现状"列 = 本次改造前的
说明句行为；"目标"列 = 达标后。

| # | 应用 · 页 | 挂载写工具（级） | 现状 | 目标 |
| --- | --- | --- | --- | --- |
| 1 | forum · catalog | `forum__post`（L1） | 自主+诚实条款（达标参照） | L1，补契约字段 |
| 2 | forum · post | `forum__comment`/`forum__vote`（L1） | 自主（达标参照） | L1，补契约字段 |
| 3 | person-agent · overview | session/workspace 十件（L1） | 自主+反被动自查+派发结算（范本） | L1，补契约字段 |
| 4 | person-agent · workspaces | workspace 四件（L1） | 自主 | L1，补契约字段 |
| 5 | notebook · list | `notebook__write_note`（L1） | 自主 | L1，补契约字段 |
| 6 | notebook · note | `notebook__rewrite_note`（L1）、`notebook__delete_note`（**L2**） | delete 有"删前确认"门，无人即停摆 | L2 上限：rewrite L1 自主；delete 无人走"投递指令即确认，否则拒绝 `unattended/l2-refused`" |
| 7 | sub2api-admin · home | 无（overview L0） | 写前确认条款污染首页指引 | L0，条款改"派发/导航去对应页" |
| 8 | sub2api-admin · channels | `channels`/`request`（L1） | 一刀切确认，无人停摆 | L1 自主+证据回报 |
| 9 | sub2api-admin · groups | `groups`（L1） | 同上 | L1 |
| 10 | sub2api-admin · users | `users`（L1；balance 外流按额度守门） | 同上 | L1 |
| 11 | sub2api-admin · subscriptions | `subscriptions`（L1，revoke 有 restore） | 同上 | L1 |
| 12 | sub2api-admin · finance | `payment`（refund/delete **L2**） | 同上 | L2 上限：查询/cancel/retry/plan CRUD = L1 自主；refund/delete = L2 拒绝门 |
| 13 | sub2api-admin · codes | `redeem_codes`/`promo_codes`（L1；delete/batch_delete **L2**） | 同上 | L2 上限：generate/expire/update = L1；删除 = L2 拒绝门 |
| 14 | sub2api-admin · accounts | `accounts`（L1，set_status 可逆） | 同上 | L1 |
| 15 | sub2api-admin · usage | `usage`（L0） | 只读（无确认条款问题） | L0，补契约字段 |
| 16 | task-workbench · list | take/complete/release/requeue/open（L1，同意门） | 首屏一刀切禁令（pages.tsx:133/150）；ListMeta 漏 writes | browse/drive 模式+同意门；L1；空态不说谎 |
| 17 | task-workbench · detail | take_page/complete/fail/abandon/split（L1） | 完成指令指向宿主全局 `task_complete/task_fail`（pages.tsx:223）——页面会话**不可达**（取证 §6） | 页面作用域 complete/fail 自挂；L1 |
| 18 | task-workbench · publish | `publish_task`（L1，同意门） | target 自我循环（actions.ts:96） | target 支持跨应用注册表目录；L1 |

九页 sub2api 全部补 `writes: true`（现状 9 个 meta 全漏——挂写工具不声明，
§3.9 交叉核对失效）。

## 6. 完成路径取证与一般处置（实现前置事实，2026-10-29）

**结论：页面会话里宿主全局 `task_complete`/`task_fail` 不可达。** 三条证据：

1. **注册面**：全局七件挂在 task-center 装配的宿主作用域
   （task-center/src/service.ts:104，`config.tools.enabled` 门）；页面会话的
   工具面 = 页面组件体在会话创建时登记的那份（应用概念 §3.4.2"工具只在页面
   存在"设计律），两条注册路径不相交；
2. **真机清单**（AGENTS.md 稳定节点清单第 4 条，2026-10-21 实测）：list 页会话
   只见 `task_workbench__take_task` 系、detail 页只见
   `abandon_task/complete_task/split_task/take_page_task` 系；person-agent
   overview 页曾"一个工具都没挂"——页面会话默认零工具；
3. **后果**：DetailMeta 现行说明句（pages.tsx:223）让模型对投递任务"走宿主
   全局的 task_complete/task_fail"——模型在页面会话里根本没有这两个工具，
   投递闭环在最后一步断裂（§5.3 闭环的第 5 环）。

**一般处置（不新增宿主机制）**，按页面角色分两型：

- **任务工作台自页**（行 16–18）：本应用自己的动词面已自足——
  `complete_task` 直接结算任务中心记录（summary 必填 = 完成证据）；失败出路 =
  `abandon_task` 回 open 队列 / `requeue_task` 退回改派，租约到期由中心懒回收
  兜底。记录终态机查（result/failure），不悬置。
- **普通投递目标页**（forum/notebook，行 1–6）：挂 task-center 导出的
  `buildPageTaskTools`——`task_take`/`task_complete`/`task_fail` 三件
  **页面作用域**工具（目标 URL 即本页、无 id 参数可伪造、接取者校验互斥）。
  名字与全局面**逐字相同是刻意的**：TASK 块与收件箱通知的既定指引（"接取用
  task_take…完成后调用 task_complete"）因此在页面会话里逐字为真，模型无需
  第二套词汇。机制实现：task-center/src/page-face.ts + 各应用装配
  （urlOfSession 走 page-registry 实例索引）；单测 task-center
  tests/page-face.spec.ts，跨应用闭环干跑 tests/page-delivery-dryrun。

## 7. 达标测试与变异敏感（实现前写好探针）

可复用检查器在 `@veren/test-support`（`page-contract.ts`）；各应用
`tests/contract.spec.ts` 喂自己的矩阵行。变异双向敏感要求：

- 拆 notebook delete 门（去掉 L2 条款/拒绝码）→ 红；
- 给 forum 加一刀切确认门（说明句出现"写前先向用户确认"类停摆措辞）→ 红
  （`assertNoUnattendedStall` 文本禁令）；
- 摘 task-workbench 详情页完成工具（工具面缺 complete/fail）→ 红
  （挂载面充分性断言）；
- `consentOf` 改恒真或摘同意门 → 首屏零写性质测试红。

## 8. 版本

行为变化的包各升 MINOR：`@veren/prompt-page`（契约字段类型）、
`@veren/task-center`（通知文本补任务 id 行）、`@veren/task-workbench`（队列
权威搬家 + 同意门 + 派发三件）、`@veren/sub2api-admin`（九页条款 + writes +
L2 门）、`@veren/notebook-app`（delete 无人出路）、`@veren/forum-app` /
`@veren/person-agent-app`（契约字段声明）。统一落 2.3.0。
