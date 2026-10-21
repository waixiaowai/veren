import { describe, expect, it } from 'vitest'
import { defineAppPage, definePage } from '../src/index.ts'
import {
  APPS_URL_PREFIX,
  RESERVED_APP_IDS,
  assertAppUrlPattern,
  assertParamsMatchPattern,
  homeMapIssues,
  isAppUrlPattern,
  isValidAppId,
  patternParamsOf,
} from '../src/contract.ts'
import type { PageDefinition } from '../src/index.ts'

describe('应用作用域 URL 形态（§6.1）', () => {
  it('isValidAppId：slug 规则 + 保留字', () => {
    expect(isValidAppId('review-workbench')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
    expect(isValidAppId('Review')).toBe(false)
    expect(isValidAppId('1abc')).toBe(false)
    expect(isValidAppId('a_b')).toBe(false)
    expect(isValidAppId('a'.repeat(33))).toBe(false)
    for (const reserved of RESERVED_APP_IDS) expect(isValidAppId(reserved)).toBe(false)
  })

  it('assertAppUrlPattern：/apps/<appId>/... 形态 + :param 规则', () => {
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/review/:pr')).not.toThrow()
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench')).not.toThrow()
    expect(isAppUrlPattern('/apps/review-workbench/review/:pr')).toBe(true)
    expect(isAppUrlPattern(APPS_URL_PREFIX + '/a')).toBe(true)

    expect(() => assertAppUrlPattern('p', '/task-list')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps/api/x')).toThrow(/invalid app id/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/apps/x')).toThrow(/"apps" segment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x?y=1')).toThrow(/query or fragment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:a/:a')).toThrow(/duplicate :param/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:')).toThrow(/invalid or duplicate :param/)
  })
})

describe('defineAppPage（应用作用域契约）', () => {
  const title = (params: { pr?: string }) => `审阅 PR #${params.pr ?? '?'}`
  const good = {
    name: 'review',
    url: '/apps/review-workbench/review/:pr',
    description: '审阅一个 PR 的改动',
    tools: ['read_diff'],
    // 二级页规则 3：writes + 工具 + 说明缺一不可 / rule 3: writes + tools + instructions
    writes: true,
    instructions: '先读 diff，再给结论。',
    instanceTitle: title as never,
    tree: () => [],
  }

  it('合法：契约字段原样保留', () => {
    const page = defineAppPage(good)
    expect(page.url).toBe('/apps/review-workbench/review/:pr')
    expect(page.tools).toEqual(['read_diff'])
    expect(page.instructions).toBe('先读 diff，再给结论。')
    expect(page.instanceTitle?.({ pr: '42' })).toBe('审阅 PR #42')
  })

  it('缺省补齐：tools=[]（一级页允许无工具；二级页由规则 3 拒绝空工具）', () => {
    // 一级页（无 :param、无 writes）：工具缺省 [] 合法 / a home page: the tools default [] is legal
    const page = defineAppPage({
      ...good, url: '/apps/review-workbench/list',
      writes: false, instructions: undefined, tools: undefined,
    })
    expect(page.tools).toEqual([])
  })

  it('URL 非 /apps 形态 → fail loud（definePage 不做此校验，保证迁移期兼容）', () => {
    expect(() => defineAppPage({ ...good, url: '/review/:pr' })).toThrow(/must start with/)
    expect(() => definePage({ ...good, url: '/review/:pr' })).not.toThrow()
  })
})

describe('两级页面校验（§3.10.5）', () => {
  const home = {
    name: 'list',
    url: '/apps/review-workbench/list',
    description: '审阅列表',
    tools: ['pick'],
    instructions: '浏览全部审阅。',
    map: [{ url: '/apps/review-workbench/review/:pr', use: '处理某一条审阅时打开', params: { pr: 'PR 号' } }],
    tree: () => [],
  }

  it('规则 3：二级页缺 writes / 缺工具 / 缺说明 → page/detail-invalid（注册期拒绝）', () => {
    // writes: false（未声明 true）即违规 / writes: false (not declared true) violates rule 3
    expect(() => defineAppPage({ ...home, name: 'd1', url: '/apps/review-workbench/review/:pr' }))
      .toThrowError(expect.objectContaining({ code: 'page/detail-invalid' }))
    expect(() => defineAppPage({ ...home, name: 'd2', url: '/apps/review-workbench/review/:pr', tools: [] }))
      .toThrowError(expect.objectContaining({ code: 'page/detail-invalid' }))
    expect(() => defineAppPage({ ...home, name: 'd3', url: '/apps/review-workbench/review/:pr', instructions: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'page/detail-invalid' }))
    // 合规二级页照常通过 / a compliant detail page passes
    expect(() => defineAppPage({
      ...home, name: 'd0', url: '/apps/review-workbench/review/:pr',
      writes: true, tools: ['read_diff'], instructions: '只处理这一条审阅。',
    })).not.toThrow()
  })

  it('规则 2（不校验）：一级页没有写工具也不报警——pageToolWarning 只认 writes: true 声明', () => {
    // 一级页不声明 writes → 装配期完备性警告对它天然沉默（见 page.spec 的警告用例）
    // / a home page declares no writes → the assembly warning stays silent for it
    expect(() => defineAppPage(home)).not.toThrow()
  })

  it('规则 1/4 的静态面：patternParamsOf 区分一级（无 :param）与二级（有 :param）', () => {
    expect(patternParamsOf('/apps/x/list')).toEqual([])
    expect(patternParamsOf('/apps/x/review/:pr')).toEqual(['pr'])
    expect(patternParamsOf('/apps/x/a/:one/b/:two')).toEqual(['one', 'two'])
  })

  it('规则 5（挂载期）：params 缺模式声明的 :param → page/params-mismatch fail loud；额外查询键合法', () => {
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', { pr: '7' })).not.toThrow()
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', { pr: '7', focus: 'chat' })).not.toThrow()
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', {})).toThrowError(expect.objectContaining({ code: 'page/params-mismatch' }))
  })
})

describe('一级页能力地图覆盖查询（§3.10 验收面，homeMapIssues）', () => {
  const home: PageDefinition<never> = {
    name: 'list',
    url: '/apps/x/list',
    description: '列表',
    tree: (() => []) as PageDefinition<never>['tree'],
  }
  const detail = (name: string, url: string): PageDefinition<never> => ({
    name, url, description: name, tree: (() => []) as PageDefinition<never>['tree'],
  })

  it('map 列全全部二级页模板 + 每条带"什么时候用" → 空问题清单', () => {
    const pages = [home, detail('review', '/apps/x/review/:pr'), detail('note', '/apps/x/note/:noteId')]
    const covered: PageDefinition<never> = {
      ...home,
      map: [
        { url: '/apps/x/review/:pr', use: '处理某条审阅时打开' },
        { url: '/apps/x/note/:noteId', use: '读某条笔记时打开' },
      ],
    }
    expect(homeMapIssues(covered, pages)).toEqual([])
  })

  it('漏掉二级页 / use 为空 / 指向未注册页面 / 一级页带 :param → 逐条报告', () => {
    const pages = [home, detail('review', '/apps/x/review/:pr')]
    const missing: PageDefinition<never> = { ...home, map: [{ url: '/apps/x/ghost/:id', use: 'x' }] }
    const issues = homeMapIssues(missing, pages)
    expect(issues.some((issue) => issue.includes('missing from the home map'))).toBe(true)
    expect(issues.some((issue) => issue.includes('not a registered page'))).toBe(true)

    const emptyUse: PageDefinition<never> = { ...home, map: [{ url: '/apps/x/review/:pr', use: ' ' }] }
    expect(homeMapIssues(emptyUse, pages).some((issue) => issue.includes('empty "use"'))).toBe(true)

    const noMap: PageDefinition<never> = { ...home }
    expect(homeMapIssues(noMap, pages).some((issue) => issue.includes('empty map'))).toBe(true)

    const paramHome: PageDefinition<never> = { ...home, url: '/apps/x/list/:view', map: [] }
    expect(homeMapIssues(paramHome, [paramHome]).some((issue) => issue.includes('parameter-free'))).toBe(true)
  })
})
