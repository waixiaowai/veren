---
title: 错误码
description: "错误码是稳定契约：同一失败在任何入口（CLI、构建、开发期覆盖层、生产响应）都必须用同一个码，码名采用大驼峰且不随文案改动。下列集合是方案引用的全部码，均为实现中已有的名字；标注 拟议 的为本次补充，需先落地再引用。用户可见文案一栏给出语义要求，不是最终英文串"
sidebar:
  order: 19
  label: 错误码
draft: false
lastUpdated: 2026-11-04
---

## 19. Error Codes

错误码是稳定契约：同一失败在任何入口（CLI、构建、开发期覆盖层、生产响应）都必须用同一个码，码名采用大驼峰且不随文案改动。下列集合是方案引用的全部码，均为实现中已有的名字；标注"拟议"的为本次补充，需先落地再引用。用户可见文案一栏给出**语义要求**，不是最终英文串。

### 19.1 Error Code Table

| 码 | 含义 | 触发条件 | 可重试 | 用户可见文案要求 | 归属模块 |
| --- | --- | --- | --- | --- | --- |
| `UnknownConfigError` | 配置无法解析 | 配置文件语法错误或字段类型不符 | 否 | 指出文件、位置、字段与期望值 | `config` |
| `ConfigNotFound` | 配置入口不存在 | `--config` 指向不存在的文件 | 否 | 给出解析到的绝对路径与创建建议 | `config` |
| `EnvInvalidVariables` | 环境变量校验失败 | 变量缺失、类型不符、取值越界 | 否 | 列出变量名与期望类型，不回显值 | `config` |
| `EnvPrefixConflictsWithSecret` | 客户端变量与机密同名 | 前缀规则命中 `secret` 变量 | 否 | 指出冲突变量并建议改名 | `config` |
| `NoAdapterInstalled` | 缺少适配器 | `output: 'server'` 构建但未 `setAdapter` | 否 | 说明需要哪种适配器与安装方式 | `adapters` |
| `AdapterSupportOutputMismatch` | 适配器不支持该输出 | 适配器特性与 `buildOutput` 冲突 | 否 | 指出适配器名、声明的能力与所需能力 | `adapters` |
| `GetStaticPathsRequired` | 缺少静态路径 | 动态路由被预渲染但未导出 `getStaticPaths` | 否 | 指出路由文件与必需导出 | `build` |
| `NoMatchingStaticPathFound` | 静态路径未覆盖请求 | 请求的 pathname 不在预渲染集合内 | 是（换路径） | 开发期列出候选路径 | `build` |
| `PrerenderRouteConflict` | 预渲染路径冲突 | 两条路由产出同一文件 | 否 | 列出冲突路由与目标文件 | `build` |
| `InvalidPrerenderExport` | 预渲染声明非法 | `prerender` 导出不是布尔或位置错误 | 否 | 指出导出名与允许值 | `compile` |
| `PrerenderDynamicEndpointPathCollide` | 端点与页面路径碰撞 | 动态端点的静态路径与页面预渲染路径相同 | 否 | 列出碰撞的端点与页面路径 | `build` |
| `RouteNotFound` | 路由未命中 | 无匹配且无回退 | 是（换路径） | 404 页；开发期列出候选路由 | `routing` |
| `InvalidDynamicRoute` | 动态参数非法 | 参数缺失、编码错误、类型不符 | 否 | 指出参数名与期望格式 | `routing` |
| `MissingIndexForInternationalization` | 缺少语言首页 | 声明 i18n 但缺少默认语言入口 | 否 | 指出缺失路径与 `defaultLocale` | `routing` |
| `IncorrectStrategyForI18n` | 国际化策略冲突 | `routing: 'manual'` 同时配置了子项 | 否 | 列出冲突项并提供二选一说明 | `routing` |
| `InvalidRedirectDestination` | 重定向目标非法 | 目标非站内路径且未声明外部 | 否 | 指出源与目标，说明外部写法 | `routing` |
| `MissingLocale` | 语言不存在 | 内容或路由引用了未声明的语言 | 否 | 列出已声明语言 | `routing` |
| `MissingMiddlewareForInternationalization` | 缺少 i18n 中间件 | 手动路由模式下未挂载 i18n 中间件 | 否 | 指出需要挂载的中间件 | `routing` |
| `MiddlewareNoDataOrNextCalled` | 中间件未继续也未返回 | 中间件既没 `next()` 也没返回响应 | 否 | 指出中间件文件与行 | `render` |
| `MiddlewareNotAResponse` | 中间件返回类型错误 | 返回字符串、对象或 `undefined` | 否 | 指出返回值类型与期望 | `render` |
| `EndpointDidNotReturnAResponse` | 端点未返回响应 | 端点函数无返回值 | 否 | 指出端点文件 | `render` |
| `ResponseSentError` | 响应已开始仍写入 | 流式响应开始后修改头或状态 | 否 | 说明不可再修改响应 | `render` |
| `LocalsNotAnObject` | `locals` 被替换 | 赋值为 `null`、数组或原始值 | 否 | 说明只能合并属性 | `render` |
| `OnlyResponseCanBeReturned` | 页面返回值非法 | 页面返回非响应对象 | 否 | 指出页面与返回类型 | `render` |
| `ActionNotFoundError` | 动作不存在 | 请求了未注册的动作名 | 是（换动作） | 404；不回显动作清单 | `actions` |
| `ActionsReturnedInvalidDataError` | 动作返回不可序列化值 | 返回函数、类实例、循环引用 | 否 | 指出动作名与字段 | `actions` |
| `ActionsWithoutServerOutputError` | 静态输出下调用动作 | 无服务端运行时 | 否 | 说明需改为按需渲染并给配置片段 | `actions` |
| `ActionsCantBeLoaded` | 动作模块加载失败 | 模块抛错或语法错误 | 是（修复后） | 指出模块与首个错误 | `actions` |
| `SessionStorageInitError` | 会话存储初始化失败 | 驱动配置错误或存储不可达 | 条件（可达后可重试） | 指出驱动名与配置键 | `storage` |
| `SessionStorageSaveError` | 会话保存失败 | 写入超时、权限不足、容量满 | 是 | 说明会话未保存及影响范围 | `storage` |
| `CacheProviderNotFound` | 缓存提供方缺失 | 配置了 `cache.provider` 但解析失败 | 否 | 指出入口路径与解析错误 | `storage` |
| `CacheNotEnabled` | 缓存未启用却调用 | 未配置提供方即调用缓存 API | 否 | 说明启用方式与降级行为 | `storage` |
| `ContentCollectionMissingLoader` | 集合缺少加载器 | `defineCollection` 未给 `loader` | 否 | 指出集合名与文件 | `content` |
| `ContentEntryDataError` | 条目数据非法 | schema 校验失败、字段缺失 | 否 | 指出集合、条目 ID、字段与原因 | `content` |
| `InvalidContentEntryFrontmatterError` | 前言无法解析 | YAML/TOML 语法错误 | 否 | 指出文件与行列 | `content` |
| `NoMatchingRenderer` | 未找到渲染器 | 组件扩展名无对应渲染器 | 否 | 指出组件与已注册渲染器 | `integrations` |
| `NoClientEntrypoint` | 渲染器缺客户端入口 | 声明 `client:*` 但渲染器无入口 | 否 | 指出渲染器名与指令 | `integrations` |
| `ClientAddressNotAvailable` | 客户端地址不可用 | 适配器未提供或静态渲染 | 否 | 说明仅在按需渲染且适配器支持时可用 | `adapters` |
| `ImageNotFound` | 图片不存在 | 本地路径不存在或远程 404 | 是（修路径） | 指出源地址 | `assets` |
| `RemoteImageNotAllowed` | 远程图片被拒 | 主机不在 `remotePatterns` | 否 | 指出主机与配置项 | `assets` |
| `MissingSharp` | 缺少图片服务依赖 | 未安装可选依赖 | 否 | 给出安装命令 | `assets` |
| `CannotOptimizeSvg` | SVG 不可转换 | 试图把 SVG 转成位图格式 | 否 | 说明允许的输出格式 | `assets` |
| `UnsupportedImageFormat` | 图片格式不支持 | 输入或输出格式不在白名单 | 否 | 列出支持格式 | `assets` |
| `CouldNotTransformImage` | 图片转换失败 | 解码、缩放或编码阶段出错 | 是（修源图后） | 说明源地址与原图格式，生产期不含内部栈 | `assets` |
| `UnknownViteError` | 打包器内部错误 | 插件或配置导致打包失败 | 是（修复后） | 保留原始消息与插件名 | `server` |
| `FailedToLoadModuleSSR` | 服务端模块加载失败 | 依赖缺失、CJS/ESM 不兼容 | 是（修复后） | 指出模块与导入链 | `render` |
| `UnhandledRejection` | 未处理的异步拒绝 | 请求期出现未捕获 Promise | 是 | 记录请求 ID 与首个栈帧，响应不含栈 | `render` |
| `UnknownCompilerError` | 编译失败 | 组件语法或转换错误 | 否 | 文件、行列、片段、提示 | `compile` |
| `UnknownCLIError` | 命令执行失败 | 参数冲突、端口占用、作业失败 | 条件 | 说明失败动作与下一步 | `cli` |

### 19.2 Presentation

| 场景 | 呈现 | 必须包含 | 禁止包含 |
| --- | --- | --- | --- |
| CLI 失败 | 终端块：码、标题、提示、文档链接 | 可执行的下一步 | 完整栈（`--verbose` 除外） |
| 开发期编译/渲染失败 | 浏览器覆盖层 + 终端一行摘要 | 码、文件、行列、栈（应用内帧优先） | 环境变量值 |
| 生产期请求失败 | 500 页（可自定义） | 请求 ID、稳定码（写入日志） | 栈、源码路径、依赖版本 |
| 构建失败 | 摘要 + 首个致命错误 | 失败阶段、失败页、码 | 半成品"完成"提示 |

**命名差异**：内容层在实现中抛出的码为 `InvalidContentEntryDataError`，本方案统一写作 `ContentEntryDataError`（语义相同：条目未通过 schema 校验）。若代码需要精确引用，以实现中的名字为准；两者的映射记录在 [校验记录](/design/review/#306-naming-mapping)。

### 19.3 Retry and Idempotency

可重试码只对**读请求或幂等作业**成立：`NoMatchingStaticPathFound`（换路径）、`ImageNotFound`（修源）、`SessionStorageSaveError`（存储恢复后）、`UnhandledRejection`/`UnknownViteError`/`FailedToLoadModuleSSR`（修复后重建）。其余码重试无意义，必须修配置或代码。框架不对非幂等请求（POST 动作）做自动重试；适配器与宿主的重试策略必须在文档中显式声明，默认不重试。

### 19.4 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-19-01 | 任意错误 | 触发 | 终端/覆盖层/响应三处码一致，文案符合"发生了什么/为什么/下一步" |
| A-19-02 | 生产构建 | 制造 500 | 响应体无栈与绝对路径；日志含请求 ID 与码 |
| A-19-03 | 开发期语法错误 | 保存文件 | 覆盖层只显示一条主错误；修复后自动消失 |
| A-19-04 | 非幂等动作 | 客户端超时重发 | 框架不自动重试；重复执行由动作自身幂等键处理 |
| A-19-05 | 错误码表外的失败 | 触发未列出的异常 | 归一为 `UnhandledRejection` 或对应模块的 `Unknown*` 码，不新造未登记码 |
