/**
 * Probe one URL in a running headless Chrome through the DevTools Protocol.
 *
 * Prints every console message, uncaught exception, failed request, and the
 * rendered body text after the page settles, so a client-plugin boot failure is
 * visible without installing a browser automation framework.
 *
 * 通过 DevTools 协议探测一个 URL：打印全部控制台消息、未捕获异常、失败请求，
 * 以及页面稳定后的正文文本，从而无需安装浏览器自动化框架也能看到客户端插件
 * 启动失败。
 *
 * Usage / 用法:
 *   node scripts/cdp-probe.mjs <url> [--wait <ms>] [--screenshot <png>]
 *
 * @module @veren/scripts/cdp-probe
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const [url, ...rest] = process.argv.slice(2)
if (url === undefined) throw new Error('usage: node scripts/cdp-probe.mjs <url> [--wait <ms>] [--screenshot <png>]')

/** Read one flag value / 读取一个参数值 */
function flag(name, fallback) {
  const index = rest.indexOf(name)
  return index === -1 ? fallback : rest[index + 1]
}

const waitMs = Number(flag('--wait', '12000'))
const screenshot = flag('--screenshot', undefined)

/** Fetch JSON from the DevTools HTTP endpoint / 从 DevTools HTTP 端点取 JSON */
async function json(path) {
  const response = await fetch(`http://127.0.0.1:9222${path}`)
  if (!response.ok) throw new Error(`${path}: ${String(response.status)}`)
  return response.json()
}

/** Open a DevTools websocket and resolve it once connected / 打开 DevTools websocket */
function connect(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

const target = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  .then(response => response.json())
const socket = await connect(target.webSocketDebuggerUrl)
let commandId = 0
const pending = new Map()
const events = []

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (message.id !== undefined) {
    const entry = pending.get(message.id)
    if (entry !== undefined) {
      pending.delete(message.id)
      if (message.error === undefined) entry.resolve(message.result)
      else entry.reject(new Error(message.error.message))
    }
    return
  }
  if (message.method?.startsWith('Runtime.') || message.method === 'Log.entryAdded'
    || message.method === 'Network.loadingFailed' || message.method === 'Network.responseReceived') {
    events.push(message)
  }
})

/** Send one CDP command / 发送一条 CDP 命令 */
function send(method, params = {}) {
  commandId += 1
  const id = commandId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
await send('Page.navigate', { url })
await new Promise(resolve => setTimeout(resolve, waitMs))

const body = await send('Runtime.evaluate', {
  expression: 'document.body.innerText.slice(0, 8000)',
  returnByValue: true,
  awaitPromise: false,
})

const consoleLines = []
const exceptions = []
const failures = []
for (const event of events) {
  if (event.method === 'Runtime.consoleAPICalled') {
    const text = event.params.args.map((argument) => argument.value ?? argument.description ?? argument.type).join(' ')
    consoleLines.push(`${event.params.type}: ${text}`)
  } else if (event.method === 'Runtime.exceptionThrown') {
    const detail = event.params.exceptionDetails
    exceptions.push(`${detail.text} ${detail.exception?.description ?? ''}`.trim())
  } else if (event.method === 'Log.entryAdded') {
    const entry = event.params.entry
    if (entry.level === 'error' || entry.level === 'warning') consoleLines.push(`${entry.level}/${entry.source}: ${entry.text}`)
  } else if (event.method === 'Network.loadingFailed') {
    failures.push(`${event.params.errorText} ${event.params.type}`)
  }
}

if (screenshot !== undefined) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(screenshot, Buffer.from(shot.data, 'base64'))
}

const dir = mkdtempSync(join(tmpdir(), 'cdp-probe-'))
writeFileSync(join(dir, 'events.json'), JSON.stringify(events, undefined, 2))
process.stdout.write(`${JSON.stringify({
  title: target.title,
  body: body.result?.value,
  console: consoleLines,
  exceptions,
  failures,
  eventDump: join(dir, 'events.json'),
}, undefined, 2)}\n`)
socket.close()
