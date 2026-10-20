# Person Agent 组合包

纯配置型 DSH 组合包（bundle），一步装好并组合完整的 Person Agent 技术栈：

| 成员插件 | 职责 |
| --- | --- |
| `@veren/person-agent-preset` | 注册 Person Agent 预设（人设 + 子行名册） |
| `@veren/person-agent-dynamic-context` | 工作记忆：按会话追加的动态上下文区块 |
| `@veren/person-agent-reanchor` | 定期重锚：连续多步只分析后追加一条很短的带数字提醒 |
| `@veren/person-agent-tool-session` | 会话维护工具（创建 / 改名 / 分叉 / 归档 / 置顶） |
| `@veren/person-agent-tool-workspace` | 工作区维护工具（创建 / 改名） |
| `@veren/person-agent-app` | 应用层：person-agent 应用，含 `/apps/person-agent` 下的工作台概览与工作区浏览 |

需要把整栈作为一个可安装、可一键启停的单元时使用本组合包；如果更想在自己的 patch 里逐行列出六个插件，则跳过它。

## 技术栈唯一的 bundle 层

五个成员插件都以**普通依赖**发布——不声明 `dsh.bundle.patch`，也不携带 `cordis.patch.yml`。因此 `dsh plugin add` 之后，reconciliation 只会激活一个新层：本组合包的 patch。成员插件绝不可能在背后重复插行。

插入的预设行承担全部预设侧集成：预设定义本身把 `@veren/person-agent-dynamic-context`、`@veren/person-agent-reanchor`、`@veren/person-agent-tool-session`、`@veren/person-agent-tool-workspace` 组合为按会话挂载的子行，从 profile 的 `node_modules` 解析（pnpm 会把它们与组合包一并装进 profile）。另有一条**纯追加**的行激活 `@veren/person-agent-app`（应用层）；它不触碰预设行，因此它出错也不可能改变桥梁的运行行为。`tests/bundle.spec.ts` 守护这些不变量：一条预设行 + 一条追加应用行；成员不暴露 bundle。

## 一个预设、一种形态：桥梁

patch 只插入**一条预设行**。Person Agent 就是人类与 DSH 之间的桥梁，因此派活人设与两类维护工具常开——没有开关，也不再有第二行「管理员」划分。桥梁理解用户需求、判断工作区/预设/提供商与模型、创建工作会话，并汇报自己的选择理由。（另有一条独立的追加行把同一座桥梁暴露为应用；见成员表。）

之前选择了已下线的 `person-agent-manager` 预设的会话保持原锁定组成不变；新会话选 `person-agent`。

## 安装（测试节点）

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<测试节点目录>'
dsh plugin --profile web add <tarball 路径>
```

安装后组合包必须出现在 profile 的 `dsh.profile.bundles` 中；依赖会随之装进 profile，预设行与其按会话子行都能解析。

## 测试

```bash
pnpm --dir plugins/person-agent-bundle test
```

测试守护本组合包的不变量：patch 恰好插入一条桥梁形态的预设行（外加一条追加应用行）、没有任何开关；组合包是技术栈唯一的 profile 层——任何成员都不自带 bundle。
