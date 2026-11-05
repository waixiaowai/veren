import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../src/index.ts'
import { createD1Client, type D1DatabaseLike, type D1PreparedStatementLike } from '../src/driver/d1.ts'

@Entity('notes')
class Note {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 120 })
  body!: string
}

/** 用 node:sqlite 模拟一个 D1 绑定，证明 D1 适配器没有 Node 依赖。 / Emulate a D1 binding with node:sqlite to prove the adapter has no Node dependency. */
class FakeD1Statement implements D1PreparedStatementLike {
  constructor(
    private readonly statement: StatementSync,
    private readonly values: readonly unknown[] = [],
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new FakeD1Statement(this.statement, values)
  }

  async all(): Promise<{ results?: readonly Record<string, unknown>[] }> {
    return { results: this.statement.all(...this.values as never[]) }
  }

  async run(): Promise<{ meta?: { changes?: number; last_row_id?: number } }> {
    const result = this.statement.run(...this.values as never[])
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  }
}

class FakeD1 implements D1DatabaseLike {
  private readonly database = new DatabaseSync(':memory:')

  prepare(sql: string): D1PreparedStatementLike {
    return new FakeD1Statement(this.database.prepare(sql))
  }
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('cloudflare d1 entry', () => {
  it('runs the whole read/write path through an injected fetch-runtime client', async () => {
    const source = new DataSource({
      type: 'd1',
      client: createD1Client(new FakeD1()),
      entities: [Note],
      synchronize: true,
    })
    await source.initialize()
    sources.push(source)

    const notes = source.getRepository(Note)
    const saved = await notes.save({ body: 'edge' } as Note)
    expect(saved.id).toBe(1)
    expect((await notes.find())[0]?.body).toBe('edge')
  })

  it('rejects explicit transactions because D1 does not support them', async () => {
    const source = new DataSource({ type: 'd1', client: createD1Client(new FakeD1()), entities: [Note] })
    await source.initialize()
    sources.push(source)
    await expect(source.transaction(async () => undefined)).rejects.toThrow(/not supported/)
  })
})
