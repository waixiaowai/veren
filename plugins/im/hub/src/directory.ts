/**
 * The hub-backed cloud directory: the device-side `ImDirectoryRemote` that
 * talks to the CMS people endpoints (`POST /v1/im/hub/people/upsert`,
 * `GET /v1/im/hub/people`) with the device API key. Identity facts live on the
 * hub (data-home ADR row 4); this type only carries them across the wire.
 *
 * hub 支撑的云端目录：设备侧 `ImDirectoryRemote`，以设备 API Key 访问 CMS 人员端点
 * （`POST /v1/im/hub/people/upsert`、`GET /v1/im/hub/people`）。身份事实归云（归属表
 * 第 4 行）；本类型只负责把它们搬过线。
 *
 * @module @veren/im-hub/directory
 */

import type { ImDirectoryRemote, ImDirectorySnapshot, ImDirectoryUpsert } from '@veren/im'

/** Options: the CMS origin and the device API key (same config as the provider). */
export interface HubDirectoryOptions {
  hubBaseUrl: string
  apiKey: string
}

/** CMS 平台信封的窄投影（code=0 即成功）。 */
interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

/** The device-facing cloud directory client. */
export class HubDirectory implements ImDirectoryRemote {
  private readonly hubBaseUrl: string
  private readonly apiKey: string

  constructor(options: HubDirectoryOptions) {
    this.hubBaseUrl = options.hubBaseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
  }

  async upsert(entry: ImDirectoryUpsert): Promise<void> {
    const response = await fetch(`${this.hubBaseUrl}/v1/im/hub/people/upsert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: entry.provider,
        external_id: entry.externalId,
        ...(entry.displayName === undefined ? {} : { display_name: entry.displayName }),
        ...(entry.claimedName === undefined ? {} : { claimed_name: entry.claimedName }),
        ...(entry.identityStatus === undefined ? {} : { identity_status: entry.identityStatus }),
        ...(entry.note === undefined ? {} : { note: entry.note }),
      }),
    })
    await this.envelope(response)
  }

  async pull(): Promise<ImDirectorySnapshot> {
    const response = await fetch(`${this.hubBaseUrl}/v1/im/hub/people`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    })
    return this.envelope<ImDirectorySnapshot>(response)
  }

  /** Unwrap the platform envelope; non-zero codes refuse with the server message. */
  private async envelope<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`hub directory HTTP ${response.status}`)
    const body = (await response.json()) as Envelope<T>
    if (body.code !== 0) throw new Error(`hub directory refused: ${body.message ?? body.code}`)
    return body.data as T
  }
}
