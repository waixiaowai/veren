---
title: 服务端接口
description: "框架对外的 服务端接口 只有四类：动作入口、图片入口、Server Islands 入口，以及开发期的两条通道（工具栏与热更新）。其余能力（路由、渲染、构建）都是进程内调用，不构成 HTTP 契约。适配器服务入口属于宿主契约而非 HTTP 接口，单列于此以避免把它误当公开 API"
sidebar:
  order: 17
  label: 服务端接口
draft: false
lastUpdated: 2026-11-04
---

## 17. Server API

框架对外的"服务端接口"只有四类：动作入口、图片入口、Server Islands 入口，以及开发期的两条通道（工具栏与热更新）。其余能力（路由、渲染、构建）都是进程内调用，不构成 HTTP 契约。适配器服务入口属于**宿主契约**而非 HTTP 接口，单列于此以避免把它误当公开 API。

权限口径统一见 [权限矩阵](/design/permissions/#183-permission-matrix)，错误语义统一引用 [错误码](/design/errors/#191-error-code-table)，本节只写接口事实与差异。

### 17.1 API-01 Actions RPC

**用途**：把服务端动作以单一入口暴露给浏览器，附带输入校验、结果序列化与结构化错误。**模块**：`actions`（分发）/`render`（执行管线）。**路径**：`/_actions/[...path]`，`path` 为动作名（可含一层命名空间，如 `blog/like`）。**方法**：`POST`。**协议**：JSON 或表单，取决于动作的 `accept`。

| 位置 | 字段 | 类型 | 必填 | 校验 |
| --- | --- | --- | --- | --- |
| path | `path` | string | 是 | 必须已注册；未知动作 → 404 |
| header | `Content-Type` | string | 是 | `application/json` 或 `application/x-www-form-urlencoded`/`multipart/form-data` |
| header | `Origin`/`Sec-Fetch-Site` | string | 否 | 跨站表单提交 → 403 |
| body | 动作输入 | 依 schema | 依 schema | 由动作的输入 schema 校验；体积超限 → 413 |

响应：成功 `200`，`content-type: application/json+devalue`（或表单可接受的结构化结果），语义为 `{ data: T }`；校验失败 `422`，`{ error: { code, message, fields } }`；未知动作 `404`；处理函数抛业务错误时按错误码到状态的映射返回 4xx/5xx；无返回内容 `204`。响应不得包含栈或源码路径。

**幂等与缓存**：默认不缓存、不重放；同一请求重复提交由动作实现自行保证幂等（框架只保证"一次请求执行一次"）。**限制**：仅在 `output: 'server'` 下可用，静态输出下调用即 `ActionsWithoutServerOutputError`；服务端代码禁止通过 HTTP 调用自身动作（`ActionCalledFromServerError`）。

### 17.2 API-02 Image Endpoint

**用途**：为按需渲染与开发期提供按参数转换后的图片。**模块**：`assets`。**路径**：默认为 `/_image`，可由 `image.endpoint.route` 改写。**方法**：`GET`（`HEAD` 等价，不返回体）。

| 位置 | 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| query | `href` | string | 是 | 源图 URL；本地路径或已列入 `remotePatterns` 的远程地址 |
| query | `w` | number | 否 | 目标宽度，正整数；与 `h` 至少给一个 |
| query | `h` | number | 否 | 目标高度，正整数 |
| query | `f` | string | 否 | `webp`/`avif`/`png`/`jpg` 等；转 SVG 一律拒绝 |
| query | `q` | number | 否 | 质量，取值由服务定义（通常 0–100） |

响应：`200` 返回 `content-type: image/*`、`etag`、`cache-control`（内容指纹稳定时为长缓存）；`400` 参数非法；`403` 远程源不在允许列表或试图转出 SVG；`404` 源不存在（`ImageNotFound`）；`415` 不支持的输入格式（`UnsupportedImageFormat`）；`500` 转换失败（`CouldNotTransformImage`，生产期不含内部细节）。

**幂等与缓存**：同一组参数必须产出字节相同的响应，因此可被 CDN 与浏览器长期缓存；参数变化即换 URL，不做 `Vary` 协商。

### 17.3 API-03 Server Islands

**用途**：让页面中的局部片段在请求期单独渲染并回填，页面其余部分仍可静态缓存。**模块**：`render`（入口）/`compile`（占位生成）。**路径**：`/_server-islands/[name]`。**方法**：`GET`。**参数**：`e`（加密的组件导出名）、`p`（加密的属性）、`s`（加密的插槽），均为 URL 查询参数，由构建期生成的密钥加密。

响应：`200` 返回该片段的 HTML 片段与必要的样式/脚本引用；解密失败或参数缺失 `400`；组件不存在 `404`；渲染失败 `500`（生产期不含栈）。响应默认 `cache-control: no-store`，除非页面路由规则显式允许缓存。

**安全**：密钥只存在于构建与服务进程，不写入客户端；加密载荷必须带完整性校验，禁止把明文组件路径直接暴露为可调用入口。

### 17.4 API-04 Toolbar Channel

**用途**：在开发期让工具栏应用与服务端集成双向通信（初始化、开关、自定义事件）。**模块**：`server`（宿主）/`integrations`（注册）。**载体**：开发服务器的 WebSocket 通道，事件名形如 `astro-dev-toolbar:<appId>:initialized`、`astro-dev-toolbar:<appId>:toggled`，自定义事件由集成与服务端约定。**方法**：WebSocket 消息（非 HTTP 路由）。

载荷：`{ appId: string, event: string, payload?: unknown }`，`payload` 必须可 JSON 序列化；单条消息上限 64 KiB（待确认：具体上限以实现为准）。**认证**：仅开发模式、仅本机来源可用；生产构建不注入该通道。**错误**：未知应用的事件被忽略并记录 debug 日志，不抛错中断连接。

### 17.5 API-05 HMR Channel

**用途**：把模块更新、整页重载与错误载荷推给浏览器。**模块**：`server`。**载体**：开发服务器 WebSocket；消息分三类：`update`（模块列表）、`reload`（原因）、`error`（覆盖层载荷）。载荷结构见 [Server 契约](/design/modules/server/#83-contracts)。**认证**：仅开发模式；不暴露给生产构建。

**幂等**：客户端对同一模块的重复更新必须以最后一次为准；`error` 之后必须能接收后续 `update` 并清除覆盖层。

### 17.6 API-06 Error Payload

**用途**：把编译/渲染失败转成覆盖层可渲染的数据，同时保留终端可读输出。**模块**：`server`（生成）/开发者界面（消费）。**载荷**：`{ code, title, hint?, stack[], location? }`，`stack` 每帧含 `file`、`line`、`column`、`isApplication`。**约束**：只含一条主错误（避免弹窗风暴）；同一文件连续失败覆盖前一条；不包含环境变量与机密值。

### 17.7 API-07 Adapter Entry

**用途**：宿主（Node 服务器、Serverless 函数、Edge Worker）调用产物的唯一入口。**模块**：`adapters`。**形态**：模块导出（非 HTTP 路由），由适配器在 `astro:config:done` 声明入口；内核提供 `App`（`match`/`render`）与清单（`SSRManifest`）。

| 约定 | 内容 |
| --- | --- |
| 输入 | 标准 `Request`（或宿主事件，由适配器转换） |
| 输出 | 标准 `Response`（含流式体） |
| 生命周期 | 每次请求一次；模块级状态需自行保证并发安全 |
| 必读清单 | 路由表、资源清单、`base`/`trailingSlash`、i18n、会话驱动、缓存提供方 |
| 能力声明 | `staticOutput`/`hybridOutput`/`serverOutput`/`i18nDomains`/`envGetSecret`/`sharpImageService`，不支持的组合在构建期报错或告警 |

**失败语义**：入口抛错时宿主负责 500；入口不得把内部错误吞掉返回 200。**幂等**：GET 可缓存，非 GET 由应用语义决定，框架不做隐式重试。

### 17.8 API Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-17-01 | 已注册动作 `login` | `POST /_actions/login` 合法体 | 200，`data` 为动作返回值；响应头含内容类型且无栈 |
| A-17-02 | 同上 | 缺少必填字段 | 422，`fields` 指出字段路径；处理函数未执行 |
| A-17-03 | 静态输出项目 | 调用任意动作 | 404/500 且码为 `ActionsWithoutServerOutputError`，提示改为按需渲染 |
| A-17-04 | 远程图片不在 `remotePatterns` | 请求 `/_image?href=外部地址` | 403，`RemoteImageNotAllowed` 语义，不发起外部请求 |
| A-17-05 | Server Islands 页面 | 请求片段 URL 并篡改 `p` | 400，片段不渲染，页面其他部分不受影响 |
| A-17-06 | 生产构建 | 请求 `/_actions/*` 之外的内部路径 | 内部路径不暴露；工具栏与热更新通道不存在 |
