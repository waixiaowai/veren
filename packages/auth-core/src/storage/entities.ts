/**
 * 表模型 → @veren/orm EntitySchema：存储域模型定义到物理实体的唯一投影。
 * 逻辑字段名是仓储读写面；主键为调用方生成的字符串（上下文装配域的
 * generateId）；唯一索引与复合唯一按模型定义落地，名称可移植。
 *
 * Table models → @veren/orm EntitySchema: the single projection from storage
 * models to physical entities. Logical field names are the repository
 * surface; primary keys are caller-generated strings (the context domain's
 * generateId); unique and composite indexes land per the model definition
 * with portable names.
 *
 * @module @veren/auth-core/storage/entities
 */

import { EntitySchema } from '@veren/orm'
import type { ColumnType, EntitySchemaIndexOptions } from '@veren/orm'
import type { DBFieldAttribute, DBSchema, DBTableIndex } from './adapter.ts'

/** 逻辑类型 → 物理列类型。 / Logical type → physical column type. */
const COLUMN_TYPES: Record<DBFieldAttribute['type'], ColumnType> = {
  string: 'text',
  number: 'integer',
  boolean: 'boolean',
  date: 'datetime',
}

/** 表级索引声明（结构子集，便于跨模型复用）。 / The table-index declaration subset. */
type IndexDeclaration = Pick<DBTableIndex, 'fields' | 'name' | 'unique'>

/** 索引名：显式声明优先，否则按模型 + 序号派生可移植名。 / Index name: declared wins, else portable model + ordinal. */
function indexNameFor(model: string, index: IndexDeclaration, ordinal: number): string {
  return index.name ?? `auth_${model}_${String(ordinal).padStart(2, '0')}_${index.unique === true ? 'uniq' : 'idx'}`
}

/** 单表模型 → EntitySchema。 / One table model → an EntitySchema. */
function toEntitySchema(model: string, table: {
  modelName: string
  fields: Record<string, DBFieldAttribute>
  indexes?: readonly IndexDeclaration[]
}): EntitySchema<object> {
  const columns: Record<string, {
    type: ColumnType
    primary?: boolean
    unique?: boolean
    nullable?: boolean
  }> = {}
  for (const [field, attr] of Object.entries(table.fields)) {
    columns[field] = {
      type: COLUMN_TYPES[attr.type],
      primary: field === 'id',
      unique: attr.unique === true,
      nullable: attr.required === false && field !== 'id',
    }
  }
  const indices: EntitySchemaIndexOptions[] = (table.indexes ?? []).map((index, ordinal) => ({
    name: indexNameFor(model, index, ordinal),
    columns: [...index.fields],
    unique: index.unique === true,
  }))
  return new EntitySchema({ name: model, tableName: table.modelName, columns, indices })
}

/** 全部表模型 → EntitySchema 列表（按 order 装配）。 / All table models → the EntitySchema list (assembled by order). */
export function createAuthEntities(tables: DBSchema): EntitySchema<object>[] {
  return Object.entries(tables)
    .sort((left, right) => (left[1].order ?? 99) - (right[1].order ?? 99))
    .map(([model, table]) => toEntitySchema(model, table))
}
