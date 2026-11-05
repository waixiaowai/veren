/**
 * The participant roster: every identity a room member can be.
 *
 * Participants per the design are humans and agents in one roster. On DSH the
 * agents ARE presets (a participant is `agent:<presetId>`), the owner is the
 * host's human (`human:owner`), and external humans come from the people
 * directory (`human:<personId>`). The roster resolves ids to display views;
 * it owns no persistence — preset-backed agents live in the host, humans in
 * the people store.
 *
 * 参与者名册：房间成员可以是的每一种身份。
 *
 * 按设计，参与者是人与智能体同列的一份名册。在 DSH 上，智能体就是 preset
 * （参与者即 `agent:<presetId>`），所有者是宿主的人（`human:owner`），外部的人来自人员
 * 目录（`human:<personId>`）。名册负责把 id 解析成展示视图；它不拥有持久化——preset
 * 智能体活在宿主里，人活在人员存储里。
 *
 * @module @veren/im/participants
 */

import { defineToken } from '@veren/core'
import type { ImPeople, ImPersonView } from './people.ts'

/** The kind of one roster participant. */
/** 名册参与者的一种类别。 */
export type ParticipantKind = 'human' | 'agent'

/** The fixed participant id of the host's own human. */
/** 宿主自身人类的固定参与者 id。 */
export const OWNER_PARTICIPANT_ID = 'human:owner'

/**
 * The synthesized workspace agent backing channel conversations that name no
 * preset: its sessions are created without `agentPreset`, so the deployment
 * persona answers — exactly the pre-redesign behavior, now expressed as a
 * participant.
 * 合成的工作区智能体，为未指名 preset 的渠道会话兜底：它的会话不带 `agentPreset` 创建，
 * 由部署人格作答——正是重设计前的行为，如今以参与者的身份表达。
 */
export const DEFAULT_AGENT_PARTICIPANT_ID = 'agent:default'

/** The participant id of the preset-backed agent for one preset. */
/** 一个 preset 对应的 preset 智能体参与者 id。 */
export function agentParticipantId(presetId: string): string {
  return `agent:${presetId}`
}

/** The participant id of the rostered external human behind one person row. */
/** 一行人员档案背后的外部人类参与者 id。 */
export function humanParticipantId(personId: string): string {
  return `human:${personId}`
}

/** One roster entry the workspace config declares. */
/** 工作区配置声明的一条名册条目。 */
export interface ImRosterEntry {
  /** The DSH preset that is this agent's persona, model, and engine. */
  /** 作为该智能体人格、模型与引擎的 DSH preset。 */
  readonly presetId: string
  /** Display name overriding the preset id in prompts and the panel. */
  /** 在 prompt 与面板里替代 preset id 的展示名。 */
  readonly name?: string
  /** One sentence on what this agent is for, straight from the preset. */
  /** 一句话说明这个智能体用来做什么，来自 preset。 */
  readonly description?: string
}

/** One participant as every consumer sees it. */
/** 每个消费方看到的参与者视图。 */
export interface ImParticipantView {
  readonly id: string
  readonly kind: ParticipantKind
  readonly displayName: string
  /** Present exactly on preset-backed agents. */
  /** 仅 preset 智能体携带。 */
  readonly presetId?: string
  /**
   * Extra names a message may address this participant by (localized names the
   * panel shows, for example). Mention routing accepts them exactly like the
   * display name.
   * 消息可以用这些额外名字点名该参与者（例如面板显示的本地化名字）；提及路由把它们
   * 与展示名同等对待。
   */
  readonly aliases?: readonly string[]
  /** One sentence on what this agent is for (preset-backed agents only). */
  /** 一句话说明这个智能体的用途（仅 preset 智能体携带）。 */
  readonly description?: string
}

/** Options for the roster. */
/** 名册的构造选项。 */
export interface ImParticipantsOptions {
  /** Config-declared agents; an empty roster leaves only the default agent. */
  /** 配置声明的智能体；空名册只留下默认智能体。 */
  readonly roster: readonly ImRosterEntry[]
  /** Display name of the owner human. */
  /** 所有者人类的展示名。 */
  readonly ownerName: string
  /** The people directory, backing external-human resolution. */
  /** 人员目录，支撑外部人类解析。 */
  readonly people: ImPeople
  /** Extra names the default agent answers to (localized mention names). */
  /** 默认智能体额外应答的名字（本地化提及名）。 */
  readonly defaultAgentAliases?: readonly string[]
  /**
   * Agents discovered after construction — the deployment's DSH presets, which
   * the loader may mount later than this roster. Read on every lookup so the
   * roster never freezes a half-loaded registry.
   * 构造之后才发现的智能体——部署里的 DSH preset，loader 可能比本名册更晚挂载它们。
   * 每次查询都重新读取，名册不会冻结在一份半加载的注册表上。
   */
  readonly discoveredAgents?: () => readonly ImRosterEntry[]
}

/** The participant roster service. */
/** 参与者名册服务。 */
export class ImParticipants {
  /**
   * @param options - roster entries, owner name, and the people directory.
   */
  constructor(private readonly options: ImParticipantsOptions) {}

  /** Every agent view: the default one, configured entries, then discovered presets. */
  /** 全部智能体视图：默认智能体、配置条目，最后是发现到的 preset。 */
  listAgents(): ImParticipantView[] {
    const entries = new Map<string, ImRosterEntry>()
    for (const entry of [...this.options.roster, ...(this.options.discoveredAgents?.() ?? [])]) {
      if (!entries.has(entry.presetId)) entries.set(entry.presetId, entry)
    }
    return [
      {
        id: DEFAULT_AGENT_PARTICIPANT_ID,
        kind: 'agent',
        displayName: 'Assistant',
        aliases: this.options.defaultAgentAliases ?? [],
      },
      ...[...entries.values()].map(entry => ({
        id: agentParticipantId(entry.presetId),
        kind: 'agent' as const,
        displayName: entry.name ?? entry.presetId,
        presetId: entry.presetId,
        ...(entry.description === undefined ? {} : { description: entry.description }),
      })),
    ]
  }

  /** The owner human's view. */
  /** 所有者人类的视图。 */
  owner(): ImParticipantView {
    return { id: OWNER_PARTICIPANT_ID, kind: 'human', displayName: this.options.ownerName }
  }

  /** Every participant: the owner, then the agents. */
  /** 全部参与者：所有者在先，智能体在后。 */
  list(): ImParticipantView[] {
    return [this.owner(), ...this.listAgents()]
  }

  /** Resolve one participant id to its view; `undefined` when unknown. */
  /** 把一个参与者 id 解析成视图；未知时返回 `undefined`。 */
  resolve(id: string): ImParticipantView | undefined {
    const agent = this.listAgents().find(candidate => candidate.id === id)
    if (agent !== undefined) return agent
    if (id === OWNER_PARTICIPANT_ID) return this.owner()
    if (id.startsWith('human:')) return this.humanOf(id.slice('human:'.length))
    return undefined
  }

  /** Resolve an external human by person id through the people directory. */
  /** 经人员目录按 person id 解析外部人类。 */
  humanOf(personId: string): ImParticipantView | undefined {
    const person = this.options.people.person(personId)
    if (person === undefined) return undefined
    return { id: humanParticipantId(personId), kind: 'human', displayName: displayNameOf(person) }
  }
}

/** The roster service token. */
/** 名册服务令牌。 */
export const ImParticipantsToken = defineToken<ImParticipants>('imParticipants')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The participant roster provided by @veren/im. */
    /** 由 @veren/im 提供的参与者名册。 */
    imParticipants: ImParticipants
  }
}

/** The best display name of one person row: real name, then directory name. */
/** 一行人员档案的最佳展示名：真名优先，其次目录名。 */
function displayNameOf(person: ImPersonView): string {
  return person.realName ?? person.displayName
}
