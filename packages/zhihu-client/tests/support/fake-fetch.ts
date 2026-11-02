/**
 * 测试支撑：可编程的假 fetch。
 *
 * 假实现记录每次请求（URL、请求头），并按脚本返回响应。这样测试断言的是
 * "客户端发了什么、怎么处理回答"，而不是网络本身。
 *
 * Test support: a programmable fake fetch.
 *
 * The fake records every request (url, headers) and answers from a script, so
 * the tests assert what the client sent and how it handled the answer rather
 * than anything about the network.
 */

/** 一次被记录的请求 / one recorded request */
export interface RecordedRequest {
  readonly url: string
  readonly headers: Record<string, string>
}

/** 一次脚本化的回答 / one scripted answer */
export interface ScriptedAnswer {
  readonly status?: number
  readonly body?: string
}

/** 假 fetch：按路径后缀匹配脚本 / a fake fetch: matched by path suffix */
export class FakeFetch {
  /** 记录下来的请求 / the recorded requests */
  readonly requests: RecordedRequest[] = []
  private readonly script: Readonly<Record<string, ScriptedAnswer>>
  private readonly fallback: ScriptedAnswer

  /**
   * @param script - path-suffix → answer / 路径后缀 → 回答
   * @param fallback - the answer for unmatched paths / 未命中路径的回答
   */
  constructor(script: Readonly<Record<string, ScriptedAnswer>> = {}, fallback: ScriptedAnswer = { body: '{}' }) {
    this.script = script
    this.fallback = fallback
  }

  /** 作为 fetch 传给客户端 / the fetch implementation handed to the client */
  readonly fetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    this.requests.push({ url, headers: { ...(init?.headers as Record<string, string> | undefined) } })
    const answer = this.answerFor(url)
    return new Response(answer.body ?? '', { status: answer.status ?? 200 })
  }

  /** 按路径后缀挑出脚本化的回答 / picks the scripted answer by path suffix */
  private answerFor(url: string): ScriptedAnswer {
    for (const [suffix, answer] of Object.entries(this.script)) {
      if (url.includes(suffix)) return answer
    }
    return this.fallback
  }
}

/** 造一个 JSON 回答的脚本项 / a scripted answer carrying JSON */
export function jsonAnswer(payload: unknown, status = 200): ScriptedAnswer {
  return { status, body: JSON.stringify(payload) }
}
