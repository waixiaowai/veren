/**
 * `@veren/admin-ui-kernel` — the Host side of the browser UI runtime.
 *
 * The kernel owns the pack registry and the two manifests the SPA reads before
 * and after sign-in. The browser side is a same-origin ESM bundle served by
 * `admin-web`; packs carry only data and one `activate(runtime)` function.
 *
 * `@veren/admin-ui-kernel` — 浏览器 UI 运行时的宿主侧。内核拥有包注册表以及 SPA 在
 * 登录前后读取的两份清单。浏览器侧是由 `admin-web` 提供的同源 ESM 包；UI 包只携带数据
 * 与一个 `activate(runtime)` 函数。
 *
 * @module @veren/admin-ui-kernel
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { UI_CONTRACT_VERSION, type UiManifest } from '@veren/admin-ui-contract'
import { satisfies } from '@veren/admin-kernel'
import { UiPackRegistry, type UiAsset, type UiPackRegistration } from './registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-side UI pack registry. 宿主侧 UI 包注册表。 */
    adminUi: AdminUiKernel
  }
}

/** Plugin display name. 插件显示名。 */
export const name = 'admin-ui-kernel'

/** The kernel needs the capability registry for its contract-range check. 内核需要能力注册表来做契约范围判定。 */
export const inject = ['admin'] as const

/** UI kernel configuration. UI 内核配置。 */
export interface Config {}

export const Config: z<Config> = z.object({})

/**
 * The UI kernel service (`ctx.adminUi`).
 *
 * UI kernel 服务（`ctx.adminUi`）。
 */
export class AdminUiKernel extends Service {
  /** The pack registry. 包注册表。 */
  readonly registry = new UiPackRegistry(UI_CONTRACT_VERSION)

  /**
   * @param ctx - owning context 所属上下文
   */
  constructor(ctx: Context) {
    super(ctx, 'adminUi')
  }

  /**
   * Register one UI pack.
   *
   * @param pack - manifest and absolute pack directory 清单与包目录绝对路径
   * @returns the disposer removing it 移除它的 disposer
   */
  register(pack: UiPackRegistration): () => void {
    return this.registry.register(pack, (range) => satisfies(UI_CONTRACT_VERSION, range))
  }

  /**
   * The manifest for one audience.
   *
   * @param audience - `public` before sign-in, `admin` after 登录前 `public`，登录后 `admin`
   * @returns the published manifest 发布的清单
   */
  manifest(audience: 'public' | 'admin'): UiManifest {
    return this.registry.manifest(audience)
  }

  /**
   * Resolve one pack asset.
   *
   * @param packId - pack id 包 id
   * @param relative - path relative to the pack root 相对包根的路径
   * @returns the resolved asset, or `undefined` 解析后的资源或 `undefined`
   */
  asset(packId: string, relative: string): UiAsset | undefined {
    return this.registry.asset(packId, relative)
  }
}

/**
 * Plugin entry.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  void config
  new AdminUiKernel(ctx)
}

export { UiPackRegistry } from './registry.ts'
export type { UiAsset, UiPackRegistration } from './registry.ts'
