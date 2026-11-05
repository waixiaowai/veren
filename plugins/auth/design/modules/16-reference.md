---
title: 参考域
description: 为运行时契约提供机器可读导出与文档站点结构的设计。
sidebar:
  order: 18
  label: 参考域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 16. Contract Export

参考域是**外围域**。它把框架运行时已经确定的事实——端点、请求体、响应体、表模型——导出成机器可读的 OpenAPI 文档与可交互的参考页，并维护文档站点的分区结构；**它不承担认证判定职责，移除后核心链路完整**——去掉 open-api 插件后，所有端点照常工作，只是少了一份可下载的契约快照。

参考域与相邻模块的分界是：**参考域只读，不写**。它不新增端点、不新增表、不改变任何请求的处理路径（唯一的例外是它自己注册的两个端点：`/open-api/generate-schema` 与参考页本身）。它与 [端点路由域](./02-endpoint/) 的关系是单向的：参考域从端点路由域**派生**文档，端点路由域不知道参考域的存在。它与 [诊断域](./12-diagnostics/) 的边界是：诊断域表达"运行时失败了什么"，参考域表达"运行时的契约长什么样"——前者是运行时的，后者是静态的。参考域导出的契约与 [接口总表](../api/) 是同一份事实的两种形态：前者是机器可读的 OpenAPI，后者是面向人的逐条说明。参考域在整体中的位置见 [总体方案与架构](../architecture/)。

### 16.1 Responsibility Boundary

**参考域负责：**

- 从表模型派生 `components.schemas`，把字段属性翻译成 OpenAPI schema（`packages/better-auth/src/plugins/open-api/generator.ts:894-936`）。
- 遍历全部端点（核心 + 各插件），生成 `paths` 与每个操作的 `operationId` / `parameters` / `requestBody` / `responses`（`packages/better-auth/src/plugins/open-api/generator.ts:941-1112`）。
- 输出完整 OpenAPI 文档：头部、组件、安全方案、服务器列表与标签（`:1114-1157`）。
- 提供参考页端点，用 Scalar 渲染交互式 API 文档（`packages/better-auth/src/plugins/open-api/index.ts:118-135`）。
- 提供 OpenAPI schema 的机器可读导出端点 `GET /open-api/generate-schema`（`packages/better-auth/src/plugins/open-api/index.ts:108-117`）。
- 提供健康检查端点 `GET /ok`，返回 `{ ok: true }`（`packages/better-auth/src/api/routes/ok.ts:4-39`）。
- 维护文档站点的分区结构与导航（`docs/content/docs/`）。

**参考域不负责（明确拒绝承担的职责）：**

- 不新增运行时语义：参考页与 schema 端点是**只读视图**，不产生任何副作用。
- 不保证文档与实现永不漂移：文档由代码生成，但 `info.version` 是**硬编码**的（见 16.2 的注意事项），漂移风险由人工审阅承担。
- 不做端点鉴权设计：安全方案（`apiKeyCookie` / `bearerAuth`）只是文档声明，实际判定在 [守卫域](./07-guard/)。
- 不托管静态资源：参考页的 Scalar 脚本从 jsDelivr CDN 加载。

**失败语义的统一约定：**

| 情形 | 表现 | 语义 |
|---|---|---|
| 参考页被显式禁用 | `disableDefaultReference: true` → 抛 `NOT_FOUND` | 端点存在但拒绝服务 |
| 端点被列入 `disabledPaths` | 该路径不出现在 OpenAPI 中 | 与运行时一致 |
| 端点是 `SERVER_ONLY` | 该端点不出现在 OpenAPI 中 | 与运行时一致 |
| 插件 id 为 `open-api` | 该插件自身的端点不出现在 OpenAPI 中 | 避免自引用 |

### 16.2 Capability Inventory

**OpenAPI 文档头部（`packages/better-auth/src/plugins/open-api/generator.ts:1114-1157`）：**

| 字段 | 值 | 取证 |
|---|---|---|
| `openapi` | `"3.1.1"` | `:1115` |
| `info.title` | `"Better Auth"` | `:1117` |
| `info.description` | `"API Reference for your Better Auth Instance"` | `:1118` |
| `info.version` | `"1.1.0"` | `:1119` |
| `servers[0].url` | `ctx.baseURL` | `:1143-1147` |
| `components.securitySchemes.apiKeyCookie` | `{ type: "apiKey", in: "cookie", name: "apiKeyCookie" }` | `:1124-1129` |
| `components.securitySchemes.bearerAuth` | `{ type: "http", scheme: "bearer" }` | `:1130-1134` |
| `security` | `[{ apiKeyCookie: [], bearerAuth: [] }]` | `:1137-1142` |
| `tags[0]` | `{ name: "Default", description: "..." }` | `:1148-1154` |

> **`info.version` 是硬编码的 `"1.1.0"`，不是发行版本。** 发行版是 1.7.16，但生成器里写死的是 `"1.1.0"`（`packages/better-auth/src/plugins/open-api/generator.ts:1119`）。这份版本号表示"API 契约的版本"而非"包的版本"。

**`components.schemas` 的派生规则（`:894-936`）：**

- 表名首字母大写作为模型名：`user` → `User`，`twoFactor` → `TwoFactor`（`:904`）。
- 每个模型恒有一个 `id` 属性：`{ type: "string", readOnly: true }`，且 `id` **恒在 `required` 列表里**（`:906-909`）。
- 字段 schema 由 `getFieldSchema` 派生（`:125-152`）：
  - `date` 类型 → `{ type: "string", format: "date-time" }`（`:137-138`）。
  - 数组类型（`string[]` / `number[]`）→ `{ type: "array", items: { type: "string" | "number" } }`（`:130-136`）。
  - `defaultValue` 非函数时写入 `default`（`:141-145`）。
  - `input === false` → 标 `readOnly: true`（`:147-149`）。
- 字段进入 `required` 的条件：`fieldValue.required && fieldValue.returned !== false`（`:913-915`）。

**路径与分组规则：**

- 核心端点归入 `Default` 标签组：`tags: ["Default", ...(options.metadata?.openapi?.tags || [])]`（`:958`、`:988`）。
- 插件端点归入**首字母大写的插件 id** 组：`plugin.id.charAt(0).toUpperCase() + plugin.id.slice(1)`——例如 `two-factor` → `Two-factor`、`organization` → `Organization`（`:1062-1064`、`:1089-1091`）。
- 路径参数转换：`/reset-password/:token` → `/reset-password/{token}`（`:833-840`）。
- `SERVER_ONLY` 端点被排除（`:944`、`:1046`）。
- `disabledPaths` 中的路径被排除（`:942`、`:1043`）。
- `open-api` 插件自身的端点被排除（`:1025-1027`）。
- **`HIDE_METADATA` 不排除**：`HIDE_METADATA` 只有 `{ scope: "server" }`（`packages/better-auth/src/utils/hide-metadata.ts:1-3`），生成器只检查 `SERVER_ONLY`，所以 `/error` 与 `/ok` **会出现在 OpenAPI 文档里**。

**`operationId` 去重规则（`:842-865`）：**

- 未声明 `operationId` 的端点不产生 `operationId`（返回 `undefined`）。
- 首次出现的 `operationId` 原样保留。
- 重复时追加**方法名**（首字母大写、其余小写，如 `POST` → `Post`）：`signIn` → `signInPost`。
- 仍冲突则追加序号，从 `2` 开始：`signInPost2`、`signInPost3`。

**请求体与响应体规则：**

- 无 `body` 的写操作仍给出一个空对象 schema（`:1004-1015`）。
- 所有操作都带 `security: [{ bearerAuth: [] }]`（`:965-969`、`:995-999`、`:1071-1075`、`:1100-1104`）。
- 响应默认包含 400 / 401 / 403 / 404 / 429 / 500 六种状态，各带 `{ message: string }` 的 JSON body（`:729-831`），端点自己声明的 `responses` 覆盖默认值（`:829`）。

**主体附加字段并入请求体（`:455-571`）：**

- 仅 `/sign-up/email` 与 `/update-user` 两个路径会并入主体附加字段（`USER_INPUT_BODY_PATHS`，`:459`）。
- 字段来源：`options.user.additionalFields` + 各插件的 `schema.user.fields`（`:496-508`）。
- `input === false` 的字段被跳过（`:513`）。
- 必填判定：`field.required === true && field.defaultValue === undefined`（`:517-519`）。
- 仅 `/sign-up/email` 会把这些字段并入 `required`；`/update-user` 不会（`:550-556`）。

**参考页插件选项（`packages/better-auth/src/plugins/open-api/index.ts:72-100`）：**

| 选项 | 默认 | 说明 |
|---|---|---|
| `path` | `"/reference"` | 参考页路径。**它挂在认证基路径下**，所以完整路径是 `/api/auth/reference`（`:76-79`） |
| `disableDefaultReference` | `false` | 为真时参考页端点抛 `NOT_FOUND`（`:125-127`） |
| `theme` | `"default"` | Scalar 主题名，取值集合：`alternate` / `default` / `moon` / `purple` / `solarized` / `bluePlanet` / `saturn` / `kepler` / `mars` / `deepSpace` / `laserwave` / `none`（`:19-31`） |
| `nonce` | `undefined` | 内联脚本的 CSP nonce，同时加在两个内联 script 标签上（`:38`、`:54`、`:67`） |

**参考页渲染（`:33-70`）：**

- 页面由 Scalar 渲染：脚本从 `https://cdn.jsdelivr.net/npm/@scalar/api-reference` 加载（`:67`）。
- OpenAPI 文档以 JSON 形式内联在 id 为 `api-reference`、类型为 `application/json` 的 script 节点中（`:49-53`）。
- 第二段内联脚本写入 Scalar 配置（favicon 为内联 SVG data URI、theme、metaData），通过 `dataset.configuration` 传递（`:54-66`）。

**健康端点（`packages/better-auth/src/api/routes/ok.ts:4-39`）：**

`GET /ok` 返回 `{ ok: true }`，元数据含 `HIDE_METADATA` 与 OpenAPI 响应描述 `"Check if the API is working"`。

**文档站点的分区结构（`docs/content/docs/`）：**

| 分区 | 内容 |
|---|---|
| `concepts/` | `api`、`cli`、`client`、`cookies`、`database`、`email`、`hooks`、`plugins`、`oauth`、`rate-limit`、`session-management`、`typescript`、`users-accounts` |
| `plugins/` | 各插件文档（`2fa`、`admin`、`agent-auth`、`anonymous`、`api-key/`、`cimd`、`device-authorization`、`email-otp`、`generic-oauth`、`have-i-been-pwned`、`i18n` 等）；另有 `scim/` 子目录 |
| `authentication/` | `email-password` 与各社交提供方（`google`、`github`、`microsoft` 等） |
| `adapters/` | `mysql`、`sqlite`、`postgresql`、`mssql`、`other-relational-databases`、`drizzle`、`prisma`、`mongo`、`community-adapters` |
| `integrations/` | 框架集成（`next`、`nuxt`、`svelte-kit`、`hono`、`express`、`fastify`、`astro`、`expo`、`electron` 等） |
| `guides/` | `your-first-plugin`、`create-a-db-adapter`、`dynamic-base-url`、`saml-sso-with-okta`、`optimizing-for-performance`、升级与迁移指南 |
| `reference/` | `options`、`errors/`、`faq`、`instrumentation`、`security`、`telemetry`、`resources`、`contributing` |
| `infrastructure/` | `introduction`、`getting-started`、`plugins/`、`services/` |
| `ai-resources/` | `mcp`、`skills`、`LLMs.txt` |
| `examples/` | 示例站点（在 `meta.json` 里被 `!examples` 标记为独立分区） |

每个分区的 `meta.json` 定义导航：`title` / `icon` / `pages`（可含 `"---分组名---"` 分隔符与 `"..."` 递归标记），根 `docs/content/docs/meta.json` 定义全局顺序。

### 16.3 Contract

#### 16.3.1 OpenAPI Document Contract

```ts
/**
 * OpenAPI 文档的顶层形状
 * 取证：packages/better-auth/src/plugins/open-api/generator.ts:1114-1157
 */
export interface OpenAPIDocument {
	/** 规范版本，固定 "3.1.1" */
	openapi: "3.1.1";
	info: {
		/** 固定 "Better Auth" */
		title: "Better Auth";
		description: string;
		/** 硬编码的契约版本 "1.1.0"，非发行版本 */
		version: "1.1.0";
	};
	components: {
		schemas: Record<string, OpenAPIModelSchema>;
		securitySchemes: {
			/** API Key 认证 via cookie */
			apiKeyCookie: { type: "apiKey"; in: "cookie"; name: "apiKeyCookie"; description: string };
			/** Bearer 令牌认证 */
			bearerAuth: { type: "http"; scheme: "bearer"; description: string };
		};
	};
	security: Array<{ apiKeyCookie: string[]; bearerAuth: string[] }>;
	/** 取自上下文的 baseURL */
	servers: Array<{ url: string }>;
	tags: Array<{ name: string; description: string }>;
	paths: Record<string, Path>;
}

/** 单个路径下的方法分组 / Method groups under one path */
export interface Path {
	get?: OpenAPIOperation;
	post?: OpenAPIOperation;
	put?: OpenAPIOperation;
	patch?: OpenAPIOperation;
	delete?: OpenAPIOperation;
}

/** 单个操作的契约 / Contract of one operation */
export interface OpenAPIOperation {
	/** 核心端点为 ["Default", ...额外标签]；插件端点为 [首字母大写的插件 id] */
	tags?: string[];
	/** 去重后的操作标识；未声明时为 undefined */
	operationId?: string;
	description?: string;
	security?: Array<{ bearerAuth: string[] }>;
	parameters?: OpenAPIParameter[];
	requestBody?: OpenAPIRequestBody;
	responses?: Record<string, OpenAPIResponse>;
}

/**
 * 模型 schema
 * 取证：packages/better-auth/src/plugins/open-api/generator.ts:110-123
 */
export interface OpenAPIModelSchema {
	type: "object";
	properties: Record<string, FieldSchema>;
	/** 恒含 "id" */
	required?: string[];
}

/** 字段 schema */
export interface FieldSchema {
	/** date 被翻译为 string；数组字段为 "array" */
	type: string | "array";
	/** 数组元素类型 / Element type for array fields */
	items?: { type: string };
	default?: unknown;
	/** input === false 时为 true */
	readOnly?: boolean;
	/** date 字段为 "date-time" */
	format?: string;
}
```

#### 16.3.2 Reference Plugin Contract

```ts
/**
 * Scalar 主题名
 * 取证：packages/better-auth/src/plugins/open-api/index.ts:19-31
 */
export type ScalarTheme =
	| "alternate"
	| "default"
	| "moon"
	| "purple"
	| "solarized"
	| "bluePlanet"
	| "saturn"
	| "kepler"
	| "mars"
	| "deepSpace"
	| "laserwave"
	| "none";

/**
 * OpenAPI 插件选项
 * 取证：packages/better-auth/src/plugins/open-api/index.ts:72-100
 */
export interface OpenAPIOptions {
	/**
	 * 参考页路径；会被追加到 baseURL 的 "/api/auth" 路径之下，
	 * 因此 "/reference" 的完整路径是 "/api/auth/reference"
	 * @default "/reference"
	 */
	path?: LiteralString | undefined;
	/** 禁用默认参考页；禁用后该端点抛 NOT_FOUND / @default false */
	disableDefaultReference?: boolean | undefined;
	/** Scalar 主题 / @default "default" */
	theme?: ScalarTheme | undefined;
	/** 内联脚本的 CSP nonce / @default undefined */
	nonce?: string | undefined;
}

/**
 * 文档生成器
 * 取证：packages/better-auth/src/plugins/open-api/generator.ts:888
 */
export async function generator(
	ctx: AuthContext,
	options: BetterAuthOptions,
): Promise<OpenAPIDocument>;
```

#### 16.3.3 Health Endpoint Contract

```ts
/**
 * 健康检查端点
 * 取证：packages/better-auth/src/api/routes/ok.ts:4-39
 */
export interface OkEndpoint {
	/** 方法与路径 / Method and path */
	method: "GET";
	path: "/ok";
	/** 响应体 / Response body */
	response: {
		/** 恒为 true / Always true */
		ok: boolean;
	};
}
```

### 16.4 Flow

以下伪代码表达参考域两条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 16.4.1 Schema Generation

```ts
// OpenAPI 文档的生成链路
// 取证：packages/better-auth/src/plugins/open-api/generator.ts:888-1157
async function generator(ctx: AuthContext, options: BetterAuthOptions): Promise<OpenAPIDocument> {
	// 步骤一：取核心端点（不带插件）
	const baseEndpoints = getEndpoints(ctx, { ...options, plugins: [] });

	// 步骤二：取表模型；强制 session 落库，否则 session 表的 schema 不会出现在文档里
	const tables = getAuthTables({
		...options,
		session: { ...options.session, storeSessionInDatabase: true },
	});

	// 步骤三：表 → components.schemas
	const models: Record<string, OpenAPIModelSchema> = {};
	for (const [key, value] of Object.entries(tables)) {
		const modelName = key.charAt(0).toUpperCase() + key.slice(1);
		const required = new Set<string>(["id"]);           // id 恒必填
		const properties: Record<string, FieldSchema> = {
			id: { type: "string", readOnly: true },         // id 恒只读字符串
		};
		for (const [fieldKey, fieldValue] of Object.entries(value.fields)) {
			if (!fieldValue) continue;
			properties[fieldKey] = getFieldSchema(fieldValue);
			// 分支：字段必填且会被返回 → 进入 required
			if (fieldValue.required && fieldValue.returned !== false) {
				required.add(fieldKey);
			}
		}
		// date 字段补 format
		for (const [key2, prop] of Object.entries(properties)) {
			const field = value.fields[key2];
			if (field && field.type === "date" && prop.type === "string") {
				prop.format = "date-time";
			}
		}
		models[modelName] = { type: "object", properties, required: Array.from(required) };
	}

	// 步骤四：遍历端点填 paths
	const paths: Record<string, Path> = {};
	const usedOperationIds = new Set<string>();

	// 4a) 核心端点
	for (const [_, value] of Object.entries(baseEndpoints.api)) {
		// 分支一：没有路径，或路径被 disabledPaths 列出 → 跳过
		//        （serverOnly 端点没有路径，也在这一步被跳过）
		if (!value.path || ctx.options.disabledPaths?.includes(value.path)) continue;
		const opts = value.options as EndpointOptions;
		// 分支二：SERVER_ONLY → 跳过
		if (opts.metadata?.SERVER_ONLY) continue;
		const path = toOpenApiPath(value.path);   // :token → {token}
		const parameters = [...getParameters(opts), ...getPathParameters(value.path, getParameters(opts))];
		for (const method of methodsOf(opts)) {
			paths[path] = {
				...paths[path],
				[method.toLowerCase()]: {
					tags: ["Default", ...(opts.metadata?.openapi?.tags || [])],
					description: opts.metadata?.openapi?.description,
					operationId: getOperationId(opts.metadata?.openapi?.operationId, method, usedOperationIds),
					security: [{ bearerAuth: [] }],
					parameters: cloneOpenAPIValue(parameters),
					// 分支三：写操作且并入了主体附加字段
					...(method === "POST" || method === "PATCH" || method === "PUT"
						? { requestBody: cloneOpenAPIValue(applyUserInputFieldsToRequestBody(value.path, getRequestBody(opts), ctx.options)) }
						: {}),
					responses: cloneOpenAPIValue(getResponse(opts.metadata?.openapi?.responses)),
				},
			};
		}
	}

	// 4b) 各插件端点
	for (const plugin of options.plugins || []) {
		// 分支四：open-api 插件自身 → 跳过（避免自引用）
		if (plugin.id === "open-api") continue;
		const pluginEndpoints = getEndpoints(ctx, { ...options, plugins: [plugin] });
		const api = Object.keys(pluginEndpoints.api)
			// 分支五：核心端点已存在的同名 key → 跳过（不覆盖核心定义）
			.map((key) => baseEndpoints.api[key] === undefined ? pluginEndpoints.api[key] : null)
			.filter((x) => x !== null);
		for (const [_, value] of Object.entries(api)) {
			if (!value.path || ctx.options.disabledPaths?.includes(value.path)) continue;
			const opts = value.options as EndpointOptions;
			// 分支六：SERVER_ONLY → 跳过
			if (opts.metadata?.SERVER_ONLY) continue;
			// 标签组：端点自声明 tags，否则用首字母大写的插件 id
			const tags = opts.metadata?.openapi?.tags || [
				plugin.id.charAt(0).toUpperCase() + plugin.id.slice(1),
			];
			// ... 同 4a 填入 paths
		}
	}

	// 步骤五：装配文档
	return {
		openapi: "3.1.1",
		info: { title: "Better Auth", description: "API Reference for your Better Auth Instance", version: "1.1.0" },
		components: { schemas: models, securitySchemes: { apiKeyCookie: {...}, bearerAuth: {...} } },
		security: [{ apiKeyCookie: [], bearerAuth: [] }],
		servers: [{ url: ctx.baseURL }],
		tags: [{ name: "Default", description: "..." }],
		paths,
	};
}

/**
 * operationId 去重
 * 取证：packages/better-auth/src/plugins/open-api/generator.ts:842-865
 */
function getOperationId(
	operationId: string | undefined,
	method: string,
	usedOperationIds: Set<string>,
): string | undefined {
	// 分支一：未声明 → undefined
	if (!operationId) return undefined;
	// 分支二：首次出现 → 原样保留
	if (!usedOperationIds.has(operationId)) {
		usedOperationIds.add(operationId);
		return operationId;
	}
	// 分支三：重复 → 追加方法名（POST → Post）
	const normalizedMethod = method.toUpperCase();
	const methodSuffix = normalizedMethod.charAt(0) + normalizedMethod.slice(1).toLowerCase();
	let candidate = `${operationId}${methodSuffix}`;
	let duplicateIndex = 2;
	// 分支四：仍冲突 → 追加序号，从 2 开始
	while (usedOperationIds.has(candidate)) {
		candidate = `${operationId}${methodSuffix}${duplicateIndex}`;
		duplicateIndex += 1;
	}
	usedOperationIds.add(candidate);
	return candidate;
}
```

失败分支清单：无路径的端点 → 跳过；`disabledPaths` 中的路径 → 跳过；`SERVER_ONLY` 端点 → 跳过；`open-api` 插件自身 → 跳过；核心已定义的端点 key 被插件重复定义 → 以核心为准；未声明 `operationId` → 不产生 `operationId`；`operationId` 重复 → 追加方法名，再重复 → 追加序号。

#### 16.4.2 Reference Page Rendering

```ts
// 参考页与 schema 导出的完整链路
// 取证：packages/better-auth/src/plugins/open-api/index.ts:102-139
const openAPI = (options?: OpenAPIOptions) => {
	const path = options?.path ?? "/reference";
	return {
		id: "open-api",
		version: PACKAGE_VERSION,
		endpoints: {
			// 机器可读导出
			generateOpenAPISchema: createAuthEndpoint(
				"/open-api/generate-schema",
				{ method: "GET" },
				async (ctx) => {
					const schema = await generator(ctx.context, ctx.context.options);
					return ctx.json(schema);
				},
			),
			// 交互式参考页
			openAPIReference: createAuthEndpoint(
				path,
				{ method: "GET", metadata: HIDE_METADATA },
				async (ctx) => {
					// 分支一：参考页被显式禁用 → NOT_FOUND
					if (options?.disableDefaultReference) {
						throw new APIError("NOT_FOUND");
					}
					const schema = await generator(ctx.context, ctx.context.options);
					return new Response(getHTML(schema, options?.theme, options?.nonce), {
						headers: { "Content-Type": "text/html" },
					});
				},
			),
		},
		options: options as NoInfer<O>,
	};
};

/**
 * 参考页 HTML
 * 取证：packages/better-auth/src/plugins/open-api/index.ts:33-70
 */
function getHTML(apiReference: Record<string, unknown>, theme?: ScalarTheme, nonce?: string): string {
	const nonceAttr = nonce ? `nonce="${nonce}"` : "";
	return `<!doctype html>
<html>
  <head>
    <title>Scalar API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <!-- 步骤一：把 OpenAPI 文档以 JSON 内联进页面 -->
    <script id="api-reference" type="application/json">${JSON.stringify(apiReference)}</script>
    <!-- 步骤二：写入 Scalar 配置（favicon / theme / metaData），通过 dataset 传递 -->
    <script ${nonceAttr}>
      var configuration = {
        favicon: "data:image/svg+xml;utf8,${encodeURIComponent(logo)}",
        theme: "${theme || "default"}",
        metaData: { title: "Better Auth API", description: "API Reference for your Better Auth Instance" }
      }
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration)
    </script>
    <!-- 步骤三：加载 Scalar 运行时 -->
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" ${nonceAttr}></script>
  </body>
</html>`;
}
```

失败分支清单：参考页被显式禁用 → `NOT_FOUND`；`theme` 未提供 → 回落为 `"default"`；`nonce` 未提供 → 两个内联脚本都不带 `nonce` 属性（CSP 严格模式下会被拦截）；Scalar 脚本从 CDN 加载——CDN 不可达时页面能返回但交互不可用。

### 16.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-16-01 | 认证实例已启动并启用 open-api 插件 | 请求 `GET /open-api/generate-schema` | 返回 JSON 文档；`openapi` 为 `"3.1.1"`；`info.title` 为 `"Better Auth"`；`info.version` 为 `"1.1.0"`；`servers[0].url` 等于该实例的 baseURL |
| ACC-16-02 | 同上 | 检查返回文档的 `components.schemas` | 每个模型都有 `id` 属性且其 schema 为 `{ type: "string", readOnly: true }`，同时 `id` 出现在 `required` 里；日期字段的 schema 为 `{ type: "string", format: "date-time" }`；`input: false` 的字段带 `readOnly: true` |
| ACC-16-03 | 同上，且未配置任何自定义 `disabledPaths` | 检查返回文档的 `paths` | 核心端点带 `Default` 标签；`two-factor` 插件的端点带 `Two-factor` 标签、`organization` 插件的端点带 `Organization` 标签；`/error` 与 `/ok` **出现在文档里**；`SERVER_ONLY` 端点**不出现**；`open-api` 插件自身的端点不出现 |
| ACC-16-04 | 认证实例配置了两个声明了相同 `operationId` 的端点 | 检查返回文档 | 两个操作的 `operationId` 不同：后者被追加方法名（如 `signIn` → `signInPost`）；若方法名后仍冲突则继续追加序号（`signInPost2`） |
| ACC-16-05 | 已启用 open-api 插件且未改动 `path` | 请求 `GET /api/auth/reference` | 返回 200 与 `Content-Type: text/html`；页面包含 `id="api-reference"` 的 JSON 脚本块与来自 `https://cdn.jsdelivr.net/npm/@scalar/api-reference` 的脚本引用；页面内可见 Scalar 渲染的 API 文档 |
| ACC-16-06 | 已启用 open-api 插件并设置 `disableDefaultReference: true` | 请求 `GET /api/auth/reference` | 返回 `NOT_FOUND`；同一实例的 `GET /open-api/generate-schema` 仍正常返回 JSON 文档 |
| ACC-16-07 | 认证实例已启动 | 请求 `GET /ok` | 返回 200 与 `{ ok: true }` |
| ACC-16-08 | 认证实例启用了 `user.additionalFields`（含一个 `required: true` 且无默认值的字段） | 检查 `paths["/sign-up/email"].post.requestBody` 与 `paths["/update-user"].post.requestBody` | 两个路径的请求体都包含该附加字段；`/sign-up/email` 的 `required` 列表包含它，`/update-user` 的 `required` 列表**不包含**它 |

### 16.6 Known Caveats

- `info.version` 是**硬编码的 `"1.1.0"`**，与发行版本 1.7.16 无关（`packages/better-auth/src/plugins/open-api/generator.ts:1119`）。它表示"API 契约版本"而非"包版本"，但消费者若拿它当包版本会误判。
- `HIDE_METADATA` **不是**"从文档中隐藏"的开关——它只有 `{ scope: "server" }`（`packages/better-auth/src/utils/hide-metadata.ts:1-3`）。真正排除端点的是 `metadata.SERVER_ONLY`（`packages/core/src/api/index.ts:169-203`）。因此 `/error` 与 `/ok` 会出现在 OpenAPI 文档里。
- 插件标签组用的是插件 id **首字母大写**而非按词分割：`two-factor` → `Two-factor`（带连字符），不是 `TwoFactor`（`packages/better-auth/src/plugins/open-api/generator.ts:1062-1064`）。
- 文档里的 `servers[0].url` 取 `ctx.baseURL`——**不是**每个请求的 `baseURL` 解析结果，多域名部署时文档只反映一个（`packages/better-auth/src/plugins/open-api/generator.ts:1143-1147`）。
- 参考页的 Scalar 脚本从 **jsDelivr CDN** 加载（`packages/better-auth/src/plugins/open-api/index.ts:67`）——离线或内网环境下页面能返回但交互不可用；严格 CSP 环境下必须传 `nonce`。
- 参考页的 `path` 选项**挂在认证基路径下**，即默认 `/reference` 对应完整路径 `/api/auth/reference`（`packages/better-auth/src/plugins/open-api/index.ts:76-79`）。
- `generate-schema` 端点**没有** `HIDE_METADATA`（参考页端点有），因此它会出现在 OpenAPI 文档自身的 `paths` 里吗——不会：`open-api` 插件整体在遍历时被跳过（`packages/better-auth/src/plugins/open-api/generator.ts:1025-1027`）。
- `components.schemas` 的模型名由**表名**派生（`user` → `User`），而不是由 Zod schema 名派生；自定义表名会直接影响模型名（`packages/better-auth/src/plugins/open-api/generator.ts:904`）。
- `getFieldSchema` 对数组类型的处理有一个已知缺口：字面量数组形式的枚举尚未翻译成 OpenAPI `enum`（源码有 TODO 标注，当前无核心字段使用该形式）（`packages/better-auth/src/plugins/open-api/generator.ts:126-129`）。
