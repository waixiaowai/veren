// 插件入口的组合测试：工具注册的 dispose/HMR 安全，以及正常切换、
// 缺 sessionId 继承调用方、宿主报错透传三条主流程。
// Composition tests for the plugin entry: dispose/HMR safety of the tool
// registration, plus the three main flows — a normal switch, caller-session
// inheritance when sessionId is omitted, and host-error passthrough.
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'
import { TOOL_NAME } from '../src/select-request.js'
import { SelectModelToolError } from '../src/types.js'

/** 假宿主选择记录：收到的请求与返回值。Recorded host selections. */
interface Selection {
  readonly request: Record<string, unknown>
  readonly value: { selected: { provider: string, model: string, reasoningEffort?: string } }
}

interface Effect {
  readonly label: string
  readonly dispose: () => void
}

/**
 * 假 ctx：记录 effect 与工具注册，sessionController 按脚本应答。
 * A fake ctx recording effects and tool registrations; the sessionController
 * answers from a scripted list.
 */
function fakeCtx(options: { hostError?: Error } = {}) {
  const tools = new Map<string, { name: string, execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const effects: Effect[] = []
  const selections: Selection[] = []
  const ctx = {
    effect(factory: () => () => void, label: string) {
      effects.push({ label, dispose: factory() })
    },
    tools: {
      register: (definition: never) => {
        const tool = definition as { name: string, execute: (args: unknown, exec: unknown) => Promise<unknown> }
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    sessionController: {
      selectModel: async (request: Record<string, unknown>) => {
        if (options.hostError !== undefined) throw options.hostError
        const selected = {
          provider: request.provider as string,
          model: request.model as string,
          ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort as string }),
        }
        selections.push({ request, value: { selected } })
        return { selected }
      },
    },
  }
  return {
    ctx: ctx as never,
    tools,
    effects,
    selections,
    execute: (args: unknown, agentId?: string) => {
      // 每个用例都走真实 apply 注册路径，保证测到的是插件真实装配的工具。
      // Every case registers through the real apply path, so the tool under
      // test is the one the plugin actually assembles.
      apply(ctx as never, {})
      return tools.get(TOOL_NAME)!.execute(args, { agent: agentId === undefined ? undefined : { id: agentId } })
    },
  }
}

describe('apply（注册与 dispose / registration and disposal）', () => {
  it('注册一个工具，dispose 后注册表为空（HMR 安全）/ registers one tool and empties the registry after dispose', () => {
    const { ctx, tools, effects } = fakeCtx()
    apply(ctx, {})
    expect(tools.has(TOOL_NAME)).toBe(true)
    expect(effects).toHaveLength(1)
    // 逆序清理约定：卸载所有 effect 后不得残留注册项。
    // Reverse-order cleanup contract: no registration may survive disposing
    // every effect.
    for (const effect of [...effects].reverse()) effect.dispose()
    expect(tools.size).toBe(0)
  })
})

describe('select_model（执行主流程 / the execution flows）', () => {
  it('正常切换：显式 sessionId + effort，请求与返回值完整 / a normal switch with an explicit session and effort', async () => {
    const { execute, selections } = fakeCtx()
    const value = await execute({ sessionId: 'session-a', provider: 'pp', model: 'pm', reasoningEffort: 'high' }, 'session-caller')
    expect(selections).toHaveLength(1)
    expect(selections[0].request).toEqual({ sessionId: 'session-a', provider: 'pp', model: 'pm', reasoningEffort: 'high' })
    expect(value).toEqual({ sessionId: 'session-a', provider: 'pp', model: 'pm', reasoningEffort: 'high' })
  })

  it('缺 sessionId 继承调用方会话 / inherits the calling session when sessionId is omitted', async () => {
    const { execute, selections } = fakeCtx()
    const value = await execute({ provider: 'pp', model: 'pm' }, 'session-caller')
    expect(selections[0].request).toEqual({ sessionId: 'session-caller', provider: 'pp', model: 'pm' })
    expect(value).toEqual({ sessionId: 'session-caller', provider: 'pp', model: 'pm' })
  })

  it('宿主未返回 effort 时结果不带该键 / the result omits the effort key when the host returns none', async () => {
    const { execute } = fakeCtx()
    const value = await execute({ provider: 'pp', model: 'pm' }, 'session-caller') as Record<string, unknown>
    expect('reasoningEffort' in value).toBe(false)
  })

  it('缺参报错：不带任何宿主调用 / a missing argument fails before any host call', async () => {
    const { execute, selections } = fakeCtx()
    // defineTool 的 schema 先拦截 required 缺参，抛 ToolArgsError；
    // 纯函数层的成对校验是第二道防线（由 select-request.spec 覆盖）。
    // defineTool's schema intercepts a missing required arg with ToolArgsError;
    // the pure layer's pairing check is the second gate (covered in
    // select-request.spec).
    await expect(execute({ provider: 'pp' }, 'session-caller')).rejects.toThrow(/missing required property "model"/)
    expect(selections).toHaveLength(0)
  })

  it('宿主报错透传：未知 provider/model 的信息原样冒出 / host errors pass through verbatim', async () => {
    const { execute } = fakeCtx({ hostError: new Error('unknown provider "pp"') })
    await expect(execute({ provider: 'pp', model: 'pm' }, 'session-caller')).rejects.toThrow('unknown provider "pp"')
  })

  it('无调用方也无 sessionId 时报 NO_CALLER / reports NO_CALLER without a caller or explicit session', async () => {
    const { execute, selections } = fakeCtx()
    await expect(execute({ provider: 'pp', model: 'pm' })).rejects.toBeInstanceOf(SelectModelToolError)
    expect(selections).toHaveLength(0)
  })
})
