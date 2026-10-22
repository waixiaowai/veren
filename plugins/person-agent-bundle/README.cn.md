# Person Agent 组合包

纯配置型 DSH 组合包（bundle），一步装好 Person Agent。应用即整栈：patch 只插**一行**——`@veren/person-agent-app`。

| 依赖 | 职责 |
| --- | --- |
| `@veren/app-host-bundle` | 应用框架（应用注册表、页面注册表、任务中心、app-host 装配）——作为依赖带入，由它插入自己的框架行 |
| `@veren/person-agent-app` | 作为应用的 Person Agent：桥梁人设写在应用说明里，`/apps/person-agent` 下有工作台概览与工作区浏览两页 |

会话/工作区维护工具构建器（`@veren/person-agent-tool-session`、`@veren/person-agent-tool-workspace`）经应用的 peer/dev 依赖随行——它们是库，不是插件行。

需要把 Person Agent 作为一个可安装、可一键启停的单元时使用本组合包；如果更想在自己的 patch 里逐行列出应用行，则跳过它。

## 技术栈唯一的 bundle 层

各成员都以**普通依赖**发布——不声明 `dsh.bundle.patch`，也不携带 `cordis.patch.yml`。因此 `dsh plugin add` 之后，reconciliation 从本组合包只会激活一个新层：它的 patch，且只有一条应用行。成员绝不可能在背后重复插行。`tests/bundle.spec.ts` 守护这些不变量：恰好一条应用行；没有预设行；没有任何开关；成员不暴露 bundle。

## 一个应用、一种形态：桥梁

Person Agent 就是人类与 DSH 之间的桥梁。桥梁人设写在应用的 `instructions` 里（作为每个页面会话 PAGE 块的「应用说明」行渲染）；带数字的「停手派活」硬规则在概览页的页面说明里。会话/工作区工具与 `renhua` 写作技能挂进每个页面会话的 agent 作用域——普通会话一个都看不到。没有开关。

## 安装（测试 profile）

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<稳定节点目录>'
dsh plugin --profile web add <tarball 路径>
```

组合包必须出现在 profile 的 `dsh.profile.bundles` 里；它的依赖（框架组合包与应用）随之一起安装。

## 测试

```bash
pnpm --dir plugins/person-agent-bundle test
```

测试守护组合包的不变量：patch 恰好插入一条应用行、没有任何开关；组合包始终是技术栈唯一的 profile 层——成员不自带 bundle，工具构建器保持在应用身后的库形态。
