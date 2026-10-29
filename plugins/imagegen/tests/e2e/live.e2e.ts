/**
 * 真实 API e2e：一次 generate 全链（付费调用）。无凭据自跳过——
 * `IMAGEGEN_E2E_KEY` 或 `OPENAI_API_KEY` 任一存在才运行。
 * Real-API e2e: one full generate loop (a paid call). Self-skips without
 * credentials — runs only when `IMAGEGEN_E2E_KEY` or `OPENAI_API_KEY` exists.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGenerate, type ImagegenWorld } from '../../src/assets.js'
import { resolveConfig } from '../../src/config.js'
import { IMAGEGEN_RECORD } from '../../src/credential.js'
import { decodePng } from '../../src/png.js'
import { fakeAttachments, fakeCredentials } from '../support/fakes.js'
import { readFileSync } from 'node:fs'

const KEY = process.env.IMAGEGEN_E2E_KEY ?? process.env.OPENAI_API_KEY
const BASE_URL = process.env.IMAGEGEN_E2E_BASE_URL ?? 'https://api.openai.com/v1'
const MODEL = process.env.IMAGEGEN_E2E_MODEL ?? 'gpt-image-2'

describe.skipIf(KEY === undefined || KEY.length === 0)('live image generation', () => {
  it('generates one real image and saves it into the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'imagegen-e2e-'))
    try {
      const { store, saved } = fakeAttachments()
      const world: ImagegenWorld = {
        config: { ...resolveConfig({ enabled: true }), baseURL: BASE_URL, model: MODEL },
        credentials: fakeCredentials(new Map([[IMAGEGEN_RECORD, { kind: 'api-key', key: KEY as string }]])),
        attachments: store,
        workspaceOf: () => root,
      }
      const value = await runGenerate(world, undefined, {
        prompt: 'a single plain red circle centered on a plain white background, flat vector style',
        size: '1024x1024',
        quality: 'low',
        outputPath: 'circle.png',
      })
      expect(value.kind).toBe('saved')
      expect(existsSync(value.path)).toBe(true)
      expect(saved).toHaveLength(1)
      const decoded = decodePng(new Uint8Array(readFileSync(value.path)))
      expect(decoded.width).toBeGreaterThan(0)
      expect(decoded.height).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 240_000)
})
