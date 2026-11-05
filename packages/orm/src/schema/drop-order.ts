import type { EntityMetadata } from '../metadata/entity-metadata.ts'

/**
 * 计算安全的删表顺序：先删子表，再删被引用的父表。
 * Compute a safe drop order: children first, then the parents they reference.
 *
 * 只考虑本数据源内、带外键列的关系；多对多中间表本身也是独立表，会排在其
 * 父表之前。出现环（自引用/互引用）时保留剩余声明顺序，由方言负责处理。
 *
 * Only relations with foreign-key columns inside this data source are considered;
 * a many-to-many junction is its own table and comes before its parents. Cycles
 * (self or mutual references) keep the remaining declaration order and are left
 * to the dialect.
 */
export function dropOrder(metadatas: readonly EntityMetadata[]): EntityMetadata[] {
  const names = new Set(metadatas.map((metadata) => metadata.tableName))
  const referencedBy = collectReferences(metadatas, names)
  const remaining = new Map(metadatas.map((metadata) => [metadata.tableName, metadata]))
  const ordered: EntityMetadata[] = []
  while (remaining.size > 0) {
    const selected = nextLeaf(remaining, referencedBy)
    if (selected === undefined) {
      ordered.push(...remaining.values())
      break
    }
    ordered.push(selected)
    remaining.delete(selected.tableName)
    releaseReferences(referencedBy, selected.tableName)
  }
  return ordered
}

/** 收集「表 -> 引用它的子表」边。 / Collect "table -> child tables referencing it" edges. */
function collectReferences(
  metadatas: readonly EntityMetadata[],
  names: ReadonlySet<string>,
): Map<string, Set<string>> {
  const referencedBy = new Map<string, Set<string>>()
  for (const metadata of metadatas) referencedBy.set(metadata.tableName, new Set())
  for (const metadata of metadatas) {
    for (const relation of metadata.relations) {
      const target = relation.targetMetadata
      if (target === undefined || relation.joinColumns.length === 0) continue
      if (target.tableName === metadata.tableName || !names.has(target.tableName)) continue
      referencedBy.get(target.tableName)?.add(metadata.tableName)
    }
  }
  return referencedBy
}

/** 找一张没有子表引用的表。 / Pick a table no remaining child references. */
function nextLeaf(
  remaining: ReadonlyMap<string, EntityMetadata>,
  referencedBy: ReadonlyMap<string, ReadonlySet<string>>,
): EntityMetadata | undefined {
  for (const metadata of remaining.values()) {
    if ((referencedBy.get(metadata.tableName)?.size ?? 0) === 0) return metadata
  }
  return undefined
}

/** 移除已删表对其他表的引用。 / Remove the dropped table from every reference set. */
function releaseReferences(referencedBy: Map<string, Set<string>>, tableName: string): void {
  for (const references of referencedBy.values()) references.delete(tableName)
}
