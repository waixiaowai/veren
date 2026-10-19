# `@veren/admin-access-rbac`

适用于后台部署需要默认角色制授权 provider 的场景：它拥有角色目录与用户角色绑定、为已
认证身份推导权限、执行“最后一位所有者不可被剥离”的防自锁，并注册角色绑定路由；授权来自
外部目录服务时不要使用本包。

## 内置角色

在代码中定义（`src/roles.ts`），因此升级可以直接扩宽角色而无需迁移，部署也不会误删
`owner`。

| 角色 | 权限 |
|---|---|
| `owner` | `ADMIN_PERMISSIONS` 中的全部权限 |
| `admin` | dashboard、users、roles、tokens、audit、capabilities、settings |
| `reviewer` | dashboard、audit、`terminal.tasks.read`、`terminal.tasks.decide` |
| `operator` | dashboard、capabilities |
| `auditor` | dashboard、audit、capabilities |
| `viewer` | dashboard |

自定义角色存放在 `admin_roles`，只做叠加；其权限必须来自权限目录。

## 存储

| 集合 | 内容 |
|---|---|
| `admin_roles` | 自定义角色（`id`、`label`、`permissions`、`createdAt`） |
| `admin_bindings` | 用户↔角色对，id 为 `${userId}:${roleId}` |

`rolesOf(userId)` 读取绑定；`permissionsOf(identity)` 对身份已携带的角色权限取并集，
因此网关每次权限检查都不需要额外查询。

## 路由

全部位于 `/api/admin/v1`：

| 方法 | 路径 | 权限 |
|---|---|---|
| `GET` | `/roles` | `admin.roles.manage` |
| `GET` | `/permissions` | `admin.capabilities.read` |
| `POST` | `/roles` | `admin.roles.manage`（审计） |
| `DELETE` | `/roles/:id` | `admin.roles.manage`（审计） |
| `POST` | `/users/:id/roles` | `admin.roles.manage`（审计） |
| `DELETE` | `/users/:id/roles/:roleId` | `admin.roles.manage`（审计） |

## 防自锁

当该用户是唯一所有者时，`revokeRole(userId, 'owner')` 抛出 `LAST_OWNER`；内置角色不可
删除（`CONFLICT`），未知角色 id 为 `NOT_FOUND`。

## 已知限制

- 删除自定义角色会扫描全部绑定；内嵌部署可接受，SQL 引擎上需要索引查询。
- 绑定与用户之间没有外键；`auth` 删除用户时会一并移除其绑定，但手工改库可能留下孤儿。
- 没有按对象的数据范围：`AdminIdentity.scope` 已存在，但 RBAC 不强制行过滤。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/access-rbac
```
