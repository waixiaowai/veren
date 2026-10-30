/**
 * 插件入口：注册单一 `workbuddy` 路由（LlmAdapter）、两区域授权流与 Web 网关。
 * Plugin entry: registers the single `workbuddy` route (an LlmAdapter), both
 * regions' authorization flows, and the web gateway.
 *
 * @module @veren/workbuddy-auth
 */
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { WorkbuddyAdapter } from './adapter.ts'
import { WorkbuddyCatalog } from './catalog.ts'
import { resolveConfig, type Config as ConfigShape } from './config.ts'
import { registerWorkbuddyFlow } from './auth-flow.ts'
import { WorkbuddyGatewayService } from './gateway-remote.ts'
import { WorkbuddyAccounts } from './state-store.ts'

export const name = 'workbuddy-auth'

/** 配置契约（形状在 config.ts，schema 按宿主惯例定义在入口）。 */
/** The config contract (the shape in config.ts; the schema lives here per host convention). */
export interface Config extends ConfigShape {}

export const Config: z<Config> = z.object({
  appVersion: z.string().default(''),
  cliVersion: z.string().default(''),
  catalogMaxAgeMs: z.number().default(600_000),
  requestTimeoutMs: z.number().default(600_000),
}).description('WorkBuddy outbound identity and refresh cadence')

export const inject = ['llm', 'credentials', 'authorization']
export const provide = []

/**
 * 双激活幂等闸：bundle patch 与显式行并存时 loader 会激活两次，第二次静默
 * 让位（照 @veren/opencode-go 先例）。
 * Double-activation guard: with a bundle patch and an explicit row coexisting
 * the loader activates twice; the second yields silently (the @veren/opencode-go
 * precedent).
 */
let mounted = false

/**
 * 接线：账号仓 → 目录 → 授权流 → 适配器注册 → 网关。注册句柄全部进 effect，
 * 卸载逆序清理；宿主占用的 `workbuddy` 路由被占时让位（DUPLICATE_ADAPTER）。
 * Wiring: account store → catalog → flows → adapter registration → gateway.
 * Every handle lands in an effect and disposal unwinds in reverse; a route the
 * host already owns is yielded to (DUPLICATE_ADAPTER).
 */
export function apply(ctx: Context, config: ConfigShape): void {
  if (mounted) {
    ctx.logger.warn({ eq: 'workbuddy-auth' }, 'workbuddy-auth activated twice; ignoring the second activation')
    return
  }
  mounted = true
  ctx.effect(() => () => { mounted = false }, 'workbuddy-auth:mounted-guard')
  const resolved = resolveConfig(config)
  const accounts = new WorkbuddyAccounts(ctx)
  const catalog = new WorkbuddyCatalog(resolved, accounts)
  registerWorkbuddyFlow(ctx, { config: resolved, accounts, catalog })
  const adapter = new WorkbuddyAdapter({ config: resolved, accounts, catalog })
  let disposeRoutes: (() => void) | undefined
  try {
    disposeRoutes = ctx.llm.registerAdapter(['workbuddy'], adapter)
  } catch (error) {
    if (error instanceof LlmError && error.code === 'DUPLICATE_ADAPTER') {
      ctx.logger.warn({ eq: 'workbuddy-auth' }, 'the "workbuddy" route is already owned; yielding')
      return
    }
    throw error
  }
  ctx.effect(() => disposeRoutes, 'workbuddy-auth.registerAdapter')
  ctx.plugin(WorkbuddyGatewayService, accounts)
}
