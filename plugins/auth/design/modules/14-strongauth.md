---
title: 强认证域
description: 为二次验证、无密码凭证、设备授权与一次性凭据提供更高强度认证方式的设计。
sidebar:
  order: 16
  label: 强认证域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 14. Strong Authentication

强认证域是**外围域**。它为二次验证（2FA）、无密码凭证（Passkey / WebAuthn）、钱包签名（SIWE）、受限设备授权码与一次性凭据提供更高强度或替代性的认证方式；**它不承担认证判定职责，移除后核心链路完整**——去掉全部强认证插件后，邮箱 + 口令的注册登录链路完全不受影响，只是少了几条"更强或更方便"的路径。

强认证域与相邻模块的分界是：**强认证域提供"第二把锁"与"替代钥匙"，但每条路径最终都回到 [凭证域](./04-credential/) 的凭据模型与 [会话域](./03-session/) 的会话签发**。它不裁决主体是否合法——它产出的都是 `Account`（凭证绑定）或 `Verification`（校验凭据）记录，判定仍然走统一链路。它与 [守卫域](./07-guard/) 的边界是：强认证域自己管**自己的**尝试预算与账号锁定（`failedVerificationCount` / `lockedUntil`），但通用的请求级限流仍由守卫域的限流插件负责——强认证插件只在自己的 `rateLimit` 段里声明额外规则。相关状态取值见 [状态模型](../states/)；相关表结构见 [数据字典](../data/)；强认证域在整体中的位置见 [总体方案与架构](../architecture/)。

### 14.1 Responsibility Boundary

**强认证域负责：**

- 提供 `two-factor` 插件：由 `totp` / `otp` / `backup_code` 三个子插件合成，主插件 id 为 `two-factor`（`packages/better-auth/src/plugins/two-factor/index.ts:188-201`）。
- 提供 `twoFactor` 表与 `user.twoFactorEnabled` 扩展字段（`packages/better-auth/src/plugins/two-factor/schema.ts:3-60`）。
- 提供账号级锁定：按账户累计连续失败次数，超限锁定一段时间（`packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:224-327`）。
- 提供信任设备机制：`trust_device` Cookie + 服务端校验记录，`trustDeviceMaxAge` 默认 30 天（`packages/better-auth/src/plugins/two-factor/constant.ts:1-3`）。
- 通过插件对象向 `ctx` 暴露 `shouldRequireTwoFactor(ctx)`，供宿主判断"本次登录是否仍需第二因子"（`packages/better-auth/src/plugins/two-factor/index.ts:184-196`）。
- 提供 `packages/passkey/`——无密码凭证（WebAuthn）注册与认证。
- 提供 `siwe` 插件——以太坊签名登录，nonce 存校验凭据表并原子核销。
- 提供 `device-authorization` 插件——受限设备授权码流程。
- 提供一次性凭据与替代凭据插件：`email-otp`、`magic-link`、`one-time-token`、`phone-number`。

**强认证域不负责（明确拒绝承担的职责）：**

- 不裁决主体身份：二次验证通过后签发的仍是普通会话，凭据模型不变。
- 不实现通用限流：插件的 `rateLimit` 段只覆盖自己的路径前缀（如 `/two-factor/`），其余限流归守卫域。
- 不发送通知：`sendOTP` / 邮件发送函数由宿主提供，插件只负责在正确时机调用。
- 不管理密钥轮换：备份码与 OTP 的存储策略由插件提供，但密钥本身属于宿主配置。
- 不替代会话管理：2FA 期间的状态由 `two_factor` Cookie 承载，Cookie 生命周期与会话由 [会话域](./03-session/) 与宿主配置共同决定。

**失败语义的统一约定：**

| 情形 | 语义 |
|---|---|
| 因子未启用 | `TOTP_NOT_ENABLED` / `OTP_NOT_ENABLED` / `BACKUP_CODES_NOT_ENABLED` |
| 因子未配置 | `TOTP_NOT_CONFIGURED` / `OTP_NOT_CONFIGURED`（插件选项未开启） |
| 码已过期 | `OTP_HAS_EXPIRED` |
| 码错误 | `INVALID_CODE` / `INVALID_OTP` / `INVALID_BACKUP_CODE` |
| 尝试超限 | `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`（因子级） / `ACCOUNT_TEMPORARILY_LOCKED`（账号级） |
| 账号已锁定 | `TOO_MANY_REQUESTS` + `ACCOUNT_TEMPORARILY_LOCKED` |

### 14.2 Capability Inventory

#### 14.2.1 Two Factor

**端点全集（8 个公开端点 + 2 个仅服务端端点）：**

| 端点 | 方法 | 路径 | 来源 |
|---|---|---|---|
| 启用二次验证 | `POST` | `/two-factor/enable` | `packages/better-auth/src/plugins/two-factor/index.ts:217` |
| 禁用二次验证 | `POST` | `/two-factor/disable` | `packages/better-auth/src/plugins/two-factor/index.ts:422` |
| 取 TOTP URI | `POST` | `/two-factor/get-totp-uri` | `packages/better-auth/src/plugins/two-factor/totp/index.ts:164` |
| 校验 TOTP | `POST` | `/two-factor/verify-totp` | `packages/better-auth/src/plugins/two-factor/totp/index.ts:245` |
| 发送 OTP | `POST` | `/two-factor/send-otp` | `packages/better-auth/src/plugins/two-factor/otp/index.ts:179` |
| 校验 OTP | `POST` | `/two-factor/verify-otp` | `packages/better-auth/src/plugins/two-factor/otp/index.ts:241` |
| 生成备份码 | `POST` | `/two-factor/generate-backup-codes` | `packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:435` |
| 校验备份码 | `POST` | `/two-factor/verify-backup-code` | `packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:210` |
| 生成 TOTP 码 | — | **仅服务端**（`createAuthEndpoint.serverOnly`，无 HTTP 路径） | `packages/better-auth/src/plugins/two-factor/totp/index.ts:117` |
| 查看备份码 | — | **仅服务端**（`createAuthEndpoint.serverOnly`，无 HTTP 路径） | `packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:552` |

> `/two-factor/generate` 与 `/two-factor/view-backup-codes` **不是 HTTP 路径**——源码里这两个端点用 `createAuthEndpoint.serverOnly` 定义，没有 `path` 参数，只能通过 `auth.api.generateTOTP` / `auth.api.viewBackupCodes` 在服务端调用（`packages/better-auth/src/plugins/two-factor/totp/index.ts:388-397` 是注释里的历史路径写法）。

**`twoFactor` 表字段（`packages/better-auth/src/plugins/two-factor/schema.ts:14-59`）：**

| 字段 | 类型 | 约束 |
|---|---|---|
| `secret` | string | 必填，不回传，带索引 |
| `backupCodes` | string | 必填，不回传 |
| `userId` | string | 必填，不回传，外键 → `user.id`，带索引 |
| `verified` | boolean | 选填，默认 `true`（迁移期把存量行当作已验证），`input: false` |
| `failedVerificationCount` | number | 选填，默认 `0`，`input: false`，不回传 |
| `lockedUntil` | date | 选填，`input: false`，不回传 |

`user` 表扩展：`twoFactorEnabled`（boolean，选填，默认 `false`，`input: false`）（`packages/better-auth/src/plugins/two-factor/schema.ts:4-13`）。

**账号锁定配置（`packages/better-auth/src/plugins/two-factor/types.ts:69-88`）：**

- `accountLockout.enabled`：默认 `true`。
- `accountLockout.maxFailedAttempts`：默认 `10`。
- `accountLockout.durationSeconds`：默认 `900`（15 分钟）。

常量定义在 `packages/better-auth/src/plugins/two-factor/constant.ts:8-11`：`DEFAULT_ACCOUNT_LOCKOUT_MAX_FAILED_ATTEMPTS = 10`、`DEFAULT_ACCOUNT_LOCKOUT_DURATION_SECONDS = 15 * 60`。

**其他关键默认值：**

- `twoFactorCookieMaxAge`：默认 `600`（10 分钟），控制 2FA 流程的有效期（`packages/better-auth/src/plugins/two-factor/types.ts:55`）。
- `trustDeviceMaxAge`：默认 `2592000`（30 天），常量 `TRUST_DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60`（`packages/better-auth/src/plugins/two-factor/constant.ts:3`）。
- 因子级尝试上限 `DEFAULT_TWO_FACTOR_ALLOWED_ATTEMPTS = 5`（`packages/better-auth/src/plugins/two-factor/constant.ts:6`）。
- 备份码：`amount` 默认 `10`，`length` 默认 `10`，格式为 `XXXXX-XXXXX`（`packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:24-38`、`:63-67`）。
- TOTP：`digits` 为 `6 | 8`，默认 `6`；`period` 默认 `30` 秒（`packages/better-auth/src/plugins/two-factor/totp/index.ts:26-46`）。
- OTP：`period` 默认 `"3 mins"`，`digits` 默认 `6`，`allowedAttempts` 默认 `5`（`packages/better-auth/src/plugins/two-factor/otp/index.ts:32-70`）。
- 备份码默认存储策略为 `"encrypted"`（`packages/better-auth/src/plugins/two-factor/index.ts:127-130`）。
- 插件级限流：`path.startsWith("/two-factor/")` 的请求，窗口 `10` 秒、上限 `3` 次（`packages/better-auth/src/plugins/two-factor/index.ts:681-689`）。
- 启用方法枚举：`method` 取 `"otp"` 或 `"totp"`，默认 `"totp"`（`packages/better-auth/src/plugins/two-factor/index.ts:145-154`）。
- 触发二次验证的登录路径集合：`/sign-in/email`、`/sign-in/username`、`/sign-in/phone-number`（`packages/better-auth/src/plugins/two-factor/index.ts:55-59`）。

**错误码全集（13 个，`packages/better-auth/src/plugins/two-factor/error-code.ts:3-19`）：**

`OTP_NOT_ENABLED`、`OTP_NOT_CONFIGURED`、`OTP_HAS_EXPIRED`、`TOTP_NOT_ENABLED`、`TOTP_ALREADY_ENABLED`、`TOTP_NOT_CONFIGURED`、`TWO_FACTOR_NOT_ENABLED`、`BACKUP_CODES_NOT_ENABLED`、`INVALID_BACKUP_CODE`、`INVALID_CODE`、`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`、`ACCOUNT_TEMPORARILY_LOCKED`、`INVALID_TWO_FACTOR_COOKIE`。

#### 14.2.2 Passkey

独立包 `packages/passkey/`，提供 7 个公开端点：`POST /passkey/generate-register-options`、`POST /passkey/verify-registration`、`POST /passkey/generate-authenticate-options`、`POST /passkey/verify-authentication`、`GET /passkey/list-user-passkeys`、`POST /passkey/delete-passkey`、`POST /passkey/update-passkey`（`packages/passkey/src/routes.ts:221`、`:428`、`:627`、`:882`、`:1082`、`:1149`、`:1225`）。

`passkey` 表字段：`name`（选填）、`publicKey`（必填）、`userId`（必填，外键 → `user.id`，带索引）、`credentialID`（必填，带索引）、`counter`（number，必填）、`deviceType`（必填）、`backedUp`（boolean，必填）、`transports`（选填）、`createdAt`（选填）、`aaguid`（选填）（`packages/passkey/src/schema.ts:3-48`）。

错误码 16 个（`packages/passkey/src/error-codes.ts:3-21`），含 `ORIGIN_NOT_CONFIGURED`、`CHALLENGE_NOT_FOUND`、`YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY`、`FAILED_TO_VERIFY_REGISTRATION`、`PASSKEY_NOT_FOUND`、`AUTHENTICATION_FAILED`、`SESSION_REQUIRED`、`RESOLVE_USER_REQUIRED`、`RESOLVED_USER_INVALID` 等。

#### 14.2.3 SIWE

`siwe` 插件提供 3 个端点：`POST /siwe/nonce`、`POST /siwe/get-nonce`（两条路径同一实现）、`POST /siwe/verify`（`packages/better-auth/src/plugins/siwe/index.ts:94-97`）。

- nonce 存进**校验凭据表**（`verification`），标识符前缀 `siwe:`，有效期 15 分钟（`packages/better-auth/src/plugins/siwe/index.ts:52-85`）。
- nonce 格式校验：长度 8 至 `SIWE_NONCE_MAX_LENGTH`（`255 - "siwe:".length` = 249），仅允许字母数字；不合规则报 `SIWE_INVALID_NONCE` + `INTERNAL_SERVER_ERROR`（`packages/better-auth/src/plugins/siwe/index.ts:57-79`）。
- 核销用 `consumeVerificationValue`——**原子消费**，先到者得，失败尝试也会烧掉记录，同一 nonce 永不可重放（`packages/better-auth/src/plugins/siwe/index.ts:140-157`）。
- 签名消息必须与 nonce、域名、地址、chainId 全部匹配；不匹配报 `UNAUTHORIZED_SIWE_MESSAGE_MISMATCH`（`packages/better-auth/src/plugins/siwe/index.ts:166-197`）。
- `walletAddress` 表字段：`userId`（必填，外键 → `user.id`，带索引）、`address`（必填）、`chainId`（number，必填）、`isPrimary`（boolean，默认 `false`）、`createdAt`（date，必填）（`packages/better-auth/src/plugins/siwe/schema.ts:3-29`）。
- 地址格式：`/^0x[a-fA-F0-9]{40}$/`，长度 42（`packages/better-auth/src/plugins/siwe/index.ts:46-48`）。

#### 14.2.4 Device Authorization

`device-authorization` 插件提供 5 个端点：`POST /device/code`、`GET /device`、`POST /device/approve`、`POST /device/deny`、`POST /device/token`（`packages/better-auth/src/plugins/device-authorization/routes.ts:244`、`:790`、`:913`、`:1037`、`:653`）。

`deviceCode` 表字段：`deviceCode`（必填）、`userCode`（必填）、`userId`（选填）、`expiresAt`（date，必填）、`status`（string，必填）、`lastPolledAt`（date，选填）、`pollingInterval`（number，选填）、`clientId`（string，选填）、`scope`（string，选填）；索引：`deviceCode` 唯一、`userCode` 唯一（`packages/better-auth/src/plugins/device-authorization/schema.ts:6-51`）。

**状态机（`status` 取值）：**

| 状态 | 含义 | 迁移 |
|---|---|---|
| `pending` | 已发放，等待用户批准 | → `approved`（`/device/approve`）或 `denied`（`/device/deny`） |
| `approved` | 用户已批准 | → 兑换后被 `consumeOne` 原子消费（记录被消费） |
| `denied` | 用户已拒绝 | 终态；轮询时记录被删除 |
| `expired` | **不落库**——过期由 `expiresAt < now` 判定，命中即删除记录并报 `EXPIRED_DEVICE_CODE` | — |
| `consumed` | **不落库**——兑换通过 `consumeOne` 原子删除，状态不可见 | — |

> `status` 列实际只持久化三个值 `pending` / `approved` / `denied`（`packages/better-auth/src/plugins/device-authorization/routes.ts:418`、`:1025`、`:1147`；OpenAPI 响应枚举同样只有这三个，`packages/better-auth/src/plugins/device-authorization/routes.ts:823`）。`expired` 与 `consumed` 是**行为**而非落库状态。

**插件选项默认值（`packages/better-auth/src/plugins/device-authorization/index.ts:48-131`）：**

| 选项 | 默认 | 说明 |
|---|---|---|
| `expiresIn` | `"30m"` | 设备码有效期 |
| `interval` | `"5s"` | 建议轮询间隔 |
| `deviceCodeLength` | `40` | 设备码长度，上限 `DEVICE_AUTHORIZATION_CODE_MAX_LENGTH = 191` |
| `userCodeLength` | `8` | 用户码长度，同上限 191 |
| `generateDeviceCode` / `generateUserCode` | 可选 | 自定义码生成器 |
| `validateClient` | 可选 | 客户端 id 校验回调 |
| `onDeviceAuthRequest` | 可选 | 请求钩子 |
| `verificationUri` | 可选 | 验证页 URI，默认 `/device` |

**限流规则：** 仅 `path === "/device"` 的请求受限，窗口为 `ms(opts.expiresIn) / 1000` 秒，上限 `5` 次（`packages/better-auth/src/plugins/device-authorization/index.ts:274-282`）。

**错误码全集（13 个，`packages/better-auth/src/plugins/device-authorization/error-codes.ts:3-20`）：**

`INVALID_DEVICE_CODE`、`EXPIRED_DEVICE_CODE`、`EXPIRED_USER_CODE`、`AUTHORIZATION_PENDING`、`ACCESS_DENIED`、`INVALID_USER_CODE`、`DEVICE_CODE_ALREADY_PROCESSED`、`DEVICE_CODE_NOT_CLAIMED`、`POLLING_TOO_FREQUENTLY`、`USER_NOT_FOUND`、`FAILED_TO_CREATE_SESSION`、`INVALID_DEVICE_CODE_STATUS`、`AUTHENTICATION_REQUIRED`。

#### 14.2.5 One Time Credentials And Alternatives

| 插件 | 端点 | 关键默认 |
|---|---|---|
| `email-otp` | `POST /email-otp/send-verification-otp`、`POST /email-otp/check-verification-otp`、`POST /email-otp/verify-email`、`POST /sign-in/email-otp`、`POST /email-otp/request-password-reset`、`POST /email-otp/reset-password`、`POST /forget-password/email-otp`、`POST /email-otp/request-email-change`、`POST /email-otp/change-email` | `expiresIn`（分钟）、`otpLength`、`allowedAttempts`；错误码 `OTP_EXPIRED` / `INVALID_OTP` / `TOO_MANY_ATTEMPTS` |
| `magic-link` | `POST /sign-in/magic-link`、`GET /magic-link/verify` | 链接一次性消费 |
| `one-time-token` | `POST /one-time-token/generate`、`POST /one-time-token/verify` | `expiresIn` 默认 `3`（分钟）；`disableClientRequest` 只允许服务端发起；`storeToken` 默认 `"plain"` |
| `phone-number` | `POST /sign-in/phone-number`、`POST /phone-number/send-otp`、`POST /phone-number/verify`、`POST /phone-number/request-password-reset`、`POST /phone-number/reset-password` | 14 个错误码，含 `PHONE_NUMBER_NOT_VERIFIED`、`PHONE_NUMBER_PENDING_VERIFICATION`、`PHONE_NUMBER_CANNOT_BE_SET` |

### 14.3 Contract

#### 14.3.1 Two Factor Contract

```ts
/**
 * 二次验证插件选项
 * 取证：packages/better-auth/src/plugins/two-factor/types.ts:8-89
 */
export interface TwoFactorOptions {
	/** 签发 TOTP URI 的发行方名 / Issuer shown in the TOTP URI */
	issuer?: string | undefined;
	/** 存放二次验证数据的表名，默认 "twoFactor" / Table name, default "twoFactor" */
	twoFactorTable?: string | undefined;
	/** TOTP 子插件选项 / TOTP sub-plugin options */
	totpOptions?: Omit<TOTPOptions, "issuer"> | undefined;
	/** OTP 子插件选项 / OTP sub-plugin options */
	otpOptions?: OTPOptions | undefined;
	/** 备份码子插件选项 / Backup code sub-plugin options */
	backupCodeOptions?: BackupCodeOptions | undefined;
	/** 启用时跳过验证，默认 false / Skip verification on enable, default false */
	skipVerificationOnEnable?: boolean | undefined;
	/** 允许无口令账号管理 2FA，默认 false / Allow managing 2FA without a password, default false */
	allowPasswordless?: boolean | undefined;
	/** 自定义表结构 / Custom schema */
	schema?: InferOptionSchema<typeof schema> | undefined;
	/** 2FA 校验 Cookie 的最长寿命（秒），默认 600 / 2FA cookie max age in seconds, default 600 */
	twoFactorCookieMaxAge?: number | undefined;
	/** 信任设备 Cookie 的最长寿命（秒），默认 2592000 / Trust device cookie max age in seconds, default 2592000 */
	trustDeviceMaxAge?: number | undefined;
	/** 账号级锁定 / Account level lockout */
	accountLockout?: {
		/** 是否启用账号级锁定，默认 true / Whether account lockout is enforced, default true */
		enabled?: boolean | undefined;
		/** 连续失败上限（跨挑战与因子），默认 10 / Consecutive failure cap across challenges and factors, default 10 */
		maxFailedAttempts?: number | undefined;
		/** 锁定时长（秒），默认 900 / Lock duration in seconds, default 900 */
		durationSeconds?: number | undefined;
	} | undefined;
}

/**
 * 二次验证档案
 * 取证：packages/better-auth/src/plugins/two-factor/types.ts:104-112
 */
export interface TwoFactorTable {
	id: string;
	userId: string;
	/** TOTP 密钥 / TOTP secret */
	secret: string;
	/** 备份码密文 / Encrypted backup codes */
	backupCodes: string;
	/** 是否已验证过因子 / Whether the factor has been verified */
	verified: boolean;
	/** 连续失败次数 / Consecutive failure count */
	failedVerificationCount?: number;
	/** 锁定截止时间 / Lock deadline */
	lockedUntil?: Date | null;
}

/**
 * 插件向 ctx 暴露的能力
 * 取证：packages/better-auth/src/plugins/two-factor/index.ts:184-196, :691-693
 */
export interface TwoFactorPlugin {
	id: "two-factor";
	/** 本次登录是否仍需第二因子 / Whether this sign-in still requires a second factor */
	shouldRequireTwoFactor(ctx: GenericEndpointContext): Promise<boolean>;
}
```

#### 14.3.2 Device Authorization Contract

```ts
/**
 * 设备授权选项
 * 取证：packages/better-auth/src/plugins/device-authorization/index.ts:48-135
 */
export interface DeviceAuthorizationOptions {
	/** 设备码有效期，默认 "30m" / Device code lifetime, default "30m" */
	expiresIn: TimeString;
	/** 建议轮询间隔，默认 "5s" / Suggested polling interval, default "5s" */
	interval: TimeString;
	/** 设备码长度，默认 40，上限 191 / Device code length, default 40, max 191 */
	deviceCodeLength: number;
	/** 用户码长度，默认 8，上限 191 / User code length, default 8, max 191 */
	userCodeLength: number;
	/** 自定义设备码生成器 / Custom device code generator */
	generateDeviceCode?: () => string | Promise<string>;
	/** 自定义用户码生成器 / Custom user code generator */
	generateUserCode?: () => string | Promise<string>;
	/** 客户端 id 校验回调 / Client id validation callback */
	validateClient?: (clientId: string) => boolean | Promise<boolean>;
	/** 设备授权请求钩子 / Device authorization request hook */
	onDeviceAuthRequest?: (clientId: string, scope: string | undefined) => void | Promise<void>;
	/** 验证页 URI，默认 "/device" / Verification URI, default "/device" */
	verificationUri?: string;
	/** 自定义表结构 / Custom schema */
	schema?: InferOptionSchema<typeof schema> | undefined;
}

/**
 * 设备码记录
 * 取证：packages/better-auth/src/plugins/device-authorization/schema.ts:53-66
 */
export interface DeviceCode {
	id: string;
	deviceCode: string;
	userCode: string;
	userId?: string;
	expiresAt: Date;
	/** 落库状态：pending | approved | denied */
	status: string;
	lastPolledAt?: Date;
	pollingInterval?: number;
	clientId?: string;
	scope?: string;
}
```

#### 14.3.3 SIWE And Passkey Contract

```ts
/**
 * SIWE 插件选项
 * 取证：packages/better-auth/src/plugins/siwe/index.ts:32-41
 */
export interface SIWEPluginOptions {
	/** 期望的 SIWE 域名 / Expected SIWE domain */
	domain: string;
	/** 派生邮箱的域名后缀 / Domain suffix for derived emails */
	emailDomainName?: string | undefined;
	/** 是否允许匿名登录，默认 true / Whether anonymous sign-in is allowed */
	anonymous?: boolean | undefined;
	/** 生成 ERC-4361 nonce；必须返回 8-249 位字母数字串 / Mint an ERC-4361 nonce */
	getNonce: () => Promise<string>;
	/** 校验签名 / Verify the signature */
	verifyMessage: (args: SIWEVerifyMessageArgs) => Promise<boolean>;
	/** ENS 解析 / ENS resolution */
	ensLookup?: ((args: ENSLookupArgs) => Promise<ENSLookupResult>) | undefined;
	/** 自定义表结构 / Custom schema */
	schema?: InferOptionSchema<typeof schema> | undefined;
}

/**
 * 钱包地址记录
 * 取证：packages/better-auth/src/plugins/siwe/schema.ts:3-29
 */
export interface WalletAddress {
	userId: string;
	/** 以太坊地址 / Ethereum address */
	address: string;
	/** 链 id / Chain id */
	chainId: number;
	/** 是否为主地址，默认 false / Whether this is the primary address, default false */
	isPrimary: boolean;
	createdAt: Date;
}
```

#### 14.3.4 Verification Helper Contract

```ts
/**
 * 账号级锁定的判定与记账辅助
 * 取证：packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:244-327
 */
export interface AccountLockoutGuard {
	/** 账号已锁 → 抛 TOO_MANY_REQUESTS + ACCOUNT_TEMPORARILY_LOCKED；锁已过期则顺手清零 */
	assertTwoFactorNotLocked(
		ctx: GenericEndpointContext,
		twoFactorTable: string,
		twoFactor: TwoFactorTable,
	): Promise<void>;

	/** 记一次失败；计数达到上限时原子写入 lockedUntil */
	recordTwoFactorFailure(
		ctx: GenericEndpointContext,
		twoFactorTable: string,
		twoFactor: TwoFactorTable,
	): Promise<void>;

	/** 校验成功后清零失败计数与锁定（无条件写，避免漏掉并发失败） */
	resetTwoFactorFailures(
		ctx: GenericEndpointContext,
		twoFactorTable: string,
		twoFactor: TwoFactorTable,
	): Promise<void>;
}
```

### 14.4 Flow

以下伪代码表达强认证域两条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 14.4.1 Two Factor Verification And Lockout

```ts
// 一次二次验证提交的完整判定链路
// 取证：packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:224-327
async function verifyFactor(
	ctx: GenericEndpointContext,
	twoFactorTable: string,
	twoFactor: TwoFactorTable,
	attempt: { validate: () => Promise<boolean> },
): Promise<void> {
	const { enabled, maxFailedAttempts, durationMs } = resolveAccountLockoutConfig(ctx);

	// 步骤一：账号是否处于锁定期
	if (enabled && twoFactor.lockedUntil) {
		const lockedUntil = new Date(twoFactor.lockedUntil);
		// 分支一：锁未到期 → TOO_MANY_REQUESTS + ACCOUNT_TEMPORARILY_LOCKED
		if (lockedUntil.getTime() > Date.now()) {
			throw APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
		}
		// 分支二：锁已过期 → 惰性清零；写操作带 "lockedUntil <= now" 守卫，
		//        避免把并发请求刚设置的锁抹掉
		await ctx.context.adapter.incrementOne({
			model: twoFactorTable,
			where: [
				{ field: "id", value: twoFactor.id },
				{ field: "lockedUntil", operator: "lte", value: new Date() },
			],
			increment: {},
			set: { failedVerificationCount: 0, lockedUntil: null },
		});
	}

	// 步骤二：校验因子码
	try {
		const ok = await attempt.validate();
		// 分支三：校验通过 → 清零失败计数（无条件写），签发会话
		if (ok) {
			await resetTwoFactorFailures(ctx, twoFactorTable, twoFactor);
			return;
		}
	} catch (err) {
		// 分支四：校验过程中出错 → 归还本次占用的尝试额度，再把异常上抛
		await attempt.restore();
		throw err;
	}

	// 分支五：校验不通过 → 记一次失败；达到上限即锁定
	await recordTwoFactorFailure(ctx, twoFactorTable, twoFactor);
	throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.INVALID_CODE);
}

/**
 * 失败记账：原子自增，跨因子、跨挑战累计
 * 取证：packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:279-307
 */
async function recordTwoFactorFailure(
	ctx: GenericEndpointContext,
	twoFactorTable: string,
	twoFactor: TwoFactorTable,
): Promise<void> {
	const { enabled, maxFailedAttempts, durationMs } = resolveAccountLockoutConfig(ctx);
	// 分支一：锁定被关闭 → 不记账
	if (!enabled) return;
	// 自增无条件执行：行在迁移前创建、计数列为空时，带守卫的比较永远不匹配，
	// 那样失败就永远记不上账
	const updated = await ctx.context.adapter.incrementOne<TwoFactorTable>({
		model: twoFactorTable,
		where: [{ field: "id", value: twoFactor.id }],
		increment: { failedVerificationCount: 1 },
	});
	// 分支二：达到上限 → 原子写入 lockedUntil
	if ((updated?.failedVerificationCount ?? 0) >= maxFailedAttempts) {
		await ctx.context.adapter.incrementOne({
			model: twoFactorTable,
			where: [
				{ field: "id", value: twoFactor.id },
				{ field: "failedVerificationCount", operator: "gte", value: maxFailedAttempts },
			],
			increment: {},
			set: { lockedUntil: new Date(Date.now() + durationMs) },
		});
	}
}
```

失败分支清单：账号在锁定期 → `TOO_MANY_REQUESTS` + `ACCOUNT_TEMPORARILY_LOCKED`；锁已过期 → 惰性清零后继续；因子码错误 → 记一次失败并抛 `INVALID_CODE`；校验过程抛错 → 归还尝试额度后原样上抛；连续失败达上限 → 写入 `lockedUntil`，后续请求一律被拒；校验成功 → 清零失败计数（无条件写）。

#### 14.4.2 Trust Device Decision

```ts
// 登录时是否还需要第二因子
// 取证：packages/better-auth/src/plugins/two-factor/index.ts:55-118
async function readSignInTwoFactorState(
	ctx: GenericEndpointContext,
	trustDeviceMaxAge: number,
): Promise<{ requiresTwoFactor: boolean; trustDeviceCookie: string | null }> {
	const data = ctx.context.newSession;

	// 分支一：不在受管登录路径上，或该用户未启用二次验证 → 不需要第二因子
	if (!signInPaths.has(ctx.path) || !data?.user.twoFactorEnabled) {
		return { requiresTwoFactor: false, trustDeviceCookie: null };
	}

	const cookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: trustDeviceMaxAge });
	const trustDeviceCookie = await ctx.getSignedCookie(cookie.name, ctx.context.secret);

	// 分支二：没有信任设备 Cookie → 需要第二因子
	if (!trustDeviceCookie) {
		return { requiresTwoFactor: true, trustDeviceCookie };
	}

	const [token, trustIdentifier] = trustDeviceCookie.split("!");
	// 分支三：Cookie 格式不对 → 需要第二因子
	if (!token || !trustIdentifier) {
		return { requiresTwoFactor: true, trustDeviceCookie };
	}

	// 分支四：HMAC 不匹配 → Cookie 被篡改或属于别的用户 → 需要第二因子
	const expectedToken = await createHMAC("SHA-256", "base64urlnopad")
		.sign(ctx.context.secret, `${data.user.id}!${trustIdentifier}`);
	if (token !== expectedToken) {
		return { requiresTwoFactor: true, trustDeviceCookie };
	}

	// 分支五：HMAC 有效，但还要查服务端记录：
	//        记录不存在 / 记录的 value 不是当前用户 / 记录已过期 → 仍需要第二因子
	const verificationRecord = await ctx.context.internalAdapter.findVerificationValue(trustIdentifier);
	return {
		requiresTwoFactor:
			!verificationRecord ||
			verificationRecord.value !== data.user.id ||
			!(verificationRecord.expiresAt > new Date()),
		trustDeviceCookie,
	};
}
```

失败分支清单：不在受管登录路径 → 不需要第二因子；用户未启用二次验证 → 不需要第二因子；无信任 Cookie / Cookie 格式错误 / HMAC 不匹配 / 服务端记录缺失 / 记录归属他人 / 记录已过期 → **一律仍需要第二因子**（fail closed）。

#### 14.4.3 Device Authorization Flow

```ts
// 受限设备授权码的完整生命周期
// 取证：packages/better-auth/src/plugins/device-authorization/routes.ts
async function deviceCode(ctx: GenericEndpointContext): Promise<DeviceCodeResponse> {
	// 分支一：客户端 id 校验失败 → 拒绝发放
	if (opts.validateClient && !(await opts.validateClient(ctx.body.client_id ?? ""))) {
		throw new APIError("BAD_REQUEST", { error: "invalid_client", ... });
	}
	// 分支二：超出限流（路径 /device，窗口 = expiresIn 秒，上限 5 次）→ 限流插件拒绝
	// 生成 device_code 与 user_code，落库 status = "pending"
	await ctx.context.adapter.create({
		model: "deviceCode",
		data: {
			deviceCode, userCode, status: "pending",
			expiresAt: new Date(Date.now() + ms(opts.expiresIn)),
			pollingInterval: ms(opts.interval) / 1000,
			clientId: ctx.body.client_id, scope: ctx.body.scope,
		},
	});
	return { device_code, user_code, verification_uri, expires_in, interval };
}

async function deviceApprove(ctx: GenericEndpointContext): Promise<void> {
	// 分支一：设备码未被已登录会话认领 → DEVICE_CODE_NOT_CLAIMED
	//        （必须先以 GET /device 带 user_code 认领，再批准或拒绝）
	// 分支二：状态不是 pending → DEVICE_CODE_ALREADY_PROCESSED
	// 成功路径：原子更新 status = "approved" 并写入 userId
	await ctx.context.adapter.update({
		model: "deviceCode",
		where: [{ field: "id", value: record.id }, { field: "status", value: "pending" }],
		update: { status: "approved", userId: ctx.context.session.user.id },
	});
}

async function deviceToken(ctx: GenericEndpointContext): Promise<TokenResponse> {
	const record = await findDeviceCode(ctx.body.device_code);

	// 分支一：设备码不存在 → INVALID_DEVICE_CODE
	// 分支二：已过期（expiresAt < now）→ 删除记录 + EXPIRED_DEVICE_CODE
	if (record.expiresAt < new Date()) {
		await ctx.context.adapter.delete({ model: "deviceCode", where: [{ field: "id", value: record.id }] });
		throw new APIError("BAD_REQUEST", { error: "expired_token", ... });
	}
	// 分支三：仍待批准 → AUTHORIZATION_PENDING（客户端应继续轮询）
	if (record.status === "pending") {
		throw new APIError("BAD_REQUEST", { error: "authorization_pending", ... });
	}
	// 分支四：被拒绝 → 删除记录 + ACCESS_DENIED
	if (record.status === "denied") {
		await ctx.context.adapter.delete({ model: "deviceCode", where: [{ field: "id", value: record.id }] });
		throw new APIError("BAD_REQUEST", { error: "access_denied", ... });
	}
	// 分支五：状态非 approved 或没有 userId → INTERNAL_SERVER_ERROR + INVALID_DEVICE_CODE_STATUS
	if (record.status !== "approved" || !record.userId) {
		throw new APIError("INTERNAL_SERVER_ERROR", { error: "server_error", ... });
	}

	// 步骤：所有可失败的校验与查询都放在破坏性认领之前
	const user = await ctx.context.internalAdapter.findUserById(record.userId);
	// 分支六：用户已被删除 → INTERNAL_SERVER_ERROR + USER_NOT_FOUND
	if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { error: "server_error", ... });

	// 步骤：原子认领（consumeOne）—— 并发轮询不会各自发出一个令牌
	const claimed = await ctx.context.adapter.consumeOne<DeviceCode>({
		model: "deviceCode",
		where: [
			{ field: "id", value: record.id },
			authorization.ownershipWhere,
			{ field: "status", value: "approved" },
		],
	});
	// 分支七：认领失败（已被别的轮询消费）→ INVALID_DEVICE_CODE
	if (!claimed?.userId) {
		throw new APIError("BAD_REQUEST", { error: "invalid_grant", ... });
	}

	// 步骤：签发凭据副作用放在认领之后，保证同码不会发出两份凭据
	return issueCredentials(claimed, user);
}
```

失败分支清单：客户端校验失败 → 拒绝发放；超限流 → 限流拒绝；设备码不存在 → `INVALID_DEVICE_CODE`；已过期 → 删记录并报 `EXPIRED_DEVICE_CODE`；待批准 → `AUTHORIZATION_PENDING`（继续轮询）；被拒 → 删记录并报 `ACCESS_DENIED`；状态异常 → `INVALID_DEVICE_CODE_STATUS`；用户已删除 → `USER_NOT_FOUND`；并发认领失败 → `INVALID_DEVICE_CODE`（幂等，不重复签发）。

#### 14.4.4 SIWE Nonce Lifecycle

```ts
// SIWE nonce 的发放与原子核销
// 取证：packages/better-auth/src/plugins/siwe/index.ts:62-200
async function issueNonce(ctx: GenericEndpointContext): Promise<{ nonce: string }> {
	const nonce = await options.getNonce();
	// 分支一：nonce 不符合 ERC-4361 格式 → SIWE_INVALID_NONCE + INTERNAL_SERVER_ERROR
	if (!isValidSiweNonce(nonce)) {
		throw APIError.fromStatus("INTERNAL_SERVER_ERROR", {
			message: `SIWE getNonce must return an ERC-4361 nonce: 8-${SIWE_NONCE_MAX_LENGTH} alphanumeric characters.`,
			status: 500, code: "SIWE_INVALID_NONCE",
		});
	}
	// 落库到校验凭据表，标识符带 "siwe:" 前缀，有效期 15 分钟
	await ctx.context.internalAdapter.createVerificationValue({
		identifier: `siwe:${nonce}`, value: nonce,
		expiresAt: new Date(Date.now() + 15 * 60 * 1000),
	});
	return { nonce };
}

async function verifySiweMessage(ctx: GenericEndpointContext): Promise<Session> {
	// 分支一：关闭匿名登录但未提供 email → BAD_REQUEST
	if (!isAnon && !email) {
		throw APIError.fromStatus("BAD_REQUEST", { message: "Email is required when anonymous is disabled.", status: 400 });
	}
	const parsedMessage = parseSiweMessage(message);
	// 分支二：消息里的 nonce 格式非法 → UNAUTHORIZED
	if (!isValidSiweNonce(parsedMessage.nonce)) { throw UNAUTHORIZED(); }

	// 步骤：在任何签名校验与状态变更之前原子核销 nonce
	//       先到者得，并发者全部拿到 null → 同一 nonce 永不可重放
	//       在这里核销（而不是验签之后）意味着失败尝试也会烧掉记录
	const verification = await ctx.context.internalAdapter.consumeVerificationValue(`siwe:${parsedMessage.nonce}`);
	// 分支三：nonce 不存在或已过期 → UNAUTHORIZED_INVALID_OR_EXPIRED_NONCE
	if (!verification) {
		throw APIError.fromStatus("UNAUTHORIZED", {
			message: "Unauthorized: Invalid or expired nonce", status: 401,
			code: "UNAUTHORIZED_INVALID_OR_EXPIRED_NONCE",
		});
	}

	// 步骤：把签名消息与服务端状态绑定
	//       仅靠签名恢复（viem 的 verifyMessage）不够——它不检查消息体，
	//       旧签名可以被拿来配新 nonce 使用
	const walletAddress = signedWalletAddressSchema.safeParse(parsedMessage.address);
	const chainId = parsedMessage.chainId;
	const domainMatches = !!parsedMessage.domain &&
		normalizeSiweDomain(parsedMessage.domain) === normalizeSiweDomain(options.domain);
	// 分支四：地址格式非法 / chainId 非法 / 域名不匹配 → UNAUTHORIZED_SIWE_MESSAGE_MISMATCH
	if (!walletAddress.success || typeof chainId !== "number" || chainId <= 0 || !domainMatches) {
		throw APIError.fromStatus("UNAUTHORIZED", {
			message: "Unauthorized: SIWE message does not match the expected nonce, domain, address, or chain ID",
			status: 401, code: "UNAUTHORIZED_SIWE_MESSAGE_MISMATCH",
		});
	}
	// 分支五：消息自带过期时间且已过 → UNAUTHORIZED（消息已过期）
	if (parsedMessage.expirationTime) { /* ... */ }
	// 分支六：签名校验不通过 → UNAUTHORIZED
	// 成功路径：写入 walletAddress 记录（upsert），签发会话
	return issueSession(walletAddress.data, chainId, email);
}
```

失败分支清单：nonce 格式非法 → `SIWE_INVALID_NONCE` + 500；关闭匿名且缺 email → 400；消息 nonce 非法 → 401；nonce 不存在或过期 → `UNAUTHORIZED_INVALID_OR_EXPIRED_NONCE`；地址 / chainId / 域名不匹配 → `UNAUTHORIZED_SIWE_MESSAGE_MISMATCH`；消息已过期 → 401；签名校验失败 → 401。核销发生在验签之前，失败尝试同样消耗 nonce。

### 14.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-14-01 | 用户已登录，启用 two-factor 插件，`totpOptions` 未禁用 | 调用 `POST /two-factor/enable`，body 为 `{ password: "<口令>", method: "totp" }` | 返回 TOTP URI 与备份码；`twoFactor` 表新增一行且 `verified` 为 `false`；`user.twoFactorEnabled` 变为 `true`；重复启用已启用的 TOTP 返回 `TOTP_ALREADY_ENABLED` |
| ACC-14-02 | 用户已启用 TOTP 且 `verified` 为 `true` | 连续 10 次提交错误的 TOTP 码 | 前 9 次返回 `INVALID_CODE`；第 10 次起返回 `TOO_MANY_REQUESTS` + `ACCOUNT_TEMPORARILY_LOCKED`；`twoFactor.lockedUntil` 被写入；锁定期内即使提交**正确**的码也被拒 |
| ACC-14-03 | 用户因连续失败被锁定，`durationSeconds` 为 900 | 等待锁定期过后提交正确的 TOTP 码 | 首次请求惰性清零（`failedVerificationCount` 归零、`lockedUntil` 置空）并通过校验；不需要手工干预 |
| ACC-14-04 | 用户已启用二次验证，未信任过任何设备 | 以 `POST /sign-in/email` 登录 | 响应返回 `twoFactorRedirect: true` 与 `twoFactorMethods`（含 `totp`）；`auth.api` 的 `shouldRequireTwoFactor(ctx)` 返回 `true` |
| ACC-14-05 | 用户已启用二次验证，并在一次成功校验后勾选"信任此设备" | 退出后重新以 `POST /sign-in/email` 登录 | 登录不再要求第二因子；`shouldRequireTwoFactor(ctx)` 返回 `false`；篡改 `trust_device` Cookie 后再次登录则**重新要求**第二因子 |
| ACC-14-06 | 客户端已拿到 `device_code` 与 `user_code`，用户尚未在浏览器端批准 | 反复调用 `POST /device/token` | 在用户批准前每次返回 `error: "authorization_pending"`；用户在浏览器批准后再次调用，返回访问令牌；同一 `device_code` 再次调用返回 `invalid_grant`——**并发轮询不会发出两份凭据** |
| ACC-14-07 | 客户端持有的 `device_code` 已超过 `expiresIn`（默认 30 分钟） | 调用 `POST /device/token` | 返回 `error: "expired_token"`，`error_description` 为 `Device code has expired`；`deviceCode` 表中该记录被删除 |
| ACC-14-08 | 已调用 `POST /siwe/nonce` 拿到 nonce | 用同一个 nonce 并发发起两次 `POST /siwe/verify` | 有且只有一次成功；另一次返回 401 且 `code` 为 `UNAUTHORIZED_INVALID_OR_EXPIRED_NONCE`；`walletAddress` 表中只新增一条记录 |
| ACC-14-09 | 已调用 `POST /siwe/nonce` 拿到 nonce，但签名消息里的 domain 与插件配置的 `domain` 不一致 | 调用 `POST /siwe/verify` | 返回 401，`code` 为 `UNAUTHORIZED_SIWE_MESSAGE_MISMATCH`；不创建会话；**nonce 已被消费**（再次用同一 nonce 直接返回 nonce 无效） |

### 14.6 Known Caveats

- `/two-factor/generate` 与 `/two-factor/view-backup-codes` **不是 HTTP 路径**：源码用 `createAuthEndpoint.serverOnly` 定义这两个端点，没有 `path` 参数，只能服务端调用（`packages/better-auth/src/plugins/two-factor/totp/index.ts:117`、`:388-397` 是历史路径的注释写法；`packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:552`）。
- `twoFactor` 表的 `status` 不存在；该表只有 `verified` 布尔位与 `failedVerificationCount` / `lockedUntil` 两个计数/时间字段（`packages/better-auth/src/plugins/two-factor/schema.ts:14-59`）。
- 设备码的 `status` 列**只持久化三个值** `pending` / `approved` / `denied`；`expired` 与 `consumed` 是行为而非落库状态——过期时记录被删除，兑换时通过 `consumeOne` 原子消费（`packages/better-auth/src/plugins/device-authorization/routes.ts:564-575`、`:615-635`）。
- 设备授权的限流只覆盖 `path === "/device"`（精确相等），`/device/code` 与 `/device/token` **不受**该规则约束（`packages/better-auth/src/plugins/device-authorization/index.ts:274-282`）。
- `twoFactor.verified` 字段的默认值是 `true`（不是 `false`），目的是让迁移前的存量行被当作已验证；新行由 `enableTwoFactor` 显式写 `false`（`packages/better-auth/src/plugins/two-factor/schema.ts:37-44` 的注释明确说明）。
- 账号级锁定是**跨挑战、跨因子**累计的：TOTP 失败会消耗 OTP 的预算，反之亦然（`packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:239-243` 的注释引用 NIST SP 800-63B §5.2.2）。
- `failedVerificationCount` 的自增是**无条件**的（不带守卫），而 `lockedUntil` 的清零是**带守卫**的——这是刻意的不对称（`packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:271-280`、`:258-268`）。
- SIWE 插件要求 `options.getNonce` 返回的 nonce 必须符合 ERC-4361 格式（8–249 位字母数字），否则发放端点直接 500（`packages/better-auth/src/plugins/siwe/index.ts:57-79`）。
- SIWE 的 nonce 在**验签之前**被核销，因此一次失败的验证尝试也会消耗掉该 nonce（`packages/better-auth/src/plugins/siwe/index.ts:140-157` 的注释明确说明）。
- 2FA 插件的因子级尝试上限 `DEFAULT_TWO_FACTOR_ALLOWED_ATTEMPTS = 5` 目前是**硬编码常量**，源码里带有 `TODO(totp-attempt-cap)` 标记，尚未接入账号级预算（`packages/better-auth/src/plugins/two-factor/constant.ts:5-6`）。
