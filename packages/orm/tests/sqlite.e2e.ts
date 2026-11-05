import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('e2e_sqlite_notes')
class E2eNote {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 120 })
  body!: string
}

const sources: DataSource[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('sqlite e2e (always runnable)', () => {
  it('persists CRUD on a real file database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'veren-orm-e2e-'))
    directories.push(directory)
    const source = new DataSource({
      type: 'sqlite',
      filename: join(directory, 'e2e.db'),
      entities: [E2eNote],
      synchronize: true,
    })
    await source.initialize()
    sources.push(source)

    const repository = source.getRepository(E2eNote)
    const saved = await repository.save({ body: 'hello' } as E2eNote)
    expect(saved.id).toBe(1)
    expect((await repository.findBy({ id: saved.id }))[0]?.body).toBe('hello')
    saved.body = 'updated'
    await repository.save(saved)
    expect((await repository.findBy({ id: saved.id }))[0]?.body).toBe('updated')
    await repository.remove(saved)
    expect(await repository.count()).toBe(0)
  })
})
