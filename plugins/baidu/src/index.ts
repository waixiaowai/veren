/**
 * @veren/baidu-pan —— DSH 百度网盘插件。挂载即注册：十三个模型工具
 * （baidu_pan__whoami/quota/list/search/meta/mkdir/copy/move/rename/
 * delete/share/upload/download，全部经守门 confined 在授权根内）、
 * `baidu-pan` 技能（风险分级与显示纪律）、粘贴式 OAuth 登录流（令牌
 * 只进凭据库）与网页网关（`baiduPan` 命名空间，给人操作的客户端面板）。
 * appKey/secretKey 缺失时配置解析响亮失败——misconfiguration fails loud。
 * @veren/baidu-pan — the dsh Baidu Netdisk plugin. Mounting registers the
 * thirteen model tools (baidu_pan__whoami/quota/list/search/meta/mkdir/
 * copy/move/rename/delete/share/upload/download, all guard-confined to the
 * authorized root), the `baidu-pan` skill (risk tiers and display
 * discipline), the paste sign-in OAuth flow (tokens live only in the
 * credential store), and the web gateway (the `baiduPan` namespace behind
 * the human-operated client panel). Missing appKey/secretKey fails config
 * resolution loudly — misconfiguration fails loud.
 *
 * @module @veren/baidu-pan
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { registerBaiduPanFlow } from './auth-flow.js'
import { resolveConfig, type Config as ConfigShape } from './config.js'
import { commitTokens } from './credentials.js'
import { BaiduPanGatewayService } from './gateway.js'
import { BAIDU_PAN_WORLD_TOKEN, provideWorld } from './service.js'
import { registerBaiduPanSkill } from './skill.js'
import { registerManageTools } from './tools-manage.js'
import { registerReadonlyTools } from './tools-readonly.js'
import { registerShareTool } from './tools-share.js'
import { registerTransferTools } from './tools-transfer.js'
import { buildWorld } from './world.js'

/** Cordis 插件名。The Cordis plugin name. */
export const name = 'baidu-pan'

/** 插件配置形状。The plugin config shape. */
export interface Config extends ConfigShape {}

/** 宿主统一配置契约（缺省值与校验在 config.ts 的 resolveConfig）。 */
/** The host's uniform config contract (defaults and validation live in config.ts's resolveConfig). */
export const Config: z<Config> = z.object({
  appKey: z.string().description('Baidu Netdisk open-platform AppKey (required; from the open-platform console)'),
  secretKey: z.string().description('Baidu Netdisk open-platform SecretKey (required; token endpoint only, never logged)'),
  root: z.string().description('Authorized root inside the netdisk, e.g. /apps/bdpan'),
  requestTimeoutMs: z.number().description('Per-request timeout in milliseconds'),
  maxAttempts: z.number().description('Maximum attempts for transient failures'),
}).description('Baidu Netdisk open-platform app triple, authorized root, and timeouts')

/**
 * 依赖的能力面：tools（工具表）、skills（技能表）、credentials（OAuth
 * 令牌记录）、authorization（登录流）、workspaceRegistry（本地路径基准
 * 目录解析）。
 * The injected capabilities: tools (the tool registry), skills (the skill
 * registry), credentials (the OAuth token record), authorization (the
 * sign-in flow), workspaceRegistry (resolving local-path base directories).
 */
export const inject = ['tools', 'skills', 'credentials', 'authorization', 'workspaceRegistry']

/** 本插件提供的唯一服务面：编排世界（工具面与网页网关共用）。The plugin's one service face: the orchestration world (shared by the tool face and the web gateway). */
export const provide = [BAIDU_PAN_WORLD_TOKEN]

/** 插件入口：登录流 + 编排世界（含网页网关）+ 四组工具表 + 技能表，全部随插件卸载逆序清理。 */
/** Plugin entry: the sign-in flow, the orchestration world (with its web gateway), the four tool groups, and the skill registry — all reverse-order cleaned on unload. */
export const apply = (ctx: Context, config: Config): void => {
  const resolved = resolveConfig(config)
  registerBaiduPanFlow(ctx, resolved, tokens => commitTokens(ctx.credentials, tokens))
  const world = buildWorld(resolved, ctx.credentials, ctx.workspaceRegistry)
  provideWorld(ctx, world)
  ctx.plugin(BaiduPanGatewayService)
  ctx.effect(() => {
    const disposers = [
      registerReadonlyTools(ctx, world),
      registerManageTools(ctx, world),
      registerShareTool(ctx, world),
      registerTransferTools(ctx, world),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'baidu-pan.tools')
  ctx.effect(() => registerBaiduPanSkill(ctx), 'baidu-pan.skill')
}

// 面板（@veren/baidu-pan-ui）只经 import type 引用这些视图类型，运行时零依赖。
// The panel (@veren/baidu-pan-ui) imports these view types as types only — zero runtime dependency.
export type {
  AuthStateView, GatewayOutcome, JobStartedView, ListingView, SignInStartView, SignOutView,
} from './gateway-views.js'
export type { JobFailure, JobPhase, TransferJobSnapshot, TransferKind } from './jobs.js'
export type {
  AccountProfile, DownloadReceipt, FileEntry, FileMeta, OAuthTokens, QuotaSnapshot, ShareReceipt, UploadReceipt,
} from './types.js'
export { BAIDU_GATEWAY_NAME, BAIDU_REMOTE_NAMESPACE } from './gateway.js'
