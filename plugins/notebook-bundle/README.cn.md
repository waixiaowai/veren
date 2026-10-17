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
    - id: notebook-ui
      name: '@veren/notebook-ui'
```

顺序有讲究：宿主拥有存储域、`notebook` 远端命名空间与工具；页面与该命名空间通信。

两个成员都不声明 `dsh.bundle.patch`，因此本组合包是该技术栈唯一的 profile 层，安装它不会
重复插行。成员作为普通依赖随行。

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
