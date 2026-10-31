/**
 * The cloud directory seam (data-home ADR row 4): people identity lives on the
 * hub; a device pushes observations upstream and adopts the snapshot into its
 * local cache.
 *
 * 云端目录缝（归属表第 4 行）：人员身份归 hub；设备把观察上报上游并把快照采纳进本地缓存。
 *
 * @module @veren/im/contract-directory
 */

/**
 * The cloud directory seam (data-home ADR row 4): people identity lives on the
 * hub; a device pushes observations upstream and adopts the snapshot into its
 * local cache. Optional — absent, the directory stays device-local (the
 * direct-WeChat single-machine shape).
 * 云端目录缝（归属表第 4 行）：人员身份归 hub；设备把观察上报上游并把快照采纳进本地
 * 缓存。可选——缺席时目录保持设备本地（直连微信单机形态不回归）。
 */
export interface ImDirectoryUpsert {
  provider: string
  externalId: string
  displayName?: string
  claimedName?: string
  identityStatus?: string
  note?: string
}

/** The hub wire shapes (snake_case, mirrored from the CMS user/device plane). */
/** hub 线上形状（snake_case，镜像 CMS 用户/设备面）。 */
export interface ImDirectorySnapshot {
  people: Array<{
    id: string
    owner_id: string
    display_name: string
    claimed_name: string
    identity_status: string
    note: string
    updated_at: number
  }>
  addresses: Record<string, Array<{
    person_id: string
    provider: string
    external_id: string
    display_name: string
    updated_at: number
  }>>
}

export interface ImDirectoryRemote {
  /** Push one observation upstream; idempotent by (provider, externalId). */
  /** 上报一条观察；(provider, externalId) 幂等。 */
  upsert(entry: ImDirectoryUpsert): Promise<void>
  /** Pull the whole directory snapshot (device read-cache refresh). */
  /** 拉取整份目录快照（设备读缓存刷新）。 */
  pull(): Promise<ImDirectorySnapshot>
}
