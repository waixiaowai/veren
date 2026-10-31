/**
 * 余额获取：个人与 CN 企业两种形状，按账号类型选路。
 * Credit fetching: the personal and CN-enterprise shapes, routed by account
 * type.
 *
 * 区域闸承重：企业端点未在国际版实测——国际凭据恰带 enterpriseId 时必须留在
 * 实测过的个人路径。可识别字段缺失是**硬错误而不是 0**："渲染一个貌似合理
 * 的错数字"正是老插件 issue #31 潜伏多年的形态。
 * The region gate is load-bearing: the enterprise endpoint is unverified
 * internationally — an international credential carrying an enterpriseId stays
 * on the measured personal path. A missing recognizable field is a **hard
 * error, not 0** — "a plausible wrong number" is exactly how issue #31 stayed
 * invisible for years.
 *
 * 证据：docs/workbuddy-protocol.cn.md §5；卷宗 upstream.ts:1102-1263。
 * Evidence: docs/workbuddy-protocol.md §5; dossier upstream.ts:1102-1263.
 *
 * @module @veren/workbuddy-protocol/billing
 */

import type { WorkBuddyCreditAccount, WorkBuddyCredits } from './catalog-types.ts'
import { regionProfile, type WorkBuddyRegion } from './region.ts'
import type { RefreshableCredential } from './refresh.ts'
import { JSON_TIMEOUT_MS, type FetchLike } from './upstream-client.ts'
import { billingHeaders } from './upstream-headers.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 企业端点合成行的显示名：该端点只报一个周期配额，没有命名包列表。 */
/** Display name for the enterprise endpoint's one synthetic row: it reports one cycle quota, not named packages. */
const ENTERPRISE_PACKAGE_NAME = 'enterprise'

interface Envelope {
  code: number
  msg: string
  data: unknown
  document: Record<string, unknown>
}

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

function failEnvelope(status: number, envelope: Envelope): Error {
  return new Error(`workbuddy billing failure (http ${status}, code ${envelope.code}): ${envelope.msg.slice(0, 160)}`)
}

/** 本地时间 `YYYY-MM-DD HH:mm:ss`（计费体要求）。Local time formatting the billing body requires. */
function formatLocalTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 解析个人端点的 `Accounts[]` 行，余额取值优先级照实测。Parse personal `Accounts[]` rows with the measured precedence. */
function parsePersonalAccounts(inner: Record<string, unknown>): WorkBuddyCredits {
  const rawAccounts = Array.isArray(inner['Accounts']) ? inner['Accounts'] : []
  const accounts: WorkBuddyCreditAccount[] = []
  let total = 0
  for (const raw of rawAccounts) {
    if (!isObject(raw)) continue
    const numberAt = (key: string): number => (typeof raw[key] === 'number' ? raw[key] as number : 0)
    const size = numberAt('CycleCapacitySize')
    const cycleRemain = numberAt('CycleCapacityRemain')
    const cycleUsed = numberAt('CycleCapacityUsed')
    let remain = size > 0 ? cycleRemain
      : (cycleRemain > 0 || cycleUsed > 0) ? cycleRemain
      : numberAt('CapacityRemain')
    if (remain < 0) remain = 0
    total += remain
    accounts.push({
      packageName: typeof raw['PackageName'] === 'string' ? raw['PackageName'] : '(unnamed)',
      remain,
      size: size > 0 ? size : numberAt('CapacitySize'),
    })
  }
  return { total, accounts }
}

/**
 * 个人端点（国际版一律；CN 无企业 id 的账号）。
 * The personal endpoint (international always; CN accounts without an enterprise id).
 */
async function fetchPersonalCredits(credential: RefreshableCredential, fetchImpl: FetchLike, baseUrl?: string): Promise<WorkBuddyCredits> {
  const billingOrigin = baseUrl ?? regionProfile(credential.region).billingOrigin
  const now = new Date()
  const response = await fetchImpl(`${billingOrigin}/v2/billing/meter/get-user-resource`, {
    method: 'POST',
    headers: billingHeaders(credential),
    body: JSON.stringify({
      PageNumber: 1,
      PageSize: 100,
      ProductCode: 'p_tcaca',
      Status: [0, 3],
      PackageEndTimeRangeBegin: formatLocalTime(now),
      PackageEndTimeRangeEnd: formatLocalTime(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1000)),
    }),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  })
  const envelope = await readEnvelope(response)
  if (!response.ok || envelope.code !== 0) throw failEnvelope(response.status, envelope)
  const wrapper = isObject(envelope.data) ? envelope.data : {}
  const data = isObject(wrapper['Response']) ? wrapper['Response'] : {}
  const inner = isObject(data['Data']) ? data['Data'] : {}
  return parsePersonalAccounts(inner)
}

/** 企业配额三元组（limit 已保证可识别；used 可能缺失）。The enterprise quota triple (`limit` is guaranteed recognized; `used` may be missing). */
interface EnterpriseQuota {
  readonly limit: number
  readonly used: number | undefined
  readonly resetTime: string | undefined
}

/** 企业端点请求的组装与发送：空体 POST，信封校验（http ok + code 0）。Assembles and sends the enterprise request: an empty-body POST with envelope validation (http ok + code 0). */
async function postEnterpriseUsage(credential: RefreshableCredential, fetchImpl: FetchLike, baseUrl?: string): Promise<Envelope> {
  const billingOrigin = baseUrl ?? regionProfile(credential.region).billingOrigin
  const response = await fetchImpl(`${billingOrigin}/v2/billing/meter/get-enterprise-user-usage`, {
    method: 'POST',
    headers: billingHeaders(credential),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  })
  const envelope = await readEnvelope(response)
  if (!response.ok || envelope.code !== 0) throw failEnvelope(response.status, envelope)
  return envelope
}

/** 解析配额三元组：字段拼写两官方调用点不一致（limitNum/credit vs limit_num/used_num），都收。Parses the quota triple; both official field spellings (limitNum/credit vs limit_num/used_num) are accepted. */
function parseEnterpriseQuota(envelope: Envelope): EnterpriseQuota {
  const numberAt = (source: Record<string, unknown>, key: string): number | undefined =>
    typeof source[key] === 'number' ? source[key] as number : undefined
  let limit: number | undefined
  let used: number | undefined
  let resetTime: string | undefined
  // 官方读取器在 data.data、data 或信封本身接载荷；实测 CN 答案把字段放在 data。
  // The official reader accepts the payload at data.data, data, or the envelope; the measured CN answer puts the fields at `data`.
  for (const candidate of [envelope.data, envelope.document]) {
    if (!isObject(candidate)) continue
    const source = isObject(candidate['data']) ? candidate['data'] : candidate
    const candidateLimit = numberAt(source, 'limitNum') ?? numberAt(source, 'limit_num')
    if (candidateLimit === undefined) continue
    limit = candidateLimit
    used = numberAt(source, 'credit') ?? numberAt(source, 'used_num')
    if (typeof source['cycleResetTime'] === 'string' && source['cycleResetTime'] !== '') {
      resetTime = source['cycleResetTime'] as string
    }
    break
  }
  if (limit === undefined) {
    throw new Error('workbuddy enterprise billing response carried no recognised quota field (expected limitNum/limit_num + credit/used_num)')
  }
  return { limit, used, resetTime }
}

/** 由配额三元组合成计费结果：`-1` = 无上限（独立 flag，绝不渲染成 0）。Composes the credits from the quota triple; `-1` means uncapped (a separate flag, never rendered as 0). */
function composeEnterpriseCredits(quota: EnterpriseQuota): WorkBuddyCredits {
  if (quota.limit === -1) {
    return {
      total: 0,
      accounts: [{ packageName: ENTERPRISE_PACKAGE_NAME, remain: 0, size: 0, unlimited: true }],
      unlimited: true,
      ...(quota.resetTime === undefined ? {} : { cycleResetTime: quota.resetTime }),
    }
  }
  // 有配额没用量必须失败而不是假设用 0——默认 0 会从一份读不懂的答案里渲染
  // 出一个自信的"配额全满"。
  // A limit with no usage must fail rather than assume zero used — defaulting to 0 renders a confident "full quota" from a response we could not read.
  if (quota.used === undefined) {
    throw new Error('workbuddy enterprise billing response carried a quota limit but no recognised usage field')
  }
  const remain = Math.max(0, quota.limit - quota.used)
  return {
    total: remain,
    accounts: [{ packageName: ENTERPRISE_PACKAGE_NAME, remain, size: quota.limit }],
    ...(quota.resetTime === undefined ? {} : { cycleResetTime: quota.resetTime }),
  }
}

/**
 * CN 企业端点：一个周期配额。
 * The CN enterprise endpoint: one cycle quota.
 */
async function fetchEnterpriseCredits(credential: RefreshableCredential, fetchImpl: FetchLike, baseUrl?: string): Promise<WorkBuddyCredits> {
  const envelope = await postEnterpriseUsage(credential, fetchImpl, baseUrl)
  return composeEnterpriseCredits(parseEnterpriseQuota(envelope))
}

/**
 * 取一个凭据的聚合余额。cn + enterpriseId 走企业端点，其余走个人端点。
 * Fetch one credential's aggregated credits: cn + enterpriseId takes the
 * enterprise endpoint, everything else the personal one.
 */
export async function fetchCredits(
  credential: RefreshableCredential,
  deps: { fetchImpl?: FetchLike; baseUrl?: string } = {},
): Promise<WorkBuddyCredits> {
  const fetchImpl = deps.fetchImpl ?? fetch
  if (credential.region === 'cn' && credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
    return fetchEnterpriseCredits(credential, fetchImpl, deps.baseUrl)
  }
  return fetchPersonalCredits(credential, fetchImpl, deps.baseUrl)
}

/** 计费别名仅为可读性：上游区域类型再出口一次。A readability alias re-exporting the region type for the billing surface. */
export type BillingRegion = WorkBuddyRegion
