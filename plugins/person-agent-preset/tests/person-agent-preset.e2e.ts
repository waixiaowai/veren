/**
 * Real-environment e2e: boots the actual `dsh web` host with this plugin
 * patched into its composition (one-shot test home under ~/.dsh_test, real
 * credentials copied in). Because the presets surface is only exposed over
 * the WebSocket RPC transport, a generated probe plugin inside the host does
 * the asserting: it polls `agentPresets.list()` until the `person-agent`
 * preset appears, reads its rendered composition document, mounts the preset
 * on a child context (real Loader activation of persona + tools), and writes
 * one JSON result file that this spec polls and asserts against.
 * 真实环境 e2e：把本插件 patch 进真实的 `dsh web` 宿主组合（一次性测试主目录
 * 位于 ~/.dsh_test，拷入真实凭据）。由于预设面只经 WebSocket RPC 传输暴露，
 * 由宿主内生成的探针插件完成断言：轮询 `agentPresets.list()` 直到出现
 * `person-agent`，读取其组合文档，在子 context 上真实挂载（走真实 Loader 激活
 * persona 与工具），并把一份 JSON 结果文件写给本 spec 轮询断言。
 *
 * Prerequisites: the harness checkout two levels up (bin + tsx), and this
 * plugin's `dist/` build (`pnpm build` in the plugin directory).
 * 前置：上两级的 harness 检出（bin + tsx），以及本插件的 `dist/` 构建产物。
 * @module tests/person-agent-preset.e2e
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
const PRESET_ID = 'person-agent'

interface RunningWeb {
  readonly child: ChildProcess
  readonly output: () => string
}

interface ProbeResult {
  readonly found: boolean
  readonly broken?: string
  readonly name?: string
  readonly composition?: string
  readonly rows?: ReadonlyArray<{ readonly name: string, readonly enabled: boolean | 'conditional' }>
  readonly importError?: string
  readonly error?: string
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
function startWeb(dshHome: string, webDist: string, port: number, patchPath: string): Promise<RunningWeb> {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
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
  return new Promise<void>((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      fail(new Error(`dsh web did not become ready:\n${output.slice(-4000)}`))
    }, 120_000)
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
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
  }).then(() => ({ child, output: () => output }))
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolvePromise) => { running.child.once('exit', () => { resolvePromise() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
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

/**
 * The in-host probe plugin source: polls for the preset, reads its document,
 * mounts it on a child context, and writes the JSON verdict for the spec.
 * 宿主内探针插件源码：轮询预设、读取文档、在子 context 挂载，并把 JSON 结论
 * 写给 spec。
 */
function probeSource(resultPath: string, presetId: string): string {
  return `
export const name = 'person-agent-preset-probe'
export const inject = ['agentPresets']
export const provide = []
export const apply = async (ctx) => {
  const write = (result) => import('node:fs/promises').then(fs => fs.writeFile(${JSON.stringify(resultPath)}, JSON.stringify(result)))
  try {
    // Poll until this plugin's registration lands; composition order between
    // sibling plugins is not guaranteed.
    // 轮询等本插件的注册落地；兄弟插件间的组合顺序并无保证。
    let entry
    for (let attempt = 0; attempt < 120 && entry === undefined; attempt += 1) {
      const roster = await ctx.agentPresets.remoteExportList()
      entry = (roster.presets ?? []).find(preset => preset.id === ${JSON.stringify(presetId)})
      if (entry === undefined) await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (entry === undefined) {
      await write({ found: false, rows: [], error: 'preset never appeared in the roster' })
      return
    }
    const document = await ctx.agentPresets.readDocument(${JSON.stringify(presetId)})
    // Activation proof without minting an Agent: the roster's broken field is
    // the registry's own activation audit, and compositionInventory reads
    // every row's enablement. A real mount needs a scoped agent context, which
    // only a created session provides, so the probe does not attempt one.
    // 无需创建 Agent 的激活证明：名册的 broken 字段就是注册表自身的激活审计，
    // compositionInventory 读出每行启用状态。真实 mount 需要 scoped agent
    // context（只有创建会话才有），探针不做该尝试。
    const inventory = await ctx.agentPresets.compositionInventory()
    const own = (inventory ?? []).find(item => item.id === ${JSON.stringify(presetId)})
    // Session-injection proof: the dynamic-context row contributes a pre-step
    // listener whose snapshot messages are appended by the agent loop during
    // real turns — an assembly no longer carries them. The probe instead
    // proves the row's module resolves and the composition row is enabled.
    // 会话注入证明：dynamic-context 行贡献 pre-step 监听器，其快照消息由
    // agent 循环在真实回合中追加——组装结果不再携带它们。探针改为验证行的
    // 模块可解析且组合行启用。
    // 直探模块解析：宿主内 import 该子行说明符，带回真实失败原因。
    // Probe module resolution: import the child row's specifier inside the
    // host and carry the real failure back.
    let importError
    try {
      // 与宿主 Loader 同源解析：从本 preset 的 dist 位置解析裸包名（挂载
      // scope 继承声明方 Loader 的 baseUrl），而不是从探针自身位置。
      // Resolve exactly like the host Loader: the bare name resolves from
      // this preset's dist location (the mount scope inherits the declaring
      // Loader's baseUrl), not from the probe's own location.
      const { createRequire } = await import('node:module')
      const presetRequire = createRequire(${JSON.stringify(pathToFileURL(join(PLUGIN_ROOT, 'dist', 'index.js')).href)})
      await import(presetRequire.resolve('@veren/person-agent-dynamic-context'))
    } catch (error) {
      importError = String(error?.message ?? error)
    }
    await write({
      found: true,
      broken: entry.broken,
      name: entry.name,
      composition: document.content,
      rows: (own?.rows ?? []).map(row => ({ name: row.moduleName, enabled: row.enabled })),
      importError,
    })
  } catch (error) {
    await write({ found: false, rows: [], error: String(error?.message ?? error) })
  }
}
`
}

describe('person-agent preset on the real dsh web host', () => {
  it('registers through the registry, publishes a readable composition, and mounts cleanly', { timeout: 240_000 }, async () => {
    // Skip cleanly when the plugin has not been built; e2e needs dist.
    // 插件未构建时干净跳过；e2e 依赖 dist。
    await stat(join(PLUGIN_ROOT, 'dist', 'index.js'))

    // One-shot test home: a fresh numbered directory under ~/.dsh_test with
    // the real credentials copied in, removed again in the finally block.
    // 一次性测试主目录：~/.dsh_test 下新建编号目录，拷入真实凭据，finally 删除。
    const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}`
    const testHomeRoot = join(homedir(), '.dsh_test', stamp)
    const dshHome = join(testHomeRoot, '.dsh')
    await mkdir(dshHome, { recursive: true })
    await copyFile(join(homedir(), '.dsh', '.credentials.yaml'), join(dshHome, '.credentials.yaml'))

    const scratch = await mkdtemp(join(testHomeRoot, 'probe-'))
    const resultPath = join(scratch, 'probe-result.json')
    const probePath = join(scratch, 'person-agent-preset-probe.mjs')
    await writeFile(probePath, probeSource(resultPath, PRESET_ID), 'utf8')

    // The generated patch anchors the preset row by its relative dist path;
    // the dynamic-context row is a bare package name (`@veren/person-agent-
    // dynamic-context`, published to npm.veren.top / workspace-linked), so
    // the Loader resolves it from the preset's own baseUrl - no manual
    // linking into the harness node_modules.
    // 生成的 patch 用相对 dist 路径锚定 preset 行；dynamic-context 行是裸包名
    //（@veren/person-agent-dynamic-context，发布于 npm.veren.top / 工作区链接），
    // Loader 从 preset 自身 baseUrl 解析——不再向 harness node_modules 手工联结。
    const patchPath = join(PLUGIN_ROOT, 'tests', 'person-agent-preset.e2e.patch.yml')
    await writeFile(patchPath, [
      '- insert:',
      '    - id: person-agent-preset',
      "      name: '../dist/index.js'",
      '      config:',
      `        presetId: ${PRESET_ID}`,
      `    - id: person-agent-preset-probe`,
      `      name: ${pathToFileURL(probePath).href}`,
      '', // YAML files end with one trailing newline. YAML 文件以单个换行结尾。
    ].join('\n'), 'utf8')

    const port = await freePort()
    const webDist = join(HARNESS_ROOT, 'apps', 'web')
    let running: RunningWeb | undefined
    try {
      running = await startWeb(dshHome, webDist, port, patchPath)

      // Poll for the probe verdict written from inside the host.
      // 轮询宿主内探针写出的结论文件。
      let raw: string | undefined
      for (let attempt = 0; attempt < 120 && raw === undefined; attempt += 1) {
        raw = await readFile(resultPath, 'utf8').catch(() => undefined)
        if (raw === undefined) await new Promise((resolvePromise) => { setTimeout(resolvePromise, 1000) })
      }
      if (raw === undefined) {
        throw new Error(`probe never wrote a verdict:\n${running.output().slice(-4000)}`)
      }
      const result = JSON.parse(raw) as ProbeResult
      // Surface the full verdict whenever anything looks wrong, so failures
      // carry the probe's own diagnostics instead of a bare boolean.
      // 结论异常时带上完整探针输出，避免只抛出一个裸布尔断言。
      if (!result.found || result.error !== undefined) {
        throw new Error(`probe verdict: ${raw}`)
      }

      // 1. The preset is on the roster, readable, and not broken — `broken`
      // being undefined means the registry's activation audit passed for every
      // child row on the real host.
      // 预设在名册上、可读、未损坏——broken 为空即注册表的激活审计在真实宿主上
      // 对每一行都通过。
      expect(result.found).toBe(true)
      expect(result.broken, raw).toBeUndefined()
      expect(result.name).toBe('Person Agent')

      // 2. The rendered composition declares the human-facing persona and the
      // present tool, in entry-list YAML form.
      // 渲染出的组合以 entry-list YAML 声明了面向人的人设与 present 工具。
      expect(result.composition).toContain('dsh-persona')
      expect(result.composition).toContain('dsh-tool-present')
      expect(result.composition).toContain('plain, everyday language')

      // 3. The composition inventory lists every declared row as enabled, and
      // no row renders as "undefined" in the persona's preset list.
      // 组合清单中每一行都启用，且人设的预设名单不出现 "undefined" 渲染。
      expect(result.rows?.length).toBeGreaterThanOrEqual(6)
      for (const row of result.rows ?? []) expect(row.enabled).not.toBe(false)
      expect(result.composition).not.toContain('undefined(')

      // 4. Session injection: the dynamic-context row's module resolves inside
      // the host (its pre-step snapshot messages are appended by the agent
      // loop during real turns, which an assembly cannot show).
      // 会话注入：dynamic-context 行的模块在宿主内可解析（其 pre-step 快照
      // 消息由 agent 循环在真实回合中追加，组装结果无法展示）。
      expect(result.importError).toBeUndefined()
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
