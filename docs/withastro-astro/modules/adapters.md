---
title: 适配器
description: "一句话职责边界：适配器把核心构建出的产物翻译成某个平台能运行的形态——适配器拥有平台入口、部署布局、特性声明与可选的预渲染器，核心拥有输出形态（static / server）的最终裁定与特性校验；集成协议本身归集成协议(/design/modules/integrations/#131-duties)，产物目录与路由写盘归构建(/design/modules/build/#71-duties)"
sidebar:
  order: 14
  label: 适配器
draft: false
lastUpdated: 2026-11-04
---

## 14. Adapters

一句话职责边界：适配器把核心构建出的产物翻译成**某个平台能运行的形态**——适配器拥有平台入口、部署布局、特性声明与可选的预渲染器，核心拥有输出形态（`static` / `server`）的最终裁定与特性校验；集成协议本身归[集成协议](/design/modules/integrations/#131-duties)，产物目录与路由写盘归[构建](/design/modules/build/#71-duties)。

### 14.1 Duties

适配器是**同一个 `AstroAdapter` 的两种读法**：核心读 `adapterFeatures` / `supportedAstroFeatures` 做裁定与告警，平台读 `serverEntrypoint` / `previewEntrypoint` 与适配器自写的平台文件；双方都不读对方私有字段。**只有一个适配器**——`setAdapter` 第二次收到不同名适配器即冲突失败，同名重复调用幂等。

| 关注点 | 拥有者 | 决策者 | 交接点 |
| --- | --- | --- | --- |
| 输出形态 `buildOutput` | 适配器用 `adapterFeatures.buildOutput` 提议 | 核心：非 `static` 即置 `server` | `astro:config:done` 的 `buildOutput` 只读回传 |
| 服务端入口 | 适配器（`serverEntrypoint`） | 核心按 `entrypointResolution` 解析 | 写入 Vite 构建输入 |
| 预览入口 | 适配器（`previewEntrypoint`） | 核心：缺省则退回静态预览 | `astro preview` |
| 平台文件（`_headers`、functions、wrangler） | 适配器 | 适配器 | 在 `build:generated` / `build:done` 自写 |
| 特性支持级 | 适配器（`supportedAstroFeatures`） | 核心只告警/报错，不擅自降级 | `validateSupportedFeatures` |
| 预渲染执行者 | 适配器（`setPrerenderer`） | 核心按契约调用三段生命周期 | 非 Node 运行时（如 workerd） |

### 14.2 Capabilities

适配器契约 = **6 个字段**（`name`、`serverEntrypoint`、`previewEntrypoint`、`adapterFeatures`、`supportedAstroFeatures`、`client`）+ **1 个二选一的分辨模式**（`entrypointResolution`），另加 6 个特性键与 1 个可选预渲染器。

| 字段 | 必填 | 作用 | 备注 |
| --- | --- | --- | --- |
| `name` | 是 | 日志与冲突检测的唯一标识 | `astro info` 会带上其版本 |
| `serverEntrypoint` | `auto` 下必填 | 按需渲染入口模块 | `auto` 要求该模块本身是合法入口 |
| `previewEntrypoint` | 否 | `astro preview` 的启动模块 | 缺省时退回静态文件服务 |
| `adapterFeatures` | 否 | 影响产物形状的开关；另含 `preserveBuildClientDir` / `preserveBuildServerDir`（静态构建保留 `build.client` / `build.server` 结构） | 见下表 |
| `supportedAstroFeatures` | 是 | 内置特性支持级 | 缺失即失败（Astro 4.0 起强制） |
| `client` | 否 | `internalFetchHeaders`、`assetQueryParams` | 供 Actions、过渡、预取、Server Islands 的内部请求使用 |
| `entrypointResolution` | 否 | `'auto'`（推荐）或 `'explicit'`（弃用） | 缺省按 `explicit` 并打两条弃用警告；`exports`/`args` 只在该分支有效 |

| 特性键 | 含义 | 何时校验 | 允许值 |
| --- | --- | --- | --- |
| `staticOutput` | 能服务纯静态站点 | `buildOutput === 'static'` | `stable` / `deprecated` / `experimental` / `limited` / `unsupported` |
| `hybridOutput` | 能服务"静态站点 + 少量按需路由" | `output === 'static'` 且 `buildOutput === 'server'` | 同上 |
| `serverOutput` | 能服务按需渲染 | `output === 'server'` 或 `buildOutput === 'server'` | 同上 |
| `i18nDomains` | 支持 i18n 域名 | `config.i18n.domains` 存在，且 `output === 'server'`、未设 `site` | 同上 |
| `envGetSecret` | 支持 `astro:env/server` 的 `getSecret()` | `env.schema` 非空 | 同上 |
| `sharpImageService` | 支持内置 Sharp 图片服务 | `image.service` 指向 `astro/assets/services/sharp` | 同上 |

支持级除字符串外还可写成对象 `{ support, message, suppress }`（`suppress` 取 `'all'` 或 `'default'`）：`message` 追加适配器自有说明，`suppress` 抑制默认措辞。判定结果是**告警**而非阻断——`deprecated` / `experimental` / `limited` 各有一条固定文案，`unsupported` 记 error 级日志但构建继续。

| `adapterFeatures` 键 | 取值 | 作用 |
| --- | --- | --- |
| `buildOutput` | `'static' \| 'server'` | 强制产物形状；缺省按 `server` 处理 |
| `middlewareMode` | `'classic' \| 'edge'` | `edge` 时中间件单独部署为边缘函数；`edgeMiddleware: true` 为已弃用别名 |
| `staticHeaders` | `boolean` | 让 `astro:build:generated` 拿到 `routeToHeaders`，用于生成平台头文件 |

| 官方适配器 | 运行时模型 | 入口 | 中间件 | 关键差异 |
| --- | --- | --- | --- | --- |
| `@astrojs/node` | 长驻 Node 服务器（`standalone`）或被宿主挂载（`middleware`） | `server.js` / `preview.js` | `classic` | 默认启用文件系统会话；`bodySizeLimit`；`staticHeaders` 写 `_headers.json` |
| `@astrojs/vercel` | Serverless 函数，可选 ISR 缓存 | `entrypoint` | `classic` 或 `edge`（可配） | 静态构建直接落 `outDir`；ISR 走 `/_isr` 转发 |
| `@astrojs/netlify` | Netlify Functions + 可选 Edge 中间件 | `ssr-function.js` | `classic` 或 `edge` | 生成 redirects；静态回落 `/.netlify/static` |
| `@astrojs/cloudflare` | Workers（workerd 运行时） | `entrypoint` + `preview` | `classic` | 自带 workerd 预渲染器；KV 会话绑定；Images 绑定 |

### 14.3 Contracts

```ts
type AstroAdapter = {
  name: string;
  previewEntrypoint?: string | URL;
  adapterFeatures?: AstroAdapterFeatures;
  supportedAstroFeatures: AstroAdapterFeatureMap;   // 必填
  client?: AstroAdapterClientConfig;                // internalFetchHeaders / assetQueryParams
} & (
  | { entrypointResolution: 'auto'; serverEntrypoint?: string | URL }        // 推荐
  | { entrypointResolution?: 'explicit'; serverEntrypoint?: string | URL;   // 缺省即此分支（弃用）
      exports?: string[]; args?: unknown }
);
interface AstroAdapterFeatures {
  edgeMiddleware?: boolean;                  // @deprecated 用 middlewareMode: 'edge'
  middlewareMode?: 'classic' | 'edge';       // 默认 classic
  buildOutput?: 'static' | 'server';         // 默认 server
  staticHeaders?: boolean;
  preserveBuildClientDir?: boolean;  preserveBuildServerDir?: boolean;
}
type AdapterSupportKind = 'stable' | 'deprecated' | 'experimental' | 'limited' | 'unsupported';
type AdapterSupport = AdapterSupportKind
  | { support: Exclude<AdapterSupportKind, 'stable'>; message: string; suppress?: 'all' | 'default' };
interface AstroAdapterFeatureMap {
  staticOutput?: AdapterSupport;   hybridOutput?: AdapterSupport;   serverOutput?: AdapterSupport;
  i18nDomains?: AdapterSupport;    envGetSecret?: AdapterSupport;   sharpImageService?: AdapterSupport;
}
interface AstroPrerenderer {
  name: string;
  setup?: () => Promise<void>;
  getStaticPaths: () => Promise<PathWithRoute[] | StaticPathsResult>;   // 裸数组已弃用
  render(request: Request, options: { routeData: RouteData; collectMetadata?: boolean }): Promise<Response | PrerenderResult>;  // 裸 Response 已弃用
  teardown?: () => Promise<void>;                                      // 全部页面渲染完与图片生成后调用
}
interface AstroPrerendererFactoryContext { outputDirectories: { client: URL; server: URL; prerender: URL } }
type AstroPrerendererFactory = (defaultPrerenderer: AstroPrerenderer, context: AstroPrerendererFactoryContext) => AstroPrerenderer;
```

### 14.4 Flow

**用途：从配置走到"能不能出 server 产物"的裁定链**，三条失败分支严重度不同（构建失败、dev 仅告警、无适配器直接失败）。

```ts
function decideBuildOutput(config: AstroConfig, command: 'dev'|'build', adapter?: AstroAdapter): 'static'|'server' {
  let buildOutput = config.output === 'server' ? 'server' : 'static';        // 初值由 output 决定
  if (adapter?.adapterFeatures?.buildOutput !== 'static') buildOutput = 'server';   // setAdapter 内
  if (buildOutput === 'server' && adapter?.adapterFeatures?.buildOutput === 'static') {
    if (command === 'build') throw new AstroError(AstroErrorData.AdapterSupportOutputMismatch);
    logger.warn(null, 'adapter 不支持 server 产物，项目将无法正确构建');     // dev 只警告
  }
  if (command === 'build' && !config.adapter && buildOutput === 'server') throw new AstroError(AstroErrorData.NoAdapterInstalled);
  return buildOutput;
}
```

**用途：把适配器声明的入口解析成 Vite 构建输入**；`auto` 与 `explicit` 是两条不同的责任线。

```ts
function resolveServerEntrypoint(adapter: AstroAdapter): URL | undefined {
  if (adapter.entrypointResolution === 'auto')                                    // 推荐：入口即合法模块
    return adapter.serverEntrypoint ? resolve(adapter.serverEntrypoint) : undefined;
  // explicit（弃用）：入口自带 createExports()，按 adapter.exports 取导出；缺省分辨率 → 两条弃用警告后走这里
  return adapter.serverEntrypoint ? createExports(adapter.serverEntrypoint, adapter.exports ?? []) : undefined;
}
```

**用途：让非 Node 运行时接管预渲染**，核心只按三段契约调用，不关心里面跑的是 workerd 还是 Node。

```ts
async function runPrerenderer(factory: AstroPrerenderer | AstroPrerendererFactory, ctx: AstroPrerendererFactoryContext) {
  const prerenderer = typeof factory === 'function' ? factory(defaultPrerenderer, ctx) : factory;
  await prerenderer.setup?.();                                    // 例如起一个本地预览服务
  try {
    const result = await prerenderer.getStaticPaths();
    for (const { pathname, route } of Array.isArray(result) ? result : result.paths) {
      const r = await prerenderer.render(new Request(new URL(pathname, site)), { routeData: route });
      recordMetadata(pathname, 'response' in r ? undefined : r.metadata);  // 裸 Response → not tracked
    }
  } finally {
    await prerenderer.teardown?.();                               // 异常也必须回收，中途失败即终止构建
  }
}
```

### 14.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-14-01 | `@astrojs/node` 且 `mode: 'standalone'`，存在按需渲染页面 | `astro build` 后运行产物入口 | 产物目录含服务器入口与会话目录，启动后页面返回 200 |
| A-14-02 | 适配器声明 `buildOutput: 'static'`，项目有 `prerender = false` 的页面 | `astro build` | 构建失败并抛 `AdapterSupportOutputMismatch`，提示改用支持 server 的适配器 |
| A-14-03 | `output: 'server'` 但未安装任何适配器 | `astro build` | 构建失败并抛 `NoAdapterInstalled`；同一项目 `astro dev` 只打印缺适配器警告且页面可访问 |
| A-14-04 | 适配器 `supportedAstroFeatures.serverOutput: 'unsupported'`，`output: 'server'` | `astro build` | 日志出现"该适配器不支持 serverOutput"的 error 级告警，构建继续完成 |
| A-14-05 | 适配器未写 `entrypointResolution` | `astro dev` 启动 | 出现两条弃用警告（默认按 `explicit` 处理），dev 正常运行 |
| A-14-06 | `@astrojs/cloudflare` 设 `prerenderEnvironment: 'workerd'` | `astro build` | 预渲染由 workerd 执行，`setup`→`getStaticPaths`→`render`→`teardown` 依序被调用（日志可见性待确认） |
