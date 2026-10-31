/**
 * Shared harness for the auth-gate e2e specs: boots the actual `dsh web`
 * host with this plugin patched into its composition (one-shot test home
 * under ~/.dsh_test, real credentials copied in) and drives the gate over
 * HTTP. Prerequisites: the harness checkout two levels up (bin + tsx), and
 * this workspace's plugin packages junction-linked into the harness
 * node_modules (done and undone by the specs themselves via the generated
 * patch file).
 * 登录门禁 e2e 用例的共享夹具：把本插件 patch 进真实的 `dsh web` 宿主组合（一次性
 * 测试主目录位于 ~/.dsh_test，拷入真实凭据），随后通过 HTTP 驱动门禁。前置：上两级
 * 的 harness 检出（bin + tsx），以及把本工作区插件包联结进 harness 的 node_modules
 * （由用例自身经生成的 patch 文件创建并清理）。
 *
 * @module tests/auth-gate.helpers
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The harness checkout that owns the real `dsh web` host. 拥有真实 `dsh web` 宿主的 harness 检出。 */
export const HARNESS_ROOT = fileURLToPath(new URL('../../../deepseek/deepseek-harness', import.meta.url))
export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DSH_SOURCE_BIN = join(HARNESS_ROOT, 'apps/cli/src/bin.ts')
const TSX_LOADER = pathToFileURL(createRequire(join(HARNESS_ROOT, 'package.json')).resolve('tsx')).href
export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'change-me-please'

export interface RunningWeb {
  readonly child: ChildProcess
  readonly port: number
  readonly output: () => string
}

export interface HttpResult {
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
export function http(method: string, path: string, options: { body?: string, cookie?: string, port: number }): Promise<HttpResult> {
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
export function sessionCookie(setCookie: string | undefined): string {
  const entry = setCookie?.split('\n').find(line => line.startsWith('dsh-login.session_token='))
  if (entry === undefined) throw new Error(`no session cookie in Set-Cookie:\n${setCookie ?? '(none)'}`)
  return entry.split(';', 1)[0]!
}

/**
 * 沿重定向链前进，沿链累积 Cookie，返回落地的首个非 3xx 响应。
 * Follows the redirect chain, accumulating cookies along it, and returns the
 * first non-3xx response it lands on.
 */
export async function followEntryRedirects(port: number, cookie: string): Promise<HttpResult> {
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
  return entry!
}

/**
 * Boot one real `dsh web` with this plugin's composition patch and run the
 * scenario against it: a one-shot test home (a fresh numbered directory under
 * ~/.dsh_test with the real credentials copied in), a generated patch
 * anchoring the inserted plugin to the built dist (the storage/admin sections
 * mirror the shipped cordis.patch.yml), then full cleanup in `finally` (stop
 * the host, remove the patch and the home). A failing scenario re-throws with
 * the server output attached.
 * 以本插件的组合 patch 启动一次真实 `dsh web` 并在其上运行场景：一次性测试主目录
 * （~/.dsh_test 下新建编号目录并拷入真实凭据）、生成的 patch（把插入的插件锚定到构建
 * 产物 dist，storage/admin 段与随附的 cordis.patch.yml 一致），finally 全量清理
 * （停宿主、删 patch、删主目录）；场景失败时附带服务器输出后重新抛出。
 */
export async function withRunningGate(scenario: (gate: { port: number }) => Promise<void>): Promise<void> {
  // One-shot test home: a fresh numbered directory under ~/.dsh_test with the
  // real credentials copied in, removed again in the finally block.
  // 一次性测试主目录：~/.dsh_test 下新建编号目录，拷入真实凭据，finally 中删除。
  const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}`
  const testHomeRoot = join(homedir(), '.dsh_test', stamp)
  const dshHome = join(testHomeRoot, '.dsh')
  await mkdir(dshHome, { recursive: true })
  await copyFile(join(homedir(), '.dsh', '.credentials.yaml'), join(dshHome, '.credentials.yaml'))

  // A generated patch anchors the inserted plugin to the built dist via a
  // patch-relative path — no package installation or linking needed.
  // 生成的 patch 用相对路径把插件锚定到构建产物 dist——无需安装或联结。
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
    await scenario({ port })
  } catch (error) {
    const evidence = running?.output() ?? ''
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- server output ---\n${evidence.slice(-4000)}`, { cause: error })
  } finally {
    if (running !== undefined) await stopWeb(running)
    await rm(patchPath, { force: true })
    await rm(testHomeRoot, { recursive: true, force: true })
  }
}
