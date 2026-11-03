// Panel sidecar: exposes the loopback-only dsh web server to the entrance via the Service.
// 面板 sidecar：把只绑 loopback 的 dsh Web 服务经 Service 暴露给入口。
const http = require('node:http')

const UPSTREAM_HOST = '127.0.0.1'
const UPSTREAM_PORT = 3082

function relayStatusLine(status, headers) {
  const lines = [`HTTP/1.1 ${status} ${headers.statusMessage || ''}`.trimEnd()]
  for (const [key, value] of Object.entries(headers.headers ?? {})) lines.push(`${key}: ${value}`)
  return lines.join('\r\n') + '\r\n\r\n'
}

function proxyHeaders(url, source) {
  const headers = { ...source }
  // The management fence only accepts a loopback Host (`sameOrigin` in src/app/http.ts),
  // because upstream serves the panel from the operator's own machine. Behind the
  // entrance the proxy restores that loopback view for the API and drops the browser
  // Origin: the same-site role is already carried by the entrance's own Olares
  // authentication plus the x-orchestrator-request header, which cross-site fetches
  // cannot attach without a failing CORS preflight.
  // 管理栅栏只接受 loopback Host（src/app/http.ts 的 sameOrigin）——上游的面板就跑在
  // 操作者本机。在入口之后，代理为 API 还原该 loopback 视角并剥离浏览器 Origin：
  // 同站校验的职责已由入口的 Olares 登录与 x-orchestrator-request 头承担
  // （跨站 fetch 无法携带该自定义头，CORS 预检必失败）。
  //
  // This rewrite is scoped to /orchestrator/ ONLY. The dsh webserver paths (page,
  // ./auth, /api/remote.mux) must keep the public Host verbatim: the browser session
  // cookie is signed for the authority derived from that Host, and rewriting it here
  // would fail every subsequent cookie check.
  // 该改写只限 /orchestrator/。dsh webserver 的路径（页面、./auth、/api/remote.mux）
  // 必须逐字保留公网 Host：浏览器会话 cookie 就是按这个 Host 派生的 authority 签发的，
  // 在这里改写会让后续所有 cookie 校验失败。
  if (url && url.startsWith('/orchestrator/')) {
    headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
    delete headers.origin
  }
  return headers
}

const server = http.createServer((req, res) => {
  const headers = proxyHeaders(req.url, req.headers)
  const upstream = http.request({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, method: req.method, headers },
    r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  upstream.on('error', () => { res.writeHead(502); res.end('dsh-superagent is starting') })
  req.pipe(upstream)
})

// WebSocket upgrades (the DSH remote stream mux at /api/remote.mux): an http server
// without an 'upgrade' listener destroys the client socket, which the browser reports
// as "WebSocket is closed before the connection is established". Forward the handshake
// (public Host preserved, see proxyHeaders) and pipe both sockets once the upstream
// answers 101; a non-101 answer is relayed as-is so failures stay diagnosable.
// WebSocket 升级（/api/remote.mux 的 DSH 远程流复用）：没有 'upgrade' 监听的 http
// server 会直接销毁客户端 socket，浏览器据此报 "WebSocket is closed before the
// connection is established"。转发握手（公网 Host 原样保留，见 proxyHeaders），上游
// 应答 101 后双向接管 socket；非 101 应答原样回传，保证失败可诊断。
server.on('upgrade', (req, socket, head) => {
  const headers = proxyHeaders(req.url, req.headers)
  const upstream = http.request({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, method: req.method, headers })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(relayStatusLine(upRes.statusCode, { statusMessage: upRes.statusMessage, headers: upRes.headers }))
    upSocket.write(head)
    if (upHead.length > 0) upSocket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    const teardown = () => { socket.destroy(); upSocket.destroy() }
    socket.on('error', teardown)
    upSocket.on('error', teardown)
  })
  upstream.on('response', r => {
    // A refused upgrade must carry its body too (Content-Length would dangle otherwise).
    // 被拒的升级也要带回响应体（否则对端的 Content-Length 会悬空等待）。
    socket.write(relayStatusLine(r.statusCode, { statusMessage: r.statusMessage, headers: r.headers }))
    r.pipe(socket)
  })
  upstream.on('error', () => { socket.destroy() })
  upstream.end(head)
})

server.listen(3081)
