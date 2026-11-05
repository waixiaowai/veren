/**
 * 编排世界：把配置、令牌化客户端与会话→工作区目录解析收成一处，工具面
 * 只消费这个世界对象，不接触 ctx。
 * The orchestration world: config, the tokenized client, and the
 * session→workspace resolution collected in one place — the tool face
 * consumes only this object and never touches ctx.
 *
 * @module @veren/baidu-pan
 */
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BaiduPanClient } from './client.js'
import type { ResolvedConfig } from './config.js'
import { commitTokens, readStoredTokens } from './credentials.js'
import type { FetchLike } from './wire.js'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 编排世界对象。The orchestration world object. */
export interface BaiduPanWorld {
  readonly config: ResolvedConfig
  readonly client: BaiduPanClient
  /** 凭据面（网关的登录/注销/状态读经它走，与工具面同一个令牌来源）。The credential face (the gateway's sign-in/sign-out/state reads ride it — same token source as the tool face). */
  readonly credentials: CredentialProvider
  /** 注入的 fetch（登录换取/在线校验与客户端同源；缺省全局）。The injected fetch (sign-in exchange/validation share the client's wire; global by default). */
  readonly fetch: FetchLike | undefined
  /** 调用会话的工作区目录；未知会话返回 undefined。The calling session's workspace directory; undefined for an unknown session. */
  readonly workspaceOf: (sessionId: SessionId | undefined) => string | undefined
}

/** 会话→工作区解析：person-agent 先例同型（workspaceRegistry 反查）。The session→workspace resolution: the person-agent precedent's shape (workspaceRegistry reverse lookup). */
function workspaceResolver(registry: WorkspaceRegistryLike): (sessionId: SessionId | undefined) => string | undefined {
  return (sessionId) => {
    if (sessionId === undefined) return undefined
    const workspace = registry.list().find(entry => entry.sessionIds.includes(sessionId))
    return workspace?.path
  }
}

/** 工作区注册表的窄接口（测试可换假实现）。The narrow workspace-registry interface (tests swap in fakes). */
export interface WorkspaceRegistryLike {
  list(): ReadonlyArray<{ readonly sessionIds: readonly SessionId[]; readonly path: string }>
}

/**
 * 组装世界：客户端的令牌读写接在凭据面上，令牌只在出网请求里瞬时存在；
 * fetch 可注入（测试换脚本化假实现）。
 * Assembles the world: the client's token reads/writes wire onto the
 * credential face; tokens exist transiently inside outbound requests only;
 * fetch is injectable (tests swap in a scripted fake).
 */
export function buildWorld(config: ResolvedConfig, credentials: CredentialProvider, workspaceRegistry: WorkspaceRegistryLike, fetch?: FetchLike): BaiduPanWorld {
  const client = new BaiduPanClient({
    config,
    readTokens: () => readStoredTokens(credentials),
    commitTokens: tokens => commitTokens(credentials, tokens),
    ...(fetch === undefined ? {} : { fetch }),
  })
  return { config, client, credentials, fetch, workspaceOf: workspaceResolver(workspaceRegistry) }
}
