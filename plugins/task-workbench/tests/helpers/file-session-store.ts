/**
 * The file-backed session directory (a minimal DSH-session stand-in whose
 * state lives on disk): the acceptance scenarios' session mechanism. State is
 * a JSON file; agent.followup appends messages and writes back at once; the
 * page-registry session port is the test face of the real mechanism — state on
 * disk, body-registered tools into the shared registry, retire actually strips.
 *
 * 落盘的会话目录（DSH 会话系统的最小替身，状态在文件里）：验收场景的会话机制。
 * 状态是一份 JSON 文件；agent.followup 追加消息并立即写回；page-registry 的会话
 * 端口是真实机制的测试面——状态落盘、组件体直登的工具进共享注册表、retire 真的摘掉。
 *
 * @module @veren/task-workbench/tests/helpers/file-session-store
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { PageSessionPort, PageToolEntry } from '@veren/page-registry'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

interface SessionFile {
  sessions: Record<string, { title: string; messages: string[]; alive: boolean }>
}

/** 注入的 session/event 发射器（boot 接线：消息落目录时同步喂同意门折叠）
 * / the injected session/event emitter (wired by boot: every append feeds the consent fold) */
export type SessionEventEmit = (session: object, event: object) => void

/** 会话目录：JSON 文件落盘；agent.followup 追加消息并立即写回。 */
export class FileSessionStore {
  private readonly data: SessionFile = { sessions: {} }
  /** 各会话登记的页面工具名（内存即可：重启后由重开路径重新登记）。
   *  Page tool names registered per session (memory only: a restart re-registers via reopen). */
  readonly #mountedTools = new Map<string, string[]>()
  /** 各会话的登记面（agentOf 假 agent 写它，toolFace 快照读它）
   * / each session's registration face (the agentOf fake writes it; toolFace snapshots read it) */
  readonly #toolFaces = new Map<string, PageToolEntry[]>()
  /** 稳定会话对象（同意门按对象键：exec.agent.session 必须与事件桥同一对象）
   * / stable session objects (the consent gate keys on the object: exec.agent.session must be the same object the event bridge emits) */
  readonly #sessionFaces = new Map<string, { readonly id: string }>()
  /** session/event 发射器（boot 注入）/ the session/event emitter (injected by boot) */
  emitSessionEvent: SessionEventEmit = () => undefined

  constructor(readonly file: string, private readonly tools: Map<string, ToolDefinition>) {
    if (existsSync(file)) this.data.sessions = JSON.parse(readFileSync(file, 'utf8')) as SessionFile['sessions']
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data.sessions, null, 2))
  }

  alive(id: string): boolean {
    return this.data.sessions[id]?.alive === true
  }

  messages(id: string): readonly string[] {
    return this.data.sessions[id]?.messages ?? []
  }

  titles(): readonly string[] {
    return Object.values(this.data.sessions).map((row) => row.title)
  }

  /** 宿主 `sessions` 服务的最小面 / the minimal host `sessions` face */
  readonly dsh = {
    // header 是 app-host 会话端口 presetOf 的同源字段（页面 load 的 PageLoadEnv）
    // / header feeds app-host's session-port presetOf (the page load's PageLoadEnv)
    get: (id: string) => (this.alive(id)
      ? { header: { agentPreset: 'standard' }, dispose: () => { this.data.sessions[id]!.alive = false; this.save() } }
      : undefined),
    create: (id: string, title?: string) => {
      this.data.sessions[id] = { title: title ?? id, messages: [], alive: true }
      this.save()
    },
  }

  /** 宿主 `agents` 服务的最小面 / the minimal host `agents` face */
  readonly agents = {
    get: (id: string) => (this.alive(id)
      ? { followup: (message: { content: Array<{ type: string; text?: string }> }) => {
          const text = message.content.map((block) => block.text ?? '').join('')
          this.data.sessions[id]!.messages.push(text)
          this.save()
        } }
      : undefined),
  }

  /** 会话的稳定对象（工具执行与事件桥共用）/ the session's stable object (shared by tool execs and the event bridge) */
  sessionFace(id: string): { readonly id: string } {
    const existing = this.#sessionFaces.get(id)
    if (existing !== undefined) return existing
    const face = { id }
    this.#sessionFaces.set(id, face)
    return face
  }

  /** 摘掉一个会话登记的全部页面工具（废弃/销毁路径共用）：名字来自登记面快照
   * / strip every page tool a session registered (shared by deprecate & destroy): names come from the registration face */
  releaseToolsOf(id: string): void {
    for (const entry of this.#toolFaces.get(id) ?? []) this.tools.delete(entry.name)
    this.#toolFaces.delete(id)
    this.#mountedTools.delete(id)
  }

  /**
   * page-registry 的会话端口（G13 后端口是纯参数，由装配显式传入；这里是测试
   * 版的真实会话机制——状态落盘、组件体直登的工具进共享注册表、retire 真的摘掉）。
   * The page-registry session port (post-G13 ports arrive as pure parameters
   * from the assembly). This is the test face of the real session mechanism:
   * state on disk, body-registered tools into the shared registry, retire
   * actually strips.
   */
  readonly port: PageSessionPort = {
    exists: (id) => this.alive(id),
    mintId: () => `s-${randomUUID()}`,
    create: async (id, title) => {
      this.data.sessions[id] = { title, messages: [], alive: true }
      this.#toolFaces.set(id, [])
      this.save()
    },
    agentOf: (id) => {
      if (!this.alive(id)) return undefined
      const face = this.#toolFaces.get(id) ?? []
      return {
        ctx: {
          tools: {
            register: (definition: ToolDefinition) => {
              const entry: PageToolEntry = { name: definition.name, description: definition.description }
              face.push(entry)
              this.tools.set(definition.name, definition)
              return () => undefined
            },
          },
          // effect 真跑（异步首屏生命周期：重建投影 + followup 送达），fire-and-forget
          // / effects really run (the async first-screen lifecycle: rebuild + followup), fire-and-forget
          effect: (callback: () => unknown) => {
            void Promise.resolve().then(callback).catch(() => undefined)
            return () => undefined
          },
          on: () => () => undefined,
        },
        // followup：页面自推消息直接落会话日志（与宿主 agents.followup 同语义）
        // / followup: the page's own messages land straight in the session log (same semantics as the host agents.followup)
        followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
          const text = message.content.map((block) => block.text ?? '').join('')
          this.data.sessions[id]?.messages.push(text)
          this.save()
        },
        session: this.sessionFace(id),
      } as never
    },
    // 快照必须拷贝：活引用会让 before/after 同数组、差集恒空
    // / the snapshot must copy: a live reference makes before/after one array and the delta permanently empty
    toolFace: (id) => [...(this.#toolFaces.get(id) ?? [])],
    retire: async (id) => { this.releaseToolsOf(id) },
    appendUserMessage: async (id, text, source) => {
      this.data.sessions[id]?.messages.push(text)
      this.save()
      // session/event 桥：注入消息（PAGE 块/通知/TASK 块）同步喂同意门折叠
      // / the session/event bridge: injected messages (PAGE block / notice / TASK block) feed the consent fold
      if (source !== undefined) {
        this.emitSessionEvent(this.sessionFace(id), {
          type: 'user/message',
          data: { message: { source: { kind: source }, content: [{ type: 'text', text }] } },
        })
      }
    },
    focus: async () => undefined,
    destroy: async (id) => {
      this.releaseToolsOf(id)
      delete this.data.sessions[id]
      this.save()
    },
  }
}
