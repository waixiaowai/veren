---
title: 请求渲染
description: "render 是运行期唯一的请求入口：它拿一条已匹配路由与一个标准请求，依次执行中间件、装配上下文（Cookie、会话、缓存、CSP、动作结果），调用编译产物渲染，最后返回一个标准响应。它不决定路由、不写文件；与 server 的分界是：render 是纯请求→响应，server 负责把这条链路接到本地端口、热更新与覆盖层上"
sidebar:
  order: 6
  label: 请求渲染
draft: false
lastUpdated: 2026-11-04
---

## 6. Render

`render` 是运行期唯一的请求入口：它拿一条已匹配路由与一个标准请求，依次执行中间件、装配上下文（Cookie、会话、缓存、CSP、动作结果），调用编译产物渲染，最后返回一个标准响应。它不决定路由、不写文件；与 `server` 的分界是：`render` 是纯请求→响应，`server` 负责把这条链路接到本地端口、热更新与覆盖层上。

### 6.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 构造 `RenderContext`（请求、URL、参数、locals、Cookie、会话、缓存、CSP） | 匹配路由（委托 `routing`） |
| 按顺序执行用户中间件与集成中间件 | 编译组件（委托 `compile`） |
| 跨站表单提交检查（403）、重定向、重写的执行 | 动作函数的业务实现（委托 `actions`） |
| 动作结果注入、Server Islands 响应、响应头与状态码 | 会话与缓存的持久化实现（委托 `storage`） |
| 错误兜底：开发期交覆盖层、生产期交 500 页 | 产物目录与适配器入口（委托 `build`/`adapters`） |

### 6.2 Invariants

渲染域的三条铁律决定"响应是否可信"：

| 铁律 | 理由 | 违反后果 |
| --- | --- | --- |
| 一次请求只允许一个响应 | 多次写入会撕裂响应头与体 | 客户端收到半截 HTML 或矛盾状态码 |
| 中间件必须继续或返回 | 两者都不做会让请求悬挂 | 连接不关闭，健康检查超时 |
| 错误不吞：要么 5xx，要么明确码 | 吞错会让失败被当成成功 | 监控失真，用户看到空白页 |

恢复策略：响应开始前的失败可改渲染错误页并保留稳定码；响应开始后只允许终止流、记录请求 ID，不再尝试改写状态码。

### 6.3 Capabilities

一次渲染的顺序是固定的：**规范化请求 → 跨站检查 → 中间件链 → 路由渲染（页面/端点/重定向）→ 动作结果注入 → 响应后处理（Cookie、缓存头、CSP 头）→ 错误兜底**。中间件是 `(ctx, next) => Response` 的组合，必须调用 `next()` 或直接返回响应，两者都不做即失败；`locals` 是请求级可变对象，跨中间件共享，但不得被替换为非对象。页面渲染接收 `params`、`props`、`locals` 与插槽；端点必须返回 `Response`。动作请求（`/_actions/*`）在中间件之后、页面渲染之前被识别：校验输入 → 调用处理函数 → 序列化为 JSON 或表单可接受的结果 → 以响应返回；同时在 `locals` 中保留动作结果，供随后的页面渲染通过 `getActionResult` 读取。响应后处理负责三件事：把 Cookie 变更写入 `Set-Cookie`；按 `routeRules` 与缓存提供方写入缓存头并调用失效逻辑；把本页收集到的 CSP 指令渲染为头部（或 meta 形式）。预渲染页面在构建期走同一渲染函数，但跳过服务器专属能力（客户端地址、会话写入），并在用到时立即失败而不是返回空值。

### 6.4 Contracts

```ts
interface RenderContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  props: Record<string, unknown>;
  locals: App.Locals;                         // 请求级共享，初始为 {}
  cookies: AstroCookies;
  session: AstroSession | undefined;          // 未配置 session 时为 undefined
  cache: CacheLike;                           // 未启用时为禁用实现，不抛错
  csp: CspController | undefined;
  routePattern: string;
  isPrerendered: boolean;
  clientAddress: string;                      // 仅按需渲染且适配器支持时可用
  currentLocale?: string;
  rewrite(payload: RewritePayload): Promise<Response>;
  redirect(path: string, status?: 301 | 302 | 303 | 307 | 308): Response;
}

type MiddlewareHandler = (
  context: RenderContext,
  next: () => Promise<Response>,
) => Promise<Response> | Response;

interface RenderResult {
  status: number;                             // 默认 200；端点自定
  headers: Headers;                           // 含 Set-Cookie、缓存与 CSP
  body: ReadableStream<Uint8Array> | null;    // 流式响应时不为 null
}

abstract class RequestPipeline {
  abstract handle(request: Request, route: RouteRecord): Promise<Response>;
  abstract runMiddleware(handlers: MiddlewareHandler[], ctx: RenderContext): Promise<Response>;
}
```

约定：`next()` 只能被调用一次；重复调用返回同一响应的克隆而不是重跑下游。中间件返回非 `Response` → `MiddlewareNotAResponse`；既未返回也未 `next()` → `MiddlewareNoDataOrNextCalled`；页面返回非 `Response` 且非可序列化视图 → `OnlyResponseCanBeReturned`；响应已开始后再次写入 → `ResponseSentError`。状态码与语义：404 未命中、403 跨站拒绝、405 方法不允许、500 渲染失败（生产期不泄露栈）。

### 6.5 Flow

下面伪代码说明一次按需渲染请求的完整推进，覆盖跨站拒绝、中间件短路与动作调用。

```ts
async function renderRequest(request: Request, route: RouteRecord, deps: RenderDeps): Promise<Response> {
  const url = new URL(request.url);
  const originCheck = checkOrigin(request, url, deps.config.security);   // 仅不安全方法 + 表单类 content-type
  if (!originCheck.ok) return forbidden(originCheck.reason);             // 403，不进入中间件

  const ctx = await createContext(request, route, deps);                 // cookies/session/cache/csp 懒加载
  try {
    const response = await runMiddleware(deps.middleware, ctx);
    const final = await postProcess(response, ctx);                      // Cookie、缓存头、CSP 头
    deps.cache.onRequest?.(ctx, final);                                  // 失效与 SWR 由提供方决定
    return final;
  } catch (error) {
    if (deps.mode === 'development') return deps.overlayPayload(error, route);  // 交开发服务器覆盖层
    return deps.renderErrorPage(error, route);                            // 500，稳定码写入日志
  }
}

async function handleAction(request: Request, ctx: RenderContext): Promise<Response> {
  const action = deps.actions.find(ctx.url.pathname);                    // /_actions/[...path]
  if (!action) return errorResponse(404, 'ActionNotFoundError');
  const input = await parseInput(request, action.accept);                // json 或 form
  const parsed = action.input.safeParse(input);
  if (!parsed.success) return actionErrorResponse(422, parsed.error);    // 字段级错误，不抛异常
  const data = await action.handler(parsed.data, ctx);                   // 处理函数可读写会话与缓存
  ctx.locals._actionPayload = { actionName: action.name, actionResult: serialize(data) };
  return serializeResponse(action.accept, data);
}
```

失败处理：动作未找到 → 404 + `ActionNotFoundError`；处理函数抛出业务错误 → 按 `codeToStatusMap` 映射状态码并返回结构化 `error`；返回不可序列化值 → `ActionsReturnedInvalidDataError`；服务端调用自身动作 → `ActionCalledFromServerError`（禁止递归 RPC）。渲染期任何未捕获异常都必须先落日志再转 500，不得让连接悬挂。

幂等与恢复：GET 渲染可重复执行且结果一致；响应开始前的异常允许改渲染错误页一次，响应开始后不再重试。

### 6.6 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-6-01 | 页面配置了中间件 | 请求页面 | 中间件先于渲染执行；`locals` 中写入的值在页面可见 |
| A-6-02 | 中间件既不返回也不调用 `next()` | 请求页面 | 返回 500 并带 `MiddlewareNoDataOrNextCalled`，日志含中间件文件 |
| A-6-03 | 中间件返回字符串 | 请求页面 | 返回 500 并带 `MiddlewareNotAResponse`，不输出该字符串 |
| A-6-04 | 跨站表单 POST 到按需页面 | `POST` 带外部 `Origin` | 403，页面不渲染，响应体说明跨站提交被拒 |
| A-6-05 | 动作输入缺字段 | `POST /_actions/login` | 422，错误含字段路径；处理函数未被调用 |
| A-6-06 | 页面使用 `/api` 端点返回 `Response` | 请求端点 | 原样返回状态、头与流；不额外包裹 HTML |
| A-6-07 | 生产模式渲染抛错 | 请求页面 | 返回 500 页，不含栈与源码路径；日志含稳定码与请求 ID |
| A-6-08 | 响应已开始后抛出异常 | 渲染中途抛错 | 终止流并记录请求 ID，不再尝试写第二份响应 |
| A-6-09 | 同一 GET 请求重复 10 次 | 连续请求 | 响应体与状态码一致（不含随机与时间敏感内容） |
