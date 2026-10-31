/**
 * Shared fixtures for the im tool specs: a tiny tool registry, a wired
 * router+people over the fake provider, and a result narrower.
 *
 * im 工具测试的共享夹具：微型工具注册表、基于假 provider 接线的 router+people，以及
 * 结果收窄助手。
 *
 * @module tests/tool-helpers
 */

import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ImPeople, ImRegistry, ImRouter } from '@veren/im'
import { createFakeProvider } from '../../testkit/src/index.ts'
import { registerImTools } from '../src/tools.ts'
import { registerPeopleTools } from '../src/people-tools.ts'
import { registerReportTool } from '../src/report-tool.ts'
import { TestStore } from './test-store.ts'

/** Tiny tool registry that runs the definition a tool plugin registered. */
/** 微型工具注册表，运行工具插件注册的定义。 */
export class ToolTable {
  readonly definitions = new Map<string, ToolDefinition>()

  register(definition: ToolDefinition): () => void {
    this.definitions.set(definition.name, definition)
    return () => { this.definitions.delete(definition.name) }
  }

  async call(name: string, args: unknown): Promise<unknown> {
    const definition = this.definitions.get(name)
    if (definition === undefined) throw new Error(`tool not registered: ${name}`)
    return definition.execute(args, { signal: new AbortController().signal } as ToolRunContext)
  }
}

/** Wire the full im tool set over a memory store and the fake provider. */
/** 在内存存储与假 provider 之上接线完整的 im 工具集。 */
export async function setup() {
  const ctx = new Context()
  const store = new TestStore()
  await store.putAccount({ id: 'acc-1', provider: 'fake', token_ref: 'im/x' })
  const fake = createFakeProvider({ id: 'fake' })
  const registry = new ImRegistry(ctx, () => {})
  registry.register(fake.provider)
  const logger = { warn() {}, error() {} }
  const people = new ImPeople({ store, logger })
  const router = new ImRouter({
    store,
    registry,
    gateway: {
      async ensureSession() { return { sessionId: 'session-1', created: true } },
      async ask() { return undefined },
    },
    credentials: { async remove() {} },
    people,
    logger,
    config: {},
  })
  const tools = new ToolTable()
  ctx.provide('tools', tools)
  registerImTools(ctx, router)
  registerPeopleTools(ctx, router)
  registerReportTool(ctx, router)
  return { store, fake, tools, router, people }
}

/** Narrow one tool result to a plain record. */
/** 把一个工具结果收窄为普通记录。 */
export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
  return value as Record<string, unknown>
}
