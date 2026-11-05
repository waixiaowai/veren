---
title: 守卫域
description: 在业务逻辑之前拦截跨站伪造、越权跳转与高频滥用。
sidebar:
  order: 9
  label: 守卫域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 7. Guard

守卫域负责在业务逻辑之前拦截跨站伪造、越权跳转与高频滥用。与相邻模块的分界是：它不修改任何业务数据，不产出会话；它只回答"这个请求的来源可信吗、跳转目标可信吗、频率是否越界"，任何一项不满足都在业务逻辑之前终止请求。

### 7.0 Key Decisions

| 决策 | 理由 | 违反后果 |
|---|---|---|
| **先判来源后判频率**：来源校验先于限流命中执行 | 顺序颠倒时攻击者可用伪造来源无成本地耗尽受害者的限流配额 | 限流沦为拒绝服务放大器 |
| **失败即拒**：来源头缺失或为 `null` 时一律拒绝，不做推测性放行 | 推测放行（如按 Host 猜）正是跨站伪造的入口 | 合法非浏览器客户端（curl 等）可能被误伤，但换来浏览器场景的确定性安全 |
| **幂等方法不校验来源**：GET/OPTIONS/HEAD 跳过来源检查 | 这些方法按契约不改变状态，检查只会制造误伤 | 只读接口在无头场景不可用 |
| **回调地址与来源同一信任根**：`callbackURL` 等跳转目标必须命中同一张受信来源表 | 分裂的信任根会产生"来源合法但跳到恶意站"的开放重定向 | 登录成功后凭据被带到攻击者控制的回调页 |
| **无 IP 时失败关闭**：客户端地址不可判定时进入共享桶限流而非放行 | 放行等于关闭限流 | 匿名化代理批量滥用不被限流 |

### 7.1 Responsibility Boundary

本域拥有：来源判定规则与受信来源表匹配、Fetch Metadata 判定（跨站导航登录拦截）、回调/跳转地址白名单校验、限流规则解析与计数键构造。本域不拥有：会话有效性判定（会话域）、角色权限判定（权限矩阵）、限流计数的存储实现（存储域的原子原语）、IP 地址的转发头解析配置（装配域 `advanced.ipAddress`）。

### 7.2 Capability Inventory

- 来源校验（路由级，挂 `/**`，仅非幂等方法）：读取 `origin` 头（回落 `referer`），与受信来源表匹配；`Origin: null` 且 `Sec-Fetch-Site: same-origin` 时按基址推断；缺失或 null 报 `MISSING_OR_NULL_ORIGIN`，不匹配报 `INVALID_ORIGIN`。
- 跳转校验：`callbackURL` / `redirectTo` / `errorCallbackURL` / `newUserCallbackURL`（体或查询）必须命中受信来源表或为安全的相对路径；非字符串值报 `BAD_REQUEST`，不匹配报对应 `INVALID_*` 码。
- Fetch Metadata 判定（登录类端点端点级）：携带 Cookie 走来源校验；`Sec-Fetch-Site: cross-site` + `Sec-Fetch-Mode: navigate` 报 `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`；无任何元数据头的非浏览器客户端放行。
- 限流：默认规则（登录注册改密类 10 秒 3 次；密码重置与验证邮件类 60 秒 3 次；兜底 10 秒 100 次，生产默认开启）；计数键为 `IP|路径`；插件可按路径匹配器声明专属规则；超限返回 429 与 `X-Retry-After`。
- 豁免开关：`skipOriginCheck`（布尔或路径数组）、`disableCSRFCheck`、`disableOriginCheck` 仅限明确评估后的部署使用；`skipOriginCheck: true` 在未显式设 CSRF 开关时连带跳过 CSRF（向后兼容行为，伴随告警日志）。

### 7.3 Contract

```ts
// 受信来源匹配（取证：packages/better-auth/src/auth/trusted-origins.ts:133-210）
interface TrustedOriginMatcher {
  // 支持精确来源、通配主机（*、**、?）、自定义协议（myapp://、exp://）
  // 与路径钉扎；相对路径仅在回调地址场景允许
  matches(originToValidate: string, origin: string): boolean;
}

// 限流规则解析结果（取证：packages/better-auth/src/api/rate-limiter/index.ts:338-411）
interface ResolvedRateLimit {
  key: string;               // `${ip}|${path}`；无 IP 时落共享桶 no-trusted-ip
  window: number;            // 秒
  max: number;
  source: "default" | "plugin" | "custom" | "special";
}

abstract class Guard {
  abstract validateOrigin(ctx: EndpointContext, force?: boolean): Promise<void>;
  abstract validateRedirect(urlValue: unknown, kind: "callback" | "redirect" | "error" | "newUser"): Promise<void>;
  abstract consumeRateLimit(request: Request): Promise<Response | null>; // 超限返回 429 响应
}
```

### 7.4 Flow

以下伪代码表达路由级守卫的完整时序与失败分支（取证：`packages/better-auth/src/api/middlewares/origin-check.ts:67-151, 221-297`、`rate-limiter/index.ts:338-438`）。

```ts
async function routeGuard(ctx: EndpointContext): Promise<Response | null> {
  // 1. 幂等方法放行（不改变状态）
  if (["GET", "OPTIONS", "HEAD"].includes(ctx.method)) return null;

  // 2. 来源校验（先于限流）：skip 开关不越过本步——skipCSRF 只豁免来源，不豁免跳转校验
  await guard.validateOrigin(ctx); // 失败抛 MISSING_OR_NULL_ORIGIN / INVALID_ORIGIN

  // 3. 跳转目标校验：逐个校验体/查询中的回调地址
  for (const [kind, value] of collectRedirectTargets(ctx)) {
    await guard.validateRedirect(value, kind); // 失败抛对应 INVALID_* 码
  }

  // 4. 限流最后执行：命中即返回 429
  return guard.consumeRateLimit(ctx.request); // null 表示放行
}

async function consumeRateLimit(request: Request): Promise<Response | null> {
  const ip = resolveClientIP(request);          // 转发头解析配置在装配域
  const rule = resolveRule(request.path, ip);   // 专属规则 > 特殊规则 > 兜底规则
  const key = ip ? `${ip}|${path}` : `no-trusted-ip|${path}`; // 无 IP 落共享桶
  const verdict = await storage.incrementOne({ model: "rateLimit", where: [{ field: "key", value: key }],
    increment: { count: 1 } });
  if (verdict && verdict.count > rule.max) {
    return tooManyRequests(retryAfter(verdict, rule.window)); // 429 + X-Retry-After
  }
  return null;
}
```

### 7.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 受信来源表含应用来源 | 从受信来源发起 `POST /sign-in/email` | 放行，进入业务逻辑 |
| A2 | 来源不在受信表 | 同上 | 返回 `INVALID_ORIGIN`，业务逻辑未执行 |
| A3 | 无 origin 头（伪造请求） | 同上 | 返回 `MISSING_OR_NULL_ORIGIN` |
| A4 | `callbackURL` 指向恶意站 | 携带该参数调用登录 | 返回 `INVALID_CALLBACK_URL` |
| A5 | 同一 IP 在 10 秒内第 4 次登录 | 第 4 次请求 | 429，响应头含 `X-Retry-After` |
| A6 | 转发头无法解析出 IP | 持续请求 | 请求进入共享桶被限流（失败关闭），不无限放行 |
| A7 | 跨站导航进入登录页提交 | 表单跨站跳转提交 | 返回 `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` |
| A8 | GET 请求来源不在受信表 | `GET /get-session` | 放行（幂等方法不校验来源） |
