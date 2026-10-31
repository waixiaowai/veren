/**
 * 页面实例索引源：app-pages 存储域的打开、失败索引兜底与启动清扫。
 * The instance-index source: opening the app_pages storage domain, the failing
 * index fallback, and the startup sweep.
 *
 * 域打开是异步的：先给失败索引（所有操作 page/index-unavailable），打开成功后
 * 原位换成 KV 实现（打开失败保持降级——misconfiguration fails loud，不静默
 * 假成功）。reserved 残留行（崩溃遗迹）在打开后清扫一次（§3.5.3/§7.5）。
 * The domain opens asynchronously: the failing index (every operation rejects
 * with page/index-unavailable) serves first, and is swapped in place for the
 * KV implementation on success (a failed open keeps the degrade — fail loud,
 * never fake success). Stale reserved rows (crash debris) are swept once after
 * the open (§3.5.3/§7.5).
 *
 * @module @veren/page-registry/index-source
 */
import type { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, PageError, PageErrorCode } from '@veren/prompt-page'
import type { InstanceKvPort, PageInstanceIndex } from '@veren/prompt-page'
import { APP_PAGES_DOMAIN_NAME, appPagesDomain, instanceTableView } from './storage.ts'
import type { PageSessionPort } from './runtime-ports.ts'

/** 存储不可用时的失败索引：所有操作给 page/index-unavailable / the failing index */
class UnavailableIndex implements PageInstanceIndex {
  lookup(): Promise<undefined> { return Promise.reject(unavailable()) }
  reserve(): Promise<never> { return Promise.reject(unavailable()) }
  commit(): Promise<never> { return Promise.reject(unavailable()) }
  deprecate(): Promise<never> { return Promise.reject(unavailable()) }
  fail(): Promise<never> { return Promise.reject(unavailable()) }
  forget(): Promise<never> { return Promise.reject(unavailable()) }
  listByApp(): Promise<never> { return Promise.reject(unavailable()) }
  sweepReserved(): Promise<never> { return Promise.reject(unavailable()) }
}

function unavailable(): PageError {
  return new PageError(PageErrorCode.IndexUnavailable, `storage domain "${APP_PAGES_DOMAIN_NAME}" is unavailable; the instance index is read-only-failing`)
}

/**
 * 索引箱：服务持有它而不是裸索引面——打开完成前的失败索引与打开后的 KV 实现
 * 都从这里读，装配层传入的替身索引经 replace 原位换入（测试/装配缝隙）。
 * The index box: the service holds this instead of a bare index face — the
 * pre-open failing index and the post-open KV implementation both read from
 * here, and a stand-in index from the assembly lands via replace (the
 * assembly/test seam).
 */
export interface InstanceIndexBox {
  /** 当前索引面 / the current face */
  get(): PageInstanceIndex
  /** 原位替换索引面（装配缝隙）/ swap the face in place (the assembly seam) */
  replace(face: PageInstanceIndex): void
  /** 打开存储域并换实现（含启动清扫；打开失败保持失败索引降级）/ open the domain and swap in the KV face (sweep included; failed opens keep degrading) */
  open(): Promise<void>
}

/**
 * 构造索引箱并立刻开始打开存储域。`sessionsOf` 惰性读会话端口（清扫判
 * "reserved 行的会话是否在场"，投递发生时端口必然已接线）。
 * Build the box and start opening the domain right away. `sessionsOf` reads
 * the session port lazily (the sweep asks whether a reserved row's session is
 * still present; ports are always bound by then).
 */
export function createInstanceIndexBox(ctx: Context, sessionsOf: () => PageSessionPort): InstanceIndexBox {
  let face: PageInstanceIndex = new UnavailableIndex()
  return {
    get: () => face,
    replace: (next) => { face = next },
    open: () => openDomain(ctx).then(async (table) => {
      if (table === undefined) return
      face = new KvPageInstanceIndex(table, { sessionExists: (id) => sessionsOf().exists(id) })
      await sweepReservedRows(ctx, face)
      // 索引重建扫描（§3.5.4）：第 1 阶段不做——会话端口没有枚举会话/读
      // app/page 事件的面，做不了真实重建；此处如实标注而非含糊带过，
      // 见 docs/application-concept.cn.md §8.1 收尾说明。
      // Index rebuild scan (§3.5.4): intentionally not done in phase 1 — the
      // session port cannot enumerate sessions or read app/page events; noted
      // honestly instead of glossed over, see the design doc §8.1.
    }, (error: unknown) => {
      ctx.logger.error(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" failed to open: ${String(error)}`)
    }),
  }
}

/** 启动清扫：reserved 残留行（崩溃遗迹）→ 没有对应活会话就删（§3.5.3/§7.5）/ the startup sweep: drop reserved rows whose session is gone */
async function sweepReservedRows(ctx: Context, face: PageInstanceIndex): Promise<void> {
  try {
    const dropped = await face.sweepReserved()
    if (dropped.length > 0) ctx.logger.info(`page-registry: swept ${dropped.length} stale reserved row(s) at startup`)
  } catch (error: unknown) {
    ctx.logger.warn(`page-registry: reserved-row sweep failed: ${String(error)}`)
  }
}

/**
 * 打开 app-pages 存储域。storageDomain 是本服务声明过的 inject 依赖；这里
 * 捕获的是"存储域打不开/服务缺席"的运行故障 → 失败索引 + 告警，是既有文档
 * 化的降级语义，不是对兄弟服务的运行期探测（G13 禁的是后者）。
 * Open the app-pages storage domain. storageDomain is a declared inject; the
 * catch handles genuine storage failures (documented degrade to the failing
 * index), not sibling probing, which G13 forbids.
 */
async function openDomain(ctx: Context): Promise<InstanceKvPort | undefined> {
  try {
    // 一次重激活可能留下上一个激活打开的同名域：先关掉再开（与 notebook 同型）
    // / one re-activation may leave the same domain open by the previous
    // activation: close it first (same shape as notebook)
    const stale = ctx.storageDomain.get(APP_PAGES_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        ctx.logger.warn('page-registry: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        ctx.logger.warn(`page-registry: the previous storage domain could not close: ${String(error)}`)
      }
    }
    const domain = await ctx.storageDomain.open(appPagesDomain)
    // 句柄归本服务：卸载时关闭，给下一次激活腾出名字
    // / the handle belongs to this service: closed on unload, freeing the name
    ctx.effect(() => () => domain.close(), 'page-registry:storage')
    return instanceTableView(domain.table('instances'))
  } catch (error: unknown) {
    ctx.logger.warn(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" unavailable (${String(error)}); instance index is disabled`)
    return undefined
  }
}
