---
title: 集成协议
description: "一句话职责边界：集成是把外部能力接入 Astro 的声明通道——集成只声明 我要提供什么 （渲染器、路由、脚本、指令、中间件、工具栏面板、类型），Astro 核心决定何时调用钩子与是否采纳声明；集成不持有请求期数据，部署形态的最终裁定归适配器(/design/modules/adapters/#141-duties)"
sidebar:
  order: 13
  label: 集成协议
draft: false
lastUpdated: 2026-11-04
---

## 13. Integrations

一句话职责边界：集成是把外部能力接入 Astro 的**声明通道**——集成只声明"我要提供什么"（渲染器、路由、脚本、指令、中间件、工具栏面板、类型），Astro 核心决定**何时调用钩子**与**是否采纳声明**；集成不持有请求期数据，部署形态的最终裁定归[适配器](/design/modules/adapters/#141-duties)。

### 13.1 Duties

集成是**无状态的提议者**：它不保存请求、会话或构建状态，只在钩子调用期间修改 `AstroSettings` 的派生副本；一旦钩子返回，所有产物（渲染器列表、注入路由、脚本列表、类型文件）都归核心所有。

| 关注点 | 拥有者 | 决策者 | 交接点 |
| --- | --- | --- | --- |
| 钩子调用时机与顺序 | 核心派发器（`runHook*`） | 核心 | 每条命令（dev/build/preview/sync）各走一遍 |
| 配置增量 | 集成（`updateConfig`） | 核心合并 + 逐轮 refine，见[配置解析](/design/modules/config/#31-duties) | 每个集成执行后立即校验 |
| 路由条目 | 集成（`injectRoute`） | 路由表裁决优先级，见[路由表](/design/modules/routing/#41-duties) | `astro:routes:resolved` 只读回读 |
| 渲染器 | 集成（`addRenderer`） | 运行时按组件类型选择，见[渲染](/design/modules/render/#64-contracts) | 无匹配即 `NoMatchingRenderer` |
| 中间件 | 集成（`addMiddleware`，`pre`/`post`） | 核心拼装执行序 | 与项目自有中间件合并成一条链 |
| 客户端指令 | 集成（`addClientDirective`） | 核心查重 | 缺客户端入口即 `NoClientEntrypoint` |
| 开发工具栏面板 | 集成（`addDevToolbarApp`） | 工具栏内核（开关与生命周期），见[本地服务](/design/modules/server/#82-capabilities) | `beforeTogglingOff` 可否决关闭 |
| 注入类型 | 集成（`injectTypes`） | `astro sync` 落盘，见[Tooling](/design/modules/tooling/#162-capabilities) | 文件名必须以 `.d.ts` 结尾 |

核心另给两个辅助：`createCodegenDir()` 返回 `./integrations/<name>/` 代码生成目录（名称中的非 `\w.-` 字符被替换为 `_`）；`addWatchFile(path)` 把文件纳入 dev 监听。

### 13.2 Capabilities

集成协议的全部能力 = **12 个钩子**（决定时序）+ **11 个注入器**（决定产物）；钩子按集成注册顺序串行执行，任一钩子抛错即终止当前命令并进入错误面，不存在"跳过失败集成继续跑"的分支。

| 钩子 | 触发时机 | 关键参数 | 可否改写核心状态 |
| --- | --- | --- | --- |
| `astro:config:setup` | 每个集成一轮，本轮新增的集成也会被执行 | `config`、`command`、`isRestart`、全部注入器 | 是（`updateConfig`） |
| `astro:config:done` | 全部 `config:setup` 之后 | `config`、`setAdapter`、`injectTypes`、`buildOutput` | 是（适配器与类型） |
| `astro:server:setup` | dev 服务器创建后 | `server`（ViteDevServer）、`toolbar`、`refreshContent` | 否（只给句柄） |
| `astro:server:start` | 监听成功后 | `address`（`AddressInfo`） | 否 |
| `astro:server:done` | dev 关闭时 | 仅 `logger` | 否 |
| `astro:route:setup` | 每条路由一次，可改 `route.prerender` | `route`（`RouteOptions`） | 是（`prerender`） |
| `astro:routes:resolved` | 路由表定型后 | `routes`（`IntegrationResolvedRoute[]`） | 否（含 `generate()`） |
| `astro:build:start` | 构建开始 | `setPrerenderer` | 是 |
| `astro:build:setup` | 每个 `target`（client/server）一次 | `vite`、`pages`、`target`、`updateConfig` | 是（Vite 配置） |
| `astro:build:generated` | 静态产物写出后 | `dir`、`routeToHeaders` | 否 |
| `astro:build:ssr` | SSR 清单生成后 | `manifest`、`middlewareEntryPoint` | 否 |
| `astro:build:done` | 构建收尾 | `pages`、`dir`、`assets` | 否 |

| 注入器 | 可用钩子 | 作用 | 冲突/失败行为 |
| --- | --- | --- | --- |
| `updateConfig(partial)` | setup | 深合并到当前配置 | 合并后立即 refine，非法即失败 |
| `addRenderer(renderer)` | setup | 注册 `AstroRenderer` | `name` 为空或缺 `serverEntrypoint` 立即失败；`astro:jsx` 被暂存到末尾 |
| `injectRoute({ pattern, entrypoint, prerender? })` | setup | 追加虚拟路由 | `entryPoint` 旧拼写告警后兼容 |
| `injectScript(stage, content)` | setup | 四个阶段：`before-hydration`、`head-inline`、`page`、`page-ssr` | 无查重 |
| `addClientDirective({ name, entrypoint })` | setup | 注册 `client:*` 指令 | 同名（含内置）重复立即失败 |
| `addDevToolbarApp({ id, name, icon?, entrypoint })` | setup | 注册工具栏面板 | `id` 重复由工具栏侧覆盖（待确认去重策略） |
| `addMiddleware({ order, entrypoint })` | setup | `pre`/`post` 中间件 | 缺 `order` 立即失败 |
| `addWatchFile(path)` | setup | 纳入 dev 监听 | — |
| `createCodegenDir()` | setup | 返回生成目录 | 自动创建 |
| `setAdapter(adapter)` | done | 采纳部署适配器 | 第二个不同名适配器立即冲突失败 |
| `injectTypes({ filename, content })` | done | 注入 `.d.ts` | 非 `.d.ts` 后缀立即失败 |

### 13.3 Contracts

```ts
interface AstroIntegration {
  name: string;
  hooks: Partial<BaseIntegrationHooks> & Partial<Record<string, unknown>>;
}
interface AstroRenderer {
  name: string;                         // 渲染器标识，运行时按此匹配
  clientEntrypoint?: string | URL;      // 浏览器侧入口，缺省则该框架不可水合
  serverEntrypoint: string | URL;       // 服务端渲染入口，必填
}
type ClientDirective = (
  load: () => Promise<() => Promise<void>>,   // 先取 hydrate，再执行
  options: { name: string; value: string },   // 组件 displayName 与属性值
  el: HTMLElement,
) => void;
interface ClientDirectiveConfig { name: string; entrypoint: string | URL }
type InjectedScriptStage = 'before-hydration' | 'head-inline' | 'page' | 'page-ssr';
interface AstroIntegrationMiddleware { order: 'pre' | 'post'; entrypoint: string | URL }
interface InjectedType { filename: string; content: string }   // filename 必须以 .d.ts 结尾
interface DevToolbarApp {
  init?(canvas: ShadowRoot, app: ToolbarAppEventTarget, server: ToolbarServerHelpers): void | Promise<void>;
  beforeTogglingOff?(canvas: ShadowRoot): boolean | Promise<boolean>;   // false = 否决关闭
}
type ContainerRenderer = { name: string; serverEntrypoint: string };   // @deprecated 用 AstroRenderer
```

钩子参数由核心构造，`logger` 是每个集成独立的 fork（按 `integration.name` 前缀），因此同一集成的所有日志可归并；钩子超过 3 秒未返回会打印"仍在等待集成 X 的钩子 Y"。

### 13.4 Flow

**用途：按序执行 `astro:config:setup`，并让集成在本轮追加的集成也进入同一轮**（源码用索引循环读取长度，故 `push` 到数组的集成会被执行）。

```ts
async function runConfigSetupLoop(settings: AstroSettings, command: 'dev'|'build'|'preview'|'sync', isRestart = false) {
  settings.config.integrations.unshift(settings.config.adapter);        // 适配器本身也是一个集成
  for (let i = 0; i < settings.config.integrations.length; i++) {       // 长度会增长，同轮生效
    const integration = settings.config.integrations[i];
    if (!integration.hooks['astro:config:setup']) continue;             // 钩子可选，没有就跳过
    await runHook(integration, 'astro:config:setup', { config, command, isRestart, ...injectors });
    settings.config = await validateConfigRefined(settings.config);     // 每次合并后立即校验
  }
  return settings;   // 失败分支：注入器抛错 → 终止本命令；不进入 build/dev 后续阶段
}
```

**用途：在 `astro:config:done` 采纳唯一适配器，并把输出形态的裁定权收归核心**（细化的平台分支见[适配器](/design/modules/adapters/#144-flow)）。

```ts
function acceptAdapter(settings, adapter, fromIntegration) {
  if (settings.adapter && settings.adapter.name !== adapter.name) throw new Error('conflicting adapter');
  if (adapter.adapterFeatures?.buildOutput !== 'static') settings.buildOutput = 'server';  // 默认 server
  if (!adapter.supportedAstroFeatures) throw new Error('adapter 缺少特性表');  // 普通 Error，不属 19 章错误码
  validateSupportedFeatures(adapter.name, adapter.supportedAstroFeatures, settings, logger); // 只告警不阻断
  settings.adapter = adapter;
}
```

**用途：运行时为组件选择渲染器，失败即暴露配置缺口，不回退默认渲染**。

```ts
function selectRenderer(result: SSRResult, Component: unknown, props: Props): SSRLoadedRenderer {
  for (const r of result.renderers) if (r.check(Component, result, props)) return r;
  throw new AstroError(AstroErrorData.NoMatchingRenderer);   // 页面与岛屿同一路径
}
// 客户端侧：指令已解析到渲染器，但该渲染器没有 clientEntrypoint
if (!renderer.clientEntrypoint) throw new AstroError(AstroErrorData.NoClientEntrypoint);
```

**用途：工具栏面板关闭前的否决协商**（面板可保住未保存的审计选择）。

```ts
async function setAppStatus(app: DevToolbarApp, next: boolean): Promise<boolean> {
  if (app.active && !next && app.beforeTogglingOff) {
    const allow = await app.beforeTogglingOff(canvas.shadowRoot);  // 抛错 → app.status = 'error'
    if (!allow) return app.active;                                 // 拒绝关闭，状态不变
  }
  app.active = next ?? !app.active;
  return app.active;
}
```

### 13.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-13-01 | 集成 A、B 均在 `config:setup` 中追加集成 C，C 注入一条路由 | `astro dev` 启动 | 钩子按 A→B→C 顺序执行，C 注入的路由在同一轮被路由表收录并可访问 |
| A-13-02 | 某集成注册名为 `load` 的客户端指令（内置已存在同名） | 启动 dev | 启动立即失败并提示该指令已存在，端口未监听 |
| A-13-03 | 某集成调用 `addRenderer({ name: 'x' })` 缺 `serverEntrypoint` | 启动 dev | 立即失败，终端出现该集成 `astro:config:setup` 的未处理错误，退出码非 0 |
| A-13-04 | 某集成在 `config:done` 调 `injectTypes({ filename: 'x.ts' })` | 启动 dev | 立即失败，错误信息指明文件名必须以 `.d.ts` 结尾 |
| A-13-05 | 自建工具栏 app 的 `beforeTogglingOff` 返回 `false` | 点击该 app 图标关闭 | 面板保持开启；改为返回 `true` 后再点即关闭 |
| A-13-06 | 两个集成分别在 `config:done` 里 `setAdapter` 不同名的适配器 | `astro build` | 构建失败，提示只能配置一个部署集成 |
| A-13-07 | 某集成 `astro:build:done` 内抛异常 | `astro build` | 日志出现 `An unhandled error occurred while running the "astro:build:done" hook`，构建终止 |
