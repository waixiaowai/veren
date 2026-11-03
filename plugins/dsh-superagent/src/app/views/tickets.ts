/** Ticket list, ticket detail, mandate basis formatting, and executor load views. */
import type { TicketFilter } from '../api.ts'
import { liveTicket, threadKey, ticketStage, type AcceptMode, type AdmissionCell, type MandateBasis, type Ticket } from '../../core/index.ts'
import { workerSessionId } from '../../executor/dsh.ts'
import type { Store } from '../store.ts'
import { channelLink, decisionView, newestFirst, page, snapshot, threadSummary, ticketLine, type Snapshot,
  type ViewHost } from './records.ts'
import { markdown, preview } from './text.ts'

export type BasisFact =
  | { name: 'addressed'; value: 'mention' | 'direct' } | { name: 'followup' } | { name: 'admission'; value: AdmissionCell } | { name: 'observation' }
  | { name: 'mode'; value: AcceptMode } | { name: 'rules'; value: { id: string; name: string }[] } | { name: 'sender'; value: string }
  | { name: 'legacyAuthority'; value: string } | { name: 'bot' }
/**
 * Extracts displayable mandate admission facts in reading order (omitting the receiving scope, which is stored
 * only for re-validation), marking pre-scope records that only have `authority` as `legacy`.
 */
export function basisFacts(basis: MandateBasis, rule: Snapshot['rule']): { facts: BasisFact[]; legacy: boolean } {
  const facts: BasisFact[] = []
  if (basis.sender) facts.push({ name: 'sender', value: basis.sender })
  if (basis.via === 'bot') facts.push({ name: 'bot' })
  if (basis.via !== 'followup' && basis.addressed) facts.push({ name: 'addressed', value: basis.addressed })
  // Imported bases already record their follow-up in `authority`.
  if (basis.via === 'followup' && !basis.authority) facts.push({ name: 'followup' })
  if (basis.via === 'admission') facts.push({ name: 'admission', value: basis.cell })
  const observation = basis.via === 'admission' || basis.via === 'listed' || basis.via === 'bot' ? basis.observation : undefined
  // Listed bot messages are inferred candidates regardless of where received, so only the accept mode is shown from `observation`.
  if (observation && basis.via !== 'bot') facts.push({ name: 'observation' })
  if (observation?.mode) facts.push({ name: 'mode', value: observation.mode })
  if (basis.rules?.length) facts.push({ name: 'rules', value: basis.rules.map(rule) })
  const authority = basis.via === 'followup' || basis.via === 'listed' ? basis.authority : undefined
  if (authority) facts.push({ name: 'legacyAuthority', value: authority })
  return { facts, legacy: authority !== undefined }
}
/** Tickets one Execution filter lists: `open` every live Ticket, `ended` the ended set, every other filter one stage. */
/* 单个执行过滤条件下列出的工单：open 是所有存活工单，ended 是已结束集合，其余各按一个阶段。 */
export function ticketsForFilter(store: Store, filter: TicketFilter): Ticket[] {
  // Ended Tickets exist only in `list()`; every other filter reads live Tickets from `open()`.
  /* 已结束工单只存在于 list() 中；其余过滤条件都从 open() 读存活工单。 */
  const source = filter === 'ended' ? store.tickets.list() : store.tickets.open()
  return source.filter(ticket => filter === 'open' ? liveTicket(ticket) : ticketStage(ticket).stage === filter)
}
/** How many Tickets each Execution filter lists, keyed so a new filter cannot be added without a count. */
/* 每个执行过滤条件下的工单条数；新增过滤条件而不补计数会编译失败。 */
export type TicketCounts = Record<TicketFilter, number>
/** Counts the Tickets of every Execution filter from the same predicates that list them. */
/* 用与列表相同的谓词统计每个执行过滤条件下的工单，数字与列表因此不会漂移。 */
export function ticketCounts(store: Store): TicketCounts {
  const count = (filter: TicketFilter) => ticketsForFilter(store, filter).length
  return { open: count('open'), person: count('person'), working: count('working'), idle: count('idle'), ended: count('ended') }
}
export function ticketList(host: ViewHost, filter: TicketFilter, offset: number, limit: number) {
  const view = snapshot(host)
  const { store } = view
  const result = page(ticketsForFilter(store, filter).sort(newestFirst), offset, limit)
  // The rows and every filter's count come from one read, so a rendered number cannot disagree with its list.
  /* 行与所有过滤条件的计数来自同一次读取，渲染出的数字不可能与它的列表对不上。 */
  return { ...result, counts: ticketCounts(store), items: result.items.map(ticket => ticketRow(view, ticket)) }
}
export type TicketListView = ReturnType<typeof ticketList>
export function ticketRow(view: Snapshot, ticket: Ticket) {
  const line = ticketLine(view, ticket)
  const channel = ticket.channels[0]
  const reply = line.stage === 'person' && channel ? channelLink(view, channel) : undefined
  return { ...line, ...reply ? { reply } : {} }
}
/** Executor slot utilization: `running` worker Sessions in an active turn (which occupy slots and are interrupted by a restart), and tickets `queued` for a slot. */
export interface ExecutorLoad { running: number; queued: number }
export function executorLoad(store: Store, running: number): ExecutorLoad {
  // Queued Tickets are the subset of the `working` filter that no worker has taken up yet.
  /* 排队工单是 working 过滤条件里还没有 worker 接手的那部分。 */
  const queued = ticketsForFilter(store, 'working').filter(ticket => { const stage = ticketStage(ticket)
    return stage.stage === 'working' && stage.action === 'queued' }).length
  return { running, queued }
}
export function ticketDetail(host: ViewHost, id: string) {
  const { store } = host
  const ticket = store.tickets.get(id)
  if (!ticket) return undefined
  const view = snapshot(host)
  const { stage } = ticketStage(ticket)
  const decision = store.decisions.get(ticket.decisionId)
  const input = (value: Ticket['inputs'][number]) => {
    const trigger = value.kind === 'trigger' ? store.triggers.get(value.triggerId) : undefined
    const handback = trigger && store.triggers.disposition(trigger.id)?.handbacks?.find(item => item.ticketId === id)
    const shown = trigger && { id: trigger.id, actor: view.actor(trigger.actor, trigger.human), human: trigger.human,
      preview: preview(trigger.text), thread: threadKey(trigger.threads[0]!),
      ...handback ? { handback: { reason: handback.reason, at: handback.at } } : {} }
    const text = (value.kind === 'text' || value.kind === 'note') && value.text ? { text: markdown(value.text) } : {}
    return { ...value, ...text, delivered: !ticket.undelivered.includes(value.id), ...shown ? { trigger: shown } : {} }
  }
  // Pass `human = false` for bot-originated mandates so the Source kind still labels the actor as a bot if removed from the policy list.
  const human = ticket.mandate.basis.via !== 'bot'
  return { ...ticketLine(view, ticket), mandate: { ...ticket.mandate, actor: view.actor(ticket.mandate.actor, human) },
    basis: basisFacts(ticket.mandate.basis, view.rule), paused: store.settings().paused,
    channels: ticket.channels.map(channel => channelLink(view, channel)),
    decision: decision ? decisionView(view, decision) : undefined,
    // Every started Assignment ran in the ticket's one worker Session. A running assignment whose worker reported a non-progress state has finished its turn unless a human response resumed the ticket.
    assignments: ticket.assignments.map(assignment => ({ ...assignment, ...assignment.startedAt ? { ref: workerSessionId(ticket.id) } : {},
      ...assignment.state === 'running' && assignment.report && assignment.report.state !== 'progress' && stage !== 'working'
        ? { turnEndedAt: assignment.report.at } : {} })),
    inputs: ticket.inputs.slice().reverse().map(input),
    // Threads followed for context only (e.g., related issues) grant no authority and are marked with `context: true`.
    threads: view.threadsOf(id).map(thread => ({ ...threadSummary(view, thread),
      ...thread.context?.includes(id) ? { context: true as const } : {} })) }
}
export type TicketDetailView = NonNullable<ReturnType<typeof ticketDetail>>
