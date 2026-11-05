---
title: 插件域
description: 以受控契约扩展框架能力并保证扩展点隔离与可卸载的扩展平面设计。
sidebar:
  order: 11
  label: 插件域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 9. Extension Model

插件域是**外围域**。它把「第三方如何在不改动核心代码的前提下扩展框架」这件事收敛成一份可枚举、可审计、可卸载的契约；它不承载认证判断本身，会话签发、主体档案维护与凭证校验仍由核心域（[会话域](./03-session/)、[身份域](./05-identity/)、[凭证域](./04-credential/)）唯一负责。在 [总体方案与架构](../architecture/) 的四平面划分中，插件域横跨装配平面、契约平面与核心业务平面。

插件域与相邻模块的分界是：**扩展点归插件域，端点语义归端点路由域**（见 [端点路由域](./02-endpoint/)）。插件可以注册端点、贡献数据表模型、挂载拦截与加工、声明限流规则、贡献错误码与类型推断，但它**不得旁路核心域直接改写会话与主体档案**——所有对主体与会话的写入仍须经过核心域的存储契约与守卫。

### 9.1 Responsibility Boundary

**插件域负责：**

- 定义服务端插件契约 `BetterAuthPlugin` 与客户端插件契约 `BetterAuthClientPlugin` 的全部属性面（取值、必填性、枚举）。
- 定义插件在装配期（`init`）、路由期（`endpoints` / `middlewares` / `onRequest` / `onResponse`）、执行期（`hooks.before` / `hooks.after`）三个阶段的接入点与合并顺序。
- 定义插件数据模型（`schema`）如何并入核心表结构、插件如何贡献索引与迁移开关。
- 定义插件错误码（`$ERROR_CODES`）与类型推断（`$Infer`）如何汇入框架的统一错误面与类型面。
- 定义插件限流规则（`rateLimit`）如何参与窗口选择。
- 提供插件目录（内建插件与独立扩展包）的清单与职责说明。

**插件域不负责（明确拒绝承担的职责）：**

- 不判定认证结论：插件不得自行签发或续期会话，不得直接写主体档案。
- 不承担来源校验与限流的最终裁决：`originCheckMiddleware` 与限流窗口选择在核心域完成，插件只能追加规则。
- 不做权限判定：角色与语句的授权语义属于 [权限与多主体](../permissions/)，插件只能复用其判定结果，不能自行解释主体身份。
- 不管理路由表结构本身：插件端点按 key 合并进端点表，路由冲突由框架统一记录（见 9.4）。
- 不负责客户端渲染与状态管理：客户端侧只有契约（原子、动作、路径方法），渲染由宿主承担（见 [客户端域](./10-client/)）。

**与核心域的协作与隔离原则：**

| 扩展点 | 隔离手段 | 越界后果 |
|---|---|---|
| `init` 返回的 `context` | 只允许扩展 `AuthContext` 类型中除 `options` 键以外的字段，`options` 不允许被上下文覆盖 | 插件可新增能力，但无法替换框架级配置 |
| `init` 返回的 `options` | 与用户配置以 `defu` 合并，用户已有值优先 | 插件无法用默认值覆盖宿主的显式配置 |
| `endpoints` | 按 key 合并；后声明覆盖先声明；冲突只记录不抛错 | 插件覆盖同名端点时行为依赖声明顺序，需自行审计 |
| `hooks` | 用户钩子先于插件钩子；before 可短路；after 可改写 | 插件能观测与加工，但用户配置始终拥有第一发言权 |
| `schema` | 字段级合并、索引去重；核心表（`user`/`session`/`account`/`verification`）由核心域掌握 | 插件不能删除核心字段，只能追加 |
| `rateLimit` | 插件规则先于 `customRules` 命中，命中即 `break` | 插件规则会覆盖全局 `customRules` 之前的取值 |

### 9.2 Capability Inventory

- **插件身份**：`id` 为唯一必填标识；`version` 记录实现版本；框架据此把插件错误码、类型推断与限流规则归并到统一的面。
- **装配期扩展（`init`）**：插件在上下文创建后被顺序调用，可返回 `context`（新增上下文能力）与 `options`（追加全局配置）两个分支。
- **来源扩展**：`init` 返回的 `options.trustedOrigins` 与宿主 `trustedOrigins` 合并——静态数组拼接，动态函数合并为一个异步函数。**插件契约里没有 `trustedOrigins` 这个顶层属性**，来源扩展只能走 `init` 的返回值。
- **数据钩子扩展**：`init` 返回的 `options.databaseHooks` 被单独抽出并登记来源 `plugin:<id>`，不与宿主 `databaseHooks` 直接混写。
- **端点扩展（`endpoints`）**：以 key 为单位声明端点，合并进端点表；后声明的插件覆盖同 key 的先声明者。声明为 server-only 的端点（`createAuthEndpoint.serverOnly`）不进入 HTTP 路由，只在服务端可信代码中经 `auth.api.*` 调用。
- **中间件扩展（`middlewares`）**：以 `{ path, middleware }` 声明，作为路由级中间件挂载，路径参与路由匹配。
- **请求期扩展（`onRequest`）**：在路由处理前介入，可返回 `{ response }` 直接短路，或返回 `{ request }` 替换进入后续处理器的请求对象。
- **响应期扩展（`onResponse`）**：在响应生成后介入，返回 `{ response }` 则替换响应，否则保留原响应。
- **执行期拦截与加工（`hooks.before` / `hooks.after`）**：`matcher` 决定是否命中，`handler` 决定动作。before 钩子返回 `{ context }` 时把字段合并进请求上下文，返回其他值则直接短路端点；after 钩子可改写端点返回值。
- **数据模型扩展（`schema`）**：以表为单位声明 `fields` / `indexes` / `disableMigration` / `modelName`，与核心表字段级合并，索引按定义去重。
- **迁移扩展（`migrations`）**：声明 `Record<string, Migration>`；与 `schema` 并存时 `schema` 优先（`schema` 会自动生成迁移）。
- **限流扩展（`rateLimit`）**：以 `{ window, max, pathMatcher }` 声明路径级规则，命中即覆盖当前窗口与上限。
- **错误码贡献（`$ERROR_CODES`）**：插件可贡献自己的错误码集合，框架在 `auth.$ERROR_CODES` 中与基础错误码合并；命名规则见 [错误码](../errors/)。
- **类型推断贡献（`$Infer`）**：插件可贡献类型推断载荷，供宿主消费。
- **客户端插件（`BetterAuthClientPlugin`）**：贡献客户端动作（`getActions`）、状态原子（`getAtoms`）、强制路径方法（`pathMethods`）、fetch 插件（`fetchPlugins`）、原子监听（`atomListeners`）与错误码（`$ERROR_CODES`）。
- **冲突检测**：`checkEndpointConflicts` 按路径与 HTTP 方法比对插件端点，冲突时**只记录错误日志，不抛异常**，不阻断启动。
- **插件目录**：内建插件 26 个目录 + 独立扩展包 8 个。插件贡献的端点在 [服务端接口](../api/) 中可见；插件贡献的数据表在 [数据字典](../data/) 中登记。

### 9.3 Contract

#### 9.3.1 Server Plugin Contract

```ts
/** 字面量字符串类型 / Literal string type */
export type LiteralString = string;

/** 可等待值 / Awaitable value */
export type Awaitable<T> = T | Promise<T>;

/** 深度可选（函数保持原样）/ Deep partial, functions kept as-is */
export type DeepPartial<T> = T extends Function
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

/**
 * 插件初始化返回值 / Plugin bootstrap result
 * 注意：不含 `ctx` / `api` 字段，返回的是 `context` 与 `options` 两个分支。
 */
export interface BetterAuthPluginInitResult {
	/** 合并进运行时上下文的扩展字段（可选）/ Extra context fields (optional) */
	context?: DeepPartial<Omit<AuthContext, "options">> & Record<string, unknown>;
	/** 合并进全局配置的选项（可选）/ Options merged into global options (optional) */
	options?: Partial<BetterAuthOptions>;
}

/** 插件钩子定义 / Plugin hook definition */
export interface BetterAuthPluginHook {
	/** 命中判定；抛错将被转为内部错误 / Matcher; a throw becomes an internal error */
	matcher: (context: HookEndpointContext) => boolean;
	/** 钩子主体 / Hook handler */
	handler: AuthMiddleware;
}

/**
 * 服务端插件契约 / Server plugin contract
 * 取证：packages/core/src/types/plugin.ts:39-165
 */
export interface BetterAuthPlugin {
	/** 必填，插件唯一标识 / Required, unique plugin identifier */
	id: LiteralString;
	/** 插件版本（可选）/ Plugin version (optional) */
	version?: string;

	/** 装配期初始化（可选）/ Bootstrap hook (optional) */
	init?: (ctx: AuthContext) => Awaitable<BetterAuthPluginInitResult | void>;

	/** 端点扩展（可选）/ Endpoint contribution (optional) */
	endpoints?: Record<string, Endpoint>;

	/** 路由级中间件（可选）/ Route-level middleware (optional) */
	middlewares?: Array<{ path: string; middleware: Middleware }>;

	/** 请求期介入（可选）/ Request-phase interception (optional) */
	onRequest?: (
		request: Request,
		ctx: AuthContext,
	) => Promise<{ response: Response } | { request: Request } | void>;

	/** 响应期介入（可选）/ Response-phase interception (optional) */
	onResponse?: (
		response: Response,
		ctx: AuthContext,
	) => Promise<{ response: Response } | void>;

	/** 执行期钩子（可选）/ Execution-phase hooks (optional) */
	hooks?: {
		before?: BetterAuthPluginHook[];
		after?: BetterAuthPluginHook[];
	};

	/** 插件数据模型（可选）/ Plugin data model (optional) */
	schema?: BetterAuthPluginDBSchema;

	/** 插件迁移（可选）/ Plugin migrations (optional) */
	migrations?: Record<string, Migration>;

	/** 插件自有选项（可选）/ Plugin-owned options (optional) */
	options?: Record<string, unknown>;

	/** 类型推断载荷（可选）/ Type inference payload (optional) */
	$Infer?: Record<string, unknown>;

	/** 限流规则（可选）/ Rate limit rules (optional) */
	rateLimit?: Array<{
		/** 窗口长度（秒）/ Window length in seconds */
		window: number;
		/** 窗口内最大请求数 / Max requests inside the window */
		max: number;
		/** 路径命中判定 / Path matcher */
		pathMatcher: (path: string) => boolean;
	}>;

	/** 数据操作覆盖（可选）/ Data operation overrides (optional) */
	adapter?: Record<string, (...args: unknown[]) => Awaitable<unknown>>;

	/** 插件错误码（可选）/ Plugin error codes (optional) */
	$ERROR_CODES?: Record<string, RawError>;
}
```

#### 9.3.2 Plugin Database Schema Contract

```ts
/** 字段属性（节选）/ Field attribute (excerpt) */
export interface DBFieldAttribute {
	/** 字段类型 / Field type */
	type: "string" | "number" | "boolean" | "date" | "json" | "string[]" | "number[]";
	/** 新建记录时是否必填，默认 true / Required on insert, default true */
	required?: boolean;
	/** 是否出现在响应体，默认 true / Returned in response body, default true */
	returned?: boolean;
	/** 是否可由调用方写入，默认 true / Writable by caller, default true */
	input?: boolean;
	/** 创建时的默认值 / Default value on create */
	defaultValue?: DBPrimitive | (() => DBPrimitive);
	/** 更新时的取值 / Value on update */
	onUpdate?: () => DBPrimitive;
	/** 入库/出库变换 / Input/output transform */
	transform?: {
		input?: (value: DBPrimitive) => Awaitable<DBPrimitive>;
		output?: (value: DBPrimitive) => Awaitable<DBPrimitive>;
	};
	/** 外键引用 / Reference to another model */
	references?: {
		model: string;
		field: string;
		onDelete?: "no action" | "restrict" | "cascade" | "set null";
	};
}

/** 表级索引 / Table-level index */
export interface DBTableIndex {
	/** 索引字段，1..16 个，按索引顺序 / Indexed fields, 1..16, in index order */
	fields: readonly [string, ...string[]];
	/** 可移植索引名，≤63 UTF-8 字节 / Portable index name, at most 63 UTF-8 bytes */
	name?: string;
	/** 是否唯一 / Whether the tuple must be unique */
	unique?: boolean;
}

/**
 * 插件数据模型契约 / Plugin database schema contract
 * 取证：packages/core/src/db/plugin.ts:3-13
 */
export interface BetterAuthPluginDBSchema {
	[table: string]: {
		/** 表字段定义 / Table fields */
		fields: Record<string, DBFieldAttribute>;
		/** 表级索引，含复合索引 / Table-level indexes, compound included */
		indexes?: readonly DBTableIndex[];
		/** 是否跳过自动迁移，默认 false / Skip automatic migration, default false */
		disableMigration?: boolean;
		/** 覆盖模型名 / Override model name */
		modelName?: string;
	};
}
```

#### 9.3.3 Client Plugin Contract

```ts
/** 客户端存储面 / Client store surface */
export interface ClientStore {
	/** 翻转一个信号原子的值 / Flip the value of a signal atom */
	notify: (signal: string) => void;
	/** 订阅一个信号原子的变化 / Subscribe to a signal atom */
	listen: (signal: string, listener: () => void) => void;
	/** 全部可注册原子 / All registrable atoms */
	atoms: Record<string, WritableAtom<unknown>>;
}

/** 原子监听器 / Atom listener */
export interface ClientAtomListener {
	/** 路径命中判定 / Path matcher */
	matcher: (path: string) => boolean;
	/** 触发的信号名 / Signal name */
	signal: "$sessionSignal" | Omit<string, "$sessionSignal">;
	/** 命中后的回调（可选）/ Callback after hit (optional) */
	callback?: (path: string) => void;
}

/**
 * 客户端插件契约 / Client plugin contract
 * 取证：packages/core/src/types/plugin-client.ts:94-143
 */
export interface BetterAuthClientPlugin {
	/** 必填，插件唯一标识 / Required, unique plugin identifier */
	id: LiteralString;
	/** 插件版本（可选）/ Plugin version (optional) */
	version?: string;

	/** 仅用于类型推断，不传真实插件 / Type inference only */
	$InferServerPlugin?: {
		id?: LiteralString;
		endpoints?: Record<string, unknown>;
		schema?: Record<string, { fields: Record<string, unknown> }>;
		$ERROR_CODES?: Record<string, { readonly code: string; message: string }>;
	};

	/** 自定义动作 / Custom actions */
	getActions?: (
		$fetch: BetterFetch,
		$store: ClientStore,
		options: BetterAuthClientOptions | undefined,
	) => Record<string, unknown>;

	/** 状态原子，由各框架适配层解析 / State atoms resolved per framework */
	getAtoms?: ($fetch: BetterFetch) => Record<string, Atom<unknown>>;

	/** 强制路径方法 / Force a method for a path */
	pathMethods?: Record<string, "POST" | "GET">;

	/** better-fetch 插件 / Better-fetch plugins */
	fetchPlugins?: BetterFetchPlugin[];

	/** 原子监听器 / Atom listeners */
	atomListeners?: ClientAtomListener[];

	/** 插件错误码 / Plugin error codes */
	$ERROR_CODES?: Record<string, { code: string; message: string }>;
}
```

#### 9.3.4 Hook Context Contract

```ts
/**
 * 钩子可见的端点上下文 / Endpoint context visible to hooks
 * 取证：packages/core/src/types/plugin.ts:21-30
 */
export interface HookEndpointContext {
	/** 端点路径（可选）/ Endpoint path (optional) */
	path?: string;
	/** 运行时上下文，含本次调用的返回值与响应头 / Runtime context with returned value and response headers */
	context: AuthContext & {
		returned?: unknown;
		responseHeaders?: Headers;
	};
	/** 请求头（可选）/ Request headers (optional) */
	headers?: Headers;
}
```

### 9.4 Flow

以下伪代码表达三条装配与执行链路的**契约与失败分支**，不是实现代码；括号内为源码取证位置。

#### 9.4.1 Plugin Bootstrap

```ts
// 装配期：依次调用每个插件的 init
// 取证：packages/better-auth/src/context/helpers.ts:23-98
async function runPluginInit(context: AuthContext): Promise<void> {
	const pluginTrustedOrigins: NonNullable<BetterAuthOptions["trustedOrigins"]>[] = [];
	const dbHooks: { source: string; hooks: Exclude<BetterAuthOptions["databaseHooks"], undefined> }[] = [];

	for (const plugin of context.options.plugins ?? []) {
		if (!plugin.init) continue;

		// 失败分支：init 抛错 → 向上抛出，装配失败（不降级为静默跳过）
		const result = await plugin.init(context);

		if (typeof result === "object" && result !== null) {
			if (result.options) {
				const { databaseHooks, trustedOrigins, ...restOpts } = result.options;
				// databaseHooks 单独登记来源，不与宿主 hooks 混写
				if (databaseHooks) dbHooks.push({ source: `plugin:${plugin.id}`, hooks: databaseHooks });
				// trustedOrigins 单独收集，稍后与宿主 trustedOrigins 合并
				if (trustedOrigins) pluginTrustedOrigins.push(trustedOrigins);
				// 其余选项用 defu 合并：宿主已有值优先，插件只补空缺
				context.options = defu(context.options, restOpts);
			}
			if (result.context) {
				// 就地合并到共享上下文，保留原对象引用
				Object.assign(context, result.context);
			}
		}
	}

	// 来源合并：静态数组拼接；动态函数合并成一个异步函数
	if (pluginTrustedOrigins.length > 0) {
		const allSources = [
			...(context.options.trustedOrigins ? [context.options.trustedOrigins] : []),
			...pluginTrustedOrigins,
		];
		const staticOrigins = allSources.filter(Array.isArray).flat();
		const dynamicOrigins = allSources.filter((s): s is Exclude<typeof s, string[]> => typeof s === "function");
		context.options.trustedOrigins =
			dynamicOrigins.length > 0
				? async (request) => {
						const resolved = await Promise.all(dynamicOrigins.map((fn) => fn(request)));
						return [...staticOrigins, ...resolved.flat()].filter((v): v is string => typeof v === "string" && v !== "");
					}
				: staticOrigins;
	}

	// 用户 databaseHooks 最后登记，因此其优先级高于插件
	if (context.options.databaseHooks) dbHooks.push({ source: "user", hooks: context.options.databaseHooks });

	context.internalAdapter = createInternalAdapter(context.adapter, {
		options: context.options,
		logger: context.logger,
		hooks: dbHooks,
		generateId: context.generateId,
	});
}
```

失败分支清单：`init` 抛错 → 装配失败并向上传播；`init` 返回 `null`/`undefined` → 跳过该插件的选项与上下文合并（不视为错误）；`result.context` 中包含 `options` 键 → 类型层面被 `AuthContext` 的 `options` 键排除，运行时通过 `Object.assign` 仍会写入同名键（框架不对此做二次校验，插件需自律）。

#### 9.4.2 Hook Pipeline

```ts
// 执行期：before / after 钩子管线
// 取证：packages/better-auth/src/api/dispatch.ts:137-307, 359-482
async function dispatchWithHooks(endpoint: Endpoint, input: DispatchContext): Promise<unknown> {
	const { beforeHooks, afterHooks } = getHooks(input.context);
	// getHooks：用户钩子（matcher 恒真）先入列，随后按声明顺序追加插件钩子
	// hooksSourceWeakMap 记录来源 "user" | "plugin:<id>"，用于日志定位

	let modifiedContext: Partial<InternalContext> = {};

	for (const hook of beforeHooks) {
		// 失败分支：matcher 抛错 → 记录来源日志并抛 INTERNAL_SERVER_ERROR，不泄露内部细节
		let matched = false;
		try {
			matched = hook.matcher(context);
		} catch (error) {
			log.error(`An error occurred during ${source} hook matcher execution:`, error);
			throw new APIError("INTERNAL_SERVER_ERROR", {
				message: "An error occurred during hook matcher execution. Check the logs for more details.",
			});
		}
		if (!matched) continue;

		const result = await hook.handler({ ...context, returnHeaders: true });

		// 钩子通过 c.setHeader / c.setCookie 累积的响应头先合并
		mergeResponseHeaders(context.context, result?.headers);

		const hookReturn = result?.response;
		if (hookReturn && typeof hookReturn === "object") {
			if ("context" in hookReturn && typeof hookReturn.context === "object") {
				// 分支一：返回 { context } → 合并进请求上下文（数组整体替换而非逐项合并）
				modifiedContext = defuReplaceArrays(rest, modifiedContext);
				continue; // 继续后续 before 钩子
			}
			// 分支二：返回其他对象 → 短路端点，直接作为结果
			return hookReturn;
		}
		// 分支三：返回空值 → 不短路，继续
	}

	// 合并后的上下文覆盖请求上下文；请求头覆盖合并，响应头单独累积
	context = defuReplaceArrays(modifiedContext, context);

	// 端点主体
	const result = await runEndpoint(endpoint, context);

	// 失败分支：处理器返回原生 Response → 跳过 after 钩子与后处理
	if (result instanceof Response) return result;

	for (const hook of afterHooks) {
		// 注意：after 钩子的 matcher 抛错不被捕获，直接向上冒泡
		if (!hook.matcher(context)) continue;
		const after = await hook.handler(context);
		mergeResponseHeaders(context.context, after?.headers);
		// after 钩子可改写返回值
		if (after?.response !== undefined) result.response = after.response;
	}

	// 失败分支：结果为 APIError 且非响应模式 → 重新抛出，交由 auth.api.* 调用方处理
	if (isAPIError(result.response) && !shouldReturnResponse) throw result.response;
	return shouldReturnResponse ? toResponse(result.response, { headers: result.headers, status: result.status }) : result.response;
}
```

失败分支清单：before `matcher` 抛错 → `INTERNAL_SERVER_ERROR`；before `handler` 抛 `APIError` → 原样向上抛（debug 级别日志时补 `errorStack`）；before 返回非 `{ context }` 对象 → 短路并把该对象作为最终结果，同时序列化已累积的响应头；after `matcher` 抛错 → 未被拦截，直接冒泡；after `handler` 抛 `APIError` → 被捕获并作为返回值参与后续处理，非响应模式下最终仍以 `APIError` 抛出。

#### 9.4.3 Endpoint Registration And Request Lifecycle

```ts
// 路由装配与请求生命周期
// 取证：packages/better-auth/src/api/index.ts:58-171, 173-273, 274-411
function registerPlugins(options: BetterAuthOptions) {
	// 1) 端点合并：按 key 覆盖，后声明者胜
	//    注意：合并顺序为 { ...baseEndpoints, ...pluginEndpoints, ok, error }
	//    —— 插件端点可覆盖核心端点同名 key，而 ok / error 永远最后、不可被覆盖
	const pluginEndpoints = (options.plugins ?? []).reduce<Record<string, Endpoint>>(
		(acc, plugin) => ({ ...acc, ...plugin.endpoints }),
		{},
	);

	// 2) 冲突检测：按 path + method 比对
	//    失败分支：只调用 logger.error 记录，不抛异常、不阻断启动
	checkEndpointConflicts(options, logger);

	// 3) 插件中间件挂载为路由级中间件，排在来源校验中间件之后
	const middlewares = (options.plugins ?? []).flatMap((plugin) =>
		(plugin.middlewares ?? []).map((m) => ({ path: m.path, middleware: wrap(m.middleware) })),
	);

	return { api: toAuthEndpoints({ ...baseEndpoints, ...pluginEndpoints, ok, error }), middlewares };
}

async function handleRequest(request: Request, ctx: AuthContext): Promise<Response> {
	// 4) 禁用路径 → 直接 404
	if (ctx.options.disabledPaths?.includes(normalizePathname(request.url, basePath))) {
		return new Response("Not Found", { status: 404 });
	}

	// 5) 结构校验（失败时记录日志，不阻断请求）
	await ctx.checkSchema?.();

	// 6) 限流：命中则短路
	const limited = await onRequestRateLimit(request, ctx);
	if (limited) return limited;

	// 7) 插件 onRequest：按声明顺序
	for (const plugin of ctx.options.plugins ?? []) {
		if (!plugin.onRequest) continue;
		const result = await plugin.onRequest(currentRequest, ctx);
		// 分支一：返回 { response } → 短路，后续插件与路由处理器都不执行
		if (result && "response" in result) return result.response;
		// 分支二：返回 { request } → 替换后续处理所用的请求对象
		if (result && "request" in result) currentRequest = result.request;
		// 分支三：返回空值 → 不干预
	}

	// 8) 路由执行（server-only 端点不在此路由表内，只经 auth.api.* 可达）
	const response = await route(currentRequest);

	// 9) 插件 onResponse：按声明顺序，返回 { response } 则替换响应
	for (const plugin of ctx.options.plugins ?? []) {
		if (!plugin.onResponse) continue;
		const result = await plugin.onResponse(response, ctx);
		if (result) return result.response;
	}
	return response;
}
```

失败分支清单：禁用路径命中 → 404；限流命中 → 直接返回限流响应；`onRequest` 返回 `{ response }` → 短路，后续插件的 `onRequest` 不再执行；`onRequest` 返回 `{ request }` → 替换请求，其后插件看到的是替换后的请求；`onResponse` 返回 `{ response }` → 替换响应，后续插件的 `onResponse` 不再看到原响应；端点冲突 → 仅记录日志，行为由覆盖顺序决定。

#### 9.4.4 Plugin Response Helper

```ts
// 插件读取端点返回值的辅助函数
// 取证：packages/better-auth/src/utils/plugin-helper.ts:3-22
async function getEndpointResponse<T>(ctx: { context: { returned?: unknown } }): Promise<T | null> {
	const returned = ctx.context.returned;
	// 失败分支一：没有返回值 → null
	if (!returned) return null;
	// 失败分支二：原生 Response 且状态码不是 200 → null（不解析错误体）
	if (returned instanceof Response) {
		if (returned.status !== 200) return null;
		return (await returned.clone().json()) as T;
	}
	// 失败分支三：结果是 APIError → null（错误由上层处理）
	if (isAPIError(returned)) return null;
	return returned as T;
}
```

#### 9.4.5 Plugin Data Model Merge

```ts
// 插件 schema 并入核心表结构
// 取证：packages/core/src/db/get-tables.ts:32-56
function mergePluginSchema(options: BetterAuthOptions): Record<string, PluginTable> {
	const pluginSchema = (options.plugins ?? []).reduce((acc, plugin) => {
		const schema = plugin.schema;
		if (!schema) return acc; // 无 schema 的插件不影响表结构
		for (const [key, value] of Object.entries(schema)) {
			acc[key] = {
				// 字段级合并：同名字段由后声明的插件覆盖
				fields: { ...acc[key]?.fields, ...value.fields },
				// 索引合并：按 [name, fields, unique] 的 JSON 指纹去重
				indexes: mergeTableIndexes(acc[key]?.indexes, value.indexes),
				// 模型名：插件可覆盖表名
				modelName: value.modelName || key,
				// 迁移开关：插件可覆盖核心取值
				disableMigrations: value.disableMigration ?? acc[key]?.disableMigrations,
			};
		}
		return acc;
	}, {});
	// 核心四表（user / session / account / verification）由核心域掌握，
	// 插件只能向其追加字段，不能替换
	return pluginSchema;
}
```

### 9.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-09-01 | 一个插件在 `init` 中返回 `options.databaseHooks.user.create.before`，并返回 `options.trustedOrigins` 为动态函数 | 启动服务，发起一次受信来源请求与一次非受信来源请求 | 动态来源与宿主 `trustedOrigins` 合并生效；非受信来源被拒绝并返回 `INVALID_ORIGIN`；`user.create.before` 在主体写入前执行 |
| ACC-09-02 | 两个插件声明了同一个 `endpoints` key，或同一 `path` 且方法重叠 | 启动服务并观察启动日志与端点行为 | 启动**不失败**；日志出现端点路径冲突错误记录；实际生效的是后声明插件的端点（后声明覆盖先声明） |
| ACC-09-03 | 一个插件声明 `hooks.before`，其 `matcher` 抛异常 | 调用任一命中该 `matcher` 的端点 | 返回 `INTERNAL_SERVER_ERROR`，消息为 hook matcher 执行失败的通用描述；日志中标注出错插件来源（`plugin:<id>`），内部细节不外泄 |
| ACC-09-04 | 一个插件声明 `hooks.before`，返回 `{ context: { headers } }`；另一个返回非 `{ context }` 的对象 | 依次触发两种返回形态 | 返回 `{ context }` 时请求继续执行且请求头被覆盖；返回其他对象时端点被短路，结果即为该对象，且钩子通过 `c.setHeader` / `c.setCookie` 累积的响应头被序列化到最终响应 |
| ACC-09-05 | 一个插件声明 `hooks.after` 并改写返回值；端点处理器本身返回原生 `Response` | 分别触发两种情况 | 处理器返回普通对象时，after 钩子的改写生效；处理器返回原生 `Response` 时，after 钩子**不执行**，响应原样返回 |
| ACC-09-06 | 一个插件声明 `middlewares: [{ path, middleware }]`，另一个声明 `onRequest` 返回 `{ response }` | 发起命中该中间件路径的请求 | 中间件在路由处理器之前执行；`onRequest` 返回 `{ response }` 时后续插件的 `onRequest` 与路由处理器均不执行，响应为插件给出的响应 |
| ACC-09-07 | 一个插件贡献 `schema`（含复合索引与 `modelName`），另一个插件声明同名字段 | 执行结构校验 / 迁移生成 | 插件字段并入目标表；同名索引只保留一份；`modelName` 覆盖生效；核心四表的既有字段未被删除 |
| ACC-09-08 | 插件以 `createAuthEndpoint.serverOnly` 声明端点 | 用 HTTP 请求访问其路径；在服务端代码中经 `auth.api.*` 调用 | HTTP 请求不命中该端点（不进路由表）；服务端可信代码调用成功 |

### 9.6 Plugin Catalog

#### 9.6.1 Built-in Plugins

内建插件位于 `packages/better-auth/src/plugins/`，共 26 个目录。

| 目录 | 插件 id | 一句话职责 |
|---|---|---|
| `admin` | `admin` | 提供主体角色、封禁与管理动作端点。 |
| `anonymous` | `anonymous` | 允许匿名访客获得临时主体身份并绑定后续登录。 |
| `bearer` | `bearer` | 允许用 `Authorization: Bearer` 头携带凭据代替 Cookie。 |
| `captcha` | `captcha` | 在敏感端点前校验人机验证凭据。 |
| `custom-session` | `custom-session` | 自定义会话字段与签发策略。 |
| `device-authorization` | `device-authorization` | 实现设备码授权流程，供无键盘设备接入。 |
| `email-otp` | `email-otp` | 以邮箱一次性口令完成注册与登录。 |
| `generic-oauth` | `generic-oauth` | 以标准授权协议对接任意外部身份提供方。 |
| `haveibeenpwned` | `have-i-been-pwned` | 在设置密码时校验口令是否已泄露。 |
| `jwt` | `jwt` | 签发与校验 JWT，接入无状态消费方。 |
| `last-login-method` | `last-login-method` | 记录并暴露主体最近一次登录方式。 |
| `magic-link` | `magic-link` | 以邮箱魔法链接完成无口令登录。 |
| `multi-session` | `multi-session` | 列出并管理同一主体的多个会话。 |
| `oauth-popup` | `oauth-popup` | 以弹窗方式完成授权流程并回传结果。 |
| `oauth-proxy` | `oauth-proxy` | 将授权请求代理到自有端点。 |
| `one-tap` | `one-tap` | 接入一次性快捷登录凭据。 |
| `one-time-token` | `one-time-token` | 签发一次性令牌用于无状态交接。 |
| `open-api` | `open-api` | 导出 OpenAPI 描述与接口参考页面。 |
| `organization` | `organization` | 建立组织、团队、成员与角色授权结构。 |
| `phone-number` | `phone-number` | 以手机号作为登录凭据。 |
| `siwe` | `siwe` | 以签名消息证明钱包地址持有。 |
| `test-utils` | `test-utils` | 提供测试用端点与夹具。 |
| `two-factor` | `two-factor` | 在主凭证之上叠加二次验证与备份码。 |
| `username` | `username` | 支持以用户名替代邮箱登录。 |
| `access` | （非插件） | 提供角色-语句判定辅助函数，被组织域复用；该目录不导出 `BetterAuthPlugin`。 |
| `additional-fields` | `additional-fields-client`（仅客户端） | 提供主体与会话附加字段的类型推断；服务端无对应插件实现。 |

#### 9.6.2 Standalone Extension Packages

独立扩展包位于 `packages/`，共 8 个。

| 包 | 插件 id | 一句话职责 |
|---|---|---|
| `passkey` | `passkey` | 接入 WebAuthn 无口令通行密钥注册与认证。 |
| `sso` | `sso` | 实现单点登录：服务方接入与身份提供方接入。 |
| `stripe` | `stripe` | 接入 Stripe 计费与客户门户，对接订阅状态。 |
| `mcp` | 继承 `oauth-provider` | 把 MCP 服务器作为 OAuth 资源服务器暴露，并提供受保护资源元数据。 |
| `scim` | `scim` | 实现 SCIM 2.0 目录供给：用户、群组与连接生命周期。 |
| `api-key` | `api-key` | 签发与校验面向机器调用的 API 密钥。 |
| `cimd` | `cimd` | 以受管身份文档完成 CI/CD 机器身份认证。 |
| `oauth-provider` | `oauth-provider` | 把框架自身作为 OAuth / OIDC 授权方对外提供服务。 |

### 9.7 Known Caveats

以下为 1.7.16 源码中可直接观察到、但与常见文档描述不一致的点，供后续评审确认：

- `BetterAuthPlugin` **没有** `trustedOrigins` 属性；来源扩展只能通过 `init` 返回 `options.trustedOrigins` 实现（`packages/core/src/types/plugin.ts:39-165`、`packages/better-auth/src/context/helpers.ts:44-84`）。
- `init` 的返回值是 `{ context?, options? }`，**不是** `{ ctx, options, api }`。
- `plugin.adapter`（`packages/core/src/types/plugin.ts:162-164`）与 `plugin.migrations`（同文件 `:138`）在类型面存在，但 1.7.16 的 `packages/` 目录内**没有运行时消费者**：数据库操作覆盖与迁移生成实际由 `plugin.schema` 驱动（`packages/core/src/db/get-tables.ts:32-56`）。
- `checkEndpointConflicts` 只记录错误日志，不抛异常（`packages/better-auth/src/api/index.ts:153-170`）。
- 插件端点的合并顺序是 `{ ...baseEndpoints, ...pluginEndpoints, ok, error }`（`packages/better-auth/src/api/index.ts:262-267`）：插件端点可覆盖核心端点同名 key，`ok` / `error` 除外。
- after 钩子的 `matcher` 抛错未被捕获（`packages/better-auth/src/api/dispatch.ts:230`），与 before 钩子的 `INTERNAL_SERVER_ERROR` 转换处理不同。
