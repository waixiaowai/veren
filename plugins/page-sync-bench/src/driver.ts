/**
 * 基准驱动：DeepSeek API 客户端 + 页面会话模拟循环 + 统计 / Bench driver: API client + loop + stats
 * 组装：mountPage（一页一会话）→ store 变化自动重渲染 → session.syncText(cursor) 注入。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mountPage } from '@veren/prompt-page'
import { MessageHost } from '@veren/prompt-host-messages'
import { LIST_CHAT_TOOLS, LIST_SYSTEM_PROMPT, listPage, dispatchTaskTool } from './page.tsx'
import { TaskStore, makeList } from './store.ts'
import type { BenchReport, CallUsage, RoundStat } from './types.ts'

const API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'
const LIST_SIZE = 150

/** 读取密钥：环境变量优先，其次 ~/.dsh/.credentials.yaml 的 refs。
 * 基准工具的公开入口，测试即产品 / benchmark entry point; the specs ARE the product. */
export function loadApiKey(): string | undefined {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const raw = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const line = raw.split('\n').find((text) => text.trim().startsWith('DEEPSEEK_API_KEY:'))
    const value = line?.split(':', 2)[1]?.trim()
    return value === undefined || value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** 确定性伪随机（LCG，保证可复现）/ deterministic PRNG */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** 其他用户改动 3 条（只动 t-0..t-99，避免干扰指令目标 t-100+）/ others mutate 3 items */
function mutateByOthers(store: TaskStore, round: number): void {
  const current = store.getState().map((item) => ({ ...item }))
  const random = rng(round * 7919 + 13)
  for (let k = 0; k < 3; k++) {
    const index = Math.floor(random() * 100)
    const item = current[index]
    if (item.status === 'open') {
      current[index] = { ...item, status: 'taken', ownerId: `user-${round}-${k}` }
    } else if (item.status === 'taken') {
      current[index] = { ...item, status: 'done' }
    } else {
      current[index] = { ...item, status: 'open', ownerId: null }
    }
  }
  store.commit(current)
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

interface ChatResponse {
  choices: { message: ChatMessage }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    prompt_cache_hit_tokens: number
    prompt_cache_miss_tokens: number
  }
}

/** 调用一次 chat completion / one chat completion call */
async function chat(apiKey: string, messages: ChatMessage[]): Promise<{ message: ChatMessage; usage: CallUsage }> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, tools: LIST_CHAT_TOOLS, temperature: 0 }),
  })
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`)
  const data = await response.json() as ChatResponse
  const usage: CallUsage = {
    promptTokens: data.usage.prompt_tokens,
    completionTokens: data.usage.completion_tokens,
    cacheHitTokens: data.usage.prompt_cache_hit_tokens,
    cacheMissTokens: data.usage.prompt_cache_miss_tokens,
  }
  return { message: data.choices[0].message, usage }
}

/** 组装列表页会话，返回其消息宿主。基准工具公开入口，测试即产品
 * / benchmark entry point; the specs ARE the product (test-only callers). */
export function assemblePageSession(store: TaskStore): MessageHost {
  return mountPage({ page: listPage, store }).host
}

/**
 * 跑一场基准：mountPage 挂载列表页 → 每轮服务端演化（自动重渲染）→ 注入同步 → 模型执行指令 → 服务端验证。
 * 基准工具公开入口，测试即产品 / benchmark entry point; the specs ARE the product.
 */
export async function runBench(apiKey: string, mode: 'full' | 'delta', rounds = 6): Promise<BenchReport> {
  const store = new TaskStore(makeList(LIST_SIZE))
  return runBenchInner(apiKey, mode, rounds, store)
}

async function runBenchInner(apiKey: string, mode: 'full' | 'delta', rounds: number, store: TaskStore): Promise<BenchReport> {
  const session = mountPage({ page: listPage, store })
  const messages: ChatMessage[] = [
    { role: 'system', content: LIST_SYSTEM_PROMPT },
    { role: 'user', content: session.pointerMessage },
  ]
  let cursor: number | undefined
  const roundStats: RoundStat[] = []

  for (let round = 1; round <= rounds; round++) {
    mutateByOthers(store, round)
    const syncText = mode === 'full' ? session.syncText(undefined) : session.syncText(cursor)
    cursor = session.version

    // 指令：第 r 轮完成 t-(99+r) 并接取 t-(100+r) / directive: complete previous, take next
    const target = `t-${100 + round}`
    const directive = round === 1
      ? `请接取任务 ${target}。`
      : `请先完成任务 t-${99 + round}，再接取任务 ${target}。`
    messages.push({ role: 'user', content: `${syncText}\n\n---\n第 ${round} 轮指令：${directive}` })

    const stat: RoundStat = {
      round, injectedBytes: Buffer.byteLength(syncText), calls: [],
      toolCallsTotal: 0, toolCallsOk: 0, directiveOk: false,
    }

    for (let step = 0; step < 5; step++) {
      const { message, usage } = await chat(apiKey, messages)
      stat.calls.push(usage)
      messages.push(message)
      const calls = message.tool_calls ?? []
      if (calls.length === 0) break
      for (const call of calls) {
        const outcome = dispatchTaskTool(store, call.function.name, call.function.arguments)
        stat.toolCallsTotal += 1
        if (outcome.ok) stat.toolCallsOk += 1
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
      }
    }

    // 服务端验证指令 / verify directive server-side
    const items = store.getState()
    const taken = items.find((item) => item.id === target)
    const done = round > 1 ? items.find((item) => item.id === `t-${99 + round}`) : undefined
    stat.directiveOk = taken?.status === 'taken' && taken.ownerId === 'model'
      && (done === undefined || done.status === 'done')
    roundStats.push(stat)
  }
  session.unsubscribe()

  return { mode, rounds, listSize: LIST_SIZE, roundStats, totals: totalsOf(roundStats) }
}

/** 汇总统计 / aggregate totals */
function totalsOf(roundStats: RoundStat[]): BenchReport['totals'] {
  const sum = (pick: (stat: RoundStat) => number): number =>
    roundStats.reduce((acc, stat) => acc + pick(stat), 0)
  const calls = roundStats.flatMap((stat) => stat.calls)
  return {
    promptTokens: calls.reduce((acc, usage) => acc + usage.promptTokens, 0),
    completionTokens: calls.reduce((acc, usage) => acc + usage.completionTokens, 0),
    cacheHitTokens: calls.reduce((acc, usage) => acc + usage.cacheHitTokens, 0),
    llmCalls: calls.length,
    toolCallsTotal: sum((stat) => stat.toolCallsTotal),
    toolCallsOk: sum((stat) => stat.toolCallsOk),
    directivesOk: roundStats.filter((stat) => stat.directiveOk).length,
  }
}
