import { describe, expect, it } from 'vitest'
import { recordOf, setup } from './tool-helpers.ts'

describe('im_intake tool', () => {
  it('reports the switch and the exact question without changing anything', async () => {
    const { tools } = await setup()
    const status = recordOf(await tools.call('im_intake', {}))
    expect(status.ok).toBe(true)
    expect(status.enabled).toBe(false)
    expect(status.askText).toContain('怎么称呼')
    expect(status.counts).toEqual({ asked: 0, answered: 0, declined: 0, expired: 0 })
  })
})
