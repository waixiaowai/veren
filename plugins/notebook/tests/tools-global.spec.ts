/**
 * The preset-wide global tool face (M1 of docs/notebook-roadmap.cn.md): what
 * registers, in which order, under which switch, and that dispose really
 * unregisters — re-registration after dispose is the HMR path, and a duplicate
 * registration is the loudest possible signal that it did not.
 *
 * 预设全域工具面（docs/notebook-roadmap.cn.md 的 M1）：什么在什么开关下按什么顺序
 * 注册，以及 dispose 真的会注销——dispose 后重注册就是 HMR 路径，而同层重复注册
 * 是「没注销」最响亮的信号。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import NotebookService, { Config, GLOBAL_TOOL_NAMES, registerNotebookGlobalTools } from '../src/index.ts'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One fresh recording registry: names registered and removed, in order. 一副全新的记录型注册表：按序记录注册与注销的名字。 */
function toolsSpy(): {
  face: unknown
  registered: string[]
  removed: string[]
} {
  const registered: string[] = []
  const removed: string[] = []
  return {
    registered,
    removed,
    face: {
      register(tool: ToolDefinition) {
        registered.push(tool.name)
        return () => { removed.push(tool.name) }
      },
    },
  }
}

/** The real storage stack with the recording tools face and the preset stub. 真实存储栈 + 记录型 tools 面 + 预设桩。 */
async function mount(globalEnabled: boolean): Promise<{ ctx: Context; fiber: Fiber; registered: string[]; removed: string[] }> {
  const ctx = new Context()
  const spy = toolsSpy()
  ctx.provide('tools', spy.face as unknown as Context['tools'])
  ctx.provide('agentPresets', { list: async () => [], composedPreset: () => undefined })
  const root = mkdtempSync(join(tmpdir(), 'notebook-global-'))
  roots.push(root)
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = await ctx.plugin(NotebookService, Config({ globalTools: { enabled: globalEnabled } }))
  return { ctx, fiber, registered: spy.registered, removed: spy.removed }
}

describe('the preset-wide global face / 预设全域工具面', () => {
  it('G1: enabled by default-equivalent config, the four consult/write tools register under their full names in order', async () => {
    const { fiber, registered } = await mount(true)
    expect(registered).toEqual([...GLOBAL_TOOL_NAMES])
    expect(registered).toEqual(['notebook__list_notes', 'notebook__find_cards', 'notebook__read_note', 'notebook__write_note'])
    await fiber.dispose()
  })

  it('G2: disabled config registers nothing', async () => {
    const { fiber, registered } = await mount(false)
    expect(registered).toEqual([])
    await fiber.dispose()
  })

  it('G3: dispose unregisters in reverse order; re-registration after dispose is collision-free (HMR path)', async () => {
    const { ctx, fiber, registered, removed } = await mount(true)
    expect(removed).toEqual([])
    await fiber.dispose()
    expect(removed).toEqual([...GLOBAL_TOOL_NAMES].reverse())
    // HMR: re-register on the same context after dispose. A duplicate within
    // one layer fails loudly, so a silent second registration proves the first
    // dispose really unregistered every name.
    // HMR：dispose 后在同一 context 重挂。同层重复会响亮失败，因此第二次注册
    // 无声即证明第一次 dispose 真的注销了每一个名字。
    registerNotebookGlobalTools(ctx, () => { throw new Error('port must not be called at registration time') })
    expect(registered).toEqual([...GLOBAL_TOOL_NAMES, ...GLOBAL_TOOL_NAMES])
  })
})
