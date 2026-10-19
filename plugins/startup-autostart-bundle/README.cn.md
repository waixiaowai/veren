# 启动自启动组合包（Startup Autostart Bundle）

纯配置型 DSH 组合包，一步装好并组合完整的启动自启动技术栈：

| 成员插件 | 职责 |
| --- | --- |
| `@veren/startup-autostart` | 宿主服务：启动触发器、启动项存储、`startup` Remote 接口 |
| `@veren/startup-autostart-tool` | 面向模型的工具：智能体通过宿主服务管理启动项 |
| `@veren/startup-autostart-skill` | 指导技能：什么时候该建项、四个动作怎么选、运行规则怎么表现 |
| `@veren/startup-autostart-ui` | Web 界面：侧边栏"启动项"页面，与宿主服务通信 |

当需要把整栈作为一个可安装、一键启停的单元装进 profile 时使用本组合包。只需要无界面的宿主服务（单独装 `@veren/startup-autostart`），或想在自己的 patch 里逐行列装这四个插件时，请跳过它。

## 技术栈唯一的 bundle 层

四个成员插件都以**普通依赖**随行——它们都不声明 `dsh.bundle.patch`，也都不再携带 `cordis.patch.yml`。执行 `dsh plugin add` 之后，reconciliation 只会激活一个新的层：本组合包的 patch。成员插件绝不可能在背后重复插行。

patch 按依赖顺序插入**四行**：先 Host（拥有启动触发器、存储和 `startup` Remote 命名空间），再工具，再指导技能，最后 UI。每行零配置——各成员自带默认值。`tests/bundle.spec.ts` 守护这两条不变量：四行有序且无配置，且任何成员都不暴露 bundle。

## 指导技能

技能行通过 profile 的 `ctx.skills` 注册表提供一条面向模型的技能 `startup-autostart`。这一行激活后的下一步，任何能看到 `skill` 工具的会话都会在技能目录里自动看到它；不需要按 agent 单独配置。路由文字会让它在「每次启动」类请求和「列出/新增/修改/停用/删除启动项」类请求时加载，并明确拒绝一次性任务、按钟点执行、以及只问「启动项是什么」的问题。

该行只注入 `skills`。没有这个注册表的 profile 会让该行保持 **pending**——绝不会让挂载它的启动失败。没有 `@deepseek-ai/dsh-tool-skill` 时技能仍然注册，但模型看不到。完整路由文字、会话级核对步骤，以及它和另外三个成员的关系见 [`../startup-autostart-skill/README.cn.md`](../startup-autostart-skill/README.cn.md)。

## 安装（测试 profile）

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<测试节点目录>'
dsh plugin --profile web add <tarball 路径>
```

组合包必须出现在 profile 的 `dsh.profile.bundles` 里；依赖随它一起安装，四行均按包名解析。

## 测试

```bash
pnpm --dir plugins/startup-autostart-bundle test
```
