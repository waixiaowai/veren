/**
 * One real mouse click at a selector through CDP Input.dispatchMouseEvent, so
 * React's pointer/click synthesis sees a genuine user gesture (programmatic
 * `.click()` does not).
 *
 * 经 CDP Input.dispatchMouseEvent 在选择器坐标处发一次真实鼠标点击，让 React 的
 * pointer/click 合成看到真实手势（程序化 `.click()` 做不到）。
 *
 * Usage: node scripts/cdp-click.mjs <url-substring> <selector>
 * @module @veren/scripts/cdp-click
 */

import WebSocket from 'ws'

const [needle, selector] = process.argv.slice(2)
if (needle === undefined || selector === undefined) throw new Error('usage: node scripts/cdp-click.mjs <url-substring> <selector>')

const targets = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json())
const target = targets.find(candidate => candidate.type === 'page' && candidate.url.includes(needle))
if (target === undefined) throw new Error(`no page target matching ${needle}`)

const socket = await new Promise((resolve, reject) => {
  const connection = new WebSocket(target.webSocketDebuggerUrl)
  connection.once('open', () => resolve(connection))
  connection.once('error', reject)
})

let nextId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (message.id === undefined) return
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const rectJson = await send('Runtime.evaluate', {
  expression: `JSON.stringify((function(){ const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`,
  returnByValue: true,
})
const rect = JSON.parse(rectJson.result.value)
if (rect === null) throw new Error(`no element matching ${selector}`)

for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
  })
}
await new Promise(resolve => setTimeout(resolve, 200))
socket.close()
process.stdout.write(`clicked ${selector} at ${String(rect.x)},${String(rect.y)}\n`)
