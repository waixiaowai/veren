---
title: 诊断域
description: 为认证运行时提供错误码体系、错误页、日志器、遥测与链路埋点的可观测性设计。
sidebar:
  order: 14
  label: 诊断域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 12. Diagnostics

诊断域是**外围域**。它为认证运行时提供一套稳定的错误码体系、结构化错误对象、内建错误页、日志器、遥测通道与链路埋点；**它不承担认证判定职责，移除后核心链路完整**——所有错误仍会以 HTTP 状态码与响应体正常返回，只是失去机器可读的错误码、错误页与可观测性信号。

诊断域与相邻模块的分界是：**诊断域只观察与表达失败，不裁决失败**。它不决定"这个凭据是否有效"（那是 [凭证域](./04-credential/) 与 [身份域](./05-identity/) 的职责），不决定"这次请求能否通过"（那是 [守卫域](./07-guard/) 的职责），也不改变任何状态机迁移（见 [状态模型](../states/)）。它与 [存储域](./08-storage/) 的边界尤其明确：诊断域**读取**数据库结构类错误的文本用于降噪，但**从不**修复结构；结构修复是 [命令行域](./11-cli/) 的 `migrate` / `generate` 的职责。它与 [端点路由域](./02-endpoint/) 的边界是：诊断域**消费**端点抛出的错误，端点路由域**不感知**诊断域的存在。错误码的完整对照表在 [错误码总表](../errors/)；端点的完整契约在 [接口总表](../api/)；本域在整体中的位置见 [总体方案与架构](../architecture/)。

### 12.1 Responsibility Boundary

**诊断域负责：**

- 定义基础错误码全集 `BASE_ERROR_CODES`（`packages/core/src/error/codes.ts:17-71`），并向插件暴露统一的错误码贡献通道 `$ERROR_CODES`。
- 定义 `APIError` 与 `RawError` 两个错误抽象：前者是运行时可抛出的错误，后者是错误码的字面量载体（`packages/core/src/error/index.ts:17-54`、`packages/core/src/utils/error-codes.ts:47-50`）。
- 提供内建错误页 `/error`：读取 `error` 与 `error_description` 查询参数，渲染内建 HTML（`packages/better-auth/src/api/routes/error.ts:374-445`）。
- 提供健康检查端点 `/ok`（`packages/better-auth/src/api/routes/ok.ts:4-39`）。
- 提供统一错误出口 `onError`：决定抛出、回调、打印或降噪（`packages/better-auth/src/api/index.ts:355-409`）。
- 提供日志器契约 `Logger` 与 `createLogger`，含级别过滤与颜色开关（`packages/core/src/env/logger.ts:47-58`、`:97-145`）。
- 提供遥测通道 `createTelemetry`（默认关闭，`packages/telemetry/src/index.ts:19-70`）。
- 提供 OpenTelemetry 埋点属性与 tracer 封装（`packages/core/src/instrumentation/`）。

**诊断域不负责（明确拒绝承担的职责）：**

- 不裁决认证结果：错误码是失败的**表达**，不是失败的**判定**。`INVALID_EMAIL_OR_PASSWORD` 只在 [凭证域](./04-credential/) 判定完失败之后才被抛出。
- 不吞掉错误：`onError` 的降噪只针对**数据库结构类错误文本**（`no column` / `column` / `relation` / `table` / `does not exist`），其余错误一律照常打印或抛出（`packages/better-auth/src/api/index.ts:385-395`）。
- 不做数据库迁移：结构错误只被记录，不被修复。
- 不代替应用错误处理：`options.onAPIError.onError` 一旦提供，就完全接管错误处理，框架不再打印（`packages/better-auth/src/api/index.ts:362-369`）。
- 不发送默认遥测：无显式开启时 `createTelemetry` 返回 `noop` 发布函数（`packages/telemetry/src/index.ts:27-32`）。

**失败语义的统一约定：**

| 情形 | 表现 | 语义 |
|---|---|---|
| 抛出 `APIError` | 响应体为 `{ code, message }`，`cause` 不入序列化体 | 业务可预期失败，机器可读 |
| `status === "FOUND"` | `onError` 直接返回，不打印 | 重定向类响应，不是失败 |
| `onAPIError.throw === true` | 原样抛出到宿主 | 宿主自行兜底 |
| 提供 `onAPIError.onError` | 回调接管；回调自身抛错只记 `error` 日志 | 宿主完全掌控 |
| 结构类错误文本 | 只打一条 `error` 日志后返回 | 降噪，不重复喷日志 |
| 错误码不匹配 `^['A-Za-z0-9_-]+$` | 错误页回落为 `UNKNOWN` | 防止注入 |

### 12.2 Capability Inventory

**基础错误码全集（49 个，取证 `packages/core/src/error/codes.ts:17-71`）：**

| 分类 | 错误码 |
|---|---|
| 主体与账号（12） | `USER_NOT_FOUND`、`FAILED_TO_CREATE_USER`、`FAILED_TO_UPDATE_USER`、`FAILED_TO_GET_SESSION`、`INVALID_USER`、`USER_EMAIL_NOT_FOUND`、`USER_ALREADY_EXISTS`、`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`、`USER_ALREADY_HAS_PASSWORD`、`ACCOUNT_NOT_FOUND`、`CREDENTIAL_ACCOUNT_NOT_FOUND`、`LINKED_ACCOUNT_ALREADY_EXISTS` |
| 凭据校验（6） | `INVALID_PASSWORD`、`INVALID_EMAIL`、`INVALID_EMAIL_OR_PASSWORD`、`PASSWORD_TOO_SHORT`、`PASSWORD_TOO_LONG`、`PASSWORD_ALREADY_SET` |
| 会话（3） | `FAILED_TO_CREATE_SESSION`、`SESSION_EXPIRED`、`SESSION_NOT_FRESH` |
| 令牌与校验凭据（5） | `INVALID_TOKEN`、`TOKEN_EXPIRED`、`ID_TOKEN_NOT_SUPPORTED`、`FAILED_TO_CREATE_VERIFICATION`、`FAILED_TO_GET_USER_INFO` |
| 邮箱（5） | `EMAIL_NOT_VERIFIED`、`EMAIL_ALREADY_VERIFIED`、`EMAIL_MISMATCH`、`EMAIL_CAN_NOT_BE_UPDATED`、`CHANGE_EMAIL_DISABLED` |
| 社交与联动（3） | `SOCIAL_ACCOUNT_ALREADY_LINKED`、`PROVIDER_NOT_FOUND`、`FAILED_TO_UNLINK_LAST_ACCOUNT` |
| 校验与请求体（8） | `VALIDATION_ERROR`、`MISSING_FIELD`、`FIELD_NOT_ALLOWED`、`ASYNC_VALIDATION_NOT_SUPPORTED`、`BODY_MUST_BE_AN_OBJECT`、`CALLBACK_URL_REQUIRED`、`METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED`、`VERIFICATION_EMAIL_NOT_ENABLED` |
| 来源与重定向（7） | `INVALID_ORIGIN`、`MISSING_OR_NULL_ORIGIN`、`CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`、`INVALID_CALLBACK_URL`、`INVALID_REDIRECT_URL`、`INVALID_ERROR_CALLBACK_URL`、`INVALID_NEW_USER_CALLBACK_URL` |

> 完整表（含每个码的精确 message 文本）在 [错误码总表](../errors/)；本章只给分类概览。

**错误对象与码机制：**

- `APIError` 继承自 `better-call` 的 `APIError`，重声明 `status` / `body` / `headers` / `statusCode` / `message` / `errorStack`（`packages/core/src/error/index.ts:17-34`）。
- `APIError.fromStatus(status, body?)` 与 `APIError.from(status, error: RawError, options?: ErrorOptions)` 两个静态工厂（`packages/core/src/error/index.ts:29-53`）。`from` 在 `options.cause === undefined` 时构造只含 `code` / `message` 的 body；给了 `cause` 才带上 `cause` 字段——**序列化后 `cause` 不出现在 body 里**（`packages/core/src/error/index.test.ts:11-26`）。
- `defineErrorCodes` 在**类型层**强制键名只能是大写字母与下划线；违规键的编译期错误信息为 Invalid error code key 提示且要求键名只含大写字母与下划线（`packages/core/src/utils/error-codes.ts:1-45`）。运行时返回的对象每一项形如 `{ code, message, toString: () => key }`（`:58-67`）。
- `BetterAuthError` 用于非 API 层的配置错误，`stack` 被置空字符串以免泄漏内部结构（`packages/core/src/error/index.ts:4-11`）。
- 插件通过插件对象的 `$ERROR_CODES` 字段贡献自己的码集；框架侧以 declaration merging 声明在 `BetterAuthPluginRegistry` 上（`packages/core/src/error/codes.ts:4-15`，插件侧实例见 `packages/better-auth/src/plugins/organization/organization.ts:107`）。

**内建错误页：**

- 端点 `GET /error`，元数据 `HIDE_METADATA`（即 `scope: "server"`，`packages/better-auth/src/utils/hide-metadata.ts:1-3`）。
- 读 `error` 查询参数（缺省为 `"UNKNOWN"`）与 `error_description` 查询参数（缺省 `null`）（`packages/better-auth/src/api/routes/error.ts:399-402`）。
- 错误码必须匹配正则 `^['A-Za-z0-9_-]+$`（注意字符类里含一个单引号），否则回落为 `"UNKNOWN"`（`:404-405`）。
- `error_description` 经 `sanitize()` 做 HTML 转义：依次转义 `<`、`>`、`"`、`'`，最后把**不是**已有实体的 `&` 转成 `&amp;`（`:7-16`）。
- 重定向优先级：`options.onAPIError.errorURL` 存在 → 302 到该 URL 并附加 `error` / `error_description` 查询参数；否则若 `isProduction` 且**未**设置 `customizeDefaultErrorPage` → 302 到 `/?<params>`；否则返回内建 HTML（`:416-444`）。
- `customizeDefaultErrorPage` 提供 `colors`（12 个色位）、`size`（7 个尺寸位）、`font`（2 个字体位）、`disableTitleBorder`、`disableCornerDecorations`、`disableBackgroundGrid` 三个布尔开关（`packages/core/src/types/init-options.ts:1756-1787`）。**只要设置了该对象（含仅设置三档开关之一），生产环境的 302 重定向即被取消**（`packages/better-auth/src/api/routes/error.ts:430`）。

**错误出口：**

- `onError` 先判 `isAPIError(e) && e.status === "FOUND"` → 直接 `return`，**不打印、不抛出**（`packages/better-auth/src/api/index.ts:356-358`）。
- `options.onAPIError?.throw` 为真 → 原样 `throw e`（`:359-361`）。
- `options.onAPIError?.onError` 存在 → `await` 调用；该回调自身抛错只记 `ctx.logger.error("onAPIError.onError threw", hookError)`，不再向上冒泡（`:362-369`）。
- 否则走默认打印路径：结构类错误文本只打一条 `error` 日志；`APIError` 且 `status === "INTERNAL_SERVER_ERROR"` 额外打 `ctx.logger.error(e.status, e)`；非 `APIError` 打 `(e.name, e)`（`:371-408`）。

**日志器：**

- `Logger` 契约：`disabled` / `disableColors` / `level`（除 `success` 外的日志级别）/ `log`（自定义 sink）（`packages/core/src/env/logger.ts:47-58`）。
- `LogLevel` 枚举为 `"debug" | "info" | "success" | "warn" | "error"`；`shouldPublishLog` 用索引比较决定是否输出（`:36-45`）。
- `createLogger` 默认 `disabled !== true` 且 `level` 默认 `"warn"`；未显式指定 `disableColors` 时按 `getColorDepth() !== 1` 推断（`:97-105`）。
- 未提供 `log` 时按级别分流到 `console.error` / `console.warn` / `console.log`（`:117-126`）。
- 模块级 `logger` 代理到**当前请求上下文**的 logger（`__getCurrentEndpointContext`），使插件能拿到请求级配置（`:149-166`）。

**遥测与埋点：**

- `createTelemetry`：`telemetry.enabled` 默认 `false`；环境变量 `BETTER_AUTH_TELEMETRY` 可开启；测试环境（`isTest()`）自动跳过（`packages/telemetry/src/index.ts:51-61`、`packages/core/src/types/init-options.ts:1814-1828`）。
- 无 `BETTER_AUTH_TELEMETRY_ENDPOINT` 且无 `customTrack` 时，返回 `noop` 发布函数（`packages/telemetry/src/index.ts:27-32`）。
- 埋点属性常量：`ATTR_DB_COLLECTION_NAME`、`ATTR_DB_OPERATION_NAME`、`ATTR_HTTP_RESPONSE_STATUS_CODE`、`ATTR_HTTP_ROUTE`、`ATTR_OPERATION_ID`、`ATTR_HOOK_TYPE`、`ATTR_CONTEXT`（`packages/core/src/instrumentation/attributes.ts:5-27`）。
- `experimental.instrumentation.enabled` 默认 `true`，且**不影响**遥测上报与应用自身 span（`packages/core/src/types/init-options.ts:1833-1848`）。

### 12.3 Contract

#### 12.3.1 Error Code Contract

```ts
/** 原始错误：码 + 消息的字面量载体 / Raw error: literal carrier of code + message */
export type RawError<K extends string = string> = {
	/** 稳定错误码 / Stable error code */
	readonly code: K;
	/** 面向用户的可读消息 / Human readable message */
	message: string;
};

/**
 * 错误码定义器：键名在类型层限定为大写字母与下划线
 * Error code definer: keys constrained to uppercase letters and underscores at the type level
 * 取证：packages/core/src/utils/error-codes.ts:52-68
 */
export function defineErrorCodes<
	const T extends Record<string, string>,
	R extends { [K in keyof T & string]: RawError<K> },
>(codes: ValidateErrorCodes<T>): R;

/** 基础错误码全集的键名联合 / Union of base error code keys */
export type APIErrorCode = keyof typeof BASE_ERROR_CODES;

/** 基础错误码全集；运行时每项形如 { code, message, toString } */
export const BASE_ERROR_CODES: {
	readonly [K in APIErrorCode]: RawError<K>;
};
```

#### 12.3.2 API Error Contract

```ts
/**
 * API 错误：运行时可抛出的结构化错误
 * API error: structured runtime error
 * 取证：packages/core/src/error/index.ts:17-54
 */
export class APIError extends BaseAPIError {
	/** HTTP 状态语义名 / HTTP status semantic name */
	declare status: string;
	/** 序列化到响应体的载荷 / Payload serialized into the response body */
	declare body: { code?: string; message: string; cause?: unknown };
	/** 附加响应头 / Additional response headers */
	declare headers: Headers;
	/** 数字状态码 / Numeric status code */
	declare statusCode: number;
	/** 错误消息 / Error message */
	declare message: string;
	/** 内部堆栈（不进入响应体）/ Internal stack (never enters the response body) */
	declare errorStack: string;

	/** 由状态与 body 直接构造 / Construct from status and body */
	static fromStatus(
		status: ConstructorParameters<typeof BaseAPIError>[0],
		body?: ConstructorParameters<typeof BaseAPIError>[1],
	): APIError;

	/** 由状态与 RawError 构造 / Construct from status and a RawError */
	static from(
		status: ConstructorParameters<typeof BaseAPIError>[0],
		error: RawError,
		options?: ErrorOptions,
	): APIError;
}

/** 非 API 层的配置错误；stack 被清空 / Configuration error outside the API layer */
export class BetterAuthError extends Error {
	constructor(message: string, options?: { cause?: unknown | undefined });
}
```

#### 12.3.3 Error Handling Options Contract

```ts
/**
 * API 错误处理选项
 * 取证：packages/core/src/types/init-options.ts:1728-1789
 */
export interface OnAPIErrorOptions {
	/** 抛出原始错误而非走默认处理，默认 false / Throw instead of default handling, default false */
	throw?: boolean;
	/** 自定义错误处理器；提供后框架不再打印 / Custom error handler; the framework stops logging once provided */
	onError?: (error: unknown, ctx: AuthContext) => void | Promise<void>;
	/** 错误重定向 URL；错误码与描述以查询参数附加 / Redirect URL; code and description appended as query params */
	errorURL?: string;
	/** 内建错误页定制 / Default error page customization */
	customizeDefaultErrorPage?: {
		colors?: {
			background?: string;
			foreground?: string;
			primary?: string;
			primaryForeground?: string;
			mutedForeground?: string;
			border?: string;
			destructive?: string;
			titleBorder?: string;
			titleColor?: string;
			gridColor?: string;
			cardBackground?: string;
			cornerBorder?: string;
		};
		size?: {
			radiusSm?: string;
			radiusMd?: string;
			radiusLg?: string;
			textSm?: string;
			text2xl?: string;
			text4xl?: string;
			text6xl?: string;
		};
		font?: {
			defaultFamily?: string;
			monoFamily?: string;
		};
		/** 去掉标题边框 / Remove the title border */
		disableTitleBorder?: boolean;
		/** 去掉四角装饰 / Remove the corner decorations */
		disableCornerDecorations?: boolean;
		/** 去掉背景网格 / Remove the background grid */
		disableBackgroundGrid?: boolean;
	};
}
```

#### 12.3.4 Logger And Telemetry Contract

```ts
/**
 * 日志器契约
 * 取证：packages/core/src/env/logger.ts:47-58
 */
export interface Logger {
	/** 完全关闭日志，默认 false / Disable logging entirely, default false */
	disabled?: boolean | undefined;
	/** 禁用 ANSI 颜色；未指定时按终端色深推断 / Disable ANSI colors; inferred from color depth when unset */
	disableColors?: boolean | undefined;
	/** 最低输出级别，默认 "warn" / Minimum output level, default "warn" */
	level?: Exclude<LogLevel, "success"> | undefined;
	/** 自定义输出 sink / Custom output sink */
	log?: ((level: Exclude<LogLevel, "success">, message: string, ...args: never[]) => void) | undefined;
}

/** 日志级别枚举 / Log level enum */
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

/**
 * 遥测配置
 * 取证：packages/core/src/types/init-options.ts:1814-1828
 */
export interface TelemetryOptions {
	/** 开启遥测采集，默认 false / Enable telemetry collection, default false */
	enabled?: boolean;
	/** 调试模式：把事件打印到日志而非上报，默认 false / Debug mode: print events instead of reporting, default false */
	debug?: boolean;
}

/**
 * 遥测发布器
 * 取证：packages/telemetry/src/index.ts:19-70
 */
export interface TelemetryPublisher {
	/** 发布一个遥测事件；未开启时为 noop / Publish one telemetry event; noop when disabled */
	publish: (event: TelemetryEvent) => Promise<void>;
}
```

### 12.4 Flow

以下伪代码表达诊断域三条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 12.4.1 Error Propagation

```ts
// 一次端点调用失败后，错误如何流过 onError 并变成响应体
// 取证：packages/better-auth/src/api/index.ts:355-409, packages/core/src/error/index.ts:36-53
async function onError(e: unknown): Promise<void> {
	// 分支一：FOUND 是"重定向"语义而非失败，直接静默返回
	if (isAPIError(e) && e.status === "FOUND") {
		return;
	}

	// 分支二：宿主要求原样抛出 → 交给宿主的错误中间件处理
	if (options.onAPIError?.throw) {
		throw e;
	}

	// 分支三：宿主提供自定义处理器 → 完全接管，框架不再打印
	if (options.onAPIError?.onError) {
		try {
			await options.onAPIError.onError(e, ctx);
		} catch (hookError) {
			// 分支三之一：自定义处理器自身抛错 —— 只记日志，不影响主流程
			ctx.logger.error("onAPIError.onError threw", hookError);
		}
		return;
	}

	// 分支四：默认打印路径
	const optLogLevel = options.logger?.level;
	const log =
		optLogLevel === "error" || optLogLevel === "warn" || optLogLevel === "debug"
			? logger
			: undefined;

	// 分支四之一：日志被完全关闭 → 什么都不做
	if (options.logger?.disabled === true) {
		return;
	}

	// 分支四之二：数据库结构类错误 —— 降噪，只打一条 error 日志
	if (
		e && typeof e === "object" && "message" in e &&
		typeof e.message === "string" &&
		(e.message.includes("no column") ||
		 e.message.includes("column") ||
		 e.message.includes("relation") ||
		 e.message.includes("table") ||
		 e.message.includes("does not exist"))
	) {
		ctx.logger?.error(e.message);
		return;
	}

	if (isAPIError(e)) {
		// 分支四之三：500 额外打一条带 status 的日志
		if (e.status === "INTERNAL_SERVER_ERROR") {
			ctx.logger.error(e.status, e);
		}
		log?.error(e.message);
	} else {
		// 分支四之四：非 APIError —— 打 name 与原对象
		ctx.logger?.error(
			e && typeof e === "object" && "name" in e ? (e.name as string) : "",
			e,
		);
	}
}

/**
 * 业务侧构造错误的方式
 * 取证：packages/core/src/error/index.ts:36-53
 */
function raiseBusinessError(status: "BAD_REQUEST", code: RawError): never {
	// cause 不进序列化 body：只有显式给了 cause 才带进 body，且被测试固定
	throw APIError.from(status, code, { cause: new Error("internal detail") });
	// 响应体形状：{ code, message }；cause 只留在 error.cause 上
}
```

失败分支清单：`FOUND` → 静默返回；`throw` 为真 → 原样抛出；提供 `onError` → 接管且回调抛错只记日志；日志被禁用 → 完全静默；结构类错误文本 → 降噪为一条 error 日志；`INTERNAL_SERVER_ERROR` → 额外一条带 status 的日志；非 `APIError` → 打 name 与原对象。

#### 12.4.2 Error Page Rendering

```ts
// GET /error 的完整链路
// 取证：packages/better-auth/src/api/routes/error.ts:398-445
async function renderErrorPage(c: AuthEndpointContext): Promise<Response> {
	const url = new URL(c.request?.url || "");
	const unsanitizedCode = url.searchParams.get("error") || "UNKNOWN";
	const unsanitizedDescription = url.searchParams.get("error_description") || null;

	// 分支一：错误码不符合 ^['A-Za-z0-9_-]+$ → 回落为 UNKNOWN（防注入 / 防样式破坏）
	const isValid = /^[\'A-Za-z0-9_-]+$/.test(unsanitizedCode || "");
	const safeCode = isValid ? unsanitizedCode : "UNKNOWN";
	const safeDescription = unsanitizedDescription ? sanitize(unsanitizedDescription) : null;

	const params = new URLSearchParams();
	params.set("error", safeCode);
	if (unsanitizedDescription) {
		params.set("error_description", unsanitizedDescription);
	}

	const options = c.context.options;
	const errorURL = options.onAPIError?.errorURL;

	// 分支二：显式配置了 errorURL → 302 到该地址，带上错误码与描述
	if (errorURL) {
		const redirectURL = appendQueryParams(errorURL, params);
		return new Response(null, { status: 302, headers: { Location: redirectURL } });
	}

	// 分支三：生产环境且未定制错误页 → 302 到站点根，错误信息交给宿主前端处理
	// 注意：只要 customizeDefaultErrorPage 被设置（哪怕只设了一个开关），本分支不再生效
	if (isProduction && !options.onAPIError?.customizeDefaultErrorPage) {
		return new Response(null, { status: 302, headers: { Location: `/?${params.toString()}` } });
	}

	// 分支四：其余情况返回内建 HTML 错误页
	return new Response(html(c.context.options, safeCode, safeDescription), {
		headers: { "Content-Type": "text/html" },
	});
}
```

失败分支清单：错误码含非法字符 → 页面显示 `UNKNOWN`，但**重定向时仍带原始描述**（描述在重定向前未转义，因为重定向参数由 `URLSearchParams` 负责编码）；描述含 HTML → 渲染前经 `sanitize()` 转义；未配置 `errorURL` 且处于生产环境 → 302 到 `/?error=...`；设置了任何定制项 → 取消生产重定向，直接渲染 HTML。

#### 12.4.3 Telemetry And Instrumentation

```ts
// 遥测发布链路：默认关闭
// 取证：packages/telemetry/src/index.ts:19-70
async function createTelemetry(
	options: BetterAuthOptions,
	context?: TelemetryContext,
): Promise<TelemetryPublisher> {
	const debugEnabled =
		options.telemetry?.debug || getBooleanEnvVar("BETTER_AUTH_TELEMETRY_DEBUG", false);
	const telemetryEndpoint = ENV.BETTER_AUTH_TELEMETRY_ENDPOINT;

	// 分支一：既无端点又无 customTrack → 直接返回 noop，不做任何网络访问
	if (!telemetryEndpoint && !context?.customTrack) {
		return { publish: async () => {} };
	}

	const track = async (event: TelemetryEvent): Promise<void> => {
		// 分支二：宿主提供 customTrack → 走宿主通道，失败只记日志
		if (context?.customTrack) {
			await context.customTrack(event).catch(logger.error);
			return;
		}
		// 分支三：debug 模式 → 打印事件而非上报
		if (debugEnabled) {
			logger.info("telemetry event", JSON.stringify(event, null, 2));
			return;
		}
		// 分支四：正常上报，失败只记日志，绝不影响请求
		await betterFetch(telemetryEndpoint, { method: "POST", body: event }).catch(logger.error);
	};

	// 开关判定：显式配置优先于环境变量；测试环境一律关闭
	const isEnabled = async (): Promise<boolean> => {
		const telemetryEnabled = options.telemetry?.enabled !== undefined
			? options.telemetry.enabled
			: false;
		const envEnabled = getBooleanEnvVar("BETTER_AUTH_TELEMETRY", false);
		return (envEnabled || telemetryEnabled) && (context?.skipTestCheck || !isTest());
	};

	const enabled = await isEnabled();
	// enabled === false 时，publish 仍是 noop —— 遥测默认关闭
	return { publish: enabled ? track : async () => {} };
}

/**
 * 埋点：每个插件钩子包在一个 span 里
 * 取证：packages/better-auth/src/api/index.ts:336-354, packages/core/src/instrumentation/attributes.ts:5-27
 */
async function tracedPluginHook(pluginId: string, hookType: string, run: () => Promise<Response>) {
	return withSpan(
		`${hookType} ${pluginId}`,
		{
			[ATTR_HOOK_TYPE]: hookType,
			[ATTR_CONTEXT]: `plugin:${pluginId}`,
			[ATTR_HTTP_RESPONSE_STATUS_CODE]: res.status,
		},
		run,
	);
}
```

失败分支清单：无端点且无 `customTrack` → 返回 `noop`；`customTrack` 抛错 → 只记日志；debug 模式 → 打印不上报；上报失败 → 只记日志，绝不影响请求；测试环境 → 强制关闭；插件钩子抛错 → 由 `onError` 接管（见 12.4.1）。

### 12.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-12-01 | 认证实例已启动，数据库中不存在目标用户 | 调用 `POST /sign-in/email` 传入不匹配的邮箱与口令 | 响应体为 `{ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }`，状态码 400；`code` 与 `message` 均与源码字面量逐字一致 |
| ACC-12-02 | 生产环境（`NODE_ENV=production`），未设置 `onAPIError.errorURL` 且未设置 `customizeDefaultErrorPage` | 访问 `GET /error?error=INVALID_ORIGIN` | 返回 302，`Location` 为 `/?error=INVALID_ORIGIN`；不返回任何 HTML |
| ACC-12-03 | 生产环境，已设置 `customizeDefaultErrorPage`（哪怕只设 `disableBackgroundGrid: true`） | 访问 `GET /error` 且 `error_description` 传入一段脚本标签文本 | 返回 200 与 `text/html`；页面显示错误码 `INVALID_ORIGIN`；描述中的尖括号被转义为对应的 HTML 实体，页面不执行脚本；**不发生 302 重定向** |
| ACC-12-04 | 任意环境 | 向 `error` 参数传入一段脚本标签文本并访问 `GET /error` | 错误码不匹配 `^['A-Za-z0-9_-]+$`，页面显示 `UNKNOWN`；无脚本执行 |
| ACC-12-05 | 认证实例未设置 `onAPIError.onError`，且数据库缺少框架所需列 | 触发一次依赖该列的写入（如创建用户） | 日志中出现一条 `error` 级别消息且只出现一条；响应仍返回 500；**不出现重复的堆栈刷屏** |
| ACC-12-06 | 认证实例设置了 `onAPIError.onError`，回调内部抛错 | 触发任意失败端点 | 回调被调用一次；其抛出的异常被记为 `onAPIError.onError threw` 的 error 日志；主流程不因回调异常而中断 |
| ACC-12-07 | 未设置 `telemetry.enabled`，环境变量 `BETTER_AUTH_TELEMETRY` 未设置 | 启动服务并完成若干次认证调用 | 无任何遥测网络请求发出；日志中无遥测上报记录 |
| ACC-12-08 | 认证实例已启动 | 请求 `GET /ok` | 返回 200 与 `{ ok: true }` |

### 12.6 Known Caveats

- 基础错误码是 **49 个**而非 51 个（`packages/core/src/error/codes.ts:17-71` 逐条计数）。命名清单以源码为准。
- `defineErrorCodes` 的类型约束只覆盖**键名**（大写字母与下划线），**不覆盖 message 文本**；message 可以是任意字符串，含标点（`packages/core/src/utils/error-codes.ts:39-45`）。
- `APIError.from` 在给了 `cause` 时会把 `cause` 放进 body 对象里，但该字段**不会进入序列化结果**——这是被测试固定的契约（`packages/core/src/error/index.test.ts:11-26`）。
- 错误页的 `error_description` 在**渲染 HTML 时**转义，但在**重定向时**不做 HTML 转义（转而由 `URLSearchParams` 做 URL 编码）（`packages/better-auth/src/api/routes/error.ts:406-414`）。
- 错误页的正则 `^['A-Za-z0-9_-]+$` 的字符类里**包含一个单引号**（`packages/better-auth/src/api/routes/error.ts:404`），源码原样如此。
- 结构类错误降噪的判定是**子串匹配**，命中 `no column` / `column` / `relation` / `table` / `does not exist` 任一即降噪；`column` 与 `table` 单词过于宽泛，业务错误消息里含这两个词也会被降噪（`packages/better-auth/src/api/index.ts:385-395`）。
- `packages/better-auth/src/plugins/telemetry` 目录不存在；遥测实现位于独立包 `packages/telemetry/`，由 `packages/better-auth/src/context/create-context.ts:20` 引入。
- 日志级别过滤把 `success` 排除在可配置级别之外（`Logger.level` 不接受 `success` 级别），且 `success` 级别在自定义 sink 里被降级为 `info` 上报（`packages/core/src/env/logger.ts:50`、`:128`）。
