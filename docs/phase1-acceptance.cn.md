# 第 1 阶段验收报告（应用框架最小闭环）

[English](phase1-acceptance.md)（英文镜像待补）| 中文

**日期：** 2026-10-20
**验收依据：** [application-concept.cn.md](application-concept.cn.md) §8.1（八个场景）
**执行者：** 收尾会话 E（四条并行产线 A/B/C/D 完成后的对接与验收）

---

## 〇、真机验证补充（2026-10-21，稳定测试节点）

### 第三轮真机验证（2026-10-21 02:20–02:50，G13 显式接线修复后）

> 本小节是第三轮；以下「验证基线/安装与隔离/A–F」各段为第二轮记录，保留作对照。

**验证基线 = 主工作树 @ 提交 `e5756e0`（`54c9c69` 框架层拆探测 + `e5756e0` 应用层拆探测之后）。**
`pnpm -r --workspace-concurrency=1 test` 全绿（exit 0），直接采用当前工作树。

**安装与隔离（照配方执行）**：`scripts/pack-local-plugins.mjs` 重打 37 个 tarball（本次把
`startup-autostart-recovery` 补进打包清单——`7cb29f2` 新增该包后脚本未曾同步，上一轮的 tarball 因此
停在旧代码）；`pnpm install --force` 强制刷新 profile（同一 `file:` 路径下 pnpm 不会因内容变化重取，
"Already up to date / added 0" 是假象，必须核对安装产物 mtime 自证新代码落位）。装后自证：
`fsutil hardlink list` 对 `@veren\app-host\src\wire.ts`、`@veren\task-workbench\src\app.ts`、
`@deepseek-ai\cosmokit\LICENSE` 各只列出自身一个路径，零共享 inode；profile `node_modules\@veren` 下
23 个包零嵌套 `@deepseek-ai/cordis`、零嵌套 `dsh-*`——**cordis 双实例未发生**。

**A–F 逐项结果（宿主 `dsh web --port 3080 --no-open`，`pluginInventory/list` 返回 204 行、零
pending/failed）：**

| 项 | 结论 | 一句依据 |
| --- | --- | --- |
| A. 三服务 + 装配行 | **PASS** | inventory 中 `app-registry`/`page-registry`/`task-center`/**`app-host`** 四行全部 `active`；启动无任何 "waiting for inject" 告警。上一轮死在 `bindPorts` 守卫的装配行本轮激活，显式接线修复成立。 |
| B. 四应用注册 | **PASS（注册面）/ FAIL（目录工具）** | `forum`/`forum-ui`/`notebook`/`notebook-ui`/`person-agent-preset`/`person-agent-app`/`task-workbench` 七行全部 `active`（apply 无抛错＝register/pages 注册成功）；真实会话工具清单含 `forum_*`×6、`notebook_*`×6、`task_*`×7。但 `app_list`/`app_pages`/`app_open` 三个模型面工具**一个都不在**（见下）。 |
| C. `agent/created` 载荷形状 | **部分验证（替身假设一处证伪）** | 真实签名（`packages/core/agent/src/runtime-types.ts:261`）：payload = `{ agent: Agent; source: SessionStartSource; signal? }`，`agent`/`source` 键与替身一致；`agent.session` 真实存在（`Session`），`source` 取值 `startup`/`resume`。**但 `agent/created` 是运行时 serial 事件，不落会话日志**——清单 2"会话日志里看到载荷"的前提不成立；真实宿主消费它只能 `ctx.on`（app-host `session-port.ts:111` 即如此）。**清单 2 的观测方式已改**（AGENTS.md 同步）：探针插件 `ctx.on('agent/created', …)` 监听并把载荷写文件，不再是"看会话日志"。 |
| D. 工具作用域隔离 | **未验（被 app_open 缺失阻塞）** | 页面会话唯一创建入口是 `app_open`，工具不在场即无法创建页面会话。 |
| E. 任务通知落真实日志 | **未验（同被阻塞）** | `taskCenter.send` 无 remote 面，发送方也是应用侧/模型侧；通知投递目标页开不出来。 |
| F. 页面工具随会话释放 | **未验（同被阻塞）** | 同 D。 |

**本轮新暴露的失败点（与上一轮不同一层）：`registerAppOpenTool` 与 `createBootstrapTools` 在生产代码
里没有任何调用方。** 全仓 grep 证实：`plugins/page-registry/src/tools.ts:43` 的 `registerAppOpenTool`
只有定义与导出；`plugins/app-registry/src/bootstrap-tools.ts` 的 `createBootstrapTools` 只被
`tests/lifecycle.spec.ts` 引用。真实会话实测：要求模型调 `app_open`，模型回复 NO_APP_OPEN（工具清单
如上，确实没有）。因此**页面会话在真实宿主里不可创建**，`pageRegistry.openUrl` 只有测试能到达。
D/E/F 三项的阻塞根因是这一层，不再是 G13 的探测/守卫问题。

**与上一轮对比**：消失的失败——① `bindPorts` 属性代理守卫崩溃（装配行已激活）；② task-workbench 在
`apps.register` 前炸（七行全 active）；③ 半接线风险（本轮无回滚告警）。仍存在的失败——模型面目录/打开
工具缺失，属**装配遗漏**而非守卫问题。没有发现 cordis 双实例或 inode 共享回归。

**宿主与端口**：验完已关，`Get-NetTCPConnection -LocalPort 3080` 确认释放；验证用无头 Chrome（临时
user-data-dir）已全部结束，9222 不再监听。`~/.dsh` 零改动自证：递归扫描该目录 79307 个文件，全部
mtime ≤ 2026-10-21 02:19:57（本轮开始前），或为本 GUI 会话自身的日志——本轮没有任何命令指向它。

### 第四轮真机验证（2026-10-21 03:00–03:35，引导工具接线 + pageKey 命名空间修复后）

**验证基线 = 主工作树**（`fix(app-host)` 提交前的工作树；`pnpm -r --workspace-concurrency=1 test` 全绿）。
安装照配方：`scripts/pack-local-plugins.mjs` 重打 37 个 tarball → `dist-tgz` 同步 → profile
`pnpm install --force` + **删除 `node_modules\@veren` 强制重链**（同一 `file:` 路径 + 同版本号下
`--force` 不会因内容变化重取，必须核对安装产物内容自证新代码落位）；`fsutil hardlink list` 对
`@veren\app-host\src\wire.ts`、`@veren\page-registry\src\tools.ts` 各只列出自身一个路径，零共享 inode。

**本轮修复（两个，第二个是真机新暴露）**：

1. **引导工具注册缺失（第三轮失败点）**：`createBootstrapTools`（app_list/app_pages）与
   `createAppOpenTool`（app_open，由 `registerAppOpenTool` 收敛为纯本体工厂）由 app-host 装配在
   `wireAppHost` 的单个 effect 里 `ctx.tools.register`，注销器由装配持有，失败逆序回滚、卸载逆序摘除。
2. **真机新暴露——页面镜像的两个连带缺陷**：① 真实 Loader 按 inject 就绪**并发**激活行，应用插件
   （task-workbench）可能先于 app-host 装配注册页面，注册走了"只告警"分支，页面从此对 openUrl 不可见
   （单测 sequential boot 掩盖了这一点）→ 装配在镜像面就位后**回填**目录里所有应用的页面（幂等）；
   ② page-registry 按裸名登记页面，本地名（list/detail…）跨应用必然重名——notebook/list 先注册后，
   task-workbench/list 被吞 → 应用页改以 **pageKey（`<appId>/<本地名>`）** 为名登记
   （`PageRegistryService.registerAppPage`），幂等检查、审计、索引行同步对齐。

**A–F 逐项（真实宿主 `dsh web --port 3080 --no-open` + CDP 无头 Chrome 驱动真实模型会话）**：

| 项 | 结论 | 一句依据 |
| --- | --- | --- |
| A. 服务 + 装配行 | **PASS** | 启动无 "waiting for inject"；app-host 激活且三个引导工具全部出现在真实会话工具清单（模型实测调用成功）。 |
| B. 应用注册 + 目录工具 | **PASS** | 真实会话实测：`app_list` 返回 active 应用目录；`app_pages` 返回 task-workbench 3 页；`app_open` 成功创建页面会话。 |
| C. `agent/created` 观测 | **PASS（改法生效）** | 观测方式已改为探针 `ctx.on` 监听（AGENTS.md 清单 2 已同步改写）；消费面 `session-port.ts` 的 `ctx.on('agent/created')` 在真实宿主按预期工作（页面工具入队/挂载路径活跃）。 |
| D. 工具作用域隔离 | **PASS（间接）/ GUI 入口缺** | 创建者会话实测工具清单 52 个，**零** `task_workbench__*` 页面工具——页面工具没有泄漏进兄弟会话；页面会话级互斥已由 `assembly.spec.ts` 真实 cordis 子上下文测试覆盖。页面会话本身尚不能从聊天 UI 进入（H 阶段 GUI 入口），逐会话问答留待 GUI。 |
| E. 任务通知落真实会话 | **FAIL（阻塞点明确）** | `app_open` 的 taskId 接取路径在真机执行（`taskId=nonexistent` 返回 `task not found`，接取真实发生）；但**端到端不可验**：真实宿主没有可达的任务发送方（`task_list` 为空；`publish_task` 只挂在 publish 页会话上，而页面会话在 GUI 里尚不可进入 → 没有任何 agent 能执行发送），投递泵无料可泵。补齐 H 阶段的页面会话入口后同一配方可直接复验。 |
| F. 工具随会话释放（重开新建） | **PASS** | 同 URL 重开 `/apps/task-workbench/task/1` 返回全新 sessionId（`ea3d5e75…`，与旧 `8031b2b1…` 不同）；磁盘 `app_pages.json`：live 行指向最新会话，旧 sessionId 行 `state=deprecated`（notebook 重开同样验证）。 |

**宿主与端口**：验完已关；`Get-NetTCPConnection` 确认 3080/9222 均无监听；验证用无头 Chrome
（临时 user-data-dir）进程与临时目录已清理。`~/.dsh` 零改动自证：递归 79311 个文件数量与本轮基线
一致（零新增），期间仅桌面实例自身在会话开始时刻（02:40:08）写的日志/workspace 文件有 mtime 变化
——本轮没有任何命令指向 `~/.dsh`。

### 第五轮真机验证（2026-10-21 03:33–03:55，E 阻塞点专项复核）

**目的**：复核第四轮 E 项"publish 页不可达"的判定。结论：**该判定中"页面会话不可进入"的说法要收窄——
publish 页本身在真机上 `app_open` 完全可达，阻塞点只剩"页面会话的 agent 没有任何激活入口"（GUI 入口，H）。**

真机证据（源码重建 9 gates 全过 → `dsh web --port 3080 --no-open` + CDP 无头 Chrome 驱动真实模型会话）：

1. 普通会话实测：模型调用 `app_open /apps/task-workbench/publish` **成功**，返回
   `{"sessionId":"21c7a34c-…","url":"/apps/task-workbench/publish","title":"发布任务"}`；磁盘
   `app_pages.json` 出现该 URL 的 `state=live` 行，`page=task-workbench/publish`、`pageRevision=2`。
2. `app_pages` 返回 publish 页且声明工具 `task_workbench__publish_task`——**"页未注册"（原因 1）与
   "工具漏列"（原因 2）均排除**；URL 解析正常，**"URL 规范化不一致"（原因 3）排除**。
3. 但调用方会话工具清单里**没有任何** `task_workbench__*` 工具（作用域隔离，符合设计——页面工具只挂
   页面会话自己的 agent）。页面会话已创建，可它的 agent 依赖"用户进入会话"（`session-port.ts` 的
   `agent/created` 队列）才激活，而 GUI 侧栏不显示页面会话、服务器对 `/apps/*` 与 `/session/<id>`
   均 404（无 SPA fallback，页面会话无 GUI 入口）——**没有任何 agent 能执行 `publish_task`**。
4. 无代码可修：注册、装配、URL 解析全部正常，缺的只是 H 的 GUI 入口；本轮零代码改动。

**对"普通人怎么发出第一条任务"的回答（如实）**：当前真实宿主里**没有一条可走的路径**。设计上的第一条
路径是：GUI 打开 `/apps/task-workbench/publish` 页面会话 → 在该会话里让模型调 `task_workbench__publish_task`。
这条路径的第一步就是 H（工具栏应用入口/页面会话 GUI 入口）。**E 的结论由"阻塞于无发送方"精确化为
"E 阻塞于 H"。** 补齐 H 后，第四轮的同一配方可直接复验 E。

**宿主与端口**：验完已关，3080/9222 均无监听；无头 Chrome（临时 user-data-dir）已结束并清理。
`~/.dsh` 零改动自证：本轮所有命令只指向源码检出与 `deepseek\.dsh`；递归扫描 `~/.dsh` 近 3 小时
mtime 变化的 40 个文件全部是 54224 桌面实例自身写的会话日志/配置（含本 GUI 会话自己的日志）——
验证命令没有产生其中任何一条。

### 第二轮真机验证（2026-10-21 凌晨，探测式对接被证伪的一轮）

**验证基线 = 主工作树 @ 提交 `c243aa6`（含并发会话对 page-registry/task-workbench 等的在改内容）。**
确认方式：在基线上跑 `pnpm -r --workspace-concurrency=1 test`，全绿（exit 0，无任何 Test Files 失败），
按预定规则直接采用当前工作树，未启用 `git worktree` 回退。

### 安装与隔离（按 AGENTS.md「稳定测试节点」配方执行）

- profile `deepseek\.dsh\profiles\web` 的 `pnpm-workspace.yaml` 已含 `storeDir`（profile 内专用
  `.pnpm-store`）与 `packageImportMethod: copy`（pnpm 11 从本文件读，不读 `.npmrc`）；`.npmrc` 只留
  registry/authToken。
- 打包：`scripts/pack-local-plugins.mjs`（本次把 person-agent 七个包补进打包清单）产出 36 个 tarball，
  成员 `workspace:^` 依赖改写为同目录 `file:` tarball 引用；安装 `dsh plugin --profile web add` 装入
  `app-host-bundle`、`task-workbench`、`forum-bundle`、`notebook-bundle`、`person-agent-bundle` 五个包。
- **cordis 双实例：未发生。** profile `node_modules` 内 `@veren/*` 全部 23 个成员包下面零嵌套
  `@deepseek-ai/cordis`、零嵌套 `dsh-*` 包（递归枚举自证）；真机堆栈显示插件代码与宿主走的是同一份
  `vendor/cordis`。此前担心的"junction 安装导致 Service 基类跨实例、Loader 静默不激活"没有复现——
  tarball + file: 依赖的安装方式天然规避。
- inode 隔离自证：`fsutil hardlink list` 对 profile 内
  `@veren\task-workbench\src\index.ts`、`@veren\page-registry\src\service.ts` 与 harness
  `packages\client\modules\lib\client.js` 各只列出自身一个路径，**无任何 `\.dsh\profiles\desktop` 或
  `C:\Users\imeep\.dsh` 路径**。

### A–F 六项真机结果

宿主以 `dsh web --port 3080 --no-open`（源码构建 9 项 gates 全过）启动，客户端经 CDP 无头浏览器实测可
登录、可渲染。

| 项 | 结论 | 一句依据 |
| --- | --- | --- |
| A. 三服务可解析 | **PASS（服务本体）/ FAIL（装配层）** | 启动日志与堆栈证明 `apps`/`pageRegistry`/`taskCenter` 三个 Service 实例全部激活（app-host 的 `requireFaces` 三者都拿到了）；但装配行 `app-host` 本身在 `bindPorts` 处抛错未激活（见下），会话端口没接上。 |
| B. 应用目录四应用 active | **FAIL（1/4）** | `forum`/`notebook`/`person-agent` 三行激活无错误；`task-workbench` 行因 `ctx.get('taskCenter')` 触发真机 inject 守卫在 `apps.register` 之前就抛错，整个应用（定义+工具+页面）都没注册成。 |
| C. `agent/created` 真实载荷形状 | **未验（被 A/B 阻塞）** | 装配层没接上真实会话端口，页面会话起不来，无法在真实宿主里产生该事件；替身假设与真实载荷的差异本轮拿不到样本。 |
| D. 工具作用域隔离 | **未验（被 A 阻塞）** | 同上：agent 作用域工具挂载依赖 `pageRegistry.bindPorts` 的真实会话端口。 |
| E. 任务通知落真实会话日志 | **未验（被 A/B 阻塞）** | 投递泵跑在页面会话创建/恢复路径上，页面会话不可创建则无法观测。 |
| F. 页面工具随会话释放 | **未验（被 A 阻塞）** | 同 D。 |

**明确跳过**：「重开同一 URL 回到原会话」语义已被 §9.1 反转（每次打开新建、旧的废弃），本轮不验。

### 真实宿主暴露的替身假设错误（本轮最有价值的产出）

1. **「`ctx.get('serviceName')` 不需要 inject」在真机不成立。** 两处独立踩中，均为同一根因：
   - `task-workbench` 的 `createTaskChannel`（`src/app.ts:58`）用 `ctx.get('taskCenter')` 做"缺席即
     降级"，真实 cordis 对**服务名**的 `ctx.get` 同样走属性代理守卫，直接抛
     `cannot get property "taskCenter" without inject`——替身里这条降级路径测的是"服务不存在"，而真机
     上根本到不了"不存在"那一分支，先死在守卫上；
   - `page-registry` 的 `hostPorts`（`src/service.ts:73` 等四个 getter）用 `ctx.get('apps')` /
     `ctx.get('taskCenter')` 做可选端口探测，注释明言"不走属性代理（那需要 inject）"——这个前提
     本身是错的，真机上就是属性代理、就是要求 inject。
   修正方向（**本轮只报告不修**，page-registry/task-workbench 正被并发会话修改）：要么给这两个插件
   显式声明 `inject` 并把"可选降级"改为 try/守卫式探测，要么宿主装配层把这三个面作为参数传入、
   插件自身永不触碰兄弟服务。
2. **「属性守卫按当前 fiber 的 inject 归因」的假设不成立。** `app-host` 自身 `inject` 了三个服务，
   从它的 `apply` 里调 `pageRegistry.bindPorts(...)`，守卫仍然抛错——归因跟的是**被访问 ctx 的属主
   插件**（page-registry 未声明 inject），不是调用方。装配层"替兄弟服务摸兄弟服务"的松对接写法在
   真机 Loader 下全部不可用。
3. **装配顺序的脆弱面得到实证**：`app-host` 的 `apply` 前两步（`setAppResolver`、`setPageMirror`）
   已执行、第三步才炸——若 cordis 不回滚直接变更，宿主会带"半接线"状态继续运行（任务 resolver 与
   页面镜像面在、会话端口不在）。装配层应把全部接线收进 `ctx.effect` 以获得回滚语义。
4. **上轮遗留的 profile 补丁引用已删除的探针包**（`@veren/app-host-verify` 行与依赖项），宿主带着它
   不会报错但属于死配置——本轮已从 `cordis.patch.yml` 与 profile `package.json` 清除。

### 未验清单与原因汇总

- C/D/E/F 四项：全部被 1/2 两条真机错误阻塞；待 page-registry（inject/守卫）与 task-workbench
  （taskCenter 通道）修复后，同一套节点与流程可直接复验。
- `pnpm-workspace.yaml`/`.npmrc`、`cordis.patch.yml`、profile `package.json` 的本轮修改只落在
  `deepseek\.dsh\profiles\web`（稳定测试节点内，不进 git）。


> **历史记录注记（2026-10-21，§9.1 决策反转）。** 本文是按"重开同一 URL 复用原会话"旧设计
> 写下的验收快照。该决策已被用户放弃：打开 URL 一律新建会话、旧会话废弃（§3.5.3、§9.1.1）。
> 文中场景 3/8 的"回到原会话/重装可恢复"表述与缺口 4 的 `hasTools` 恢复路径均已被新语义
> 取代——对应场景已按新语义重写在 `acceptance.spec.ts`（现 9 个场景），本文其余结论仍然成立。

---

## 一、四个已知缺口的修复情况

| 缺口 | 结论 | 说明 |
| --- | --- | --- |
| 1. 任务通知投不出去 | **已修** | page-registry 增加投递泵（`pumpDeliveries`）：页面会话**创建或恢复**时调 `taskCenter.pendingDeliveries()`，把渲染好的通知文本作为用户消息注入会话，随后逐条 `markDelivered`（成功翻 `delivered`，失败保持 `pending` 并记原因）；投递泵自身失败只降级，不阻塞页面打开。端到端测试（acceptance 场景 6）证明：发任务 → 通知进会话 → 文本含标题与规范 URL → 带 taskId 打开即接取 → 完成后应用收到 `task/completed`。 |
| 2. 应用禁用/卸载没有执行者 | **已修** | task-center 增加默认 resolver（结构探测宿主 `ctx.apps`，零配置；`setAppResolver` 仍可显式覆盖）：`apps` 服务缺席 → 维持旧的"只告警放行"；应用未注册/禁用 → `send` 以 `task/send-forbidden` 拒绝。卸载语义用**懒孤儿判定**：sweep 时 resolver 查不到的应用，其 open/taken 任务翻 `orphaned`——进程关停/重启不会误伤（重启后应用重新注册即愈合）。`openUrl` 侧的 `app/disabled`、`app/not-found` 由 page-registry 原有投影保证。 |
| 3. 页面注册两条平行路径 | **已修** | 收敛为**单入口**：`ctx.apps.pages(id).register()` 内部通过页面镜像面自动写进 page-registry；镜像失败回滚应用侧登记并原样抛错（构造上消灭"目录可见却无法 openUrl"的漂移）。`pageRegistry.registerAppPage` 降为内部原语；`pageRegistry.auditAppPages(apps)` 作为一致性审计面兜底。task-workbench 参考实现已删掉手写镜像（README 同步更新，§3.1 已补记）。 |
| 4. 工具释放是空操作 | **部分已修（能验的都验了）** | ① 会话端口 `mountTools` 现在按会话记录整组注销器，`releaseTools`/`destroy` 真实摘除，测试证明会话销毁后工具不再可见；② 恢复路径增加 `hasTools` 探测 + 缺席重挂（卸载→重装后工具恢复，场景 8）；③ `reserved` 残留行启动清扫已实现（`KvPageInstanceIndex.sweepReserved`，依赖会话存活探测；确认不了就不删，不假装）。**未做、如实标注为第 2 阶段**：索引丢失后的重建扫描——第 1 阶段会话端口没有"枚举会话/读 `app/page` 事件"的面，做不了真实重建（§3.5.4 已注明）。另注：本阶段工具注册落在宿主 `tools` 注册表 + 按会话显式释放；"只对本会话 agent 可见"的作用域隔离要等真实 agent 作用域接线（第 2 阶段宿主装配）。 |

## 二、§8.1 八场景逐条结论

验收测试：[plugins/task-workbench/tests/acceptance.spec.ts](../plugins/task-workbench/tests/acceptance.spec.ts)（16/16 通过）。场景 2/3/4/8 使用**真实持久化文件**：真实 storage 栈（json backend）落在临时目录，会话目录是落盘 JSON；"重启" = 整个 Context（含存储栈）销毁后在新 Context 上重开同一目录，无内存假替身。

| # | 场景 | 结论 | 一句原因 |
| --- | --- | --- | --- |
| 1 | 装示例应用 → 可发现、入口可解析、预设零新增 | **PASS** | `app_list` 目录含 active 的 task-workbench，`/apps/task-workbench/list` 可被 openUrl 解析；装配里不存在 presets 服务，四个插件无任何预设注册路径。 |
| 2 | /task/1 → 会话 A；/task/2 → 会话 B；A 不变 | **PASS** | 两条 URL 两条会话、PAGE 块各写一次、工具互不影响、标题「任务 #1」正确。 |
| 3 | 关闭应用再重开 / 重启后打开 /task/1 → 回到 A | **PASS** | 整机真实重启（存储栈销毁重建同一目录）后索引命中同一 sessionId，工具按 §7.5 重新挂载。 |
| 4 | 删除会话 A → /task/1 重建新会话 | **PASS** | 落盘会话目录里 A 标记死亡，索引行失效重建会话 C，工具正常挂载。 |
| 5 | 两个应用同名工具 → 前缀共存 | **PASS** | `task_workbench__complete_task` 与 `other_app__take_task`（同名本地名 take_task 分属两应用）同时可见，互不覆盖。 |
| 6 | 发任务 → 通知进会话 → app_open 接取 → 完成 → `task/completed` | **PASS** | 通知文本含标题/URL，接取写 TASK 块，完成后应用侧事件载荷带 taskId/appId/result/sessionId。 |
| 7 | 过期任务 → `task/expired`；禁用应用 → `app/disabled` | **PASS** | 懒过期判定翻 expired 后打开被拒；`apps.disable` 后 openUrl 被拒；禁用应用 `send` 亦被拒（`task/send-forbidden`）。 |
| 8 | 卸载 → 工具摘掉、会话保留、任务 `orphaned`；重装可恢复 | **PASS** | fiber 销毁后镜像清理器摘掉该应用全部页面工具；会话仍存活；任务被懒孤儿判定翻 orphaned；重装后同一 URL 回到原会话且工具重挂。 |

**场景 1 的诚实备注：** "预设选择器没有新增条目"在本阶段测试中以"装配中不存在 presets 服务 + 四个插件源码无预设注册调用"验证（代码面核对，非 GUI 观测）；真实宿主 GUI 观测留待第 2 阶段客户端接线时复核。

## 三、全仓测试与 typecheck（如实）

- `pnpm -r --workspace-concurrency=1 test`：**全绿**（约 440 个用例，exit 0，含本次新增的 page-registry 4 个、task-center 3 个、app-registry 3 个、task-workbench acceptance 8 个）。
- `pnpm -r typecheck`：唯一失败是 `@veren/im`（`tests/intake.spec.ts` 两处 TS2769）——**既有红，与本次无关，未顺手修**。其余包（含本次改动的五个）全部通过。
- `pnpm run check:plugins`：**既有红，与本次无关**：`page-sync-bench` 的 peer `@deepseek-ai/dsh-tools` 区间应为 `>=0.2.1-rc.2 <0.3.0`（现为 `>=0.2.1-rc.2`）；按约定未改 `plugins/page-sync-bench`。
- `pnpm-lock.yaml`：A/B 遗留的 `plugins/app-registry`、`plugins/task-center` 两个 importer 块与各自 package.json 逐一对应、无重复无错乱，**保留未动**。

## 四、文档同步

- `application-concept.cn.md`：
  - §3.1 补记页面注册单入口镜像形态（缺口 3 的最终形态）；
  - §3.2 入口缺失语义改为实现取态（标 broken、不抛宿主启动、注册后自动愈合）；
  - §5.2 投递钩子改为已实现的投递泵描述；
  - §5.6 补齐 `task/not-claimant`、`task/invalid-state`、`task-center/storage-unavailable`、`page/url-invalid`、`page/index-conflict`、`page/host-unavailable`，并注明**冻结常量表是权威**（`AppErrorCode`/`TaskErrorCode`/`PageErrorCode`，含 `task/not-found`、`task/send-forbidden` 等更多码）；
  - §3.5.4 标注 reserved 清扫已实现、重建扫描未实现（第 2 阶段）；
  - §8.1 补第 1 阶段完成状态与本报告链接。
- `plugins/task-workbench/README.md` / `README.cn.md`：应用作者流程改为单入口注册（第 3 步）。英文镜像文档（application-concept.md 等）**未同步**，属后补项。

## 五、未完成与风险

1. **索引重建扫描未实现**（缺口 4 的剩余面）：需要宿主暴露"枚举会话 + 读会话日志"的端口面；当前索引损坏时只能靠 reserved 清扫 + openUrl 删行重建兜底，全量重建归入第 2 阶段。
2. **页面工具的会话作用域隔离**：工具挂在宿主 tools 注册表 + 按会话整组释放，"只对本会话 agent 可见"要等真实 agent 作用域装配（第 2 阶段）。
3. **`orphaned`/索引行状态在存储 schema 中不完整**：索引行 state 枚举只有 `reserved|live`（§3.5.2 设计中的 `orphaned|stale` 落地为"行保留原状态"，卸载后重开走会话存活探测与重挂，未单独落 orphaned 状态位）。
4. **场景 1 的预设零新增是代码面核对**，非真实 GUI 观测（见上）。
5. 英文镜像文档未同步；`@veren/im` 与 `page-sync-bench` 的既有红未处理（按约定）。

## 六、下一轮最该做的头三件事

1. **宿主装配层（composition）**：把 apps/page-registry/task-center/task-workbench 以真实 Loader 行装进 web profile，用真实 DSH 会话与 agent 作用域替换验收测试里的文件替身——工具作用域隔离、GUI 聚焦（focus）、`wake` 投递都在这一步才能落地。
2. **GUI 入口（§8.2 第 2 阶段主体）**：工具栏应用下拉 + 侧栏应用分组 + Web 收件箱；同时补索引重建扫描所需的宿主会话枚举/日志读取面。
3. **权限与升级语义硬化**：`requires` 能力从"记录"变"强制"（挂载时逐工具校验），`pageRevision` 升级的 stale 流程（旧会话只读 + 重建选择）目前只有 `page/stale` 拒绝，没有 UX。

## 七、设计是否站得住（一句判断）

站得住：八场景在真实持久化上全部走通，说明"应用 → URL → 会话 → 动态工具 → 任务 → 回报"的核心闭环不需要改设计；但真实代码暴露出一个设计低估的成本——**四个服务之间全是"结构探测 + 惰性端口"式的松对接（resolver、镜像面、投递面、工具目录），每一条接缝都要靠收敛会话逐个接上才有真实行为**，第 2 阶段应把这层"宿主装配"变成显式的单一组件，否则每装一个新应用都要重走一遍本次的对接工作。
