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
    tree: () => [],
  })
}

describe('PageRegistryService（Service 插件）', () => {
  it('是 Service 子类；默认导出即插件入口', () => {
    expect(PageRegistryService.prototype instanceof Service).toBe(true)
    expect(PageRegistryPlugin).toBe(PageRegistryService)
  })

  it('register → resolve/get/catalog/format 全链路（宿主作用域内可用）', () => {
    const ctx = makeCtx()
    const service = new PageRegistryService(ctx)
    const dispose = service.register(detailPage() as PageDefinition<never>)

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
    service.register(detailPage() as PageDefinition<never>)
    expect(() => service.register(detailPage() as PageDefinition<never>)).toThrow(/duplicate page name/)
  })
})
