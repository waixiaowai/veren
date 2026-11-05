---
title: 路由表
description: "routing 从目录结构、显式重定向与集成注入中推导出一张有序路由表，并把一个已解码的请求路径解析成唯一结论：命中某条路由、按某条规则重定向、按某条规则重写，或未命中。它不渲染页面、不读内容；与 render 的分界是：routing 只回答 是谁 ，render 负责 怎么出响应 "
sidebar:
  order: 4
  label: 路由表
draft: false
lastUpdated: 2026-11-04
---

## 4. Routing

`routing` 从目录结构、显式重定向与集成注入中推导出一张**有序路由表**，并把一个已解码的请求路径解析成唯一结论：命中某条路由、按某条规则重定向、按某条规则重写，或未命中。它不渲染页面、不读内容；与 `render` 的分界是：`routing` 只回答"是谁"，`render` 负责"怎么出响应"。

### 4.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 扫描页面目录、解析文件名中的静态段/动态段/剩余段 | 编译组件（委托 `compile`） |
| 生成稳定路由标识、参数表与生成函数 `generate()` | 读取内容集合（委托 `content`） |
| 排序与匹配、尾斜杠归一化、百分号编码校验 | 中间件执行顺序（委托 `render`） |
| 配置重定向、集成注入路由、国际化路由与回退 | 适配器如何接收请求（委托 `adapters`） |
| 路由级预渲染判定（`prerender` 导出优先于全局默认） | 产物写盘（委托 `build`） |

### 4.2 Invariants

路由域有三条不可协商的规则，违反任一条都会让"请求命中哪条路由"失去确定性。

| 铁律 | 理由 | 违反后果 |
| --- | --- | --- |
| 路由表一次生成，请求期只读 | 请求期改表会让并发请求看到不同的匹配结果 | 同一 URL 在不同请求下命中不同路由，缓存与日志不可信 |
| 同一路径只允许一个结论 | 命中、重定向、重写、未命中四者互斥 | 出现双重响应或静默的 200 空页 |
| 匹配是纯函数 | 不含时间、随机数与外部 IO | 测试不可复现，预渲染与请求期结果不一致 |

恢复策略：路由表由构建期或开发期一次性生成；注入路由只在启动阶段合并，运行期变更必须重建整表，并让在途请求走完旧表后再切换。

### 4.3 Capabilities

发现阶段把文件路径切成段：静态段、`[param]`、`[...rest]`、以及同一段内的混合形式（如 `game-[title]`）；`index` 视为比所在 URL 多一段；端点（`.ts`/`.js`）与页面（`.astro`/`.md`/`.mdx`）都进入同一张表，端点优先于同名页面。每条路由携带：原始模式串、编译后的匹配表达式、段列表、参数名、组件入口、是否预渲染、来源（文件/注入/i18n 回退/内置端点）。排序遵循固定优先级：段数多者先于少者；静态段先于动态段；纯动态段后于混合段；单参数先于剩余参数；预渲染先于按需；端点先于页面；仍相同则按字母序。匹配阶段先做路径规范化（合并重复斜杠、处理尾斜杠策略、校验非法编码），再按表顺序取首个命中，未命中时依次尝试配置重定向、尾斜杠重定向、404 路由。国际化在匹配前插入一层：按 `prefixDefaultLocale` 与 `defaultLocale` 识别语言前缀，命中不到时按 `fallback` 决定重定向或重写，`routing: 'manual'` 则完全交给用户中间件（此时内核不注入 i18n 逻辑）。重写只改变"用哪条路由渲染"，不改变浏览器地址栏；重定向改变地址栏且不渲染内容。注入路由默认排在文件路由之前，但不得覆盖内核保留路径（动作、图片、Server Islands）。

### 4.4 Contracts

```ts
type RouteType = 'page' | 'endpoint' | 'redirect' | 'fallback';

interface RouteRecord {
  id: string;                      // 稳定标识，形如 "src/pages/blog/[slug].astro"
  route: string;                   // 原始模式串，如 "/blog/[slug]"
  pattern: RegExp;                 // 用于匹配，已含尾斜杠策略
  segments: RouteSegment[];        // 每段由静态/动态/剩余部分构成
  params: string[];                // ["slug"]，按出现顺序
  pathname?: string;               // 仅静态路由有确定 pathname
  type: RouteType;
  prerender: boolean;              // 路由级导出优先，否则取全局默认
  component: string;               // 组件或端点的模块标识
  origin: 'filesystem' | 'injected' | 'internal' | 'i18n-fallback';
  redirect?: RedirectConfig;       // type === 'redirect' 时必填
  fallbackRoutes: RouteRecord[];   // i18n 回退链，按优先级排列
  generate(params?: Record<string, string | undefined>): string;
}

type RouteResolution =
  | { kind: 'matched'; route: RouteRecord; params: Record<string, string>; pathname: string }
  | { kind: 'redirect'; status: 301 | 302 | 307 | 308; location: string }
  | { kind: 'rewrite'; route: RouteRecord; params: Record<string, string> }
  | { kind: 'notFound'; tried: string[] };

interface RouteTable {
  routes: readonly RouteRecord[];                    // 已排序
  match(pathname: string, init: { trailingSlash: 'always' | 'never' | 'ignore' }): RouteResolution;
  generate(routeId: string, params?: Record<string, string>): string;
  addInjected(routes: RouteRecord[]): RouteTable;    // 返回新表，不就地修改
}

abstract class RouteDiscoverer {
  abstract discover(input: { pagesDir: URL; injected: InjectedRoute[]; i18n?: I18nConfig }): Promise<RouteRecord[]>;
}
```

约束：路由表在构建期与开发期都必须"一次构建、多处只读"；`addInjected` 返回新表，禁止在请求处理中改变排序。匹配必须是纯函数，输入相同则结果相同（不含随机、不含当前时间）。非法参数编码返回 `InvalidDynamicRoute`，不得以空串兜底。

### 4.5 Flow

下面伪代码说明开发期一次请求的路由解析顺序，覆盖国际化回退、尾斜杠与未命中。

```ts
function resolveRoute(table: RouteTable, url: URL, i18n?: I18nConfig): RouteResolution {
  const normalized = normalizePathname(url.pathname);            // 合并斜杠、解码、校验
  if (normalized.invalidEncoding) throw new AstroError(AstroErrorData.InvalidDynamicRoute);

  const localized = i18n ? detectLocale(normalized.pathname, i18n) : undefined;
  const direct = table.match(localized?.pathname ?? normalized.pathname, { trailingSlash: 'ignore' });
  if (direct.kind === 'matched') return withLocaleParams(direct, localized);

  const fallback = localized ? pickFallback(localized, i18n!) : undefined;
  if (fallback?.type === 'redirect') return { kind: 'redirect', status: 302, location: fallback.location };
  if (fallback?.type === 'rewrite') return { kind: 'rewrite', route: fallback.route, params: fallback.params };

  const slashRedirect = trailingSlashRedirect(normalized.pathname, config.trailingSlash);
  return slashRedirect ?? { kind: 'notFound', tried: table.routes.map((r) => r.route) };
}
```

失败与拒绝：动态路由参数缺失或含非法字符 → `InvalidDynamicRoute`；配置了 `redirects` 但目标不是站内路径也未标记外部 → `InvalidRedirectDestination`；`i18n` 声明了语言但缺少首页 → `MissingIndexForInternationalization`；`routing: 'manual'` 仍配置了 `prefixDefaultLocale` 等子项 → `IncorrectStrategyForI18n`；请求的语言不在 `locales` 中且无回退 → 404 并附可用语言列表（`MissingLocale` 用于内容查询，不用于路由）。

幂等与恢复：同一 pathname 的解析结果只由路由表与设定决定，重复调用返回相同结论；路由表重建失败时保留旧表并拒绝新请求进入，直到重建成功。

### 4.6 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-4-01 | 同时存在 `/blog/hello.astro` 与 `/blog/[slug].astro` | 请求 `/blog/hello` | 静态路由胜出，参数不被解析进动态路由 |
| A-4-02 | `trailingSlash: 'never'`，请求带尾斜杠 | `GET /about/` | 308 重定向到 `/about`，地址栏变化，不渲染页面 |
| A-4-03 | `i18n.fallback` 配置 `fr → en`，`fr/about` 不存在 | 请求 `/fr/about` | 按 `fallbackType` 重定向或重写；重写时地址栏保持 `/fr/about` |
| A-4-04 | 动态段参数含非法编码 | `GET /blog/%E0%A4%A` | 请求被拒绝，返回 `InvalidDynamicRoute`，不进入渲染 |
| A-4-05 | 无匹配路由 | `GET /nope` | 404；开发期页面列出候选路由，生产期走自定义 404 |
| A-4-06 | 集成注入 `/api/[id]` 路由 | 请求 `/api/42` | 注入路由命中，且不覆盖 `/_actions`、`/_image`、`/_server-islands` |
| A-4-07 | 路由表重建失败（注入路由非法） | 再次构建 | 保留旧表并拒绝新请求进入；日志给出失败路由与原因 |
| A-4-08 | 同一 pathname 并发解析 100 次 | 并发调用解析 | 100 次结果一致，无随机差异 |
