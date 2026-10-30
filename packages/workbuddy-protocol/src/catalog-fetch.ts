/**
 * 目录在线获取：两区域同一 `/v3/config` 路径，按 User-Agent 分流；CN 最佳
 * 努力合并控制台文档的促销标签。
 * Live catalog fetch: both regions hit the same `/v3/config` path, split by
 * User-Agent; CN merges the console document's promo badges best-effort.
 *
 * 证据：docs/workbuddy-protocol.cn.md §4；卷宗 upstream.ts:978-1100。
 * Evidence: docs/workbuddy-protocol.md §4; dossier upstream.ts:978-1100.
 *
 * @module @veren/workbuddy-protocol/catalog-fetch
 */

import type { WorkBuddyUpstreamModel } from './catalog-types.ts'
import { parseModelCatalog } from './catalog-parse.ts'
import { appUserAgent } from './identity.ts'
import { regionProfile, type WorkBuddyRegion } from './region.ts'
import type { RefreshableCredential } from './refresh.ts'
import { JSON_TIMEOUT_MS, type FetchLike } from './upstream-client.ts'
import { catalogHeaders } from './upstream-headers.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 上游信封（catalog 端点偶见裸文档，见 parseCatalogDocument）。 */
/** The upstream envelope (the catalog endpoint sometimes answers bare — see parseCatalogDocument). */
interface Envelope {
  code: number
  msg: string
  data: unknown
  document: Record<string, unknown>
}

/** 读响应并解信封；非 JSON/非对象 = 硬错误。Read the response and unwrap; non-JSON/non-object is a hard error. */
async function readEnvelope(response: Response): Promise<Envelope> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`)
  }
  if (!isObject(parsed)) throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`)
  return {
    code: typeof parsed['code'] === 'number' ? parsed['code'] : 0,
    msg: typeof parsed['msg'] === 'string' ? parsed['msg'] : '',
    data: 'data' in parsed ? parsed['data'] : undefined,
    document: parsed,
  }
}

/**
 * 目录端点的两形状：通常有 `{code,msg,data}` 信封；国际版 `/v3/config` 也见过
 * 裸产品文档。`data` 缺失但文档自身带 `models`/`agents` 时以文档为答案——把
 * 这第二形状当空文档会把一次正常答案误判为"没有 cli 模型"。
 * The catalog endpoint's two shapes: usually the envelope; the international
 * `/v3/config` has also answered with the bare product document. A missing
 * `data` with a document that itself carries `models`/`agents` means the
 * document is the answer.
 */
function parseCatalogDocument(envelope: Envelope, status: number): Record<string, unknown> {
  if (status !== 200 && status >= 400) {
    throw new Error(`workbuddy catalog failed (http ${status}): ${envelope.msg.slice(0, 160)}`)
  }
  if (envelope.code !== 0) {
    throw new Error(`workbuddy catalog business failure (code ${envelope.code}): ${envelope.msg.slice(0, 160)}`)
  }
  return isObject(envelope.data) ? envelope.data
    : 'models' in envelope.document || 'agents' in envelope.document ? envelope.document
    : {}
}

/** 从控制台文档读 `badge:` 标签（按模型 id）。任何失败返回 undefined——失败只丢标签不丢目录。 */
/** Read `badge:` tags from the console document by model id. Any failure answers undefined — it costs badges, never the catalog. */
async function fetchPromoBadges(
  credential: RefreshableCredential,
  fetchImpl: FetchLike,
): Promise<ReadonlyMap<string, readonly string[]> | undefined> {
  try {
    const { base } = regionProfile(credential.region)
    const response = await fetchImpl(`${base}/console/enterprises/personal/models`, {
      headers: catalogHeaders(credential, 'CLI/2.63.2 CodeBuddy/2.63.2', false),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const envelope = await readEnvelope(response)
    const data = isObject(envelope.data) ? envelope.data : envelope.document
    const rawModels = Array.isArray(data['models']) ? data['models'] : []
    const badges = new Map<string, readonly string[]>()
    for (const model of rawModels) {
      if (!isObject(model)) continue
      const id = typeof model['id'] === 'string' ? model['id'] : ''
      if (id === '') continue
      const tags = Array.isArray(model['tags'])
        ? model['tags'].filter((tag): tag is string => typeof tag === 'string' && tag.toLowerCase().startsWith('badge:'))
        : []
      if (tags.length > 0) badges.set(id, tags)
    }
    return badges.size === 0 ? undefined : badges
  } catch {
    return undefined
  }
}

/** 一次成功目录获取的出处（状态卡显示用）。Provenance of one successful catalog fetch. */
export interface CatalogFetchInfo {
  readonly fetchedAtMs: number
  /** 哪个文档回答了，如 `workbuddy-ai:app`。Which document answered, e.g. `workbuddy-ai:app`. */
  readonly source: string
}

/**
 * GET 目录并解析。CN 用 CLI UA（领 CLI 花名册——本插件能 chat 的正是这份），
 * 国际版用无空格 App UA（带空格的形态被 400/12403 拒）。
 * GET and parse the catalog. CN presents the CLI UA (drawing the CLI roster —
 * exactly the chat models this plugin can serve); international presents the
 * no-space App UA (the spaced form is rejected with 400/12403).
 */
export async function fetchCatalog(
  credential: RefreshableCredential,
  appVersion: string,
  deps: { fetchImpl?: FetchLike; signal?: AbortSignal; baseUrl?: string } = {},
): Promise<{ models: readonly WorkBuddyUpstreamModel[]; info: CatalogFetchInfo }> {
  const region = credential.region
  const international = region === 'global'
  const fetchImpl = deps.fetchImpl ?? fetch
  const signal = deps.signal === undefined
    ? AbortSignal.timeout(JSON_TIMEOUT_MS)
    : AbortSignal.any([deps.signal, AbortSignal.timeout(JSON_TIMEOUT_MS)])
  const base = deps.baseUrl ?? regionProfile(region).base
  const response = await fetchImpl(`${base}/v3/config`, {
    headers: catalogHeaders(credential, international ? appUserAgent(appVersion) : 'CLI/2.63.2 CodeBuddy/2.63.2', international),
    signal,
  })
  const envelope = await readEnvelope(response)
  const document = parseCatalogDocument(envelope, response.status)
  // 促销标签只活在控制台文档；CN 二次读取合并，国际版文档自带 modelPromotions。
  // Promo badges live only in the console document; CN reads it in a second call, the international document carries modelPromotions itself.
  const promoBadges = international ? undefined : await fetchPromoBadges(credential, fetchImpl)
  return {
    models: parseModelCatalog(document, international, promoBadges),
    info: { fetchedAtMs: Date.now(), source: international ? 'workbuddy-ai:app' : 'workbuddy:cli' },
  }
}
