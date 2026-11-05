import { describe, expect, it } from 'vitest'
import { DefaultNamingStrategy, shortHash, snakeCase } from '../src/index.ts'

describe('naming strategy', () => {
  it('converts camelCase, PascalCase and acronym runs to snake_case', () => {
    expect(snakeCase('createdAt')).toBe('created_at')
    expect(snakeCase('HTTPServer')).toBe('http_server')
    expect(snakeCase('user-ID')).toBe('user_id')
    expect(snakeCase('already_snake')).toBe('already_snake')
  })

  it('produces deterministic short hashes', () => {
    expect(shortHash('abc')).toHaveLength(8)
    expect(shortHash('abc')).toBe(shortHash('abc'))
    expect(shortHash('abc')).not.toBe(shortHash('abd'))
  })

  it('derives every name deterministically', () => {
    const strategy = new DefaultNamingStrategy()
    expect(strategy.tableName('UserProfile')).toBe('user_profile')
    expect(strategy.tableName('UserProfile', 'people')).toBe('people')
    expect(strategy.columnName('createdAt')).toBe('created_at')
    expect(strategy.columnName('name', undefined, ['user', 'profile'])).toBe('user_profile_name')
    expect(strategy.columnName('name', 'display_name', ['user'])).toBe('user_display_name')
    expect(strategy.relationName('UserPosts')).toBe('user_posts')
    expect(strategy.primaryKeyName('users', ['id'])).toBe('users_id_pk')
    expect(strategy.uniqueConstraintName('users', ['email'])).toBe('users_email_uq')
    expect(strategy.foreignKeyName('posts', ['author_id'], 'users', ['id'])).toContain('posts_author_id_users_id_fk')
    expect(strategy.indexName('users', ['name'])).toBe('users_name_idx')
    expect(strategy.indexName('users', ['name'], 'lower(name)')).toContain('_idx_')
    expect(strategy.checkConstraintName('users', 'len(name) > 0')).toContain('_chk')
    expect(strategy.joinColumnName('author', 'id')).toBe('author_id')
    expect(strategy.joinTableName('posts', 'tags', 'tags')).toBe('posts_tags_tags')
    expect(strategy.joinTableColumnName('posts', 'id')).toBe('posts_id')
    expect(strategy.joinTableInverseColumnName('tags', 'id')).toBe('tags_id')
    expect(strategy.prefixTableName('app_', 'users')).toBe('app_users')
    expect(strategy.nestedSetColumnNames).toEqual({ left: 'nsleft', right: 'nsright' })
    expect(strategy.materializedPathColumnName).toBe('mpath')
  })

  it('truncates oversized identifiers with a stable hash suffix', () => {
    const strategy = new DefaultNamingStrategy()
    const name = strategy.indexName('t'.repeat(80), ['c'.repeat(80)], 'where')
    expect(name.length).toBeLessThanOrEqual(63)
    expect(strategy.indexName('t'.repeat(80), ['c'.repeat(80)], 'where')).toBe(name)
    expect(name).not.toBe(strategy.indexName('t'.repeat(80), ['c'.repeat(80)], 'other'))
  })
})
