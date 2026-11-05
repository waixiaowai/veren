---
title: 租户
description: 组织、环境分区、成员角色与切换主体时的失效规则。
sidebar:
  order: 36
  label: 租户 Tenancy
lastUpdated: 2026-11-05
---

租户模块定义「数据属于谁」：组织是数据归属单位，环境是同一组织内的分区。它决定每条查询默认附加的范围、谁能看到哪些组织、以及切换组织或环境之后哪些状态必须失效。它是外围域，但在多主体部署中它是隔离性的唯一来源。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 租户负责 | 不负责 |
| --- | --- | --- |
| 身份 | 绑定账号与组织、角色与作用域 | 认证与会话 |
| 全部领域 | 提供组织与环境上下文 | 资源级业务判定 |
| 支付通道 | 保存组织的通道配置引用 | 通道协议 |
| 控制台 | 提供组织切换与设置入口 | 页面布局 |

## 2. Capabilities

1. 组织：创建、重命名、上传标识、删除；删除需所有者二次确认。
2. 成员与角色：所有者、管理员、开发者、销售、成员五类角色，角色映射为默认作用域集合。
3. 邀请：生成邀请链接、设置过期时间、撤销。
4. 环境：沙箱与生产两个分区，共享组织与成员，不共享客户、套餐与密钥。
5. 组织配置：默认货币、支付通道配置、回调应用、发票模板、用量告警。
6. 上线状态：组织完成首次真实配置后标记为已上线，未上线组织的生产入口自动重定向到沙箱。
7. 主体切换：切换组织或环境时清除选中项、分页游标与查询缓存，避免跨主体残留。

## 3. Contracts

```ts
type Role = "owner" | "admin" | "developer" | "sales" | "member";

interface Organization {
  id: string;
  slug: string;
  name: string;
  defaultCurrency: string;
  deployed: boolean;
  createdAt: number;
}

interface Membership {
  orgId: string;
  userId: string;
  role: Role;
  scopes: string[];
  joinedAt: number;
}

abstract class TenancyService {
  abstract create(input: { name: string; slug?: string; ownerUserId: string }): Promise<Organization>;
  abstract invite(input: { orgId: string; email: string; role: Role; expiresInMs: number }): Promise<{ inviteId: string; token: string }>;
  abstract switchContext(input: { userId: string; orgId: string; env: "sandbox" | "live" }): Promise<{ org: Organization; scopes: string[] }>;
  abstract resolveScope(input: { orgId: string; env: "sandbox" | "live" }): Promise<{ orgId: string; env: string }>;
}
```

## 4. Core Flows

### 4.1 Switch Context

```ts
async function switchContext(input: SwitchInput, ctx: TenancyContext) {
  const membership = await ctx.members.find(input.userId, input.orgId);
  if (!membership) throw new TenancyError({ code: "TEN-403-001", orgId: input.orgId });

  const org = await ctx.orgs.get(input.orgId);
  if (!org.deployed && input.env === "live") {
    return { org, scopes: membership.scopes, redirectedEnv: "sandbox" as const };
  }
  await ctx.sessions.patch({ activeOrgId: org.id, activeEnv: input.env });
  await ctx.cache.clearForUser(input.userId, { orgScoped: true });
  return { org, scopes: membership.scopes };
}
```

失败分支：无成员关系返回 403 而不泄露组织是否存在；组织已删除返回 404 并提示退出；未上线组织访问生产环境时重定向到沙箱，不报错。

### 4.2 Isolation

所有领域查询在进入仓储层前附加组织与环境条件，仓储层不接受「无组织」调用。跨组织聚合只在平台管理员视角出现，且必须显式声明并记录审计。越权访问统一返回「资源不存在」，不返回「无权限」，避免探测。

### 4.3 Delete

删除组织先返回影响预览：成员数、客户数、套餐数、发票数、密钥数。确认后进入软删除队列，保留 30 天可恢复；期间所有接口对该组织返回 410；到期后物理清理并断开与支付通道的关联。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| TEN-A1 | 正常切换 | 用户属于两个组织 | 切换到另一组织 | 会话指向新组织，列表缓存清空 |
| TEN-A2 | 非成员访问 | 用户不属于目标组织 | 直接访问该组织资源 | 返回 404，不泄露存在性 |
| TEN-A3 | 环境隔离 | 沙箱有客户 A | 在生产环境查询客户 A | 返回空，不跨环境返回 |
| TEN-A4 | 未上线访问生产 | 组织未标记上线 | 打开生产路径 | 重定向到沙箱并提示原因 |
| TEN-A5 | 删除预览 | 组织有 5 个客户 | 请求删除 | 返回影响清单，未删除数据 |
| TEN-A6 | 切换后分页 | 列表已翻到第 3 页 | 切换组织 | 游标清空，列表回到第 1 页 |
