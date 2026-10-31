/**
 * Request-body schemas of the auth-local routes.
 *
 * Every route validates its untrusted body through one of these zod schemas;
 * the gateway applies them, so handlers can read `request.body` as the parsed
 * shape.
 *
 * auth-local 各路由的请求体 schema。每条路由的不可信请求体都经由这里的 zod schema
 * 校验（由网关执行），handler 因此可以把 `request.body` 当作已解析形状读取。
 *
 * @module @veren/admin-auth-local/route-bodies
 */

import { z as zod } from 'zod'

/** Sign-in request body. 登录请求体。 */
export const loginBody = zod.object({ email: zod.string().min(1), password: zod.string().min(1) })

/** First-run setup request body. 首次初始化请求体。 */
export const setupBody = zod.object({ email: zod.string().min(1), password: zod.string().min(1), name: zod.string().min(1) })

/** User creation request body. 用户创建请求体。 */
export const createUserBody = zod.object({
  email: zod.string().min(1),
  password: zod.string().min(1),
  name: zod.string().min(1),
  roles: zod.array(zod.string()).optional(),
})

/** User update request body. 用户更新请求体。 */
export const updateUserBody = zod.object({
  name: zod.string().min(1).optional(),
  active: zod.boolean().optional(),
  password: zod.string().min(1).optional(),
})

/** Self-service password change body. 自助修改密码请求体。 */
export const changePasswordBody = zod.object({
  currentPassword: zod.string().min(1),
  newPassword: zod.string().min(1),
})

/** Token creation request body. Token 创建请求体。 */
export const createTokenBody = zod.object({
  name: zod.string().min(1),
  scopes: zod.array(zod.string()).default([]),
})
