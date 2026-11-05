/**
 * The turn remote's wiring: the panel reaches live activity through the
 * `imTurn` namespace, so the endpoint name, the gateway service key, and the
 * binding must match what the browser-side definition declares — otherwise the
 * working row silently never appears while every host-side test still passes.
 *
 * 回合远端的接线：面板经 `imTurn` 命名空间读取实时活动，因此端点名、网关服务键与绑定必须与
 * 浏览器侧定义一致——否则工作行会静默地永不出现，而宿主侧测试全绿。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { ActivityBoard } from '../src/activity.ts'
import { TurnRemoteService } from '../src/remote.ts'
import { RunStore } from '../src/runs.ts'
import { TurnService, TurnToken } from '../src/service.ts'

/** One context with the turn service and the remote mounted on it. */
function mounted(): { readonly ctx: Context; readonly board: ActivityBoard; readonly remote: TurnRemoteService } {
  const ctx = new Context()
  const board = new ActivityBoard(() => 1_000)
  const service = new TurnService(new RunStore(() => 1_000), () => [], board)
  ctx.provide(TurnToken, service)
  const remote = new TurnRemoteService(ctx)
  return { ctx, board, remote }
}

describe('turn remote', () => {
  it('binds the imTurn namespace to the imTurnGateway service', () => {
    const { remote } = mounted()
    expect(remote.typertRemote.namespace).toBe('imTurn')
    expect(remote.typertRemote.serviceKey).toBe('imTurnGateway')
  })

  it('exports exactly the activity endpoint as a direct invocation', () => {
    const { remote } = mounted()
    expect(remoteMethods(remote).map(marker => marker.exportName ?? marker.method)).toEqual(['activity'])
    expect(remoteMethods(remote)[0]?.invocation).toEqual({ kind: 'direct' })
  })

  it('returns the live runs of the requested room', async () => {
    const { board, remote } = mounted()
    board.begin({ runId: 'run-1', roomId: 'room-1', agentParticipantId: 'agent:default' })
    board.begin({ runId: 'run-2', roomId: 'room-2', agentParticipantId: 'agent:default' })
    expect((await remote.activity({ roomId: 'room-1' })).runs.map(run => run.runId)).toEqual(['run-1'])
    expect((await remote.activity({})).runs).toHaveLength(2)
  })
})
