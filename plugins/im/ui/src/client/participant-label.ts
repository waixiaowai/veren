/**
 * Participant ids as the panel shows them.
 *
 * The room roster stores ids (`human:owner`, `agent:<presetId>`, `human:<personId>`);
 * the page renders names. This module is the one translation point, so the
 * sidebar, the header, and the timeline never grow their own copies.
 *
 * 面板如何显示参与者 id。
 *
 * 房间名册存的是 id（`human:owner`、`agent:<presetId>`、`human:<personId>`），页面要显示名字。
 * 本模块是唯二翻译点之外的那一处，避免侧栏、页头与时间线各自长出一份。
 *
 * @module @veren/im-ui/client/participant-label
 */

import type { ImKey } from './locales.ts'
import type { ImParticipant, ImPersonView } from './remote.ts'

/** The workspace owner: the panel's fixed viewer in v1. */
export const OWNER_PARTICIPANT = 'human:owner'

/** The synthesized default agent (no preset) answering with the deployment persona. */
export const DEFAULT_AGENT = 'agent:default'

/**
 * Render one participant id as a human name.
 * @param id - roster participant id.
 * @param people - the people directory, for `human:<personId>` members.
 * @param t - locale seat.
 * @param roster - the host roster, whose display names win over derived ones.
 * @returns the display name, falling back to the bare id for unknown forms.
 */
export function participantLabel(
  id: string,
  people: readonly ImPersonView[],
  t: (key: ImKey) => string,
  roster: readonly ImParticipant[] = [],
): string {
  if (id === OWNER_PARTICIPANT) return t('participantOwner')
  if (id === DEFAULT_AGENT) return t('participantAssistant')
  const known = roster.find(candidate => candidate.id === id)
  if (known !== undefined) return known.displayName
  if (id.startsWith('agent:')) return id.slice('agent:'.length)
  if (id.startsWith('human:')) {
    const personId = id.slice('human:'.length)
    const person = people.find(candidate => candidate.id === personId)
    return person?.displayName ?? personId
  }
  return id
}
