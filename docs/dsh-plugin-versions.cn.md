# DSH 插件版本策略

[English](dsh-plugin-versions.md) | 中文

`plugins/` 下的每个包都运行在它并不拥有的 DSH 进程里。DSH 仍是 pre-stable，按某个运行时版本写出的插件，可能用到下一个版本就改掉的服务、事件或记录字段。由此产生两类故障，其中只有一类会报错。

- **把 DSH 包写进 `dependencies` 不是“锁版本”。** pnpm 会把这份副本装进 profile，它在那里遮蔽运行中的安装。于是插件持有第二个 `Context`、第二个 `Service` 基类、第二套注册表，而宿主仍用自己的那一份。cordis 报出的症状总是很晚且远离原因：插件注册的服务看不见、Remote 命名空间始终解析不到、工具凭空消失。
- **没有 `engines.dsh` 时，检查根本不会运行。** DSH 准入只读插件的 `engines.dsh`；没有它时才读 `@deepseek-ai/dsh*` 的 peer 区间。两者都没有的清单不施加任何约束，于是不兼容的插件照常加载，在运行期而不是在加载期失败，也拿不到可执行的修复提示。

## 规则

| 声明位置 | 放什么 |
| --- | --- |
| `engines.dsh` | 唯一的版本契约：`>=0.2.1-rc.2 <0.3.0`。超出范围时 DSH 拒绝安装或加载。 |
| `peerDependencies` | 所有必须与宿主共享实例的包：`@deepseek-ai/cordis`，以及以取值方式导入的每个 `@deepseek-ai/dsh-*`。区间与 `engines.dsh` 相同。 |
| `devDependencies` | 上述包在已验证运行时版本上的精确副本，加上仅类型导入与测试工具。这些副本只服务编译器与单测，永远不会被装进 profile。 |
| `dependencies` | 第三方包、`@veren/*` 包、`@deepseek-ai/schemastery`（官方指定的运行时校验器），以及无状态 DSH 工具（`dsh-brand`、`dsh-util-values`、`dsh-util-crypto`）。其他 DSH 包都不放这里。 |

profile 模板设置了 `autoInstallPeers: false`，peer 区间永远不会被装进 profile。加载时插件目录没有副本，profile 也没有，运行时解析层交出安装本身的包——两侧只有一个实例。`@deepseek-ai/schemastery` 保持为真实依赖，因为它是校验器而不是有状态服务；两份通过 Standard Schema 契约保持一致。

`engines.dsh` 优先于 peer 区间。两者写同一个窗口，peer 列表用于说明共享了哪些能力，而不会与版本契约冲突。

## 清单形态

```json
{
  "engines": { "dsh": ">=0.2.1-rc.2 <0.3.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.5",
    "@deepseek-ai/dsh-tools": ">=0.2.1-rc.2 <0.3.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.5",
    "@deepseek-ai/dsh-tools": "0.2.1-rc.2"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.4"
  }
}
```

只贡献类型或声明合并的包用 `import type` 或 `import type {}` 导入，它们只出现在 `devDependencies`。取值导入才把包放进 `peerDependencies`。

## 如何执行

`pnpm check:plugins` 运行 [`scripts/check-plugin-manifests.mjs`](../scripts/check-plugin-manifests.mjs)，覆盖 `plugins/` 与 `packages/` 下的每个清单。以下情况会失败：插件缺少或放宽 `engines.dsh`、任意位置出现装在 `dependencies` 里的 DSH 包、peer 没有 dev 镜像、dsh peer 使用了不同区间。新增插件后与发布前都要跑一次。

`@deepseek-ai/dsh-graph-*` 是本仓库自己的包，不是 DSH 运行时包，但 DSH 的兼容性检查会把每个 `@deepseek-ai/dsh-*` peer 区间当成运行时要求。因此它们同样声明 `engines.dsh`，由它优先判定，DSH 就不再检查它们的 workspace peer。

## 升级到新的 DSH 版本

1. 把 `DSH_CHECKOUT` 指向目标版本的 harness 检出；生成的 `tsconfig.paths.json` 与构建脚本都会跟随它。
2. 用该检出跑插件的构建、单测和真实 Loader 的组合测试。
3. 全部通过后，移动 `engines.dsh` 与所有 dsh peer 的下界，并把 `devDependencies` 改成匹配的精确版本。运行时离开 pre-stable 之前保留 `<0.3.0` 上界。
4. 跑 `pnpm check:plugins`，重新构建，再装进测试节点。

profile 级逃生门 `dsh plugin allow-version <package@version> --dsh-version <runtime> --accept-risk` 会把一条精确版本豁免写进该 profile 的 `compatibility.json`。它只用于诊断已经坏掉的节点，绝不是升级路径：它只授权一个包版本在一个运行时版本上，不会继承。

## 证明只有一个实例

加载成功只证明导入解析成功。组合测试还应断言身份：从插件侧导入服务包，确认宿主对象满足它，例如 `ctx.get('storage')` 是插件导入的 `Storage` 类的实例，`ctx.constructor` 是插件导入的 `Context`。不同目录下版本号相同并不共享模块状态。

## 已知限制

- 浏览器构建从工作区包 [`packages/platform-modules/platform-modules.mjs`](../packages/platform-modules/platform-modules.mjs) 读取外壳冻结模块表（零构建；`platform-modules.d.mts` 里是字面量元组声明）。`pnpm check:platform-modules` 会在 `DSH_CHECKOUT` 指向的检出里与 `packages/client/web/src/platform.ts` 逐项比对，缺项、多项、重复项、顺序不同都会失败，基座模块变动不再依赖人工复核。
- `pnpm check:plugins` 校验声明，不校验行为。只有组合测试能覆盖“运行时改了服务契约却没改版本号”的情况。
