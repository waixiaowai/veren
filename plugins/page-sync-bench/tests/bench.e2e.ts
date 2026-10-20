/**
 * 真实 API 基准（e2e）：双臂对照 full vs delta，输出关键统计。
 * Real-API benchmark (e2e): full vs delta arms, emitting key statistics.
 * 无凭据自跳过 / skips itself without credentials.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadApiKey, runBench } from '../src/driver.ts'
import type { BenchReport } from '../src/types.ts'

const apiKey = loadApiKey()
const ROUNDS = 6

/** 汇总一场报告为可读行 / summarize one report */
function summarize(report: BenchReport): string[] {
  const lines: string[] = []
  for (const stat of report.roundStats) {
    const prompt = stat.calls.reduce((acc, usage) => acc + usage.promptTokens, 0)
    const hit = stat.calls.reduce((acc, usage) => acc + usage.cacheHitTokens, 0)
    const rate = prompt === 0 ? 0 : (hit / prompt) * 100
    lines.push(
      `round ${stat.round}: prompt=${prompt} hit=${hit} (${rate.toFixed(1)}%) `
      + `injected=${stat.injectedBytes}B tools=${stat.toolCallsOk}/${stat.toolCallsTotal} `
      + `directive=${stat.directiveOk ? 'OK' : 'FAIL'}`,
    )
  }
  return lines
}

describe.skipIf(apiKey === undefined)('page-session bench (real API)', () => {
  it('full vs delta arms produce stats', { timeout: 300_000 }, async () => {
    const key = apiKey as string
    const full = await runBench(key, 'full', ROUNDS)
    const delta = await runBench(key, 'delta', ROUNDS)

    // eslint-disable-next-line no-console
    console.log(`\n=== 臂 A：全量模式（每轮 append 全量快照）===\n${summarize(full).join('\n')}`)
    // eslint-disable-next-line no-console
    console.log(`\n=== 臂 B：增量模式（首轮快照 + 补丁）===\n${summarize(delta).join('\n')}`)
    // eslint-disable-next-line no-console
    console.log(`\n=== 汇总 ===`)
    for (const report of [full, delta]) {
      const hitRate = report.totals.promptTokens === 0
        ? 0
        : (report.totals.cacheHitTokens / report.totals.promptTokens) * 100
      const toolRate = report.totals.toolCallsTotal === 0
        ? 0
        : (report.totals.toolCallsOk / report.totals.toolCallsTotal) * 100
      // eslint-disable-next-line no-console
      console.log(
        `[${report.mode}] prompt=${report.totals.promptTokens} completion=${report.totals.completionTokens} `
        + `cacheHitRate=${hitRate.toFixed(1)}% toolSuccessRate=${toolRate.toFixed(1)}% `
        + `(${report.totals.toolCallsOk}/${report.totals.toolCallsTotal}) `
        + `directives=${report.totals.directivesOk}/${report.rounds} llmCalls=${report.totals.llmCalls}`,
      )
    }

    // 报告落盘 / persist reports
    mkdirSync('bench', { recursive: true })
    writeFileSync(join('bench', 'report-full.json'), JSON.stringify(full, null, 2))
    writeFileSync(join('bench', 'report-delta.json'), JSON.stringify(delta, null, 2))

    // 基本断言：工具与指令大量成功 / sanity assertions
    expect(full.totals.toolCallsOk).toBeGreaterThan(0)
    expect(delta.totals.toolCallsOk).toBeGreaterThan(0)
    expect(delta.totals.promptTokens).toBeLessThan(full.totals.promptTokens)
  })
})
