---
title: 企业域
description: 为单点登录、用户供给、授权方、机器凭证与订阅计费提供企业级集成能力的设计。
sidebar:
  order: 17
  label: 企业域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 15. Enterprise Integration

企业域是**外围域**。它为企业场景提供单点登录、SCIM 用户供给、把框架自身变成 OAuth 授权方、客户端标识元数据信任、MCP 暴露、机器凭证与订阅状态同步；**它不承担认证判定职责，移除后核心链路完整**——去掉全部企业集成包后，邮箱 + 口令的注册登录链路完全不受影响。

企业域与相邻模块的分界是：**企业域把"身份"从外部世界接进来，或把"能力"向外部世界开出去，但判定主体合法性这件事始终发生在框架内部**。SSO 接进来的用户最终落到与本地用户同构的 `User` 表；SCIM 供给的用户最终落到同一张 `User` 表；OAuth 授权方签发的令牌最终落到同一套会话与令牌模型；API Key 最终被换成同一个会话上下文。它与 [联合授权域](./06-oauth/) 的边界是：联合授权域处理**框架作为客户端**去第三方登录；企业域处理**框架作为服务端**（OAuth 授权方）或作为**身份汇聚点**（SSO / SCIM）去对接企业身份基础设施。企业域在整体中的位置见 [总体方案与架构](../architecture/)；其端点在 [接口总表](../api/) 中的对应条目同样适用。

### 15.1 Responsibility Boundary

**企业域负责（每个包一行职责 + 关键契约要点）：**

| 包 | 职责 | 关键契约要点 |
|---|---|---|
| `packages/sso/` | SAML 2.0 与 OIDC 单点登录接入、企业域名验证、按域名自动归属组织、账号合并 | 6 个端点：`POST /sso/register`、`POST /sign-in/sso`、`POST /sso/callback`、`GET /sso/saml2/sp/metadata`、`POST /sso/request-domain-verification`、`POST /sso/verify-domain`；另有 provider 管理四端点 `GET /sso/providers`、`GET /sso/get-provider`、`POST /sso/update-provider`、`POST /sso/delete-provider`；组织归属结果集为 `assigned` / `already-member` / `ambiguous-target` / `ineligible-source` / `invitation-pending` / `no-target` / `provisioning-disabled` / `unverified-identity`（`packages/sso/src/linking/org-assignment.ts:37-46`） |
| `packages/scim/` | SCIM 2.0 用户与群组供给，供 IdP（Entra、Okta 等）推送目录 | 17 个端点：用户 6 个（`POST/GET /scim/v2/Users`、`GET/PUT/PATCH/DELETE /scim/v2/Users/:userId`）、群组 6 个（同构的 `/scim/v2/Groups`）、发现 5 个（`GET /scim/v2/ServiceProviderConfig`、`/Schemas`、`/Schemas/:schemaId`、`/ResourceTypes`、`/ResourceTypes/:resourceTypeId`）；错误 schema 为 `urn:ietf:params:scim:api:messages:2.0:Error`（`packages/scim/src/index.ts:60`）；媒体类型 `SCIM_MEDIA_TYPE` |
| `packages/oauth-provider/` | 把框架自身变成 OAuth 2.1 授权方 / OIDC 身份提供方 | 端点：`GET /oauth2/authorize`、`POST /oauth2/token`、`POST /oauth2/register`、`GET /oauth2/userinfo`、`POST /oauth2/introspect`、`POST /oauth2/revoke`、`GET /oauth2/end-session`、`POST /oauth2/end-session/confirm`、`GET /oauth2/consent`、`GET /oauth2/continue`、`POST /oauth2/client/rotate-keys`、`GET /jwks`；默认作用域 `["openid", "profile", "email", "offline_access"]`，**必须含 `openid` 才算 OIDC 服务器**（`packages/oauth-provider/src/types/index.ts:504-515`）；提供 `extendOAuthProvider` 扩展点、`createResourceServerChallenge` 资源服务器挑战、`oauthDeviceAuthorization` 设备码扩展 |
| `packages/cimd/` | 客户端标识元数据文档（CIMD）信任 | 插件 id `cimd`，通过 `init(ctx)` 调用 `extendOAuthProvider(ctx, { clientDiscovery })` 贡献**未认证的动态客户端发现**；客户端以 HTTPS URL 作为 `client_id` 标识自己，插件拉取并校验元数据文档，再按文档中的 `token_endpoint_auth_method` 决定客户端的认证行为；发现元数据声明 `client_id_metadata_document_supported: true`（`packages/cimd/src/index.ts:26-40`、`:53-65`） |
| `packages/mcp/` | 把框架暴露为 MCP 服务器 | `mcp(options)` 是 `oauthProvider(options)` 的包装：`options.resource` 是规范化受保护资源标识符（RFC 8707 / RFC 9728），签发的令牌按受众绑定到它；插件在 `/.well-known/oauth-protected-resource` 与插入资源路径的别名上提供受保护资源元数据；非 GET/HEAD 请求返回 405 且 `Allow: GET, HEAD`；`refreshTokenReuseInterval` 默认 `30` 秒（`packages/mcp/src/plugin.ts:26-45`、`:99-110`） |
| `packages/api-key/` | 机器凭证签发与校验 | 5 个公开端点：`POST /api-key/create`、`GET /api-key/get`、`GET /api-key/list`、`POST /api-key/update`、`POST /api-key/delete`；另有 2 个仅服务端端点：`deleteAllExpiredApiKeys` 与 `verifyApiKey`（`createAuthEndpoint.serverOnly`，无 HTTP 路径，`packages/api-key/src/routes/delete-all-expired-api-keys.ts:12`、`packages/api-key/src/routes/verify-api-key.ts:514`）；默认请求头 `x-api-key`，默认密钥长度 `64`（不含前缀），默认前缀长度上限 `32`，默认存储起始字符数 `6`；`disableKeyHashing` 默认 `false`（源码带安全警告：不建议关闭哈希）（`packages/api-key/src/types.ts:25-90`） |
| `packages/stripe/` | 订阅状态同步 | 7 个端点：`POST /subscription/upgrade`、`POST /subscription/cancel`、`POST /subscription/restore`、`GET /subscription/list`、`GET /subscription/success`、`POST /subscription/billing-portal`、`POST /stripe/webhook`；订阅端点只在 `subscription.enabled === true` 时注册（`packages/stripe/src/index.ts:47-60`）；`seatPriceId` 需要 organization 插件启用，否则初始化时打 error 日志（`packages/stripe/src/index.ts:60-90`） |

**企业域不负责（明确拒绝承担的职责）：**

- 不重新实现认证判定：SSO / SCIM 接入的用户最终都落到 `User` 表并走统一的会话签发。
- 不裁决资源级授权：OAuth 授权方的令牌校验交给资源服务器；MCP 包提供 `createResourceServerChallenge` 产出 401 挑战，但令牌验证由资源服务器执行。
- 不管理支付：Stripe 插件只同步订阅状态，不做定价决策。
- 不管理密钥存储：API Key 的生成与哈希由插件负责，明文密钥只在创建时返回一次。
- 不做 IdP 侧的目录治理：SCIM 只做供给侧的对接，IdP 侧的策略不由本框架决定。

### 15.2 Capability Inventory

**SSO 的身份汇聚契约：**

- 提供者注册与元数据：`GET /sso/providers`、`POST /sso/update-provider`、`POST /sso/delete-provider`、`GET /sso/get-provider`（`packages/sso/src/routes/providers.ts:554`、`:680`、`:824`、`:1084`）。
- 登录发起与回调：`POST /sign-in/sso`、`POST /sso/callback`（`packages/sso/src/routes/sso.ts:855`、`:1983`）。
- SAML SP 元数据：`GET /sso/saml2/sp/metadata`（`packages/sso/src/routes/sso.ts:154`）。
- 企业域名验证：`POST /sso/request-domain-verification`、`POST /sso/verify-domain`（`packages/sso/src/routes/domain-verification.ts:62`、`:130`）。域名验证是组织自动归属的**信任信号**——只有验证过的域名才能触发自动归属。
- 组织自动归属的两种理由：`provider-bound`（按 SSO 提供者绑定）与 `verified-domain`（按已验证域名）（`packages/sso/src/linking/org-assignment.ts:31-38`）。
- SAML 安全参数常量：`DEFAULT_CLOCK_SKEW_MS`、`DEFAULT_MAX_SAML_METADATA_SIZE`、`DEFAULT_MAX_SAML_RESPONSE_SIZE`（`packages/sso/src/constants.ts`）；支持 `AlgorithmValidationOptions`、`DigestAlgorithm`、`KeyEncryptionAlgorithm`、`SignatureAlgorithm`、`DataEncryptionAlgorithm`（`packages/sso/src/saml/algorithms.ts`）。

**OAuth 授权方的客户端与元数据面：**

- 客户端元数据 schema：`oauthClientMetadataSchema`、`ResourceUriSchema`（`packages/oauth-provider/src/types/zod`）。
- 客户端密钥轮换：`POST /oauth2/client/rotate-keys`。
- JWKS：`GET /jwks`（`packages/oauth-provider/src/client-resource.ts:94`、`packages/oauth-provider/src/logout.ts:702`、`packages/oauth-provider/src/metadata.ts:51`）。
- 授权服务器元数据：`authServerMetadata`、`oauthAuthorizationServerMetadata`、`oauthProviderAuthServerMetadata`、`oauthProviderOpenIdConfigMetadata`、`oidcServerMetadata`、`metadataResponse`（`packages/oauth-provider/src/metadata.ts`）。
- 扩展点：`extendOAuthProvider`（`packages/oauth-provider/src/extensions.ts`）——CIMD 插件通过它注入 `clientDiscovery`。
- 客户端断言消费：`consumeClientAssertion`（`packages/oauth-provider/src/utils/client-assertion.ts`）。
- DPoP 支持：`packages/oauth-provider/src/dpop.ts`。
- 后端登出：`GET /oauth2/end-session`、`POST /oauth2/end-session/confirm`。

**MCP 资源服务器挑战契约（`packages/mcp/src/handler.ts:11-55`）：**

`McpProtectedRequestHandlerOptions` 声明：期望的签发方 `issuer`、规范受保护资源 URL `audience`、附加 JOSE 校验约束 `jwtVerifyOptions`（`issuer` 与 `audience` 仍以顶层字段为准）、JWKS 地址 `jwksUrl`、远端内省配置 `remoteVerify`（`introspectUrl` / `clientId` / `clientSecret` / `force` / `allowMissingAudience`）、必需作用域 `requiredScopes`、挑战中广播的作用域 `challengeScopes`（默认同 `requiredScopes`）、自定义作用域匹配器 `isScopeSatisfied`、DPoP 配置 `dpop`（`proofMaxAgeSeconds` / `signingAlgorithms` / `replayStore`）。

**API Key 的存储与限额契约（`packages/api-key/src/schema.ts`）：**

`apikey` 表字段：`configId`（默认 `"default"`，带索引）、`name`、`start`（起始字符）、`referenceId`（归属方 id，带索引）、`prefix`、`key`（哈希值，带索引）、`refillInterval`、`refillAmount`、`lastRefillAt`、`enabled`（默认 `true`）、`rateLimitEnabled`（默认 `true`）、`rateLimitTimeWindow`（默认 `defaultTimeWindow`）、`rateLimitMax`（默认 `defaultRateLimitMax`）、`requestCount`、`remaining`、`lastRequest`、`expiresAt`、`createdAt`、`updatedAt`、`permissions`（JSON 字符串）、`metadata`（JSON 字符串，唯一可输入的字段）。

**Stripe 的订阅表契约（`packages/stripe/src/schema.ts`）：**

`subscription` 表字段：`plan`（必填）、`referenceId`（必填，不入参）、`stripeCustomerId`、`stripeSubscriptionId`、`status`（默认 `"incomplete"`）、`periodStart`、`periodEnd`、`trialStart`、`trialEnd`、`cancelAtPeriodEnd`（默认 `false`）、`cancelAt`、`canceledAt`、`endedAt`、`seats`、`billingInterval`、`stripeScheduleId`。`user` 与 `organization` 表各扩展一个 `stripeCustomerId` 字段。

### 15.3 Contract

#### 15.3.1 SSO Contract

```ts
/**
 * SSO 提供者配置
 * 取证：packages/sso/src/types.ts:237-280
 */
export interface SSOProvider<O extends SSOOptions = SSOOptions> {
	/** 提供者唯一 id / Provider unique id */
	id: string;
	/** 提供者类型：saml 或 oidc / Provider type: saml or oidc */
	providerType: "saml" | "oidc";
	/** 该提供者是否已完成域名验证 / Whether the provider's domain is verified */
	domainVerified: boolean;
	/** 绑定的组织 id / Bound organization id */
	organizationId?: string | undefined;
	/** 登录后归属的目标组织 / Organization the user is assigned to after sign-in */
	organizationId: string | null;
}

/**
 * 组织归属结果
 * 取证：packages/sso/src/linking/org-assignment.ts:37-46
 */
export type OrganizationAssignmentResult =
	| "assigned"
	| "already-member"
	| "ambiguous-target"
	| "ineligible-source"
	| "invitation-pending"
	| "no-target"
	| "provisioning-disabled"
	| "unverified-identity";

/**
 * 组织归属选项
 * 取证：packages/sso/src/linking/org-assignment.ts:7-21
 */
export interface OrganizationProvisioningOptions {
	/** 关闭自动归属 / Disable automatic organization assignment */
	disabled?: boolean;
	/** 新成员的默认角色 / Default role for newly provisioned members */
	defaultRole?: string;
	/** 自定义角色解析 / Custom role resolution */
	getRole?: (data: {
		user: User & Record<string, any>;
		userInfo: Record<string, any>;
		token?: OAuth2Tokens;
		provider: SSOProvider<SSOOptions>;
	}) => Promise<string>;
}
```

#### 15.3.2 OAuth Provider Contract

```ts
/**
 * OAuth 授权方选项
 * 取证：packages/oauth-provider/src/types/index.ts:497-520
 */
export interface OAuthOptions<Scopes extends readonly Scope[] = InternallySupportedScopes[]> {
	/** 自定义表结构 / Custom schema */
	schema?: InferOptionSchema<typeof schema>;
	/**
	 * 客户端可请求的作用域；必须含 "openid" 才被视为 OIDC 服务器
	 * Scopes a client may request; must contain "openid" to count as an OIDC server
	 * @default ["openid", "profile", "email", "offline_access"]
	 */
	scopes?: Scopes;
	/** 自定义重定向 uri 校验；返回 true 接受、false 或抛错拒绝 */
	validateRedirectUri?: (
		uri: string,
		registeredUris: string[],
		defaultResult: boolean,
	) => boolean | Promise<boolean>;
}

/**
 * 客户端元数据
 * 取证：packages/oauth-provider/src/types/oauth.ts, packages/oauth-provider/src/types/zod.ts
 */
export interface OAuthClientMetadata {
	/** 客户端 id / Client id */
	client_id: string;
	/** 客户端密钥（机密客户端）/ Client secret, for confidential clients */
	client_secret?: string;
	/** 重定向 uri / Redirect URIs */
	redirect_uris?: string[];
	/** 允许的作用域 / Allowed scopes */
	scope?: string;
	/** 客户端类型 / Client type */
	token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post" | "private_key_jwt";
}

/**
 * 扩展授权方的入口
 * 取证：packages/oauth-provider/src/extensions.ts
 */
export function extendOAuthProvider(
	ctx: AuthContext,
	extension: {
		/** 未认证的动态客户端发现 / Unauthenticated dynamic client discovery */
		clientDiscovery?: ClientDiscovery;
	},
): void;

/**
 * 客户端发现契约
 * 取证：packages/cimd/src/index.ts:26-40
 */
export interface ClientDiscovery {
	/** 发现实现 id / Discovery implementation id */
	id: string;
	/** 判断某个 client_id 是否由本发现处理 / Whether this discovery handles the client id */
	matches: (clientId: string) => boolean;
	/** 解析出客户端记录 / Resolve the client record */
	resolve: (clientId: string) => Promise<OAuthClient | null>;
	/** 拉取元数据文档 / Fetch the metadata document */
	fetchClientMetadataResource?: (url: string) => Promise<unknown>;
	/** 写入发现元数据 / Discovery metadata to advertise */
	discoveryMetadata?: Record<string, unknown>;
}
```

#### 15.3.3 MCP Contract

```ts
/**
 * MCP 插件选项
 * 取证：packages/mcp/src/plugin.ts:26-58
 */
export interface McpOptions extends OAuthOptions<Scope[]> {
	/**
	 * 刷新令牌重用窗口（秒）；MCP 覆盖 OAuth Provider 的严格默认值，
	 * 让重试的 refresh 能取回与先前请求相同的响应
	 * @default 30
	 */
	refreshTokenReuseInterval?: NonNullable<OAuthOptions<Scope[]>["refreshTokenReuseInterval"]>;
	/**
	 * 规范化受保护资源标识符（RFC 8707 / RFC 9728）；
	 * 必须是 HTTPS URL，且不带 query、fragment 与凭据（仅回环主机允许 HTTP）
	 */
	resource: string;
}

/**
 * 受保护请求处理器选项
 * 取证：packages/mcp/src/handler.ts:11-55
 */
export interface McpProtectedRequestHandlerOptions {
	/** 期望的签发方 / Expected issuer */
	issuer: string;
	/** 期望的受保护资源受众 / Expected protected resource audience */
	audience: string;
	/** 附加 JOSE 校验约束；issuer 与 audience 仍以顶层字段为准 */
	jwtVerifyOptions?: Omit<JWTVerifyOptions, "issuer" | "audience">;
	/** JWKS 地址 / JWKS URL */
	jwksUrl?: string;
	/** 远端内省配置 / Remote introspection settings */
	remoteVerify?: {
		introspectUrl: string;
		clientId: string;
		clientSecret: string;
		force?: boolean;
		allowMissingAudience?: boolean;
	};
	/** 必须满足的作用域 / Scopes every accepted token must satisfy */
	requiredScopes?: readonly string[];
	/** 未认证挑战中广播的作用域，默认同 requiredScopes */
	challengeScopes?: readonly string[];
	/** 自定义作用域匹配器，默认精确成员判断 */
	isScopeSatisfied?: (requiredScope: string, grantedScopes: ReadonlySet<string>) => boolean;
	/** DPoP 校验与重放保护 / DPoP proof validation and replay protection */
	dpop?: {
		proofMaxAgeSeconds?: number;
		signingAlgorithms?: readonly string[];
		replayStore?: DpopReplayStore;
	};
}
```

#### 15.3.4 Api Key And Stripe Contract

```ts
/**
 * API Key 配置集
 * 取证：packages/api-key/src/types.ts:16-220
 */
export interface ApiKeyConfigurationOptions {
	/** 配置集名称，跨配置集唯一 / Configuration set name, unique across sets */
	configId?: LiteralString;
	/** 检查 API Key 的请求头，默认 "x-api-key" / Header to check, default "x-api-key" */
	apiKeyHeaders?: string | string[];
	/** 关闭哈希存储；源码标注强烈不建议 / Disable hashing; strongly discouraged by the source */
	disableKeyHashing?: boolean;
	/** 自定义取 Key 的方式 / Custom API key getter */
	customAPIKeyGetter?: (ctx: HookEndpointContext) => string | null;
	/** 自定义校验 / Custom validator */
	customAPIKeyValidator?: (options: { ctx: GenericEndpointContext; key: string }) => Awaitable<boolean>;
	/** 自定义生成器 / Custom key generator */
	customKeyGenerator?: (options: { length: number; prefix: string | undefined }) => Awaitable<string>;
	/** 存储起始字符以便 UI 展示 / Store the leading characters for UI display */
	startingCharactersConfig?: { shouldStore?: boolean; charactersLength?: number };
	/** 密钥长度，默认 64（不含前缀）/ Key length, default 64 (excluding prefix) */
	defaultKeyLength?: number;
	/** 密钥前缀 / Key prefix */
	defaultPrefix?: string;
	/** 前缀最大长度，默认 32 / Maximum prefix length, default 32 */
	maximumPrefixLength?: number;
	/** 前缀最小长度，默认 1 / Minimum prefix length, default 1 */
	minimumPrefixLength?: number;
	/** 是否必须给 Key 命名，默认 false / Require a name, default false */
	requireName?: boolean;
	/** 名称最大长度，默认 32 / Maximum name length, default 32 */
	maximumNameLength?: number;
	/** 名称最小长度，默认 1 / Minimum name length, default 1 */
	minimumNameLength?: number;
	/** 是否启用元数据，默认 false / Enable metadata, default false */
	enableMetadata?: boolean;
	/** 过期时间定制 / Key expiration customization */
	keyExpiration?: {
		/** 默认过期毫秒数，null 表示不过期 / Default expiry in ms; null means no expiry */
		defaultExpiresIn?: number | null;
		/** 禁用客户端自定义过期时间，默认 false / Disallow client-supplied expiry, default false */
		disableCustomExpiresTime?: boolean;
		/** 客户端可设的最小过期天数，默认 1 / Minimum expiry days, default 1 */
		minExpiresIn?: number;
		/** 客户端可设的最大过期天数，默认 365 / Maximum expiry days, default 365 */
		maxExpiresIn?: number;
	};
	/** 默认限流 / Default rate limiting */
	rateLimit?: {
		/** 是否启用限流，默认 true / Enable rate limiting, default true */
		enabled?: boolean;
		/** 计数窗口毫秒数，默认 86400000 / Count window in ms, default 86400000 */
		timeWindow?: number;
		/** 窗口内最大请求数，默认 10 / Max requests per window, default 10 */
		maxRequests?: number;
	};
	/** 把 API Key 当作会话使用；源码标注不推荐用于生产 / Treat an API Key as a session; not recommended for production */
	enableSessionForAPIKeys?: boolean;
	/** Key 的权限声明 / Permission statements for the key */
	permissions?: { defaultPermissions?: Statements | ((referenceId: string, ctx: GenericEndpointContext) => Awaitable<Statements>) };
}

/**
 * Stripe 订阅选项
 * 取证：packages/stripe/src/types.ts:13-40, packages/stripe/src/index.ts:47-60
 */
export interface StripeOptions {
	/** Stripe 客户端实例 / Stripe client instance */
	stripeClient: Stripe;
	/** 订阅功能开关；关闭时不注册订阅端点与 subscription 表 */
	subscription?: { enabled?: boolean; plans?: StripePlan[] | (() => Promise<StripePlan[]>); createCustomerOnSignUp?: boolean };
	/** 组织计费开关；关闭时不注册 organization.stripeCustomerId 字段 */
	organization?: { enabled?: boolean };
}

/** Stripe 套餐 / Stripe plan */
export interface StripePlan {
	/** 月付价格 id / Monthly price id */
	priceId?: string;
	/** 用 lookup key 代替 price id / Use a lookup key instead of a price id */
	lookupKey?: string;
	/** 套餐名 / Plan name */
	name: string;
	/** 套餐限制 / Plan limits */
	limits?: Record<string, unknown>;
	/** 套餐分组 / Plan group */
	group?: string;
	/** 按座席计费的价格 id；需要 organization 插件 */
	seatPriceId?: string;
}
```

### 15.4 Flow

以下伪代码表达企业域三条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 15.4.1 SSO Sign In And Organization Assignment

```ts
// SSO 登录到组织归属的完整链路
// 取证：packages/sso/src/routes/sso.ts:855, packages/sso/src/linking/org-assignment.ts
async function signInSso(ctx: GenericEndpointContext): Promise<Response> {
	// 分支一：SSO 提供者不存在或未配置 → 拒绝
	const provider = await findProvider(ctx.body.providerId);
	if (!provider) throw new APIError("BAD_REQUEST", { message: "SSO provider not found" });

	// 分支二：域名未验证 → 不允许按域名自动归属（但登录本身可继续）
	//        信任信号只有三种：trustedProviders / accountLinking / domainVerification
	if (!provider.domainVerified) {
		// 走"不自动归属"的分支，而不是直接失败
	}

	// 分支三：隐式注册被禁用且该邮箱尚无本地账号 → 拒绝
	if (options.disableImplicitSignUp && !existingUser) {
		throw new APIError("BAD_REQUEST", { message: "Implicit sign-up is disabled" });
	}

	// 账号合并：SSO 身份与已有本地账号的合并策略由 host 的 accountLinking 配置决定
	const user = await resolveOrCreateUser({ provider, profile, existingUser });
	return redirectToCallback(user);
}

async function assignOrganization(
	options: OrganizationAssignmentOptions & { reason: "provider-bound" | "verified-domain" },
): Promise<OrganizationAssignmentResult> {
	// 分支一：自动归属被关闭 → "provisioning-disabled"
	if (options.provisioningOptions?.disabled) return "provisioning-disabled";

	// 分支二：域名未验证 → "unverified-identity"
	//        （未验证的域名不是可信归属信号）
	if (options.reason === "verified-domain" && !isDomainVerified(profile.email)) {
		return "unverified-identity";
	}

	// 分支三：找不到目标组织 → "no-target"
	const target = await findTargetOrganization(options);
	if (!target) return "no-target";

	// 分支四：目标组织不唯一 → "ambiguous-target"
	//        （宁可不归属，也不猜一个）
	if (target.ambiguous) return "ambiguous-target";

	// 分支五：来源身份不符合归属条件 → "ineligible-source"
	if (!isEligibleSource(profile, target)) return "ineligible-source";

	// 分支六：已是成员 → "already-member"（幂等，不重复写入）
	if (await isAlreadyMember(target.id, user.id)) return "already-member";

	// 分支七：存在待处理邀请 → "invitation-pending"
	//        （有待处理邀请时让用户走邀请流程，而不是自动加入）
	if (await hasPendingInvitation(target.id, profile.email)) return "invitation-pending";

	// 成功路径：加入组织，角色取 getRole 回调或 defaultRole
	const role = options.provisioningOptions?.getRole
		? await options.provisioningOptions.getRole({ user, userInfo, provider })
		: (options.provisioningOptions?.defaultRole ?? "member");
	await addMember({ organizationId: target.id, userId: user.id, role });
	return "assigned";
}
```

失败分支清单：SSO 提供者不存在 → 拒绝；域名未验证 → 不自动归属（登录可继续）；隐式注册被禁用且无本地账号 → 拒绝；自动归属关闭 → `provisioning-disabled`；域名未验证 → `unverified-identity`；无目标组织 → `no-target`；目标不唯一 → `ambiguous-target`；来源不符合条件 → `ineligible-source`；已是成员 → `already-member`（幂等）；有待处理邀请 → `invitation-pending`。

#### 15.4.2 Api Key Validation

```ts
// API Key 在请求入口处的校验链路
// 取证：packages/api-key/src/index.ts:150-230
const apiKeyPlugin = createApiKeyPlugin(options);
apiKeyPlugin.hooks.before.push({
	matcher: (ctx) => !!findApiKeyAndConfig(ctx),
	handler: createAuthMiddleware(async (ctx) => {
		const { key, config } = findApiKeyAndConfig(ctx)!;

		// 分支一：取 Key 的回调返回了非字符串 → INVALID_API_KEY_GETTER_RETURN_TYPE
		if (typeof key !== "string") {
			throw APIError.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_API_KEY_GETTER_RETURN_TYPE);
		}
		// 分支二：Key 长度短于配置的 defaultKeyLength → FORBIDDEN + INVALID_API_KEY
		if (key.length < config.defaultKeyLength) {
			throw APIError.from("FORBIDDEN", API_KEY_ERROR_CODES.INVALID_API_KEY);
		}
		// 分支三：自定义校验器不通过 → FORBIDDEN + INVALID_API_KEY
		if (config.customAPIKeyValidator) {
			const isValid = await config.customAPIKeyValidator({ ctx, key });
			if (!isValid) throw APIError.from("FORBIDDEN", API_KEY_ERROR_CODES.INVALID_API_KEY);
		}

		// 步骤：查库校验（禁用、过期、用量超限、归属、权限……）
		const { apiKey } = await validateApiKey({ key, ctx, lookupOpts: config, configurations, schema, expectedConfigId: config.configId });
		// validateApiKey 内部失败分支：
		//   KEY_NOT_FOUND / KEY_DISABLED / KEY_EXPIRED / USAGE_EXCEEDED / RATE_LIMIT_EXCEEDED
		//   INVALID_USER_ID_FROM_API_KEY / INVALID_REFERENCE_ID_FROM_API_KEY

		// 步骤：清理过期 Key（后台执行，失败只记日志）
		const cleanupTask = deleteAllExpiredApiKeys(ctx.context).catch((err) => {
			ctx.context.logger.error("Failed to delete expired API keys:", err);
		});
		if (config.deferUpdates) {
			ctx.context.runInBackground(cleanupTask);
		}

		// 分支四：把 Key 冒充会话，仅对用户归属的 Key 生效
		if (config.enableSessionForAPIKeys) {
			const referencesType = config.references ?? "user";
			// 分支四之一：Key 归属组织 → UNAUTHORIZED + INVALID_REFERENCE_ID_FROM_API_KEY
			if (referencesType !== "user") {
				throw APIError.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_REFERENCE_ID_FROM_API_KEY);
			}
			// 成功路径：mock 一个会话上下文，让后续端点按普通登录处理
		}
	}),
});
```

失败分支清单：取 Key 回调返回非字符串 → `INVALID_API_KEY_GETTER_RETURN_TYPE`；Key 长度不足 → `INVALID_API_KEY`；自定义校验不通过 → `INVALID_API_KEY`；Key 不存在 / 已禁用 / 已过期 / 用量超限 / 触发限流 → 对应错误码；归属 id 非法 → `INVALID_REFERENCE_ID_FROM_API_KEY`；把组织归属的 Key 当会话用 → `UNAUTHORIZED`；过期 Key 清理失败 → 只记日志，不影响请求。

#### 15.4.3 OAuth Provider As Authorization Server

```ts
// 授权方视角：授权码换取令牌
// 取证：packages/oauth-provider/src/oauth.ts:356, :912, packages/oauth-provider/src/token.ts:162
async function authorize(ctx: GenericEndpointContext): Promise<Response> {
	// 步骤：校验客户端与重定向 uri
	//   validateRedirectUri 未配置时，uri 必须精确匹配已注册的 uri
	//   （注册过的原生 HTTP 回环 uri 允许端口不同）
	//   分支一：redirect uri 非法 → 拒绝（不得重定向到未注册的 uri）
	const client = await findClient(ctx.query.client_id);
	if (!client) throw new APIError("BAD_REQUEST", { message: "Invalid client" });
	if (!(await validateRedirectUri(ctx.query.redirect_uri, client.redirect_uris))) {
		throw new APIError("BAD_REQUEST", { message: "Invalid redirect uri" });
	}

	// 步骤：作用域校验
	//   分支二：请求了未注册的作用域 → 拒绝
	if (!isScopeAllowed(client, ctx.query.scope)) {
		throw new APIError("BAD_REQUEST", { message: "Invalid scope" });
	}

	// 步骤：需要用户同意时 → 重定向到同意页
	//   分支三：用户尚未同意 → GET /oauth2/consent
	//   分支四：用户拒绝 → 回跳 error=access_denied
	// 步骤：签发授权码 → 302 回 redirect_uri?code=...&state=...
}

async function token(ctx: GenericEndpointContext): Promise<TokenResponse> {
	// 分支一：grant_type 不支持 → invalid_grant
	switch (ctx.body.grant_type) {
		case "authorization_code": return exchangeAuthorizationCode(ctx);
		case "refresh_token": return refreshToken(ctx);
		case "device_code": return redeemDeviceCode(ctx);
		default: throw new APIError("BAD_REQUEST", { error: "unsupported_grant_type" });
	}

	// authorization_code 分支：
	//   分支二：授权码无效或已过期 → invalid_grant
	//   分支三：redirect_uri 与授权时不一致 → invalid_grant
	//   分支四：客户端认证失败 → invalid_client
	// refresh_token 分支：
	//   分支五：刷新令牌无效 → invalid_grant
	//   分支六：超出 reuse interval 的重用 → 按严格重放处理拒绝
	//   分支七：作用域收窄请求 → 返回新令牌且作用域更窄
}
```

失败分支清单：客户端不存在 → 拒绝；重定向 uri 未注册或不匹配 → 拒绝（绝不重定向到未注册的 uri）；请求未注册作用域 → 拒绝；需要同意但用户拒绝 → `access_denied`；grant type 不支持 → `unsupported_grant_type`；授权码无效或过期 → `invalid_grant`；redirect uri 与授权时不一致 → `invalid_grant`；客户端认证失败 → `invalid_client`；刷新令牌无效 → `invalid_grant`；超出重用窗口的刷新令牌重用 → 严格重放拒绝。

### 15.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-15-01 | 已配置并注册一个 SAML 提供者，域名已验证 | 以该提供者的邮箱发起 `POST /sign-in/sso` 并完成回调 | 创建或复用一个本地 `User`；会话 Cookie 正常签发；自动归属返回 `assigned` 且 `member` 表新增一行；重复登录返回 `already-member` 且**不新增成员记录** |
| ACC-15-02 | SSO 提供者已注册但域名**未**验证 | 以该提供者的邮箱发起登录 | 登录本身成功（若账号可解析）；自动归属返回 `unverified-identity`；**不产生任何成员记录** |
| ACC-15-03 | 同一邮箱域名可匹配到多个组织 | 触发自动归属 | 返回 `ambiguous-target`；**不自动加入任何一个组织**（宁可不归属也不猜） |
| ACC-15-04 | 已启用 api-key 插件，已创建一枚 API Key | 用 `x-api-key` 请求头携带有效 Key 调用受保护端点 | 请求通过且上下文中的主体为该 Key 的归属用户；用同一枚已被禁用的 Key 请求 → `KEY_DISABLED`；用一枚已过期的 Key → `KEY_EXPIRED`；用一枚不存在的 Key → `KEY_NOT_FOUND` |
| ACC-15-05 | 已启用 api-key 插件且 `enableSessionForAPIKeys` 为真 | 用一枚**组织归属**的 API Key 请求需要会话的端点 | 返回 `UNAUTHORIZED` + `INVALID_REFERENCE_ID_FROM_API_KEY`；**不会**把组织 Key 冒充成某个用户的会话 |
| ACC-15-06 | 已启用 oauth-provider 并注册了一个机密客户端 | 用 `POST /oauth2/token` 以 `authorization_code` 换取令牌 | 返回访问令牌与刷新令牌；用**另一个**客户端的密钥请求 → `invalid_client`；用错误的 redirect uri 换码 → `invalid_grant`；`GET /jwks` 返回该授权方的公钥集合 |
| ACC-15-07 | 已启用 mcp 插件且配置了 `resource` | 请求 `/.well-known/oauth-protected-resource` | 返回受保护资源元数据文档，其中 `resource` 为配置的规范化标识符；用 `POST` 请求同一路径返回 405 且响应头含 `Allow: GET, HEAD`；用 `http://` 的非回环主机作为 `resource` 启动即报错（配置期失败） |
| ACC-15-08 | 已启用 stripe 插件且 `subscription.enabled` 为真 | 调用 `POST /stripe/webhook` 投递一条订阅状态变更事件 | `subscription` 表中对应行的 `status` 与 `periodEnd` 被更新；`stripeCustomerId` 写回 `user` 或 `organization` 表；webhook 签名无效时返回错误且**不修改任何数据** |

### 15.6 Known Caveats

- `packages/sso/` 的登录入口是 `POST /sign-in/sso`——它与核心的 `POST /sign-in/social`（社交登录）走**不同的路径**，两者共存不冲突（`packages/sso/src/routes/sso.ts:855`、`packages/oauth-provider/src/oauth.ts:668`）。
- SSO 的组织自动归属有**两个独立入口**：`packages/sso/src/linking/`（包内实现）与 `packages/oauth-provider/src/oauth.ts` 的组织归属分支——两处都产出 `OrganizationAssignmentResult`，取值集合一致。
- `packages/cimd/` 的插件 id 是 `cimd`，但它**不注册任何端点**——它通过 `init(ctx)` 调用 `extendOAuthProvider` 向已有的 oauth-provider 实例贡献发现能力（`packages/cimd/src/index.ts:53-65`）。不装 oauth-provider 时 CIMD 无处可依。
- `packages/mcp/` 的 `mcp(options)` 返回值类型是 `ReturnType<typeof oauthProvider>`——它在包装 OAuth 授权方的同时替换了 `onRequest`，多了一段受保护资源元数据的路由（`packages/mcp/src/plugin.ts:99-110`）。
- API Key 的 `metadata` 字段是 `apikey` 表里**唯一** `input: true` 的字段；其余全部由框架维护（`packages/api-key/src/schema.ts:160-176`）。
- API Key 的默认限流窗口是 `1000 * 60 * 60 * 24`（1 天）、上限 `10` 次——这是**每 Key** 的配额，不是每请求的限流（`packages/api-key/src/types.ts:175-205`）。
- `enableSessionForAPIKeys` 源码带 ⚠ 标注："This is not recommended for production use, as it can lead to security issues"（`packages/api-key/src/types.ts:206-212`）。
- Stripe 的订阅端点路径**不带** `/stripe` 前缀——它们是 `/subscription/upgrade` 等；只有 webhook 是 `/stripe/webhook`（`packages/stripe/src/routes.ts:2012`）。
- Stripe 的 `subscription.status` 默认值是 `"incomplete"`（不是 Stripe 的 `incomplete` 之外的值），写入时机由 webhook 决定（`packages/stripe/src/schema.ts:26-30`）。
- SCIM 的错误响应 schema 固定为 `urn:ietf:params:scim:api:messages:2.0:Error`（`packages/scim/src/index.ts:60`）；媒体类型由 `SCIM_MEDIA_TYPE` 常量定义而非硬编码字符串。
