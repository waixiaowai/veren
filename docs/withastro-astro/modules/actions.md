---
title: 服务端动作
description: "Actions 拥有 一次服务端调用 的全部决策——输入怎么校验、结果怎么序列化、失败映射成什么状态码；它不拥有会话身份、不拥有缓存策略，也不决定页面如何渲染"
sidebar:
  order: 11
  label: 服务端动作
draft: false
lastUpdated: 2026-11-04
---

## 11. Actions

Actions 拥有"一次服务端调用"的全部决策——输入怎么校验、结果怎么序列化、失败映射成什么状态码；它不拥有会话身份、不拥有缓存策略，也不决定页面如何渲染。

### 11.1 Duties

| 维度 | 内容 |
| --- | --- |
| 输入 | `src/actions/index.ts` 里 `defineAction()` 的 `{ input, accept, handler }`；一次 `POST /_actions/<path>` 或表单提交；客户端 `astro:actions` 的调用参数 |
| 输出 | `SafeResult`（`{ data }` 或 `{ error: ActionError }`）、HTTP 响应（devalue 序列化的 JSON 或错误 JSON）、`actions.d.ts` 类型声明 |
| 不负责 | 会话读写（[运行时存储](/design/modules/storage/#121-duties) 的 `session`）；响应缓存（`cache` 与 `routeRules`）；路由匹配本身（[路由表](/design/modules/routing/#43-capabilities) 只登记 `/_actions/[...path]`） |
| 相邻模块 | 上游是构建期集成注入的动作路由与类型；下游是渲染管线（请求进来先过中间件，再进动作处理器）；中间件用 `getActionContext()` 读取调用意图 |
| 数据所有权 | 拥有**动作注册表**（名字到处理器的映射）与单次调用的**结果信封**；不拥有任何持久化数据 |
| 决策权 | 独占三项决策：输入是否通过 zod schema、错误用哪个 `ActionErrorCode`（进而决定状态码）、结果按 `data`/`error`/`empty` 哪种形态序列化 |

### 11.2 Capabilities

Actions 把"函数调用"变成一条可被浏览器与表单共同使用的 RPC：`defineAction()` 在 `src/actions/index.ts` 中声明，导出的对象即命名空间（支持点号嵌套）；`input` 用 zod schema 描述，`accept` 取 `'form'`（入参为 `FormData`）或 `'json'`（缺省，入参为 JSON 对象）。服务端每次调用都包成 `SafeResult`：处理器正常返回即 `{ data }`，抛 `ActionError` 即 `{ error }`，抛其他异常统一折成 `INTERNAL_SERVER_ERROR`（开发期保留堆栈）。客户端 `import { actions } from 'astro:actions'`，调用返回 `SafeResult`，需要"失败即抛"时用 `.orThrow()`。中间件里用 `getActionContext(context)` 判断本次请求是否为动作调用（`calledFrom` 为 `rpc` 或 `form`），据结果决定改写、重定向或拦截。

| 关注点 | 规则 |
| --- | --- |
| 端点 | 固定路由 `/_actions/[...path]`（`ACTION_RPC_ROUTE_PATTERN`），`prerender: false`，由动作集成在 `astro:config:setup` 注入；路径按 `.` 分段并逐段 `decodeURIComponent`，命中禁区键即视为不存在 |
| 方法 | 只有 `POST` 会进入处理器；其他方法不产生动作调用 |
| 序列化 | `data` 用 devalue 编码（`application/json+devalue`，保留 `Date`/`Map`/`URL` 等）；`error` 用普通 JSON（`issues`/`fields` 只在输入错误时出现）；`data` 为 `undefined` 时返回 204 |
| 输入校验 | 失败抛 `ActionInputError`（`code: 'BAD_REQUEST'`），携带 `issues` 与按字段分组的 `fields`；客户端用 `isInputError()` 判定 |
| 体型限制 | `security.actionBodySizeLimit`，默认 `1048576` 字节（1 MB）；超限得到 `CONTENT_TOO_LARGE`（413），非预期媒体类型得到 `UNSUPPORTED_MEDIA_TYPE`（415），JSON 语法错误得到 `BAD_REQUEST`（400） |
| 输出要求 | 动作依赖按需渲染：没有适配器且所有路由都预渲染时，构建期抛 `ActionsWithoutServerOutputError`；返回不可序列化数据时抛 `ActionsReturnedInvalidDataError`；动作模块加载失败抛 `ActionsCantBeLoaded` |
| 隔离 | 处理器拿到的上下文是裁剪后的 `ActionAPIContext`（去掉 `props`/`getActionResult`/`callAction`/`redirect`）；未知动作名返回 `NOT_FOUND`，不泄漏注册表结构 |

### 11.3 Contracts

```ts
type ActionAccept = 'form' | 'json';
// codeToStatusMap 为 IANA 状态码名字→数值映射，此处列出方案内会用到的子集
type ActionErrorCode =
  | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'CONTENT_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'UNPROCESSABLE_CONTENT'
  | 'TOO_MANY_REQUESTS' | 'INTERNAL_SERVER_ERROR' | (string & {});

interface ActionDefinition<TInput extends ZodType | undefined, TOutput, TAccept extends ActionAccept | undefined> {
  input?: TInput;                      // zod schema；缺省则处理器收到 unknown 透传值
  accept?: TAccept;                    // 缺省 'json'；'form' 时入参为 FormData
  handler: (input: TAccept extends 'form' ? FormData : Infer<TInput>, context: ActionAPIContext) => TOutput | Promise<TOutput>;
}

type SafeResult<TInput, TOutput> =
  | { data: TOutput; error: undefined }
  | { data: undefined; error: ActionError<TInput> };

interface ActionError<TInput = Record<string, unknown>> extends Error {
  type: 'AstroActionError';
  code: ActionErrorCode;               // 决定 HTTP 状态
  status: number;                      // 由 codeToStatusMap[code] 求得
  message: string;
}
interface ActionInputError<TInput> extends ActionError<TInput> {
  type: 'AstroActionInputError';
  issues: Array<{ path: (string | number)[]; message: string; code: string }>;
  fields: { [K in keyof TInput]?: string[] };  // 按顶层字段分组，便于表单回填
}

interface ActionClient<TInput, TOutput> {
  (input: TInput): Promise<SafeResult<TInput, TOutput>>;
  orThrow(input: TInput): Promise<TOutput>;      // 失败时抛 ActionError
  queryString: string;                           // 形如 `?_action=name`，直接用作 <form action>
}

type SerializedActionResult =
  | { type: 'data'; contentType: 'application/json+devalue'; status: 200; body: string }
  | { type: 'error'; contentType: 'application/json'; status: number; body: string }
  | { type: 'empty'; status: 204 };

interface AstroActionContext {                    // getActionContext(context) 的返回值
  action: { calledFrom: 'rpc' | 'form'; name: string; handler(): Promise<SafeResult<unknown, unknown>> } | undefined;
  setActionResult(name: string, result: SerializedActionResult): void;
  serializeActionResult(result: SafeResult<unknown, unknown>): SerializedActionResult;
  deserializeActionResult(result: SerializedActionResult): SafeResult<unknown, unknown>;
}
```

错误约定：处理器内部**抛** `ActionError`（或其子类 `ActionInputError`）来表达业务失败；跨网络边界后一律变成 `SafeResult.error`，客户端不再收到异常，除非显式使用 `.orThrow()`。

### 11.4 Flow

伪代码给出三条路径：声明期包装、服务端 RPC 执行、客户端调用；三条路径共用同一份 `SafeResult` 语义。

```ts
// 入口 1：声明期，defineAction 把用户函数包成带 .orThrow / .queryString 的可调用对象
function defineAction<TInput, TOutput, TAccept extends ActionAccept | undefined>(def: ActionDefinition<TInput, TOutput, TAccept>) {
  const parse = def.accept === 'form' ? parseFormData : parseJsonFor(def.input);
  const safeServerHandler = async (unparsedInput: unknown, ctx: ActionAPIContext): Promise<SafeResult<TInput, TOutput>> => {
    if (def.accept === 'form' && !(unparsedInput instanceof FormData)) throw new ActionError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This action only accepts FormData.' });
    if (def.accept !== 'form' && unparsedInput instanceof FormData) throw new ActionError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This action only accepts JSON.' });
    const input = await parse(unparsedInput);                 // zod 失败 → ActionInputError(BAD_REQUEST)
    try { return { data: await def.handler(input, ctx), error: undefined }; }
    catch (e) {
      if (e instanceof ActionError) return { data: undefined, error: e };
      return { data: undefined, error: new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: String(e) }) };
    }
  };
  return Object.assign(safeServerHandler, { orThrow: throwOnError(safeServerHandler), queryString: `_action=${encodeURIComponent(name)}` });
}

// 入口 2：POST /_actions/<path> 的处理器
async function handleActionRequest(context: APIContext): Promise<Response> {
  const { action, setActionResult, serializeActionResult } = getActionContext(context);
  if (!action) return notFound();                             // 非动作调用：交给后续渲染
  const result = await action.handler();                      // 内部已完成校验与异常折叠
  const serialized = serializeActionResult(result);           // data/error/empty 三选一
  setActionResult(action.name, serialized);                   // 供中间件与表单回填读取
  return new Response(serialized.type === 'empty' ? null : serialized.body, { status: serialized.status,
    headers: serialized.type === 'empty' ? {} : { 'Content-Type': serialized.contentType } });
}

// 入口 3：客户端调用（同一份语义，失败不抛）
async function callAction(client: ActionClient<Input, Output>, input: Input): Promise<Output> {
  if (isFormData(input)) {                                    // 渐进增强：浏览器原生表单提交到本页
    const res = await fetch(`${location.pathname}${client.queryString}`, { method: 'POST', body: input });
    const body = await res.json().catch(() => undefined);     // 页面重渲染时可能是 HTML
    return body ? deserialize(body) : undefined;               // 由中间件的 form 分支决定结果去向
  }
  const res = await fetch(`/_actions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (res.status === 413) throw new ActionError({ code: 'CONTENT_TOO_LARGE', message: 'Request body exceeds security.actionBodySizeLimit' });
  const safe = deserializeActionResult(await res.json());      // { data } 或 { error }
  return client.orThrow ? unwrapOrThrow(safe) : safe;
}
```

### 11.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-11-01 | 定义 `server.like = defineAction({ input: z.object({ id: z.string() }), handler: async ({ id }, ctx) => ({ id, at: new Date() }) })` | 客户端 `await actions.like({ id: 'a' })` | 返回 `{ data: { id: 'a', at: Date } }`，`at` 反序列化后仍是 `Date` 实例，`error` 为 `undefined` |
| A-11-02 | 同上 | 客户端 `await actions.like({ id: 1 })` | 返回 `{ error }` 且 `isInputError(error)` 为真，`error.fields.id` 存在，`error.status` 为 400；页面不抛异常 |
| A-11-03 | 同上，处理器改为 `throw new ActionError({ code: 'FORBIDDEN' })` | 客户端调用并同时用 `.orThrow()` 调用一次 | 前者返回 `{ error.code: 'FORBIDDEN' }`；后者抛出 `ActionError`，`status` 为 403，网络响应状态同为 403 |
| A-11-04 | 未定义任何动作名为 `missing` | `POST /_actions/missing` | 返回 404 与 `{ error: { code: 'NOT_FOUND' } }`，响应中不含已注册动作名清单 |
| A-11-05 | `security.actionBodySizeLimit` 保持默认 1 MB | 向 `/_actions/like` 提交 2 MB 的 JSON | 返回 413，`error.code` 为 `CONTENT_TOO_LARGE`，处理器未被调用（日志无该动作执行记录） |
| A-11-06 | `accept: 'form'` 的动作；中间件已按 `getActionContext()` 处理 form 分支 | 浏览器以表单原生提交到动作查询串（`queryString`） | 请求带 `_action=like` 落到当前页面；中间件拿到 `calledFrom: 'form'` 与正确 `name`，`setActionResult()` 后页面按结果重渲染 |
| A-11-07 | 项目无适配器且所有路由均为预渲染 | 执行 `astro build` | 构建失败，报 `ActionsWithoutServerOutputError`，提示需要按需渲染输出 |
