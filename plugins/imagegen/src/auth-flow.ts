/**
 * 引导式登录授权流：OpenAI 平台创建 key 后粘贴，或从宿主进程环境变量
 * 只读导入（IMAGEGEN_API_KEY 优先，OPENAI_API_KEY 兜底）。key 在
 * `GET /models` 在线校验通过后才落凭据记录——坏 key 永不入库。
 * The guided sign-in flow: paste a key created on the OpenAI platform, or
 * import read-only from the host process environment (IMAGEGEN_API_KEY first,
 * OPENAI_API_KEY as fallback). The key lands in the credential record only
 * after `GET /models` validation passes online — a bad key never commits.
 *
 * @module @veren/imagegen
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { ResolvedConfig } from './config.js'
import { commitStoredKey, IMAGEGEN_RECORD } from './credential.js'
import { ImagegenError } from './errors.js'
import { validateKey, type WireClient } from './wire.js'

/** 环境变量读取注入点（测试换假实现）。The env read injection point (tests swap in fakes). */
export type EnvReader = (name: string) => string | undefined

/** 组装一次性校验客户端。Builds a one-shot validating client. */
function validatingClient(config: ResolvedConfig, key: string): WireClient {
  return { baseURL: config.baseURL, apiKey: key, timeoutMs: 15_000, maxAttempts: 1, fetch: globalThis.fetch }
}

/** 注册授权流；流随插件卸载自动注销（registerFlow 自带 dispose）。 */
/** Registers the flow; it unregisters with plugin unload (registerFlow disposes itself). */
export function registerImagegenFlow(
  ctx: Context, config: ResolvedConfig, readEnv: EnvReader = name => process.env[name],
): void {
  ctx.authorization.registerFlow({
    key: IMAGEGEN_RECORD,
    label: 'Image Generation',
    methods: [
      { id: 'paste-key', label: '从平台创建并粘贴 Images API key / Create an Images API key on the platform and paste it' },
      { id: 'import-env', label: '从本机环境变量导入 / Import from this machine\'s environment variables' },
    ],
    async run(session: AuthorizationSession) {
      const key = session.method === 'import-env'
        ? importFromEnv(session, readEnv)
        : await pasteFromPlatform(session)
      if (!(await validateKey(validatingClient(config, key)))) {
        throw new ImagegenError('IMAGEGEN_API_ERROR', 'the pasted key was rejected by the endpoint; nothing was stored')
      }
      await commitStoredKey(ctx.credentials, key)
    },
  })
}

/** 方法一：通知入口 → 粘贴。Method one: notify the entry point → paste. */
async function pasteFromPlatform(session: AuthorizationSession): Promise<string> {
  session.notify({
    message: '在平台控制台创建 Images API key（如 https://platform.openai.com/api-keys），'
      + '然后粘贴到下方。key 只存本机凭据库，不进配置文件。'
      + 'Create an Images API key in your platform console (e.g. https://platform.openai.com/api-keys),'
      + ' then paste it below. The key is stored only in this machine\'s credential store, never in config files.',
  })
  const key = await session.prompt({ kind: 'text', message: '粘贴 Images API key / Paste the Images API key' })
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new ImagegenError('IMAGEGEN_NO_KEY', 'sign-in cancelled: no key entered')
  }
  return key.trim()
}

/** 方法二：只读环境变量；两者都缺时指向方法一。Method two: read-only env; a miss points back to method one. */
function importFromEnv(session: AuthorizationSession, readEnv: EnvReader): string {
  const key = readEnv('IMAGEGEN_API_KEY') ?? readEnv('OPENAI_API_KEY')
  if (key === undefined || key.trim().length === 0) {
    throw new ImagegenError('IMAGEGEN_NO_KEY',
      'neither IMAGEGEN_API_KEY nor OPENAI_API_KEY is set in the host environment; use the paste method instead')
  }
  session.notify({
    message: '已从宿主进程环境变量导入 key（只读）。Imported the key from the host process environment (read-only).',
  })
  return key.trim()
}
