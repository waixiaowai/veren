/**
 * One real mouse click on the first element whose trimmed text equals (or
 * starts with) the given text — any selector, not just session rows.
 * 对任意文本元素的一次真实鼠标点击（不限会话行）。
 *
 * Usage: node scripts/cdp-click-any.mjs <url-substring> <text>
 */
import WebSocket from 'ws'

const [needle, text] = process.argv.slice(2)
if (needle === undefined || text === undefined) throw new Error('usage: node scripts/cdp-click-any.mjs <url-substring> <text>')

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
    var cands = document.querySelectorAll('li, [role=menuitem], [role=option], .ant-dropdown-menu-item, button');
    for (var i = 0; i < cands.length; i++) {
      var t = cands[i].textContent.trim();
      if (t === ${JSON.stringify(text)} || t.indexOf(${JSON.stringify(text)}) === 0) {
        var r = cands[i].getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        return { x: r.x + r.width / 2, y: r.y + Math.min(14, r.height / 2), text: t };
      }
    }
    return null;
  })())`,
  returnByValue: true,
})
const rect = JSON.parse(rectJson.result.value)
if (rect === null) throw new Error(`no clickable element starting with ${text}`)
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
  })
}
console.log(`clicked ${rect.text} at ${rect.x},${rect.y}`)
socket.close()
