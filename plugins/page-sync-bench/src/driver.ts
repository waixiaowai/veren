/**
 * 鍩哄噯椹卞姩锛欴eepSeek API 瀹㈡埛绔?+ 椤甸潰浼氳瘽妯℃嫙寰幆 + 缁熻 / Bench driver: API client + loop + stats
 * 缁勮锛歴tore锛堟潈濞佺姸鎬侊級鈫?bindStore 鈫?prompt-core 璋冨害 鈫?MessageHost 鎻愪氦 鈫?renderSince 娉ㄥ叆銆? */
import { bindStore, createRoot, scheduleRender } from '@veren/prompt-core'
import { MessageHost, renderSync } from '@veren/prompt-host-messages'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TaskListPage, SYSTEM_PROMPT, TOOLS, dispatchTool } from './page.ts'
import { TaskStore, makeList } from './store.ts'
import type { BenchReport, CallUsage, RoundStat } from './types.ts'

const API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'
const LIST_SIZE = 150

/** 璇诲彇瀵嗛挜锛氱幆澧冨彉閲忎紭鍏堬紝鍏舵 ~/.dsh/.credentials.yaml 鐨?refs / load API key */
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

/** 纭畾鎬т吉闅忔満锛圠CG锛屼繚璇佸彲澶嶇幇锛? deterministic PRNG */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** 鍏朵粬鐢ㄦ埛鏀瑰姩 3 鏉★紙鍙姩 t-0..t-99锛岄伩鍏嶅共鎵版寚浠ょ洰鏍?t-100+锛? others mutate 3 items */
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

/** 璋冪敤涓€娆?chat completion / one chat completion call */
async function chat(apiKey: string, messages: ChatMessage[]): Promise<{ message: ChatMessage; usage: CallUsage }> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, temperature: 0 }),
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

/** 缁勮椤甸潰浼氳瘽锛歴tore 鈫?bindStore 鈫?璋冨害鏍癸紙涓€娆?mount 寤虹珛闈欐€佸墠缂€涓庡熀绾垮揩鐓э級*/
export function assemblePageSession(store: TaskStore): MessageHost {
  const host = new MessageHost()
  const root = createRoot(host)
  bindStore<TaskItem[]>(root, store, (items) => TaskListPage({ items }))
  scheduleRender(root, TaskListPage({ items: store.getState() })) // 鍒濆鎸傝浇
  return host
}

/**
 * 璺戜竴鍦哄熀鍑嗭細姣忚疆 = 鏈嶅姟绔姸鎬佹紨鍖栵紙鑷姩閲嶆覆鏌擄級鈫?娉ㄥ叆鍚屾 鈫?妯″瀷鎵ц鎸囦护 鈫?鏈嶅姟绔獙璇併€? */
export async function runBench(apiKey: string, mode: 'full' | 'delta', rounds = 6): Promise<BenchReport> {
  const store = new TaskStore(makeList(LIST_SIZE))
  const host = assemblePageSession(store)
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  let cursor: number | undefined
  const roundStats: RoundStat[] = []

  for (let round = 1; round <= rounds; round++) {
    mutateByOthers(store)
    const sync = mode === 'full' ? host.renderSince(undefined) : host.renderSince(cursor)
    cursor = host.currentVersion
    const syncText = renderSync(sync)

    // 鎸囦护锛氱 r 杞畬鎴?t-(99+r) 骞舵帴鍙?t-(100+r) / directive: complete previous, take next
    const target = `t-${100 + round}`
    const directive = round === 1
      ? `璇锋帴鍙栦换鍔?${target}銆俙
      : `璇峰厛瀹屾垚浠诲姟 t-${99 + round}锛屽啀鎺ュ彇浠诲姟 ${target}銆俙
    messages.push({ role: 'user', content: `${syncText}\n\n---\n绗?${round} 杞寚浠わ細${directive}` })

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
        const outcome = dispatchTool(store, call.function.name, call.function.arguments)
        stat.toolCallsTotal += 1
        if (outcome.ok) stat.toolCallsOk += 1
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
      }
    }

    // 鏈嶅姟绔獙璇佹寚浠?/ verify directive server-side
    const items = store.getState()
    const taken = items.find((item) => item.id === target)
    const done = round > 1 ? items.find((item) => item.id === `t-${99 + round}`) : undefined
    stat.directiveOk = taken?.status === 'taken' && taken.ownerId === 'model'
      && (done === undefined || done.status === 'done')
    roundStats.push(stat)
  }

  return { mode, rounds, listSize: LIST_SIZE, roundStats, totals: totalsOf(roundStats) }
}

/** 姹囨€荤粺璁?/ aggregate totals */
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
