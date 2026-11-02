/**
 * 凭据面：`zhihu-ops/open-platform` 记录是本插件唯一的 Access Secret 来源。
 *
 * 密钥永不进配置、永不进日志。读取方只回答"有没有"，值只在请求头里瞬时存在。
 *
 * The credential face: the `zhihu-ops/open-platform` record is this plugin's
 * only source of the access secret.
 *
 * The secret never enters configuration or logs. Readers answer only "is one
 * stored", and the value exists transiently inside the request header.
 *
 * @module @veren/zhihu-ops/credential
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/**
 * 本插件持有的凭据记录键：scope 是插件名，id 命名它唯一的凭据。
 * The credential record this plugin owns: the scope is the plugin name and
 * the id names its single credential.
 */
export const ZHIHU_OPS_RECORD = credentialKey('zhihu-ops', 'open-platform')

/**
 * 读取已存储的密钥；未授权回答 undefined。
 * Reads the stored secret; signed out answers undefined.
 *
 * @param credentials - the credential provider / 凭据提供方
 * @returns the secret, or undefined while none is stored / 密钥，未存则 undefined
 */
export async function readStoredSecret(credentials: CredentialProvider): Promise<string | undefined> {
  const record: CredentialRecord | undefined = await credentials.readRecord(ZHIHU_OPS_RECORD)
  if (record === undefined || record.kind !== 'api-key') return undefined
  return record.key
}

/**
 * 提交一条新密钥（授权面的唯一写入点）。
 * Commits a new secret (the authorization face's single write point).
 *
 * @param credentials - the credential provider / 凭据提供方
 * @param secret - the access secret to store / 要存的 Access Secret
 */
export async function commitStoredSecret(credentials: CredentialProvider, secret: string): Promise<void> {
  await credentials.modifyRecord(ZHIHU_OPS_RECORD, async () => ({ kind: 'api-key', key: secret }))
}
