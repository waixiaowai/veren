// ws 通道探针：对运行节点验证两条 WS 通道的 101 升级、accept 计算与
// 首帧载荷（ws-status 应推送含 status 字段的状态 JSON）。
// The ws channel probe: verifies the 101 upgrade, the accept key and the
// first payload frame of both ws channels against the running node
// (ws-status should push a status json carrying a status field).
import http from 'node:http'
import crypto from 'node:crypto'

function probe(path, readFirstFrame) {
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
      const acceptOk = response.headers['sec-websocket-accept'] === accept
      if (!readFirstFrame) {
        socket.end()
        resolve(`${path} UPGRADED accept-ok=${acceptOk}`)
        return
      }
      // 读一帧服务器文本（服务器帧无掩码）：2 字节头 + 7 位长度 + 载荷
      // reads one server text frame (unmasked): 2-byte header + 7-bit length + payload
      socket.once('data', (chunk) => {
        const length = chunk[1] & 0x7f
        const payload = chunk.subarray(2, 2 + length).toString('utf8')
        socket.end()
        resolve(`${path} UPGRADED accept-ok=${acceptOk} first-frame=${payload.slice(0, 80)}`)
      })
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

const results = await Promise.all([
  probe('/api/ws/status', true),
  probe('/api/ws/logs', false),
])
for (const line of results) console.log(line)
process.exit(0)
