# Person Agent 组合包

纯配置型 DSH 组合包（bundle），一步装好并组合完整的 Person Agent 技术栈：

| 成员插件 | 职责 |
| --- | --- |
| `@veren/person-agent-preset` | 注册 Person Agent 预设（人设 + 子行名册） |
| `@veren/person-agent-dynamic-context` | 工作记忆：按会话追加的动态上下文区块 |
| `@veren/person-agent-tool-session` | 会话维护工具（创建 / 改名 / 分叉 / 归档 / 置顶） |
| `@veren/person-agent-tool-workspace` | 工作区维护工具（创建 / 改名） |

需要把整栈作为一个可安装、可一键启停的单元时使用本组合包；如果更想在自己的 patch 里逐行列出四个插件，则跳过它。

## 一个预设、一种形态：桥梁

patch 只插入**一行**。Person Agent 就是人类与 DSH 之间的桥梁，因此派活人设与两类维护工具常开——没有开关，也不再有第二行「管理员」划分。桥梁理解用户需求、判断工作区/预设/提供商与模型、创建工作会话，并汇报自己的选择理由。

之前选择了已下线的 `person-agent-manager` 预设的会话保持原锁定组成不变；新会话选 `person-agent`。

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
