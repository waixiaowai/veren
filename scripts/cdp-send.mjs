/**
 * Type one message into the composer and submit it, through real CDP input —
 * React controlled inputs need native-setter value assignment plus an input
 * event, and the submit button needs a genuine click.
 *
 * 经真实 CDP 输入往输入框写一条消息并提交——React 受控输入需要原生 setter 赋值
 * 加 input 事件，提交按钮需要真实点击。
 *
 * Usage: node scripts/cdp-send.mjs <url-substring> <text>
 * @module @veren/scripts/cdp-send
 */

import WebSocket from 'ws'

const [needle, text] = process.argv.slice(2)
if (needle === undefined || text === undefined) throw new Error('usage: node scripts/cdp-send.mjs <url-substring> <text>')

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

const expression = `JSON.stringify((function(){
  var area = document.querySelector('textarea')
    || document.querySelector('[contenteditable=true]');
  if (!area) return null;
  area.focus();
  document.execCommand('selectAll', false, undefined);
  document.execCommand('delete', false, undefined);
  var ok = document.execCommand('insertText', false, ${JSON.stringify(text)});
  if (!ok) {
    area.textContent = ${JSON.stringify(text)};
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var r = area.getBoundingClientRect();
  return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
})())`
const rectJson = await send('Runtime.evaluate', { expression, returnByValue: true })
const rect = JSON.parse(rectJson.result.value)
if (rect === null) throw new Error('no composer found')
// A trusted Enter through the Input domain: React's composer submits on the
// real keydown, and a synthetic KeyboardEvent is untrusted.
// 经 Input 域发一次可信 Enter：React 输入器在真实 keydown 上提交，合成事件不可信。
for (const params of [
  { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
]) {
  await send('Input.dispatchKeyEvent', { ...params, ...rect.x === undefined ? {} : {} })
}
await new Promise(resolve => setTimeout(resolve, 300))
socket.close()
process.stdout.write('typed message and pressed Enter\n')
