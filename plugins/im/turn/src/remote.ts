/**
 * The turn remote: the domain's web face, as an `imTurn` Remote namespace.
 * Deliberately thin transport — the panel polls live activity here while an
 * agent works, and nothing else: run records stay a host-side observability
 * face until a view asks for them.
 *
 * 回合远端：域的 Web 面（`imTurn` 远端命名空间）。刻意只做薄传输——智能体工作期间面板在这里
 * 轮询实时活动，别的不做：运行记录在有视图索取之前仍只是宿主侧观测面。
 *
 * @module @veren/im-turn/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrThrow } from '@veren/core'
import { TurnToken } from './service.ts'
import type { TurnService } from './service.ts'

/**
 * The web surface over the turn service. Injects the turn token: the same
 * plugin's apply provided it a tick earlier, and cordis resolves the token
 * whenever it is ready.
 * 回合服务之上的 Web 面。注入回合令牌：同一插件的 apply 稍早提供了它，cordis 在就绪时解析
 * 令牌。
 */
export class TurnRemoteService extends TypertRemoteService {
  static inject = ['imTurn']

  private readonly turn: TurnService

  constructor(ctx: Context) {
    super(ctx, 'imTurnGateway', { namespace: 'imTurn' })
    this.turn = getOrThrow(ctx, TurnToken)
  }

  /**
   * The live activity of running turns. An empty list means nothing is running;
   * the panel renders no working row in that case.
   * 运行中回合的实时活动。空列表表示没有在跑的东西；此时面板不渲染工作行。
   * @param request - optional room filter.
   * @returns the live turns, oldest first.
   */
  @Remote('activity')
  async activity(request: { readonly roomId?: string }) {
    return { runs: this.turn.activity(request?.roomId) }
  }
}
