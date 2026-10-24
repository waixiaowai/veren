/**
 * Votes: one attitude per preset per subject, switchable, never doubled.
 *
 * The uniqueness rule lives in the key, not in a check: `<kind>:<id>:<actor>`
 * is the only row a given preset can hold for a given subject, so clicking the
 * same button twice removes that one row, and clicking the other button
 * overwrites it. Counters are derived from the table on every read rather than
 * stored, which makes a double count structurally impossible.
 *
 * 投票：每个预设对每个对象只有一种态度，可改主意，绝不重复叠加。
 *
 * 唯一性规则写在键里而不是靠检查：`<种类>:<id>:<操作者>` 是某个预设对某个对象唯一能持有的
 * 行，因此同一按钮点两次只删除这一行，点另一个按钮只覆盖这一行。计数每次读取时从表里派生
 * 而不存储，因此重复叠加在结构上就不可能发生。
 *
 * @module @veren/forum/votes
 */

import type { VoteRecord, VoteValue } from './domain.ts'
import type { ForumStore, ForumTables } from './storage.ts'
import { view } from './storage.ts'
import { voteKey } from './ids.ts'
import type { SubjectCounters } from './types.ts'
import { requirePost } from './posts.ts'
import { requireComment } from './comments.ts'

/** The vote table, ready to use. */
export interface VoteTables {
  readonly votes: ReturnType<typeof view<VoteRecord>>
}

/**
 * Project the domain's vote table.
 * @param domain - the opened forum domain.
 * @returns the vote table.
 */
export function voteTablesOf(domain: ForumStore): VoteTables {
  return { votes: view(domain.table('votes')) }
}

/** Totals plus the reading preset's own attitude. */
export interface VoteTotals extends SubjectCounters {
  readonly up: number
  readonly down: number
}

/**
 * Fold every vote on one subject into totals and the reader's attitude.
 * @param tables - the vote table.
 * @param subjectKind - whether the subject is a post or a comment.
 * @param subjectId - the subject's id.
 * @param reader - the preset whose attitude is reported, when one is named.
 * @returns the totals; `up` and `down` are zero when nobody voted.
 */
export function totalsFor(
  tables: VoteTables, subjectKind: 'post' | 'comment', subjectId: string, reader?: string,
): VoteTotals {
  let up = 0
  let down = 0
  let myVote: VoteValue | undefined
  for (const vote of tables.votes.all()) {
    if (vote.subjectKind !== subjectKind || vote.subjectId !== subjectId) continue
    if (vote.value === 'up') up += 1
    else down += 1
    if (reader !== undefined && vote.actor === reader) myVote = vote.value
  }
  return { up, down, ...myVote === undefined ? {} : { myVote } }
}

/**
 * Build a counter lookup bound to one reading preset.
 * @param tables - the vote table.
 * @param reader - the preset whose attitudes are reported.
 * @returns a function the post and comment projections can call.
 */
export function counterLookup(
  tables: VoteTables, reader?: string,
): (subjectKind: 'post' | 'comment', subjectId: string) => SubjectCounters {
  return (subjectKind, subjectId) => totalsFor(tables, subjectKind, subjectId, reader)
}

/**
 * Record one preset's attitude toward one subject.
 *
 * Passing the value the preset already holds clears it, which is how a reader
 * takes back a click; passing the other value switches the same row.
 * @param tables - the vote table.
 * @param subjectKind - whether the subject is a post or a comment.
 * @param subjectId - the subject's id.
 * @param actor - the voting preset.
 * @param value - the attitude the click expresses.
 * @param now - ISO instant stamped on the row.
 * @returns the totals after the write, plus whether the attitude was cleared.
 */
export async function castVote(
  tables: VoteTables,
  subjectKind: 'post' | 'comment',
  subjectId: string,
  actor: string,
  value: VoteValue,
  now: string,
): Promise<{ readonly totals: VoteTotals; readonly cleared: boolean }> {
  const key = voteKey(subjectKind, subjectId, actor)
  const current = tables.votes.get(key)
  if (current !== undefined && current.value === value) {
    await tables.votes.del(key)
    return { totals: totalsFor(tables, subjectKind, subjectId, actor), cleared: true }
  }
  await tables.votes.put(key, { id: key, subjectKind, subjectId, actor, value, updatedAt: now })
  return { totals: totalsFor(tables, subjectKind, subjectId, actor), cleared: false }
}

/**
 * Guard the subject, record one preset's attitude, and flatten the totals.
 *
 * The Remote surface's vote path: the subject must exist (post or comment),
 * and the caller reads flat counters, not the cast result's shape.
 * 守卫对象、记录一个预设的态度，并把计数摊平。远端面的投票路径：对象必须存在
 * （帖子或评论），调用方读取的是摊平的计数，不是投票结果的原始形状。
 * @param tables - every forum table (the guards read the post and comment tables).
 * @param votes - the vote table.
 * @param subjectKind - whether the subject is a post or a comment.
 * @param subjectId - the subject's id.
 * @param actor - the voting preset.
 * @param value - the attitude the click expresses.
 * @param now - ISO instant stamped on the row.
 * @returns the flat totals after the write, plus whether the attitude was cleared.
 */
export async function castSubjectVote(
  tables: ForumTables, votes: VoteTables, subjectKind: 'post' | 'comment', subjectId: string,
  actor: string, value: VoteValue, now: string,
): Promise<{ readonly up: number; readonly down: number; readonly cleared: boolean }> {
  if (subjectKind === 'post') requirePost(tables, subjectId)
  else requireComment(tables, subjectId)
  const result = await castVote(votes, subjectKind, subjectId, actor, value, now)
  return { up: result.totals.up, down: result.totals.down, cleared: result.cleared }
}
