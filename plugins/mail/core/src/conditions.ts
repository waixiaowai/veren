/**
 * Step condition evaluation.
 *
 * A step's conditions are groups: the groups are OR-ed together, and within
 * a group the conditions are AND-ed. An absent or empty condition list means
 * "always pass" — never "nothing passes", which would silently stop every
 * workflow that did not spell out its conditions.
 *
 * 步骤条件求值。
 *
 * 步骤的条件是组：组与组之间取或，组内条件取与。条件缺省或为空意为「总是通过」——绝不等于
 * 「一律不通过」，否则未写条件的每个工作流都会被无声地停掉。
 *
 * @module @veren/mail/conditions
 */

import type { StepFilter, SubscriberRecord } from './types.ts'

/** What a condition reads its value from. / 条件读取值的来源。 */
export interface ConditionContext {
  /** The business payload. / 业务载荷。 */
  readonly payload: Readonly<Record<string, unknown>>
  /** The recipient, when one is known. / 收件人（已知时）。 */
  readonly subscriber?: SubscriberRecord
  /** The tenant the delivery runs under. / 投递所处的租户。 */
  readonly tenant?: string
  /** What the previous step produced. / 上一步骤的产出。 */
  readonly previousStep?: Readonly<Record<string, unknown>>
}

/**
 * Whether a step's conditions pass.
 *
 * @param filters - the step's conditions; absent or empty means always pass / 步骤的条件；缺省或空即总是通过
 * @param context - what the conditions read / 条件读取的内容
 * @returns whether the step may run / 该步骤是否可运行
 */
export function evaluateConditions(
  filters: readonly StepFilter[] | undefined,
  context: ConditionContext,
): boolean {
  if (filters === undefined || filters.length === 0) return true
  return filters.some((filter) => evaluateOne(filter, context))
}

/**
 * Evaluate one condition.
 *
 * @param filter - the condition / 条件
 * @param context - what the condition reads / 条件读取的内容
 * @returns whether the condition holds / 该条件是否成立
 */
function evaluateOne(filter: StepFilter, context: ConditionContext): boolean {
  const actual = readValue(filter, context)
  if (filter.operator === 'exists') {
    const expected = filter.value === undefined ? true : filter.value === true
    return expected ? actual !== undefined : actual === undefined
  }
  if (actual === undefined) return false
  switch (filter.operator) {
    case 'equals':
      return actual === filter.value
    case 'notEquals':
      return actual !== filter.value
    case 'contains':
      return String(actual).includes(String(filter.value))
    case 'gt':
      return Number(actual) > Number(filter.value)
    case 'lt':
      return Number(actual) < Number(filter.value)
    default:
      return false
  }
}

/**
 * Read the value a condition compares against.
 *
 * @param filter - the condition / 条件
 * @param context - what the condition reads / 条件读取的内容
 * @returns the value, when the source has one / 该来源具备时返回值
 */
function readValue(filter: StepFilter, context: ConditionContext): unknown {
  switch (filter.source) {
    case 'payload':
      return readPath(context.payload, filter.field)
    case 'subscriber':
      return context.subscriber === undefined ? undefined : readPath(context.subscriber, filter.field)
    case 'tenant':
      return context.tenant === undefined ? undefined : readPath(context.tenant, filter.field)
    case 'previousStep':
      return context.previousStep === undefined ? undefined : readPath(context.previousStep, filter.field)
    default:
      return undefined
  }
}

/**
 * Read a dotted path out of a value.
 *
 * @param source - the value to read from / 读取来源
 * @param path - the dotted path / 点分路径
 * @returns the value at that path, when it exists / 该路径上的值（存在时）
 */
function readPath(source: unknown, path: string): unknown {
  if (path === '') return source
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
