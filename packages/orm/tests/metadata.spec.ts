import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, EntitySchema, ManyToOne, OneToMany, PrimaryGeneratedColumn } from '../src/index.ts'
import '../src/driver/sqlite.ts'

interface Author {
  id?: number
  name: string
  books?: Book[]
}

interface Book {
  id?: number
  title: string
  author?: number | Author
}

const AuthorSchema = new EntitySchema<Author>({
  name: 'Author',
  tableName: 'authors',
  columns: {
    id: { type: 'integer', primary: true, generated: true },
    name: { type: 'varchar', length: 64 },
  },
  relations: {
    books: { type: 'one-to-many', target: 'Book', inverseSide: 'author' },
  },
})

const BookSchema = new EntitySchema<Book>({
  name: 'Book',
  tableName: 'books',
  columns: {
    id: { type: 'integer', primary: true, generated: true },
    title: { type: 'varchar', length: 120 },
  },
  relations: {
    author: { type: 'many-to-one', target: 'Author', inverseSide: 'books', joinColumn: 'author_id', nullable: false },
  },
})

@Entity('legacy')
class Legacy {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @ManyToOne(() => Legacy, (legacy) => legacy.children)
  parent?: Legacy

  @OneToMany(() => Legacy, (legacy) => legacy.parent)
  children?: Legacy[]
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('metadata declarations', () => {
  it('builds an EntitySchema into the same metadata shape as decorators', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [AuthorSchema, BookSchema], synchronize: true })
    await source.initialize()
    sources.push(source)

    expect(source.getMetadata(AuthorSchema).tableName).toBe('authors')
    expect(source.getMetadata('Book').primaryColumn.propertyName).toBe('id')
    expect(source.getMetadata(BookSchema).relationsMap.get('author')?.joinColumns[0]?.databaseName).toBe('author_id')

    const authors = source.getRepository(AuthorSchema)
    const books = source.getRepository(BookSchema)
    const author = await authors.save({ name: 'Ada' })
    await books.save({ title: 'Notes', author: author.id })
    const loaded = await authors.findOne({ where: { id: author.id }, relations: { books: true } })
    expect(loaded?.books).toHaveLength(1)
  })

  it('fails startup when a primary column is missing', () => {
    @Entity('no_primary')
    class NoPrimary {
      @Column({ type: 'varchar', length: 10 })
      name!: string
    }

    const source = new DataSource({ type: 'sqlite', entities: [NoPrimary] })
    return expect(source.initialize()).rejects.toThrow(/no primary column/i)
  })

  it('binds a self-referencing inverse relation without looping forever', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [Legacy], synchronize: true })
    await source.initialize()
    sources.push(source)
    expect(source.getMetadata(Legacy).relationsMap.get('parent')?.inverseRelation?.propertyName).toBe('children')
    expect(source.getMetadata(Legacy).relationsMap.get('children')?.inverseRelation?.propertyName).toBe('parent')
  })
})
