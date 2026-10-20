import { describe, expect, it } from 'vitest'
import { Data, Keyed, Static, buildPagePreset, definePage } from '../src/index.ts'

describe('TSX 块组件', () => {
  it('Static/Data/Keyed 产出宿主块元素', () => {
    const blocks = [
      ...Static({ content: '头' }),
      ...Data({ path: 'task.status', value: 'open' }),
      ...Keyed({ path: 'tasks', items: [{ id: 't-1' }, { id: 't-2' }] }),
    ]
    expect(blocks.map((block) => block.type)).toEqual(['static', 'data', 'item', 'item'])
    expect(blocks[2]?.key).toBe('t-1')
    expect(blocks[1]?.props).toMatchObject({ path: 'task.status', value: 'open' })
  })
})

describe('definePage.events（声明形状；事件系统归 cordis）', () => {
  it('处理器拿 PageIO：append 可调用（接线由消费方 ctx.on 完成）', () => {
    const appended: string[] = []
    const page = definePage({
      name: 'p',
      url: '/p',
      description: 'x',
      events: {
        'task.completed': (payload, io) => { io.append(`${String((payload as { id: string }).id)} done`) },
      },
      tree: () => [],
    })
    const handler = page.events?.['task.completed']
    expect(handler).toBeDefined()
    handler?.({ id: 't-1' } as never, { append: (text) => appended.push(text), navigate: () => undefined })
    expect(appended).toEqual(['t-1 done'])
  })
})

describe('buildPagePreset（迁移期兼容；新代码不注册页面预设）', () => {
  // 页面定义不再携带 preset；旧调用方经 LegacyPresetCarrier 直接给声明
  const legacy = {
    name: 'task-detail',
    description: '详情页',
    preset: { systemPrompt: '详情页人设', order: 12 },
  }

  it('persona.prefix = preset.systemPrompt；工具行/工作记忆行按声明组装', () => {
    const preset = buildPagePreset(legacy, {
      presetId: 'page.task-detail',
      toolRows: [{ id: 'task-tools', name: '@veren/task-tools' }],
      contextRowName: '@veren/task-center-detail',
      contextRowConfig: { role: 'context' },
    })
    expect(preset.id).toBe('page.task-detail')
    expect(preset.order).toBe(12)
    expect(preset.plugins[0]).toMatchObject({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '详情页人设' } })
    expect(preset.plugins[1]).toMatchObject({ id: 'task-tools', name: '@veren/task-tools' })
    expect(preset.plugins[2]).toMatchObject({
      id: 'page-context',
      name: '@veren/task-center-detail',
      config: { role: 'context', page: 'task-detail' },
    })
  })

  it('无 preset.systemPrompt → fail loud', () => {
    const bare = { ...legacy, preset: undefined }
    expect(() => buildPagePreset(bare as never)).toThrow(/no preset.systemPrompt/)
  })

  it('PageDefinition 已无 preset 字段：definePage 输入里的 preset 被忽略', () => {
    const page = definePage({
      name: 'p',
      url: '/p',
      description: 'x',
      preset: { systemPrompt: 'ignored' },
      tree: () => [],
    })
    expect('preset' in page).toBe(false)
  })
})
