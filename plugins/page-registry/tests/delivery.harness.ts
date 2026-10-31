/**
 * 投递运行时测试夹具：投递形态的会话端口假件（记录 wake 选项）、投递夹具页与
 * 组装好的投递服务。delivery.spec 唯一的夹具来源。
 * The delivery-runtime test fixtures: the delivery-flavored session-port fake
 * (records wake options), the delivery fixture page, and the assembled
 * delivery service — the single fixture source for delivery.spec.
 *
 * @module @veren/page-registry/tests/delivery.harness
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, defineComponentPage } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import { memKv } from './kv.harness.ts'
import { PageRegistryService } from '../src/index.ts'
import type { PageRuntimePorts, PageSessionPort } from '../src/runtime.ts'
import type { AppRecord } from '@veren/app-registry'

/** 会话端口假件：记录 append 的 wake 选项；工具面按会话记账（差集的真实来源）
 * / session fake recording wake options; the tool face books per session (the real source of the delta) */
export function fakeSessions() {
  const created: string[] = []
  const messages = new Map<string, string[]>()
  const wakeOptions: Array<boolean | undefined> = []
  const focused: string[] = []
  const faces = new Map<string, Array<{ name: string; description: string }>>()
  const port: PageSessionPort = {
    exists: (id) => created.includes(id),
    mintId: () => `s-${created.length + 1}`,
    async create(id) {
      created.push(id); messages.set(id, [])
      const face: Array<{ name: string; description: string }> = []
      faces.set(id, face)
    },
    agentOf: (id) => ({
      ctx: {
        tools: { register: (definition: { name: string; description?: string }) => { faces.get(id)?.push({ name: definition.name, description: definition.description ?? '' }); return () => undefined } },
        effect: () => async () => undefined,
        on: () => () => undefined,
      },
      session: { id },
    }) as never,
    // 快照必须拷贝：活引用会让 before/after 同数组、差集恒空
    // / the snapshot must copy: a live reference makes before/after one array and the delta permanently empty
    toolFace: (id) => [...(faces.get(id) ?? [])],
    async retire() {},
    async appendUserMessage(id, text, source, options) {
      wakeOptions.push(options?.wake)
      messages.get(id)?.push(`${source}::${text}`)
    },
    async focus(id) { focused.push(id) },
    async destroy(id) { faces.delete(id) },
  }
  return { port, created, messages, wakeOptions, focused }
}

/** 投递夹具页：组件页形态（live 必填），正文一行即可——投递测试只关心块与消息
 * / the delivery fixture page: the component-page shape (live required), a one-line body — delivery tests care about blocks and messages */
function taskPageRegistration() {
  return defineComponentPage(
    (_props: Record<string, string>, agent) => {
      // 工具只在页面存在：组件体直登（设计律）/ a tool exists only inside a page: registered in the body (design law)
      agent.ctx.tools.register(defineTool({
        name: 'read', description: '读材料', parameters: {},
        output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
        execute: async () => ({ ok: true }),
      }))
      return createElement('p', { children: '任务详情' })
    },
    {
      url: '/apps/demo/task/:id',
      description: '任务详情页',
      writes: true,
      instructions: '只处理 params.id 指定的这一条任务。',
    },
  )
}

/** 组装一个带页面/端口假件的投递服务 / assemble a delivery-ready service */
export function makeService() {
  const ctx = new Context()
  const service = new PageRegistryService(ctx)
  const task = taskPageRegistration()
  const dispose = service.register(task.page, task.live)
  const kv = memKv()
  const sessions = fakeSessions()
  const app: AppRecord = {
    definition: { id: 'demo' as never, name: 'Demo', description: 'demo app', entry: 'task' as never },
    owner: 'test', version: '1.0.0', toolPrefix: 'demo', state: 'active',
  }
  const ports = {
    sessions: sessions.port,
    apps: { get: () => app },
  } satisfies PageRuntimePorts
  service.bindPorts(ports, new KvPageInstanceIndex(kv, { sessionExists: (id) => sessions.port.exists(id) }))
  return { service, kv, sessions, ports, dispose, ctx }
}

/** 便捷投递 / deliver shorthand */
export function deliver(service: PageRegistryService, url: string, callerSessionId?: string) {
  return service.deliverUrl(url, { message: '干这活', ...(callerSessionId === undefined ? {} : { callerSessionId }) })
}
