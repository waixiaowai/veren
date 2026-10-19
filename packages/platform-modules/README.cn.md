# @veren/platform-modules

Web 外壳冻结模块表，作为 Veren 浏览器插件的构建期数据。

## 什么时候使用

当 Web 外壳插件的构建配置（`tsdown.config.ts` 或 esbuild 打包脚本）需要外壳通过
`window.__ModuleLoader__` 共享的模块名清单时使用本包。插件把这些模块名声明为
external，由外壳为每一项注入同一个共享实例。不要在运行时使用它，也不要把清单复制进
插件。

## 它是什么

- 零构建：`exports` 直接指向 `platform-modules.mjs` 与 `platform-modules.d.mts`；
  没有 `build` 脚本，也没有编译产物。
- `PLATFORM_MODULES` 是这张表唯一的一份。声明是字面量元组，写错模块名会变成类型
  错误，而不是被静默当成需要打包的模块。
- 仅构建期使用：放进插件的 `devDependencies`，绝不要放进 `dependencies` 或插件的
  `files`。

```json
{
  "devDependencies": {
    "@veren/platform-modules": "workspace:*"
  }
}
```

```ts
import { PLATFORM_MODULES } from '@veren/platform-modules'

const external = [...PLATFORM_MODULES]
```

## 防漂移门禁

`pnpm check:platform-modules` 运行 [`scripts/check-platform-modules.mjs`](../../scripts/check-platform-modules.mjs)。
它从 DSH 检出的 `packages/client/web/src/platform.ts` 读取 `PLATFORM_MODULES`
（默认检出目录 `deepseek/deepseek-harness`，可用 `DSH_CHECKOUT` 覆盖），当本包出现
缺项、多项、重复项或顺序不同时报错。它还会校验运行时数组与类型声明元组是否一致。

这张表是外壳契约：改动它等于改动外壳注入的内容，所以同一次改动必须同时移动所有 UI
插件的 `engines.dsh` 区间。
