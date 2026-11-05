/**
 * 引导式登录授权流：方法一，打开授权页登录后把授权码粘贴回来（oob 形态，
 * 无回调服务）；方法二，已有令牌的用户直接粘贴 access/refresh 令牌对。
 * 令牌换取成功并在线校验（拉一次账号资料）通过后才落凭据记录——坏码、
 * 坏令牌永不入库。
 * The guided sign-in flow: method one opens the authorize page, signs in,
 * and pastes the code back (oob shape — no callback server); method two,
 * for users already holding tokens, pastes the access/refresh pair directly.
 * Tokens land in the credential record only after the exchange succeeds and
 * the online profile check passes — bad codes and bad tokens never commit.
 *
 * @module @veren/baidu-pan
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { ResolvedConfig } from './config.js'
import { authorizeUrl } from './config.js'
import { BAIDU_PAN_RECORD, type OAuthCommit } from './credentials.js'
import { baiduPanError } from './errors.js'
import { BaiduPanClient } from './client.js'
import { exchangeCodeForTokens, type FetchLike } from './wire.js'
import type { OAuthTokens } from './types.js'

/** 粘贴令牌对的解析：access 与 refresh 以空白分隔；到期与 scope 以占位入库。The token-pair paste parser: access and refresh split by whitespace; expiry and scope land as placeholders. */
function parsePastedTokens(text: string): OAuthTokens {
  const parts = text.trim().split(/\s+/u)
  if (parts.length !== 2 || parts.some(part => part.length === 0)) {
    throw baiduPanError('BDPAN_TOKEN_INVALID', { detail: 'paste "<access_token> <refresh_token>" separated by whitespace' })
  }
  return {
    accessToken: parts[0] ?? '',
    refreshToken: parts[1] ?? '',
    expiresAt: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
    scope: 'unknown',
  }
}

/** 在线校验：拿令牌拉一次账号资料，失败即令牌无效，不落库（授权流与网页网关共用）。The online check: one profile call; its failure means the tokens are invalid — nothing commits (shared by the auth flow and the web gateway). */
export async function validateTokens(config: ResolvedConfig, tokens: OAuthTokens, fetch?: FetchLike): Promise<void> {
  const probe = new BaiduPanClient({
    config,
    readTokens: async () => tokens,
    commitTokens: async () => {},
    ...(fetch === undefined ? {} : { fetch }),
  })
  await probe.profile()
}

/** 方法一：通知授权页入口 → 粘贴授权码 → 换取令牌。Method one: notify the authorize page → paste the code → exchange. */
async function signInByCode(session: AuthorizationSession, config: ResolvedConfig, fetch?: FetchLike): Promise<OAuthTokens> {
  session.notify({
    message: '将打开百度网盘开放平台授权页；登录后复制授权码粘贴到下方。'
      + '授权码只经粘贴传递，不进命令行参数。'
      + 'Open the Baidu Netdisk open-platform authorize page; sign in and paste the code below.'
      + ' The code travels only via paste, never in command-line arguments.',
    url: authorizeUrl(config),
  })
  const code = await session.prompt({ kind: 'text', message: '粘贴授权码 / Paste the authorization code' })
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw baiduPanError('BDPAN_AUTH_REQUIRED', { detail: 'sign-in cancelled: no code entered' })
  }
  return exchangeCodeForTokens(config, code.trim(), fetch)
}

/** 方法二：粘贴已有令牌对（高级用户）。Method two: paste an existing token pair (advanced users). */
async function signInByPaste(session: AuthorizationSession): Promise<OAuthTokens> {
  const text = await session.prompt({
    kind: 'secret',
    message: '粘贴令牌对（access_token 与 refresh_token，空白分隔）'
      + ' / Paste the token pair (access_token and refresh_token, whitespace-separated)',
  })
  return parsePastedTokens(typeof text === 'string' ? text : '')
}

/**
 * 注册授权流；流随插件卸载自动注销（registerFlow 自带 dispose）。换取
 * 或粘贴得到的令牌先过在线校验，再经注入的提交点落凭据记录。
 * Registers the flow; it unregisters with plugin unload (registerFlow
 * disposes itself). Tokens from either method pass the online check before
 * the injected commit point lands them in the credential record.
 */
export function registerBaiduPanFlow(
  ctx: Context, config: ResolvedConfig, commit: OAuthCommit, fetch?: FetchLike,
): void {
  ctx.authorization.registerFlow({
    key: BAIDU_PAN_RECORD,
    label: 'Baidu Netdisk',
    methods: [
      { id: 'authorize-code', label: '打开授权页登录并粘贴授权码 / Open the authorize page and paste the code' },
      { id: 'paste-tokens', label: '粘贴已有令牌对 / Paste an existing token pair' },
    ],
    async run(session: AuthorizationSession) {
      const tokens = session.method === 'paste-tokens'
        ? await signInByPaste(session)
        : await signInByCode(session, config, fetch)
      await validateTokens(config, tokens, fetch)
      await commit(tokens)
    },
  })
}
