// 拆分后每个职责都成了可单独验证的小函数：本文件覆盖三个纯逻辑模块
// （文本/时间、渲染、会话日志读取）。
// After the split every responsibility is a small testable function: this file
// covers the three pure-logic modules (text/time, rendering, session log reads).
//
// 类型策略：日志替身直接用插件公开的 SessionLogView（它是宿主 Session 的只读投影，
// 由 type-pins 断言「Session 可直接传入」）。因此测试里唯一需要的转换就是
// SessionSeq（宿主品牌号），不再有任何「自造结构 vs 宿主类型」的错配。
// Typing strategy: the log doubles implement the plugin's own SessionLogView (a
// read-only projection of the host Session, pinned to accept a real Session). The
// only conversion needed is SessionSeq, the host's branded sequence number.
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderAgentPreset, renderSessionLine, renderWorkspace, renderWorkspaceList, withHeading } from '../src/render.ts'
import { deriveFallbackTitle, lastSnapshotText, selectedPreset } from '../src/session-events.ts'
import type { SessionLogView, SnapshotEvent } from '../src/session-events.ts'
import { formatCreated, idFragment } from '../src/text-time.ts'

const NOW = 1_700_000_000_000

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
const snapshotEvent = (source: string, ...texts: string[]): SnapshotEvent =>
  makeEvent('user/message', { source: { kind: source }, content: texts.map((text) => ({ type: 'text', text })) })

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

describe('formatCreated', () => {
  it('reports 缺少创建时间', () => {
    expect(formatCreated(undefined)).toBe('unknown-time')
  })

  it('渲染为固定的绝对日期（不随当前时刻漂移）', () => {
    // createdAt 固定 → 输出只由 createdAt 决定，与"现在"无关。
    // createdAt is fixed → the output depends on createdAt alone, never on "now".
    expect(formatCreated(NOW)).toBe('2023-11-14')
    expect(formatCreated(NOW - 5 * 60_000)).toBe('2023-11-14')
  })
})

describe('idFragment', () => {
  it('去掉 session- 前缀并截断到 12 字符', () => {
    expect(idFragment('session-abcdefghijklmnop')).toBe('abcdefghijkl')
    expect(idFragment('plainid')).toBe('plainid')
  })
})

describe('renderAgentPreset', () => {
  it('缺名回退 id、缺描述留空，不渲染 undefined', () => {
    expect(renderAgentPreset({ id: 'person-agent', name: 'Person Agent', description: '面向人类' }))
      .toBe('- Person Agent(person-agent):面向人类')
    expect(renderAgentPreset({ id: 'minimal' })).toBe('- minimal(minimal):')
  })
})

describe('renderWorkspace', () => {
  it('渲染标题、id 与路径', () => {
    expect(renderWorkspace({ id: 'w1', title: '默认工作区', path: 'C:\\work' } as never))
      .toBe('- 默认工作区(w1):C:\\work')
  })
})

describe('renderSessionLine', () => {
  it('四个字段齐全时按表格行渲染', () => {
    const line = renderSessionLine('session-abcdefghijklmnop', {
      title: '问候语',
      preset: 'person-agent',
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      createdAt: NOW - 5 * 60_000,
      running: false,
    })
    expect(line).toBe('  | session-abcdefghijklmnop | 问候语 | person-agent | deepseek-account | deepseek-flash | 2023-11-14 |')
  })

  it('缺数据时四项占位 unknown，标题回退 id 片段', () => {
    const line = renderSessionLine('session-abcdefghijklmnop', undefined)
    expect(line).toBe('  | session-abcdefghijklmnop | abcdefghijkl | unknown | unknown | unknown | unknown-time |')
  })

  it('运行中追加标记', () => {
    const line = renderSessionLine('session-x', { title: 'T', running: true })
    expect(line).toBe('  | session-x | T | unknown | unknown | unknown | unknown-time · running |')
  })
})

describe('renderWorkspaceList', () => {
  const workspace = {
    id: 'w1',
    title: '默认工作区',
    path: 'C:\\work',
    sessionIds: ['session-a', 'session-b', 'session-c'],
  }

  it('过滤已归档会话并按未归档顺序编号', () => {
    const lines = renderWorkspaceList(
      [workspace as never],
      ['session-b'],
      (id) => ({ title: `标题-${id}` }),
    )
    expect(lines).toEqual([
      '- 默认工作区(w1):C:\\work',
      '  | id | title | preset | provider | model | created at |',
      '  | --- | --- | --- | --- | --- | --- |',
      '  | session-a | 标题-session-a | unknown | unknown | unknown | unknown-time |',
      '  | session-c | 标题-session-c | unknown | unknown | unknown | unknown-time |',
    ])
  })

  it('全部归档时只留一句 sessions: none', () => {
    expect(renderWorkspaceList([workspace as never], ['session-a', 'session-b', 'session-c'], () => undefined))
      .toEqual(['- 默认工作区(w1):C:\\work', '  sessions: none'])
  })

  it('关掉工作区列表（空注册表）时没有任何行', () => {
    expect(renderWorkspaceList([], [], () => undefined)).toEqual([])
  })
})

describe('withHeading', () => {
  it('非空加标题，空保持为空', () => {
    expect(withHeading('## Workspace List', ['a'])).toEqual(['## Workspace List', 'a'])
    expect(withHeading('## Workspace List', [])).toEqual([])
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
      snapshotEvent('person-agent-context', '快照内容'),
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
    const events = [snapshotEvent(SOURCE, '旧快照'), presetEvent('standard'), snapshotEvent(SOURCE, '新快照')]
    expect(lastSnapshotText(logView(events), SessionSeq(events.length), SOURCE)).toBe('新快照')
  })

  it('忽略其他来源的消息', () => {
    const events = [humanEvent({ type: 'text', text: '人类输入' }), snapshotEvent('other-plugin', '别家快照')]
    expect(lastSnapshotText(logView(events), SessionSeq(events.length), SOURCE)).toBeUndefined()
  })

  it('空日志返回 undefined', () => {
    expect(lastSnapshotText(logView([]), SessionSeq(0), SOURCE)).toBeUndefined()
  })
})
