import { describe, expect, it } from 'vitest'
import { findForbiddenPageCalls } from '../check-page-api.mjs'

/**
 * 页面 API 门禁的自测：页面声明文件里禁用直接调 ctx 的固有生命周期成员。
 * Self-test for the page API gate: page declaration files may not call the
 * ctx's inherent lifecycle members directly.
 */
describe('check-page-api', () => {
  it('页面文件里的 ctx.effect / ctx.on / ctx.tools.register 都被标记', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      '  ctx.effect(() => undefined)',
      "  ctx.on('tasks/changed', () => undefined)",
      '  ctx.tools.register(definition)',
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source).map((hit) => hit.api))
      .toEqual(['ctx.page.effect', 'ctx.page.on', 'ctx.page.tool'])
  })

  it('ctx.page.* 通过；非页面文件不扫描', () => {
    const page = 'export const Page: PageFC = (_props, ctx) => { ctx.page.effect(() => undefined); return null }'
    expect(findForbiddenPageCalls(page)).toEqual([])
    // 插件 apply 代码里的 ctx.effect 是合法的：没有页面声明就不扫描
    // ctx.effect in plugin apply code is legal: no page declaration, no scan
    expect(findForbiddenPageCalls('ctx.effect(() => undefined)')).toEqual([])
  })
})
