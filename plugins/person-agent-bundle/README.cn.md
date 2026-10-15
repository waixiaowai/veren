# Person Agent 组合包

纯配置型 DSH 组合包（bundle），一步装好并组合完整的 Person Agent 技术栈：

| 成员插件 | 职责 |
| --- | --- |
| `@veren/person-agent-preset` | 注册 Person Agent 预设（人设 + 子行名册） |
| `@veren/person-agent-dynamic-context` | 工作记忆：按会话追加的动态上下文区块 |
| `@veren/person-agent-tool-session` | 会话维护工具（创建 / 改名 / 分叉 / 归档 / 置顶） |
| `@veren/person-agent-tool-workspace` | 工作区维护工具（创建 / 改名） |

需要把整栈作为一个可安装、可一键启停的单元时使用本组合包；如果更想在自己的 patch 里逐行列出四个插件，则跳过它。

## 工具策略：默认关闭，按 preset 显式开启

patch 插入了**同一 preset 插件的两行**，身份不同：

- `person-agent`（默认）—— `withWorkspaceTools: false`、`withSessionTools: false`。代理只阅读和汇报，不能创建、改名、归档、置顶会话/工作区。
- `person-agent-manager`（显式开启）—— 两个开关均为 `true`。只有会话在客户端选择器里**明确选中该预设**时，维护工具才会出现。

因此是否开启由会话选择的 preset 决定，而不是全局开关——已选择 `person-agent` 的既有会话不受任何影响。

## 安装（测试节点）

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<测试节点目录>'
dsh plugin --profile web add <tarball 路径>
```

安装后组合包必须出现在 profile 的 `dsh.profile.bundles` 中；依赖会随之装进 profile，两条 preset 行都能解析。

## 测试

```bash
pnpm --dir plugins/person-agent-bundle test
```

测试守护本组合包唯一的不变量：默认行的维护工具全关，只有 manager 行开启。
