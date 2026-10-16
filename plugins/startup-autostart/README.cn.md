# 启动自启动（Startup Autostart）

每次 DeepSeek Harness 启动完成后，自动执行你登记的启动项：新建会话、恢复会话、
唤醒会话去干活，或者只安静地留一条消息在收件箱。每条启动项都有自己的冷却窗口，
连续重启两次不会重复触发。

## 它是什么

一个宿主组合包，含两行：

| 行 id | 包入口 | 负责 |
| --- | --- | --- |
| `startup-autostart` | `@veren/startup-autostart` | 持久化启动项、启动触发点，以及日后管理面板要读的 Typert Remote 接口（`ctx.remote.startup`） |
| `tool-startup-autostart` | `@veren/startup-autostart/tool` | 面向模型的 `startup_*` 工具 |

两行可以拆开用：不想要工具的 preset 去掉工具行，只留触发。

## 什么时候用它

用在"每次启动都要做一次"的事情上：把某个会话热起来、给已有会话交代一句常驻指令、
或者留一条等它下次跑起来再读的消息。

按时间提醒（"每天 09:00"、"每 30 分钟"）请用 `@deepseek-ai/dsh-schedule`。
两者不共享存储、不共享工具名。

## 四种动作

| 动作 | 做什么 |
| --- | --- |
| `new_session` | 在 `cwd` 或 `workspace_id` 建一个新会话；给了 `message` 就作为它的第一轮投递 |
| `resume_session` | 把已有 `session_id` 拉起来；不带消息 |
| `message_session` | 恢复 `session_id` 并把 `message` 作为新的一轮投递，唤醒它 |
| `queue_message` | 恢复 `session_id`，把 `message` 放进收件箱但**不唤醒**它 |

## 存储

启动项存在 profile 默认存储后端的 `startup` 域里，文件是
`$DSH_HOME/storages/startup.json`。它与会话日志、与任何工作区目录都解耦：
删掉项目文件夹不会删掉启动项。

管理面板要读的是 `tables.items`：以 `startup-<uuid>` 为键的一条条记录，含冷却窗口、
上次执行时间、上次执行结果。

## 触发时机

两条路径，因为启动器的"启动成功"信号是可选的：

1. 启动器提供了 `ctx.appReady` 时，`onReady(...)` 提交后触发——它在整棵插件树挂载完成、
   表面开始服务之后才提交。提交之后再订阅会立即回调，所以 HMR 重载会让触发重新生效。
2. 完全没有启动器信号时，插件装载完成即触发。

两条路径都汇入"每个已激活服务只驱动一次"的闩锁，而持久的逐条冷却窗口是第二道兜底。
存储域打开失败、或 `appReady` 缺失，都降级为"记一条日志、功能静默"，
绝不让挂载它的 DSH 启动失败。

## 覆盖哪些 profile

服务只注入每个 profile 都有的能力：`agents`、`sessions`、`storageDomain`。
会话统一走核心 `ctx.agents` 注册表（`agents.create` / `agents.resume`），
和 headless runner 用的是同一套调用。

Web 应用的 `sessionController` 只在存在时用 `ctx.get` 取用，因为只有它能解析
`preset` 与 `workspaceId` 目标、并给活着的 Agent 装模型选择。headless、ACP、SDK 这几个
组合包都没有它——这正是它不能写成注入的原因：一旦写成硬依赖，插件在这几个 profile 里
会永远停在 pending。在这种 profile 里，目标写了 preset 或 workspace 的启动项会记为
一次"失败"，说明原因，而不是悄悄建一个比它要求的更普通的会话。

## 冷却窗口

`cooldownSeconds` 默认 `900`（十五分钟），可填 `60` 到 `604800`。所有触发起点都遵守它，
手动 `startup_run` 也一样，除非显式传 `force`。

默认十五分钟的含义：一个下午重启两次会合并成一次；隔天早上再启动就正常执行。
即使投递失败也会打上时间戳，所以坏掉的启动项不会刷屏。

## 构建与自检

```sh
node scripts/gen-tsconfig-paths.mjs   # 从检出仓库刷新 tsconfig.paths.json
node scripts/typecheck.mjs            # 源码与测试一起对着真实 Harness 源码做类型检查
node scripts/build.mjs                # 产出 dist/*.js
node node_modules/vitest/vitest.mjs run
```

运行时是纯 ESM JavaScript；TypeScript 是 `src/` 源码与 `tests/` 测试的编写语言，
通过 `tsconfig.paths.json` 对着 Harness 检出仓库自己的源码做类型检查。

`vitest.config.ts` 会在打包器的转换之前先把插件里的标准装饰器降级：打包器在默认
target 下会原样保留装饰器，Node 随后会把那个 `@` 当成非法字符。配置里跑的是和构建
完全相同的 `transpileModule` 选项，所以测试看到的产物与 `dist/` 一致。

`scripts/dump-session.cjs` 用来打印会话日志的事件；会话日志是 zstd 压缩、每次落盘一帧，
整文件解压只读得到第一帧。
