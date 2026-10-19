# @veren/startup-autostart-skill

启动自启动技术栈的**指导成员**：提供一条随包发布、面向模型的技能
`startup-autostart`，教智能体判断什么时候该建启动项、四个动作怎么选，以及
运行规则和失败码实际是怎么表现的。

这条技能回答过去只散落在工具参数描述里的问题：

- 什么时候该把一件事变成启动项？什么时候它只是一次性任务？
- `new_session` / `resume_session` / `message_session` / `queue_message`
  到底该选哪一个？
- 为什么重启后会再跑一遍？为什么没有防抖？
- 名称、消息的长度上限是多少？改动作后目标规则怎么变？
- 建或改之前应该先看什么？
- id 不对、会话 id 打错、项被停用时，怎么向用户解释和补救？

## 技能什么时候自动出现

本包只在 `ctx.skills` 上注册一个技能提供者；它不注册工具、不拥有存储、也没有界面。
它的 Loader 行生效之后：

1. profile 必须挂载技能注册表（`@deepseek-ai/dsh-skill`）。本包的行注入
   `skills`；没有这个服务时 Cordis 只会让这一行保持 **pending**，绝不会让挂载它的
   启动失败或变慢。
2. profile 必须挂载面向模型的技能出口（`@deepseek-ai/dsh-tool-skill`），才有会话
   技能目录和 `skill` 工具。没有它时技能仍然注册给其他消费者，但模型看不到。
3. 在能看到 `skill` 工具的任意会话里，下一步的会话技能目录就会列出
   `startup-autostart`，并带上下面这段路由描述。profile 内所有 agent 都能看到，不
   需要按 preset 单独配置。

移除这一行后，下一步目录里的条目就会消失；已存储的启动项一项都不会动。重载会重新
注册同一个提供者，不会留下重复项（注册贡献随行卸载，规格测试会验证这一点）。

## 路由描述

目录里携带的原文如下（494 个字符，在目录 500 字符预算内，所以「不该加载」的条件
不会被截掉）：

> Use when the user wants work to run at every DeepSeek Harness start ("每次都要", "以后每次都", "开机就"), or asks to list, add, change, disable, or delete their startup items. Covers which action fits (new_session / resume_session / message_session / queue_message) and the run rules: every enabled item runs on every successful start with no debounce, and a restart interrupts the previous start's work. Skip it for one-off work, clock-time scheduling, or a question that only asks what startup items are.

第一句点名「每次启动」类请求（"every start"、"每次都要"、"以后每次都"、"开机就"）
和管理类请求（列出 / 新增 / 修改 / 停用 / 删除）。最后一句是刻意写明的排除项：一次性
任务、按钟点执行（那属于 `@deepseek-ai/dsh-schedule`）、以及只问「启动项是什么」的
问题，都不该加载这条技能。**问四个动作有什么区别不在此列**——那正是正文要回答的。

## 安装

推荐安装聚合包：它把本包声明为依赖，并把它这一行和宿主、工具、UI 三行一起插入：

```sh
plugin_manager  install_bundle  target = @veren/startup-autostart-bundle@1.4.8
```

命令行等价写法：

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<测试节点目录>'
dsh plugin --profile web add <tarball 路径>
```

本包**不声明** `dsh.bundle.patch`。单独安装只会多一个依赖、不会插入 Loader 行。
想在自己的 patch 里手工组装，只插一行：

```yaml
- insert:
    - id: skill-startup-autostart
      name: '@veren/startup-autostart-skill'
```

它唯一的配置是 `{}`。

## 和另外三个成员的关系

| 成员 | 职责 | 本技能与它的关系 |
| --- | --- | --- |
| `@veren/startup-autostart` | 宿主：启动触发器、启动项存储、`startup` Remote 接口 | 技能讲的是宿主的真实规则（每次启动、无防抖、`enabled` 是唯一的门、四个动作）；它不拥有任何行为 |
| `@veren/startup-autostart-tool` | 面向模型的 `startup_*` 工具 | 技能是智能体**调用这些工具之前**该加载的判断；正文只提工具插件真实注册过的工具 |
| `@veren/startup-autostart-ui` | 列出、修改、运行、删除启动项的 Web 页面 | 技能明确告诉模型：页面和工具读写的是**同一份存储记录**，两边改动都算数 |
| `@veren/startup-autostart-bundle` | 整栈唯一的 profile 层 | 它把四个成员一起装好、一起激活 |

运行期本包只需要 `ctx.skills`，**不**导入宿主服务。宿主包是 **devDependency**，
只为让规格测试断言正文里的数字等于 `MAX_NAME_LENGTH` / `MAX_MESSAGE_LENGTH`，避免
出现第二份会漂移的常量。

## 在真实会话里核对

1. 把组合包装进一个一次性 profile，打开 **插件管理页**，确认
   `skill-startup-autostart` 这一行是**已激活**（组件显示为 **启动项技能**）。等待
   服务的行会在宿主日志里标成 pending on `skills`。
2. 新开一个会话。第一步就会带上 `<system-reminder>` 里的 `<available_skills>`，
   其中必须列出 `startup-autostart` 和上面的路由描述——不需要先问什么才会出现。
3. 用正向触发说一句，例如：*「以后每次 DSH 启动，都让这个会话提醒我检查昨天的
   构建」*。模型应当在任何 `startup_create` 之前先调用 `skill` 工具，参数
   `name: "startup-autostart"`；结果是一段
   `<skill_content name="startup-autostart">`。
4. 走确定性路径：消息以 `/startup-autostart` 开头。同一段 `<skill_content>` 会被
   直接注入，不经过工具调用。
5. 在新会话里试反向触发：*「帮我看看这个报错」*（一次性）和 *「启动项是什么？」
   （概念问题）都不该加载技能；*「每天 9 点提醒我」* 应改走定时任务。
6. 如果第 2 步看不到条目：确认 profile 挂载了 `@deepseek-ai/dsh-skill` 和
   `@deepseek-ai/dsh-tool-skill`，并确认本行是已激活而不是 pending。

## 开发

```sh
node scripts/gen-tsconfig-paths.mjs   # 从检出仓库刷新 tsconfig.paths.json
pnpm typecheck                        # 用真实 Harness 源码检查 src/ 与 tests/
pnpm build                            # 生成 dist/index.js
pnpm test                             # 注册表级规格测试
```

`tests/skill.spec.ts` 会挂载真实的技能注册表、列出目录、按名字加载技能、断言正文
覆盖每一条运行语义问题（包括与宿主一致的长度上限），最后卸载这一行，证明贡献被
移除。

## 模型体验（Model Experience）

行未激活时：不向模型请求写入任何内容。行激活后：每个会话多一行目录描述（即上面的
路由文字），加载技能时再进入约 4,000 字符的正文。加载会从那一刻起改变提示词前缀，
因此和其它技能正文一样有 KV-cache 影响。目录行只在目录内容真正变化时重发。

## 已知限制与后续工作

- **是指导，不是强制。** 不加载技能也能直接调用 `startup_*`；路由依赖模型对描述的
  匹配，`/startup-autostart` 是确定性入口。
- **正文与宿主常量可能漂移。** 规格测试把名称/消息上限钉在宿主导出上，但将来新增
  动作或运行规则时，必须在同一次改动里更新 asset。
- **没有人类界面。** 本包不提供页面或命令，人类界面由 UI 成员负责。
- **同名技能可以盖过它。** 注册表把项目级和用户级技能排在 bundled 技能前面，所以
  自带 `startup-autostart` 技能的工作区会用自己的版本替换这份指导。这是用户自写
  指导应得的优先级，不是缺陷。
- **注册表依赖固定版本。** `@deepseek-ai/dsh-skill` 固定在 `0.2.0-rc.2`，与整栈
  其余插件使用的发布线一致。
