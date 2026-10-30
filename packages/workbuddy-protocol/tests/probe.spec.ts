/**
 * 探测规格：baseline → sentinel → 档位的顺序语义、非验证短路、中途不决全轮
 * unknown、区域码表分离。
 * Probe specs: the baseline → sentinel → levels semantics, the non-validating
 * short circuit, mid-sweep indecision = whole run unknown, per-region code sets.
 */
import { describe, expect, it } from 'vitest'
import { probeModel, type ProbeObservation } from '../src/probe.ts'

/** 可编程发送器。A programmable sender. */
function sender(table: (effort: string | undefined) => ProbeObservation) {
  return async (effort: string | undefined): Promise<ProbeObservation> => table(effort)
}

const ACCEPTED: ProbeObservation = { status: 200, streamed: true }
const REFUSED: ProbeObservation = { status: 400, streamed: false, errorCode: 'invalid_reasoning_effort' }

describe('顺序语义 / order semantics', () => {
  it('baseline 不通 → 整轮 unknown（400 可能只是无关请求问题）', async () => {
    const outcome = await probeModel({
      send: sender(() => ({ status: 500, streamed: false })), region: 'cn',
    })
    expect(outcome).toMatchObject({ validation: 'unknown' })
  })

  it('sentinel 被收下 → non-validating（逐档结果全是假阳性，立即止损）', async () => {
    let requests = 0
    const outcome = await probeModel({
      send: sender(() => { requests += 1; return ACCEPTED }), region: 'cn',
    })
    expect(outcome).toMatchObject({ validation: 'non-validating' })
    expect(requests).toBe(2)
  })

  it('sentinel 被拒后逐档：收下的进清单，明确拒绝的跳过', async () => {
    const outcome = await probeModel({
      send: sender(effort => {
        if (effort === undefined) return ACCEPTED
        if (effort.startsWith('probe_sentinel')) return REFUSED
        return effort === 'low' || effort === 'medium' || effort === 'high' ? ACCEPTED : REFUSED
      }),
      region: 'cn',
    })
    expect(outcome).toEqual({ validation: 'validating', efforts: ['low', 'medium', 'high'], requests: 7 })
  })

  it('中途不决答案 → 整轮 unknown（部分清单不是发现）', async () => {
    const outcome = await probeModel({
      send: sender(effort => {
        if (effort === undefined) return ACCEPTED
        if (effort === 'low') return REFUSED
        return { status: 500, streamed: false }
      }),
      region: 'cn',
    })
    expect(outcome).toMatchObject({ validation: 'unknown', efforts: [] })
  })
})

describe('区域码表 / per-region code sets', () => {
  it('model_param_invalid 只为国际版扩宽归因（CN 只认实测过的码）', async () => {
    const generic: ProbeObservation = { status: 400, streamed: false, errorCode: 'model_param_invalid' }
    const global = await probeModel({ send: sender(effort => (effort === undefined ? ACCEPTED : generic)), region: 'global' })
    const cn = await probeModel({ send: sender(effort => (effort === undefined ? ACCEPTED : generic)), region: 'cn' })
    expect(global).toMatchObject({ validation: 'validating', efforts: [] })
    expect(cn).toMatchObject({ validation: 'unknown' })
  })
})
