import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { definePage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import PageRegistryPlugin, { PageRegistryService } from '../src/index.ts'

// 真实 cordis 根作用域：Service 构造会把自身注册为 'pageRegistry' 服务
function makeCtx(): Context {
  return new Context()
}

function detailPage() {
  return definePage({
    name: 'task-detail',
    url: '/task-detail/:taskId',
    description: '详情页',
  })
}

/** live 绑定假件：本文件只测注册/解析/端口 fail loud，从不挂视图
 * / a live-binding fake: this spec covers registration/resolution/port fail-loud, never view mounting */
const stubLive = { mount: () => { throw new Error('not mounted in this spec') } }

describe('PageRegistryService（Service 插件）', () => {
  it('是 Service 子类；默认导出即插件入口', () => {
    expect(PageRegistryService.prototype instanceof Service).toBe(true)
    expect(PageRegistryPlugin).toBe(PageRegistryService)
  })

  it('register → resolve/get/catalog/format 全链路（宿主作用域内可用）', () => {
    const ctx = makeCtx()
    const service = new PageRegistryService(ctx)
    const dispose = service.register(detailPage() as PageDefinition<never>, stubLive)

    expect(service.catalog()).toHaveLength(1)
    const match = service.resolve<{ id: string }[]>('/task-detail/t-9?focus=chat')
    expect(match?.params).toEqual({ taskId: 't-9', focus: 'chat' })
    expect(service.get<{ id: string }[]>('task-detail')).toBeDefined()
    expect(service.format('/task-detail/:taskId', { taskId: 't-1' })).toBe('/task-detail/t-1')

    dispose()
    expect(service.resolve('/task-detail/t-9')).toBeNull()
  })

  it('重名/URL 冲突 fail loud', () => {
    const service = new PageRegistryService(makeCtx())
    service.register(detailPage() as PageDefinition<never>, stubLive)
    expect(() => service.register(detailPage() as PageDefinition<never>, stubLive)).toThrow(/duplicate page name/)
  })

  it('端口未接线：openUrl fail loud（page/host-unavailable），不假成功（G13）', async () => {
    const service = new PageRegistryService(makeCtx())
    service.register(detailPage() as PageDefinition<never>, stubLive)
    await expect(service.openUrl('/task-detail/t-1'))
      .rejects.toMatchObject({ code: 'page/host-unavailable' })
  })
})
