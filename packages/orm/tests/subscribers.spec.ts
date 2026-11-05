import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  type EntitySubscriberInterface,
  type InsertEvent,
  type RemoveEvent,
  type UpdateEvent,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('audited')
class Audited {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string
}

/** 录制事件顺序的订阅者。 / A subscriber that records event order. */
class RecordingSubscriber implements EntitySubscriberInterface<Audited> {
  readonly calls: string[] = []

  listenTo(): Function {
    return Audited
  }

  beforeInsert(event: InsertEvent<Audited>): void {
    this.calls.push(`beforeInsert:${event.entity.name}`)
  }

  afterInsert(event: InsertEvent<Audited>): void {
    this.calls.push(`afterInsert:${event.entity.id}`)
  }

  beforeUpdate(event: UpdateEvent<Audited>): void {
    this.calls.push(`beforeUpdate:${event.updatedColumns.map((column) => column.propertyName).join(',')}`)
  }

  afterUpdate(event: UpdateEvent<Audited>): void {
    this.calls.push(`afterUpdate:${event.entity.name}`)
  }

  beforeRemove(event: RemoveEvent<Audited>): void {
    this.calls.push(`beforeRemove:${event.entity.id}`)
  }

  afterRemove(event: RemoveEvent<Audited>): void {
    this.calls.push(`afterRemove:${event.entity.id}`)
  }
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('subscribers', () => {
  it('broadcasts insert/update/remove events in order', async () => {
    const subscriber = new RecordingSubscriber()
    const source = new DataSource({ type: 'sqlite', entities: [Audited], subscribers: [subscriber], synchronize: true })
    await source.initialize()
    sources.push(source)
    const repository = source.getRepository(Audited)

    const entity = await repository.save({ name: 'first' } as Audited)
    entity.name = 'second'
    await repository.save(entity)
    await repository.remove(entity)

    expect(subscriber.calls).toEqual([
      'beforeInsert:first',
      'afterInsert:1',
      'beforeUpdate:name',
      'afterUpdate:second',
      'beforeRemove:1',
      'afterRemove:1',
    ])
  })

  it('skips every listener when listeners is false', async () => {
    const subscriber = new RecordingSubscriber()
    const source = new DataSource({ type: 'sqlite', entities: [Audited], subscribers: [subscriber], synchronize: true })
    await source.initialize()
    sources.push(source)
    const repository = source.getRepository(Audited)
    await repository.save({ name: 'quiet' } as Audited, { listeners: false })
    expect(subscriber.calls).toEqual([])
  })
})
