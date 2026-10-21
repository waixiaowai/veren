/**
 * Capture one full-page screenshot of a running page through CDP
 * `Page.captureScreenshot`, bypassing the probe's extra tab.
 *
 * 经 CDP `Page.captureScreenshot` 抓一张当前页面截图，绕开 probe 另开标签页的方式。
 *
 * Usage: node scripts/cdp-shot.mjs <url-substring> <out.png>
 * @module @veren/scripts/cdp-shot
 */

import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const [needle, out] = process.argv.slice(2)
if (needle === undefined || out === undefined) throw new Error('usage: node scripts/cdp-shot.mjs <url-substring> <out.png>')

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
  entry(message.result)
})
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
socket.close()
process.stdout.write(`saved ${out}\n`)
