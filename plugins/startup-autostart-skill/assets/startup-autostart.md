# 启动项（Startup Autostart）

启动项是 DeepSeek Harness **每次启动成功后自动执行的一件事**。它不是定时任务，也不是“这一次顺手做掉”。

这份技能回答六个问题：什么时候该建、四个动作怎么选、运行规则有哪些坑、输入边界在哪、动手前先看什么、失败了怎么解释和补救。

## 1. 先判断：该不该建启动项

只有一条判断标准：**用户要的是「每次 DSH 启动都自动做同一件事」**。

应该想到启动项的说法：

- 中文：「以后每次都……」「每次都要……」「开机就……」「每次启动都……」「重启后自动继续」
- 英文：every time / whenever DSH starts / each launch / on every boot

不该建启动项：

- 一次性任务，或只是这次会话要做的活：直接做，不要注册。
- 按钟点或间隔执行（「每天 9 点」「每 30 分钟」）：那是定时任务（`@deepseek-ai/dsh-schedule`），不是启动项。
- 用户只是问「启动项是什么」「这功能怎么用」这类概念问题：先解释，不要动手建。

拿不准就问一句：**这件事是每次启动都要发生，还是只做一次？**

## 2. 动手之前：先看已有的

1. 先调用 `startup_list`。它只读，**绝不会启动任何会话**，可以放心调用。
2. 用户说「再建一个」之前，确认列表里没有同名或同目标的项。同一件事要改就用 `startup_update`，不要建重复项。
3. 用户说「关掉/删掉那个」时，从列表里拿**准确 id**，不要凭名字猜。
4. Web 界面的「启动项」页和 `startup_*` 工具读写的是**同一份存储**：用户在页面上改过，`startup_list` 立刻能读到；模型改完，页面也会收到通知刷新（能否实时刷新取决于该 profile 是否把变更事件转发到浏览器）。两边都算数，不要假设只有自己这一侧在改。

## 3. 四个动作怎么选

| 动作 | 做什么 | 什么时候用 |
| --- | --- | --- |
| `new_session` | 在 `cwd` 或 `workspace_id` 新建一个会话；给了 `message` 就把 `message` 作为它的第一轮 | 每次启动都要开一个固定任务 |
| `resume_session` | 只把已有 `session_id` 唤醒（载入），**不带任何话** | 只是想让某个会话在启动后回到活动状态 |
| `message_session` | 唤醒已有 `session_id`，并把 `message` 作为**新一轮**送进去 | 要它立刻看到并开始做 |
| `queue_message` | 把 `message` 放进已有会话的**收件箱**，**不唤醒** | 只留话，等它下次自己运行时再读 |

`queue_message` 和 `message_session` 的差别是这套功能最容易误判的地方：

- `queue_message` 之后目标会话仍然是静止的，**不会自己动**。用户如果期待「它现在就去做了」，要用 `message_session`。
- 用户说「下次它运行时告诉它……」→ `queue_message`。
- 用户说「现在让它继续做 / 开始做」→ `message_session`。
- 不要对用户说「我已经让它开始了」。准确说法是：「话已经放进收件箱，等它下次运行时会看到」。

另外两条硬规则：

- `resume_session` **不接受** `message`，给了会被 `invalid_message` 拒绝；要带话请用 `message_session` 或 `queue_message`。
- `message_session`、`queue_message`、`resume_session` 都必须给 `session_id`；只有 `new_session` 用 `cwd` 或 `workspace_id`。

## 4. 运行语义：这些坑要先说清楚

- **每次成功启动都跑，没有防抖、没有去重、没有排队。** 每个 `enabled` 的项在每次成功启动都会执行一次；不是「攒着一次跑」，也不是「上次没跑完就跳过」。
- **重启会打断上一次启动开始的工作。** 上一次启动拉起或唤醒的会话如果还在跑，重启就把它打断；下一次启动会再跑一遍这一项。所以 `message` 要写成**可重复执行**的指令，不要写「只做这一次」的措辞。
- **重新挂载这一行也算一次新的启动**：HMR 重载、重装、Loader 树写回都会让这一项再跑一遍。
- **`enabled` 是唯一的门。** 关掉的项永远不会自己跑。`startup_run` 对停用项会返回 `item_disabled`；确实要跑一次就显式传 `force: true`。
- **运行历史不做门禁。** `lastRunAt`、`lastOutcome`、`runCount` 只是记录：上次失败不会阻止下次，上次成功也不会让下次跳过。
- 每次投递的消息会自动带 `[STARTUP AUTOSTART]` 抬头、启动项名称、id 和开始时间。目标会话靠这个抬头分辨「这是启动项说的」，而不是用户刚说的。
- 启动项存在 profile 存储里（`$DSH_HOME/storages/startup.json`），与项目目录、会话日志无关：删掉项目文件夹不会删掉启动项。

## 5. 输入边界

- `name`：创建时必填、非空，最多 **120** 个字符。
- `action`：创建时必填，只能四选一。
- `message`：`message_session` / `queue_message` 必填，最多 **8000** 个字符；`resume_session` 不允许；`new_session` 可选。
- `cwd` 与 `workspace_id` **互斥**：`new_session` 只能二选一，两个都给会报 `invalid_target`。
- `new_session` 的 `preset` 和 `workspace_id` 只有在 Web 应用（挂载了 session controller）里才解析得动。headless、ACP、SDK 这类 profile 里带这两个目标的项会在运行时记录失败，而不是悄悄降级；这类部署请改用 `cwd`。
- `update` 只改你给的字段，没给的保持原值；**改 `action` 会重新套用该动作的目标规则**：
  - 切到 `new_session`：`session_id` 被丢弃；`cwd` / `workspace_id` 保留，互斥规则仍要满足。
  - 切到 `resume_session` / `message_session` / `queue_message`：`cwd`、`workspace_id`、`preset` 被丢弃。如果原项是 `new_session`（还没有 `session_id`），必须在同一次调用里补上 `session_id`，否则 `invalid_target`。
  - 切到 `resume_session`：原来的 `message` 会被清掉。
  - 所以「把 `new_session` 改成 `message_session`」要在**同一次调用**里同时给 `action` 和 `session_id`。

## 6. 失败怎么解释、怎么补救

工具返回结构化错误，不要笼统说「失败了」。

- `item_not_found`：id 不对，或这一项已被删除。先 `startup_list` 拿当前 id，确认用户说的是哪一项再操作。
- `invalid_target`：动作与目标不匹配。按第 3、5 节的规则补 `session_id`，或去掉多余的 `cwd` / `workspace_id`。
- `invalid_name` / `invalid_message`：名称空或超过 120，消息空或超过 8000。把内容压到限制内；不要为了缩短而删掉否定词、条件、数字或原文引用。
- `invalid_action`：只能从四个动作里选。
- `item_disabled`：这一项被停用了。要么 `update` 打开 `enabled`，要么 `startup_run` 带 `force: true` 说明「就这次跑」。
- `storage_unavailable` / `internal_error`：存储或投递层的问题，不是用户输入错。说清是哪一层，不要让用户反复改参数。

创建和更新时**不会**校验目标会话是否存在，`session_id` 打错要等运行时才暴露。用 `startup_run` 当场跑一次，再读返回的 `outcome`（以及列表里的 `lastOutcome`）：

- `status: "failed"` 的 `detail` 会说明是会话找不到、preset 解析不了，还是持久化没确认。
- 补救：从目标会话拿准确 id（不要拼），或改用 `new_session`；改完再 `startup_run` 验证一次。

## 7. 交付给用户的话

注册完用一两句说清：名称、动作、目标、是否启用、**下次启动会做什么**。建议顺手 `startup_run` 跑一次，把结果告诉用户——「下次启动才生效」和「现在已跑过一次」是两件事。
