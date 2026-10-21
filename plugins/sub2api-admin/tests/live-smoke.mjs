/**
 * 线上只读+可逆写自测：真实驱动 src 里的 store 与工具。
 * Live smoke: exercise the real store slices and one reversible write.
 * 用法：node --import <tsx> tests/live-smoke.mjs（凭据来自环境变量）
 */
const BASE = process.env.SUB2API_BASE_URL
const EMAIL = process.env.SUB2API_EMAIL
const PASSWORD = process.env.SUB2API_PASSWORD

async function api(method, path, body, token, extra = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(`${method} ${path}: ${data.message}`)
  return data.data
}

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then(r => r.json())
const token = login.data.access_token

let failures = 0
async function check(label, fn) {
  try {
    const detail = await fn()
    console.log(`PASS ${label}${detail ? ' -> ' + String(detail).slice(0, 120) : ''}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${label} -> ${error.message}`)
  }
}

// 读切片：首页经营指标、各管理列表
await check('home slices', async () => {
  const stats = await api('GET', '/admin/dashboard/stats', undefined, token)
  const pay = await api('GET', '/admin/payment/dashboard', undefined, token)
  const avail = await api('GET', '/admin/ops/account-availability', undefined, token)
  return `cost_today=${stats.today_actual_cost} pending_orders=${pay.pending_orders} avail=${avail.enabled}`
})
for (const [label, path] of [
  ['channels', '/admin/channels?page=1&page_size=5'],
  ['groups', '/admin/groups/all'],
  ['users', '/admin/users?page=1&page_size=5'],
  ['subscriptions', '/admin/subscriptions?page=1&page_size=5'],
  ['finance orders', '/admin/payment/orders?page=1&page_size=5'],
  ['payment plans', '/admin/payment/plans'],
  ['promo codes', '/admin/promo-codes?page=1&page_size=5'],
  ['redeem stats', '/admin/redeem-codes/stats'],
  ['users-trend(留存)', '/admin/dashboard/users-trend?start_date=2026-10-15&end_date=2026-10-21&granularity=day'],
]) {
  await check(`read ${label}`, async () => {
    const data = await api('GET', path, undefined, token)
    return JSON.stringify(data).slice(0, 60)
  })
}

// 可逆写：生成 1 个测试兑换码 → 确认存在 → 删除 → 确认消失
await check('reversible write (redeem code)', async () => {
  const stamp = Date.now()
  const generated = await api('POST', '/admin/redeem-codes/generate',
    { count: 1, type: 'balance', value: 1, notes: `dsh-smoke-${stamp}` }, token, { 'Idempotency-Key': `dsh-smoke-${stamp}` })
  const created = generated?.[0] ?? generated?.codes?.[0] ?? generated
  const id = created?.id ?? created?.ids?.[0]
  if (!id) throw new Error(`no id in generate response: ${JSON.stringify(generated).slice(0, 200)}`)
  await api('DELETE', `/admin/redeem-codes/${id}`, undefined, token)
  return `created+deleted code ${id}`
})

console.log(failures === 0 ? 'LIVE SMOKE ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
