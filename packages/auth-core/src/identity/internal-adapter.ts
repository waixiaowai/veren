/**
 * 身份域内部适配层：主体、账号绑定与校验凭据的唯一读写权威
 * （设计文档 modules/05-identity.md §5.3）。
 * 绑定先行：主体解析先按 (providerId, accountId)，邮箱只是回落；
 * 孤儿绑定显式返回；注册与建绑同一事务；邮箱入库与查询前统一小写。
 *
 * The identity internal adapter: the sole read/write authority for users,
 * account bindings and verifications (design modules/05-identity.md §5.3).
 * Binding first: resolution looks up (providerId, accountId) before email;
 * orphan bindings surface explicitly; registration and first binding share
 * one transaction; emails lowercase before storage and lookup.
 *
 * @module @veren/auth-core/identity/internal-adapter
 */

import { randomUUID } from 'node:crypto'
import type { DBAdapter, DBSchema } from '../storage/adapter.ts'
import type { AccountRow, UserRow, VerificationRow } from '../types.ts'

/** 数据钩子面（装配域收集后传入）。 / The database-hook face (collected by the context domain). */
export interface InternalAdapterHooks {
  user?: {
    create?: { before?: (data: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
    update?: { before?: (data: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
  }
  session?: {
    create?: { before?: (session: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
  }
}

/** 身份域查询产物：主体 + 全部绑定。 / The identity lookup result: user plus all bindings. */
export interface UserWithAccounts {
  user: UserRow
  accounts: AccountRow[]
}

/** 身份域内部适配层。 / The identity internal adapter. */
export interface InternalAdapter {
  /** 建档；钩子可改写建档数据。 / Create a user; hooks may rewrite the data. */
  createUser(data: Partial<UserRow>, trx?: DBAdapter): Promise<UserRow>
  /** 建绑定。 / Create an account binding. */
  createAccount(data: Omit<AccountRow, 'id' | 'createdAt' | 'updatedAt'>, trx?: DBAdapter): Promise<AccountRow>
  /** 按邮箱取主体与绑定（小写归一）。 / Fetch user + bindings by email (lowercased). */
  findUserByEmail(email: string): Promise<UserWithAccounts | null>
  /** 按主键取主体。 / Fetch a user by primary key. */
  findUserById(userId: string): Promise<UserRow | null>
  /** 绑定先行查询：命中绑定但主体缺失返回 'orphaned'。 / Binding-first lookup; 'orphaned' when the binding lacks its user. */
  findAccountOwner(providerId: string, accountId: string): Promise<UserRow | 'orphaned' | null>
  /** 主体档案更新。 / Update the user row. */
  updateUser(userId: string, data: Partial<UserRow>): Promise<UserRow | null>
  /** 绑定更新（如换绑令牌）。 / Update a binding (e.g. token refresh). */
  updateAccount(accountId: string, data: Partial<AccountRow>): Promise<AccountRow | null>
  /** 删除主体及其绑定（外键级联）。 / Delete the user and bindings (cascade). */
  deleteUser(userId: string): Promise<void>
  /** 注册 + 首绑定同一事务（铁律 4）。 / Register + first binding in one transaction (iron rule 4). */
  registerWithAccount(user: Partial<UserRow>, account: Omit<AccountRow, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<{ user: UserRow, account: AccountRow }>
  /** 签发校验凭据。 / Create a verification row. */
  createVerification(data: { identifier: string, value: string, expiresAt: Date }): Promise<VerificationRow>
  /** 按标识符读校验凭据。 / Find a verification by identifier. */
  findVerification(identifier: string): Promise<VerificationRow | null>
  /** 原子核销校验凭据：过期返回 'expired'，并发只有一方成功。 / Atomically consume a verification; 'expired' when past due, concurrency yields one winner. */
  consumeVerification(identifier: string): Promise<VerificationRow | 'expired' | null>
}

/** 行读写便捷门面：一个 DBAdapter 上的身份域专用操作。 / A small facade over one DBAdapter with identity-specific operations. */
class IdentityStore {
  constructor(
    private readonly db: DBAdapter,
    private readonly hooks: InternalAdapterHooks,
    private readonly tables: DBSchema,
  ) {}

  async findUserByEmail(email: string): Promise<UserWithAccounts | null> {
    const user = await this.db.findOne<UserRow>({ model: 'user', where: [{ field: 'email', value: email.toLowerCase() }] })
    if (user === null) return null
    const accounts = await this.db.findMany<AccountRow>({ model: 'account', where: [{ field: 'userId', value: user.id }] })
    return { user, accounts }
  }

  async findAccountOwner(providerId: string, accountId: string): Promise<UserRow | 'orphaned' | null> {
    const binding = await this.db.findOne<AccountRow>({
      model: 'account',
      where: [{ field: 'providerId', value: providerId }, { field: 'accountId', value: accountId }],
    })
    if (binding === null) return null
    const user = await this.db.findOne<UserRow>({ model: 'user', where: [{ field: 'id', value: binding.userId }] })
    return user ?? 'orphaned'
  }

  async createUser(data: Partial<UserRow>, trx?: DBAdapter): Promise<UserRow> {
    const db = trx ?? this.db
    const before = this.hooks.user?.create?.before
    const seeded: Record<string, unknown> = { emailVerified: false, image: null, ...data }
    if (seeded.id === undefined || seeded.id === null) seeded.id = randomUUID()
    const prepared = before === undefined ? seeded : (await before(seeded)) || seeded
    return db.create<UserRow>({ model: 'user', data: prepared, forceAllowId: true })
  }
}

/** 导出便捷门面类型（装配域重建 internalAdapter 时复用）。 / Export the store type for context-side rebuilds. */
export { IdentityStore }

/**
 * 装配内部适配层：`tables` 只用于模型名校验（存储域不解释字段）。
 * / Assemble the internal adapter; `tables` only serves model-name checks
 * (the storage domain interprets nothing).
 */
export function createInternalAdapter(db: DBAdapter, options: {
  hooks?: InternalAdapterHooks
  tables: DBSchema
}): InternalAdapter {
  const store = new IdentityStore(db, options.hooks ?? {}, options.tables)
  return {
    createUser: (data, trx) => store.createUser(data, trx),
    createAccount: (data, trx) => createAccountRow(trx ?? db, data),
    findUserByEmail: (email) => store.findUserByEmail(email),
    findUserById: async (userId) => db.findOne<UserRow>({ model: 'user', where: [{ field: 'id', value: userId }] }),
    findAccountOwner: (providerId, accountId) => store.findAccountOwner(providerId, accountId),
    updateUser: (userId, data) => updateUserRow(db, options.hooks, userId, data),
    updateAccount: (accountId, data) => updateAccountRow(db, accountId, data),
    deleteUser: async (userId) => {
      await db.deleteMany({ model: 'account', where: [{ field: 'userId', value: userId }] })
      await db.deleteMany({ model: 'session', where: [{ field: 'userId', value: userId }] })
      await db.delete({ model: 'user', where: [{ field: 'id', value: userId }] })
    },
    registerWithAccount: (user, account) => registerInTransaction(db, store, user, account),
    createVerification: (data) => createVerificationRow(db, data),
    findVerification: async (identifier) => db.findOne<VerificationRow>({ model: 'verification', where: [{ field: 'identifier', value: identifier }] }),
    consumeVerification: (identifier) => consumeVerificationRow(db, identifier),
  }
}

/** 建绑定行。 / Create a binding row. */
async function createAccountRow(db: DBAdapter, data: Omit<AccountRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<AccountRow> {
  return db.create<AccountRow>({ model: 'account', data: { ...data, id: randomUUID() }, forceAllowId: true })
}

/** 主体档案更新：钩子先行，命中零行返回 null。 / Update the user row: hooks first, null on zero match. */
async function updateUserRow(db: DBAdapter, hooks: InternalAdapterHooks | undefined, userId: string, data: Partial<UserRow>): Promise<UserRow | null> {
  const before = hooks?.user?.update?.before
  const prepared = before === undefined ? data : (await before({ ...data, id: userId })) || data
  const { id: _ignored, ...update } = prepared as Partial<UserRow>
  return db.update<UserRow>({ model: 'user', where: [{ field: 'id', value: userId }], update })
}

/** 绑定更新。 / Update a binding. */
async function updateAccountRow(db: DBAdapter, accountId: string, data: Partial<AccountRow>): Promise<AccountRow | null> {
  const { id: _ignored, ...update } = data as Partial<AccountRow>
  return db.update<AccountRow>({ model: 'account', where: [{ field: 'id', value: accountId }], update })
}

/** 注册 + 首绑定同一事务：中断无半状态（铁律 4）。 / Register + first binding in one transaction: no half state on interruption (iron rule 4). */
async function registerInTransaction(db: DBAdapter, store: IdentityStore, user: Partial<UserRow>, account: Omit<AccountRow, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<{ user: UserRow, account: AccountRow }> {
  return db.transaction(async (trx) => {
    const createdUser = await store.createUser(user, trx)
    const createdAccount = await trx.create<AccountRow>({
      model: 'account',
      data: { ...account, userId: createdUser.id, id: randomUUID() },
      forceAllowId: true,
    })
    return { user: createdUser, account: createdAccount }
  })
}

/** 签发校验凭据行。 / Create a verification row. */
async function createVerificationRow(db: DBAdapter, data: { identifier: string, value: string, expiresAt: Date }): Promise<VerificationRow> {
  return db.create<VerificationRow>({ model: 'verification', data: { ...data, id: randomUUID() }, forceAllowId: true })
}

/** 原子核销：过期即删返 'expired'，重复核销只有一方成功（存储域决策 2）。 / Atomic consume: expired rows delete and answer 'expired'; double consumption yields one winner (storage decision 2). */
async function consumeVerificationRow(db: DBAdapter, identifier: string): Promise<VerificationRow | 'expired' | null> {
  const row = await db.findOne<VerificationRow>({ model: 'verification', where: [{ field: 'identifier', value: identifier }] })
  if (row === null) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete({ model: 'verification', where: [{ field: 'identifier', value: identifier }] })
    return 'expired'
  }
  const consumed = await db.consumeOne<VerificationRow>({ model: 'verification', where: [{ field: 'identifier', value: identifier }] })
  return consumed
}
