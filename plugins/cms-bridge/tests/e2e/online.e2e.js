/**
 * cms-bridge × 线上 cms 服务端 全量真机验收驱动。
 *
 * The cms-bridge × live-cms full real-server acceptance driver.
 *
 * 依据 cms 仓 scripts/ws-interop/e2e-driver.mjs 的契约适配线上实例:
 * 鉴权/在线列表/admin 推送面/留痕查询全部走线上真实 HTTP+WS。
 * Adapted from the cms repo's ws-interop driver contract for the live
 * instance: auth, online list, the admin send plane and the message audit
 * trail all go through the real online HTTP+WS.
 *
 * 用法 / usage (PowerShell):
 *   $env:CMS_TOKEN='<api key>'
 *   node plugins/cms-bridge/tests/e2e/online.e2e.js
 *
 * P2/P8 用「传输层强杀(等价链路闪断)」触发:插件应自动重连,且断线期间
 * 排队的 3 条事件在重连后按序补报。P3(凭证撤销停靠)需撤销有效凭证,
 * 线上不宜拿在用主 Key 做撤销,以单测 + cms 仓 S7 旅程覆盖为准,此处跳过。
 * P2/P8 are triggered by a transport-level kill (a link flash equivalent):
 * the plugin must reconnect automatically and replay the 3 events queued
 * while offline in order. P3 needs revoking a live credential — not done on
 * the user's real key online; covered by unit tests and the cms repo's S7
 * journey instead, skipped here.
 */
import { Context } from '@deepseek-ai/cordis';
import WebSocket from 'ws';
import { wire } from '../../dist/index.js';

const BASE = process.env.CMS_HTTP ?? 'https://veren.top';
const WS_URL = process.env.CMS_WS ?? 'wss://veren.top/v1/ws';
const KEY = process.env.CMS_TOKEN ?? '';
if (!KEY) {
  console.error('需要环境变量 CMS_TOKEN');
  process.exit(2);
}

const results = [];
// 每次运行的唯一 id 前缀:审计留痕是持久的,跨轮次不能互相匹配
// Unique per-run id prefix: the audit trail is persistent, so runs must not
// match each other's stale rows.
const RUN = 'r' + Date.now().toString(36);
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + String(detail).slice(0, 240) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout: ' + label);
    await sleep(60);
  }
}

/** 带鉴权调用线上 REST 面 / call the live REST plane with auth */
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let env;
  try { env = await res.json(); } catch { env = { code: -999, message: 'non-json http=' + res.status }; }
  return { status: res.status, env };
}

// ---- 0. 确认线上没有该用户的旧连接残留(避免 admin 推送串线) ----
{
  const r = await api('GET', '/v1/admin/ws/connections');
  const conns = r.env?.data?.connections ?? [];
  check('precheck clean connections', r.env.code === 0 && conns.length === 0, JSON.stringify(conns));
}

// ---- 传输工厂:保留最近 socket 引用,支持强杀(模拟链路闪断) ----
let lastRaw = null;
const killableFactory = (url, headers) => {
  const raw = new WebSocket(url, { headers });
  lastRaw = raw;
  return {
    send: (text) => raw.send(text),
    close: (code) => raw.close(code),
    onOpen: (cb) => raw.once('open', () => cb()),
    onClose: (cb) => raw.once('close', (code) => cb(code)),
    onMessage: (cb) => raw.on('message', (data) => cb(String(data))),
    onError: (cb) => raw.once('error', (err) => cb(err instanceof Error ? err : new Error(String(err)))),
  };
};

// ---- P1: 插件连接线上服务端 ----
const ctx = new Context();
const svc = wire(ctx, {
  url: WS_URL,
  token: KEY,
  commandTimeoutMs: 2000,
  // 退避 6s:给 P8 的离线排队留出窗口(真实链路闪断场景下重连本就可能更快)
  // 6s backoff: leaves a window for P8's offline queueing (a real link flash
  // may reconnect faster; this only widens the observability window).
  reconnect: { initialDelayMs: 6000, maxDelayMs: 6000, factor: 2 },
  credentialCloseCodes: [4001, 4401],
}, killableFactory);
const status = () => svc.status();
ctx.on('cms-bridge/status', (s) => console.log('[state] ' + s.state + (s.lastError ? ' :: ' + s.lastError : '')));

await waitFor(() => status().state === 'connected', 15000, 'plugin connected (P1)');
check('P1 plugin connected to live server', true, status().credentialFingerprint ?? '');

// ---- S1/P1: 服务端在线列表可见该连接 ----
let userId = 0;
{
  const r = await api('GET', '/v1/admin/ws/connections');
  const conns = r.env?.data?.connections ?? [];
  userId = conns[0]?.user_id ?? 0;
  check('S1 server online list shows the plugin connection', r.env.code === 0 && conns.length === 1 && userId > 0, JSON.stringify(conns));
}

// ---- 指令面驱动:admin 推送 + 上行留痕轮询 ----
const push = (cmd) => api('POST', '/v1/admin/ws/users/' + userId + '/send', cmd);
async function pushAndWait(id, action, payload) {
  const fid = RUN + '-' + id;
  await push({ type: 'command', id: fid, action, payload });
  const end = Date.now() + 8000;
  for (;;) {
    const r = await api('GET', '/v1/admin/ws/messages?user_id=' + userId + '&direction=up&limit=50');
    const hit = (r.env?.data?.messages ?? []).find((m) => {
      try { const f = JSON.parse(m.payload); return f.type === 'result' && f.id === fid; } catch { return false; }
    });
    if (hit) return JSON.parse(hit.payload);
    if (Date.now() > end) throw new Error('result not seen in audit trail: ' + fid);
    await sleep(120);
  }
}

// ---- P10: 运行时注册映射(连接保持下新增,服务端零改动) ----
svc.registerAction('e2e.ping', { handler: async (p) => ({ pong: true, echo: p }) });
svc.registerAction('e2e.stuck', { handler: () => new Promise(() => {}) });
check('P10 runtime action registration', status().state === 'connected', 'registered e2e.ping / e2e.stuck while connected');

// ---- P4: 已映射指令执行 + 回执可查 ----
{
  const f = await pushAndWait('c1', 'e2e.ping', { n: 1 });
  check('P4 mapped action executes + result ok', f.ok === true && f.result?.pong === true && f.result?.echo?.n === 1, JSON.stringify(f));
}

// ---- P5: 未知 action 明确失败 ----
{
  const f = await pushAndWait('c2', 'no.such.action', {});
  check('P5 unknown action explicit failure', f.ok === false && f.code === 'UNKNOWN_ACTION', JSON.stringify(f));
}

// ---- P6: 卡死指令超时,且不阻塞后续 ----
{
  const t0 = Date.now();
  const f = await pushAndWait('c3', 'e2e.stuck', {});
  const dt = Date.now() - t0;
  check('P6 stuck action times out', f.ok === false && f.code === 'TIMEOUT' && dt < 7000, `code=${f.code} elapsed=${dt}ms`);
  const f4 = await pushAndWait('c4', 'e2e.ping', { n: 4 });
  check('P6 later command not blocked', f4.ok === true && f4.result?.echo?.n === 4);
}

// ---- P7: 主动上报,服务端留痕原文可查 ----
{
  const ack = svc.report('host.ready', { v: '1.0.0', from: 'online-e2e', run: RUN });
  const end = Date.now() + 8000;
  let found = null;
  for (;;) {
    const r = await api('GET', '/v1/admin/ws/messages?user_id=' + userId + '&direction=up&limit=50');
    found = (r.env?.data?.messages ?? []).map((m) => { try { return JSON.parse(m.payload); } catch { return null; } })
      .find((f) => f?.type === 'event' && f.name === 'host.ready' && f.id === ack.id) ?? null;
    if (found || Date.now() > end) break;
    await sleep(120);
  }
  check('P7 event payload in server audit trail', found !== null && found.payload?.run === RUN, JSON.stringify(found));
}

// ---- S6: 下行指令留痕 ----
{
  const down = await api('GET', '/v1/admin/ws/messages?user_id=' + userId + '&direction=down&limit=50');
  const cmds = (down.env?.data?.messages ?? []).filter((m) => { try { return JSON.parse(m.payload)?.type === 'command'; } catch { return false; } });
  check('S6 downlink commands audited', cmds.length >= 4, 'count=' + cmds.length);
}

// ---- P2 + P8: 强杀链路 → 离线排 3 条(间隔>1s) → 自动重连 → 按序补报 ----
console.log('KILL: terminating the transport now (simulating a link drop)');
lastRaw.terminate();
await waitFor(() => status().state === 'reconnecting' || status().state === 'connecting', 15000, 'drop detected');
check('P2 drop detected', true, status().lastError ?? '');
svc.report('e2e.offline', { run: RUN, seq: 1 });
await sleep(1200); // 间隔>1s:留痕 created_at 秒级粒度,跨秒才能判顺序
svc.report('e2e.offline', { run: RUN, seq: 2 });
await sleep(1200);
svc.report('e2e.offline', { run: RUN, seq: 3 });
check('P8 still offline while queueing', status().state !== 'connected', 'state=' + status().state);
check('P8 3 events queued while offline', status().pendingEvents === 3, 'pending=' + status().pendingEvents);

const reconnected = await waitFor(() => (status().state === 'connected' ? status() : null), 30000, 'auto reconnect (P2)');
check('P2 auto reconnect after drop', reconnected.state === 'connected', 'attempts=' + reconnected.reconnectAttempts);
{
  const end = Date.now() + 12000;
  let frames = [];
  for (;;) {
    const r = await api('GET', '/v1/admin/ws/messages?user_id=' + userId + '&direction=up&limit=50');
    frames = (r.env?.data?.messages ?? [])
      .map((m) => { try { return { row: m, frame: JSON.parse(m.payload) }; } catch { return null; } })
      .filter((x) => x?.frame?.type === 'event' && x.frame.name === 'e2e.offline' && x.frame.payload?.run === RUN)
      // 留痕契约=created_at DESC, id DESC(最新在前);取反即真实插入(补报)顺序
      .reverse()
      .map((x) => x.frame);
    if (frames.length >= 3 || Date.now() > end) break;
    await sleep(150);
  }
  check('P8 offline events replayed in order', frames.length === 3 && frames[0].payload.seq === 1 && frames[1].payload.seq === 2 && frames[2].payload.seq === 3,
    'seqs=' + JSON.stringify(frames.map((f) => f.payload.seq)));
}

// ---- P3: 撤销凭证 → 停靠(线上不撤销在用主 Key,以提示代替) ----
console.log('SKIP P3 online: revoking the live key is destructive; covered by unit tests + cms S7 journey (4401 -> awaiting-credential).');

// ---- 收尾:卸载插件,断开连接 ----
await ctx.fiber.dispose?.() ?? 0;
await sleep(500);
const r = await api('GET', '/v1/admin/ws/connections');
check('cleanup connection closed', (r.env?.data?.connections ?? []).length === 0, JSON.stringify(r.env?.data?.connections ?? []));

// ---- 汇总 ----
const failed = results.filter((r) => !r.ok);
const summary = { total: results.length, failed: failed.length, cases: results.map((r) => r.name + (r.ok ? '' : ' <<FAIL')) };
console.log('E2E_SUMMARY ' + JSON.stringify(summary));
process.exit(failed.length === 0 ? 0 : 1);
