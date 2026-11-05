import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { auditSurface } from '../check-model-surface.mjs'
import { buildModelSurface, normalizeMounts } from '../lib/model-surface/surface.mjs'
import { checkRegistry, urlMatches } from '../lib/model-surface/verdict.mjs'
import { snakeGroupsOf } from '../lib/model-surface/strings.mjs'

const ROOT = join(import.meta.dirname, '..', '..')

/**
 * 模型面门禁的自测：临时夹具仓验证"漂移能被抓到、豁免能放行"，再对真实仓
 * 做一次冒烟锚（18 页、5 应用、零未决）。
 * Self-test for the model-surface gate: a temp fixture workspace proves drifts
 * are caught and exemptions honored, plus a real-workspace smoke anchor
 * (18 pages, 5 apps, zero unresolved).
 */
describe('check-model-surface', () => {
  const dir = mkdtempSync(join(tmpdir(), 'model-surface-fixture-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** 在夹具仓里写一个插件源文件 / write one plugin source file into the fixture */
  const write = (pkg, name, text) => {
    mkdirSync(join(dir, 'plugins', pkg, 'src'), { recursive: true })
    writeFileSync(join(dir, 'plugins', pkg, 'src', name), text)
  }

  write('demo-app', 'app.ts', [
    "import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'",
    "export const APP_ID = 'demo' as AppId",
    'export const APP_DEFINITION: ApplicationDefinition = {',
    '  id: APP_ID, name: "demo", entry: "main" as PageKey, toolPrefix: "demo",',
    '  instructions: "demo 应用说明。",',
    '}',
  ].join('\n'))
  write('demo-app', 'tools.ts', [
    "import { defineTool } from '@deepseek-ai/dsh-tools'",
    'export const listItems = defineTool({ name: "list_items", description: "列出条目。List items.", parameters: {} })',
    'export const removeItem = defineTool({ name: "remove_item", description: "删除条目。Remove one item.", parameters: {} })',
  ].join('\n'))
  write('demo-app', 'page-main.tsx', [
    "import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'",
    'import { removeItem, listItems } from "./tools.ts"',
    'export const MainPage: PageFC = (_props, agent) => {',
    '  agent.ctx.tools.register(listItems)',
    '  return null',
    '}',
    'export const MainMeta: ComponentPageMeta = {',
    '  name: "main", url: "/apps/demo/main", description: "主页面。The main page.",',
    '  instructions: "用 list_items 列出条目；删除走 remove_item（本页未挂，见下）。"',
    '    + "要找别的页面请打开 /apps/demo/missing。",',
    '}',
  ].join('\n'))
  write('demo-app', 'page-other.tsx', [
    "import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'",
    'export const OtherPage: PageFC = (_props, agent) => {',
    '  agent.ctx.tools.register(unknownFactory())',
    '  return null',
    '}',
    'export const OtherMeta: ComponentPageMeta = {',
    '  name: "other", url: "/apps/demo/other", description: "副页面。The other page.",',
    '}',
  ].join('\n'))
  write('demo-app', 'index.ts', [
    "import { APP_ID } from './app.ts'",
    "import { MainPage, MainMeta } from './page-main.tsx'",
    "import { OtherPage, OtherMeta } from './page-other.tsx'",
    'export function apply(ctx: Context): void {',
    '  const pages = ctx.apps.pages(APP_ID, ctx)',
    '  pages.register(MainPage, MainMeta)',
    '  pages.register(OtherPage, OtherMeta)',
    '}',
  ].join('\n'))
  write('task-center', 'page-face.ts', [
    "import { defineTool } from '@deepseek-ai/dsh-tools'",
    'export const taskComplete = defineTool({ name: "task_complete", description: "完成本页那条。Complete it.", parameters: {} })',
    'export const taskFail = defineTool({ name: "task_fail", description: "失败回报。Fail it.", parameters: {} })',
  ].join('\n'))
  write('page-registry', 'page-block.ts', [
    'export function taskBlock(taskId: string): string {',
    '  const title = "t"',
    '  return `TASK ${taskId} ${title}\\n完成后用 task_complete 回报结果；做不下去用 task_fail 带稳定错误码回报。`',
    '}',
  ].join('\n'))

  it('夹具仓：承诺未挂 / 宿主文本 / 未决挂载 / 手写 URL 全部被抓到', async () => {
    const { surface, drifts } = await auditSurface(dir)
    const keys = drifts.map((drift) => drift.key)
    const surface2 = { ...surface, pages: surface.pages.map((page) => ({ ...page, mountedFull: [], mountedLocals: [] })) }
    void surface2
    expect(keys).toContain('promise@demo/main:remove_item')
    expect(keys).toContain('host-text:task_complete@demo/main')
    expect(keys).toContain('host-text:task_fail@demo/other')
    expect(keys.some((key) => key.startsWith('mount@demo/other'))).toBe(true)
    expect(keys).toContain('url-unregistered@demo/main')
  })

  it('夹具仓：层①豁免放行单页应用的 map-orphan', async () => {
    const { surface } = await auditSurface(dir)
    const mainOnly = { ...surface, pages: surface.pages.filter((page) => page.key === 'demo/main') }
    const withoutExempt = checkRegistry(mainOnly, new Map())
    expect(withoutExempt.some((drift) => drift.key === 'map-orphan@demo/main')).toBe(true)
    const withExempt = checkRegistry(mainOnly, new Map([['demo/main', '单页应用：没有兄弟页可画 map（夹具理由）']]))
    expect(withExempt.some((drift) => drift.key === 'map-orphan@demo/main')).toBe(false)
  })

  it('URL 模板匹配：:参数 段通配、段数不齐不匹配', () => {
    expect(urlMatches('/apps/demo/task/7', '/apps/demo/task/:taskId')).toBe(true)
    expect(urlMatches('/apps/demo/task/7/extra', '/apps/demo/task/:taskId')).toBe(false)
    expect(urlMatches('/apps/demo/main', '/apps/demo/task/:taskId')).toBe(false)
  })

  it('蛇形词元分组：仅分隔符相邻同组、散文断组、句号断句', () => {
    expect(snakeGroupsOf('用 list_items 列表、remove_item 删除；task_take/task_fail 回报。别提 set_rates。'))
      .toEqual([['list_items'], ['remove_item'], ['task_take', 'task_fail'], ['set_rates']])
  })

  it('真实仓冒烟锚：23 页 / 7 应用 / 挂载零未决', async () => {
    const surface = await buildModelSurface(ROOT)
    expect(surface.pages.length).toBe(23)
    expect([...surface.apps.keys()].sort()).toEqual(['crawler', 'forum', 'notebook', 'person-agent', 'sub2api-admin', 'task-workbench', 'zhihu-ops'])
    expect(normalizeMounts(surface).length).toBe(0)
    const workbench = surface.pages.find((page) => page.key === 'task-workbench/detail')
    expect(workbench.mountedFull).toContain('task_workbench__take_page_task')
    expect(workbench.mountedFull).not.toContain('task_workbench__task_complete')
    const overview = surface.pages.find((page) => page.key === 'person-agent/overview')
    expect(overview.mounts.skills).toContain('renhua')
  })
})
