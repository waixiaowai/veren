# @veren/notebook-bundle

只含配置的组合包，用一个 profile 层装好完整的私密记事本技术栈。

## 什么情况下用它

当某个 DSH profile 需要一次性获得宿主服务（含 `notebook_*` 工具）和人用的 Web 页面时，
用这个包。只要宿主服务，或者想在自己的 patch 里逐行组合这两个插件时，不要用它。

## 它插入什么

```yaml
- insert:
    - id: notebook
      name: '@veren/notebook'
    - id: notebook-app
      name: '@veren/notebook-app'
    - id: notebook-ui
      name: '@veren/notebook-ui'
```

顺序有讲究：宿主拥有存储域、`notebook` 远端命名空间与工具；应用层硬注入 `apps` 与
`notebook` 服务；页面与该命名空间通信。

本组合包把 `@veren/app-host-bundle` 声明为依赖：那个组合包独占所有应用框架 loader 行
（`app-registry`、`page-registry`、`task-center`、`app-host`），因此装记事本组合包会连带
装上框架，且无论同装多少个应用组合包，`app-host` 行都只被插入一次（G1 去重契约）。
只装 `@veren/notebook` 得到的是没有应用面的 headless 技术栈（G2 拆包）。

## 应用层

应用层是独立的成员包 `@veren/notebook-app`（G2 拆包）：`notebook` 应用（`/apps/notebook/...`
下的页面与 `notebook__*` 页面工具）经宿主服务的公开工具端口行动。它是独立的 loader 行，
因此 profile 可以只装宿主（纯工具），也可以装整栈——边界在插件管理页始终可见。

## 安装

把组合包安装进目标 profile。测试节点里两个成员包是本地 tarball，因此由
`scripts/pack-local.mjs` 产出一个一次性组合包 tarball，其依赖条目指向这些 tarball：

```sh
pnpm --dir plugins/notebook pack --pack-destination plugins/notebook-bundle/tarballs
pnpm --dir plugins/notebook-ui pack --pack-destination plugins/notebook-bundle/tarballs
node plugins/notebook-bundle/scripts/pack-local.mjs plugins/notebook-bundle/tarballs
```

提交进仓库的 `package.json` 保持 `workspace:^` 范围，这是已发布组合包所需的写法。生成的
tarball 是本地产物。

## 开发

```sh
pnpm --dir plugins/notebook-bundle test
```
