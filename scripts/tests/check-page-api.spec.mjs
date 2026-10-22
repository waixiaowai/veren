import { describe, expect, it } from 'vitest'
import { findForbiddenPageCalls } from '../check-page-api.mjs'

/**
 * 页面 API 门禁的自测：页面回调里禁用直接调 ctx 的固有生命周期成员。
 * Self-test for the page API gate: page callbacks may not call the ctx's
 * inherent lifecycle members directly.
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
    // 插件 apply 代码里的 ctx.effect 是合法的：没有页面回调就不扫描
    // ctx.effect in plugin apply code is legal: no page callback, no scan
    expect(findForbiddenPageCalls('ctx.effect(() => undefined)')).toEqual([])
  })

  it('defineComponentPage( 的组件实参是页面回调', () => {
    const source = [
      'export const createPage = () => defineComponentPage(',
      '  (_props, ctx) => {',
      "    ctx.on('x', () => undefined)",
      '    return null',
      '  },',
      "  { url: '/p', description: 'p' },",
      ')',
    ].join('\n')
    expect(findForbiddenPageCalls(source).map((hit) => hit.api)).toEqual(['ctx.page.on'])
  })

  it('内联 pages.register((props, ctx) => …) 是页面回调；具名引用不是', () => {
    const inline = [
      "pages.register((props, ctx) => { ctx.effect(() => undefined); return null }, meta)",
    ].join('\n')
    expect(findForbiddenPageCalls(inline).map((hit) => hit.api)).toEqual(['ctx.page.effect'])
    // 组件定义在别处的具名注册不进扫描
    // A named reference registered elsewhere is not scanned here.
    expect(findForbiddenPageCalls('pages.register(Page, meta)')).toEqual([])
  })

  it('ctx 别名（const c = ctx）不漏报', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      '  const c = ctx',
      '  c.effect(() => undefined)',
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source).map((hit) => hit.api)).toEqual(['ctx.page.effect'])
  })

  it('解构（const { effect } = ctx / const { register } = ctx.tools）不漏报', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      '  const { effect, on } = ctx',
      '  effect(() => undefined)',
      "  on('x', () => undefined)",
      '  const { register } = ctx.tools',
      '  register(def)',
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source).map((hit) => hit.api))
      .toEqual(['ctx.page.effect', 'ctx.page.on', 'ctx.page.tool'])
  })

  it('下标访问 ctx["effect"] 与可选链 ctx?.on( 不漏报', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      "  ctx['effect'](() => undefined)",
      '  ctx?.on(\'x\', () => undefined)',
      "  ctx?.['tools']?.register(def)",
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source).map((hit) => hit.api))
      .toEqual(['ctx.page.effect', 'ctx.page.on', 'ctx.page.tool'])
  })

  it('注释与字符串里的 ctx.effect( 不误报', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      '  // ctx.effect(() => undefined) 只是注释',
      '  const tip = "call ctx.effect( here? no"',
      '  ctx.page.effect(() => undefined)',
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source)).toEqual([])
  })

  it('检查限定页面回调作用域：同文件 apply 层的 ctx.effect 不受牵连', () => {
    const source = [
      'export function apply(ctx: Context): void {',
      "  ctx.effect(() => undefined, 'apply')",
      '}',
      'export const createPage = () => defineComponentPage(',
      '  () => null,',
      "  { url: '/p', description: 'p' },",
      ')',
    ].join('\n')
    expect(findForbiddenPageCalls(source)).toEqual([])
  })

  it('内层函数自己的 ctx 参数遮蔽页面 ctx，不再误报', () => {
    const source = [
      'export const Page: PageFC = (_props, ctx) => {',
      '  const wire = (ctx: Context) => { ctx.effect(() => undefined) }',
      '  return null',
      '}',
    ].join('\n')
    expect(findForbiddenPageCalls(source)).toEqual([])
  })
})
