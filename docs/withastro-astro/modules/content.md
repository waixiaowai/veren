---
title: 内容层
description: "Content 拥有 集合定义、条目来源、条目数据校验与查询 的全部决策；它不拥有路由、不拥有渲染管线，也不决定页面长什么样"
sidebar:
  order: 10
  label: 内容层
draft: false
lastUpdated: 2026-11-04
---

## 10. Content

Content 拥有"集合定义、条目来源、条目数据校验与查询"的全部决策；它不拥有路由、不拥有渲染管线，也不决定页面长什么样。

### 10.1 Duties

| 维度 | 内容 |
| --- | --- |
| 输入 | `src/content.config.ts` 中的 `defineCollection()`、`src/live.config.ts` 中的 `defineLiveCollection()`、加载器（`glob()`/`file()`/自定义 `Loader`/`LiveLoader`）、zod schema、文件系统或远端数据源 |
| 输出 | `getCollection()`/`getEntry()`/`getEntries()` 返回的条目对象、`render()` 返回的可渲染组件、`.astro/data-store.json` 持久化数据存储、`content.d.ts` 类型声明 |
| 不负责 | URL 与路由（[路由表](/design/modules/routing/#41-duties)）；`Content` 组件的实际渲染（[请求渲染](/design/modules/render/#65-flow)）；图片变换本身（[Assets](/design/modules/assets/#93-contracts)；内容层只把图片字段解析成 `ImageMetadata`） |
| 相邻模块 | 上游是 [配置解析](/design/modules/config/#32-capabilities)（定位内容目录、注册内容加载器）；下游是页面与端点消费查询结果；`astro sync` 与构建都会驱动内容同步 |
| 数据所有权 | 拥有**集合元数据与条目数据存储**（含同步令牌 `meta`）；不拥有业务实体（页面、动作、会话都不在它这里） |
| 决策权 | 独占两项决策：某条目数据是否通过 schema、条目在集合内的 `id` 与摘要（`digest`）是否变化 |

### 10.2 Capabilities

内容层把"来源"（loader）与"形状"（schema）解耦：`defineCollection()` 声明一个集合，`type` 取 `content_layer`（需 `loader`）、`data`（纯数据）、`content`（旧式目录约定）之一；`defineLiveCollection()` 声明 live 集合，**必须**写在 `src/live.config.ts`，否则抛出配置错误。构建或 `astro sync` 时，每个集合的 loader 拿到 `LoaderContext`，用 `store` 写入条目、用 `meta` 记录同步令牌、用 `parseData()` 按 schema 校验、用 `generateDigest()` 判断是否变更、用 `renderMarkdown()` 预渲染。校验失败即为 `ContentEntryDataError`（消息含集合名、条目 `id` 与 zod 字段路径；集合缺少可用加载器时另有 `ContentCollectionMissingLoader`）。

| 关注点 | 规则 |
| --- | --- |
| 集合类型 | `content_layer` 必须给 `loader`；`content` 不允许给 `loader`；`data` 为无 loader 的纯数据集合（仍可声明 schema）；`live` 走 `LiveLoader` 且不落数据存储 |
| 加载器 | 内置 `glob()`（按 `pattern`/`base` 匹配文件，可配 `generateId`、`retainBody`、`deferRender`）与 `file()`（单文件多条目）；自定义加载器只需实现 `{ name, load }`，可选自带 `schema` |
| 数据存储 | 写入 `.astro/data-store.json` 与 `data-store/` 分块，条目字段为 `id`/`data`/`filePath`/`body`/`digest`/`rendered`/`assetImports`/`imageImports`；读取侧为不可变存储，集合按需加载 |
| 查询 | `getCollection(name, filter?)` 支持函数或对象过滤；`getEntry(name, idOrSlug)`、`getEntries([...])`；条目不存在时返回 `undefined` 并打印告警，不抛错 |
| 渲染 | `render(entry)` 返回 `{ Content, headings, remarkPluginFrontmatter }`；延迟渲染的条目在首次 `render()` 时才载入模块 |
| live 集合 | `getLiveCollection(name, filter)`/`getLiveEntry(name, filter)` 每次请求直连数据源，成功返回条目（可带 `cacheHint.tags`/`lastModified`），失败返回 `{ error }` 而不抛错 |
| 同步 | `astro sync` 生成 `content.d.ts`、写数据存储；dev 下由文件监听器与 HMR 触发增量同步，`digest` 未变的条目不重写 |
| 与缓存协作 | live 条目的 `cacheHint` 会被 [运行时存储](/design/modules/storage/#122-capabilities) 的 `cache.set(entry)` 转成 `CacheOptions` |

### 10.3 Contracts

```ts
type CollectionType = 'content_layer' | 'data' | 'content' | 'live';
type CacheHint = { tags?: string[]; lastModified?: Date };
type MarkdownHeading = { depth: number; slug: string; text: string };
type RenderedContent = { html: string; metadata?: { imagePaths?: string[]; headings?: MarkdownHeading[];
                          frontmatter?: Record<string, unknown> } };
interface ContentEntry<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string;                  // 集合内唯一，默认由文件路径派生
  collection: string;
  data: TData;                 // 通过 schema 校验后的数据
  filePath?: string;           // 相对站点根
  body?: string;               // retainBody 为 false 且有解析器时缺省
  digest?: string | number;    // 变更判定依据
  rendered?: RenderedContent;
  assetImports?: string[];
  deferredRender?: boolean;    // 延迟渲染标记
}
interface LoaderContext {
  collection: string;
  store: DataStore;            // set/get/entries/values/keys/delete/clear/has
  meta: MetaStore;             // 同步令牌等 KV
  logger: { info(m: string): void; warn(m: string): void };
  config: ProjectConfig;
  parseData<T extends Record<string, unknown>>(p: { id: string; data: T; filePath?: string }): Promise<T>;
  renderMarkdown(content: string): Promise<RenderedContent>;
  generateDigest(data: Record<string, unknown> | string): string;
  watcher?: unknown;           // dev 下可用，用于监听外部变更
  refreshContextData?: Record<string, unknown>;
}
interface Loader {
  name: string;                // 'glob'、'file' 或包名
  load(context: LoaderContext): Promise<void>;
  schema?: ZodType;            // 可被用户 schema 覆盖
  createSchema?(): Promise<{ schema: ZodType; types: string }>;
}
interface LiveLoader<TData extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  loadEntry(ctx: { collection: string; filter: { id: string } | Record<string, unknown> }):
    Promise<{ id: string; data: TData; cacheHint?: CacheHint } | undefined | { error: Error }>;
  loadCollection(ctx: { collection: string; filter?: Record<string, unknown> }):
    Promise<{ entries: Array<{ id: string; data: TData; cacheHint?: CacheHint }>; cacheHint?: CacheHint } | { error: Error }>;
}
interface CollectionDefinition<TData extends Record<string, unknown>> {
  type: CollectionType;
  schema?: ZodType<TData> | ((context: { image: () => ZodType }) => ZodType<TData>);
  loader?: Loader;             // 仅 content_layer 必填
}
type LiveCollectionResult<TData> =
  | { entries: ContentEntry<TData>[]; error?: undefined }
  | { entries?: undefined; error: Error };  // 实为 LiveCollectionError 及其子类
type RenderResult = { Content: unknown; headings: MarkdownHeading[]; remarkPluginFrontmatter: Record<string, unknown> };
```

错误约定：本地集合在同步与校验阶段**抛** `AstroError`，数据不满足 schema 时为 `ContentEntryDataError`（消息内含集合名、条目 `id`、zod 字段路径，并尽量附带文件与行号）；缺少可用加载器的集合报 `ContentCollectionMissingLoader`。live 集合**不抛**，一律折叠成 `{ error }` 由调用方判断。

### 10.4 Flow

伪代码给出三条主路径：同步（写存储）、查询（读存储并渲染）、live 直连；重点是参数传递与失败出口。

```ts
// 入口 1：同步，由 astro sync / build / dev 触发
async function syncCollections(defs: Record<string, CollectionDefinition<unknown>>, ctx: SyncContext): Promise<void> {
  for (const [collection, def] of Object.entries(defs)) {
    if (def.type === 'live') continue;                        // live 不落存储
    if (def.type === 'content_layer' && !def.loader) throw new AstroError('ContentCollectionMissingLoader');
    const loaderCtx = {
      collection, store: ctx.store.forCollection(collection), meta: ctx.meta.forCollection(collection), logger: ctx.logger, config: ctx.config,
      parseData: async ({ id, data, filePath }) => {
        const parsed = await def.schema.safeParseAsync(data);
        if (!parsed.success) throw new AstroError('ContentEntryDataError'); // 字段路径进 hint
        return parsed.data;
      },
      renderMarkdown: ctx.renderMarkdown, generateDigest: ctx.digest, watcher: ctx.watcher, entryTypes: ctx.entryTypes,
    };
    await def.loader.load(loaderCtx);                          // loader 内部按 digest 决定是否重写
    await ctx.store.flush();                                   // 写入 data-store.json 与分块
  }
  await ctx.writeTypes('content.d.ts');                        // 同步生成类型声明
}

// 入口 2：查询并渲染
async function getCollection<T>(name: string, filter?: ((e: ContentEntry<T>) => unknown) | Partial<T>): Promise<ContentEntry<T>[]> {
  if (isLive(name)) throw collectionTypeMismatch(name);        // 用错 API：提示改用 getLiveCollection
  if (!(await store.hasCollection(name))) return [];           // 未知集合返回空数组，不抛错
  const entries = await store.values<ContentEntry<T>>(name);
  const resolved = entries.map((e) => ({ ...e, data: resolveImages(e.data, e.imageImports) }));
  return typeof filter === 'function' ? resolved.filter(filter) : resolved.filter(matchesObject(filter));
}
async function renderEntry(entry: ContentEntry): Promise<RenderResult> {
  if (!entry) throw new AstroError('ContentEntryDataError');   // 调用方传了 undefined
  if (entry.deferredRender) return renderFromModule(entry.filePath); // 首次渲染才载入模块
  const meta = entry.rendered.metadata;
  return { Content: htmlComponent(entry.rendered.html), headings: meta?.headings ?? [], remarkPluginFrontmatter: meta?.frontmatter ?? {} };
}
// 入口 3：live 集合（每请求直连数据源）
async function getLiveEntry<T>(name: string, filter: Record<string, unknown>): Promise<LiveCollectionResult<T>> {
  const loader = liveLoaders[name];
  if (!loader) return { error: new Error('not a live collection') };
  const res = await loader.loadEntry({ collection: name, filter });
  if (res && 'error' in res) return { error: res.error };      // 数据源失败原样上抛给页面
  if (!res) return { entries: [] };                            // 未命中按空集处理
  const checked = await liveSchemas[name]?.safeParseAsync(res.data);
  return checked?.success === false
    ? { error: checked.error }                                 // 校验失败同样折叠
    : { entries: [{ id: res.id, collection: name, data: res.data }] };
}
```

### 10.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-10-01 | `src/content.config.ts` 定义 `blog` 集合：`loader: glob({ pattern: '**/*.md', base: './src/data/blog' })`，schema 含 `title: z.string()` | 执行 `astro sync` | 生成 `content.d.ts`；`.astro/data-store.json` 记录全部条目；条目数与目录下 `.md` 文件数一致 |
| A-10-02 | 同上，某条目缺 `title` | 执行 `astro build` | 构建失败，报 `ContentEntryDataError`，提示定位到该集合/条目与字段路径，该条目对应页面未生成 |
| A-10-03 | 项目只定义了 `blog` 集合 | 页面对不存在的集合调用 `getCollection('post')` | 返回空数组 `[]`，日志出现"集合不存在或为空，请检查内容配置文件"的告警，页面继续渲染不中断 |
| A-10-04 | 已同步的 `blog` 集合，仅修改一个条目的正文并保持 frontmatter 不变 | 在 dev 下保存文件 | 该条目 `digest` 变化并重渲染；其余条目 `digest` 不变、不重写存储（对比 `data-store.json` 时间戳） |
| A-10-05 | `src/live.config.ts` 定义 `products` live 集合，其 loader 对未知 `id` 返回空 | 页面对不存在的 `id` 调用 `getLiveEntry('products', { id: 'nope' })` | 返回 `{ entries: [] }` 或 `{ error }` 之一，页面不抛未捕获异常；HTTP 状态由页面自行决定 |
| A-10-06 | 对 live 集合调用 `getCollection('products')` | 触发该调用 | 立即抛错并提示改用 `getLiveCollection()`，不产生额外数据源请求 |
