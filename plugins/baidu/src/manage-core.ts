/**
 * 危险动作核心：守门删除的共享编排——目标归一、凭证恰好集合比对、通过
 * 才出网。工具面与网页网关共用这一份，杜绝两份实现漂移。
 * The dangerous-action core: the guarded-delete orchestration shared by the
 * tool face and the web gateway — target normalization, exact-voucher set
 * comparison, and only then the outbound call. One implementation for both
 * faces, so they cannot drift apart.
 *
 * @module @veren/baidu-pan/manage-core
 */
import { baiduPanError } from './errors.js'
import { fileManage } from './files-client.js'
import { checkAction, checkPath, type Confirmation } from './guard.js'
import { reasonToCode, requirePath } from './toolkit.js'
import type { BaiduPanWorld } from './world.js'

/**
 * 守门删除：本地先归一与集合比对，未通过绝不发请求；凭证多、少、错任何
 * 一项都以 BDPAN_CONFIRM_REQUIRED 打回。返回归一后的目标路径清单。
 * Guarded delete: normalize and compare locally first — nothing goes out
 * before it passes; any extra, missing, or wrong voucher entry bounces with
 * BDPAN_CONFIRM_REQUIRED. Returns the normalized target paths.
 */
export async function removeGuarded(
  world: BaiduPanWorld, targets: readonly string[], confirmPaths: readonly string[],
): Promise<readonly string[]> {
  for (const path of targets) {
    const verdict = checkPath(path, world.config.root)
    if (!verdict.allowed) throw baiduPanError(reasonToCode(verdict.reason), { detail: `reason=${verdict.reason}` })
  }
  const voucher: Confirmation = { paths: confirmPaths }
  const verdict = checkAction(world.config.root, targets, voucher)
  if (verdict.decision === 'confirm') throw baiduPanError('BDPAN_CONFIRM_REQUIRED', { retryable: true })
  if (verdict.decision === 'deny') throw baiduPanError(reasonToCode(verdict.reason))
  const normalized = targets.map(path => requirePath(world, path))
  await fileManage(world.client, 'delete', normalized.map(path => ({ path })))
  return normalized
}
