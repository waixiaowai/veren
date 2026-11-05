---
title: 运行时存储
description: "Storage 拥有 跨请求存下来的运行时状态 的全部决策——会话内容放哪、缓存头怎么出、失效怎么触发；它不拥有业务数据，也不拥有页面路由"
sidebar:
  order: 12
  label: 运行时存储
draft: false
lastUpdated: 2026-11-04
---

## 12. Storage

Storage 拥有"跨请求存下来的运行时状态"的全部决策——会话内容放哪、缓存头怎么出、失效怎么触发；它不拥有业务数据，也不拥有页面路由。

### 12.1 Duties

| 维度 | 内容 |
| --- | --- |
| 输入 | `session.*` 配置（`driver`/`options`/`cookie`/`ttl` 或 `false`）、`cache.provider` 配置、`routeRules` 规则、请求携带的会话 cookie、页面里对 `context.session` / `context.cache` 的调用 |
| 输出 | 会话 cookie 与驱动内的会话数据、`CDN-Cache-Control` / `Cache-Tag` / `Last-Modified` / `ETag` 响应头、`invalidate()` 的删除效果 |
| 不负责 | 内容集合的持久化（[内容层](/design/modules/content/#102-capabilities) 写的是 `.astro/data-store.json`）；业务实体（订单、用户资料都不在这里）；动作输入校验（[Actions](/design/modules/actions/#113-contracts)） |
| 相邻模块 | 上游是 [配置解析](/design/modules/config/#33-contracts)（规范化 `session`/`cache`/`routeRules`）；使用方是 [请求渲染](/design/modules/render/#65-flow) 的 `RenderContext` 与端点；live 内容的 `cacheHint` 由内容层交给缓存 |
| 数据所有权 | 拥有**会话记录**（`SessionRecord`，字段见 [数据字典](/design/data/)）与**缓存规则**（`CacheRule`）；不拥有任何业务数据 |
| 决策权 | 独占三项决策：本次请求是否新建/续期会话、响应能否被缓存（`maxAge`/`swr`/`tags`）、哪些键需要失效 |
| 两者分界 | **会话是"请求身份态"**——它标识"谁在请求"，缺失即视为匿名，绝不能由缓存代为再生；**缓存是"响应可再生"**——同一 URL 的响应可以被替换、可过期、可失效。二者都不拥有业务数据，也互不代存：会话不缓存、缓存不存身份 |

### 12.2 Capabilities

会话侧：`session.driver` 接受 `{ entrypoint, config }` 对象（旧式字符串 + `options` 已废弃），内置驱动由 `sessionDrivers`（来自 `astro/config`）从 unstorage 映射而来，其中 `fs` 落到 `fsLite` 且默认 `base: '.astro/session'`；`session: false` 会连同适配器提供的默认驱动一起从 SSR 产物中移除。每个请求懒创建 `AstroSession`，首次 `set()` 时才写 cookie（默认名 `astro-session`，`httpOnly`、`sameSite: 'lax'`、生产环境 `secure`、`path: '/'`），会话 ID 为 v4 UUID；客户端给的非 UUID cookie 被忽略，cookie 合法但存储中无对应数据时服务端重新生成 ID。请求收尾通过内部符号触发持久化，值经 devalue 序列化（支持 `URL`），写入前先克隆以免后续修改被带入。`ttl` 以秒计，可被 `set(key, value, { ttl })` 覆盖。

缓存侧：`cache.provider` 未配置即"缓存关闭"；配置后按 `routeRules` 的 `[param]`/`[...rest]` 模式（不支持 `*` 通配）匹配路径，得到 `maxAge`（秒）、`swr`（秒）、`tags`。请求期 `context.cache` 暴露 `enabled`/`set()`/`tags`/`options`/`invalidate()`：`set()` 多次调用会合并（标量后写获胜、`tags` 累加、`lastModified` 取最新），传 `false` 表示本请求放弃缓存，传 live 条目则取其 `cacheHint`。开发环境用 noop 实现；未配置时用 disabled 实现，其 `invalidate()` 抛 `CacheNotEnabled`。

| 关注点 | 规则 |
| --- | --- |
| 驱动失败 | 无驱动、驱动加载失败、存储数据无法解析 → `SessionStorageInitError`；键为空、序列化失败、cookie 名非法（仅允许字母/数字/连字符）→ `SessionStorageSaveError` |
| 会话生命周期 | `regenerate()` 换新 ID 并保留数据；`destroy()` 删 cookie 与存储；`load(id)` 从已知 ID 恢复；三者都在请求收尾统一落盘 |
| 缓存提供方 | `CacheProvider` 至少实现 `{ name, invalidate }`；`setHeaders()` 自定义响应头；`onRequest(ctx, next)` 表示运行时可自行命中/回源 |
| 默认响应头 | 无 `setHeaders()` 时生成 `CDN-Cache-Control: max-age=…, stale-while-revalidate=…`、`Cache-Tag`、`Last-Modified`、`ETag`；带 `onRequest()` 的提供方读取后这两个 CDN 头会从最终响应剥离，只有无 `onRequest()` 的 CDN 型提供方保留它们给客户端 |
| 提供方解析 | entrypoint 从项目根解析，解析不到即 `CacheProviderNotFound`，错误信息给出 `name` 或 entrypoint |
| 与 live 内容协作 | 条目 `cacheHint` 直接喂给 `cache.set(entry)`；`invalidate(entry)` 等价于按该条目的 tags 失效 |

### 12.3 Contracts

```ts
interface SessionDriverConfig { entrypoint: string | URL; config?: Record<string, unknown>; }
interface SessionCookieOptions {
  name?: string;                                  // 缺省 'astro-session'
  domain?: string; path?: string;                 // 缺省 path '/'
  maxAge?: number;                                // 秒
  sameSite?: 'strict' | 'lax' | 'none' | boolean; // 缺省 'lax'
  secure?: boolean;                               // 生产缺省 true
}
interface SessionConfig {
  driver?: SessionDriverConfig;                   // 也可用 sessionDrivers.fs({...}) 生成
  ttl?: number;                                   // 秒；缺省则随 cookie 生命周期
  cookie?: string | SessionCookieOptions;
}
type SessionOption = SessionConfig | false;       // false = 完全关闭会话
interface SessionDriver {                         // 需要即可，未用的方法可不实现
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}
type SessionDriverFactory = (config: Record<string, unknown> | undefined) => SessionDriver;
interface SessionStorage {                        // context.session 的对外面
  readonly sessionID: string | undefined;         // v4 UUID
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, opts?: { ttl?: number }): void;
  has(key: string): Promise<boolean>;
  delete(key: string): void;
  keys(): Promise<string[]>;
  values(): Promise<unknown[]>;
  entries(): Promise<Array<[string, unknown]>>;
  destroy(): void;
  regenerate(): Promise<void>;
  load(sessionID: string): Promise<void>;
}
interface CacheProviderConfig { name?: string; entrypoint: string | URL; config?: Record<string, unknown>; }
type RouteRules = Record<string, CacheRule>;     // CacheRule 字段见 21 章：maxAge/swr/tags
interface CacheOptions { maxAge?: number; swr?: number; tags?: string[]; lastModified?: Date; etag?: string; }
interface CacheHint { tags?: string[]; lastModified?: Date; }
interface InvalidateOptions { path?: string; tags?: string | string[]; }
interface CacheProvider {
  name: string;
  setHeaders?(options: CacheOptions, request: Request): Headers;
  onRequest?(ctx: { request: Request; url: URL; waitUntil?: (p: Promise<unknown>) => void;
                    logger: { info(m: string): void; error(m: string): void } }, next: () => Promise<Response>): Promise<Response>;
  invalidate(options: InvalidateOptions): Promise<void>;
}

interface CacheLike {                             // context.cache
  readonly enabled: boolean;                      // 无提供方或 dev 时为 false
  set(input: CacheOptions | CacheHint | LiveDataEntry | false): void;
  readonly tags: string[];
  readonly options: Readonly<CacheOptions>;
  invalidate(input: InvalidateOptions | LiveDataEntry): Promise<void>;  // 无提供方 → CacheNotEnabled
}
```

错误约定：会话侧**抛** `AstroError`（`SessionStorageInitError` 表示读不进来、`SessionStorageSaveError` 表示写不出去），且都带上驱动标识；缓存侧只有 `invalidate()` 与提供方解析**抛**错（`CacheNotEnabled`、`CacheProviderNotFound`），`set()` 永不抛。

### 12.4 Flow

伪代码给出三条路径：会话读写与落盘、带缓存的一次渲染、失效触发；重点是"何时懒创建"与"何时才落盘"。

```ts
// 入口 1：读取会话（context.session.get / set）；session: false 时 context.session 为 undefined，本入口不存在
async function readSession(ctx: RequestContext, config?: SessionConfig): Promise<SessionStorage> {
  if (!config) throw new AstroError('SessionStorageInitError'); // 既未配置也未由适配器提供默认驱动
  const session = new AstroSession({ cookies: ctx.cookies, config, runtimeMode: ctx.mode,
                                     driverFactory: ctx.driverFactory, logger: ctx.logger });
  const value = await session.get('cart');            // 无 cookie 且无本地写入时直接返回 undefined
  if (value === undefined) return session;            // 不初始化驱动，避免空读
  return session;
}

async function writeSession(session: SessionStorage, key: string, value: unknown, ttl?: number) {
  session.set(key, value, { ttl });                   // 首次 set 时写 cookie（httpOnly/lax/secure）
}                                                     // 序列化失败 → SessionStorageSaveError

// 请求收尾（渲染完成后固定执行一次）
async function finalize(ctx: RequestContext, session?: SessionStorage): Promise<void> {
  if (session) await session.persist();               // 仅 dirty 或有待销毁 id 时才真正写驱动
}

// 入口 2：带缓存的一次渲染
async function renderWithCache(req: Request, ctx: RequestContext): Promise<Response> {
  const cache = await resolveCache(ctx);              // 未配置 → Disabled；dev → Noop；否则 AstroCache
  const rule = matchRouteRule(ctx.pathname, ctx.manifest.cacheRules); // [param]/[...rest]，无 * 通配
  if (rule) cache.set(rule);                          // 规则作为初始值，页面可再 set 覆盖
  const provider = ctx.cacheProvider;                 // null 表示只出默认头
  const respond = async () => {
    const res = await renderPage(ctx);                // 页面内部可能再调用 cache.set(...)
    const options = cache.options;
    const headers = provider?.setHeaders?.(options, req) ?? defaultSetHeaders(options);
    return withHeaders(res, headers);                 // 最终响应前剥离 CDN-Cache-Control / Cache-Tag
  };
  return provider?.onRequest ? provider.onRequest({ request: req, url: ctx.url, logger: ctx.logger }, respond) : respond();
}

// 入口 3：失效
async function invalidate(cache: CacheLike, input: InvalidateOptions | LiveDataEntry): Promise<void> {
  if (!cache.enabled) throw new AstroError('CacheNotEnabled'); // 未配置提供方
  const options = 'cacheHint' in input ? { tags: input.cacheHint?.tags ?? [] } : input;
  await cache.invalidate(options);                    // 交给提供方；按 path 或 tags
}
```

### 12.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-12-01 | `session: { driver: sessionDrivers.fs() }` | 请求页面并设置 `session.set('cart', { n: 1 })`，随后带 cookie 再请求 | 首次响应带 `Set-Cookie: astro-session=<uuid>`（`HttpOnly`）；二次请求 `session.get('cart')` 返回 `{ n: 1 }`；`.astro/session` 下出现该 ID 对应条目 |
| A-12-02 | `session: false` | 访问页面并在服务端读取 `context.session` | `context.session` 为 `undefined`，页面不抛异常；SSR 产物中不含会话驱动与 runtime 代码（对比开启时的 bundle 体积） |
| A-12-03 | 驱动返回损坏数据（如非 devalue 字符串） | 带旧 cookie 请求 | 请求失败并在日志报 `SessionStorageInitError`（含驱动名）；该 cookie 被清除，后续请求按匿名处理 |
| A-12-04 | `session: { ttl: 60 }` | `set('cart', v)` 后等待超过 60 秒再读 | `session.get('cart')` 返回 `undefined`，cookie 仍在但条目已按 `expires` 过滤 |
| A-12-05 | `cache: { provider: { entrypoint: 'astro/cache/memory' } }`，`routeRules: { '/blog/[...slug]': { maxAge: 300, swr: 60 } }`；页面渲染时输出当前时间戳 | 连续两次请求 `/blog/a` | 两次响应体中的时间戳相同（第二次由提供方直接命中，未重渲染）；最终响应不含 `Cache-Tag` 与 `CDN-Cache-Control`（运行时提供方读取后剥离） |
| A-12-06 | 未配置 `cache.provider` | 页面调用 `cache.set({ maxAge: 60 })` 后再 `cache.invalidate({ tags: ['x'] })` | `cache.enabled` 为 `false`；`set()` 不抛错；`invalidate()` 抛 `CacheNotEnabled` 且不产生写操作 |
| A-12-07 | `cache.provider.entrypoint` 写成不存在的包名 | 执行 `astro dev` | 启动失败，报 `CacheProviderNotFound`，信息中含该 entrypoint 或配置的 `name` |
| A-12-08 | 已按 A-12-05 预热 | 页面调用 `cache.invalidate({ tags: ['blog'] })` 后再次请求同一路径 | 提供方收到带 `tags: ['blog']` 的失效调用；下一次请求按未命中处理，响应头重新生成 |
