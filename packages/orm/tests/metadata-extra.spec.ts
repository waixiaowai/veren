import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  CreateDateColumn,
  DataSource,
  DeleteDateColumn,
  Entity,
  EntityPropertyNotFoundError,
  EntitySchema,
  getMetadataArgsStorage,
  Index,
  InvalidMetadataError,
  JoinColumn,
  JoinTable,
  ManyToMany,
  MetadataArgsStorage,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity({ name: 'meta_users' })
class MetaUser {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32, name: 'display_name' })
  @Index('meta_users_name_idx')
  @Unique()
  name!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  @DeleteDateColumn()
  deletedAt?: Date | null

  @OneToOne(() => MetaProfile, (profile) => profile.user)
  profile?: MetaProfile
}

@Entity('meta_profiles')
class MetaProfile {
  @PrimaryGeneratedColumn()
  id!: number

  @OneToOne(() => MetaUser, (user) => user.profile)
  @JoinColumn({ name: 'user_ref', referencedColumnName: 'id' })
  user!: MetaUser
}

@Entity('meta_left')
class MetaLeft {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToMany(() => MetaRight, (right) => right.lefts)
  @JoinTable({ name: 'meta_links', joinColumn: 'left_key', inverseJoinColumn: 'right_key' })
  rights?: MetaRight[]
}

@Entity('meta_right')
class MetaRight {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToMany(() => MetaLeft, (left) => left.rights)
  lefts?: MetaLeft[]
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('decorator metadata', () => {
  it('registers column roles, names, indices and one-to-one joins', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [MetaUser, MetaProfile], synchronize: true })
    await source.initialize()
    sources.push(source)

    const user = source.getMetadata(MetaUser)
    expect(user.columnsMap.get('name')?.databaseName).toBe('display_name')
    expect(user.indices.map((index) => index.name)).toContain('meta_users_name_idx')
    expect(user.uniques.map((index) => index.properties)).toContainEqual(['name'])
    expect(user.createDateColumn?.propertyName).toBe('createdAt')
    expect(user.updateDateColumn?.propertyName).toBe('updatedAt')
    expect(user.deleteDateColumn?.propertyName).toBe('deletedAt')
    expect(user.relationsMap.get('profile')?.inverseRelation?.propertyName).toBe('user')

    const profile = source.getMetadata(MetaProfile)
    const join = profile.relationsMap.get('user')?.joinColumns[0]
    expect(join?.databaseName).toBe('user_ref')
    expect(profile.relationsMap.get('user')?.isOwning).toBe(true)

    const saved = await source.getRepository(MetaUser).save({ name: 'Ada' } as MetaUser)
    await source.getRepository(MetaProfile).save({ user: saved } as MetaProfile)
    const loaded = await source.getRepository(MetaProfile).findOne({ where: { id: 1 }, relations: { user: true } })
    expect(loaded?.user?.name).toBe('Ada')
  })

  it('honors JoinTable overrides', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [MetaLeft, MetaRight], synchronize: true })
    await source.initialize()
    sources.push(source)
    const relation = source.getMetadata(MetaLeft).relationsMap.get('rights')
    expect(relation?.junctionEntityMetadata?.tableName).toBe('meta_links')
    expect(relation?.junctionEntityMetadata?.columns.map((column) => column.databaseName)).toEqual(['left_key', 'right_key'])
  })
})

describe('EntitySchema surface', () => {
  it('exposes name, target and tableName and builds indices/relations', async () => {
    class SchemeTarget {
      id!: number
      name!: string
    }

    const target = new EntitySchema<{ id?: number; name: string; owner?: unknown; peers?: unknown[] }>({
      name: 'SchemaThing',
      tableName: 'schema_things',
      target: SchemeTarget,
      columns: {
        id: { type: 'integer', primary: true, generated: true },
        name: { type: 'varchar', length: 16 },
      },
      relations: {
        owner: { type: 'many-to-one', target: 'SchemaThing', joinColumn: 'owner_id', referencedColumnName: 'id', nullable: true },
        peers: { type: 'many-to-many', target: 'SchemaThing', joinTableName: 'schema_thing_peers', joinTableColumn: 'thing_id', inverseJoinTableColumn: 'peer_id' },
      },
      indices: [{ name: 'schema_things_name_idx', columns: ['name'] }],
      uniques: [{ name: 'schema_things_name_uq', columns: ['name'] }],
    })
    expect(target.name).toBe('SchemaThing')
    expect(target.tableName).toBe('schema_things')
    expect(target.target).toBe(SchemeTarget)

    const source = new DataSource({ type: 'sqlite', entities: [target], synchronize: true })
    await source.initialize()
    sources.push(source)
    const metadata = source.getMetadata(target)
    expect(metadata.indices.map((index) => index.name)).toContain('schema_things_name_idx')
    expect(metadata.uniques.map((index) => index.name)).toContain('schema_things_name_uq')
    expect(metadata.relationsMap.get('owner')?.joinColumns[0]?.databaseName).toBe('owner_id')
    expect(metadata.relationsMap.get('peers')?.junctionEntityMetadata?.tableName).toBe('schema_thing_peers')
  })
})

describe('metadata validation', () => {
  it('rejects undecorated classes, missing inverse sides and nullable primaries', async () => {
    class NoEntity {
      id!: number
    }
    await expect(new DataSource({ type: 'sqlite', entities: [NoEntity] }).initialize()).rejects.toBeInstanceOf(InvalidMetadataError)

    @Entity('bad_owners')
    class BadOwner {
      @PrimaryGeneratedColumn()
      id!: number

      @OneToOne(() => BadTarget, 'missing')
      target?: BadTarget
    }

    @Entity('bad_targets')
    class BadTarget {
      @PrimaryGeneratedColumn()
      id!: number
    }

    await expect(new DataSource({ type: 'sqlite', entities: [BadOwner, BadTarget] }).initialize()).rejects.toBeInstanceOf(InvalidMetadataError)

    @Entity('nullable_primary')
    class NullablePrimary {
      @PrimaryColumn({ type: 'integer', nullable: true })
      id!: number
    }

    await expect(new DataSource({ type: 'sqlite', entities: [NullablePrimary] }).initialize()).rejects.toBeInstanceOf(InvalidMetadataError)
  })

  it('rejects duplicate tables, unknown index columns and unknown string targets', async () => {
    @Entity('duplicate_table')
    class DuplicateA {
      @PrimaryGeneratedColumn()
      id!: number
    }

    @Entity('duplicate_table')
    class DuplicateB {
      @PrimaryGeneratedColumn()
      id!: number
    }

    await expect(new DataSource({ type: 'sqlite', entities: [DuplicateA, DuplicateB] }).initialize()).rejects.toThrow(/registered more than once/)

    @Entity('bad_index')
    @Index(['missing'])
    class BadIndex {
      @PrimaryGeneratedColumn()
      id!: number

      @Column({ type: 'varchar', length: 8, nullable: true })
      name?: string
    }

    await expect(new DataSource({ type: 'sqlite', entities: [BadIndex] }).initialize()).rejects.toBeInstanceOf(EntityPropertyNotFoundError)
    await expect(new DataSource({ type: 'sqlite', entities: ['NoSuchClass'] }).initialize()).rejects.toBeInstanceOf(InvalidMetadataError)
  })

  it('keeps the global argument storage mount idempotent and clearable', () => {
    const storage = getMetadataArgsStorage()
    expect(getMetadataArgsStorage()).toBe(storage)
    expect(storage.tables.length).toBeGreaterThan(0)
    const scratch = new MetadataArgsStorage()
    scratch.clear()
    expect(scratch.tables).toEqual([])
    expect(scratch.columns).toEqual([])
    expect(scratch.relations).toEqual([])
  })
})
