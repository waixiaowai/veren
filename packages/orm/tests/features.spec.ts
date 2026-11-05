import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  CreateDateColumn,
  DataSource,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
  type EntityTarget,
  type MigrationInterface,
  type QueryRunner,
  type SqlClient,
} from '../src/index.ts'
import { createNodeSqliteClient } from '../src/driver/node-sqlite-client.ts'
import '../src/driver/sqlite.ts'

@Entity('teams')
class Team {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @OneToMany(() => Player, (player) => player.team, { cascade: ['remove'] })
  players?: Player[]
}

@Entity('players')
class Player {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @ManyToOne(() => Team, (team) => team.players, { cascade: ['insert', 'update'] })
  team!: Team

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  @DeleteDateColumn()
  deletedAt?: Date | null

  @VersionColumn()
  version!: number
}

@Entity('members')
class Member {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @ManyToMany(() => Tag, (tag) => tag.members, { cascade: true })
  @JoinTable()
  tags?: Tag[]
}

@Entity('tags')
class Tag {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32, unique: true })
  label!: string

  @ManyToMany(() => Member, (member) => member.tags)
  members?: Member[]
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 计数客户端：只统计主链查询，用于幂等断言。 / Counting client for idempotency assertions. */
function countingClient(): { client: SqlClient; reset: () => void; count: () => number; log: string[] } {
  const inner = createNodeSqliteClient(new DatabaseSync(':memory:'))
  let queries = 0
  const log: string[] = []
  return {
    client: {
      async query(sql, parameters) {
        queries += 1
        log.push(sql)
        return inner.query(sql, parameters)
      },
      async close() {
        await inner.close?.()
      },
    },
    reset: () => { queries = 0; log.length = 0 },
    count: () => queries,
    log,
  }
}

/** 建一个带同步的内存数据源。 / Build a synchronized in-memory source. */
async function createSource(entities: readonly EntityTarget[], client?: SqlClient): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities, client, synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

describe('lifecycle features', () => {
  it('cascades one-to-many inserts, updates and removes', async () => {
    const source = await createSource([Team, Player])
    const teams = source.getRepository(Team)
    const players = source.getRepository(Player)

    const team = await teams.save({ name: 'Reds' } as Team)
    const player = await players.save({ name: 'Ada', team } as Player)
    expect(player.team).toEqual(team)
    const loaded = await teams.findOne({ where: { id: team.id }, relations: { players: true } })
    expect(loaded?.players).toHaveLength(1)
    expect(loaded?.players?.[0]?.name).toBe('Ada')
    expect(player.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(player.version).toBe(1)

    await teams.remove(team)
    expect(await players.count()).toBe(0)
  })

  it('soft deletes, filters and recovers', async () => {
    const source = await createSource([Team, Player])
    const players = source.getRepository(Player)
    const teams = source.getRepository(Team)
    const team = await teams.save({ name: 'Blues' } as Team)
    const player = await players.save({ name: 'Bob', team } as Player)

    await players.softRemove(player)
    expect(await players.count()).toBe(0)
    expect(await players.count({ withDeleted: true })).toBe(1)
    await players.recover(player)
    expect(await players.count()).toBe(1)
  })

  it('syncs many-to-many junction rows in both directions', async () => {
    const source = await createSource([Member, Tag])
    const members = source.getRepository(Member)
    const tags = source.getRepository(Tag)

    const saved = await members.save({ name: 'Cid', tags: [{ label: 'red' }, { label: 'blue' }] } as unknown as Member)
    const loaded = await members.findOne({ where: { id: saved.id }, relations: { tags: true } })
    expect(saved.tags).toHaveLength(2)
    expect(loaded?.tags?.map((tag) => tag.label).sort()).toEqual(['blue', 'red'])
    const tag = await tags.findOne({ where: { label: 'red' }, relations: { members: true } })
    expect(tag?.members?.map((item) => item.name)).toEqual(['Cid'])
  })

  it('skips SQL on a repeated unchanged save', async () => {
    const counter = countingClient()
    const source = await createSource([Team], counter.client)
    const teams = source.getRepository(Team)
    const team = await teams.save({ name: 'Greens' } as Team)
    counter.reset()
    await teams.save(team)
    const statements = counter.log.filter((sql) => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql))
    expect(statements).toHaveLength(1) // 仅基线查询，零写入 / baseline read only, no write
  })

  it('round-trips a version column and rejects a stale write', async () => {
    const source = await createSource([Team, Player])
    const teams = source.getRepository(Team)
    const players = source.getRepository(Player)
    const team = await teams.save({ name: 'Gold' } as Team)
    const player = await players.save({ name: 'Dee', team } as Player)
    const stale = await players.findOne({ where: { id: player.id } })

    player.name = 'Dee II'
    await players.save(player)
    stale!.name = 'Stale'
    await expect(players.save(stale!)).rejects.toThrow(/Version mismatch/)
  })

  it('runs and reverts versioned migrations', async () => {
    class CreateWidgets1710000000001 implements MigrationInterface {
      async up(runner: QueryRunner): Promise<void> {
        await runner.query('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)')
      }

      async down(runner: QueryRunner): Promise<void> {
        await runner.query('DROP TABLE widgets')
      }
    }

    const source = new DataSource({ type: 'sqlite', migrations: [CreateWidgets1710000000001], migrationsTableName: 'migrations' })
    await source.initialize()
    sources.push(source)
    const applied = await source.runMigrations()
    expect(applied).toHaveLength(1)
    expect((await source.showMigrations())[0]?.id).toBe(1)
    await source.undoLastMigration()
    expect((await source.showMigrations())[0]?.id).toBeUndefined()
  })
})
