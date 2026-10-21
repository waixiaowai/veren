/**
 * One real mouse click on the first element whose trimmed text starts with the
 * given text, through CDP Input.dispatchMouseEvent.
 *
 * 经 CDP Input.dispatchMouseEvent 真实点击第一个文本以给定内容开头的元素。
 *
 * Usage: node scripts/cdp-click-text.mjs <url-substring> <text>
 * @module @veren/scripts/cdp-click-text
 */

import WebSocket from 'ws'

const [needle, text] = process.argv.slice(2)
if (needle === undefined || text === undefined) throw new Error('usage: node scripts/cdp-click-text.mjs <url-substring> <text>')

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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})

const rectJson = await send('Runtime.evaluate', {
  expression: `JSON.stringify((function(){
    var rows = document.querySelectorAll('[data-row-key^="session:"]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.trim().indexOf(${JSON.stringify(text)}) === 0) {
        var r = rows[i].getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + Math.min(14, r.height / 2) };
      }
    }
    return null;
  })())`,
  returnByValue: true,
})
const rect = JSON.parse(rectJson.result.value)
if (rect === null) throw new Error(`no session row starting with ${text}`)
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
  })
}
await new Promise(resolve => setTimeout(resolve, 200))
socket.close()
process.stdout.write(`clicked row ${text} at ${String(rect.x)},${String(rect.y)}\n`)
