// ws 握手探针：对运行节点验证两条 WS 通道的 101 升级与 accept 计算。
// The ws handshake probe: verifies the 101 upgrade and the accept key of
// both ws channels against the running node.
import http from 'node:http'
import crypto from 'node:crypto'

function probe(path) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64')
    const request = http.request({
      host: '127.0.0.1',
      port: 3080,
      path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    })
    request.on('upgrade', (response, socket) => {
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      const ok = response.headers['sec-websocket-accept'] === accept
      socket.end()
      resolve(`${path} UPGRADED accept-ok=${ok}`)
    })
    request.on('response', (response) => {
      resolve(`${path} NO-UPGRADE ${response.statusCode}`)
    })
    request.on('error', (error) => {
      resolve(`${path} ERR ${error.message}`)
    })
    request.end()
  })
}

Promise.all([probe('/api/ws/status'), probe('/api/ws/logs')]).then((results) => {
  for (const line of results) console.log(line)
  process.exit(0)
})
