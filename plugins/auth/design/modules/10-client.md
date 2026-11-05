---
title: 客户端域
description: 向浏览器与移动端暴露类型安全的会话与动作调用面，并保证多标签与多框架下会话状态一致。
sidebar:
  order: 12
  label: 客户端域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 10. Client Binding

客户端域是**外围域**。它把服务端认证能力包装成浏览器与移动端可调用的、类型安全的调用面，并负责把会话状态在多标签页、多框架与服务端渲染之间保持一致；**它不决定业务结果**——是登录、是否放行、是否展示某块界面，仍由宿主应用与核心域决定。

客户端域与相邻模块的分界是：**调用面归客户端域，语义归端点路由域**。客户端只把属性链翻译成路径与方法、把结果翻译成原子状态；它不解释业务字段、不做权限判断、不缓存业务数据。服务端侧的真实语义见 [端点路由域](./02-endpoint/) 与 [服务端接口](../api/)；客户端在整个 [总体方案与架构](../architecture/) 中位于核心业务平面的下游，是核心能力的服务对象而非组成部分。

### 10.1 Responsibility Boundary

**客户端域负责：**

- 提供 `createAuthClient` 工厂，产出「会话与动作调用面 + 状态原子 + 底层 fetch 实例 + 错误码面」的组合体。
- 提供动态路径代理：把 `authClient.signIn.email(...)` 这样的属性链翻译成 HTTP 路径与方法，并处理方法选择、体传递与信号触发。
- 提供会话原子：以统一形状（`data` / `error` / `isPending` / `isRefetching` / `refetch`）暴露会话状态，并定义刷新、失效与保留旧数据的策略。
- 提供刷新触发源：轮询、跨标签广播、可见性变化、上线事件与信号翻转。
- 提供跨标签广播通道：以 `localStorage` 的 storage 事件同步「已登出 / 已取会话 / 已更新用户」三类事。
- 提供框架适配层：vanilla（无框架）、React、Vue、Solid、Svelte、Lynx 六套绑定。
- 提供 SSR 水合入口：`hydrateSession` 与各框架的服务端快照取用约定。

**客户端域不负责（明确拒绝承担的职责）：**

- 不决定业务结果：客户端不做权限判定、不做路由守卫决策，只呈现状态。
- 不缓存业务数据：客户端只持有会话与插件原子，业务数据的缓存由宿主负责。
- 不绕过服务端校验：任何调用都经由 HTTP 落到服务端端点，客户端的乐观更新不被视为事实。
- 不管理会话生命周期本身：签发、续期、吊销由 [会话域](./03-session/) 唯一负责，客户端只发起请求并读取结论。
- 不实现凭据策略：口令强度与校验属于 [凭证域](./04-credential/)。

**一致性责任划分：**

| 关注点 | 客户端域 | 服务端核心域 |
|---|---|---|
| 会话是否存在 | 读取并呈现结论 | 唯一权威 |
| 会话过期 | 检测到 401 / `needsRefresh` 后发起刷新 | 判定过期并续期 |
| 多标签同步 | 通过广播通道传播事件并重新拉取 | 不感知标签页 |
| 错误语义 | 透传服务端错误码 | 定义错误码（见 [错误码](../errors/)） |

### 10.2 Capability Inventory

- **客户端工厂（vanilla）**：`createAuthClient` 返回 `InferResolvedHooks & InferClientAPI & InferActions & { hydrateSession, useSession, $fetch, $store, $Infer, $ERROR_CODES }`。`useSession` 在 vanilla 绑定上是**原子**（`Atom<...>`），在 React/Solid/Lynx 上是**函数**，在 Vue 上是**重载**（见 10.6）。
- **底层 fetch 实例**：`$fetch` 是一个 better-fetch 实例，携带 `baseURL`、`credentials: "include"`（在运行环境支持时）、默认方法 `GET` 与宽松 JSON 解析。
- **动态路径代理**：属性链 → 路径段数组 → kebab 化路径；命中已知路径方法表优先，其次显式 `method`，再次按有无请求体判定 POST/GET。
- **体处理**：GET 丢弃请求体；非 GET 合并调用参数与 `fetchOptions.body`。
- **原子信号**：成功响应后 10 毫秒延迟翻转信号原子，避免与本次响应同帧竞争；`disableSignal` 可抑制该行为。
- **baseURL 解析**：显式 `options.baseURL` → 环境变量（除非显式禁用）→ 请求来源 → `window.location.origin` → `/api/auth` 兜底。
- **强制 POST 路径表**：`/sign-out`、`/revoke-sessions`、`/revoke-other-sessions`、`/delete-user` 四条路径强制 POST。
- **会话信号路径表**：`matchesSessionSignal` 覆盖 12 条路径，命中即翻转 `$sessionSignal`。
- **原子监听器**：`atomListeners` 描述「路径命中 → 翻转哪个信号 → 可选回调」；默认监听器把 `/sign-out` 映射为 `signout` 广播，把 `/update-user` 与 `/update-session` 映射为 `updateUser` 广播。
- **会话水合**：`hydrateSession` 只在**首次非空**调用时生效，用于把服务端渲染得到的会话注入客户端原子。
- **存储面**：`$store` 提供 `notify` / `listen` / `atoms` 三个能力，插件通过它读写自己的原子。
- **插件合并顺序**：插件原子与路径方法按**后声明覆盖先声明**合并；插件动作走 `defu`，同样是后声明的插件覆盖先声明者；原子监听器则是**追加**（`atomListeners.push(...)`），不覆盖。
- **会话原子语义**：401 清空数据；其他错误保留旧数据；`needsRefresh` 时发起第二次 POST 刷新；新旧数据 JSON 相等时保留旧引用（避免无谓重渲染）。
- **刷新触发源**：轮询（`refetchInterval`，默认 0 不轮询）、跨标签广播、可见性变化（**5 秒限流**）、重新上线、信号翻转。离线且未开启离线刷新时不刷新。
- **跨标签广播**：频道名 `better-auth.message`，基于 `localStorage` 的 storage 事件；载荷形状 `{ event: "session", data: { trigger }, clientId, timestamp }`；`trigger` 取值 `signout` / `getSession` / `updateUser`。
- **通用查询**：`useAuthQuery` 提供「最新请求获胜」的查询原语，401 清空数据、重试期间不写入错误。
- **框架绑定**：vanilla / React / Vue / Solid / Svelte / Lynx 六套。
- **Vue 特化**：不读取环境变量；`useSession()` 返回 Ref，`useSession(useFetch)` 走 Nuxt SSR；会话缓存键 `better-auth:session:<baseURLKey>:<basePath>`。
- **React 特化**：`useStore` 基于 `useSyncExternalStore`，服务端快照取 `store.init`（用于 SSR 水合重放）。

### 10.3 Contract

#### 10.3.1 Auth Client Contract

```ts
/** 客户端选项 / Client options */
export interface BetterAuthClientOptions {
	/** fetch 选项 / Fetch options */
	fetchOptions?: ClientFetchOption;
	/** 客户端插件 / Client plugins */
	plugins?: BetterAuthClientPlugin[];
	/** 服务端基地址 / Server base URL */
	baseURL?: string;
	/** 认证基路径，默认 "/api/auth" / Auth base path, default "/api/auth" */
	basePath?: string;
	/** 关闭默认 fetch 插件 / Disable default fetch plugins */
	disableDefaultFetchPlugins?: boolean;
	/** 仅用于类型推断的服务端配置 / Server options, inference only */
	$InferAuth?: BetterAuthOptions;
	/** 会话刷新策略 / Session revalidation options */
	sessionOptions?: RevalidateOptions;
}

/** 会话刷新策略 / Session revalidation options */
export interface RevalidateOptions {
	/** 轮询间隔（秒）；0 表示不轮询，默认 0 / Poll interval in seconds; 0 disables polling, default 0 */
	refetchInterval?: number;
	/** 窗口重新可见时是否自动刷新，默认 true / Refetch on window focus, default true */
	refetchOnWindowFocus?: boolean;
	/** 离线时是否仍刷新，默认 false / Refetch while offline, default false */
	refetchWhenOffline?: boolean;
}

/** 会话原子形状 / Session atom shape */
export interface AuthQueryState<T> {
	/** 当前数据；未加载时为 null / Current data, null before first load */
	data: null | T;
	/** 最近一次错误 / Latest error */
	error: null | BetterFetchError;
	/** 是否处于首次加载 / Whether the first load is in flight */
	isPending: boolean;
	/** 是否处于重新拉取 / Whether a refetch is in flight */
	isRefetching: boolean;
	/** 手动重新拉取 / Manual refetch */
	refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
}

/** 会话数据 / Session payload */
export interface SessionData {
	user: User;
	session: Session;
}

/**
 * 客户端组合体 / Client aggregate
 * 取证：packages/better-auth/src/client/vanilla.ts:55-77
 */
export interface AuthClient<Option extends BetterAuthClientOptions> {
	/** 注入会话（SSR 水合）/ Inject a session for SSR hydration */
	hydrateSession(session: SessionData | null): void;
	/** 会话状态；vanilla 绑定上是原子 / Session state; an atom in the vanilla binding */
	useSession: Atom<AuthQueryState<SessionData>>;
	/** 底层 fetch 实例 / Underlying fetch instance */
	$fetch: BetterFetch;
	/** 原子存储面 / Atom store surface */
	$store: ClientStore;
	/** 类型推断面 / Type inference surface */
	$Infer: { Session: SessionData };
	/** 错误码面 / Error code surface */
	$ERROR_CODES: Record<string, { code: string; message: string }>;
}
```

#### 10.3.2 Dynamic Path Proxy Contract

```ts
/** 代理调用的第一个参数 / First argument of a proxied call */
export interface ProxyRequest {
	/** 查询参数 / Query parameters */
	query?: Record<string, unknown>;
	/** 覆盖 fetch 选项 / Overrides for fetch options */
	fetchOptions?: ClientFetchOption;
}

/** 代理调用参数 / Proxied call arguments */
export type ProxyCallArgs = [ProxyRequest?, ClientFetchOption?];

/**
 * 路径到方法的解析契约 / Path-to-method resolution
 * 取证：packages/better-auth/src/client/proxy.ts:12-34
 */
export function resolveMethod(
	path: string,
	knownPathMethods: Record<string, "POST" | "GET">,
	args: ProxyRequest | undefined,
): "POST" | "GET" {
	// 优先级 1：已知路径方法表（强制）
	const forced = knownPathMethods[path];
	if (forced) return forced;
	// 优先级 2：调用方显式指定的 method
	const explicit = args?.fetchOptions?.method;
	if (explicit) return explicit;
	// 优先级 3：有请求体 → POST
	const body = { ...(args ?? {}) };
	delete body.query;
	delete body.fetchOptions;
	if (Object.keys(body).length > 0) return "POST";
	// 优先级 4：否则 GET
	return "GET";
}

/**
 * 路径构造契约 / Path construction
 * 取证：packages/better-auth/src/client/proxy.ts:71
 */
export function toRoutePath(pathSegments: string[]): string {
	// 属性链段逐段 kebab 化后以 "/" 连接，前置 "/"
	return "/" + pathSegments.map(toKebabCase).join("/");
}
```

#### 10.3.3 Session Atom Contract

```ts
/** 会话获取的结果形态 / Session fetch outcome */
export type SessionFetchOutcome = "aborted" | "failed" | "stale" | "fresh";

/**
 * 会话原子契约 / Session atom contract
 * 取证：packages/better-auth/src/client/session-atom.ts:99-301
 */
export interface SessionAtomController {
	/** 会话原子 / Session atom */
	session: Atom<AuthQueryState<SessionData>>;
	/** 会话信号原子 / Session signal atom */
	$sessionSignal: Atom<boolean>;
	/** 广播会话变更 / Broadcast a session change */
	broadcastSessionUpdate: (trigger: "signout" | "getSession" | "updateUser") => void;
}
```

#### 10.3.4 Broadcast Channel Contract

```ts
/** 广播载荷 / Broadcast payload */
export interface BroadcastMessage {
	/** 事件类型，当前仅 "session" / Event kind, currently only "session" */
	event?: "session";
	/** 事件数据 / Event data */
	data?: { trigger?: "signout" | "getSession" | "updateUser" };
	/** 发送方标识 / Sender identifier */
	clientId: string;
	/** 时间戳（秒）/ Timestamp in seconds */
	timestamp: number;
}

/** 广播通道 / Broadcast channel */
export interface BroadcastChannel {
	/** 发送消息 / Post a message */
	post(message: Record<string, unknown>): void;
	/** 订阅消息，返回取消订阅函数 / Subscribe, returns an unsubscribe function */
	subscribe(listener: (message: BroadcastMessage) => void): () => void;
	/** 安装底层监听，返回清理函数 / Install the underlying listener, returns a cleanup function */
	setup(): () => void;
}
```

#### 10.3.5 Framework Binding Contract

```ts
/** React 绑定 / React binding */
export interface ReactAuthClient<Option extends BetterAuthClientOptions> {
	hydrateSession(session: SessionData | null): void;
	/** 会话状态，函数形态 / Session state, function form */
	useSession: () => {
		data: SessionData;
		isPending: boolean;
		isRefetching: boolean;
		error: BetterFetchError | null;
		refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
	};
	$fetch: BetterFetch;
	$store: ClientStore;
}

/** Vue 绑定：双载 / Vue binding: overloaded */
export interface VueAuthClient<Option extends BetterAuthClientOptions> {
	/** 返回响应式 Ref / Returns a reactive Ref */
	useSession(): DeepReadonly<Ref<{
		data: SessionData;
		isPending: boolean;
		isRefetching: boolean;
		error: BetterFetchError | null;
		refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
	}>>;
	/** Nuxt SSR 形态：走 Nuxt 托管的取数与水合 / Nuxt SSR form */
	useSession(useFetch: SessionFetch): Promise<{
		data: Ref<SessionData>;
		isPending: false;
		error: Ref<{ message?: string; status: number; statusText: string }>;
	}>;
}

/** Solid 绑定 / Solid binding */
export interface SolidAuthClient<Option extends BetterAuthClientOptions> {
	useSession: () => Accessor<{
		data: SessionData;
		isPending: boolean;
		isRefetching: boolean;
		error: BetterFetchError | null;
		refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
	}>;
}

/** Svelte 绑定 / Svelte binding */
export interface SvelteAuthClient<Option extends BetterAuthClientOptions> {
	useSession: () => Atom<{
		data: SessionData;
		error: BetterFetchError | null;
		isPending: boolean;
		isRefetching: boolean;
		refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
	}>;
}

/** Lynx 绑定：形状中没有 isRefetching / Lynx binding: no isRefetching in the shape */
export interface LynxAuthClient<Option extends BetterAuthClientOptions> {
	useSession: () => {
		data: SessionData;
		isPending: boolean;
		error: BetterFetchError | null;
		refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
	};
}
```

### 10.4 Flow

以下伪代码表达客户端域四条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 10.4.1 Client Construction

```ts
// 客户端装配
// 取证：packages/better-auth/src/client/config.ts:56-196
function getClientConfig(options?: BetterAuthClientOptions, loadEnv?: boolean) {
	// 1) baseURL 解析顺序
	//    显式 baseURL → 环境变量（loadEnv !== false 时）→ 请求来源 → window.location.origin → "/api/auth"
	const baseURL =
		getBaseURL(options?.baseURL, options?.basePath, undefined, loadEnv) ??
		resolvePublicAuthUrl(options?.basePath) ??
		"/api/auth";

	// 2) fetch 实例
	//    运行环境支持 credentials 时固定带 credentials: "include"（保证跨源 Cookie 随行）
	const isCredentialsSupported = "credentials" in Request.prototype;
	const $fetch = createFetch({
		baseURL,
		...(isCredentialsSupported ? { credentials: "include" } : {}),
		method: "GET",
		jsonParser: (text) => (text ? parseJSON(text, { strict: false }) : null),
		customFetchImpl: fetch,
		...restOfFetchOptions,
		plugins: [lifeCyclePlugin, ...(restOfFetchOptions.plugins ?? []), ...(options?.disableDefaultFetchPlugins ? [] : [redirectPlugin]), ...pluginsFetchPlugins],
	});

	// 3) 会话原子与信号
	const { $sessionSignal, session, broadcastSessionUpdate } = getSessionAtom($fetch, options);

	// 4) 水合：只在首次非空调用时生效
	//    失败分支：第二次调用或传 null → 直接返回，不覆盖已有状态
	let hasHydrated = false;
	const hydrateSession = (sessionData: SessionData | null) => {
		if (hasHydrated || sessionData === null) return;
		hasHydrated = true;
		hydrateSessionAtom(session, sessionData);
	};

	// 5) 强制 POST 路径表（4 条）
	const pluginPathMethods: Record<string, "POST" | "GET"> = {
		"/sign-out": "POST",
		"/revoke-sessions": "POST",
		"/revoke-other-sessions": "POST",
		"/delete-user": "POST",
	};

	// 6) 默认原子监听器：12 条会话信号路径 + 广播回调
	const atomListeners: ClientAtomListener[] = [
		{
			signal: "$sessionSignal",
			matcher: matchesSessionSignal,
			callback(path) {
				if (path === "/sign-out") broadcastSessionUpdate("signout");
				else if (path === "/update-user" || path === "/update-session") broadcastSessionUpdate("updateUser");
			},
		},
	];

	// 7) 插件贡献合并：atoms 覆盖、pathMethods 覆盖、atomListeners 追加
	for (const plugin of options?.plugins ?? []) {
		if (plugin.getAtoms) Object.assign(pluginsAtoms, plugin.getAtoms($fetch));
		if (plugin.pathMethods) Object.assign(pluginPathMethods, plugin.pathMethods);
		if (plugin.atomListeners) atomListeners.push(...plugin.atomListeners);
	}

	// 8) 存储面
	const $store = {
		notify: (signal) => { pluginsAtoms[signal]!.set(!pluginsAtoms[signal]!.get()); },
		listen: (signal, listener) => { pluginsAtoms[signal]!.subscribe(listener); },
		atoms: pluginsAtoms,
	};

	// 9) 插件动作合并：defu 语义——后声明的插件覆盖先声明者，先声明者只补空缺
	let pluginsActions = {};
	for (const plugin of options?.plugins ?? []) {
		if (plugin.getActions) pluginsActions = defu(plugin.getActions($fetch, $store, options) ?? {}, pluginsActions);
	}

	return { baseURL, pluginsActions, pluginsAtoms, pluginPathMethods, atomListeners, hydrateSession, $sessionSignal, $fetch, $store };
}
```

失败分支清单：`baseURL` 全部候选都解析失败 → 落到 `"/api/auth"` 相对基址；运行环境不支持 `credentials` → 不下发该字段（不报错）；`hydrateSession` 二次调用或传 `null` → 静默忽略；插件 `getAtoms` 未提供 → 原子集合不变；`$store.notify` 传入未知信号名 → 读取 `undefined` 时抛错（插件侧责任，框架不校验信号名）。

#### 10.4.2 Proxied Call

```ts
// 动态路径代理的一次调用
// 取证：packages/better-auth/src/client/proxy.ts:36-125
async function proxiedCall(pathSegments: string[], args: ProxyCallArgs) {
	// 1) 路径：属性链逐段 kebab 化
	const routePath = toRoutePath(pathSegments);

	// 2) 方法：已知路径表 > 显式 method > 有体 POST > 否则 GET
	const method = resolveMethod(routePath, knownPathMethods, args[0]);

	// 3) 拆参：query 与 fetchOptions 从请求体中剥离
	const { query, fetchOptions: argFetchOptions, ...body } = args[0] ?? {};
	const options = { ...(args[1] ?? {}), ...(argFetchOptions ?? {}) };

	// 4) 请求：GET 丢弃请求体
	return await $fetch(routePath, {
		...options,
		body: method === "GET" ? undefined : { ...body, ...(options?.body ?? {}) },
		query: query || options?.query,
		method,
		async onSuccess(context) {
			await options?.onSuccess?.(context);

			// 失败分支：disableSignal → 不触发任何信号
			if (!atomListeners || options.disableSignal) return;

			const matches = atomListeners.filter((s) => s.matcher(routePath));
			if (!matches.length) return;

			const visited = new Set<string>();
			for (const match of matches) {
				const signal = atoms[match.signal];
				// 失败分支：信号原子不存在 → 直接返回，不继续后续监听器
				if (!signal) return;
				if (visited.has(match.signal)) continue;
				visited.add(match.signal);
				// 成功后才翻转；延迟 10ms 避免与本次响应同帧竞争
				const val = signal.get();
				setTimeout(() => { signal.set(!val); }, 10);
				match.callback?.(routePath);
			}
		},
	});
}
```

失败分支清单：GET 丢弃请求体（调用方误传体不会报错，但也不会生效）；显式 `method` 与已知路径表冲突时已知路径表胜出；`disableSignal` 为真时成功响应不翻转任何信号；监听器命中的信号原子缺失时提前结束（其余监听器也不再执行）；同一个信号被多个监听器命中时只翻转一次（`visited` 去重）。

#### 10.4.3 Session Fetch

```ts
// 会话原子的取数
// 取证：packages/better-auth/src/client/session-atom.ts:128-264
async function executeSessionFetch(signal: AbortSignal, queryParams?: { query?: SessionQueryParams }): Promise<SessionFetchOutcome> {
	// 1) 进入飞行态
	session.set({ ...session.value, isPending: session.value.data === null, isRefetching: true, error: null, refetch });

	// 失败分支：已被取消 → "aborted"，不写状态
	if (signal.aborted) return "aborted";

	try {
		const res = await $fetch<SessionResponse>("/get-session", { method: "GET", query: queryParams?.query, signal });
		if (signal.aborted) return "aborted";

		let { data, error } = normalizeSessionResponse(res);
		let outcome: SessionFetchOutcome = "fresh";

		// 2) needsRefresh → 二次 POST 刷新
		if (data?.needsRefresh) {
			try {
				const refreshRes = await $fetch<SessionResponse>("/get-session", { method: "POST", signal });
				if (signal.aborted) return "aborted";
				({ data, error } = normalizeSessionResponse(refreshRes));
			} catch {
				// 失败分支：刷新请求失败 → 标记 stale，继续用旧数据
				if (signal.aborted) return "aborted";
				outcome = "stale";
			}
		}

		// 3) 错误处理
		if (error) {
			const isUnauthorized = error.status === 401;
			session.set({
				// 401 → 清空数据（会话确已失效）
				// 其他错误 → 保留旧数据（网络抖动不应把用户踢出界面）
				data: isUnauthorized ? null : session.value.data,
				error,
				isPending: false,
				isRefetching: false,
				refetch,
			});
			return "failed";
		}

		// 4) 成功：内容相等则保留旧引用，避免无谓重渲染
		const sessionData = normalizeSessionData(data);
		const current = session.value;
		const stableData = current.data != null && sessionData != null && isJsonEqual(current.data, sessionData) ? current.data : sessionData;
		session.set({ data: stableData, error: null, isPending: false, isRefetching: false, refetch });
		return outcome;
	} catch (fetchError) {
		// 失败分支：抛错 → 保留旧数据，仅记录错误
		if (signal.aborted) return "aborted";
		session.set({ data: session.value.data, error: fetchError, isPending: false, isRefetching: false, refetch });
		return "failed";
	}
}
```

失败分支清单：请求被取消（`AbortSignal`）→ 返回 `"aborted"`，不写原子状态；`needsRefresh` 的二次刷新失败 → 结果标记 `"stale"`，保留先前的数据；HTTP 401 → 数据清空、错误写入；其他 HTTP 错误 → 数据保留、错误写入；网络异常抛错 → 数据保留、错误写入。

#### 10.4.4 Refresh Triggers And Cross-tab Sync

```ts
// 刷新触发源
// 取证：packages/better-auth/src/client/session-refresh.ts:34-198, broadcast-channel.ts:20-74
function createSessionRefreshManager(opts: SessionRefreshOptions) {
	const refetchInterval = opts.options?.sessionOptions?.refetchInterval ?? 0;      // 默认 0：不轮询
	const refetchOnWindowFocus = opts.options?.sessionOptions?.refetchOnWindowFocus ?? true; // 默认 true
	const refetchWhenOffline = opts.options?.sessionOptions?.refetchWhenOffline ?? false;   // 默认 false

	function shouldRefetch(): boolean {
		// 失败/边界分支：离线且未开启离线刷新 → 不刷新
		return refetchWhenOffline || getGlobalOnlineManager().isOnline;
	}

	function triggerRefetch(event?: { event?: "poll" | "visibilitychange" | "storage" }) {
		if (!shouldRefetch()) return; // 离线且不允许 → 直接返回

		if (event?.event === "storage") {
			// 跨标签广播 → 立即重新拉取（无时间限流）
			void fetchSession();
			return;
		}
		if (event?.event === "poll") {
			state.lastSessionRequest = now();
			void fetchSession();
			return;
		}
		if (event?.event === "visibilitychange") {
			// 可见性变化：5 秒限流，避免频繁切窗打爆服务端
			const timeSinceLastRequest = now() - state.lastSessionRequest;
			if (timeSinceLastRequest < FOCUS_REFETCH_RATE_LIMIT_SECONDS) return; // 5
			state.lastSessionRequest = now();
			void fetchSession();
			return;
		}
		// 无事件来源（如信号翻转）→ 直接刷新
		void fetchSession();
	}

	function broadcastSessionUpdate(trigger: "signout" | "getSession" | "updateUser") {
		getGlobalBroadcastChannel().post({
			event: "session",
			data: { trigger },
			clientId: Math.random().toString(36).substring(7),
		});
	}

	function cleanup() {
		// 逆序清理：定时器 → 订阅 → setup 清理函数
		if (state.pollInterval) clearInterval(state.pollInterval);
		state.unsubscribeBroadcast?.();
		state.unsubscribeFocus?.();
		state.unsubscribeOnline?.();
		state.unsubscribeSignal?.();
		state.cleanupBroadcastSetup?.();
		state.cleanupFocusSetup?.();
		state.cleanupOnlineSetup?.();
		state.isInitialized = false;
		state.lastSessionRequest = 0;
	}
}
```

失败分支清单：离线且 `refetchWhenOffline` 为假 → 所有触发源都跳过刷新；可见性变化在 5 秒限流窗口内 → 跳过刷新；`localStorage` 写入失败（隐私模式、配额满）→ 广播静默失败（`try/catch` 吞掉异常），不影响本标签页会话；`storage` 事件中的载荷缺少 `event: "session"` 或 `data` → 被忽略。

#### 10.4.5 Generic Auth Query

```ts
// 通用查询原语
// 取证：packages/better-auth/src/client/query.ts:37-207
function useAuthQuery<T>(initializedAtom: PreinitializedWritableAtom<unknown> | PreinitializedWritableAtom<unknown>[], path: string, $fetch: BetterFetch, options?: ClientFetchOption | ((v: { data: null | T; error: null | BetterFetchError; isPending: boolean }) => ClientFetchOption)) {
	let latestRequestId = 0;

	async function fn(queryParams?: { query?: SessionQueryParams }) {
		// 每次调用自增序号：只有最新一次请求可以写入原子（最新请求获胜）
		const requestId = ++latestRequestId;

		return $fetch<T>(path, {
			...opts,
			query: { ...opts?.query, ...queryParams?.query },
			async onSuccess(context) {
				// 失败分支：已被更新的请求取代 → 丢弃本次结果
				if (requestId !== latestRequestId) return;
				const current = value.get();
				// 内容相等则保留旧引用
				const stableData = current.data != null && context.data != null && isJsonEqual(current.data, context.data) ? current.data : context.data;
				value.set({ data: stableData, error: null, isPending: false, isRefetching: false, refetch: value.value.refetch });
				await opts?.onSuccess?.(context);
			},
			async onError(context) {
				// 重试期间不写错误：retryAttempt 未达上限 → 直接返回
				const retryAttempts = typeof context.request.retry === "number" ? context.request.retry : context.request.retry?.attempts;
				const retryAttempt = context.request.retryAttempt || 0;
				if (retryAttempts && retryAttempt < retryAttempts) return;
				if (requestId !== latestRequestId) return;
				const isUnauthorized = context.error.status === 401;
				value.set({
					error: context.error,
					// 401 清空数据，其他错误保留旧数据
					data: isUnauthorized ? null : value.get().data,
					isPending: false,
					isRefetching: false,
					refetch: value.value.refetch,
				});
				await opts?.onError?.(context);
			},
			async onRequest(context) {
				if (requestId !== latestRequestId) return;
				const currentValue = value.get();
				value.set({ isPending: currentValue.data === null, data: currentValue.data, error: null, isRefetching: true, refetch: value.value.refetch });
				await opts?.onRequest?.(context);
			},
		}).catch((error) => {
			if (requestId !== latestRequestId) return;
			value.set({ error, data: value.get().data, isPending: false, isRefetching: false, refetch: value.value.refetch });
		});
	}
	return value;
}
```

失败分支清单：旧请求的响应晚于新请求到达 → 旧结果被丢弃（最新请求获胜）；重试未达上限 → 不写入错误状态；HTTP 401 → 数据清空；其他错误 → 数据保留；请求抛出异常 → 保留旧数据并记录错误。

### 10.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-10-01 | 客户端已创建，服务端提供 `/sign-in/email` 与 `/get-session` | 调用 `authClient.signIn.email({ email, password })`，随后读取会话状态 | 请求路径为 `/sign-in/email`、方法为 POST（存在请求体）；成功后 `data` 被填充、`isPending` 变 false、`error` 为 null |
| ACC-10-02 | 服务端提供一个只支持 GET 的读取端点与一个必须 POST 的端点 | 分别以「有体」和「无体」调用未知路径端点 | 已知路径表中的路径（`/sign-out`、`/revoke-sessions`、`/revoke-other-sessions`、`/delete-user`）强制 POST；未知路径在有体时为 POST、无体时为 GET；GET 请求的请求体被丢弃 |
| ACC-10-03 | 服务端 `/get-session` 返回 401 | 触发会话读取 | `data` 被清空为 null，`error.status` 为 401；界面回到未认证态 |
| ACC-10-04 | 服务端 `/get-session` 返回 500，但客户端已有有效会话数据 | 触发会话重新拉取 | `data` 保留旧值不被清空，`error` 被写入，`isRefetching` 回到 false |
| ACC-10-05 | 服务端 `/get-session` 首次返回 `needsRefresh: true`，随后 POST 刷新返回有效会话 | 触发会话读取 | 客户端自动发起第二次 POST 刷新；最终 `data` 为刷新后的会话 |
| ACC-10-06 | 同一用户在两个标签页打开应用 | 在标签页 A 执行登出，标签页 B 保持打开 | 标签页 B 通过 `better-auth.message` 频道收到 `signout` 触发并重新拉取会话；B 的会话变为未认证 |
| ACC-10-07 | 客户端在服务端渲染时已知会话 | 服务端调用 `hydrateSession(session)`，客户端随后挂载 | 服务端会话被注入客户端原子，客户端首次渲染即处于已认证态，无闪烁；二次调用 `hydrateSession` 不改变状态 |
| ACC-10-08 | 客户端在短时间内反复切换窗口可见性 | 连续多次触发可见性变化 | 5 秒限流窗口内的重复触发不发起新的会话请求；超过窗口后恢复刷新 |
| ACC-10-09 | Nuxt 应用使用 Vue 绑定且未显式配置 `baseURL` | 在服务端渲染期间读取会话 | 会话请求走相对路径（携带入站 Cookie），不依赖环境变量；缓存键形如 `better-auth:session:inferred:/api/auth` |

### 10.6 Framework Bindings

| 绑定 | 入口 | `useSession` 形态 | 状态订阅机制 | 特有约定 |
|---|---|---|---|---|
| vanilla | `packages/better-auth/src/client/vanilla.ts` | AuthQueryState 会话原子 | nanostores `atom.listen` | 通用基座，其他绑定的共同底座 |
| React | `packages/better-auth/src/client/react/index.ts` | 函数 `() => { data, error, isPending, isRefetching, refetch }` | `useStore` 基于 `useSyncExternalStore` | 服务端快照取 `store.init`，用于 SSR 水合重放 |
| Vue | `packages/better-auth/src/client/vue/index.ts` | 重载：无参返回 `Ref`；传入 `useFetch` 返回 `Promise`（Nuxt SSR） | `vue-store` 的 `watch`/`computed` | 不读环境变量；缓存键 `better-auth:session:<baseURLKey>:<basePath>` |
| Solid | `packages/better-auth/src/client/solid/index.ts` | 函数，返回 `AuthQueryState` 读取器 | `solid-store` 的 signal 桥接 | 读取值为 accessor，需在追踪上下文内取用 |
| Svelte | `packages/better-auth/src/client/svelte/index.ts` | 函数，返回 `AuthQueryState` 原子 | 直接返回 nanostores 原子 | 与 vanilla 同形，Svelte 侧自行订阅 |
| Lynx | `packages/better-auth/src/client/lynx/index.ts` | 函数 `() => { data, isPending, error, refetch }` | `lynx-store` 的订阅桥接 | 形状中**没有** `isRefetching` |

### 10.7 Known Caveats

- 1.7.16 **没有** `createAuthFetch` 导出；客户端只暴露 better-fetch 实例 `$fetch`（`packages/better-auth/src/client/vanilla.ts:69`、`packages/better-auth/src/client/config.ts:87-107`）。
- `matchesSessionSignal` 命中 12 条路径（`packages/better-auth/src/client/config.ts:42-54`），而强制 POST 的路径只有 4 条（`packages/better-auth/src/client/config.ts:126-131`）；两者不是同一张表。
- Vue 绑定通过 `getClientConfig(options, false)` 显式禁用环境变量读取（`packages/better-auth/src/client/vue/index.ts:148`），因此 Vue 客户端的 `baseURL` 不来自 `NEXT_PUBLIC_AUTH_URL` 等环境变量。
- `useSession` 的形态按绑定而异（原子 / 函数 / Ref / 重载），不能跨绑定互换使用；跨框架混用时需自行归一。Lynx 绑定的返回形状缺少 `isRefetching`（`packages/better-auth/src/client/lynx/index.ts:64-71`），与其它绑定不一致。
