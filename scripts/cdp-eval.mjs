/**
 * Evaluate one expression in an existing headless Chrome page and print the result.
 *
 * Reuses the page a previous `cdp-probe.mjs` run opened, so a multi-step check
 * (dismiss onboarding, open a sidebar page, read the rendered text) does not
 * need a full browser automation stack.
 *
 * 在已打开的无头 Chrome 页面里求值一个表达式并打印结果，用于多步检查（关闭
 * 引导、打开侧边栏页面、读取渲染文本），无需完整浏览器自动化栈。
 *
 * Usage / 用法:
 *   node scripts/cdp-eval.mjs <url-substring> <expression>
 *
 * @module @veren/scripts/cdp-eval
 */

import WebSocket from 'ws'

const [needle, expression] = process.argv.slice(2)
if (needle === undefined || expression === undefined) {
  throw new Error('usage: node scripts/cdp-eval.mjs <url-substring> <expression>')
}

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
  entry(message)
})

/** Send one CDP command / 发送一条 CDP 命令 */
function send(method, params) {
  nextId += 1
  const id = nextId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
})
process.stdout.write(`${JSON.stringify(result.result?.value ?? result, undefined, 2)}\n`)
socket.close()
