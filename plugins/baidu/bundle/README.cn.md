# @veren/baidu-pan-bundle（组合包）

百度网盘栈的 **组合包**：一个纯配置包，其 patch 按次序插入这套能力需要的两行 loader。

什么时候用：DSH profile 要一次性拿到整套百度网盘能力——agent 工具加网页面板。什么时候不用：profile 自己在补丁里组织这两行。

## 它插入什么

```yaml
- id: baidu-pan        # @veren/baidu-pan——工具、技能、登录流、baiduPan 网关
  config: { appKey: …, secretKey: …, root: … }
- id: baidu-pan-ui     # @veren/baidu-pan-ui——侧栏面板
```

面板刻意排在第二：它的客户端半边要注入 `remote.baiduPan`，而那由服务端那行的网关挂载。这与 `@veren/im-bundle`、`@veren/mail-bundle` 遵守同一套次序纪律——每个成员插件都只作为普通依赖安装，profile 层由组合包统一拥有，因此成员都不自带 `dsh.bundle`。

## 安装

```bash
dsh plugin --profile web add @veren/baidu-pan-bundle
```

然后把 profile 的 `cordis.patch.yml` 里 `baidu-pan` 那行的 `config` 块改成你自己的开放平台 `appKey`/`secretKey`（授权根缺省 `/apps/bdpan`），重启宿主。还没有真实应用三元组时插件会拒启——misconfiguration fails loud。

## 开发

本包不构建任何东西。`package.json` 带 `dsh.bundle.patch`，`cordis.patch.yml` 就是那个层；一切行为的真相在两个成员包里：

- [`../`](../README.cn.md)——服务端插件
- [`../ui`](../ui/README.cn.md)——网页面板

为 profile 安装打包整套：

```bash
node plugins/baidu/scripts/pack-stack.mjs
```

它把三个 tarball 产到同一目录，并把本包的成员依赖重写成 `file:` 引用——`workspace:*` 在工作区之外解析不了。
