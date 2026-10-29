/** 工具层验收：付费门、key 门、闭环落盘+入库、chroma alpha 探针、错误信封。 */
/** Tool-face acceptance: the paid gate, the key gate, the save+admit loop, the chroma alpha probe, and the error envelope. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEdit, runGenerate, type ImagegenWorld } from '../src/assets.js'
import { resolveConfig } from '../src/config.js'
import { IMAGEGEN_RECORD } from '../src/credential.js'
import { decodePng, encodePng } from '../src/png.js'
import { renderValue } from '../src/result.js'
import { fakeAttachments, fakeCredentials, recordingFetch } from './support/fakes.js'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

let dir: string | undefined

afterEach(() => {
  vi.unstubAllGlobals()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspaceRoot(): string {
  dir = mkdtempSync(join(tmpdir(), 'imagegen-tools-'))
  return dir
}

/** 组装世界替身：临时工作区 + 记录型凭据/附件。Assembles the world stand-in: a temp workspace plus recording credentials/attachments. */
function fakeWorld(overrides: Partial<ImagegenWorld['config']> = {}): ImagegenWorld & { saved: () => number } {
  const root = workspaceRoot()
  const { store, saved } = fakeAttachments()
  const world: ImagegenWorld = {
    config: resolveConfig({ enabled: true, ...overrides }),
    credentials: fakeCredentials(new Map([[IMAGEGEN_RECORD, { kind: 'api-key', key: 'sk-test' }]])),
    attachments: store,
    workspaceOf: sessionId => (sessionId === 'session-1' ? root : undefined),
  }
  return Object.assign(world, { saved: () => saved.length })
}

function fakeFetch(png: Uint8Array) {
  const recorded = recordingFetch(() => new Response(
    JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString('base64') }] }),
    { status: 200 },
  ))
  return recorded
}

/** 造一张红底绿键色小图。Builds a small green-key-on-red image. */
function keyedPng(): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 255
    rgba[offset + 1] = 0
    rgba[offset + 2] = 0
    rgba[offset + 3] = 255
  }
  rgba[4] = 0
  rgba[5] = 255
  rgba[6] = 0 // 像素 (1,0) 是键色 / pixel (1,0) is the key color
  return encodePng({ width: 4, height: 4, rgba })
}

describe('gates', () => {
  it('refuses with IMAGEGEN_DISABLED while the config gate is off', async () => {
    const world = fakeWorld({ enabled: false })
    await expect(runGenerate(world, 'session-1', { prompt: 'a mug' })).rejects.toMatchObject({
      code: 'IMAGEGEN_DISABLED',
    })
  })

  it('refuses with IMAGEGEN_NO_KEY when signed out', async () => {
    const world = fakeWorld()
    world.credentials = fakeCredentials(new Map())
    await expect(runGenerate(world, 'session-1', { prompt: 'a mug' })).rejects.toMatchObject({
      code: 'IMAGEGEN_NO_KEY',
    })
  })

  it('refuses an empty prompt before any network call', async () => {
    const world = fakeWorld()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(runGenerate(world, 'session-1', { prompt: '   ' })).rejects.toMatchObject({
      code: 'IMAGEGEN_PROMPT_EMPTY',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a relative path without a workspace', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    await expect(runGenerate(world, undefined, { prompt: 'a mug', outputPath: 'img/hero.png' })).rejects.toMatchObject({
      code: 'IMAGEGEN_NO_WORKSPACE',
    })
  })
})

describe('generate loop', () => {
  it('writes the file, admits the bytes, and returns the saved value', async () => {
    const world = fakeWorld()
    const { fetch, calls } = fakeFetch(keyedPng())
    vi.stubGlobal('fetch', fetch)
    const value = await runGenerate(world, 'session-1', { prompt: 'a red square', outputPath: 'out/hero.png' })
    expect(value.kind).toBe('saved')
    expect(value.path).toBe(join(world.workspaceOf('session-1')!, 'out', 'hero.png'))
    expect(existsSync(value.path)).toBe(true)
    expect(value.attachment.attachmentId).toBeTypeOf('string')
    expect(value.width).toBe(4)
    expect(value.height).toBe(4)
    expect(world.saved()).toBe(1)
    expect(calls[0]?.url).toContain('/images/generations')
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body).toMatchObject({ prompt: 'a red square', model: 'gpt-image-2', quality: 'low' })
  })

  it('derives a -v2 sibling instead of overwriting', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    const first = await runGenerate(world, 'session-1', { prompt: 'p', outputPath: 'hero.png' })
    const second = await runGenerate(world, 'session-1', { prompt: 'p', outputPath: 'hero.png' })
    expect(second.path).toBe(join(world.workspaceOf('session-1')!, 'hero-v2.png'))
    expect(readFileSync(first.path)).toBeDefined()
  })

  it('honors absolute output paths even without a workspace session', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    const absolute = join(world.workspaceOf('session-1')!, 'elsewhere.png')
    const value = await runGenerate(world, undefined, { prompt: 'p', outputPath: absolute })
    expect(value.path).toBe(absolute)
  })
})

describe('chroma loop', () => {
  it('converts the key color to real alpha and forces png', async () => {
    const world = fakeWorld()
    const { fetch, calls } = fakeFetch(keyedPng())
    vi.stubGlobal('fetch', fetch)
    const value = await runGenerate(world, 'session-1', {
      prompt: 'a red square on green',
      outputPath: 'cutout',
      chromaKey: '#00ff00',
    })
    expect(value.kind).toBe('saved')
    expect(value.path.endsWith('.png')).toBe(true)
    expect(value.chroma).toMatchObject({ key: '#00ff00', transparent: 1, total: 16 })
    const decoded = decodePng(new Uint8Array(readFileSync(value.path)))
    // alpha 探针：键色像素必须真透明 / the alpha probe: the key pixel must be truly transparent
    expect(decoded.rgba[7]).toBe(0)
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body.output_format).toBe('png')
  })

  it('fails loudly when no pixel matched the key', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    await expect(runGenerate(world, 'session-1', { prompt: 'p', chromaKey: '#0000ff' })).rejects.toMatchObject({
      code: 'IMAGEGEN_CHROMA_FAILED',
    })
  })
})

describe('edit loop', () => {
  it('reads input images from the workspace and calls the edits endpoint', async () => {
    const world = fakeWorld()
    const root = world.workspaceOf('session-1')!
    writeFileSync(join(root, 'room.png'), Buffer.from(keyedPng()))
    const recorded = recordingFetch(() => new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from(keyedPng()).toString('base64') }] }),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', recorded.fetch)
    const value = await runEdit(world, 'session-1', {
      prompt: 'remove the chair',
      inputPaths: ['room.png'],
    })
    expect(value.kind).toBe('saved')
    expect(recorded.calls[0]?.url).toContain('/images/edits')
    const form = recorded.calls[0]?.init.body as FormData
    expect(form.get('prompt')).toBe('remove the chair')
  })

  it('reports missing input files with a stable code', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    await expect(runEdit(world, 'session-1', { prompt: 'p', inputPaths: ['missing.png'] })).rejects.toMatchObject({
      code: 'IMAGEGEN_INPUT_FILE_MISSING',
    })
  })
})

describe('render projection', () => {
  it('turns a saved value into text plus a durable image block', async () => {
    const world = fakeWorld()
    vi.stubGlobal('fetch', fakeFetch(keyedPng()).fetch)
    const value = await runGenerate(world, 'session-1', { prompt: 'p', outputPath: 'r.png' })
    if (value.kind !== 'saved') throw new Error('expected saved')
    const blocks = renderValue({}, value)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(blocks[1]).toMatchObject({ type: 'image', attachment: { attachmentId: value.attachment.attachmentId } })
  })

  it('turns an error value into a single text block', () => {
    const blocks = renderValue({}, { kind: 'error', code: 'IMAGEGEN_DISABLED', message: 'off' })
    expect(blocks).toHaveLength(1)
    expect(JSON.parse((blocks[0] as { text: string }).text)).toMatchObject({ kind: 'error', code: 'IMAGEGEN_DISABLED' })
  })
})

describe('credential record', () => {
  it('scopes the record to the plugin name', () => {
    expect(credentialKey('imagegen', 'account')).toBe(IMAGEGEN_RECORD)
  })
})
