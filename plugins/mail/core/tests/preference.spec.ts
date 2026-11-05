/**
 * The preference merge, against the design's five-layer rules.
 *
 * 偏好合并，对照设计的五层规则。
 */

import { describe, expect, it } from 'vitest'
import { mergePreferences, type PreferenceLayerInput, type PreferenceScope } from '../src/preference.ts'

/** The scope every test merges under. / 每个测试合并所处的作用域。 */
const scope: PreferenceScope = {
  workflowId: 'wf-1',
  subject: { subscriberId: 'user-1', topicKeys: ['buyers'] },
  contextKeys: [],
  critical: false,
}

/** One layer, with the fields a test does not care about defaulted. / 一个层，不关心的字段取缺省。 */
function layer(overrides: Partial<PreferenceLayerInput> & Pick<PreferenceLayerInput, 'layer'>): PreferenceLayerInput {
  return {
    contextKeys: [],
    enabled: true,
    readOnly: false,
    channels: {},
    ...overrides,
  }
}

describe('mail preference merge', () => {
  it('keeps a channel open when no layer mentions it', () => {
    const decision = mergePreferences(scope, [layer({ layer: 'workflow_resource' })])
    expect(decision.send).toBe(true)
    expect(decision.channels).toContain('in_app')
    expect(decision.channels).toContain('email')
  })

  it('lets a later layer override an earlier one', () => {
    const decision = mergePreferences(scope, [
      layer({ layer: 'workflow_resource', channels: { email: false } }),
      layer({ layer: 'subject_global', channels: { email: true } }),
    ])
    expect(decision.channels).toContain('email')
  })

  it('truncates the merge at a read-only layer instead of ignoring it', () => {
    const decision = mergePreferences(scope, [
      layer({ layer: 'workflow_resource', readOnly: true, channels: { email: false } }),
      layer({ layer: 'subject_global', channels: { email: true } }),
    ])
    expect(decision.channels).not.toContain('email')
    expect(decision.decidedBy).toBe('workflow_resource')
  })

  it('keeps the read-only layer itself when a later one sets readOnly', () => {
    const decision = mergePreferences(scope, [
      layer({ layer: 'workflow_resource', channels: { email: false } }),
      layer({ layer: 'subject_global', readOnly: true, channels: { email: true } }),
      layer({ layer: 'subject_workflow', channels: { email: false } }),
    ])
    expect(decision.channels).toContain('email')
    expect(decision.decidedBy).toBe('subject_global')
  })

  it('refuses every channel when a layer disables the recipient', () => {
    const decision = mergePreferences(scope, [layer({ layer: 'subject_global', enabled: false })])
    expect(decision.send).toBe(false)
    expect(decision.channels).toEqual([])
  })

  it('skips the recipient layers for a critical workflow', () => {
    const critical: PreferenceScope = { ...scope, critical: true }
    const decision = mergePreferences(critical, [
      layer({ layer: 'workflow_resource', channels: { email: true } }),
      layer({ layer: 'subject_global', enabled: false }),
      layer({ layer: 'subject_workflow', enabled: false }),
      layer({ layer: 'subscription', enabled: false }),
    ])
    expect(decision.send).toBe(true)
    expect(decision.decidedBy).toBe('workflow_resource')
  })

  it('still binds a critical workflow to a read-only ceiling', () => {
    const critical: PreferenceScope = { ...scope, critical: true }
    const decision = mergePreferences(critical, [
      layer({ layer: 'workflow_resource', readOnly: true, enabled: false }),
      layer({ layer: 'subject_global', enabled: true }),
    ])
    expect(decision.send).toBe(false)
  })

  it('ignores a layer recorded against another workflow', () => {
    const decision = mergePreferences(scope, [
      layer({ layer: 'subject_global', workflowId: 'wf-other', enabled: false }),
    ])
    expect(decision.send).toBe(true)
  })

  it('ignores a subscription layer when the delivery came through no group', () => {
    const noGroup: PreferenceScope = { ...scope, topicKey: undefined }
    const decision = mergePreferences(noGroup, [
      layer({ layer: 'subscription', topicKey: 'buyers', enabled: false }),
    ])
    expect(decision.send).toBe(true)
  })

  it('reports the quiet window of the surviving layers', () => {
    const decision = mergePreferences(scope, [
      layer({
        layer: 'subject_global',
        schedule: { startHour: 22, endHour: 7, enabled: true },
      }),
    ])
    expect(decision.window).toEqual({ startHour: 22, endHour: 7, enabled: true })
  })
})
