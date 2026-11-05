---
title: 组织域
description: 为多租户协作提供组织、成员、邀请、团队与动态角色的数据模型与端点设计。
sidebar:
  order: 15
  label: 组织域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 13. Organization

组织域是**外围域**。它为多租户协作提供组织、成员、邀请、团队与动态角色的数据模型、端点与判定辅助；**它不承担认证判定职责，移除后核心链路完整**——去掉 organization 插件后，用户的注册、登录、会话与凭证流程完全不受影响，只是没有"租户"这一层。

组织域与相邻模块的分界是：**组织域管"谁属于哪个租户、能做什么"，但它不裁决"这个人是不是已认证"**。会话有效性由 [会话域](./03-session/) 判定；组织域的所有端点都通过 `orgSessionMiddleware` / `sessionMiddleware` **复用**会话结论，而不是自己重新校验凭据。它与 [守卫域](./07-guard/) 的边界是：组织域提供**组织语义的**判定辅助（`requireOrgRole`、`requireResourceOwnership`），而通用请求守卫（限流、CSRF、Origin 校验）仍归守卫域。它与 [权限域](../permissions/) 的关系是：权限域描述全书的权限矩阵，组织域是其中"组织内角色"这一格的实现。组织内成员的活跃组织上下文落在 [会话域](./03-session/) 的 `session` 表扩展字段上（见 [数据字典](../data/)）。组织域在整体中的位置见 [总体方案与架构](../architecture/)；其端点在 [接口总表](../api/) 中的对应条目同样适用。

### 13.1 Responsibility Boundary

**组织域负责：**

- 提供 organization 插件：六张表（`organization` / `member` / `invitation` / `team` / `teamMember` / `organizationRole`）、42 个端点与角色判定（`packages/better-auth/src/plugins/organization/organization.ts:83-109`、`:139-163`）。
- 提供组织 CRUD、成员管理、邀请流转、团队管理与动态角色五个端点族（`packages/better-auth/src/plugins/organization/routes/`）。
- 提供角色解析辅助：`parseRoleList` / `parseRoles`——角色以**逗号分隔字符串**存储，所有角色比较与写入都必须走这两个函数（`packages/better-auth/src/plugins/organization/roles.ts:14-28`）。
- 提供访问判定辅助 `createAccessControl` / `role`（`packages/better-auth/src/plugins/access/access.ts:106-169`）。**注意：这不是插件**，`packages/better-auth/src/plugins/access/index.ts` 只导出 `access.ts` 与 `types.ts` 的内容，不产生任何端点、不建表、不进 `options.plugins`。
- 提供两个请求中间件：`requireOrgRole`（按成员记录的角色判定）与 `requireResourceOwnership`（按归属字段判定）（`packages/better-auth/src/api/middlewares/authorization.ts:16-156`）。
- 提供组织专有错误码全集 `ORGANIZATION_ERROR_CODES`（60 个，`packages/better-auth/src/plugins/organization/error-codes.ts:3-98`）。

**组织域不负责（明确拒绝承担的职责）：**

- 不裁决认证结果：所有组织端点依赖会话中间件提供的 `ctx.context.session`，自己不验口令。
- 不裁决全局权限：organization 内的角色判定只回答"在这个组织里能做什么"，跨组织的资源授权仍走通用守卫与宿主代码。
- 不实现访问控制原语本身：`packages/better-auth/src/plugins/access/` 只是判定函数库，不注册插件、不落库。
- 不定义会话生命周期：`activeOrganizationId` / `activeTeamId` 是 `session` 表的**扩展字段**，字段定义由组织域提供，生命周期由 [会话域](./03-session/) 管理（`packages/better-auth/src/plugins/organization/schema.ts:212-218`、`:285-300`）。
- 不发通知：邀请创建后是否发信由宿主通过钩子自行接管。

**失败语义的统一约定：**

| 情形 | 语义 |
|---|---|
| 资源不存在 | `NOT_FOUND` + `ORGANIZATION_NOT_FOUND` / `MEMBER_NOT_FOUND` / `TEAM_NOT_FOUND` / `INVITATION_NOT_FOUND` |
| 已认证但无权 | `FORBIDDEN` + `YOU_ARE_NOT_ALLOWED_TO_*` 系列 |
| 状态冲突 | `BAD_REQUEST` / `CONFLICT` + `ORGANIZATION_ALREADY_EXISTS` / `ORGANIZATION_SLUG_ALREADY_TAKEN` / `TEAM_ALREADY_EXISTS` |
| 配额超限 | `BAD_REQUEST` + `YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_*` / `*_LIMIT_REACHED` |
| 邀请状态不符 | `BAD_REQUEST` + `INVITATION_NOT_FOUND`（含已过期、已被接受等情形） |

### 13.2 Capability Inventory

**端点全集（42 个，取证自 `packages/better-auth/src/plugins/organization/routes/`）：**

| 族 | 方法与路径 |
|---|---|
| 组织 CRUD（8） | `POST /organization/create`、`POST /organization/check-slug`、`POST /organization/update`、`POST /organization/delete`、`GET /organization/get-organization`、`GET /organization/get-full-organization`、`POST /organization/set-active`、`GET /organization/list` |
| 成员（6） | `POST /organization/remove-member`、`POST /organization/update-member-role`、`GET /organization/get-active-member`、`POST /organization/leave`、`GET /organization/list-members`、`GET /organization/get-active-member-role` |
| 邀请（7） | `POST /organization/invite-member`、`POST /organization/accept-invitation`、`POST /organization/reject-invitation`、`POST /organization/cancel-invitation`、`GET /organization/get-invitation`、`GET /organization/list-invitations`、`GET /organization/list-user-invitations` |
| 团队（9） | `POST /organization/create-team`、`POST /organization/remove-team`、`POST /organization/update-team`、`GET /organization/list-teams`、`POST /organization/set-active-team`、`GET /organization/list-user-teams`、`GET /organization/list-team-members`、`POST /organization/add-team-member`、`POST /organization/remove-team-member` |
| 动态角色（5） | `POST /organization/create-role`、`POST /organization/delete-role`、`GET /organization/list-roles`、`GET /organization/get-role`、`POST /organization/update-role` |
| 权限判定（1） | `POST /organization/has-permission`（`packages/better-auth/src/plugins/organization/organization.ts:196`） |

**六张表的字段契约（取证 `packages/better-auth/src/plugins/organization/schema.ts:26-218`）：**

| 表 | 字段与约束 |
|---|---|
| `organization` | `name`（string，必填，可排序）、`slug`（string，必填，唯一，可排序）、`logo`（string，选填）、`createdAt`（date，必填）、`updatedAt`（date，选填） |
| `member` | `organizationId`（string，必填，外键 → `organization.id`）、`userId`（string，必填，外键 → `user.id`）、`role`（string，必填，默认 `"member"`）、`createdAt`（date，必填） |
| `invitation` | `organizationId`（必填，外键）、`email`（必填，可排序）、`role`（必填，可排序）、`status`（string，必填，默认 `"pending"`，可排序）、`expiresAt`（date，选填）、`createdAt`（date，必填，默认 `Date`）、`inviterId`（string，必填，外键 → `user.id`）；团队启用时额外有 `teamId`（string，选填，可排序） |
| `team` | `name`（string，必填）、`memberCount`（number，必填，默认 0，不入参不回传）、`organizationId`（string，必填，外键）、`createdAt`（date，必填）、`updatedAt`（date，选填） |
| `teamMember` | `teamId`（string，必填，外键 → `team.id`）、`userId`（string，必填，外键 → `user.id`）、`membershipKey`（string，选填，唯一，不入参不回传）、`createdAt`（date，选填） |
| `organizationRole` | `organizationId`（string，必填，外键）、`role`（string，必填）、`permission`（string，必填，JSON 字符串）、`createdAt`（date，必填，默认 `Date`）、`updatedAt`（date，选填） |

**`session` 表扩展（`packages/better-auth/src/plugins/organization/schema.ts:212-218`、`:285-300`）：**

- `activeOrganizationId`：string，选填，`input: false`（客户端不可写）。
- `activeTeamId`：string，选填，`input: false`——**仅在 `teams.enabled === true` 时存在**。

**内置角色与语句（`packages/better-auth/src/plugins/organization/access/statement.ts:3-43`）：**

- `defaultStatements`：`organization: ["update", "delete"]`、`member: ["create", "update", "delete"]`、`invitation: ["create", "cancel"]`、`team: ["create", "update", "delete"]`、`ac: ["create", "read", "update", "delete"]`。
- `admin`：`organization: ["update"]` + 其余全部。
- `owner`：`organization: ["update", "delete"]` + 其余全部。
- `member`：仅 `ac: ["read"]`（可见本组织的全部角色），其余为空数组。
- `creatorRole` 默认 `"owner"`；`allowCreatorAllPermissions` 为真时，创建者角色直接通过一切权限判定（`packages/better-auth/src/plugins/organization/permission.ts:14-16`）。

**邀请状态机（`status` 字段）：**

| 状态 | 进入方式 | 允许的后继 |
|---|---|---|
| `pending` | 创建邀请时写入（默认，`packages/better-auth/src/plugins/organization/routes/crud-invites.ts:865`） | `accepted` / `rejected` / `canceled` |
| `accepted` | `POST /organization/accept-invitation` 认领（`:758`） | 终态 |
| `rejected` | `POST /organization/reject-invitation`（`:984`） | 终态 |
| `canceled` | `POST /organization/cancel-invitation`（`:1101`）；或重复邀请时按 `cancelPendingInvitationsOnReInvite` 自动取消旧邀请（`:442`） | 终态 |

> 枚举字面量为 `["pending", "accepted", "rejected", "canceled"]`——**`canceled` 是一个 l**（`packages/better-auth/src/plugins/organization/schema.ts:304-306`、`:398`）。邀请另有过期判定：`expiresAt < new Date()` 时按 `INVITATION_NOT_FOUND` 处理（`:686-695`）。

**并发控制：** 接受邀请采用"先认领后建员"的两段式。认领是**带守卫的单条原子更新**（`status: "accepted", fromStatus: "pending"`），只有认领成功的请求才继续建员；建员在事务中完成，失败则把认领**释放回 `pending`**，让被邀请人可重试而不是被卡在"已接受但无成员"的状态（`packages/better-auth/src/plugins/organization/routes/crud-invites.ts:752-770`）。

### 13.3 Contract

#### 13.3.1 Organization Plugin Contract

```ts
/**
 * 组织插件的对外类型面
 * 取证：packages/better-auth/src/plugins/organization/organization.ts:83-115
 */
export type DefaultOrganizationPlugin<Options extends OrganizationOptions> = {
	/** 插件 id / Plugin id */
	id: "organization";
	/** 插件版本 / Plugin version */
	version: string;
	/** 端点集合 / Endpoint set */
	endpoints: OrganizationEndpoints<Options>;
	/** 表模型 / Table schema */
	schema: OrganizationSchema<Options>;
	$Infer: {
		Organization: InferOrganization<Options>;
		Invitation: InferInvitation<Options>;
		Member: InferMember<Options>;
		Team: Options["teams"] extends { enabled: true } ? InferTeam<Options> : never;
		TeamMember: Options["teams"] extends { enabled: true } ? TeamMember : never;
		ActiveOrganization: {
			members: InferMember<Options, false>[];
			invitations: InferInvitation<Options, false>[];
			teams: Options["teams"] extends { enabled: true } ? InferTeam<Options, false>[] : never[];
		} & InferOrganization<Options, false>;
	};
	/** 插件贡献的错误码集 / Error codes contributed by this plugin */
	$ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
	/** 插件选项 / Plugin options */
	options: NoInfer<Options>;
};

/** 组织插件工厂 / Organization plugin factory */
export interface OrganizationCreator {
	<Options extends OrganizationOptions>(options?: Options | undefined): DefaultOrganizationPlugin<Options>;
}
```

#### 13.3.2 Entity Contract

```ts
/**
 * 组织实体
 * 取证：packages/better-auth/src/plugins/organization/schema.ts:308-374
 */
export interface Organization {
	/** 主键 / Primary key */
	id: string;
	/** 组织名 / Organization name */
	name: string;
	/** 全局唯一短名 / Globally unique slug */
	slug: string;
	/** 徽标 / Logo */
	logo?: string | null;
	/** 附加元数据（JSON 字符串或对象）/ Additional metadata */
	metadata?: Record<string, unknown> | string;
	/** 创建时间 / Creation time */
	createdAt: Date;
}

/** 组织成员记录 / Organization membership record */
export interface Member {
	id: string;
	organizationId: string;
	userId: string;
	/** 逗号分隔的角色名列表 / Comma separated role names */
	role: string;
	createdAt: Date;
}

/** 组织邀请 / Organization invitation */
export interface Invitation {
	id: string;
	organizationId: string;
	email: string;
	role: string;
	/** 邀请状态：pending | accepted | rejected | canceled */
	status: "pending" | "accepted" | "rejected" | "canceled";
	/** 邀请发起人 / Inviter */
	inviterId: string;
	/** 过期时间 / Expiry time */
	expiresAt: Date;
	createdAt: Date;
	/** 目标团队（团队启用时）/ Target team, when teams are enabled */
	teamId?: string | null;
}

/** 团队 / Team */
export interface Team {
	id: string;
	name: string;
	organizationId: string;
	createdAt: Date;
	updatedAt?: Date;
}

/** 团队成员 / Team membership */
export interface TeamMember {
	id: string;
	teamId: string;
	userId: string;
	createdAt: Date;
}

/** 动态组织角色 / Dynamic organization role */
export interface OrganizationRole {
	id: string;
	organizationId: string;
	role: string;
	/** 权限映射的 JSON 字符串 / JSON string of the permission map */
	permission: string;
	createdAt: Date;
	updatedAt?: Date;
}
```

#### 13.3.3 Authorization Middleware Contract

```ts
/**
 * 组织角色判定中间件
 * 取证：packages/better-auth/src/api/middlewares/authorization.ts:92-156
 */
export function requireOrgRole(config: {
	/** 承载组织 id 的请求参数名 / Request parameter carrying the organization id */
	orgIdParam: string;
	/** 组织 id 的来源：body 或 query / Where the organization id comes from */
	orgIdSource: "body" | "query";
	/**
	 * 允许的角色列表；省略或为空时"任意成员身份"即放行
	 * Allowed roles; omitted or empty means any membership suffices
	 */
	allowedRoles?: string[];
}): AuthMiddleware;

/**
 * 资源归属判定中间件
 * 取证：packages/better-auth/src/api/middlewares/authorization.ts:16-80
 */
export function requireResourceOwnership(config: {
	/** 数据库模型名，如 "passkey" / "apiKey" */
	model: string;
	/** 承载资源 id 的请求参数名 / Request parameter carrying the resource id */
	idParam: string;
	/** 资源 id 的来源：body 或 query / Where the resource id comes from */
	idSource: "body" | "query";
	/** 存放归属者 user id 的字段名，默认 "userId" */
	ownerField?: string;
	/** 资源不存在时抛出的错误；接受 defineErrorCodes 产出的 { code, message } */
	notFoundError?: { code: string; message: string };
	/** 归属不符时抛出的错误 / Error thrown when ownership does not match */
	forbiddenError?: { code: string; message: string };
	/** 归属失败时的状态码，默认 "FORBIDDEN" */
	forbiddenStatus?: "FORBIDDEN" | "UNAUTHORIZED";
}): AuthMiddleware;
```

#### 13.3.4 Access Control Contract

```ts
/**
 * 访问控制判定原语（纯函数库，不是插件）
 * 取证：packages/better-auth/src/plugins/access/access.ts:106-169
 */
export function role<
	const TRoleStatements extends Statements,
	TAuthorizeStatements extends Statements = TRoleStatements,
>(
	statements: TRoleStatements,
): Role<ExactRoleStatements<TRoleStatements>, TAuthorizeStatements>;

/**
 * 创建访问控制实例
 * 取证：packages/better-auth/src/plugins/access/access.ts:158-169
 */
export function createAccessControl<const TStatements extends Statements>(
	s: TStatements,
): {
	newRole<const TRoleStatements extends Statements>(
		statements: RoleInput<TStatements, TRoleStatements>,
	): Role<ExactRoleStatements<TRoleStatements>, TStatements>;
	statements: TStatements;
};

/** 判定结果 / Authorization result */
export type AuthorizeResponse =
	| { success: false; error: string }
	| { success: true; error?: never | undefined };

/** 角色判定请求 / Role authorization request */
export type RoleAuthorizeRequest<TStatements extends Statements> = {
	[P in keyof TStatements]?:
		| SubArray<TStatements[P]>
		| { actions: SubArray<TStatements[P]>; connector: "OR" | "AND" };
};

/**
 * 角色列表解析：逗号分隔字符串 → 去空白后的角色名数组
 * 取证：packages/better-auth/src/plugins/organization/roles.ts:14-22
 */
export function parseRoleList(roles: string | string[]): string[];

/**
 * 角色规范化：写库前的唯一形态
 * 取证：packages/better-auth/src/plugins/organization/roles.ts:28
 */
export function parseRoles(roles: string | string[]): string;
```

### 13.4 Flow

以下伪代码表达组织域两条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 13.4.1 Invitation Lifecycle

```ts
// 邀请从创建到终态的完整链路
// 取证：packages/better-auth/src/plugins/organization/routes/crud-invites.ts
async function inviteMember(ctx: GenericEndpointContext): Promise<Invitation> {
	const session = ctx.context.session;

	// 分支一：重复邀请且开启了 cancelPendingInvitationsOnReInvite
	//        → 先把旧的 pending 邀请置为 canceled，再建新的
	if (alreadyInvited.length && ctx.context.orgOptions.cancelPendingInvitationsOnReInvite) {
		await adapter.updateInvitation({
			invitationId: alreadyInvited[0]!.id,
			status: "canceled",
		});
	}

	// 分支二：超出邀请配额 → 拒绝，错误码 INVITATION_LIMIT_REACHED
	const invitationLimit = typeof ctx.context.orgOptions.invitationLimit === "function"
		? await ctx.context.orgOptions.invitationLimit({ user: session.user, ... })
		: ctx.context.orgOptions.invitationLimit;
	if (invitationLimit && totalInvitations >= invitationLimit) {
		throw APIError.from("BAD_REQUEST", ORGANIZATION_ERROR_CODES.INVITATION_LIMIT_REACHED);
	}

	// 分支三：目标邮箱已是成员 → 拒绝，错误码 USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION
	// 分支四：目标邮箱已被邀请且未开启自动取消 → 拒绝，错误码 USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION
	// 分支五：邀请人无权邀请该角色 → 拒绝，错误码 YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE
	// 分支六：发起人已不是组织成员 → 拒绝，错误码 INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION

	// 成功路径：写入一条 status = "pending" 的邀请
	return adapter.createInvitation({
		organizationId, email, role: parseRoles(role), inviterId: session.user.id,
		status: "pending", expiresAt: new Date(Date.now() + expiresIn),
	});
}

async function acceptInvitation(ctx: GenericEndpointContext): Promise<{ invitation: Invitation; member: Member }> {
	const invitation = await adapter.findInvitationById(ctx.body.invitationId);

	// 分支一：邀请不存在、已过期、或状态不是 pending
	//        → 一律按 INVITATION_NOT_FOUND 处理（不泄露"存在但已过期"）
	if (!invitation || invitation.expiresAt < new Date() || invitation.status !== "pending") {
		throw APIError.from("BAD_REQUEST", ORGANIZATION_ERROR_CODES.INVITATION_NOT_FOUND);
	}

	// 分支二：当前会话邮箱与邀请邮箱不符（大小写不敏感比较）
	//        → FORBIDDEN + YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION
	if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
		throw APIError.from("FORBIDDEN", ORGANIZATION_ERROR_CODES.YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION);
	}

	// 分支三：组织要求受邀人邮箱已验证但未验证
	//        → EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION
	if (shouldRequireVerifiedEmailForInvitationIdAction({ organizationOptions, ... })) {
		throw APIError.from("BAD_REQUEST", ORGANIZATION_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION);
	}

	// 认领：带守卫的原子更新，pending -> accepted 只有一条请求能成功
	const acceptedI = await adapter.updateInvitation({
		invitationId: ctx.body.invitationId,
		status: "accepted",
		fromStatus: "pending",
	});
	// 分支四：并发下另一个请求已先认领 → 按 INVITATION_NOT_FOUND 失败（幂等：不会重复建员）
	if (!acceptedI) {
		throw APIError.from("BAD_REQUEST", ORGANIZATION_ERROR_CODES.INVITATION_NOT_FOUND);
	}

	// 建员：在事务中完成；失败则把认领释放回 pending，让受邀人可重试
	try {
		const member = await runWithTransaction(ctx.context.adapter, async () => {
			// 团队启用且邀请带 teamId 时，先确保该用户在组织内有成员记录，再加入团队
			return adapter.createMember({ organizationId, userId, role: parseRoles(invitation.role), ... });
		});
		return { invitation: acceptedI, member };
	} catch (err) {
		await adapter.updateInvitation({ invitationId: acceptedI.id, status: "pending" });
		throw err;
	}
}
```

失败分支清单：重复邀请且未开启自动取消 → `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION`；超出邀请配额 → `INVITATION_LIMIT_REACHED`；邀请不存在/已过期/状态非 `pending` → `INVITATION_NOT_FOUND`；收件人不匹配 → `FORBIDDEN` + `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`；邮箱未验证 → `EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`；并发认领失败 → `INVITATION_NOT_FOUND`（幂等，不重复建员）；建员失败 → 认领回滚为 `pending`，受邀人可重试。

#### 13.4.2 Authorization Middleware

```ts
// 两个授权中间件的判定链路
// 取证：packages/better-auth/src/api/middlewares/authorization.ts
function requireOrgRole(config: {
	orgIdParam: string; orgIdSource: "body" | "query"; allowedRoles?: string[];
}) {
	return createAuthMiddleware(async (ctx) => {
		// 分支一：无会话 → UNAUTHORIZED
		const session = ctx.context.session as { user: { id: string } } | undefined;
		if (!session?.user?.id) throw new APIError("UNAUTHORIZED");

		// 分支二：organization 插件未启用 → BAD_REQUEST
		//        （这是配置错误而非权限错误，必须显式失败而不是静默放行）
		if (!ctx.context.hasPlugin("organization")) {
			throw new APIError("BAD_REQUEST", {
				message: "Organization plugin is required for org role authorization",
			});
		}

		const source = config.orgIdSource === "body" ? ctx.body : ctx.query;
		const organizationId = source?.[config.orgIdParam];
		// 分支三：参数缺失 → BAD_REQUEST
		if (!organizationId) {
			throw new APIError("BAD_REQUEST", { message: `Missing required parameter: ${config.orgIdParam}` });
		}

		// 查成员记录：按 (userId, organizationId) 精确定位
		const member = await ctx.context.adapter.findOne({
			model: "member",
			where: [
				{ field: "userId", value: session.user.id },
				{ field: "organizationId", value: organizationId },
			],
		});
		// 分支四：不是该组织成员 → FORBIDDEN "Not a member of this organization"
		if (!member) throw new APIError("FORBIDDEN", { message: "Not a member of this organization" });

		// 分支五：allowedRoles 为空/省略 → 任意成员身份即放行
		if (config.allowedRoles?.length) {
			// 角色列是逗号分隔字符串，需拆分并去空白
			const rawRole = ((member as Record<string, unknown>).role as string) ?? "";
			const memberRoles = rawRole.split(",").map((e) => e.trim()).filter(Boolean);
			// 分支六：成员角色与 allowedRoles 无交集 → FORBIDDEN "Insufficient role for this operation"
			if (!memberRoles.some((role) => config.allowedRoles!.includes(role))) {
				throw new APIError("FORBIDDEN", { message: "Insufficient role for this operation" });
			}
		}

		// 成功路径：把成员记录挂到 ctx.context.verifiedMember，处理器无需再查一次库
		return { verifiedMember: member };
	});
}

function requireResourceOwnership(config: {
	model: string; idParam: string; idSource: "body" | "query";
	ownerField?: string; notFoundError?: { code: string; message: string };
	forbiddenError?: { code: string; message: string };
	forbiddenStatus?: "FORBIDDEN" | "UNAUTHORIZED";
}) {
	const ownerField = config.ownerField ?? "userId";
	const forbiddenStatus = config.forbiddenStatus ?? "FORBIDDEN";
	return createAuthMiddleware(async (ctx) => {
		// 分支一：无会话 → UNAUTHORIZED
		const session = ctx.context.session as { user: { id: string } } | undefined;
		if (!session?.user?.id) throw new APIError("UNAUTHORIZED");

		const source = config.idSource === "body" ? ctx.body : ctx.query;
		const resourceId = source?.[config.idParam];
		// 分支二：参数缺失 → BAD_REQUEST
		if (!resourceId) throw new APIError("BAD_REQUEST", { message: `Missing required parameter: ${config.idParam}` });

		const resource = await ctx.context.adapter.findOne({
			model: config.model, where: [{ field: "id", value: resourceId }],
		});
		// 分支三：资源不存在 → NOT_FOUND（可用 notFoundError 自定义码）
		if (!resource) {
			if (config.notFoundError) throw APIError.from("NOT_FOUND", config.notFoundError);
			throw new APIError("NOT_FOUND");
		}

		// 分支四：归属字段与当前用户不符 → FORBIDDEN（可用 forbiddenError / forbiddenStatus 自定义）
		if ((resource as Record<string, unknown>)[ownerField] !== session.user.id) {
			if (config.forbiddenError) throw APIError.from(forbiddenStatus, config.forbiddenError);
			throw new APIError(forbiddenStatus);
		}

		// 成功路径：把资源挂到 ctx.context.verifiedResource，处理器无需再查一次库
		return { verifiedResource: resource };
	});
}
```

失败分支清单：`requireOrgRole` —— 无会话 → `UNAUTHORIZED`；organization 插件未启用 → `BAD_REQUEST`（配置错误显式失败）；组织 id 参数缺失 → `BAD_REQUEST`；非成员 → `FORBIDDEN`；角色不在白名单 → `FORBIDDEN`。`requireResourceOwnership` —— 无会话 → `UNAUTHORIZED`；资源 id 参数缺失 → `BAD_REQUEST`；资源不存在 → `NOT_FOUND`；归属不符 → `FORBIDDEN`（或配置指定的 `UNAUTHORIZED`）。两者在成功时都把结果挂到 `ctx.context` 上以避免处理器重复查询。

#### 13.4.3 Permission Evaluation

```ts
// 组织权限判定链路
// 取证：packages/better-auth/src/plugins/organization/has-permission.ts:44-115,
//        packages/better-auth/src/plugins/organization/permission.ts:6-31
async function hasPermission(
	input: { organizationId: string; useMemoryCache?: boolean } & HasPermissionBaseInput,
	ctx: GenericEndpointContext,
): Promise<boolean> {
	// 角色集：宿主自定义角色优先，否则用内置 admin/owner/member
	const acRoles = { ...(input.options.roles || defaultRoles) };

	// 分支一：未启用动态访问控制、或无 ac 实例、或无组织 id
	//        → 直接用静态角色集判定，不查库
	if (!ctx || !input.organizationId || !input.options.dynamicAccessControl?.enabled || !input.options.ac) {
		return hasPermissionFn(input, acRoles);
	}

	// 分支二：请求作用域缓存命中（useMemoryCache 为真时）→ 直接判定
	const cache = await getRequestScopedRolesCache(ctx, input.options);
	const cached = input.useMemoryCache ? cache?.get(input.organizationId) : undefined;
	if (cached) return hasPermissionFn(input, cached);

	// 从 organizationRole 表加载该组织的动态角色
	const roles = await ctx.context.adapter.findMany({
		model: "organizationRole",
		where: [{ field: "organizationId", value: input.organizationId }],
	});

	for (const { role, permission: permissionsString } of roles) {
		const permissions: unknown = JSON.parse(permissionsString);
		const result = rolePermissionsSchema.safeParse(permissions);
		// 分支三：权限数据损坏 → INTERNAL_SERVER_ERROR，并记 error 日志（不静默放行也不静默拒绝）
		if (!result.success) {
			ctx.context.logger.error("[hasPermission] Invalid permissions for role " + role, { permissions });
			throw new APIError("INTERNAL_SERVER_ERROR", { message: "Invalid permissions for role " + role });
		}
		// 把动态权限合并进静态角色定义（同名资源的动作取并集）
		const merged: Record<string, readonly string[]> = { ...acRoles[role]?.statements };
		for (const [key, actions] of Object.entries(result.data)) {
			merged[key] = [...new Set([...(merged[key] ?? []), ...actions])];
		}
		acRoles[role] = input.options.ac!.newRole(merged);
	}

	cache?.set(input.organizationId, acRoles);
	return hasPermissionFn(input, acRoles);
}

/** 角色判定本体：任一角色通过即通过 / Role evaluation: any role passing wins */
function hasPermissionFn(input: HasPermissionBaseInput, acRoles: Record<string, Role<Statements> | undefined>): boolean {
	if (!input.permissions) return false;
	const roles = parseRoleList(input.role);
	const creatorRole = input.options.creatorRole || "owner";
	// 创建者角色 + allowCreatorAllPermissions → 直接通过
	if (roles.includes(creatorRole) && (input.allowCreatorAllPermissions || false)) return true;
	// 任一角色的 authorize 成功即通过
	for (const role of roles) {
		const result = acRoles[role]?.authorize(input.permissions);
		if (result?.success) return true;
	}
	return false;
}
```

失败分支清单：动态访问控制未启用 → 走静态角色，不查库；权限 JSON 解析失败或结构不合法 → `INTERNAL_SERVER_ERROR`（显式失败，不静默放行）；请求作用域缓存只在本请求内有效，请求结束即销毁，不会跨请求污染。

### 13.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-13-01 | 认证实例已启用 organization 插件，当前用户已登录 | 调用 `POST /organization/create`，body 为 `{ name: "Acme", slug: "acme" }` | 返回 201/200 与创建出的 organization（`id` / `name` / `slug` / `createdAt`）；数据库 `member` 表出现一条 `role` 为 `"owner"` 的成员记录；再次用相同 `slug` 创建返回 `ORGANIZATION_SLUG_ALREADY_TAKEN` |
| ACC-13-02 | 用户 A 是组织 O 的 `owner`，用户 B 已登录但不是该组织成员 | 用户 B 调用 `POST /organization/update-member-role` 把自己的角色改成 `admin` | 请求被拒，错误码 `YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER`；`member` 表中该行角色**未发生任何变化** |
| ACC-13-03 | 组织 O 有一条 `status` 为 `pending` 的邀请，收件邮箱为 `b@example.com` | 用户 B（邮箱 `B@example.com`）调用 `POST /organization/accept-invitation` | 接受成功：邀请 `status` 变为 `accepted`，同时出现一条 `member` 记录；**邮箱大小写不敏感匹配**；若用户 C（非收件人）调用则返回 `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION` |
| ACC-13-04 | 组织 O 有一条 `status` 为 `pending` 的邀请 | 并发发起两次 `POST /organization/accept-invitation` | 有且只有一次成功；另一次返回 `INVITATION_NOT_FOUND`；`member` 表中**只新增一条**成员记录（不重复建员） |
| ACC-13-05 | 组织 O 有一条 `status` 为 `pending` 的邀请 | 先调用 `POST /organization/cancel-invitation`，再调用 `POST /organization/accept-invitation` | 取消后邀请 `status` 为 `canceled`；随后的接受请求返回 `INVITATION_NOT_FOUND`；不产生成员记录 |
| ACC-13-06 | 端点使用了 `requireOrgRole({ orgIdParam: "organizationId", orgIdSource: "body", allowedRoles: ["admin"] })` | 分别以 `admin`、`member`、`owner` 身份调用该端点 | `admin` 通过；`member` 返回 `FORBIDDEN` 且 message 为 `Insufficient role for this operation`；`owner` 通过（owner 也在 `allowedRoles` 之外时按配置判定）；非成员返回 `FORBIDDEN` 且 message 为 `Not a member of this organization` |
| ACC-13-07 | 已启用 `dynamicAccessControl` 且在 `organizationRole` 表中写入一个含非法权限结构（`permission` 不是 JSON 字符串）的角色 | 调用 `POST /organization/has-permission` | 返回 `INTERNAL_SERVER_ERROR`；日志出现 `[hasPermission] Invalid permissions for role ...`；**不返回"允许"也不返回"拒绝"** |
| ACC-13-08 | 未启用 organization 插件，但某个端点使用了 `requireOrgRole` | 调用该端点 | 返回 `BAD_REQUEST`，message 为 `Organization plugin is required for org role authorization`（配置错误显式失败，不静默放行） |

### 13.6 Known Caveats

- 邀请状态枚举字面量是 **`canceled`（一个 l）**，不是 `cancelled`（`packages/better-auth/src/plugins/organization/schema.ts:304-306`、`:398`）。
- `packages/better-auth/src/plugins/access/` **不是插件**：它只导出 `createAccessControl` / `role` 与类型，不注册端点、不建表、不出现在 `options.plugins` 中（`packages/better-auth/src/plugins/access/index.ts:1-2`）。
- `requireOrgRole` 判定的是"该成员在**这个**组织里的角色"，与 `hasPermission` 判定的是两套机制：前者查 `member.role` 字符串列，后者走 access control 语句表。混用会导致口径不一致。
- `member.role` 与 `invitation.role` 存的都是**逗号分隔字符串**（可能含多个角色），所有比较必须走 `parseRoleList`；直接字符串相等比较会漏判（`packages/better-auth/src/plugins/organization/roles.ts:4-13` 的注释明确要求）。
- `teamMember.membershipKey` 与 `team.memberCount` 都是 `input: false, returned: false` 的框架维护字段，客户端既不能写也读不到（`packages/better-auth/src/plugins/organization/schema.ts:59-65`、`:101-107`）。
- `session.activeTeamId` **只在 `teams.enabled === true` 时存在**；`session.activeOrganizationId` 始终存在（`packages/better-auth/src/plugins/organization/schema.ts:285-300`）。
- `organizationRole` 表与相关端点只在 `dynamicAccessControl.enabled === true` 时出现；未启用时表结构里没有 `organizationRole`（`packages/better-auth/src/plugins/organization/schema.ts:220-237`）。
- `organization.metadata` 在 schema 层是 `z.record(z.string(), z.unknown()).or(z.string().transform(...))`，即数据库里存字符串、接口上可传对象（`packages/better-auth/src/plugins/organization/schema.ts:313-316`）。
