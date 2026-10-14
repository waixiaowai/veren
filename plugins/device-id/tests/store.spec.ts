/**
 * Unit tests for the device-id store and the deterministic id mapping.
 * 设备 ID 存储与确定性 ID 映射的单元测试。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashToUuid } from '../src/service.js';
import { parseRecord, readStoreFile, writeStoreFile, defaultStoreFile } from '../src/store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseRecord', () => {
  it('accepts a well-formed record | 接受合法记录', () => {
    const rec = parseRecord({ id: '123e4567-e89b-42d3-a456-426614174000', fingerprints: ['ab'], createdAt: 1, updatedAt: 2 });
    expect(rec?.id).toBe('123e4567-e89b-42d3-a456-426614174000');
  });

  it('rejects a corrupt record | 拒绝损坏记录', () => {
    expect(parseRecord({ id: 'not-an-id' })).toBeNull();
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord('x')).toBeNull();
  });
});

describe('store file roundtrip | 存储文件往返', () => {
  it('read after write returns the same id | 写后读 ID 一致（需求：多次生成不变）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'device-id-'));
    dirs.push(dir);
    const file = join(dir, 'device-id.json');
    const rec = { id: '123e4567-e89b-42d3-a456-426614174000', fingerprints: [], createdAt: 1, updatedAt: 1 };
    writeStoreFile(file, rec);
    expect(readStoreFile(file)?.id).toBe(rec.id);
    expect(readStoreFile(join(dir, 'missing.json'))).toBeNull();
  });

  it('a corrupt file reads as absent | 损坏文件按不存在处理', () => {
    const dir = mkdtempSync(join(tmpdir(), 'device-id-'));
    dirs.push(dir);
    const file = join(dir, 'device-id.json');
    writeStoreFile(file, { id: 'x', fingerprints: [], createdAt: 1, updatedAt: 1 });
    expect(readStoreFile(file)).toBeNull();
  });
});

describe('hashToUuid | 指纹映射', () => {
  it('is deterministic and uuid-shaped | 确定性且呈 UUID 形状', () => {
    const a = hashToUuid('deadbeef');
    expect(a).toBe(hashToUuid('deadbeef'));
    expect(a).not.toBe(hashToUuid('cafebabe'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('defaultStoreFile | 默认存储路径', () => {
  it('is a non-empty json path | 是非空 json 路径', () => {
    expect(defaultStoreFile()).toMatch(/device-id\.json$/);
  });
});

