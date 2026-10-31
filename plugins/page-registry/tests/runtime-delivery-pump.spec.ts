/**
 * 页面运行时验收（缺口 1/4 收尾）：会话启动时的收件箱投递泵（§5.2/§4.5 降级）
 * 与 reserved 残留行的启动清扫（§3.5.3/§7.5）。
 * Page-runtime acceptance (gaps 1/4 wrap-up): the inbox delivery pump at
 * session start (§5.2/§4.5 degrade) and the startup sweep of stale reserved
 * rows (§3.5.3/§7.5).
 *
 * @module @veren/page-registry/tests/runtime-delivery-pump
 */
import { describe, expect, it } from 'vitest'
import { makeService } from './runtime.harness.ts'

describe('缺口 1/4 收尾：通知投递泵、reserved 清扫', () => {
  /** 带投递面的装配 / assembly with a delivery face */
  function makeWithDelivery(notices: Array<{ deliveryId: string; text: string }>) {
    const harness = makeService()
    const marked: Array<{ id: string; error?: string }> = []
    // 绑定后的端口集（含投递面）原样回传，后续整体重传时不丢面
    // the bound port set (with the delivery face) is returned so later
    // wholesale rebinds never drop a face
    const ports = { ...harness.ports, deliveries: {
      pending: async () => notices,
      mark: async (id: string, error?: string) => { marked.push({ id, error }) },
    } }
    harness.service.bindPorts(ports)
    return { ...harness, ports, marked }
  }

  it('新会话启动即注入收件箱通知，并回报 delivered（§5.2 inbox）', async () => {
    const { service, sessions, marked } = makeWithDelivery([
      { deliveryId: 'd-1', text: '[task-center] 任务 A' },
      { deliveryId: 'd-2', text: '[task-center] 任务 B' },
    ])
    const opened = await service.openUrl('/apps/demo/task/1')
    const messages = sessions.messages.get(opened.sessionId) ?? []
    expect(messages.filter((m) => m.includes('[task-center]'))).toHaveLength(2)
    expect(marked).toEqual([{ id: 'd-1' }, { id: 'd-2' }])
  })

  it('注入失败保持 pending 并带原因，不阻塞页面打开（§4.5 降级）', async () => {
    const { service, sessions, ports, marked } = makeWithDelivery([{ deliveryId: 'd-1', text: 'x' }])
    // 会话端口假件没有 appendUserMessage 失败注入口：直接把 sessions 换成会抛的
    // （端口整体重传，纯参数）/ rebind wholesale with a failing session port
    service.bindPorts({
      ...ports,
      sessions: {
        ...sessions.port,
        appendUserMessage: async (_id, _text, source) => {
          // 只让通知注入失败，PAGE 块照常写入 / fail only the notice append
          if (source === 'task-center/notice') throw new Error('agent gone')
        },
      },
    })
    const opened = await service.openUrl('/apps/demo/task/1')
    expect(marked).toEqual([{ id: 'd-1', error: 'agent gone' }])
  })

  it('sweepReserved：会话不在的 reserved 行删除；live 行不动；无探测不动', async () => {
    const { service, sessions, kv } = makeService()
    await service.openUrl('/apps/demo/task/1')
    // 手工塞一条 reserved 幽灵行 / plant a ghost reserved row
    kv.map.set('/apps/demo/task/ghost', {
      url: '/apps/demo/task/ghost' as never, state: 'reserved', appId: 'demo',
      page: 'demo/task', sessionId: 's-missing', instanceTitle: 'x',
      params: {}, appVersion: '1', createdAt: 't', lastOpenedAt: 't',
    })
    const dropped = await service.instances.sweepReserved()
    expect(dropped).toEqual(['/apps/demo/task/ghost'])
    expect(kv.map.has('/apps/demo/task/1')).toBe(true)
    void sessions
  })
})
