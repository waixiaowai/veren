# @deepseek-ai/dsh-graph-bundle

把整个 DSH graph 插件族打成一个可安装的 DSH 组合包。它的 `dsh.bundle.patch` 负责挂载 DAG 内核、flow 引擎、YAML flow 装载器与其解析能力提供者、存储接缝、通用 tool 节点以及模型可见的 graph 工具；`tarballs/` 里带着这些行要加载的每个包。想一步把这一族装进 DSH profile 时用它；要自己组装宿主时请直接依赖各个 `@deepseek-ai/dsh-graph-*` 包。

## 提供什么

- **一个组合层**（`cordis.patch.yml`）—— 一次 `insert` 插入 `veren-yaml-parser`、`graph-kernel`、`graph-flow-engine`、`graph-flow-node-tool`、`graph-flow-yaml`、`graph-flow-storage` 与 `graph-tools` 七行。行按 id 寻址，因此后续组合层或 profile 自己的 `cordis.patch.yml` 可以覆写任意一行的配置。
- **自带的 tarball**（`tarballs/*.tgz`）—— 每个包由 `pnpm pack` 产出。打包会把 `workspace:*` 依赖改写成裸版本号，所以目标 profile 需要 pnpm `overrides` 把本 bundle 携带的每个 `@deepseek-ai/dsh-graph-*` 与 `@veren/*` 包钉到自己的副本上。

## 装进 DSH profile

必须以**目录**形式安装，不能用打包好的 tarball：pnpm 会把包自己的 `file:./tarballs/*.tgz` 依赖按"执行安装的项目"解析，因此 tarball 形式的 bundle 找不到这些文件。以 `$DSH_HOME` 指向目标主目录为例：

1. 把本目录复制到 `$DSH_HOME/packages/dsh-graph-bundle`。
2. 在 `$DSH_HOME/profiles/<profile>/package.json` 加 `"@deepseek-ai/dsh-graph-bundle": "file:../../packages/dsh-graph-bundle"`。
3. 把 `@deepseek-ai/dsh-graph-bundle` 追加到该清单的 `dsh.profile.bundles`。
4. 在 `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` 的 `overrides` 里，为本 bundle 携带的每个 `@deepseek-ai/dsh-graph-*` 与 `@veren/*` 包补一条指向 `$DSH_HOME/packages/*.tgz` 的钉定项。
5. 停节点 → 跑该 profile 的 pnpm 安装 → 重新启动节点。

源码改动后刷新 tarball 是逐包执行 `pnpm pack --pack-destination <本目录>`；没有生成脚本。

本目录被排除在仓库 pnpm workspace 之外（`pnpm-workspace.yaml` 里的 `!packages/graph/bundle`），原因与"不能用 tarball 安装"同源 —— 见那里的注释。

## 非目标

不含运行时代码、不参与构建、没有测试：它是发布件。它不替你选存储后端或 flow 来源，那些留在部署侧（`@deepseek-ai/dsh-graph-flow-storage` 的配置、`@deepseek-ai/dsh-graph-flow-yaml` 的 `files`）。

中文文档即本文件；英文见 [README.md](./README.md)。
