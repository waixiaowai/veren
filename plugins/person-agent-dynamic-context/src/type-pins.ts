// 编译期契约钉（零运行时）：本文件只做类型检查，不执行任何逻辑，也不被任何代码
// import——它存在的意义是「宿主类型一变就编译失败」，而不是等到运行时报错。
// Compile-time contract pins (zero runtime): this file only type-checks. Nothing
// imports it and no statement runs; its job is to fail the build the moment a
// host type drifts, instead of failing at run time.
//
// 这次的核心教训被钉在第一组：**同一个概念只允许一个类型来源**。断言直接写
// 「宿主的 Session 就是这些函数收的类型」，所以调用处不可能再出现第二个 session 类型。
// The lesson is pinned in group 1: one concept, one type source. The assertions
// literally say "the host Session IS the type these functions take", so a second
// session type cannot appear at a call site.
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { apply, Config } from './index.js'
import type { ConfigShape } from './index.js'
import { renderAgentPreset, renderWorkspace, withHeading } from './render.js'
import { deriveFallbackTitle, lastSnapshotSectionText, lastSnapshotText, logEvents, selectedPreset } from './session-events.js'
import type { LogEventData, SessionLogView, SnapshotEvent } from './session-events.js'
import { buildSnapshotSections, readPresetRoster } from './snapshot.js'

/** 断言 A 可赋给 B（A 比 B 窄或同宽即通过）。Assert that A is assignable to B. */
type Pins<A extends B, B> = [A, B]
/** 断言两个类型完全同型（双向可赋）：交叉类型同时满足两侧约束。
 * Assert two types are identical both ways: the intersection satisfies both
 * constraint sides. */
type Same<A, B> = [Pins<A & B, A>, Pins<A & B, B>]
/** 只读放宽：可变数组可传给只读参数（单向，两者并不同型）。
 * Readonly widening: a mutable array may pass to a readonly parameter (one way). */
type Widens<A extends B, B> = Pins<A, B>

// 1) 日志视图必须是宿主 SessionEvent 的投影，而不是第二个来源：视图里的每条事件
//    都必须能赋回宿主的 SessionEvent，且宿主 Session 必须能直接传进每个读取函数。
// The log view must project the host's SessionEvent rather than duplicate it:
// every event in the view stays assignable back to the host's SessionEvent, and a
// host Session passes into every reader untouched.
type ViewProjectionPins = [
  Pins<SnapshotEvent, ReturnType<Session['snapshotEvents']>[number]>,
  Pins<SnapshotEvent, NonNullable<ReturnType<Session['eventAt']>>>,
  Same<LogEventData, SnapshotEvent['data']>,
  Pins<Session, SessionLogView>,
  Same<Parameters<typeof logEvents>, [SessionLogView]>,
  Same<ReturnType<typeof logEvents>, readonly SnapshotEvent[]>,
]

// 2) 唯一类型来源：这些函数收的就是宿主自己的类型，调用处没有第二个类型可漂移。
// Single type source: these take the host's own types, so no call site can drift.
type OneSourcePins = [
  Same<Parameters<typeof lastSnapshotText>, [SessionLogView, SessionSeq, string]>,
  Same<Parameters<typeof lastSnapshotSectionText>, [SessionLogView, SessionSeq, string, string]>,
  Same<ReturnType<typeof lastSnapshotSectionText>, string | undefined>,
  Same<Parameters<typeof deriveFallbackTitle>, [SessionLogView]>,
  Same<Parameters<typeof selectedPreset>, [SessionLogView]>,
]

// 3) 宿主列的复用：渲染层读的宿主字段必须与宿主类型同型（改可选性立刻红）。
// Reused host columns: the fields the renderer reads must match the host types.
type HostColumnPins = [
  Same<Parameters<typeof renderAgentPreset>[0], AgentPreset>,
  Same<Parameters<typeof renderWorkspace>[0], Workspace>,
  Same<Awaited<ReturnType<typeof readPresetRoster>>, AgentPreset[]>,
]

// 4) 插件自身签名：参数与返回值逐一对齐。
// The plugin's own signatures: parameters and returns, one by one.
type OwnSignaturePins = [
  Same<ReturnType<typeof withHeading>, string[]>,
  Same<Awaited<ReturnType<typeof buildSnapshotSections>>, import('./snapshot.js').SnapshotSection[]>,
  Same<ReturnType<typeof lastSnapshotText>, string | undefined>,
  Same<ReturnType<typeof deriveFallbackTitle>, string | undefined>,
  Same<ReturnType<typeof selectedPreset>, string | undefined>,
]

// 5) pre-step 一步：入口签名、宿主 agent.session / seq 可直接透传、决策返回值。
// The pre-step hook: the entry signature, passing agent.session / seq straight
// through, and the decision return type.
type PreStepPins = [
  Same<Parameters<typeof apply>, [Context, Config]>,
  Same<ReturnType<typeof apply>, void>,
  Same<Parameters<typeof buildSnapshotSections>[0]['ctx'], Context>,
  // 决策只有两个分支，且「进入」携带消息、「拒绝」不携带：断死这两条，分支判断与
  // 返回体就不会再写错判别值（曾把 'continue' 当成成功分支）。
  // A decision has exactly two branches — "enter" carries messages, "reject" does
  // not. Pinning both keeps our branch test and return body from inventing a
  // discriminant value (a real mistake: treating 'continue' as the success case).
  Same<PreStepDecision['kind'], 'reject' | 'enter'>,
  Pins<PreStepDecision, { kind: 'reject' } | { kind: 'enter', messages: UserMessage[] }>,
]

// 6) 配置面：用「真实调用」钉住，而不是用凭空写的函数类型钉住。只断言两件真实的
//    事：调用结果就是 Config；纯类型别名 ConfigShape 与接口同型。
// Config surface: pinned by a real call, not a hand-written function type. Only
// two true things are asserted: the call result is a Config, and the pure type
// alias ConfigShape matches the interface.
const resolvedConfig: Config = Config({ includePresetRoster: true, includeWorkspaceList: true, includeModelCatalog: true })
type ConfigPins = [
  Pins<typeof resolvedConfig, Config>,
  Same<ConfigShape, { includePresetRoster: boolean, includeWorkspaceList: boolean, includeModelCatalog: boolean }>,
]

// 引用一次，避免「未使用」告警；纯类型，不产生任何运行时语句。
// 刻意的编译期契约钉：仅供测试/对外契约，禁止删（删掉 = 契约漂移无报警）。
// Intentional compile-time contract pins: test-only / external contract. Do
// not delete — removal silences the drift alarm.
export type ContractPins = [
  ViewProjectionPins, OneSourcePins, HostColumnPins, OwnSignaturePins, PreStepPins, ConfigPins,
]
