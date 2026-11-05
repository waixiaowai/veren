---
title: 数据字典
description: "字段名是唯一标识：其他章节只引用，不重复定义。类型使用 TypeScript 记法；时间一律为毫秒时间戳（number），时长一律为秒并在 单位 列注明；URL 一律为绝对 URL，路径一律为以 / 开头的字符串"
sidebar:
  order: 21
  label: 数据字典
draft: false
lastUpdated: 2026-11-04
---

## 21. Data Dictionary

字段名是唯一标识：其他章节只引用，不重复定义。类型使用 TypeScript 记法；时间一律为毫秒时间戳（`number`），时长一律为秒并在"单位"列注明；URL 一律为绝对 `URL`，路径一律为以 `/` 开头的字符串。

### 21.1 ProjectConfig

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 所属主体 | 可见性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | `URL` | 是 | 绝对目录 | 进程 cwd | — | `project` | 服务端 |
| `srcDir` | `URL` | 是 | 相对 `root` | `./src` | — | `project` | 服务端 |
| `publicDir` | `URL` | 是 | 相对 `root` | `./public` | — | `project` | 服务端 |
| `outDir` | `URL` | 是 | 相对 `root` | `./dist` | — | `project` | 服务端 |
| `cacheDir` | `URL` | 是 | 相对 `root` | `./node_modules/.astro` | — | `project` | 服务端 |
| `site` | `URL \| undefined` | 否 | 绝对 URL | 无 | — | `project` | 服务端/客户端（进入规范链接） |
| `base` | `string` | 是 | `/` 开头与结尾 | `/` | — | `project` | 双端 |
| `trailingSlash` | `'always' \| 'never' \| 'ignore'` | 是 | 枚举 | `'ignore'` | — | `project` | 双端 |
| `output` | `'static' \| 'server'` | 是 | 枚举 | `'static'` | — | `project` | 双端 |
| `adapter` | `AstroAdapter \| undefined` | 否 | 由集成 `setAdapter` 注入 | 无 | — | `adapter` | 服务端 |
| `redirects` | `Record<string, RedirectConfig>` | 是 | 源路径 → `{ status, destination }` | `{}` | — | `project` | 双端 |
| `security.checkOrigin` | `boolean` | 是 | 布尔 | `true` | — | `project` | 服务端 |
| `security.allowedDomains` | `RemotePattern[]` | 是 | 主机模式数组 | `[]` | — | `project` | 服务端 |
| `security.csp` | `CspConfig \| undefined` | 否 | 指令、哈希、资源 | 关闭 | — | `project` | 双端（头部/元信息） |
| `session` | `SessionConfig \| false` | 是 | `{ driver, options, cookie, ttl }` 或 `false` | 未配置=关闭 | `ttl` 秒 | `project` | 服务端 |
| `cache.provider` | `CacheProviderConfig \| undefined` | 否 | `{ entrypoint, config }` | 无 | — | `project` | 服务端 |
| `routeRules` | `RouteRules` | 是 | 模式 → `{ maxAge, swr, tags }` | `{}` | `maxAge`/`swr` 秒 | `project` | 服务端 |
| `i18n.locales` | `Locales` | 否 | 语言码数组或 `{path,codes}` | 无 | — | `project` | 双端 |
| `i18n.defaultLocale` | `string` | 条件 | 必须是 `locales` 成员 | 无 | — | `project` | 双端 |
| `i18n.fallback` | `Record<string,string>` | 否 | 语言 → 回退语言 | 无 | — | `project` | 服务端 |
| `i18n.routing` | `object \| 'manual'` | 否 | 前缀与回退策略 | `{}` | — | `project` | 服务端 |
| `image.remotePatterns` | `RemotePattern[]` | 是 | 协议/主机/端口/路径 | `[]` | — | `project` | 服务端 |
| `image.endpoint.route` | `string` | 是 | `/` 开头 | `/_image` | — | `project` | 双端 |
| `env.schema` | `Record<string, EnvField>` | 是 | 四象限变量 | `{}` | — | `project` | 按象限 |
| `build.format` | `'file' \| 'directory' \| 'preserve'` | 是 | 枚举 | `'directory'` | — | `project` | 服务端 |
| `build.client` / `build.server` | `string` | 是 | 相对 `outDir` | `./client` / `./server` | — | `project` | 服务端 |
| `prefetch` | `boolean \| { prefetchAll, defaultStrategy }` | 是 | 枚举策略 | `false` | — | `project` | 客户端 |

### 21.2 RouteRecord

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 所属主体 | 可见性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 源文件相对路径或注入标识 | — | — | `project` | 服务端 |
| `route` | `string` | 是 | `/` 开头，含 `[param]`/`[...rest]` | — | — | `project` | 服务端 |
| `pattern` | `RegExp` | 是 | 已含 `base` 与尾斜杠策略 | — | — | `project` | 服务端 |
| `segments` | `RouteSegment[]` | 是 | 静态/动态/剩余部分 | — | — | `project` | 服务端 |
| `params` | `string[]` | 是 | 参数名，按出现顺序 | `[]` | — | `project` | 服务端 |
| `pathname` | `string \| undefined` | 否 | 仅静态路由 | 无 | — | `project` | 服务端 |
| `type` | `'page' \| 'endpoint' \| 'redirect' \| 'fallback'` | 是 | 枚举 | — | — | `project` | 服务端 |
| `prerender` | `boolean` | 是 | 路由导出优先 | 由 `output` 推导 | — | `project` | 服务端 |
| `component` | `string` | 是 | 模块标识 | — | — | `project` | 服务端 |
| `origin` | `'filesystem' \| 'injected' \| 'internal' \| 'i18n-fallback'` | 是 | 枚举 | — | — | `project` | 服务端 |
| `fallbackRoutes` | `RouteRecord[]` | 是 | 按优先级排序 | `[]` | — | `project` | 服务端 |

### 21.3 Content and Actions

| 实体.字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 所属主体 | 可见性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ContentCollection.name` | `string` | 是 | 目录名或显式名 | — | — | `project` | 服务端 |
| `ContentCollection.type` | `'content' \| 'data' \| 'live'` | 是 | 枚举 | `'content'` | — | `project` | 服务端 |
| `ContentCollection.loader` | `Loader` | 是 | `glob()`/`file()`/自定义/live | — | — | `project` | 服务端 |
| `ContentCollection.schema` | `ZodType \| (ctx) => ZodType` | 否 | 字段校验 | 无（不校验） | — | `project` | 服务端 |
| `ContentEntry.id` | `string` | 是 | 集合内唯一 | — | — | `project` | 服务端 |
| `ContentEntry.collection` | `string` | 是 | 所属集合名 | — | — | `project` | 服务端 |
| `ContentEntry.data` | `Record<string, unknown>` | 是 | 通过 schema 校验 | — | — | `project` | 按字段声明 |
| `ContentEntry.body` | `string \| undefined` | 否 | 原文（可关闭保留） | 保留 | — | `project` | 服务端 |
| `ContentEntry.filePath` | `string \| undefined` | 否 | 根相对路径 | 无 | — | `project` | 服务端 |
| `ContentEntry.digest` | `string` | 是 | 内容指纹 | — | — | `project` | 服务端 |
| `ActionDefinition.name` | `string` | 是 | 可含一层命名空间 | — | — | `project` | 双方（客户端只知名字） |
| `ActionDefinition.input` | `ZodType \| undefined` | 否 | 无输入时省略 | 无 | — | `project` | 服务端 |
| `ActionDefinition.accept` | `'form' \| 'json'` | 是 | 枚举 | `'json'` | — | `project` | 双端 |
| `ActionDefinition.handler` | `(input, ctx) => Promise<unknown>` | 是 | 返回值必须可序列化 | — | — | `project` | 服务端 |

### 21.4 Runtime and Build

| 实体.字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 所属主体 | 可见性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SSRManifest.routes` | `RouteRecord[]` | 是 | 已排序 | — | — | `project` | 服务端 |
| `SSRManifest.assets` | `Map<string, string[]>` | 是 | 源 → 产物 URL | `{}` | — | `project` | 服务端 |
| `SSRManifest.entryModules` | `Record<string, string>` | 是 | 入口名 → 模块 | — | — | `project` | 服务端 |
| `SSRManifest.base` | `string` | 是 | 与设定一致 | `/` | — | `project` | 服务端 |
| `SSRManifest.sessionDriver` | `string \| undefined` | 否 | 驱动模块标识 | 无 | — | `project` | 服务端 |
| `SSRManifest.cacheProvider` | `string \| undefined` | 否 | 提供方模块标识 | 无 | — | `project` | 服务端 |
| `PageBuildData.dependencies` | `string[]` | 是 | 绝对路径 | `[]` | — | `project` | 服务端 |
| `PageBuildData.lastBuiltAt` | `number \| undefined` | 否 | 毫秒时间戳 | 无 | ms | `project` | 服务端 |
| `SessionRecord.id` | `string` | 是 | 加密随机串 | — | — | `visitor` | 服务端（cookie 只存 ID） |
| `SessionRecord.data` | `Record<string, unknown>` | 是 | 可 JSON 序列化 | `{}` | — | `visitor` | 服务端 |
| `SessionRecord.ttl` | `number` | 是 | 正整数 | 设定值 | 秒 | `project` | 服务端 |
| `CacheRule.maxAge` | `number` | 否 | ≥0 | 无 | 秒 | `project` | 服务端 |
| `CacheRule.swr` | `number` | 否 | ≥0 | 无 | 秒 | `project` | 服务端 |
| `CacheRule.tags` | `string[]` | 否 | 失效标签 | `[]` | — | `project` | 服务端 |
| `Diagnostic.code` | `string` | 是 | 错误码表内的码 | — | — | 产生方模块 | 双方 |
| `Diagnostic.severity` | `'error' \| 'warning' \| 'hint'` | 是 | 枚举 | `'error'` | — | 产生方模块 | 双方 |
| `Diagnostic.file` / `line` / `column` | `string` / `number` / `number` | 是 | 1 基行列 | — | — | 产生方模块 | 双方 |
| `ToolbarAppMeta.id` | `string` | 是 | `<ns>:<name>` | — | — | `integration` | 开发期 |
| `ToolbarAppMeta.builtIn` | `boolean` | 是 | 是否内置 | `false` | — | `project` | 开发期 |
| `DevToolbarSettings.placement` | `'bottom-left' \| 'bottom-center' \| 'bottom-right'` | 是 | 枚举 | `'bottom-center'` | — | `visitor` | 客户端 |
| `DevToolbarSettings.disableAppNotification` | `boolean` | 是 | 布尔 | `false` | — | `visitor` | 客户端 |
| `DevToolbarSettings.verbose` | `boolean` | 是 | 布尔 | `false` | — | `visitor` | 客户端 |

### 21.5 Consistency Rules

1. `RouteRecord.prerender` 与 `PageBuildData.prerender` 必须一致；不一致视为实现缺陷，不得以其中一方为准继续。
2. `ProjectConfig.base` 同时出现在路由模式与资源 URL 中，任何一处缺失都会导致 404，必须在构建清单中交叉校验。
3. `SessionRecord.ttl` 与 cookie 的 `maxAge` 不要求相等，但 cookie 不得长于 `ttl`（否则出现"有 cookie 无会话"）。
4. `CacheRule.tags` 是失效的唯一入口；没有 tag 的规则只能按路径失效。
5. 同一字段在不同模块的类型与必填性以本节为准；模块契约中不得出现更宽的类型。

### 21.6 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-21-01 | 任意构建 | 检查清单 | 清单中的 `base`、`trailingSlash`、路由顺序与设定一致 |
| A-21-02 | 内容集合含非法字段 | `astro sync` | `ContentEntryDataError` 指出集合、条目、字段；存储不写入非法条目 |
| A-21-03 | 配置 `ttl` 小于 cookie `maxAge` | 启动 | 配置校验拒绝或自动收紧 cookie，并给出告警 |
| A-21-04 | 路由规则含标签 | 失效该标签 | 只失效带该标签的缓存项，其余不受影响 |
| A-21-05 | 会话数据含不可序列化值 | 写入会话 | 立即失败并指出字段，不静默丢弃 |
