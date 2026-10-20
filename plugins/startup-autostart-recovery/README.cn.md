# @veren/startup-autostart-recovery

恢复被 DeepSeek Harness 异常退出打断的工作。当崩溃、进程被杀或断电后希望下次启动自动接续时使用本插件；重启总是正常收尾、或不想要恢复提示时不用。

## 它做什么

1. **异常退出检测。** 状态目录（默认 `$DSH_HOME/storages/startup-recovery/boot-flag.json`）里的启动标记文件在每次启动时写入（认领），只有正常收尾才删除。因此"下次启动标记还在"就等于上次进程没跑到收尾——包括被杀进程与断电这种根本跑不到清理代码的情况。首次启动没有标记，按干净处理。
2. **如实取原因。** 原因来自桌面崩溃日志目录（`%APPDATA%\@deepseek-ai\dsh-desktop\logs`，取比上次启动时刻更新的最新 `crash-*.log`）。没有任何日志能证明原因时，提示词原样写 `原因未知（未找到崩溃日志）`——插件绝不编造原因。
3. **恢复提示。** 检测到异常退出后，插件向它记录的最近活跃会话（经 `agent/created` 事件持久化到 `last-session.json`）直接投递 `DSH 系统由于 <真实原因> 退出后重启，请继续未完成的工作。`。投递发生在**本次启动过程中、由插件直接执行**，不经过启动项——创建或更新启动项本次启动不会触发。投递前先认领标记，因此一次崩溃至多恢复一次。
4. **Windows 登录自启动（默认关闭）。** 向每用户启动文件夹写入一个 `.cmd` 文件（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DeepSeek Harness (startup-autostart-recovery).cmd`）。不选 Run 注册表键与计划任务的理由：不需要管理员权限、只是普通文件、"文件存在即生效"最易验证。开启（`startupRecovery.enableAutostart()`）、查看（`autostart()`）、撤销（`disableAutostart()`）都是显式服务调用；插件绝不会自己写这个条目。开启时必须通过 `config.autostartCommand` 给出启动 DeepSeek Harness 的命令行，缺省则显式报错。

## 配置

| 字段 | 含义 |
| --- | --- |
| `stateDir` | 启动标记 / 最近会话记录目录覆盖。 |
| `crashLogDir` | 桌面崩溃日志目录覆盖。 |
| `autostartFolder` | 启动文件夹覆盖。 |
| `autostartCommand` | 启动 DeepSeek Harness 的命令行（仅开启自启动时必填）。 |
| `recoveryEnabled` | 恢复提示词本身的总开关（默认开）。 |

## 已知限制

- 最近活跃会话取的是 `agent/created` 最后报告的那个，包含子代理会话；不改宿主就无法用别的方式枚举会话。
- 投递失败只记录日志，本次启动不重试（至多一次语义）。

## 开发

```sh
pnpm --dir plugins/startup-autostart-recovery test        # vitest
pnpm --dir plugins/startup-autostart-recovery typecheck   # 对照 Harness 源码
pnpm --dir plugins/startup-autostart-recovery build       # 产出 dist/
```
