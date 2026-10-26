/**
 * Startup consolidation of the people directory: collapse persons that share
 * one provider identity into a single profile.
 *
 * Duplicates are legacy data: before the same-external-id merge fallback
 * existed, a fresh QR authorization minted a new bot account and the same
 * human was recorded again as a new person — and the stranger-intake question
 * was re-asked per copy (live counter-example: one human in three profiles).
 * The runtime fallback only prevents new duplicates, so consolidation repairs
 * the stored ones once per activation, before the directory is read or seeded.
 * It is idempotent: a consolidated directory yields zero groups and no writes.
 *
 * 人员目录的启动期归并：把共享同一 provider 身份的多份档案折叠成一份。
 *
 * 重复档案是存量数据：在同外部 id 归并回退出现之前，一次重新扫码授权会铸造新的 bot 账号，
 * 同一个人就被再次录成新档案——且每份重复档案都会重发一次陌生人采集询问（真机反例：一个人
 * 被录成三份）。运行期回退只能防止新增重复，因此归并在每次激活时、目录被读取或播种之前
 * 修复存量。它是幂等的：已归并的目录产出零个分组、零次写入。
 *
 * @module @veren/im/people-merge
 */

import type { ImLogger } from './runtime-seams.ts'
import type { ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow, ImPersonStore } from './store.ts'

/** One merge group: the surviving profile plus the duplicates it absorbs. */
/** 一个归并组：存活的档案与它吸收的重复档案。 */
interface ImMergeGroup {
  keeper: ImPersonRow
  duplicates: ImPersonRow[]
}

/** Merge duplicate profiles; returns how many duplicates were absorbed. */
/** 归并重复档案；返回被吸收的重复档案数。 */
export async function consolidatePeople(store: ImPersonStore, logger: ImLogger): Promise<number> {
  const groups = mergeGroupsOf(store.people(), store.personAddresses())
  for (const group of groups) await absorbGroup(store, group, logger)
  return groups.reduce((total, group) => total + group.duplicates.length, 0)
}

/**
 * Group people by identity: two profiles are the same human when they own
 * addresses with the same (provider, external id), or when an address-less
 * profile still carries a raw external id as its name (the orphan shape left
 * behind by account removal).
 * 按身份给人分组：两份档案持有相同 (provider, external id) 的地址，或一份无地址档案仍以
 * 裸外部 id 为名字（账号被移除后留下的孤儿形态），即为同一人。
 */
function mergeGroupsOf(people: ImPersonRow[], addresses: ImPersonAddressRow[]): ImMergeGroup[] {
  const groups = new UnionFind()
  const byIdentity = new Map<string, string>()
  const byExternal = new Map<string, string>()
  for (const address of addresses) {
    const identity = `${address.provider}\u0000${address.external_id}`
    const known = byIdentity.get(identity)
    if (known === undefined) byIdentity.set(identity, address.person_id)
    else groups.union(known, address.person_id)
    if (!byExternal.has(address.external_id)) byExternal.set(address.external_id, address.person_id)
  }
  const withAddress = new Set(addresses.map(row => row.person_id))
  for (const row of people) {
    const owner = withAddress.has(row.id) ? undefined : byExternal.get(row.display_name)
    if (owner !== undefined) groups.union(owner, row.id)
  }
  return clusterGroups(people, groups)
}

/** Assemble the union-find result into merge groups of two or more members. */
/** 把并查集结果装配成两个及以上成员的归并组。 */
function clusterGroups(people: ImPersonRow[], groups: UnionFind): ImMergeGroup[] {
  const clusters = new Map<string, ImPersonRow[]>()
  for (const row of people) {
    const root = groups.find(row.id)
    const members = clusters.get(root)
    if (members === undefined) clusters.set(root, [row])
    else members.push(row)
  }
  const result: ImMergeGroup[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) continue
    const keeper = keeperOf(members)
    result.push({ keeper, duplicates: members.filter(row => row.id !== keeper.id) })
  }
  return result
}

/**
 * Pick the surviving profile: authoritative names first, then the self-report,
 * then a human-chosen display name; ties break by recency, then by id, so the
 * choice is deterministic across runs.
 * 挑选存活档案：权威名字优先，其次自述，再次人取的显示名；同分按更新时间、再按 id 决出，
 * 保证跨次运行的选择是确定的。
 */
function keeperOf(members: ImPersonRow[]): ImPersonRow {
  const score = (row: ImPersonRow): number =>
    (row.real_name !== undefined ? 4 : 0) + (row.claim !== undefined ? 2 : 0) + (looksRawId(row) ? 0 : 1)
  return [...members].sort((left, right) =>
    score(right) - score(left) || right.updated_at - left.updated_at || left.id.localeCompare(right.id))[0]!
}

/** Whether the display name is still the raw provider id, so nobody chose it. */
/** 显示名仍是裸 provider id，即还没有人给它取过名字。 */
function looksRawId(row: ImPersonRow): boolean {
  return row.display_name.includes('@')
}

/** Re-point one group's addresses and intake records, then drop the losers. */
/** 把一个组的地址与采集记录改挂到存活档案，然后删除落选者。 */
async function absorbGroup(store: ImPersonStore, group: ImMergeGroup, logger: ImLogger): Promise<void> {
  const keeperId = group.keeper.id
  for (const duplicate of group.duplicates) {
    for (const address of store.personAddresses().filter(row => row.person_id === duplicate.id)) {
      // 地址键不含 person_id：改写 person_id 即原位迁移，不会生成新行。
      // The address key excludes person_id: rewriting it moves the row in place.
      await store.putPersonAddress({ ...address, person_id: keeperId })
    }
  }
  await absorbIntake(store, group)
  for (const duplicate of group.duplicates) await store.deletePerson(duplicate.id)
  logger.info?.(
    `[im:people] consolidated ${group.duplicates.length} duplicate profile(s) into ${keeperId}`,
  )
}

/** Keep the newest intake record of the group on the keeper; drop the rest. */
/** 把组内最新的一条采集记录留给存活档案，其余删除。 */
async function absorbIntake(store: ImPersonStore, group: ImMergeGroup): Promise<void> {
  const rows = [group.keeper.id, ...group.duplicates.map(row => row.id)]
    .map(personId => store.getIntake(personId))
    .filter((row): row is ImPersonIntakeRow => row !== undefined)
  if (rows.length === 0) return
  const keep = [...rows].sort((left, right) => right.asked_at - left.asked_at)[0]!
  for (const row of rows) {
    if (row.person_id !== group.keeper.id) await store.deleteIntake(row.person_id)
  }
  if (keep.person_id !== group.keeper.id) await store.putIntake({ ...keep, person_id: group.keeper.id })
}

/** Union-find over person ids; roots are arbitrary but stable within one pass. */
/** 人员 id 上的并查集；根在单趟内任意但稳定。 */
class UnionFind {
  private readonly parent = new Map<string, string>()

  find(id: string): string {
    let root = id
    for (;;) {
      const parent = this.parent.get(root)
      if (parent === undefined || parent === root) break
      root = parent
    }
    this.parent.set(id, root)
    return root
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot)
  }
}
