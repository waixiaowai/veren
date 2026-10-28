/**
 * 引导式登录授权流：v2 控制台不再展示 key，官方通道是 opencode.ai/auth
 * 页面创建后粘贴——本流把这一步带进 DSH：通知里给出精确入口，key 在线
 * 校验通过后才落凭据记录。第二方法支持从本机 opencode CLI 的登录产物
 * 只读导入（用户自己的机器与 key）。
 * The guided sign-in flow: the v2 console no longer displays keys — the
 * official channel is creating one at opencode.ai/auth and pasting it. This
 * flow brings that step into dsh: the notice names the exact entry point, and
 * the key lands in the credential record only after online validation
 * passes. A second method imports, read-only, from the local opencode CLI's
 * own login artifact (the user's machine, the user's key).
 *
 * @module @veren/opencode-go
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './config.js'
import { OPENCODE_GO_RECORD, commitStoredKey } from './credential.js'
import type { GoCatalog } from './catalog.js'

/** 本机 opencode CLI 登录产物的只读路径。The read-only path of the local opencode CLI's login artifact. */
const LOCAL_CLI_AUTH_JSON = join(homedir(), '.local', 'share', 'opencode', 'auth.json')

/** 授权流注册；流随插件卸载自动注销（registerFlow 自带 dispose）。Registers the flow; it unregisters with plugin unload (registerFlow disposes itself). */
export function registerOpencodeGoFlow(ctx: Context, config: ResolvedConfig, catalog: GoCatalog): void {
  ctx.authorization.registerFlow({
    key: OPENCODE_GO_RECORD,
    label: 'OpenCode Go',
    methods: [
      { id: 'console-key', label: '从 opencode.ai/auth 创建并粘贴 API key / Create a key at opencode.ai/auth and paste it' },
      { id: 'import-local-cli', label: '导入本机 opencode CLI 已登录的 key / Import the key the local opencode CLI is signed in with' },
    ],
    async run(session: AuthorizationSession) {
      const key = session.method === 'import-local-cli'
        ? await importFromLocalCli(session)
        : await pasteFromAuthPage(session)
      await validateAndCommit(ctx, config, catalog, key)
    },
  })
}

/** 方法一：通知入口 → 粘贴。Method one: notify the entry point → paste. */
async function pasteFromAuthPage(session: AuthorizationSession): Promise<string> {
  session.notify({
    message: '在浏览器打开 https://opencode.ai/auth （登录 OpenCode 账号）创建 Go API key，'
      + '然后粘贴到下方。key 只存本机凭据库，不进配置文件。'
      + 'Open https://opencode.ai/auth in your browser (signed in) to create a Go API key, then paste it'
      + ' below. The key is stored only in this machine\'s credential store, never in config files.',
    url: 'https://opencode.ai/auth',
  })
  const key = await session.prompt({ kind: 'text', message: '粘贴 OpenCode Go API key / Paste the OpenCode Go API key' })
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new LlmError('opencode-go: sign-in cancelled: no key entered', 'SIGN_IN_CANCELLED')
  }
  return key.trim()
}

/** 方法二：只读本机 CLI 登录产物；缺条目时指回方法一。Method two: read the local CLI artifact; a missing entry points back to method one. */
async function importFromLocalCli(session: AuthorizationSession): Promise<string> {
  session.notify({
    message: '正在从本机 opencode CLI 的登录产物（auth.json，只读）导入 opencode-go 条目…'
      + 'Importing the opencode-go entry from the local opencode CLI login artifact (auth.json, read-only)…',
  })
  return readLocalCliKey(LOCAL_CLI_AUTH_JSON)
}

/**
 * 从指定 auth.json 只读解析 opencode-go 条目（导出以便测试注入临时路径）。
 * Parses the opencode-go entry from one auth.json, read-only (exported so
 * tests can inject a temporary path).
 */
export function readLocalCliKey(path: string): string {
  let parsed: { 'opencode-go'?: { type?: string; key?: string } }
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as typeof parsed
  } catch {
    throw new LlmError(
      `opencode-go: cannot read ${path}; is the opencode CLI installed and signed in?`
      + ' Use the opencode.ai/auth method instead',
      'LOCAL_IMPORT_UNAVAILABLE',
    )
  }
  const entry = parsed['opencode-go']
  if (entry?.type !== 'api' || typeof entry.key !== 'string' || entry.key.length === 0) {
    throw new LlmError(
      'opencode-go: the local opencode CLI has no opencode-go key stored; sign the CLI in first'
      + ' (`opencode auth login opencode`) or use the opencode.ai/auth method',
      'LOCAL_IMPORT_UNAVAILABLE',
    )
  }
  return entry.key
}

/** 在线校验（GET /models）通过才提交；失败即是失败的终局，不落半成品凭据。 */
/** Commits only after online validation (GET /models) passes; a failure is a loud ending — no half-stored credential. */
async function validateAndCommit(ctx: Context, config: ResolvedConfig, catalog: GoCatalog, key: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.modelsTimeoutMs)
  try {
    catalog.noteListing(await catalog.refresh(key, controller.signal))
  } finally {
    clearTimeout(timer)
  }
  await commitStoredKey(ctx, key)
}
