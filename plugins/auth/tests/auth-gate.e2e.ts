/**
 * Real-environment e2e: boots the actual `dsh web` host with this plugin
 * patched into its composition (one-shot test home under ~/.dsh_test, real
 * credentials copied in), then drives the gate over HTTP: unauthenticated
 * entry is redirected to the login page, the seeded admin can sign in, a
 * wrong password is refused, the session cookie unlocks the SPA entry, and
 * Better Auth's session endpoint reflects the signed-in user.
 * 真实环境 e2e：把本插件 patch 进真实的 `dsh web` 宿主组合（一次性测试主目录
 * 位于 ~/.dsh_test，拷入真实凭据），随后通过 HTTP 驱动门禁：未认证访问被重定向
 * 到登录页，播种的管理员可登录，错误密码被拒绝，会话 Cookie 解锁 SPA 入口，
 * Better Auth 会话端点反映已登录用户。
 *
 * Prerequisites: the harness checkout two levels up (bin + tsx), and this
 * workspace's plugin packages junction-linked into the harness node_modules
 * (done and undone by this spec itself).
 * 前置：上两级的 harness 检出（bin + tsx），以及把本工作区插件包联结进 harness
 * 的 node_modules（由本 spec 自行创建并清理）。
 * @module tests/auth-gate.e2e
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The harness checkout that owns the real `dsh web` host. 拥有真实 `dsh web` 宿主的 harness 检出。 */
const HARNESS_ROOT = fileURLToPath(new URL('../../../deepseek/deepseek-harness', import.meta.url))
const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DSH_SOURCE_BIN = join(HARNESS_ROOT, 'apps/cli/src/bin.ts')
const TSX_LOADER = pathToFileURL(createRequire(join(HARNESS_ROOT, 'package.json')).resolve('tsx')).href
const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'change-me-please'

interface RunningWeb {
  readonly child: ChildProcess
  readonly port: number
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
  readonly setCookie?: string
  readonly location?: string
}

/** Reserve one concrete loopback port, then release it for the CLI process. 预留一个具体回环端口，再释放给 CLI 进程。 */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise as () => void)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) resolvePromise()
      else reject(error)
    })
  })
  return port
}

function cleanEnvironment(dshHome: string, webDist: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    DSH_WEB_DIST: webDist,
    TSX_TSCONFIG_PATH: join(HARNESS_ROOT, 'tsconfig.json'),
  }
}

/** Start the real `dsh web` with this plugin's composition patch. 以本插件的组合 patch 启动真实 `dsh web`。 */
async function startWeb(dshHome: string, webDist: string, port: number, patchPath: string): Promise<RunningWeb> {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    // Launcher-owned flags come first; everything after them goes to the
    // booted profile verbatim.
    // 启动器自有旗标在前；其后参数原样交给被启动的 profile。
    '--patch', patchPath,
    '--profile', 'web',
    '--no-open',
    '--port', String(port),
  ], {
    cwd: HARNESS_ROOT,
    env: cleanEnvironment(dshHome, webDist),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const ready = new Promise<void>((resolvePromise, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`dsh web did not become ready:\n${output.slice(-4000)}`))
    }, 120_000)
    const append = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-100_000)
      if (!settled && /dsh web: http:\/\//u.test(output)) {
        settled = true
        clearTimeout(timer)
        resolvePromise()
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', fail)
    child.once('exit', (code) => {
      fail(new Error(`dsh web exited before readiness (${String(code)}):\n${output.slice(-4000)}`))
    })
  })
  await ready
  return { child, port, output: () => output }
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolvePromise) => { running.child.once('exit', () => { resolvePromise() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
}

/** One HTTP round trip against the running gate, capturing status/body/cookies. 对运行中的门禁做一次 HTTP 往返，捕获状态/响应体/Cookie。 */
function http(method: string, path: string, options: { body?: string, cookie?: string, port: number }): Promise<HttpResult> {
  return new Promise((resolvePromise, reject) => {
    const headers: Record<string, string | number> = {}
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(options.body)
      // Better Auth's CSRF fence requires an Origin on state-changing posts.
      // Better Auth 的 CSRF 防线要求变更类 POST 携带 Origin。
      headers.origin = `http://127.0.0.1:${String(options.port)}`
    }
    if (options.cookie !== undefined) headers.cookie = options.cookie
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: options.port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          setCookie: res.headers['set-cookie']?.join('\n'),
          location: res.headers.location,
        })
      })
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

/** Extract the session cookie value from a Set-Cookie header block. 从 Set-Cookie 头块提取会话 Cookie 值。 */
function sessionCookie(setCookie: string | undefined): string {
  const entry = setCookie?.split('\n').find(line => line.startsWith('dsh-login.session_token='))
  if (entry === undefined) throw new Error(`no session cookie in Set-Cookie:\n${setCookie ?? '(none)'}`)
  return entry.split(';', 1)[0]!
}

describe('login gate on the real dsh web host', () => {
  it('gates the entry, authenticates the seeded admin over HTTP, and serves the session', { timeout: 240_000 }, async () => {
    // One-shot test home: a fresh numbered directory under ~/.dsh_test with the
    // real credentials copied in, removed again in the finally block.
    // 一次性测试主目录：~/.dsh_test 下新建编号目录，拷入真实凭据，finally 中删除。
    const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}`
    const testHomeRoot = join(homedir(), '.dsh_test', stamp)
    const dshHome = join(testHomeRoot, '.dsh')
    await mkdir(dshHome, { recursive: true })
    await copyFile(join(homedir(), '.dsh', '.credentials.yaml'), join(dshHome, '.credentials.yaml'))

    // A generated patch anchors the inserted plugin to the built dist via a
    // patch-relative path — no package installation or linking needed. The
    // storage/admin sections mirror the shipped cordis.patch.yml.
    // 生成的 patch 用相对路径把插件锚定到构建产物 dist——无需安装或联结。
    // storage/admin 段与随附的 cordis.patch.yml 一致。
    const { writeFile } = await import('node:fs/promises')
    const patchPath = join(PLUGIN_ROOT, 'tests', 'auth-gate.e2e.patch.yml')

    const port = await freePort()
    const webDist = join(HARNESS_ROOT, 'apps', 'web')
    // The loader's !!js sandbox exposes no `require` under the ESM host, so the
    // distIndex anchor is inlined as a literal path (forward slashes stay
    // portable across the YAML quoting).
    // loader 的 !!js 沙箱在 ESM 宿主下没有 require，因此 distIndex 锚点直接内联
    // 为字面路径（正斜杠以兼容 YAML 引号转义）。
    const distIndex = webDist.replaceAll('\\', '/') + '/index.html'
    await writeFile(patchPath, [
      '- id: storage-domain',
      '  config:',
      '    backend: json',
      '    routes:',
      '      web_login_gate: json',
      '- insert:',
      '    - id: web-login-gate',
      "      name: '../dist/index.js'",
      '      config:',
      `        distIndex: ${JSON.stringify(distIndex)}`,
      '        sessionDays: 7',
      '        rateLimit:',
      '          window: 60',
      '          max: 10',
      '        admin:',
      `          email: ${ADMIN_EMAIL}`,
      `          password: ${ADMIN_PASSWORD}`,
      '          name: Administrator',
      '        storage:',
      '          backend: json',
      '          routes:',
      '            web_login_gate: json',
      '', // YAML files end with one trailing newline. YAML 文件以单个换行结尾。
    ].join('\n'), 'utf8')

    let running: RunningWeb | undefined
    try {
      running = await startWeb(dshHome, webDist, port, patchPath)

      // 1. Unauthenticated SPA entry is redirected to the login page (the
      // handler emits a 3xx redirect; the exact code is not contractual).
      // 未认证的 SPA 入口被重定向到登录页（处理器的 3xx；具体码不属于契约）。
      const gated = await http('GET', '/', { port })
      expect(gated.status).toBeGreaterThanOrEqual(300)
      expect(gated.status).toBeLessThan(400)
      expect(gated.location).toBe('/login')
      expect(gated.setCookie ?? '').not.toContain('dsh-login.session_token')

      // 2. The login page itself is served.
      const login = await http('GET', '/login', { port })
      expect(login.status).toBe(200)
      expect(login.body).toContain('<html')

      // 3. Wrong password is refused by Better Auth.
      const bad = await http('POST', '/auth/sign-in/email', {
        port,
        body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-1' }),
      })
      expect(bad.status).toBe(401)

      // 4. The seeded admin signs in and receives the session cookie.
      const good = await http('POST', '/auth/sign-in/email', {
        port,
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      })
      if (good.status !== 200) throw new Error(`admin sign-in failed (${String(good.status)}): ${good.body}`)
      const cookie = sessionCookie(good.setCookie)
      expect(cookie).toContain('dsh-login.session_token=')

      // 5. The session cookie unlocks the SPA entry through the redirect chain:
      // '/' → 303 to the tokenized URL → Connection mints its cookie and 303s
      // to the clean path → 200 index.html. Cookies accumulate along the chain.
      // 会话 Cookie 经重定向链解锁 SPA 入口：'/' → 303 到带 token URL →
      // Connection 铸 Cookie 并 303 到干净路径 → 200 index.html。Cookie 沿链累积。
      const cookies = new Set([cookie])
      let current = '/'
      let entry: HttpResult | undefined
      for (let hop = 0; hop < 6; hop += 1) {
        entry = await http('GET', current, { port, cookie: [...cookies].join('; ') })
        if (entry.status < 300 || entry.status >= 400) break
        const target = entry.location
        if (target === undefined) throw new Error(`redirect without location at ${current}`)
        current = new URL(target, `http://127.0.0.1:${String(port)}`).pathname + new URL(target, `http://127.0.0.1:${String(port)}`).search
        for (const line of entry.setCookie?.split('\n') ?? []) cookies.add(line.split(';', 1)[0]!)
      }
      expect(entry!.status).toBe(200)
      expect(entry!.body).toContain('<html')

      // 6. Better Auth's session endpoint reflects the signed-in admin.
      const session = await http('GET', '/auth/get-session', { port, cookie })
      expect(session.status).toBe(200)
      expect(JSON.parse(session.body)).toMatchObject({ user: { email: ADMIN_EMAIL } })

      // 7. The same request without the cookie stays anonymous.
      const anonymous = await http('GET', '/auth/get-session', { port })
      expect(anonymous.status).toBe(200)
      expect(anonymous.body.trim()).toBe('null')
    } catch (error) {
      const evidence = running?.output() ?? ''
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- server output ---\n${evidence.slice(-4000)}`, { cause: error })
    } finally {
      if (running !== undefined) await stopWeb(running)
      await rm(patchPath, { force: true })
      await rm(testHomeRoot, { recursive: true, force: true })
    }
  })
})
