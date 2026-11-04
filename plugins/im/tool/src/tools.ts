/**
 * Model-facing `im_*` tools over the redesigned family faces: the assembly
 * and reverse-order unregistration.
 *
 * Account authorization (`im_bind`) is its own tool on purpose: an
 * authorization attempt never guesses a session. `im_send` and the room tools
 * attribute their caller through the turn service's session map — the room is
 * never a model argument. Since 3.0 the tools write through the conversation
 * domain behind coordination's gates; there is no router anymore.
 *
 * 面向模型的 `im_*` 工具，作用于重设计后的各家族面：装配与逆序注销。
 *
 * 账号授权（`im_bind`）独立成工具：授权尝试绝不猜会话。`im_send` 与房间工具经回合服务的
 * 会话映射归属调用方——房间绝不是模型参数。自 3.0 起，工具在协调闸门之后写穿会话域；
 * router 已不存在。
 *
 * @module @veren/im-tool/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImDirectory, ImMemory, ImPeople, ImRegistry, ImStrangerIntake } from '@veren/im'
import { ImBindings } from '@veren/im'
import type { ImCredentialStore, ImLogger } from '@veren/im'
import type { ConversationService } from '@veren/im-conversation'
import type { CoordinationService } from '@veren/im-coordination'
import type { TurnService } from '@veren/im-turn'
import type { ImParticipants } from '@veren/im'
import { imBindTool } from './bind-tool.ts'
import { imReadTool, imRoomsTool } from './room-tools.ts'
import { imRecallTool, imRememberTool } from './memory-tools.ts'
import { peopleTools } from './people-tools.ts'
import { imPersonReportTool } from './report-tool.ts'
import { imSendTool } from './send-tool.ts'
import { imUnbindTool } from './session-tools.ts'

/** Every collaborator the tool family needs, resolved by injection. */
/** 工具族需要的全部协作者，走注入解析。 */
export interface ToolDeps {
  readonly conversation: ConversationService
  readonly coordination: CoordinationService
  readonly turn: TurnService
  readonly directory: ImDirectory
  readonly intake: ImStrangerIntake
  readonly memory: ImMemory
  readonly participants: ImParticipants
  readonly bindings: ImBindings
  readonly registry: ImRegistry
  readonly credentials: ImCredentialStore
  readonly people: ImPeople
  readonly logger: ImLogger
}

/**
 * Register every IM tool in the mounting scope, in registration order; the
 * disposer unregisters in reverse.
 * 在挂载作用域注册全部 IM 工具，按注册顺序；解除器按逆序注销。
 */
export function registerImTools(ctx: Context, deps: ToolDeps): void {
  ctx.effect(() => {
    const tools = [
      imBindTool({ bindings: deps.bindings, registry: deps.registry }),
      imUnbindTool({
        bindings: deps.bindings,
        registry: deps.registry,
        credentials: deps.credentials,
        people: deps.people,
        logger: deps.logger,
      }),
      imSendTool(deps.conversation, deps.coordination, deps.turn),
      imRoomsTool(deps.conversation, deps.participants, deps.turn),
      imReadTool(deps.conversation, deps.turn),
      ...peopleTools(deps.directory, deps.intake),
      imPersonReportTool({ directory: deps.directory, intake: deps.intake }),
      imRememberTool(deps.memory, deps.turn),
      imRecallTool(deps.memory, deps.turn),
    ]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'im:tools()')
}
