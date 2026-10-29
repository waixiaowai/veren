/**
 * 凭据面：`imagegen/account` 记录是本插件唯一的 key 来源。key 永不进配置、
 * 永不进日志；读取方只回答"有没有"，值只在请求头里瞬时存在。
 * The credential face: the `imagegen/account` record is this plugin's only key
 * source. The key never enters configuration or logs; readers answer only
 * "is one stored", and the value exists transiently inside request headers.
 *
 * @module @veren/imagegen
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord, CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ImagegenError } from './errors.js'

/**
 * 本插件持有的凭据记录键：scope 是插件名，id 命名它唯一的凭据。
 * The credential record this plugin owns: the scope is the plugin name and
 * the id names its single credential.
 */
export const IMAGEGEN_RECORD = credentialKey('imagegen', 'account')

/**
 * 读取已存储的 key；未登录回答 undefined（调用方决定是报 IMAGEGEN_NO_KEY
 * 还是引导登录）。
 * Reads the stored key; signed out answers undefined (the caller decides
 * between IMAGEGEN_NO_KEY and guiding a sign-in).
 */
export async function readStoredKey(credentials: CredentialProvider): Promise<string | undefined> {
  const record: CredentialRecord | undefined = await credentials.readRecord(IMAGEGEN_RECORD)
  if (record === undefined || record.kind !== 'api-key') return undefined
  return record.key
}

/**
 * 请求路径的 key 解析：没有就是响亮的 IMAGEGEN_NO_KEY，不静默、不回退。
 * Request-path key resolution: absence is a loud IMAGEGEN_NO_KEY — no silent
 * fallback, no downgrade.
 */
export async function requireStoredKey(credentials: CredentialProvider): Promise<string> {
  const key = await readStoredKey(credentials)
  if (key === undefined) {
    throw new ImagegenError(
      'IMAGEGEN_NO_KEY',
      'no API key is signed in; run the imagegen sign-in flow to paste one first',
    )
  }
  return key
}

/**
 * 提交一条新 key（授权流的唯一写入点；在线校验通过后才调用）。
 * Commits a new key (the authorization flow's single write point; only called
 * after online validation passes).
 */
export async function commitStoredKey(credentials: CredentialProvider, key: string): Promise<void> {
  await credentials.modifyRecord(IMAGEGEN_RECORD, async () => ({ kind: 'api-key', key }))
}
