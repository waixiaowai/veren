/**
 * 页面会话上下文审计器的红灯自证：多帧 zstd 必须逐帧解出，判定口径必须可复算。
 * Red-light self proof for the page-context auditor: multi-frame zstd must decode frame
 * by frame, and every reported metric must be recomputable from the observed events.
 *
 * 测试只喂内存里的合成日志，绝不读真实 home；实测数字由 CLI 在真机上跑出来。
 * These tests feed synthetic in-memory logs only and never read a real home; the live
 * numbers come from running the CLI.
 * @module @veren/scripts/tests/audit-page-context
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { blockLines, locatorOf, noteOf } from '../audit/page-block.mjs'
import { generationOf, observePageSession, summarize } from '../audit/observe.mjs'
import { readEvents, scanFrameRanges } from '../audit/zstd-frames.mjs'

/** 测试期创建的临时目录，测试结束统一删除 / temporary dirs, removed after the suite */
const roots = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * 把事件编码成"每批一个独立 zstd 帧"的日志文件——正是真实追加写入的形态。
 * Encode events as a log where every batch is its own zstd frame — exactly the
 * append-only form the real logs have.
 * @param events - 事件对象序列 / the events
 * @returns 生成的日志路径 / the written log path
 */
function writeMultiFrameLog(events) {
  const root = mkdtempSync(join(tmpdir(), 'veren-audit-'))
  roots.push(root)
  const file = join(root, 'session.v4.jsonl.zstd')
  const half = Math.ceil(events.length / 2)
  const frame = (batch) => zstdCompressSync(`${batch.map((event) => JSON.stringify(event)).join('\n')}\n`)
  writeFileSync(file, Buffer.concat([frame(events.slice(0, half)), frame(events.slice(half))]))
  return file
}

/** 一条用户消息事件 / one user-message event */
function userMessage(seq, kind, text) {
  return { type: 'user/message', seq, data: { message: { role: 'user', source: { kind }, content: [{ type: 'text', text }] } } }
}

/** 一条助手消息事件 / one assistant-message event */
function assistantMessage(seq, calls) {
  return {
    type: 'assistant/message',
    seq,
    data: { message: { role: 'assistant', content: calls.map((name) => ({ type: 'tool-call', name })) } },
  }
}

/** 一条请求头事件 / one request-header event */
function requestHeader(seq, toolNames) {
  const tools = toolNames.map((name) => ({ name, description: 'x', parameters: {} }))
  return { type: 'request/header', seq, data: { header: { tools } } }
}

/** 一个最小的 PAGE 块 / a minimal PAGE block */
function pageBlock(note = '说明：随便一句') {
  return `PAGE demo/list /apps/demo/list\nmap:（能力地图——本应用可去的页面）\n- /apps/demo/note/:id → 笔记\ntools: demo__take_task（接取）\n应用说明：这是一个演示应用。\n${note}`
}

/**
 * 观测对象的最小替身。
 * A minimal observation stand-in.
 * @param overrides - 覆盖字段 / fields to override
 * @returns 观测对象 / the observation
 */
function base(overrides) {
  return {
    firstUserSource: 'app/page',
    pageBlocks: 1,
    firstTurnCalls: [],
    parts: [{ kind: 'app/page', chars: 100 }],
    pageKey: 'demo/list',
    blockChars: 100,
    blockLines: { map: true, tools: true, appNote: true, pageNote: true },
    note: '说明：随便一句',
    blockRepeatedVerbatim: false,
    toolCount: 10,
    toolSchemaChars: 1000,
    pageToolChars: 100,
    pageIdentity: false,
    ...overrides,
  }
}

describe('多帧 zstd 解码', () => {
  it('两个独立帧都能解出（单次 zstdDecompressSync 只看第一帧）', () => {
    const file = writeMultiFrameLog([
      { type: 'session', id: 's-1' },
      userMessage(1, 'app/page', pageBlock()),
      assistantMessage(2, ['demo__take_task']),
      requestHeader(3, ['demo__take_task', 'task_list']),
    ])
    expect(readEvents(file).map((event) => event.type))
      .toEqual(['session', 'user/message', 'assistant/message', 'request/header'])
  })

  it('帧区间按结构切分，覆盖每个完整帧', () => {
    const buffer = Buffer.concat([zstdCompressSync('{"a":1}\n'), zstdCompressSync('{"b":2}\n')])
    const ranges = scanFrameRanges(buffer)
    expect(ranges).toHaveLength(2)
    expect(ranges[1].end).toBe(buffer.length)
    expect(ranges.every((range) => range.end > range.start)).toBe(true)
  })

  it('末尾残缺帧被丢弃，前面的完整帧照常解出', () => {
    const complete = zstdCompressSync('{"a":1}\n')
    const torn = zstdCompressSync('{"b":2}\n').subarray(0, 6)
    const ranges = scanFrameRanges(Buffer.concat([complete, torn]))
    expect(ranges).toHaveLength(1)
  })
})

describe('页面会话判定', () => {
  it('首条消息即 PAGE 块的无指令会话被计入，首回合写工具被抓出', () => {
    const observed = observePageSession([
      userMessage(1, 'app/page', pageBlock()),
      assistantMessage(2, ['demo__take_task']),
    ], 'demo')
    expect(observed.firstUserSource).toBe('app/page')
    expect(observed.firstTurnCalls).toEqual(['demo__take_task'])
    expect(observed.pageKey).toBe('demo/list')
  })

  it('非页面会话返回 undefined（人类会话不混进统计）', () => {
    expect(observePageSession([userMessage(1, 'user', '帮我看下任务'), assistantMessage(2, [])], 'demo')).toBeUndefined()
  })

  it('先有人类指令、后来才出现 PAGE 块的会话不算「无指令」', () => {
    const observed = observePageSession([
      userMessage(1, 'user', '打开页面'),
      userMessage(2, 'app/page', pageBlock()),
    ], 'demo')
    expect(observed.firstUserSource).toBe('user')
    expect(summarize([observed]).pageBlockFirst).toBe(0)
  })

  it('工具 schema 只把本应用前缀算作本页成本', () => {
    const observed = observePageSession([
      userMessage(1, 'app/page', pageBlock()),
      requestHeader(2, ['demo__take_task', 'task_list', 'forum_post']),
    ], 'demo')
    expect(observed.toolCount).toBe(3)
    expect(observed.pageToolChars).toBeLessThan(observed.toolSchemaChars)
    expect(observed.toolSchemaChars).toBeGreaterThan(0)
  })

  it('同会话重发的块与首块逐字相同则记为 verbatim', () => {
    const repeated = observePageSession([
      userMessage(1, 'app/page', pageBlock()),
      userMessage(2, 'app/page', pageBlock()),
    ], 'demo')
    expect(repeated.pageBlocks).toBe(2)
    expect(repeated.blockRepeatedVerbatim).toBe(true)
  })
})

describe('汇总口径可复算', () => {
  it('首回合写工具计数只认写工具，只读工具不算', () => {
    const report = summarize([
      base({ firstTurnCalls: ['demo__list_tasks'] }),
      base({ firstTurnCalls: ['demo__take_task'] }),
      base({ firstTurnCalls: [] }),
    ])
    expect(report.pageSessions).toBe(3)
    expect(report.firedCallFirstTurn).toBe(2)
    expect(report.firedWriteFirstTurn).toBe(1)
    expect(report.noCallFirstTurn).toBe(1)
  })

  it('重复块与块长统计按观测原值汇总', () => {
    const report = summarize([
      base({ pageBlocks: 3, blockChars: 100, blockRepeatedVerbatim: true }),
      base({ pageBlocks: 1, blockChars: 300 }),
    ])
    expect(report.repeatedBlockSessions).toBe(1)
    expect(report.repeatedVerbatimSessions).toBe(1)
    expect(report.maxBlockRepeat).toBe(3)
    expect(report.blockChars.median).toBe(200)
    expect(report.blockChars.max).toBe(300)
  })

  it('措辞代际按新到旧判定，旧代际的通用句不抢新代际的会话', () => {
    expect(generationOf('说明：……接取用 take_task……')).toBe('G1-imperative')
    expect(generationOf('说明：……SNAPSHOT/PATCH……接取用 take_task……')).toBe('G2-live-sync')
    expect(generationOf('说明：有人把任务投给本页时……')).toBe('G3-detail-anyone')
    expect(generationOf('说明：……查看类请求不接取……')).toBe('G4-conditional')
    expect(generationOf('')).toBe('G0-no-note')
  })

  it('代际统计把自主写状态落在对应那一代', () => {
    const report = summarize([
      base({ firstTurnCalls: ['demo__take_task'], note: '说明：有人把任务投给本页时' }),
      base({ firstTurnCalls: [], note: '说明：……查看类请求不接取……' }),
    ])
    const detail = report.generations.find((row) => row.generation === 'G3-detail-anyone')
    const conditional = report.generations.find((row) => row.generation === 'G4-conditional')
    expect(detail).toMatchObject({ sessions: 1, fired: 1, wrote: 1 })
    expect(conditional).toMatchObject({ sessions: 1, fired: 0, wrote: 0 })
  })
})

describe('PAGE 块解析', () => {
  it('骨架行在场与缺失都如实判定', () => {
    expect(blockLines(pageBlock())).toEqual({ map: true, tools: true, appNote: true, pageNote: true })
    expect(blockLines('PAGE demo/list /apps/demo/list')).toEqual({ map: false, tools: false, appNote: false, pageNote: false })
  })

  it('说明与定位行按首行与 `说明：` 前缀取值', () => {
    expect(noteOf(pageBlock('说明：只处理这一条'))).toBe('只处理这一条')
    expect(noteOf('PAGE demo/list /apps/demo/list')).toBe('')
    expect(locatorOf(pageBlock())).toEqual({ pageKey: 'demo/list', url: '/apps/demo/list' })
    expect(locatorOf('随便一段')).toEqual({ pageKey: '', url: '' })
  })
})
