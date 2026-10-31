/**
 * 页面会话再激活重挂：老会话的 agent 在重启/失效后重新创建时，把一次性渲染
 * 与 PAGE 块重放到新 agent 上。
 * Re-activation remount: when an old page session's agent is recreated, replay
 * the one-shot render and the PAGE block onto the fresh agent.
 *
 * 背景：一次性渲染绑定在原始 fiber 上——新 agent 身上没有页面工具面，也没有
 * 本会话的 PAGE 块，模型只能靠通用工具 improvising（真机反例：一个回合约
 * 40 万 token 的文件系统探查）。这里按 session 找到 live 行，解析页面定义，
 * 重挂组件体：工具/订阅/skill 随组件体重挂，首屏 effect 重发，fresh 事实经
 * followup 进上下文。
 * Background: the one-shot render is bound to the original fiber — a fresh
 * agent carries no page tool face and no PAGE block, and the model can only
 * improvise with generic tools (live counter-example: ~400K tokens of
 * filesystem probing in one turn). Given a session id, find the live row,
 * resolve the page definition, and remount the body: tools/subscriptions/
 * skills re-register with it, the first-screen effects re-fire, and fresh
 * facts ride followup into the context.
 *
 * @module @veren/page-registry/page-rerender
 */
import { assertParamsMatchPattern, pageToolWarning } from '@veren/prompt-page'
import type { PageInstanceIndex, PageInstanceKey, PageInstanceRecord, PageMatch } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AppRecord } from '@veren/app-registry'
import { collectPageTools, componentPageBlock } from './page-block.ts'
import { resolvePageTarget } from './resolve-target.ts'
import type { PageRuntimePorts } from './runtime-ports.ts'

/** 已完成一次性渲染的 agent（同进程内防重挂；跨进程靠新 agent 对象天然区分）*/
/** Agents whose one-shot render already ran (in-process remount guard; across processes the fresh agent object distinguishes naturally) */
const renderedAgents = new WeakSet<object>()

/** 重挂入口接受的注册表面 / the registry face the remount entry consumes */
type RemountRegistry = {
  resolve(url: string): PageMatch<never> | null
  catalog(): ReadonlyArray<{ url: string }>
}

/**
 * 页面会话再激活重挂入口：按 session 找到 live 行并把唯一渲染 + PAGE 块重放到
 * 新 agent。同一 agent 只重挂一次（WeakSet）；reserved 行（两阶段创建中）与
 * 非 live 行跳过，因此新会话的创建路径不会由此双重渲染。失败只降级
 * （warn + false），绝不销毁已有会话——老会话的日志与索引行都是既成事实。
 * The remount entry: find the live row for the session and replay the one-shot
 * render + PAGE block onto the new agent. Each agent remounts at most once
 * (WeakSet); reserved rows (mid two-phase create) and non-live rows are
 * skipped, so the fresh-create path never double-renders through this entry.
 * Failures degrade (warn + false) and never destroy the existing session — its
 * log and index row are already facts.
 */
export async function rerenderLivePage(
  registry: RemountRegistry,
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  sessionId: string,
  agent: Agent,
): Promise<boolean> {
  const tag = agent as unknown as object
  if (renderedAgents.has(tag)) return false
  for (const entry of registry.catalog()) {
    const row = await index.lookup(entry.url as PageInstanceKey).catch(() => undefined)
    if (row === undefined || row.sessionId !== sessionId || row.state !== 'live') continue
    if (await remountLiveRow(registry, ports, sessionId, row, agent, tag)) return true
  }
  return false
}

/** 重放一行 live 记录的渲染；解析/参数校验失败按"非本页"跳过（false） / replay one live row's render; resolve/param failures skip as "not this page" (false) */
async function remountLiveRow(
  registry: RemountRegistry,
  ports: PageRuntimePorts,
  sessionId: string,
  row: PageInstanceRecord,
  agent: Agent,
  tag: object,
): Promise<boolean> {
  let resolved: { key: PageInstanceKey; app: AppRecord; match: PageMatch<never> }
  try {
    resolved = resolvePageTarget(registry, ports, row.url)
  } catch {
    return false
  }
  const { key, app, match } = resolved
  const params = { ...row.params }
  try {
    assertParamsMatchPattern(match.page.url, params)
  } catch {
    return false
  }
  const before = ports.sessions.toolFace(sessionId)
  const body = match.live.mount(params, agent)
  const pageTools = collectPageTools(before, ports.sessions.toolFace(sessionId))
  const warning = pageToolWarning(match.page, pageTools.length)
  if (warning !== undefined) ports.warn?.(`${warning} (app "${app.definition.id}", url "${key}", rerender)`)
  const block = componentPageBlock(app, match, key, pageTools, body)
  await ports.sessions.appendUserMessage(sessionId, block, 'app/page')
  renderedAgents.add(tag)
  return true
}
