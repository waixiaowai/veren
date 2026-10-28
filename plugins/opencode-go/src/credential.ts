/**
 * 凭据面：`opencode-go/account` 记录是本插件唯一的 key 来源。key 永不进
 * 配置、永不进日志；读取方只回答"有没有"，值只在请求头里瞬时存在。
 * The credential face: the `opencode-go/account` record is this plugin's only
 * key source. The key never enters configuration or logs; readers answer only
 * "is one stored", and the value exists transiently inside request headers.
 *
 * @module @veren/opencode-go
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * 本插件持有的凭据记录键：scope 是插件名，id 命名它唯一的凭据。
 * The credential record this plugin owns: the scope is the plugin name and
 * the id names its single credential.
 */
export const OPENCODE_GO_RECORD = credentialKey('opencode-go', 'account')

/**
 * 读取已存储的 key；未登录回答 undefined（调用方决定是报
 * SIGN_IN_REQUIRED 还是静默降级）。
 * Reads the stored key; signed out answers undefined (the caller decides
 * between SIGN_IN_REQUIRED and a silent downgrade).
 */
export async function readStoredKey(ctx: Context): Promise<string | undefined> {
  const record: CredentialRecord | undefined = await ctx.credentials.readRecord(OPENCODE_GO_RECORD)
  if (record === undefined) return undefined
  if (record.kind !== 'api-key') return undefined
  return record.key
}

/**
 * 请求路径的 key 解析：没有就是响亮的 SIGN_IN_REQUIRED，不静默、不回退。
 * Request-path key resolution: absence is a loud SIGN_IN_REQUIRED — no
 * silent fallback, no downgrade.
 */
export async function requireStoredKey(ctx: Context): Promise<string> {
  const key = await readStoredKey(ctx)
  if (key === undefined) {
    throw new LlmError(
      'opencode-go: no API key is signed in; run the OpenCode Go sign-in flow'
      + ' (create a key at https://opencode.ai/auth) before calling this route',
      'SIGN_IN_REQUIRED',
    )
  }
  return key
}

/**
 * 提交一条新 key（授权流的唯一写入点；写前已完成在线校验）。
 * Commits a new key (the authorization flow's single write point; online
 * validation has already passed before this runs).
 */
export async function commitStoredKey(ctx: Context, key: string): Promise<void> {
  await ctx.credentials.modifyRecord(OPENCODE_GO_RECORD, async () => ({ kind: 'api-key', key }))
}
