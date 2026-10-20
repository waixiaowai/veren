# 把人设插件的会话工具升到 0.2.5（人工一次性操作）

这份改动做了两件事：新建会话不再接受 `cwd`，只认 `workspaceId`；不写 `workspaceId` 时，新会话自动落在"当前调用工具的那个会话"所在的工作区，两边都查不到就直接报错，不会再悄无声息地掉进未分组。

运行中的桌面端加载的是 `C:\Users\imeep\.dsh\profiles\desktop` 里的旧版 0.2.4，不是仓库里的代码。所以必须重装那一份才生效，而重装时桌面端必须完全退出——所以这一步只能由你手动做。

下面的命令都在**普通 Windows PowerShell 窗口**里执行（不是 DSH 里的终端）。`pnpm --dir` 用的是绝对路径，从哪个目录执行都行；`DSH_HOME` 只在当前窗口有效。

## A. 退出桌面端之前，先确认安装包在

```powershell
Test-Path 'C:\Users\imeep\Documents\cursour\dist-tgz\person-agent\veren-person-agent-tool-session-0.2.5.tgz'
```

返回 `True` 就可以继续。

## B. 完全退出桌面端（含托盘图标）之后，依次执行

```powershell
$env:DSH_HOME = 'C:\Users\imeep\.dsh'
```

```powershell
pnpm --dir C:\Users\imeep\Documents\cursour\deepseek\deepseek-harness dsh plugin --profile desktop add C:\Users\imeep\Documents\cursour\dist-tgz\person-agent\veren-person-agent-tool-session-0.2.5.tgz
```

安装完查一下版本，应该输出 `0.2.5`：

```powershell
(Get-Content 'C:\Users\imeep\.dsh\profiles\desktop\node_modules\@veren\person-agent-tool-session\package.json' -Raw | ConvertFrom-Json).version
```

然后冷启动桌面端（正常打开，按 Ctrl+R 刷新不算）。

## C. 装坏了怎么退回去

再次完全退出桌面端（含托盘），然后：

```powershell
$env:DSH_HOME = 'C:\Users\imeep\.dsh'
```

```powershell
pnpm --dir C:\Users\imeep\Documents\cursour\deepseek\deepseek-harness dsh plugin --profile desktop add C:\Users\imeep\.dsh_test_2\packages\veren-person-agent-tool-session-0.2.4.tgz
```

查版本，应该回到 `0.2.4`：

```powershell
(Get-Content 'C:\Users\imeep\.dsh\profiles\desktop\node_modules\@veren\person-agent-tool-session\package.json' -Raw | ConvertFrom-Json).version
```

那个 0.2.4 的包在 `C:\Users\imeep\.dsh_test_2\packages\` 下，我确认过它还在。如果以后清理掉了，改用 `@veren/person-agent-tool-session@0.2.4` 从 registry 装。

## 装完怎么知道真的生效了

开一个新会话，让它新建一个下属会话，看工具参数：`session_dispatch` 的 `newSession` 下面应该只剩 `workspaceId` 和 `agentPreset`，`cwd` 已经不见了。再试一次不指定 `workspaceId`，新会话应该出现在你当前所在的那个工作区分组里，而不是未分组。

注意：第 B、C 两节都会写 `C:\Users\imeep\.dsh`，只能在桌面端完全退出后执行。
