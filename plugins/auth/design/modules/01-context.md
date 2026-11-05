---
title: 上下文装配域
description: 把配置、密钥、存储契约与扩展声明合并为单一共享上下文，并隔离请求派生状态。
sidebar:
  order: 3
  label: 上下文装配域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 1. Context Assembly

上下文装配域负责把宿主交付的配置、密钥、存储契约与扩展声明合并成一份可共享的运行时上下文，并保证这份上下文在并发请求下不被污染。与相邻模块的分界是：它只做「装配」不做「判断」——来源校验属于[守卫域](./07-guard/)，主体解析属于[身份域](./05-identity/)，凭据校验属于[凭证域](./04-credential/)，字段的业务含义属于[存储域](./08-storage/)；本域负责让这些域在同一个对象上取到一致的依赖。

本域是**核心域**。理由见 [核心业务识别](../architecture/#14-core-business-identification)：所有能力都要经此装配才能拿到依赖，装配失效则系统无依赖可用；即便砍掉其余能力，仅留装配域与最小入口，仍是一套完整的配置装配系统。

### 1.0 Key Decisions

**决策 1 — 装配先行、读取单一**

- 决策：宿主的一切依赖（配置、密钥、适配器、表模型、信任来源、限流参数、口令能力、Cookie 策略）都必须在装配期合并进同一份 `AuthContext`；运行期的任何能力只能从该上下文取依赖，不得从全局变量、环境变量或闭包外读取。
- 理由：装配期合并让「当前配置是什么」这个问题只有一个答案。若允许运行期直读环境变量，同一进程内不同实例的行为会随调用点漂移，测试也无法复现。源码中 `createAuthContext` 在 `packages/better-auth/src/context/create-context.ts:98-443` 内一次性产出全部字段，`AuthContext` 的完整字段面见 `packages/core/src/types/context.ts:363-522`。
- 违反后果：行为随调用点漂移；配置变更无法被静态审阅；测试之间互相污染。

**决策 2 — 请求派生状态不得回写共享上下文**

- 决策：与请求相关的派生量（`baseURL`、`trustedOrigins`、`trustedProviders`、跨子域 Cookie）必须在每请求克隆体上计算，绝不写回共享上下文。
- 理由：共享上下文被所有请求复用，一旦某个请求把自己的宿主名记忆化进 `baseURL`，后续所有请求生成的重置链接、回调地址都会指向错误宿主；`trustedOrigins` 的异步回调同理，并发请求之间会互相覆盖。源码在静态 baseURL 路径上用 `Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx))` 克隆（`packages/better-auth/src/auth/base.ts:70-73`），在动态 baseURL 路径上走 `resolveRequestContext`（`packages/better-auth/src/context/helpers.ts:210-276`），两者都只改克隆体。
- 违反后果：跨请求串味，表现为「A 用户收到的验证邮件链接指向 B 用户的域名」，且只在并发或非首个请求上暴露，极难复现。

**决策 3 — 密钥多版本共存**

- 决策：装配域同时接受单值 `secret` 与版本数组 `secrets`，把两者归一为 `secretConfig`（`{ keys, currentVersion, legacySecret }`）。新加密只用当前版本，旧版本保留为解密专用。
- 理由：密钥轮换必须是渐进的——轮换瞬间仍有大量以旧密钥签发的凭据（会话 Cookie、校验凭据值、OAuth 令牌）在流通中，一次性替换会让它们全部失效，等同于把全部用户踢下线。源码见 `packages/better-auth/src/context/create-context.ts:173-190`、`packages/better-auth/src/context/secret-utils.ts:92-108`、`packages/core/src/types/secret.ts:1-8`。
- 违反后果：轮换即全量登出；若改成「只留最新密钥」，旧凭据既无法解密也无法识别失效，只会表现为随机登出。

**决策 4 — 装配失败必须响亮失败**

- 决策：配置错误在装配期直接抛出，不降级、不猜测、不静默补默认值。
- 理由：装配期是唯一能同时看到「宿主配置」与「运行时环境」的时刻，此处放过的问题会在第一次真实登录时才暴露。已实装的响亮失败点包括：动态 `baseURL` 的 `allowedHosts` 为空即抛错（`packages/better-auth/src/context/create-context.ts:138-146`）；生产环境使用默认密钥即抛错、密钥缺失即抛错（`create-context.ts:71-81`）；`secrets` 数组为空、版本重复、版本非法即抛错（`secret-utils.ts:49-77`）。
- 违反后果：错误延迟到生产首个请求才暴露；降级路径（如默默用默认密钥）会让系统带着弱密钥上线。

### 1.1 Responsibility Boundary

本域承担三件事：

1. **归一**：把宿主交付的松散配置归一成运行时可直接消费的形态——`baseURL` 收敛为 origin、`basePath` 补默认、`session` 参数补默认、限流参数补默认、口令能力补默认。
2. **合并**：把插件声明按确定顺序合并进共享上下文，并把「需要收集后统一装配」的字段（`databaseHooks`、`trustedOrigins`）延迟到合并结束后处理。
3. **隔离**：为每个请求提供一份隔离的派生上下文，使请求相关的计算不污染共享状态。

本域明确**不做**的事：

- 不判断请求是否合法（`skipOriginCheck` / `skipCSRFCheck` 只作为开关透传给[守卫域](./07-guard/)，不在本域执行判定）。
- 不解析主体、不校验凭据（[身份域](./05-identity/)与[凭证域](./04-credential/)）。
- 不解释字段的业务含义（[存储域](./08-storage/)）。
- 不决定宿主界面如何呈现错误（[诊断域](./12-diagnostics/)与[客户端域](./10-client/)）。
- 不在运行期直接读环境变量补依赖（环境变量只在装配期被读取一次，见 `create-context.ts:173-177`）。

装配域是**唯一**允许改写 `ctx.options` 与 `ctx.internalAdapter` 的位置。插件的 `init()` 返回的上下文补丁通过 `Object.assign` 就地合并到共享上下文（`packages/better-auth/src/context/helpers.ts:56-59`），插件返回的选项补丁经 `defu` 深合并回 `options`（`helpers.ts:54`），而 `internalAdapter` 在插件装配全部结束后**重建一次**（`helpers.ts:91-96`），确保数据钩子是最终形态。

### 1.2 Capability Inventory

**基址与路径归一**

- `baseURL` 静态形态收敛为 origin 存入 `ctx.options.baseURL`，`ctx.baseURL` 保留完整基址（含 `basePath`）（`create-context.ts:192-202`）。
- `basePath` 缺省为 `/api/auth`（`create-context.ts:200`）。
- 动态 `baseURL` 形态（`{ allowedHosts, fallback, protocol }`）在装配期只做「允许主机名单非空」校验，实际解析推迟到请求期（`create-context.ts:136-153`、`helpers.ts:210-276`）。
- `baseURL` 缺失时告警，并允许从请求头推导（`create-context.ts:155-159`、`auth/base.ts:76-95`）。

**密钥装配**

- `secret`：优先取 `options.secret`，其次 `env.BETTER_AUTH_SECRET`，再次 `env.AUTH_SECRET`，都没有则回落到默认密钥并在生产环境抛错（`create-context.ts:176-190`）。
- `secrets`：版本数组，`BETTER_AUTH_SECRETS` 环境变量按 `<version>:<secret>` 逗号分隔解析（`secret-utils.ts:16-43`）。
- `secretConfig`：`secrets` 存在时为 `SecretConfig` 对象，否则为字符串（`create-context.ts:179-190`、`secret-utils.ts:92-108`）。
- 密钥强度：长度不足 32 字符告警、熵估算低于 120 bit 告警（`create-context.ts:83-95`、`secret-utils.ts:79-89`）。

**会话参数归一**（`create-context.ts:311-354`）

- `updateAge`：默认 `24 * 60 * 60`（86400 秒）。
- `expiresIn`：默认 `60 * 60 * 24 * 7`（604800 秒）。
- `freshAge`：默认 `60 * 60 * 24`（86400 秒）。
- `cookieRefreshCache`：默认 `false`；开启时 `updateAge` 默认为 `Math.floor(maxAge * 0.2)`，`maxAge` 默认 `60 * 5`。若同时配置了数据库或二级存储，`refreshCache` 被强制关闭并告警。

**限流参数归一**（`create-context.ts:357-365`）

- `enabled`：默认 `isProduction`。
- `window`：默认 `10`（秒）。
- `max`：默认 `100`。
- `storage`：默认 `memory`；配置了 `secondaryStorage` 时默认 `secondary-storage`；显式声明时以声明为准。

**口令能力装配**（`create-context.ts:371-379`）

- `hash` / `verify`：默认 `hashPassword` / `verifyPassword`。
- `config.minPasswordLength`：默认 `8`；`config.maxPasswordLength`：默认 `128`。
- `checkPassword`：宿主账号密码与主体档案一致性校验。

**Cookie 与信任来源装配**

- `authCookies` 与 `createAuthCookie`：按 `options` 生成，Cookie 前缀默认 `better-auth`（`packages/better-auth/src/cookies/index.ts:96-99`）。
- `trustedOrigins`：合并 `baseURL` 推导值、`options.trustedOrigins`（数组或异步函数）、`BETTER_AUTH_TRUSTED_ORIGINS` 环境变量（`helpers.ts:108-160`）。
- `trustedProviders`：取自 `account.accountLinking.trustedProviders`，支持静态数组或异步函数（`helpers.ts:292-305`）。
- `isTrustedOrigin`：按模式匹配判定 URL 是否受信（`create-context.ts:301-310`）。

**来源校验开关装配**

- `skipOriginCheck`：由 `advanced.disableOriginCheck` 推导，未显式配置时测试环境为 `true`、其他环境为 `false`（`create-context.ts:401-406`）。上下文类型面把该字段声明为 `boolean | string[]` 以支持按路径豁免，但 1.7.16 的 `advanced.disableOriginCheck` 仍是布尔量，运行期取值恒为布尔。
- `skipCSRFCheck`：由 `advanced.disableCSRFCheck` 推导，默认 `false`（`create-context.ts:400`）。

**存储契约装配**

- `adapter`：宿主传入的数据库适配器实例。
- `internalAdapter`：面向业务的内部适配层，暴露主体、账号、会话、校验凭据的读写方法（契约见 `packages/core/src/types/context.ts:112-310`）；插件装配结束后重建一次。
- `tables`：核心表模型 + 插件贡献表的合并结果（`packages/core/src/db/get-tables.ts:29-350`）。
- `runMigrations`：装配期先占位抛错，由具体 init 实现注入真实迁移入口（`create-context.ts:394-398`、`packages/better-auth/src/context/init.ts:19-28`）。
- `checkSchema` / `explicitSchemaCheck`：装配末尾挂载的运行时表结构校验（`create-context.ts:440-441`）。

**标识与能力装配**

- `generateId`：解析顺序为 `advanced.generateId` 函数 → `advanced.database.generateId` 函数 → `"uuid"` → `"serial"` 或 `false`（返回 `false`，交由数据库生成）→ 默认 `generateId(size)`（`create-context.ts:251-266`）。
- `socialProviders`：逐个实例化宿主声明的提供方；`enabled: false` 的被丢弃、缺 `clientId` 的告警但保留（`create-context.ts:221-249`）。
- `getPlugin` / `hasPlugin`：按插件 `id` 查询是否存在与取回实例（`create-context.ts:276-281`）。
- `publishTelemetry`：遥测出口（`create-context.ts:268-274`）。
- `runInBackground` / `runInBackgroundOrAwait`：后台任务调度面，未配置时退化为「吞掉异常直接执行」（`create-context.ts:407-430`）。

**请求级派生**

- 静态 `baseURL` 路径：克隆上下文后重算 `trustedOrigins` / `trustedProviders`，无 `baseURL` 时再从请求推导（`auth/base.ts:63-105`）。
- 动态 `baseURL` 路径：`resolveRequestContext` 重算 `baseURL`、`options.baseURL`、`trustedOrigins`、`trustedProviders`，跨子域 Cookie 场景重建 `authCookies` 与 `createAuthCookie`（`helpers.ts:210-276`）。

### 1.3 Contract

```ts
// 上下文装配域对外交付的唯一运行时契约
// 来源：packages/core/src/types/context.ts:363-522
export type AuthContext<Options extends BetterAuthOptions = BetterAuthOptions> =
  PluginContext<Options> &
    InfoContext & {
      // ---- 装配期一次性产出的固定依赖 ----
      options: Options;                                   // 归一后的顶层配置（单一事实来源）
      tables: BetterAuthDBSchema;                         // 核心表 + 插件表的合并模型
      adapter: DBAdapter<Options>;                        // 宿主提供的数据库适配器
      internalAdapter: InternalAdapter<Options>;          // 面向业务的内部适配层
      secondaryStorage: SecondaryStorage | undefined;     // 二级存储（会话/限流/校验凭据）
      socialProviders: OAuthProvider[];                   // 已实例化的身份提供方
      authCookies: BetterAuthCookies;                     // Cookie 名称与属性
      createAuthCookie: (cookieName: string, overrideAttributes?: Partial<CookieOptions>) => BetterAuthCookie;
      logger: ReturnType<typeof createLogger>;

      // ---- 密钥 ----
      secret: string;                                     // 当前密钥（用于签名/散列）
      secretConfig: string | SecretConfig;                // 多版本密钥配置

      // ---- 归一后的参数面 ----
      sessionConfig: {
        updateAge: number;                                // 秒，默认 86400
        expiresIn: number;                                // 秒，默认 604800
        freshAge: number;                                 // 秒，默认 86400
        cookieCacheSigner?: CookieCacheSigner | undefined;
        cookieRefreshCache:
          | false
          | { enabled: true; updateAge: number };
      };
      rateLimit: {
        enabled: boolean;                                  // 默认 isProduction
        window: number;                                   // 秒，默认 10
        max: number;                                      // 默认 100
        storage: "memory" | "database" | "secondary-storage";
      } & Omit<BetterAuthRateLimitOptions, "enabled" | "window" | "max" | "storage">;
      password: {
        hash: (password: string) => Promise<string>;
        verify: (data: { password: string; hash: string }) => Promise<boolean>;
        config: { minPasswordLength: number; maxPasswordLength: number };  // 默认 8 / 128
        checkPassword: CheckPasswordFn<Options>;
      };

      // ---- 信任与开关 ----
      trustedOrigins: string[];
      trustedProviders: string[];
      isTrustedOrigin: (url: string, settings?: { allowRelativePaths: boolean }) => boolean;
      skipOriginCheck: boolean | string[];
      skipCSRFCheck: boolean;
      oauthConfig: {
        storeStateStrategy: "database" | "cookie";        // 有存储时默认 database，否则 cookie
        skipStateCookieCheck?: boolean | undefined;       // 仅限开发/预发布环境
      };

      // ---- 请求期状态 ----
      session: { session: Session; user: User } | null;
      newSession: { session: Session; user: User } | null;
      setNewSession: (session: { session: Session; user: User } | null) => void;

      // ---- 标识与扩展点 ----
      generateId: (options: { model: ModelNames; size?: number | undefined }) => string | false;
      // 按插件 id 取回实例；未注册返回 null。实际类型按插件注册表推导（PluginContext<Options>）
      getPlugin: (pluginId: BetterAuthPluginRegistryIdentifier | LiteralString) => BetterAuthPlugin | null;
      // 按插件 id 判定是否启用
      hasPlugin: (pluginId: BetterAuthPluginRegistryIdentifier | LiteralString) => boolean;

      // ---- 运维与观测 ----
      runMigrations: () => Promise<void>;
      checkSchema?: SchemaCheck | undefined;
      explicitSchemaCheck?: SchemaCheck | undefined;
      publishTelemetry: (event: {
        type: string;
        anonymousId?: string | undefined;
        payload: Record<string, unknown>;
      }) => Promise<void>;
      runInBackground: (promise: Promise<unknown>) => void;
      runInBackgroundOrAwait: (promise: Promise<unknown> | void) => Awaitable<unknown>;
    };

export type InfoContext = {
  appName: string;     // 默认 "Better Auth"
  baseURL: string;     // 完整基址（含 basePath）
  version: string;     // 框架版本
};

// 多版本密钥契约
// 来源：packages/core/src/types/secret.ts:1-8
export interface SecretConfig {
  keys: Map<number, string>;   // 版本号 → 密钥值
  currentVersion: number;      // 用于新加密的版本（secrets 数组首项）
  legacySecret?: string;       // 旧格式裸十六进制载荷的兼容密钥
}

// 顶层配置的完整键面：25 个键
// 来源：packages/core/src/types/init-options.ts:538-1849
export type BetterAuthOptions = {
  appName?: string | undefined;
  baseURL?: BaseURLConfig | undefined;              // string | DynamicBaseURLConfig
  basePath?: string | undefined;                     // 默认 "/api/auth"
  secret?: string | undefined;
  secrets?: Array<{ version: number; value: string }> | undefined;
  database?: DatabaseConfig | undefined;
  secondaryStorage?: SecondaryStorage | undefined;
  emailVerification?: EmailVerificationOptions | undefined;
  emailAndPassword?: EmailAndPasswordOptions | undefined;
  socialProviders?: SocialProviders | undefined;
  plugins?: BetterAuthPlugin[] | undefined;
  user?: BetterAuthDBOptions<"user"> | undefined;
  session?: BetterAuthDBOptions<"session"> | undefined;
  account?: AccountOptions | undefined;
  verification?: BetterAuthDBOptions<"verification"> | undefined;
  trustedOrigins?: string[] | ((request?: Request) => Awaitable<string[]>) | undefined;
  rateLimit?: BetterAuthRateLimitOptions | undefined;
  advanced?: BetterAuthAdvancedOptions | undefined;
  logger?: Logger | undefined;
  databaseHooks?: DatabaseHooks | undefined;
  onAPIError?: OnAPIErrorOptions | undefined;
  hooks?: HooksOptions | undefined;
  disabledPaths?: string[] | undefined;
  telemetry?: TelemetryOptions | undefined;
  experimental?: ExperimentalOptions | undefined;
};

// 插件初始化契约
// 来源：packages/core/src/types/plugin.ts:39-57
export type BetterAuthPlugin = {
  id: LiteralString;
  version?: string | undefined;
  init?: ((ctx: AuthContext) => Awaitable<{
    context?: (DeepPartial<Omit<AuthContext, "options">> & Record<string, unknown>) | undefined;
    options?: Partial<BetterAuthOptions> | undefined;
  }> | void) | undefined;
  // ... endpoints / middlewares / hooks / schema 等
};
```

### 1.4 Flow

以下伪代码表达装配与请求派生两条链路的契约、参数与失败分支；它描述**形状**，不逐行复刻实现。

#### Assembly Chain

以下伪代码表达装配主链路：从归一后的配置到可共享的上下文。

```ts
// 入口：createAuthContext(adapter, options, getDatabaseType)
// 来源：packages/better-auth/src/context/create-context.ts:98-443
async function createAuthContext(adapter, options, getDatabaseType): Promise<AuthContext> {
  const isStateful = hasServerSessionStore(options);   // database || secondaryStorage 任一存在

  // 1) 无持久化会话存储时，补一层 Cookie 会话缓存兜底
  if (!isStateful) {
    options = defu(options, {
      session: { cookieCache: { enabled: true, strategy: "jwe", refreshCache: true,
        maxAge: options.session?.expiresIn || 60 * 60 * 24 * 7 } },
    });
  }
  // 无数据库时，账号（含 OAuth 令牌）只能落在 Cookie 里
  if (!options.database) {
    options = defu(options, { account: { storeAccountCookie: true } });
  }

  // 2) 基址解析
  //    失败分支：动态 baseURL 的 allowedHosts 为空 → 直接抛错，不降级
  if (isDynamicBaseURLConfig(options.baseURL)) {
    if (!options.baseURL.allowedHosts || options.baseURL.allowedHosts.length === 0) {
      throw new BetterAuthError("baseURL.allowedHosts cannot be empty.");
    }
  }
  const baseURL = isDynamicConfig ? undefined : getBaseURL(options.baseURL, options.basePath);
  if (!baseURL && !isDynamicConfig) {
    logger.warn("Base URL is not set. ...");   // 告警而非抛错：允许从请求推导
  }

  // 3) 密钥装配
  //    失败分支：secrets 版本重复/非法 → 抛错；生产环境默认密钥 → 抛错；密钥缺失 → 抛错
  const secretsArray = options.secrets ?? parseSecretsEnv(env.BETTER_AUTH_SECRETS);
  const legacySecret = options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "";
  let secret: string, secretConfig: string | SecretConfig;
  if (secretsArray) {
    validateSecretsArray(secretsArray, logger);         // 抛错：空数组/版本重复/版本非法/空值
    secret = secretsArray[0]!.value;
    secretConfig = buildSecretConfig(secretsArray, legacySecret);
  } else {
    secret = legacySecret || DEFAULT_SECRET;
    validateSecret(secret, logger);                     // 抛错：生产默认密钥 / 密钥缺失
    secretConfig = secret;
  }

  // 4) 选项归一 + 端点冲突检查
  options = { ...options, secret,
    baseURL: isDynamicConfig ? options.baseURL : baseURL ? new URL(baseURL).origin : "",
    basePath: options.basePath || "/api/auth",
    plugins: (options.plugins || []).concat(getInternalPlugins(options)) };
  checkEndpointConflicts(options, logger);               // 插件/内建端点路径冲突在此暴露

  // 4b) 危险组合检查：内存适配器 + generateId: false → 任何模型都不会生成主键
  //     这里只记 error 不抛错（配置仍可跑通），但必须让宿主在日志里看见
  if (adapter.id === "memory" && options.advanced?.database?.generateId === false) {
    logger.error("Misconfiguration detected. You are using the memory DB with generateId: false. ...");
  }

  // 5) 装配表模型、Cookie、身份提供方
  const cookies = getCookies(options);
  const tables  = getAuthTables(options);
  const providers = (await Promise.all(Object.entries(options.socialProviders || {})
      .map(async ([key, cfg]) => {
        const config = typeof cfg === "function" ? await cfg() : cfg;
        if (config == null || config.enabled === false) return null;   // 关闭或未配置 → 丢弃
        if (!config.clientId) logger.warn(`Social provider ${key} is missing clientId or clientSecret`);
        const p = socialProviders[key](config);
        p.disableImplicitSignUp = config.disableImplicitSignUp;
        return p;
      }))).filter((x) => x !== null);

  // 6) 构造共享上下文（一次性写入全部依赖）
  const ctx: AuthContext = {
    appName: options.appName || "Better Auth",
    baseURL: baseURL || "", version: getBetterAuthVersion(),
    socialProviders: providers, options, tables,
    oauthConfig: {
      storeStateStrategy: options.account?.storeStateStrategy
        || (isStateful ? "database" : "cookie"),
      skipStateCookieCheck: !!options.account?.skipStateCookieCheck,
    },
    trustedOrigins: await getTrustedOrigins(options),
    trustedProviders: await getTrustedProviders(options),
    sessionConfig: {
      updateAge: options.session?.updateAge ?? 24 * 60 * 60,
      expiresIn:  options.session?.expiresIn  || 60 * 60 * 24 * 7,
      freshAge:   options.session?.freshAge   ?? 60 * 60 * 24,
      cookieRefreshCache: /* refreshCache 为真且 isStateful → 关闭并告警；否则按 maxAge*0.2 计算 */ false,
    },
    secret, secretConfig,
    rateLimit: { ...options.rateLimit,
      enabled: options.rateLimit?.enabled ?? isProduction,
      window:  options.rateLimit?.window  || 10,
      max:     options.rateLimit?.max     || 100,
      storage: options.rateLimit?.storage || (options.secondaryStorage ? "secondary-storage" : "memory") },
    password: { hash: ..., verify: ...,
      config: { minPasswordLength: ... || 8, maxPasswordLength: ... || 128 }, checkPassword },
    generateId: generateIdFunc,
    adapter, internalAdapter: createInternalAdapter(adapter, { options, logger, hooks: [...], generateId }),
    skipCSRFCheck: !!options.advanced?.disableCSRFCheck,
    skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
      ? options.advanced.disableOriginCheck : isTest() ? true : false,
    // ... 其余字段
  };

  // 7) 插件初始化（可能同步或异步）
  const initOrPromise = runPluginInit(ctx);
  if (isPromise(initOrPromise)) await initOrPromise;   // 失败分支：插件 init 抛错 → 整体装配失败

  // 8) 挂载表结构校验
  ctx.checkSchema = runtimeSchemaCheckFor(ctx.adapter);
  ctx.explicitSchemaCheck = schemaCheckFor(ctx.adapter);
  return ctx;
}
```

#### Plugin Merge Chain

以下伪代码表达插件声明的合并规则：顺序、合并方式，以及两处需要收集后统一处理的字段。

```ts
// 入口：runPluginInit(context)
// 来源：packages/better-auth/src/context/helpers.ts:23-98
async function runPluginInit(context: AuthContext) {
  let options = context.options;
  const pluginTrustedOrigins: (string[] | ((request?: Request) => Awaitable<string[]>))[] = [];
  const dbHooks: { source: string; hooks: DatabaseHooks }[] = [];

  // 按 options.plugins 的数组顺序逐个初始化
  for (const plugin of options.plugins || []) {
    if (!plugin.init) continue;
    const result = await plugin.init(context);   // 失败分支：抛错即终止装配，不吞异常
    if (typeof result !== "object") continue;

    if (result.options) {
      const { databaseHooks, trustedOrigins, ...restOpts } = result.options;
      // 特殊处理 1：数据钩子不直接合并，收集后按 source 标记挂载
      if (databaseHooks) dbHooks.push({ source: `plugin:${plugin.id}`, hooks: databaseHooks });
      // 特殊处理 2：信任来源不直接合并，收集后重新装配
      if (trustedOrigins) pluginTrustedOrigins.push(trustedOrigins);
      // 其余选项：defu 深合并 —— 已存在的值优先，插件只补缺省
      options = defu(options, restOpts);
    }
    if (result.context) {
      // 上下文补丁：Object.assign 就地合并，保留原上下文引用
      Object.assign(context, result.context);
    }
  }

  // 信任来源重新装配：静态数组扁平化 + 动态函数并行求值后合成一个函数
  if (pluginTrustedOrigins.length > 0) {
    const all = [...(options.trustedOrigins ? [options.trustedOrigins] : []), ...pluginTrustedOrigins];
    const staticOrigins = all.filter(Array.isArray).flat();
    const dynamicOrigins = all.filter((s) => typeof s === "function");
    options.trustedOrigins = dynamicOrigins.length > 0
      ? async (request) => {
          const resolved = await Promise.all(dynamicOrigins.map((fn) => fn(request)));
          return [...staticOrigins, ...resolved.flat()]
            .filter((v): v is string => typeof v === "string" && v !== "");
        }
      : staticOrigins;
  }

  // 用户级数据钩子最后追加 —— 顺序即优先级
  if (options.databaseHooks) dbHooks.push({ source: "user", hooks: options.databaseHooks });

  // 数据钩子集合定型后重建内部适配器，确保钩子是最终形态
  context.internalAdapter = createInternalAdapter(context.adapter, {
    options, logger: context.logger, hooks: dbHooks, generateId: context.generateId,
  });
  context.options = options;
}
```

**合并顺序的确定性**是本域的核心契约之一：选项补丁走 `defu`（先到先得，已存在值不被覆盖），数据钩子走收集后统一挂载（用户级永远在最后），信任来源走收集后重新装配。

#### Per Request Derivation Chain

以下伪代码表达请求期派生状态的隔离方式：只写克隆体，不回写共享上下文。

```ts
// 入口：createBetterAuth(...).handler
// 来源：packages/better-auth/src/auth/base.ts:49-109
async function handler(request: Request) {
  const ctx = await authContext;              // 共享上下文，全程只读
  const basePath = ctx.options.basePath || "/api/auth";
  let handlerCtx: AuthContext;

  if (isDynamicBaseURLConfig(options.baseURL)) {
    // 动态基址：整份上下文按请求重建（含 cookies）
    handlerCtx = await resolveRequestContext(ctx, request, resolveDynamicTrustedProxyHeaders(ctx.options));
  } else {
    // 静态基址：克隆原型与自有属性描述符，得到隔离副本
    handlerCtx = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx));

    let trustOptions = ctx.options;
    if (!ctx.options.baseURL) {
      // 失败分支：请求无法推导基址 → 直接抛错，不静默继续
      const baseURL = getBaseURL(undefined, basePath, request, undefined, ctx.options.advanced?.trustedProxyHeaders);
      if (!baseURL) throw new BetterAuthError("Could not get base URL from request.");
      handlerCtx.baseURL = baseURL;
      handlerCtx.options = { ...ctx.options, baseURL: getOrigin(baseURL) || undefined };
      trustOptions = handlerCtx.options;
    }
    // 信任来源在克隆体上重算：并发请求之间互不覆盖
    handlerCtx.trustedOrigins   = await getTrustedOrigins(trustOptions, request);
    handlerCtx.trustedProviders = await getTrustedProviders(trustOptions, request);
  }

  const { handler } = router(handlerCtx, options);
  return runWithAdapter(handlerCtx.adapter, () => handler(request));
}
```

#### Idempotency and Recovery

以下四条策略说明装配与请求两条链路的幂等性与失败恢复方式。

- **装配幂等**：装配是纯函数式的——同样的 `options` 与 `adapter` 必然产出同构的上下文。`runPluginInit` 中重建 `internalAdapter` 而非增量修改，保证重复装配不会叠加钩子。
- **失败即中止，无半成品**：任一环节抛错（配置非法、密钥非法、插件 `init` 抛错、端点冲突）都会让 `createAuthContext` 整体失败。框架不会返回一份「部分装配好」的可共享上下文——因为那会让后续每个请求带着不一致的依赖跑。
- **恢复路径**：装配失败不需要回滚，因为装配期没有对外部系统产生写入（唯一例外是遥测发布与遥测 SDK 初始化）。修复配置后重新调用装配入口即可得到干净上下文，不需要清理动作。
- **请求级恢复**：请求级派生状态全部落在克隆体上，克隆体随请求结束即被回收；即便某个请求中途抛错，也不会有残留状态进入下一个请求。共享上下文不受影响，因此**不需要**为请求失败设计任何清理流程。

### 1.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 宿主配置 `baseURL: "https://app.example.com"`，未配置 `basePath` | 装配上下文并读取 `ctx.options.basePath` 与 `ctx.baseURL` | `basePath` 为 `"/api/auth"`；`ctx.options.baseURL` 为 `"https://app.example.com"`（origin）；`ctx.baseURL` 为 `"https://app.example.com/api/auth"` |
| A2 | 宿主未配置 `session` 段 | 读取 `ctx.sessionConfig` | `updateAge` 为 `86400`、`expiresIn` 为 `604800`、`freshAge` 为 `86400`，三者单位均为秒 |
| A3 | 宿主未配置 `rateLimit`，且未配置 `secondaryStorage`；运行在非生产环境 | 读取 `ctx.rateLimit` | `enabled` 为 `false`（跟随 `isProduction`）、`window` 为 `10`、`max` 为 `100`、`storage` 为 `"memory"` |
| A4 | 宿主配置 `secrets: [{ version: 2, value: "<32+ 字符>" }, { version: 1, value: "<旧密钥>" }]` | 装配并读取 `ctx.secretConfig` / `ctx.secret` | `ctx.secret` 等于 `version: 2` 的值；`ctx.secretConfig` 为 `SecretConfig` 对象，`currentVersion` 为 `2`，`keys` 含 `1` 与 `2`；用旧密钥签发的历史凭据仍可校验通过 |
| A5 | 宿主配置 `baseURL: { allowedHosts: [] }`（动态形态） | 触发装配 | 装配**失败**并抛出 `BetterAuthError`，消息含 `baseURL.allowedHosts cannot be empty`；不产出任何上下文，不静默降级为静态基址 |
| A6 | 运行在生产环境且未配置 `secret` / `secrets` / `BETTER_AUTH_SECRET` | 触发装配 | 装配**失败**并抛出 `BetterAuthError`，提示设置 `BETTER_AUTH_SECRET`；不得以默认密钥继续 |
| A7 | 两个插件同时声明 `options.trustedOrigins`，其中一个是异步函数；另一个声明 `options.databaseHooks` | 装配完成后读取 `ctx.options.trustedOrigins` 与 `ctx.internalAdapter` 的钩子 | `trustedOrigins` 被重装配为单一入口：静态数组与动态函数结果合并；数据钩子中插件级钩子在前、用户级钩子在最后，且 `internalAdapter` 是装配结束后的最终实例 |
| A8 | 宿主未配置 `baseURL`（静态路径），并发发起两个指向不同 `Host` 的请求 | 两个请求各自完成后读取共享 `ctx.options.baseURL` 与后续请求生成的重置链接 | 共享上下文不被第一个请求的宿主名污染；后续请求的重置链接指向各自请求的宿主；两个并发请求的 `baseURL` 互不覆盖 |
| A9 | 装配成功后连续两次调用装配入口 | 比较两次产出的 `ctx.internalAdapter` 与钩子集合 | 两次的数据钩子集合完全一致（用户级 1 条、插件级按声明顺序），不存在重复挂载 |
| A10 | 某插件的 `init()` 抛出异常 | 触发装配 | 装配整体**失败**并向上抛出；不得返回部分装配的上下文；修复插件后重新装配即可恢复，无需额外清理 |
