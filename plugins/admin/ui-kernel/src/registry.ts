/**
 * Host-side registry of browser UI packs.
 *
 * Packs are same-origin ESM files served from their own package directory. The
 * kernel validates the contract range, publishes the manifest per audience and
 * resolves asset paths without ever escaping a pack directory.
 *
 * 浏览器 UI 包的宿主侧注册表。包是从各自包目录提供的同源 ESM 文件。内核校验契约范围、
 * 按受众发布清单，并在解析资源路径时绝不越出包目录。
 *
 * @module @veren/admin-ui-kernel/registry
 */

import { resolve, sep } from 'node:path'
// 结构化错误来自宿主契约包，不在 ui-contract 里；ui-contract 只声明 UI 词汇。
// The structured error comes from the Host contract package, not ui-contract;
// ui-contract declares only the UI vocabulary.
import { AdminError } from '@veren/admin-contract'
import {
  type UiManifest,
  type UiPackKind,
  type UiPackManifest,
} from '@veren/admin-ui-contract'

/** Kinds available before sign-in; everything else requires a session. 登录前可用的种类；其余需要会话。 */
const PUBLIC_KINDS: readonly UiPackKind[] = ['shell', 'theme', 'locale', 'icons']

/** File extensions the asset resolver serves. 资源解析器提供的文件扩展名。 */
const SERVED_EXTENSIONS: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** One registered pack: its manifest plus the directory its files live in. 已注册的包：清单加上文件所在目录。 */
export interface UiPackRegistration {
  /** Published manifest. 发布的清单。 */
  readonly manifest: UiPackManifest
  /** Absolute package directory. 包目录绝对路径。 */
  readonly root: string
}

/** One resolved asset. 一个解析后的资源。 */
export interface UiAsset {
  /** Absolute file path. 文件绝对路径。 */
  readonly path: string
  /** Content type to serve it with. 提供该资源的内容类型。 */
  readonly contentType: string
}

/** The pack registry. 包注册表。 */
export class UiPackRegistry {
  /** Registered packs by id. 按 id 索引的已注册包。 */
  private readonly packs = new Map<string, UiPackRegistration>()

  /** Contract version every pack is negotiated against. 用于协商的契约版本。 */
  private readonly contractVersion: string

  /**
   * @param contractVersion - contract version to negotiate against 用于协商的契约版本
   */
  constructor(contractVersion: string) {
    this.contractVersion = contractVersion
  }

  /**
   * Register one pack.
   *
   * @param registration - manifest and pack directory 清单与包目录
   * @param admits - contract range test from the Host kernel 宿主内核的契约范围判定
   * @returns the disposer removing it 移除它的 disposer
   * @throws AdminError `CONFLICT` on a duplicate id, `CONTRACT_INCOMPATIBLE` on a bad range
   */
  register(registration: UiPackRegistration, admits: (range: string) => boolean): () => void {
    const { manifest } = registration
    if (!admits(manifest.uiContract)) {
      throw new AdminError(
        'CONTRACT_INCOMPATIBLE',
        `UI pack '${manifest.id}' implements uiContract ${manifest.uiContract}, which excludes ${this.contractVersion}`,
        { pack: manifest.id, uiContract: manifest.uiContract, contractVersion: this.contractVersion },
      )
    }
    if (this.packs.has(manifest.id)) {
      throw new AdminError('PROVIDER_CONFLICT', `UI pack id '${manifest.id}' is already registered`, { pack: manifest.id })
    }
    const entry: UiPackRegistration = registration
    this.packs.set(manifest.id, entry)
    return () => {
      if (this.packs.get(manifest.id) === entry) this.packs.delete(manifest.id)
    }
  }

  /**
   * Publish the manifest for one audience.
   *
   * @param audience - `public` before sign-in, `admin` after 登录前 `public`，登录后 `admin`
   * @returns the manifest 清单
   */
  manifest(audience: 'public' | 'admin'): UiManifest {
    const packs = [...this.packs.values()]
      .filter((entry) => audience === 'admin' || PUBLIC_KINDS.includes(entry.manifest.kind))
      .map((entry) => entry.manifest)
      .sort((left, right) => left.kind.localeCompare(right.kind) || (left.order ?? 0) - (right.order ?? 0))
    return { uiContract: this.contractVersion, packs }
  }

  /**
   * Resolve one pack asset, refusing paths outside the pack directory.
   *
   * @param packId - pack id 包 id
   * @param relative - request path relative to the pack root 相对包根的请求路径
   * @returns the asset, or `undefined` when unknown or disallowed 资源；未知或不允许时为 `undefined`
   */
  asset(packId: string, relative: string): UiAsset | undefined {
    const pack = this.packs.get(packId)
    if (pack === undefined) return undefined
    const root = resolve(pack.root)
    const candidate = resolve(root, `.${relative.startsWith('/') ? relative : `/${relative}`}`)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined
    const extension = candidate.slice(candidate.lastIndexOf('.'))
    const contentType = SERVED_EXTENSIONS[extension]
    if (contentType === undefined) return undefined
    return { path: candidate, contentType }
  }

  /**
   * @param packId - pack id 包 id
   * @returns the registered pack, or `undefined` 已注册包或 `undefined`
   */
  get(packId: string): UiPackRegistration | undefined {
    return this.packs.get(packId)
  }
}
