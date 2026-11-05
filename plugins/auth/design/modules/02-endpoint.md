---
title: 端点路由域
description: 把业务能力注册为可路由端点，并在调用前后插入拦截与加工的统一控制点。
sidebar:
  order: 4
  label: 端点路由域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 2. Endpoint

端点路由域负责把业务能力注册为可路由端点：声明路径与方法、校验参数、按固定时序执行守卫、拦截与加工，并把结果交付调用方。与相邻模块的分界是：它只回答"这个请求是谁发的、参数合不合法、处理前后要做什么"，不回答"这个人有没有权限做这件事"——后者属于身份域、组织域与守卫域的判定职责。

### 2.0 Key Decisions

| 决策 | 理由 | 违反后果 |
|---|---|---|
| **准入与执行分离**：守卫（来源校验、限流）先于业务逻辑，且业务逻辑不得感知守卫存在 | 守卫失效时可独立修复，业务代码不被安全逻辑污染 | 业务逻辑与安全判定耦合，守卫补丁需要改动全部端点 |
| **一条钩子管线服务两种入口**：HTTP 路由与服务端内嵌调用（`auth.api.*`）共用同一分派器（`dispatchAuthEndpoint`） | 两条入口行为不一致会让"直接函数调用"绕过全部扩展语义 | 服务端调用跳过拦截与加工，产生与 HTTP 不一致的结果且难以排查 |
| **端点按声明键合并，路径冲突只告警不抛错** | 框架升级时保留覆盖能力（如 custom-session 覆盖 `getSession`）；抛错会让存量插件组合直接不可用 | 同路径不同键的冲突被静默吞掉，需要靠启动日志人工发现 |
| **原始响应跳过加工钩子**：处理器直接返回 `Response` 时不执行 after 钩子 | 流式响应、文件下载无法也不应被序列化改写 | 加工钩子尝试读取流式响应体会把内存耗尽 |

### 2.1 Responsibility Boundary

本域拥有：路由表（端点键 → 端点定义）、中间件挂载顺序、钩子执行时序、路径参数绑定、请求体模式校验。本域不拥有：会话状态（会话域）、来源判定规则（守卫域）、限流计数（守卫域 + 存储域）、错误码语义（诊断域）。路由的 HTTP 解析、体解析与 CORS 处理由外部路由库承担，本域只声明端点与配置。

### 2.2 Capability Inventory

- 注册端点：`createAuthEndpoint(path, options, handler)` 与服务端专用变体 `createAuthEndpoint.serverOnly`，后者带 `SERVER_ONLY` 元数据，不进 HTTP 路由、不出现在接口参考。
- 端点选项：`method`、`body`/`query`/`headers` 模式（模式校验）、`use`（端点级中间件数组）、`requireHeaders`、`metadata`（`SERVER_ONLY`、`HIDE_METADATA`、`CUSTOM_SESSION`、OpenAPI 描述）。
- 路由装配：核心端点表 + 插件端点表按键合并，后声明覆盖先声明；`ok` 与 `error` 永远最后追加、不可覆盖；启动时 `checkEndpointConflicts` 扫描路径冲突并记录错误日志。
- 中间件链：路由级守卫（来源校验，挂 `/**`）→ 插件中间件（各自声明路径）→ 端点级 `use` 中间件（会话、敏感会话、新鲜会话等）。
- 钩子时序：用户级 before → 插件 before（按声明顺序）→ 端点处理器 → 插件 after → 用户级 after。
- 路径参数：`:name` 形式声明（如 `/callback/:id`、`/reset-password/:token`），处理器内经 `c.params.<name>` 读取。
- 禁用路径：`disabledPaths` 命中的路径直接返回 404。
- 内嵌调用：`auth.api.<key>({ body, headers, query, returnHeaders, asResponse })`，与 HTTP 共用钩子管线；`returnHeaders` 返回 `{ headers, response }`，`asResponse` 返回原始 `Response`。

### 2.3 Contract

```ts
// 端点定义契约（节选，取证：packages/core/src/api/index.ts:121-215）
interface EndpointDefinition {
  path: string;                     // 路由路径，":name" 为路径参数
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Schema;                    // 请求体模式
  query?: Schema;                   // 查询参数模式
  headers?: Schema;                 // 请求头模式
  use?: Middleware[];               // 端点级中间件
  requireHeaders?: boolean;
  metadata?: {
    SERVER_ONLY?: boolean;          // 不进 HTTP 路由
    HIDE_METADATA?: boolean;
    CUSTOM_SESSION?: boolean;
    openapi?: { operationId?: string; tags?: string[] };
  };
}

// 请求上下文（节选，取证：packages/core/src/types/context.ts:322-355）
interface EndpointContext {
  path: string;                     // 命中的路由路径
  params: Record<string, string>;   // 路径参数绑定
  body: unknown;                    // 模式校验后的请求体
  query: unknown;
  headers: Headers;
  setHeader(name: string, value: string): void;
  redirect(url: string): never;     // 以异常方式终结并跳转
  context: AuthContext & {
    session?: SessionContext | null;
    returned?: unknown;             // after 钩子读取的端点返回值
    responseHeaders?: Headers;
    verifiedResource?: unknown;     // 资源归属中间件的产物
    verifiedMember?: unknown;       // 组织角色中间件的产物
  };
}

abstract class EndpointDispatcher {
  // 分派一次端点调用：先 before 钩子，再处理器，再 after 钩子
  abstract dispatch(endpoint: EndpointDefinition, input: DispatchInput): Promise<unknown>;
}
```

### 2.4 Flow

以下伪代码表达端点分派的完整时序与失败分支（取证：`packages/better-auth/src/api/dispatch.ts:137-220, 222-267, 323-484`）。

```ts
async function dispatch(endpoint: EndpointDefinition, input: DispatchInput): Promise<unknown> {
  const hooks = collectHooks(); // 用户钩子在前（matcher 恒真），插件钩子在后

  // before 钩子：matcher 抛错 → 转内部错误；返回 { context } 合并上下文，其余返回值短路
  for (const hook of hooks.before) {
    let matched: boolean;
    try {
      matched = hook.matcher(ctx);
    } catch {
      throw apiError("INTERNAL_SERVER_ERROR", { source: hook.source });
    }
    if (!matched) continue;
    const returned = await hook.handler(ctx);
    if (isContextPatch(returned)) mergeIntoCtx(returned);
    else return returned; // 短路：拦截生效
  }

  // 处理器执行：强制关闭响应化以拿到返回值与响应头
  let returned: unknown;
  try {
    returned = await endpoint.handler(withForcedInternal(ctx));
  } catch (error) {
    if (error instanceof RedirectError) throw error; // 跳转穿透钩子
    throw error;
  }
  if (returned instanceof RawResponse) return returned; // 原始响应跳过 after 钩子

  // after 钩子：可改写 returned；抛出的错误携带合并后的响应头
  for (const hook of hooks.after) {
    if (!hook.matcher(ctx)) continue;
    const patched = await hook.handler(ctx);
    if (patched !== undefined) ctx.context.returned = patched;
  }
  return shapeResult(returned, input); // 按 returnHeaders/asResponse 决定形态
}
```

失败分支与幂等：钩子短路返回值原样回传（拦截型扩展如封禁检查依赖此语义）；处理器抛出的 `APIError` 携带响应头符号，分派器在错误路径上仍合并已 `Set-Cookie` 的头（如登出时清除 Cookie 即使业务失败也不丢）；重复分派同一端点无副作用——端点本身必须是幂等或以存储域的原子原语保证唯一性。

### 2.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 服务已装配 | `POST /api/auth/sign-in/email` 携带合法体 | 返回会话 Cookie 与主体档案；`/get-session` 可读回 |
| A2 | 注册了 before 拦截钩子返回非上下文对象 | 调用任意端点 | 端点处理器未执行，返回值为钩子返回值 |
| A3 | 注册 after 加工钩子改写返回值 | 调用 `getSession` | 响应体为改写后内容，处理器原返回值不外泄 |
| A4 | 两个插件声明同一路径不同键 | 启动服务 | 启动日志出现冲突错误记录，服务仍可用 |
| A5 | 声明 `SERVER_ONLY` 端点 | HTTP 访问其路径 | 404；`auth.api.<key>` 服务端调用正常 |
| A6 | `disabledPaths` 含 `/get-session` | 访问该路径 | 404 |
| A7 | after 钩子抛 `APIError` 且处理器已 `Set-Cookie` | 调用该端点 | 错误响应仍携带已设置的 Cookie 头 |
