/**
 * Shared fixtures of the forum tool specs: the drivable minimal execution
 * face, the temp storage root with its cleanup, the config resolver, and the
 * full real mount (real storage stack + the real forum service + the six
 * builder products built over the service's own tools port).
 *
 * 论坛工具用例的共享夹具：可驱动的最小执行面、带清理的临时存储根、配置解析器，
 * 以及真实全栈挂载（真实存储栈 + 真实论坛服务 + 用服务自己的工具端口构建出的
 * 六个构建器产物）。
 *
 * @module @veren/forum/tests/helpers/tools-mount
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ForumService from '../../src/index.ts'
import {
  buildForumCommentDefinition, buildForumInboxDefinition, buildForumListDefinition,
  buildForumPostDefinition, buildForumReadDefinition, buildForumVoteDefinition,
} from '../../src/tools.ts'
import { Config, DEFAULT_MAX_PER_HOUR, DEFAULT_TICK_SECONDS } from '../../src/config.ts'
import type { ForumConfig } from '../../src/config.ts'

/** The minimal execution face the specs drive (methods stay bivariant; a fake stands in for the host exec). 用例驱动的最小执行面（方法签名保持双变，宿主 exec 由假实现顶替）。 */
export interface RegisteredTool {
  readonly name: string
  /** The tool's JSON Schema object; its properties carry `required` and `enum`. 工具的 JSON 模式对象；其 properties 携带 required 与 enum。 */
  readonly parameters: { readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>, readonly required?: readonly string[] }
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
}

/** Tests drive execute only: narrow to the minimal face once. 测试只走 execute：收窄到最小执行面（唯一断言点）。 */
export function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
}

/**
 * The canonical value one tool call returns.
 *
 * `execute` hands back the tool's own canonical JSON value; the registry is what
 * renders it into model-facing content blocks, so these specs assert on the
 * value the tool produced and leave rendering to the registry's own suites.
 *
 * 一次工具调用返回的规范值。
 *
 * `execute` 交回工具自己的规范 JSON 值；把它渲染成面向模型的内容块是注册表的工作，因此
 * 这些用例断言工具产出的值，渲染由注册表自己的套件覆盖。
 */
export function toolValue<T>(result: unknown): T {
  return result as T
}

/** The app-local names in the collector's order. 收编清单顺序里的应用本地名。 */
export const TOOL_NAMES = ['list', 'read', 'post', 'comment', 'vote', 'inbox']

/**
 * The live Agent a tool reads its caller from.
 *
 * The tools resolve the caller through `ctx.agentPresets.composedPreset` and
 * `ctx.workingDirectory.get`, so any non-null value stands for a running
 * Agent; the specs supply the minimal slice those two readers touch.
 *
 * 工具读取调用者所依据的活 Agent。
 *
 * 工具通过 `ctx.agentPresets.composedPreset` 与 `ctx.workingDirectory.get` 解析调用者，因此
 * 任何非空值都代表一个运行中的 Agent；这些用例提供那两个读取者触及的最小切片。
 */
export const AGENT = {
  ctx: {},
  session: { header: { agentPreset: 'standard' } },
}

/** The roots one spec's temp storage lives under; {@link disposeTrackedRoots} removes them. 每条用例的临时存储根，由 disposeTrackedRoots 删除。 */
const roots: string[] = []

/** Remove every temp storage root this spec file created. 删除本测试文件创建的全部临时存储根。 */
export function disposeTrackedRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forum-tools-'))
  roots.push(root)
  return root
}

/**
 * Config with the auto-post runner off; the specs drive tools, not the timer.
 * Every field is spelled out: the schema resolves defaults the way the plugin
 * manager would, and these specs pin the values they depend on.
 *
 * 关闭自动发帖运行的配置；这些用例驱动工具而非定时器。逐字段写明：模式按插件管理器的方式
 * 解析默认值，而这些用例钉住自己依赖的值。
 */
export function config(over: Partial<ForumConfig> = {}): ForumConfig {
  return {
    autoPost: { tickSeconds: DEFAULT_TICK_SECONDS, maxPerHour: DEFAULT_MAX_PER_HOUR, presets: [] },
    panelUrl: '',
    ...over,
  }
}

/** What one mount hands the specs: the context, the fiber, the drivable tools, the spy registry, and the mount's preset/cwd. 一次挂载交给用例的事实：上下文、fiber、可驱动工具、侦探注册表与挂载的预设/工作目录。 */
export interface Mounted {
  ctx: Context
  fiber: Fiber
  tools: Map<string, RegisteredTool>
  registered: Map<string, RegisteredTool>
  preset: string
  cwd: string
}

/** The identity slice one mount runs under. 一次挂载运行所依据的身份切片。 */
interface MountIdentity {
  readonly preset: string
  readonly cwd: string
  readonly workspacePath: string
}

/**
 * Provide the spy registry plus the minimal service doubles the tools' readers
 * touch. The application framework is deliberately NOT provided (G2): the host
 * no longer declares `apps`, so this mount IS the framework-absent deployment —
 * the service must activate and wait for nothing.
 * 提供侦探注册表与工具读取者触及的最小服务替身。刻意不提供应用框架（G2）：宿主
 * 不再声明 `apps`，因此这个挂载就是框架缺席的部署——服务必须照常激活、不等待任何东西。
 */
function provideMinimalServices(ctx: Context, registered: Map<string, RegisteredTool>, identity: MountIdentity): void {
  // A spy registry: the service must leave it empty (the G2 contract pins it)
  // while the specs drive the builder products directly.
  // 侦探注册表：服务必须让它一直空着（G2 契约钉死），用例则直驱构建器产物。
  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      registered.set(tool.name, tool)
      return () => { registered.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('systemPrompt', { context: () => () => {} })
  ctx.provide('agentPresets', {
    list: async () => [{ id: identity.preset, name: identity.preset }],
    composedPreset: () => identity.preset,
  })
  ctx.provide('llm', {})
  // Declared hard injects of the service (G13): provide the minimal slice each
  // reader touches; the drafting selection stays unconfigured here.
  // 服务的声明的硬 inject（G13）：提供各读取者触及的最小切片；起草用的默认模型在此不配置。
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  ctx.provide('workingDirectory', { get: () => identity.cwd })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: identity.workspacePath, title: 'Demo' }] })
}

/** Mount the real storage stack over a fresh temp root. 在全新临时根上挂载真实存储栈。 */
async function mountStorageStack(ctx: Context): Promise<void> {
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
}

/** Build the six definitions through the builders over the service's own port —
 * the exact objects the application layer registers.
 * 用构建器配服务自己的端口造出六个定义——正是应用层登记的那批对象。 */
function buildForumTools(ctx: Context): Map<string, RegisteredTool> {
  const port = () => ctx.forum.toolsPort()
  return new Map<string, RegisteredTool>([
    ['list', drivable(buildForumListDefinition(ctx, port))],
    ['read', drivable(buildForumReadDefinition(ctx, port))],
    ['post', drivable(buildForumPostDefinition(ctx, port))],
    ['comment', drivable(buildForumCommentDefinition(ctx, port))],
    ['vote', drivable(buildForumVoteDefinition(ctx, port))],
    ['inbox', drivable(buildForumInboxDefinition(ctx, port))],
  ])
}

/**
 * Mount the real storage stack and forum service, with a live preset, a
 * workspace the sessions' working directory resolves into, and the six builder
 * products built over the service's tools port.
 *
 * 挂载真实存储栈与论坛服务，并提供一个活的预设、一个会话工作目录能解析到的工作区，以及
 * 用服务工具端口构建出的六个构建器产物。
 *
 * @param options - the preset name, the session's working directory, the
 *   workspace that directory belongs to, and the config overrides.
 * @returns the root context, the fiber, the drivable tools, and the captured
 *   `ctx.tools` registry (which must stay empty).
 */
export async function mount(options: {
  preset?: string,
  cwd?: string,
  workspacePath?: string,
  config?: Partial<ForumConfig>,
} = {}): Promise<Mounted> {
  const ctx = new Context()
  const registered = new Map<string, RegisteredTool>()
  const identity: MountIdentity = {
    preset: options.preset ?? 'standard',
    cwd: options.cwd ?? 'C:/work/demo',
    workspacePath: options.workspacePath ?? options.cwd ?? 'C:/work/demo',
  }
  provideMinimalServices(ctx, registered, identity)
  await mountStorageStack(ctx)
  // Config 是 Standard Schema，不是 Plugin.Transform：传配置要经 Config() 解析出
  // 运行时形态（补齐默认值），否则注册表按 schema 校验原始输入并拒绝。
  // Config is a Standard Schema, not a Plugin.Transform: resolve the config
  // through Config() first so defaults are filled and the registry accepts it.
  const resolved = Config(config(options.config) as Parameters<typeof Config>[0])
  const fiber: Fiber = ctx.plugin(ForumService, resolved)
  await fiber
  return { ctx, fiber, tools: buildForumTools(ctx), registered, preset: identity.preset, cwd: identity.cwd }
}

/**
 * The execution context one tool call carries.
 *
 * The registry always passes it, so the specs do too: `agent` is the live Agent
 * the caller's preset and working directory are read from, and its absence is
 * the one refusal a tool reports as `no_caller`.
 *
 * 一次工具调用携带的执行上下文。注册表总会传入它，因此这些用例也传：其中的 `agent` 就是
 * 读取调用者预设与工作目录的活 Agent，它缺席时工具报告 `no_caller`。
 */
export function execution(agent: unknown): { agent: unknown } {
  return { agent }
}

/** Register one board the tools can post into. 登记一个工具可发帖的板块。 */
export async function seedBoard(ctx: Context, path = 'C:/work/demo'): Promise<string> {
  const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path })
  return board.id
}
