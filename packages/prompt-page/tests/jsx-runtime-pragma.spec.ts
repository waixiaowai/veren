/**
 * 宿主侧 TSX 的 JSX 运行时 pragma 契约。
 * The JSX runtime pragma contract for host-side TSX sources.
 *
 * 背景：真实宿主用 node --import tsx/esm 加载插件源码。tsx 按 **cwd 链**发现
 * tsconfig（与被编译文件位置无关）：宿主进程 cwd 在仓库根时链上没有
 * tsconfig.json，页面 tsx 会退到 esbuild 默认的 classic JSX，执行页面树时抛
 * "React is not defined"。每个会被宿主加载、内含 JSX 的源文件都必须在头部
 * 携带 `@jsxRuntime automatic @jsxImportSource @veren/prompt-core`，让编译
 * 不再依赖任何 tsconfig 的发现结果。本契约由两层钉住：
 * 1. 静态扫描：宿主侧含 JSX 的 tsx 源文件必须带 pragma；
 * 2. 行为复现：用宿主同款 tsx、以仓库根为 cwd 加载 task-workbench 页面树并
 *    执行——classic 编译会在此处抛错，pragma 在则通过。
 * Background: the real host loads plugin sources via `node --import tsx/esm`.
 * tsx discovers tsconfig along the **cwd chain** (independent of the compiled
 * file's location): with the host cwd at the repo root no tsconfig.json is on
 * that chain, so page tsx files fall back to esbuild's classic JSX and calling
 * a page tree throws "React is not defined". Every host-loaded TSX source that
 * contains JSX must carry the `@jsxRuntime automatic @jsxImportSource
 * @veren/prompt-core` header so compilation never depends on tsconfig
 * discovery. The contract is pinned twice:
 * 1. static scan: host-side JSX tsx sources must carry the pragma;
 * 2. behavioural repro: load and execute the task-workbench page tree with the
 *    host's own tsx and the repo root as cwd — classic compilation fails right
 *    there, the pragma passes.
 * @module @veren/prompt-page/tests/jsx-runtime-pragma.spec
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(packageDir, '..', '..')

/** 宿主侧 tsx 源文件（不含 client 构建面与测试）/ host-side tsx sources (no client build face, no tests) */
const HOST_TSX_SOURCES = [
  'packages/prompt-page/src/page.tsx',
  'plugins/task-workbench/src/pages.tsx',
  'plugins/sub2api-admin/src/pages.tsx',
  'plugins/forum-app/src/pages.tsx',
  'plugins/person-agent-app/src/pages.tsx',
  'plugins/page-sync-bench/src/page.tsx',
] as const

const PRAGMA_MARKER = '@jsxRuntime automatic'

describe('host-side TSX pragma contract', () => {
  it('every host-loaded JSX source carries the automatic runtime pragma', () => {
    for (const relative of HOST_TSX_SOURCES) {
      const head = readFileSync(join(repoRoot, relative), 'utf8').slice(0, 400)
      expect(head.includes(PRAGMA_MARKER), `${relative} must carry ${PRAGMA_MARKER}`).toBe(true)
    }
  })
})

/** harness 检出的 tsx 加载器入口；缺席（非稳定节点结构）时行为测试跳过 */
const harnessTsxEntry = join(repoRoot, 'deepseek', 'deepseek-harness', 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')

describe.skipIf(!existsSync(harnessTsxEntry))('page tree executes under the host tsx loader', () => {
  it('task-workbench listPage.tree runs with the repo root as cwd (no tsconfig on the chain)', () => {
    // 动态入口：加载源码 pages.tsx 并执行页面树——classic 编译恰好在此抛错
    // / dynamic entry: load the source pages.tsx and execute its page tree —
    // classic compilation fails exactly here
    const work = mkdtempSync(join(tmpdir(), 'veren-jsx-pragma-'))
    try {
      const entry = join(work, 'entry.mjs')
      const pagesUrl = pathToFileURL(join(repoRoot, 'plugins', 'task-workbench', 'src', 'pages.tsx')).href
      const storeUrl = pathToFileURL(join(repoRoot, 'plugins', 'task-workbench', 'src', 'store.ts')).href
      writeFileSync(entry, [
        `const pages = await import(${JSON.stringify(pagesUrl)})`,
        `const { TaskStore, makeList } = await import(${JSON.stringify(storeUrl)})`,
        'const store = new TaskStore(makeList(2))',
        'const nodes = pages.listPage.tree({}, store.getState())',
        "process.stdout.write('TREE_OK ' + (nodes !== undefined))",
        '',
      ].join('\n'), 'utf8')
      // 环境净洗（AGENTS 纪律）：剥敏感键与 DSH_*，大小写不敏感
      // / scrub the environment (AGENTS rule): strip secrets and DSH_* case-insensitively
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue
        if (/^(key|password|secret|token|dsh_)/i.test(key)) continue
        env[key] = value
      }
      const stdout = execFileSync(process.execPath, [
        '--import', pathToFileURL(harnessTsxEntry).href, entry,
      ], { cwd: repoRoot, env, encoding: 'utf8', timeout: 60_000 })
      expect(stdout).toContain('TREE_OK true')
      expect(stdout).not.toContain('React is not defined')
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})
