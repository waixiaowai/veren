/**
 * Provider 缓存断点策略 / provider cache-boundary policies
 *
 * - deepseek / openai：前缀自动缓存 → 策略 = 保持前缀稳定，零显式标记
 * - anthropic：显式 ephemeral 断点（系统提示 + 尾部同步消息，≤4 个）
 * 断点摆放是宿主层策略：内核与页面组件完全不知道 provider 的存在。
 */
export interface ContextBlock {
  role: 'system' | 'user' | 'tool'
  content: string
  /** provider 断点提示 / provider breakpoint hint */
  cacheControl?: 'ephemeral'
}

export interface CachePolicy {
  readonly name: 'deepseek' | 'anthropic' | 'openai'
  readonly supportsExplicitBreakpoints: boolean
  readonly maxBreakpoints: number
}

export const deepseekPolicy: CachePolicy = { name: 'deepseek', supportsExplicitBreakpoints: false, maxBreakpoints: 0 }
export const anthropicPolicy: CachePolicy = { name: 'anthropic', supportsExplicitBreakpoints: true, maxBreakpoints: 4 }
export const openaiPolicy: CachePolicy = { name: 'openai', supportsExplicitBreakpoints: false, maxBreakpoints: 0 }

/**
 * provider 名 → 缓存策略。**未知 provider 的默认行为（显式、非静默）**：
 * 按 deepseek 语义处理——自动前缀缓存、零显式标记（OpenAI 兼容 chat 接口的
 * 通用语义）。需要显式断点的 provider（如 anthropic）必须在此登记；未登记的
 * provider 拿到的默认语义本来就不发断点，因此不存在"静默丢断点"。
 * Provider name → cache policy. Default for unknown providers (explicit, not
 * silent): deepseek semantics — automatic prefix caching, zero explicit
 * markers (the common OpenAI-compatible chat semantics). Providers needing
 * explicit breakpoints (e.g. anthropic) must register here; an unregistered
 * provider's default semantics send no breakpoints anyway, so nothing is
 * silently dropped.
 */
export function policyFor(provider: string): CachePolicy {
  if (provider === 'anthropic') return anthropicPolicy
  if (provider === 'openai') return openaiPolicy
  return deepseekPolicy
}

/**
 * 组装上下文块：系统提示（静态前缀）在最前，同步消息按序追加，最后按 provider 摆断点。
 * Assemble context blocks: system first (static prefix), syncs appended, breakpoints per provider.
 */
export function planMessages(policy: CachePolicy, systemPrompt: string, syncs: { role: 'user' | 'tool'; content: string }[]): ContextBlock[] {
  const blocks: ContextBlock[] = [{ role: 'system', content: systemPrompt }]
  for (const sync of syncs) blocks.push({ role: sync.role, content: sync.content })
  return applyBreakpoints(policy, blocks)
}

/** 显式 provider：尾部同步消息标记断点（≤ maxBreakpoints）/ mark the tail sync for explicit providers */
function applyBreakpoints(policy: CachePolicy, blocks: ContextBlock[]): ContextBlock[] {
  if (!policy.supportsExplicitBreakpoints || blocks.length <= 1) return blocks
  const result = [...blocks]
  result[result.length - 1] = { ...result[result.length - 1], cacheControl: 'ephemeral' }
  return result
}

/** 转换为 chat API 消息（丢弃 provider 内部提示字段）/ strip to plain chat messages */
export function toChatMessages(blocks: ContextBlock[]): { role: ContextBlock['role']; content: string }[] {
  return blocks.map((block) => ({ role: block.role, content: block.content }))
}
