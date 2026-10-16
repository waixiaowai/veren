// 拆分后每个职责都成了可单独验证的小函数：本文件覆盖渲染与日志读取两个纯逻辑
// 模块（会话信息渲染已随"工作区只列工作区"的需求移除）。
// After the split every responsibility is a small testable function: this file
// covers the two pure-logic modules (rendering and session log reads). The
// session-info rendering was removed along with the "workspace list renders
// workspaces only" requirement.
//
// 类型策略：日志替身直接用插件公开的 SessionLogView（它是宿主 Session 的只读投影，
// 由 type-pins 断言「Session 可直接传入」）。因此测试里唯一需要的转换就是
// SessionSeq（宿主品牌号），不再有任何「自造结构 vs 宿主类型」的错配。
// Typing strategy: the log doubles implement the plugin's own SessionLogView (a
// read-only projection of the host Session). The only conversion needed is
// SessionSeq, the host's branded sequence number.
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderAgentPreset, renderWorkspace, withHeading } from '../src/render.ts'
import { renderModelCatalogModel } from '../src/model-catalog.ts'
import { deriveFallbackTitle, lastSnapshotSectionText, lastSnapshotText, selectedPreset } from '../src/session-events.ts'
import type { SessionLogView, SnapshotEvent } from '../src/session-events.ts'

/**
 * 构造一条日志事件：转换（cast）只在这里发生一次，其余用例只描述数据形状。
 * Builds one log event: the cast happens here and only here; every other case
 * merely describes the data shape.
 */
const makeEvent = <K extends SnapshotEvent['type']>(type: K, data: unknown): SnapshotEvent =>
  ({ type, data }) as SnapshotEvent

/** 一条人类消息事件。One human-message event. */
const humanEvent = (...blocks: readonly { type: string, text?: string }[]): SnapshotEvent =>
  makeEvent('user/message', { source: { kind: 'user' }, content: blocks })

/** 一条本插件追加的快照消息事件。One snapshot-message event appended by this plugin. */
const snapshotEvent = (source: string, texts: readonly { name: string, text: string }[]): SnapshotEvent =>
  makeEvent('user/message', { source: { kind: source, sections: texts }, content: texts.map(({ text }) => ({ type: 'text', text })) })

/** 一条预设选择事件。One preset-selection event. */
const presetEvent = (agentPreset: string): SnapshotEvent =>
  makeEvent('agent-preset/selected', { agentPreset })

/** 由事件数组构成的只读日志视图。A read-only log view over an event array. */
function logView(events: readonly SnapshotEvent[]): SessionLogView {
  return {
    snapshotEvents: () => events,
    eventAt: (seq) => events[Number(seq)],
  }
}

describe('renderAgentPreset', () => {
  it('自定义预设原样用声明的元数据，不翻译', () => {
    expect(renderAgentPreset({ id: 'person-agent', name: 'Person Agent', description: '面向人类' }))
      .toBe('- Person Agent(person-agent):面向人类')
  })

  it('内置预设 id 走官方英文文案折叠', () => {
    // 与官方 presetDisplayText 折叠一致：内置 id 的文案来自字典。
    // Matching the official presetDisplayText fold: shipped ids resolve through
    // the dictionary.
    expect(renderAgentPreset({ id: 'minimal' } as never))
      .toBe('- Minimal mode(minimal):The agent uses a terminal and image reading, with context compaction. Useful for testing and comparing its basic performance.')
    expect(renderAgentPreset({ id: 'standard' } as never)).toContain('- Standard mode(standard):')
  })

  it('未知 id 回退到 id 本身，缺描述留空，不渲染 undefined', () => {
    expect(renderAgentPreset({ id: 'bare' } as never)).toBe('- bare(bare):')
  })
})

describe('renderWorkspace', () => {
  it('渲染标题、id 与路径', () => {
    expect(renderWorkspace({ id: 'w1', title: '默认工作区', path: 'C:\\work' } as never))
      .toBe('- 默认工作区(w1):C:\\work')
  })
})

describe('withHeading', () => {
  it('非空加标题，空保持为空', () => {
    expect(withHeading('## Workspace List', ['a'])).toEqual(['## Workspace List', 'a'])
    expect(withHeading('## Workspace List', [])).toEqual([])
  })
})

describe('renderModelCatalogModel', () => {
  it('知名模型 id 的选型政策优先于宿主描述', () => {
    // 政策是部署级成本规则，必须压过宿主的厂商文案：pro 即使带 description
    // 也渲染 EXCEPTION ONLY 政策。
    // The policy is a deployment-level cost rule and outranks vendor copy: pro
    // renders the EXCEPTION ONLY policy even with a host description.
    const line = renderModelCatalogModel({
      id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro',
      description: 'Stronger agentic coding, knowledge, and difficult reasoning.',
    } as never, 1_000_000)
    expect(line).toContain('use when: EXCEPTION ONLY - never the default')
    expect(line).toContain('5x flash')
    expect(line).not.toContain('Stronger agentic coding')
  })

  it('宿主缺描述时按 id 给出使用建议兜底', () => {
    // deepseek-flash 官方目录未写描述：兜底文案落实部署的选型政策——价格优先，
    // flash 是默认干活模型，pro 只是例外。
    // deepseek-flash carries no description in the official catalog: the
    // fallback encodes the deployment's price-first policy - flash is the
    // default workhorse, pro the exception.
    const line = renderModelCatalogModel({ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' } as never, 1_000_000)
    expect(line).toContain('use when: PREFERRED DEFAULT: pick this for essentially all work')
    expect(line).toContain('about 1/5 of pro')
    const pro = renderModelCatalogModel({ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' } as never, 1_000_000)
    expect(pro).toContain('EXCEPTION ONLY')
    expect(pro).toContain('5x flash')
  })

  it('既无描述也无兜底建议时不渲染 use when', () => {
    const line = renderModelCatalogModel({ id: 'custom-model', name: 'Custom' } as never, 65536)
    expect(line).not.toContain('use when')
    expect(line).toContain('context 65536 tokens')
  })
})

describe('deriveFallbackTitle', () => {
  it('取首条人类消息最多 8 个前导词', () => {
    expect(deriveFallbackTitle(logView([humanEvent({ type: 'text', text: '一 二 三 四 五 六 七 八 九 十' })])))
      .toBe('一 二 三 四 五 六 七 八')
  })

  it('超过 40 字符时截断并加省略号', () => {
    expect(deriveFallbackTitle(logView([humanEvent({ type: 'text', text: 'x'.repeat(50) })])))
      .toBe(`${'x'.repeat(40)}…`)
  })

  it('跳过快照消息、非文本块，取真正的人类提问', () => {
    const source = logView([
      snapshotEvent('person-agent-context', [{ name: 'Agent Preset List', text: '快照内容' }]),
      humanEvent({ type: 'image' }),
      humanEvent({ type: 'text', text: '真正的问题' }),
    ])
    expect(deriveFallbackTitle(source)).toBe('真正的问题')
  })

  it('没有合格消息时返回 undefined', () => {
    expect(deriveFallbackTitle(logView([]))).toBeUndefined()
    expect(deriveFallbackTitle(logView([presetEvent('standard')]))).toBeUndefined()
  })
})

describe('selectedPreset', () => {
  it('取日志里最新一条选择（latest-wins）', () => {
    expect(selectedPreset(logView([presetEvent('standard'), presetEvent('person-agent'), presetEvent('minimal')])))
      .toBe('minimal')
  })

  it('没有选择事件时返回 undefined', () => {
    expect(selectedPreset(logView([humanEvent({ type: 'text', text: '你好' })]))).toBeUndefined()
  })
})

describe('lastSnapshotText', () => {
  const SOURCE = 'person-agent-context'

  it('从末尾向前找到本插件最近一条快照', () => {
    const events = [snapshotEvent(SOURCE, [{ name: 'Agent Preset List', text: '旧快照' }]), presetEvent('standard'), snapshotEvent(SOURCE, [{ name: 'Agent Preset List', text: '新快照' }])]
    expect(lastSnapshotText(logView(events), SessionSeq(events.length), SOURCE)).toBe('新快照')
  })

  it('忽略其他来源的消息', () => {
    const events = [humanEvent({ type: 'text', text: '人类输入' }), snapshotEvent('other-plugin', [{ name: 'x', text: '别家快照' }])]
    expect(lastSnapshotText(logView(events), SessionSeq(events.length), SOURCE)).toBeUndefined()
  })

  it('空日志返回 undefined', () => {
    expect(lastSnapshotText(logView([]), SessionSeq(0), SOURCE)).toBeUndefined()
  })
})

describe('lastSnapshotSectionText', () => {
  const SOURCE = 'person-agent-context'

  it('取某区块最近一次记录的文本（latest-wins）', () => {
    const events = [
      snapshotEvent(SOURCE, [{ name: 'Workspace List', text: '旧工作区' }]),
      humanEvent({ type: 'text', text: '人类输入' }),
      snapshotEvent(SOURCE, [{ name: 'Workspace List', text: '新工作区' }, { name: 'Agent Preset List', text: '名单' }]),
    ]
    expect(lastSnapshotSectionText(logView(events), SessionSeq(events.length), SOURCE, 'Workspace List')).toBe('新工作区')
    expect(lastSnapshotSectionText(logView(events), SessionSeq(events.length), SOURCE, 'Agent Preset List')).toBe('名单')
  })

  it('区块从未记录过时返回 undefined', () => {
    const events = [snapshotEvent(SOURCE, [{ name: 'Agent Preset List', text: '名单' }])]
    expect(lastSnapshotSectionText(logView(events), SessionSeq(events.length), SOURCE, 'Workspace List')).toBeUndefined()
    expect(lastSnapshotSectionText(logView([]), SessionSeq(0), SOURCE, 'Workspace List')).toBeUndefined()
  })
})
