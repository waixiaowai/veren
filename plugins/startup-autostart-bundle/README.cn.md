# 启动自启动组合包（Startup Autostart Bundle）

纯配置型 DSH 组合包，一步装好并组合完整的启动自启动技术栈：

| 成员插件 | 职责 |
| --- | --- |
| `@veren/startup-autostart` | 宿主服务：启动触发器、启动项存储、`startup` Remote 接口 |
| `@veren/startup-autostart-tool` | 面向模型的工具：智能体通过宿主服务管理启动项 |
| `@veren/startup-autostart-ui` | Web 界面：侧边栏"启动项"页面，与宿主服务通信 |

当需要把整栈作为一个可安装、一键启停的单元装进 profile 时使用本组合包。只需要无界面的宿主服务（单独装 `@veren/startup-autostart`），或想在自己的 patch 里逐行列装这三个插件时，请跳过它。

## 技术栈唯一的 bundle 层

三个成员插件都以**普通依赖**随行——它们都不声明 `dsh.bundle.patch`，也都不再携带 `cordis.patch.yml`。执行 `dsh plugin add` 之后，reconciliation 只会激活一个新的层：本组合包的 patch。成员插件绝不可能在背后重复插行。

patch 按依赖顺序插入**三行**：先 Host（拥有启动触发器、存储和 `startup` Remote 命名空间），再工具，再 UI。每行零配置——各成员自带默认值。`tests/bundle.spec.ts` 守护这两条不变量：三行有序且无配置，且任何成员都不暴露 bundle。

## 安装（测试 profile）

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<测试节点目录>'
dsh plugin --profile web add <tarball 路径>
```

组合包必须出现在 profile 的 `dsh.profile.bundles` 里；依赖随它一起安装，三行均按包名解析。

## 测试

```bash
pnpm --dir plugins/startup-autostart-bundle test
```
