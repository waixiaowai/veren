---
title: 联合授权域
description: 以标准授权协议对接外部身份提供方、回收身份断言并回落到身份域解析。
sidebar:
  order: 8
  label: 联合授权域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 6. Federated Authorization

联合授权域是**外围域**。它只覆盖「第三方凭据」这一条支线：把外部身份提供方的授权结果回收成一条身份断言，然后交回身份域解析。移除本章描述的全部能力，邮箱口令链仍然完整可用——因此本章适度简化，不设 `.0` 铁律节，只在 `.4` 流程中给出必要的失败分支。

与相邻模块的分界是：本域**不独立创建主体**。所有主体相关的判定——账号绑定归属、是否允许隐式绑定、是否需要邮箱验证、是否签发会话——最终都回落到[身份域](./05-identity/)；本域只负责协议层的正确性与断言的可信性。

### 6.1 Responsibility Boundary

本域承担四件事：

1. **发起授权**：为外部身份提供方构造授权请求 URL（授权码流 + PKCE），并管理状态值与校验码的生成与生命周期。
2. **回收断言**：在回调端点校验状态值、校验签发方、交换授权码、取得身份断言与令牌。
3. **维持协议完整性**：保护保留参数不被调用方覆盖、把回调请求统一收敛为 GET、让失败一律以机器可读的 `error` 查询参数回跳。
4. **提供提供方目录**：内建 36 个提供方的实例化与配置装配（实例化动作本身在装配域完成，本域只定义契约）。

本域明确**不做**的事：

- 不判定账号绑定归属、不做隐式绑定决策、不决定是否创建主体（[身份域](./05-identity/)）。
- 不签发会话（[会话域](./03-session/)）——本域只返回主体与会话意图，由回调端点交给会话域落地。
- 不解释业务表结构（[存储域](./08-storage/)）——状态值在数据库策略下借用 `Verification` 表承载，这是复用而非解释。
- 不做来源判定与限流（[守卫域](./07-guard/)）。

### 6.2 Capability Inventory

**授权发起端点 `/sign-in/social`**（`packages/better-auth/src/api/routes/sign-in.ts:197-402`）

- 请求体：`provider`（必填）、`callbackURL`、`newUserCallbackURL`、`errorCallbackURL`、`scopes`、`disableRedirect`、`requestSignUp`、`loginHint`、`additionalParams`、`additionalData`、`idToken`。
- **ID Token 分支**：请求体带 `idToken` 时不跳转，直接校验该令牌、解析身份信息、落入身份域解析链，成功后直接返回会话令牌与主体；该分支要求提供方支持 ID Token 校验，否则返回 `ID_TOKEN_NOT_SUPPORTED`。
- **跳转分支**：无 `idToken` 时生成状态值与 PKCE 校验码，构造授权地址，默认通过 `Location` 响应头 302 跳转；`disableRedirect` 为真时只返回 `url` 不设响应头。
- **保留参数保护**：保留参数共 8 个——`state`、`client_id`、`redirect_uri`、`response_type`、`code_challenge`、`code_challenge_method`、`nonce`、`scope`。保护分两层：请求体校验层**直接拒绝**含保留参数的 `additionalParams`（返回参数校验错误，消息为 `additionalParams cannot include reserved OAuth parameters: ...`，`packages/core/src/oauth2/authorization-params.ts:13-28`）；授权地址构造层再**静默丢弃**一次，防止其他调用路径绕过校验层（`packages/core/src/oauth2/create-authorization-url.ts:11-24,108-113`）。

**状态值与校验码**（`packages/better-auth/src/state.ts`、`packages/better-auth/src/oauth2/state.ts`）

- `state`：32 位随机串（`state.ts:95`）。
- `codeVerifier`：128 位随机串（`oauth2/state.ts:50`），参与 PKCE `S256` 挑战计算（`create-authorization-url.ts:88-92`）。
- `idTokenNonce`：仅当提供方声明 `requiresIdTokenNonce` 时铸造，同样 32 位（`oauth2/state.ts:16-20`）。
- 状态数据载荷：`callbackURL`、`codeVerifier`、`errorURL`、`newUserURL`、`expiresAt`、`requestSignUp`、`idTokenNonce`、`link`、`serverContext`，以及客户端不可控的 `oauthState`（`state.ts:12-42`）。
- `serverContext` 在客户端可控的 `additionalData` 展开**之后**赋值，客户端无法借请求体伪造（`oauth2/state.ts:58-71`）。

**状态值存储策略**（`packages/better-auth/src/state.ts:90-311`）

| 策略 | 触发条件 | 载体 | 有效期 |
|---|---|---|---|
| `database` | 配置了 `database` 或 `secondaryStorage` | 签名 Cookie `better-auth.state` + `Verification` 行（标识符 `auth-state:<state>`） | Cookie 5 分钟；数据 10 分钟 |
| `cookie` | 无任何持久化存储 | 加密 Cookie `better-auth.oauth_state` | 10 分钟 |

- `database` 策略在解析成功后删除校验凭据行，一次性使用（`state.ts:293-296`）。
- `cookie` 策略在解析成功后立即使 Cookie 失效（`state.ts:230`）。

**回调端点 `/callback/:id`**（`packages/better-auth/src/api/routes/callback.ts:34-259`）

- 接受 `GET` 与 `POST`；`POST` 先合并 body 与 query，302 转到同路径的 `GET`（`callback.ts:55-70`）。
- `state` 缺失且提供方允许 IdP 发起时，服务端重新铸造状态值并重启授权（`callback.ts:100-117`）。
- 其余路径统一经 `parseState` 校验状态值，再经 `exchangeOAuthCallback` 交换令牌（`callback.ts:127-179`）。

**主体解析**（`packages/better-auth/src/oauth2/link-account.ts:196-703`）

- 先按 `(providerId, accountId)` 查绑定；命中「孤儿绑定」（绑定行存在但主体已不存在）直接拒绝（`link-account.ts:229-252`）。
- 无绑定时回落按邮箱查主体（`link-account.ts:287-296`）。
- 隐式绑定门槛：提供方受信 **或** 提供方声明邮箱已验证；**且**本地主体邮箱已验证（`requireLocalEmailVerified` 默认 `true`）；**且**未禁用隐式绑定（`link-account.ts:326-344`）。
- 显式绑定分支：要求提供方受信且提供方邮箱已验证（`link-account.ts:127-138`）。
- 新用户创建在事务内完成：主体与账号绑定同生共死（`link-account.ts:580-599`）。

**令牌与账号维护**

- 账号令牌在 `account.updateAccountOnSignIn !== false` 时于登录时刷新（`link-account.ts:435-450`）。
- `account.encryptOAuthTokens` 为真时，令牌以信封格式加密后落库（`packages/better-auth/src/oauth2/utils.ts:27-39`）。
- `account.storeAccountCookie` 为真时，账号数据写入加密 Cookie（无数据库部署的兜底路径）。

### 6.3 Contract

```ts
// 外部身份提供方契约
// 来源：packages/core/src/oauth2/oauth-provider.ts:141-297
export interface OAuthProvider<
  T extends object = object,
  O extends object = Partial<ProviderOptions>,
> {
  id: LiteralString;                                   // 提供方标识
  name: string;                                       // 展示名
  callbackPath?: string | undefined;                   // 自定义回调路径，缺省为 /callback/<id>
  createAuthorizationURL: (data: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
    idTokenNonce?: string | undefined;                // OIDC nonce，需转发为 nonce 参数
    additionalParams?: Record<string, string> | undefined;
  }) => Awaitable<URL>;
  accountSubject: OAuthAccountSubject<T>;              // 提供方侧稳定主体标识
  validateAuthorizationCode: (data: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens | null>;
  getUserInfo: (token: OAuth2Tokens & {
    expectedIdTokenNonce?: string | undefined;
    user?: { name?: { firstName?: string; lastName?: string }; email?: string } | undefined;
  }) => Promise<{ user: OAuth2UserInfo; data: T } | null>;
  getUserInfoFromIdToken?: (idToken: string) => Promise<{ user: OAuth2UserInfo; data: T } | null>;
  refreshAccessToken?: (refreshToken: string, ctx?: OAuthRefreshContext) => Promise<OAuth2Tokens>;
  revokeToken?: (token: string) => Promise<void>;
  createEndSessionURL?: (data: {
    idToken?: string | null | undefined;
    postLogoutRedirectURI?: string | undefined;
    state?: string | undefined;
  }) => Awaitable<URL | null>;
  idToken?: OAuthIdTokenConfig | undefined;            // 声明式 ID Token 校验配置
  issuer?: string | undefined;                         // RFC 9207 期望签发方
  requiresIdTokenNonce?: boolean | undefined;          // 要求 ID Token 与授权请求绑定
  disableImplicitSignUp?: boolean | undefined;
  disableSignUp?: boolean | undefined;
  allowIdpInitiated?: boolean | undefined;             // 允许无 state 的 IdP 发起回调
  options?: O | undefined;
}

// 令牌集合
// 来源：packages/core/src/oauth2/oauth-provider.ts:68-81
export interface OAuth2Tokens {
  tokenType?: string | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  accessTokenExpiresAt?: Date | undefined;
  refreshTokenExpiresAt?: Date | undefined;
  scopes?: string[] | undefined;
  idToken?: string | undefined;
  raw?: Record<string, unknown> | undefined;
}

// 提供方资料映射后的本地用户属性（不含提供方身份）
// 来源：packages/core/src/oauth2/oauth-provider.ts:84-97
export type OAuth2UserInfo = {
  id?: never;                       // 提供方身份只出现在原始资料与 accountSubject 中
  name?: string | undefined;
  email?: (string | null) | undefined;
  image?: string | undefined;
  emailVerified: boolean;
};

// 账号绑定键
// 来源：packages/better-auth/src/oauth2/account-key.ts:21-40
export type OAuthAccountKey = {
  providerId: string;               // 提供方 id
  accountId: string;                // 提供方侧稳定主体标识
};

// 状态值载荷
// 来源：packages/better-auth/src/state.ts:12-44
export type StateData = {
  callbackURL: string;
  codeVerifier: string;
  errorURL?: string | undefined;
  newUserURL?: string | undefined;
  expiresAt: number;                                   // 毫秒时间戳
  oauthState?: string | undefined;                     // 服务端铸造的 state 回声
  link?: { email: string; userId: string; encryptedSessionToken?: string | undefined } | undefined;
  requestSignUp?: boolean | undefined;
  idTokenNonce?: string | undefined;
  serverContext?: Record<string, unknown> | undefined;  // 仅服务端可写
};

// 状态值错误码
// 来源：packages/better-auth/src/state.ts:56-61
export type StateErrorCode =
  | "state_generation_error"
  | "state_not_found"
  | "state_invalid"
  | "state_mismatch"
  | "state_security_mismatch";

// 回调错误码（URL 安全串，作为 ?error= 的取值）
// 来源：packages/better-auth/src/oauth2/errors.ts:10-25
export const OAUTH_CALLBACK_ERROR_CODES = {
  NO_CODE: "no_code",
  PROVIDER_NOT_FOUND: "oauth_provider_not_found",
  ISSUER_MISSING: "issuer_missing",
  ISSUER_MISMATCH: "issuer_mismatch",
  INVALID_CODE: "invalid_code",
  NONCE_BINDING_MISSING: "nonce_binding_missing",
  UNABLE_TO_GET_USER_INFO: "unable_to_get_user_info",
  NO_CALLBACK_URL: "no_callback_url",
  UNABLE_TO_LINK_ACCOUNT: "unable_to_link_account",
  EMAIL_DOES_NOT_MATCH: "email_does_not_match",
  ACCOUNT_ALREADY_LINKED_TO_DIFFERENT_USER: "account_already_linked_to_different_user",
  EMAIL_NOT_FOUND: "email_not_found",
  EMAIL_NOT_VERIFIED: "email_not_verified",
} as const;

// 保留授权参数（调用方不得覆盖）
// 来源：packages/core/src/oauth2/create-authorization-url.ts:11-20
export const RESERVED_AUTHORIZATION_PARAMS = [
  "state", "client_id", "redirect_uri", "response_type",
  "code_challenge", "code_challenge_method", "nonce", "scope",
] as const;

// 上下文中的授权配置面
// 来源：packages/core/src/types/context.ts:383-397
export type OAuthConfig = {
  storeStateStrategy: "database" | "cookie";   // 有存储时默认 database，否则 cookie
  skipStateCookieCheck?: boolean | undefined;   // 仅限开发/预发布环境
};
```

### 6.4 Flow

以下伪代码描述协议链路的关键步骤、参数与失败分支。

#### Authorization Request

以下伪代码表达授权发起端点的两条分支：ID Token 直登与跳转授权。

```ts
// 入口：POST /sign-in/social
// 来源：packages/better-auth/src/api/routes/sign-in.ts:251-401
async function signInSocial(c) {
  const provider = await getAwaitableValue(c.context.socialProviders, { value: c.body.provider });
  // 失败分支：提供方未配置 → 404 PROVIDER_NOT_FOUND
  if (!provider) throw APIError.from("NOT_FOUND", BASE_ERROR_CODES.PROVIDER_NOT_FOUND);

  // 分支 A：ID Token 直登（前端已在提供方侧登录）
  if (c.body.idToken) {
    if (!supportsIdTokenSignIn(provider)) {
      throw APIError.from("NOT_FOUND", BASE_ERROR_CODES.ID_TOKEN_NOT_SUPPORTED);
    }
    const valid = await verifyProviderIdToken(provider, c.body.idToken.token, c.body.idToken.nonce, c);
    if (!valid) throw APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.INVALID_TOKEN);   // 失败分支
    const userInfo = provider.getUserInfoFromIdToken
      ? await provider.getUserInfoFromIdToken(c.body.idToken.token)
      : await provider.getUserInfo(oauthTokens);
    if (!userInfo?.user) throw APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.FAILED_TO_GET_USER_INFO);
    if (!userInfo.user.email) throw APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.USER_EMAIL_NOT_FOUND);
    const accountKey = await resolveOAuthAccountKeyForAPI(provider, oauthTokens, userInfo.data);
    // 交给身份域解析主体（本域不创建主体）
    const data = await handleOAuthUserInfo(c, { userInfo: {...}, account: {...}, callbackURL, disableSignUp });
    if (data.error) throw APIError.from("UNAUTHORIZED", { message: data.error, code: "OAUTH_LINK_ERROR" });
    await setSessionCookie(c, data.data!);
    return c.json({ redirect: false, token: data.data!.session.token, url: undefined, user: ... });
  }

  // 分支 B：跳转授权
  const idTokenNonce = generateIdTokenNonce(provider);           // 仅当 requiresIdTokenNonce
  const { codeVerifier, state } = await generateState(c, { additionalData: c.body.additionalData, idTokenNonce });
  //   codeVerifier：128 位随机；state：32 位随机
  //   失败分支：状态值写入失败 → 500 "Unable to create verification"
  const url = await provider.createAuthorizationURL({
    state, codeVerifier, idTokenNonce,
    redirectURI: `${c.context.baseURL}${getOAuthCallbackPath(provider)}`,
    scopes: c.body.scopes, loginHint: c.body.loginHint,
    additionalParams: c.body.additionalParams,   // 保留参数已在请求体校验层被拒绝，此处再丢弃一次
  });
  if (!c.body.disableRedirect) c.setHeader("Location", url.toString());
  return c.json({ url: url.toString(), redirect: !c.body.disableRedirect });
}
```

#### Authorization URL Construction

以下伪代码表达授权地址的构造规则，含保留参数保护与 PKCE。

```ts
// 来源：packages/core/src/oauth2/create-authorization-url.ts:26-115
async function createAuthorizationURL(input): Promise<URL> {
  const url = new URL(options.authorizationEndpoint || authorizationEndpoint);
  url.searchParams.set("response_type", responseType || "code");
  const primaryClientId = getPrimaryClientId(options.clientId);
  if (!primaryClientId) throw new Error("OAuth provider requires clientId");   // 失败分支：缺 clientId
  url.searchParams.set("client_id", primaryClientId);
  url.searchParams.set("state", state);
  if (scopes?.length) url.searchParams.set("scope", scopes.join(scopeJoiner || " "));
  url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
  nonce && url.searchParams.set("nonce", nonce);
  if (codeVerifier) {
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    url.searchParams.set("code_challenge_method", "S256");      // PKCE 固定 S256
    url.searchParams.set("code_challenge", codeChallenge);
  }
  if (additionalParams) {
    for (const [key, value] of Object.entries(additionalParams)) {
      if (RESERVED_AUTHORIZATION_PARAMS_SET.has(key)) continue;   // 保留参数保护
      url.searchParams.set(key, value);
    }
  }
  return url;
}
```

#### Callback Handling

以下伪代码表达回调端点的处理顺序与失败分支。

```ts
// 入口：GET /callback/:id
// 来源：packages/better-auth/src/api/routes/callback.ts:49-258
async function callbackOAuth(c) {
  const defaultErrorURL = c.context.options.onAPIError?.errorURL || `${c.context.baseURL}/error`;

  // POST → 302 转 GET，保证 Cookie 被带上
  if (c.method === "POST") {
    const merged = schema.parse({ ...schema.parse(c.body ?? {}), ...schema.parse(c.query ?? {}) });
    throw c.redirect(`${c.context.baseURL}/callback/${c.params.id}?${new URLSearchParams(merged).toString()}`);
  }

  const { code, error, state, error_description, device_id, user, iss } = schema.parse(c.query);

  // IdP 发起场景：无 state 但提供方允许 → 服务端重启授权
  if (state === undefined && code) {
    const provider = await getAwaitableValue(c.context.socialProviders, { value: c.params.id });
    if (provider?.allowIdpInitiated) {
      const { state: freshState, codeVerifier } = await generateState(c, { idTokenNonce: generateIdTokenNonce(provider) });
      const authUrl = await provider.createAuthorizationURL({ state: freshState, codeVerifier, idTokenNonce, redirectURI });
      throw c.redirect(authUrl.toString());
    }
  }

  // 失败分支：状态值缺失 → 回跳 error=state_not_found
  if (!state) throw c.redirect(appendQueryParams(defaultErrorURL, { error: "state_not_found" }));

  // 状态值校验（内部失败统一映射为 state_* 错误码后回跳）
  const { codeVerifier, callbackURL, link, errorURL, newUserURL, requestSignUp, idTokenNonce } = await parseState(c);

  if (error) redirectOnError(error, error_description);      // 提供方自报错误，原样透传
  if (!code) throw redirectOnError(OAUTH_CALLBACK_ERROR_CODES.NO_CODE);   // 失败分支：无授权码

  const provider = await getAwaitableValue(c.context.socialProviders, { value: c.params.id });
  if (!provider) throw redirectOnError(OAUTH_CALLBACK_ERROR_CODES.PROVIDER_NOT_FOUND);  // 失败分支

  const exchanged = await exchangeOAuthCallback(c, provider, { code, codeVerifier, iss, deviceId, user, idTokenNonce });
  if (exchanged.error) throw redirectOnError(exchanged.error);
  const { tokens, userInfo, providerProfile, accountKey } = exchanged;

  if (!callbackURL) throw redirectOnError(OAUTH_CALLBACK_ERROR_CODES.NO_CALLBACK_URL);  // 失败分支

  // 显式绑定分支
  if (link) {
    const linkResult = await linkOAuthAccount(c, { link, userInfo, account: {...}, profile: providerProfile, scopes: tokens.scopes });
    if (!linkResult.linked) return redirectOnError(linkResult.error.code, linkResult.error.message);
    throw c.redirect(callbackURL);
  }

  // 隐式登录分支：主体解析在身份域完成
  if (!userInfo.email) return redirectOnError(OAUTH_CALLBACK_ERROR_CODES.EMAIL_NOT_FOUND);   // 失败分支
  const result = await handleOAuthUserInfo(c, {
    userInfo: { ...userInfo, id: accountKey.accountId, email: userInfo.email, name: userInfo.name || "" },
    account: { ...accountKey, ...tokens, scope: tokens.scopes?.join(",") },
    callbackURL,
    disableSignUp: (provider.disableImplicitSignUp && !requestSignUp) || provider.options?.disableSignUp,
    overrideUserInfo: provider.options?.overrideUserInfoOnSignIn,
    source: { method: "oauth", oauth: { providerId: provider.id, profile: providerProfile } },
  });
  if (result.error) return redirectOnError(result.error.split(" ").join("_"));   // 失败分支：错误串下划线化
  const { session, user } = result.data!;
  await setSessionCookie(c, { session, user });
  throw c.redirect(result.isRegister ? newUserURL || callbackURL : callbackURL);
}
```

#### Token Exchange and Assertion Checks

以下伪代码表达授权码交换与身份断言校验，含签发方与随机数绑定。

```ts
// 来源：packages/better-auth/src/oauth2/callback.ts:25-107
async function exchangeOAuthCallback(ctx, provider, callback) {
  // RFC 9207：签发方不匹配 → 拒绝
  if (callback.iss && provider.issuer && callback.iss !== provider.issuer) {
    return { error: OAUTH_CALLBACK_ERROR_CODES.ISSUER_MISMATCH };     // 失败分支：issuer_mismatch
  }
  // 失败即闭：要求 nonce 绑定却没有期望 nonce → 拒绝，不得信任未绑定的 ID Token
  if (provider.requiresIdTokenNonce && !callback.idTokenNonce) {
    return { error: OAUTH_CALLBACK_ERROR_CODES.NONCE_BINDING_MISSING };  // 失败分支
  }
  let tokens: OAuth2Tokens | null;
  try {
    tokens = await provider.validateAuthorizationCode({
      code: callback.code, codeVerifier: callback.codeVerifier,
      deviceId: callback.deviceId, redirectURI: `${ctx.context.baseURL}${getOAuthCallbackPath(provider)}`,
    });
  } catch {
    return { error: OAUTH_CALLBACK_ERROR_CODES.INVALID_CODE };       // 失败分支：交换抛错
  }
  if (!tokens) return { error: OAUTH_CALLBACK_ERROR_CODES.INVALID_CODE };  // 失败分支：交换失败

  const result = await provider.getUserInfo({ ...tokens, expectedIdTokenNonce: callback.idTokenNonce, user: safeJSONParse(callback.user) });
  if (!result?.user) return { error: OAUTH_CALLBACK_ERROR_CODES.UNABLE_TO_GET_USER_INFO };

  const accountKey = await resolveOAuthAccountKey(provider, tokens, result.data).catch(() => null);
  if (!accountKey) return { error: OAUTH_CALLBACK_ERROR_CODES.UNABLE_TO_GET_USER_INFO };
  return { tokens, userInfo: result.user, providerProfile: toOAuthProfileRecord(result.data), accountKey };
}
```

#### State Validation

以下伪代码表达两种状态值存储策略下的校验流程。

```ts
// 来源：packages/better-auth/src/state.ts:172-311
async function parseGenericState(c, state, settings) {
  if (!state) throw new StateError("State not found in OAuth callback", { code: "state_not_found" });

  if (storeStateStrategy === "cookie") {
    const encryptedData = c.getCookie(stateCookie.name);          // better-auth.oauth_state
    if (!encryptedData) throw new StateError("State mismatch: auth state cookie not found", { code: "state_mismatch" });
    try {
      parsedData = stateDataSchema.parse(JSON.parse(await symmetricDecrypt({ key, data: encryptedData })));
    } catch (cause) {
      throw new StateError("State invalid: Failed to decrypt or parse auth state", { code: "state_invalid", cause });
    }
    if (!parsedData.oauthState || parsedData.oauthState !== state) {
      throw new StateError("State mismatch: OAuth state parameter does not match stored state",
        { code: "state_security_mismatch", errorURL: parsedData.errorURL });
    }
    expireCookie(c, stateCookie);
  } else {
    const data = await c.context.internalAdapter.findVerificationValue(`auth-state:${state}`);
    if (!data) throw new StateError("State mismatch: verification not found", { code: "state_mismatch" });
    parsedData = stateDataSchema.parse(JSON.parse(data.value));
    if (parsedData.oauthState !== undefined && parsedData.oauthState !== state) {
      throw new StateError("State mismatch: OAuth state parameter does not match stored state",
        { code: "state_security_mismatch", errorURL: parsedData.errorURL });
    }
    // 签名 Cookie 必须与 state 一致；skipStateCookieCheck 仅供开发/预发布与 SAML 中转使用
    const skipStateCookieCheck = settings?.skipStateCookieCheck ?? c.context.oauthConfig.skipStateCookieCheck;
    if (!skipStateCookieCheck && (!stateCookieValue || stateCookieValue !== state)) {
      throw new StateError("State mismatch: State not persisted correctly", { code: "state_security_mismatch" });
    }
    expireCookie(c, stateCookie);
    await c.context.internalAdapter.deleteVerificationByIdentifier(`auth-state:${state}`);  // 一次性
  }

  if (parsedData.expiresAt < Date.now()) {
    throw new StateError("Invalid state: request expired", { code: "state_mismatch", errorURL: parsedData.errorURL });
  }
  return parsedData;
}
```

#### Subject Resolution Order

以下伪代码表达身份断言回落到主体解析的顺序与门槛。

```ts
// 来源：packages/better-auth/src/oauth2/link-account.ts:229-344, 548-599
async function handleOAuthUserInfo(c, opts) {
  // 第 1 步：按 (providerId, accountId) 查绑定
  const accountOwner = await c.context.internalAdapter.findAccountOwnerByKey({
    providerId: opts.account.providerId, accountId: opts.account.accountId,
  });
  // 失败分支：孤儿绑定（账号在、主体没了）→ 直接拒绝，不修复、不静默重建
  if (accountOwner?.kind === "orphaned") return { error: "unable to link account", data: null };

  let dbUser;
  if (accountOwner?.kind === "owned") {
    dbUser = { user: accountOwner.user, linkedAccount: accountOwner.account, accounts: [accountOwner.account] };
  } else {
    // 第 2 步：回落按邮箱查主体
    const emailMatch = await c.context.internalAdapter.findUserByEmail(opts.userInfo.email.toLowerCase(), { includeAccounts: true });
    dbUser = emailMatch ? { user: emailMatch.user, linkedAccount: null, accounts: emailMatch.accounts } : null;
  }

  const user = dbUser?.user;
  const isRegister = !user;

  if (dbUser) {
    const linkedAccount = dbUser.linkedAccount ?? dbUser.accounts.find(
      (a) => a.providerId === opts.account.providerId && a.accountId === opts.account.accountId);
    if (!linkedAccount) {
      // 隐式绑定门槛
      const isTrustedProvider = opts.isTrustedProvider
        || (opts.trustProviderByName !== false && c.context.trustedProviders.includes(opts.account.providerId));
      const requireLocalEmailVerified = accountLinking?.requireLocalEmailVerified ?? true;
      const gatePasses =
        (!opts.selectedUser && ((isTrustedProvider || opts.userInfo.emailVerified)
          && (!requireLocalEmailVerified || dbUser.user.emailVerified)
          && accountLinking?.enabled !== false
          && accountLinking?.disableImplicitLinking !== true));
      // 失败分支：门槛不通过 → 拒绝隐式绑定
      if (!gatePasses) return { error: "account not linked", data: null };
      const createdAccount = await c.context.internalAdapter.linkAccount({ providerId, accountId, userId: dbUser.user.id, ... });
      if (!createdAccount) return { error: "unable to link account", data: null };
    } else {
      // 已有绑定：刷新令牌（scope 有意不更新，只能通过 linkSocial 变更）
      if (c.context.options.account?.updateAccountOnSignIn !== false) {
        const updatedAccount = await c.context.internalAdapter.updateAccount(linkedAccount.id, freshTokens);
        if (!updatedAccount) return { error: "unable to update account", data: null };   // 失败分支：更新失败即失败
      }
    }
  } else {
    // 第 3 步：新主体
    if (opts.disableSignUp) return { error: "signup disabled", data: null };        // 失败分支
    try {
      // 新用户创建在事务内完成
      const { createdUser, createdAccount } = await runWithTransaction(c.context.adapter, async () => {
        const createdUser = await c.context.internalAdapter.createUser({ ... }, source);
        const createdAccount = await c.context.internalAdapter.createAccount({ ...accountData, userId: createdUser.id });
        return { createdUser, createdAccount };
      });
      user = createdUser;
    } catch {
      return { error: "unable to create user", data: null };                        // 失败分支：事务回滚，无残留
    }
  }

  // 邮箱验证闸门（提供方声明 requireEmailVerification 时）
  if (requireEmailVerification && !user.emailVerified) {
    return { error: OAUTH_CALLBACK_ERROR_CODES.EMAIL_NOT_VERIFIED, data: null, isRegister };
  }

  const session = await c.context.internalAdapter.createSession(user.id, undefined, undefined, undefined, { deferSecondaryStorageWrites: true });
  if (!session) return { error: "unable to create session", data: null };            // 失败分支
  return { data: { session, user }, error: null, isRegister };
}
```

#### Idempotency and Recovery

以下五条策略说明本域在重复投递与部分失败下的行为。

- **状态值一次性**：`database` 策略在解析成功后立即删除校验凭据行，重放同一个 `state` 只会命中 `state_mismatch`（`state.ts:293-296`）；`cookie` 策略解析后立即使 Cookie 失效，重放时 Cookie 已不存在。
- **回调重放**：授权码由提供方侧一次性消费，重放会得到 `invalid_code`；框架侧不会因为重放而创建第二份主体。
- **绑定冲突**：`(providerId, accountId)` 命中他人绑定时报 `account_already_linked_to_different_user`，不覆盖、不合并（`link-account.ts:152-157`）。
- **创建失败恢复**：新主体与账号绑定在同一事务内创建，失败整体回滚，不留半成品主体；重试即重新走完整链路。
- **显式绑定会话存活检查**：绑定发起时的会话若已失效，返回 `unable_to_link_account`（`link-account.ts:74-105`）。

### 6.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| B1 | 宿主配置了 `google` 提供方；未配置 `account.storeStateStrategy` 且配置了 `database` | 调用 `POST /sign-in/social`，请求体含 `provider: "google"` 与 `callbackURL` | 响应体含 `redirect: true` 与 `url`；`url` 的查询参数含 `state`、`code_challenge`、`code_challenge_method=S256`、`client_id`、`redirect_uri`；响应同时带 `Location` 头 |
| B2 | 同上，但请求体 `additionalParams` 传入 `{ state: "evil", scope: "evil" }`（保留参数） | 调用 `POST /sign-in/social` | 请求在参数校验层被**拒绝**（参数校验错误，消息含 `additionalParams cannot include reserved OAuth parameters`）；不生成授权地址、不跳转、不签发会话 |
| B3 | 同上，但请求体 `additionalParams` 传入 `{ hd: "example.com" }`（非保留参数） | 调用 `POST /sign-in/social` | 授权 URL 的查询参数含 `hd=example.com`；`state` 与 `scope` 仍为框架生成值，未被调用方覆盖 |
| B4 | 宿主配置了 `google`；发起授权后用**另一个** `state` 值访问 `/callback/google` | 访问回调端点 | 浏览器被 302 跳转到错误页，URL 查询参数含 `error=state_mismatch`；不签发会话、不创建主体 |
| B5 | 宿主配置了 `google`；发起授权后**不带** `state` 访问 `/callback/google` | 访问回调端点 | 错误页查询参数含 `error=state_not_found`；不签发会话 |
| B6 | 宿主配置了 `github`，且 `account.accountLinking.trustedProviders` 未包含 `github`；本地存在一个**邮箱未验证**的同邮箱主体 | 用 `github` 发起登录并完成授权回调 | 回调不签发会话、不把 `github` 账号绑定到该主体（隐式绑定门槛不通过）；错误以 `error=account_not_linked` 回跳 |
| B7 | 宿主配置了 `github`，且 `trustedProviders` 包含 `github`；本地存在一个邮箱**已验证**的同邮箱主体 | 用 `github` 发起登录并完成授权回调 | 该主体获得会话并被 302 跳转到 `callbackURL`；`Account` 表新增一行 `(providerId="github", accountId=<提供方主体>)` 指向该主体 |
| B8 | 宿主配置了 `google` 并声明 `issuer`；用伪造 `iss` 发起回调 | 访问回调端点 | 错误页查询参数含 `error=issuer_mismatch`；不签发会话 |
| B9 | 宿主配置了 `github`；已完成一次授权回调 | 用**同一个** `state` 再次访问 `/callback/github` | 状态值已被一次性消费，回跳错误含 `error=state_mismatch`；不重复签发会话、不重复创建账号绑定（重放防护） |

### 6.6 Provider Catalog

内建提供方共 36 个，注册表见 `packages/core/src/social-providers/index.ts:40-77`，每个提供方的参数契约见 `ProviderOptions`（`packages/core/src/oauth2/oauth-provider.ts:307-441`）。宿主在 `socialProviders` 中按 id 传入配置，配置可以是对象或返回配置的异步函数；`enabled: false` 的提供方在装配期被丢弃。

| # | 提供方 id | 展示名 | # | 提供方 id | 展示名 |
|---|---|---|---|---|---|
| 1 | `apple` | Apple | 19 | `linkedin` | Linkedin |
| 2 | `atlassian` | Atlassian | 20 | `gitlab` | Gitlab |
| 3 | `cloudflare` | Cloudflare | 21 | `tiktok` | TikTok |
| 4 | `cognito` | Cognito | 22 | `reddit` | Reddit |
| 5 | `discord` | Discord | 23 | `roblox` | Roblox |
| 6 | `facebook` | Facebook | 24 | `salesforce` | Salesforce |
| 7 | `figma` | Figma | 25 | `vk` | VK |
| 8 | `github` | GitHub | 26 | `zoom` | Zoom |
| 9 | `microsoft` | Microsoft EntraID | 27 | `notion` | Notion |
| 10 | `google` | Google | 28 | `kakao` | Kakao |
| 11 | `huggingface` | Hugging Face | 29 | `naver` | Naver |
| 12 | `slack` | Slack | 30 | `line` | LINE |
| 13 | `spotify` | Spotify | 31 | `paybin` | Paybin |
| 14 | `twitch` | Twitch | 32 | `paypal` | PayPal |
| 15 | `twitter` | Twitter | 33 | `polar` | Polar |
| 16 | `dropbox` | Dropbox | 34 | `railway` | Railway |
| 17 | `kick` | Kick | 35 | `vercel` | Vercel |
| 18 | `linear` | Linear | 36 | `wechat` | WeChat |

`microsoft` 对应源文件 `microsoft-entra-id.ts`（其 `id` 字段为 `"microsoft"`，`packages/core/src/social-providers/microsoft-entra-id.ts:190`），`gitlab` 的展示名为 `"Gitlab"`（`packages/core/src/social-providers/gitlab.ts:80`）。

除内建目录外，宿主可通过自定义 `OAuthProvider` 对象接入任意标准授权提供方；自定义提供方必须实现 `createAuthorizationURL`、`accountSubject`、`validateAuthorizationCode`、`getUserInfo` 四个必需成员。
