import { describe, expect, it } from 'vitest'
import { Data, Keyed, PageEventBus, Static, buildPagePreset, definePage } from '../src/index.ts'

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

describe('PageEventBus', () => {
  it('分发与取消订阅；处理器异常不断链', () => {
    const bus = new PageEventBus()
    const seen: string[] = []
    const off = bus.on('task.completed', (payload, io) => {
      seen.push(`a:${String((payload as { id: string }).id)}`)
      io.append('已记录')
    })
    bus.on('task.completed', () => {
      throw new Error('boom')
    })
    bus.on('task.completed', () => { seen.push('c') })
    const appended: string[] = []
    bus.emit('task.completed', { id: 't-1' }, { append: (text) => appended.push(text), navigate: () => undefined })
    expect(seen).toEqual(['a:t-1', 'c'])
    expect(appended).toEqual(['已记录'])

    off()
    bus.emit('task.completed', { id: 't-2' }, { append: () => undefined, navigate: () => undefined })
    expect(seen).toEqual(['a:t-1', 'c', 'c'])
  })
})

describe('buildPagePreset（动态声明，不用 yml）', () => {
  const page = definePage({
    name: 'task-detail',
    url: '/task-detail/:taskId',
    description: '详情页',
    preset: { systemPrompt: '详情页人设', order: 12 },
    events: {
      'task.completed': (_payload, io) => { io.append('done') },
    },
    tree: () => [],
  })

  it('persona.prefix = preset.systemPrompt；工具行/工作记忆行按声明组装', () => {
    const preset = buildPagePreset(page, {
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
    const bare = { ...page, preset: undefined }
    expect(() => buildPagePreset(bare)).toThrow(/no preset.systemPrompt/)
  })
})
