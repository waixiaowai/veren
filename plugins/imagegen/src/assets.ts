/**
 * 资产编排：wire 字节 → 可选 chroma 透明化 → 工作区落盘（永不覆盖）→
 * attachment 服务入库 → 规范成功值。闭环的承重段——生成的图同时活在
 * 文件系统（项目资产）与会话（可回看、可被 vision 模型复审）。
 * Asset orchestration: wire bytes → optional chroma transparency → workspace
 * save (never overwriting) → attachment admission → the canonical success
 * value. The load-bearing span of the loop — a generated image lives in both
 * the filesystem (a project asset) and the session (reviewable, and by vision
 * models).
 *
 * @module @veren/imagegen
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { basename } from 'node:path'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.js'
import { parseHexColor, removeChromaKey } from './chroma.js'
import { requireStoredKey } from './credential.js'
import { ImagegenError } from './errors.js'
import { avoidCollision } from './naming.js'
import { decodePng, encodePng } from './png.js'
import type { SavedValue } from './result.js'
import { validateRequest, type RequestFace } from './validate.js'
import { editImage, generateImage, type WireClient } from './wire.js'

/** 编排依赖：配置 + 凭据 + 附件库 + 会话工作区解析。 */
/** Orchestration dependencies: config, credentials, the attachment store, and session workspace resolution. */
export interface ImagegenWorld {
  readonly config: ResolvedConfig
  readonly credentials: CredentialProvider
  readonly attachments: AttachmentStore
  /** 调用会话所在工作区的目录；无工作区回答 undefined。The calling session's workspace directory; undefined when none. */
  readonly workspaceOf: (sessionId: SessionId | undefined) => string | undefined
}

/** 一次调用的公共入参面。The common argument face of one call. */
export interface CommonArgs {
  readonly model?: string
  readonly size?: string
  readonly quality?: 'low' | 'medium' | 'high' | 'auto'
  readonly outputFormat?: 'png' | 'webp' | 'jpeg'
  /** API 背景控制（legacy 模型可真透明；gpt-image-2 拒绝 transparent）。 */
  /** The API background control (legacy models can be truly transparent; gpt-image-2 refuses transparent). */
  readonly background?: 'transparent' | 'opaque' | 'auto'
  /** 编辑输入保真度（gpt-image-2 恒为 high，不收此参）。 */
  /** The edit input fidelity (gpt-image-2 is always high and refuses this). */
  readonly inputFidelity?: 'low' | 'high'
  readonly outputPath?: string
  readonly chromaKey?: string
}

/** 付费门：未开启即响亮拒绝，给出开启路径。The paid gate: refuse loudly when off, naming how to turn it on. */
export function ensureEnabled(config: ResolvedConfig): void {
  if (!config.enabled) {
    throw new ImagegenError('IMAGEGEN_DISABLED',
      'image generation is disabled in this deployment; ask the user to enable it in the imagegen plugin config (paid API calls)')
  }
}

/**
 * key 解析序：配置里的 apiKey（部署显式声明，优先）→ 凭据记录（登录流
 * 所存）。两处都没有就是响亮的 IMAGEGEN_NO_KEY，不静默、不回退。
 * The key resolution order: the config apiKey (explicit deployment intent,
 * wins) → the credential record (stored by the sign-in flow). Neither present
 * is a loud IMAGEGEN_NO_KEY — no silent fallback.
 */
export async function resolveApiKey(world: ImagegenWorld): Promise<string> {
  if (world.config.apiKey !== undefined && world.config.apiKey.length > 0) {
    return world.config.apiKey
  }
  return requireStoredKey(world.credentials)
}

/** 组装 wire 客户端。Builds the wire client. */
export function wireClientOf(world: ImagegenWorld, apiKey: string): WireClient {
  return {
    baseURL: world.config.baseURL,
    apiKey,
    timeoutMs: world.config.requestTimeoutMs,
    maxAttempts: world.config.maxAttempts,
    fetch: globalThis.fetch,
  }
}

/** 解析请求面缺省值。Resolves request-face defaults. */
export function requestFaceOf(world: ImagegenWorld, args: CommonArgs): RequestFace {
  return {
    model: args.model ?? world.config.model,
    size: args.size ?? 'auto',
    quality: args.quality ?? 'low',
    outputFormat: args.outputFormat ?? 'png',
    ...(args.background === undefined ? {} : { background: args.background }),
    ...(args.inputFidelity === undefined ? {} : { inputFidelity: args.inputFidelity }),
  }
}

/**
 * 解析落盘绝对路径：相对路径以会话工作区为基准；无工作区且相对 → 响亮
 * IMAGEGEN_NO_WORKSPACE（fail loud，不猜 CWD）。
 * Resolves the absolute save path: relative paths resolve against the calling
 * session's workspace; no workspace plus a relative path → loud
 * IMAGEGEN_NO_WORKSPACE (fail loud, never guess a CWD).
 */
export function resolveSavePath(world: ImagegenWorld, sessionId: SessionId | undefined, outputPath: string | undefined, format: string): string {
  const extension = format === 'jpeg' ? '.jpg' : `.${format}`
  const workspace = world.workspaceOf(sessionId)
  if (outputPath === undefined) {
    if (workspace === undefined) {
      throw new ImagegenError('IMAGEGEN_NO_WORKSPACE', 'the calling session has no workspace; pass an absolute outputPath')
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return avoidCollision(resolve(workspace, 'imagegen', `generated-${stamp}${extension}`))
  }
  if (isAbsolute(outputPath)) return avoidCollision(applyExtension(outputPath, extension))
  if (workspace === undefined) {
    throw new ImagegenError('IMAGEGEN_NO_WORKSPACE', `relative outputPath "${outputPath}" needs a workspace session; pass an absolute path instead`)
  }
  return avoidCollision(applyExtension(resolve(workspace, outputPath), extension))
}

/** 扩展名与输出格式对齐（错扩展名就地纠正，内容类型永不与扩展名背离）。 */
/** Aligns the extension with the output format (a wrong extension is corrected in place; content type never contradicts the name). */
function applyExtension(path: string, extension: string): string {
  return path.toLowerCase().endsWith(extension) ? path : `${path}${extension}`
}

/**
 * 字节后处理：chromaKey 给定时解码 → 去键 → 重编码 PNG（真 alpha），
 * 并返回 chroma 统计；否则原字节直通。
 * Byte post-processing: with a chromaKey, decode → remove the key → re-encode
 * PNG (real alpha) and return the stats; otherwise the bytes pass through.
 */
export function postProcess(bytes: Uint8Array, chromaKey: string | undefined): { bytes: Uint8Array; chroma?: SavedValue['chroma'] } {
  if (chromaKey === undefined) return { bytes }
  const raster = decodePng(bytes)
  const result = removeChromaKey(raster, { key: parseHexColor(chromaKey) })
  if (result.transparent === 0) {
    throw new ImagegenError('IMAGEGEN_CHROMA_FAILED',
      `no pixel matched the chroma key ${chromaKey}; generate on a flat key-color background first`)
  }
  return {
    bytes: encodePng(result.image),
    chroma: { key: chromaKey, transparent: result.transparent, total: raster.width * raster.height },
  }
}

/** 落盘：建目录、写字节。Saves to disk: create the directory, write the bytes. */
export async function writeToDisk(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

/**
 * 组装规范成功值并把字节送进 attachment 库：尺寸/字节数/媒体类型取自
 * 入库引用——那是服务对存储字节的验证结果，插件不重复解码。
 * Assembles the canonical success value and admits the bytes into the
 * attachment store: dimensions, byte count, and media type come from the
 * admitted ref — the service's verification of the stored bytes, so this
 * module never re-decodes.
 */
export async function admissionValue(
  world: ImagegenWorld, path: string, bytes: Uint8Array, mediaType: string, model: string, prompt: string,
  chroma?: SavedValue['chroma'],
): Promise<SavedValue> {
  const ref = await world.attachments.saveImage({ data: bytes, mediaType: mediaType as 'image/png', name: basename(path) })
  return {
    kind: 'saved',
    path,
    width: ref.width,
    height: ref.height,
    bytes: ref.bytes,
    mediaType: ref.mediaType,
    attachment: ref,
    model,
    prompt,
    ...(chroma === undefined ? {} : { chroma }),
  }
}

/** 读取编辑输入图；缺失即响亮 IMAGEGEN_INPUT_FILE_MISSING。 */
/** Reads an edit input image; a miss is a loud IMAGEGEN_INPUT_FILE_MISSING. */
export async function readInputImage(path: string): Promise<{ bytes: Uint8Array; name: string }> {
  try {
    return { bytes: await readFile(path), name: basename(path) }
  } catch {
    throw new ImagegenError('IMAGEGEN_INPUT_FILE_MISSING', `input image not found: ${path}`, { path })
  }
}

/** 前置闸门：校验矩阵 + prompt 非空 + 键色可解析（全部在付费调用之前 fail loud）。 */
/** The front gate: validation matrix, non-empty prompt, and a parseable key color — all fail loud before the paid call. */
export function gateRequest(face: RequestFace, prompt: string, chromaKey?: string): void {
  if (prompt.trim().length === 0) {
    throw new ImagegenError('IMAGEGEN_PROMPT_EMPTY', 'prompt must not be empty')
  }
  validateRequest(face)
  if (chromaKey !== undefined) parseHexColor(chromaKey)
}

/** base64 → 字节。base64 → bytes. */
function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
}

/**
 * 生成流：付费门 → key → 校验 → wire → 可选 chroma（强制 PNG）→ 落盘 →
 * 入库 → 规范值。任何一步的抛出由工具层折成规范错误值。
 * The generation flow: paid gate → key → validation → wire → optional chroma
 * (forcing PNG) → save → admit → canonical value. Any step's throw is folded
 * into a canonical error value by the tool layer.
 */
export async function runGenerate(
  world: ImagegenWorld, sessionId: SessionId | undefined, args: CommonArgs & { readonly prompt: string }, signal?: AbortSignal,
): Promise<SavedValue> {
  ensureEnabled(world.config)
  const chroma = args.chromaKey !== undefined
  const format = chroma ? 'png' : args.outputFormat ?? 'png'
  const face: RequestFace = { ...requestFaceOf(world, args), outputFormat: format }
  gateRequest(face, args.prompt, args.chromaKey)
  const client = wireClientOf(world, await resolveApiKey(world))
  const result = await generateImage(client, { ...face, prompt: args.prompt }, signal)
  const processed = postProcess(decodeBase64(result.b64Json), args.chromaKey)
  const path = resolveSavePath(world, sessionId, args.outputPath, format)
  await writeToDisk(path, processed.bytes)
  const mediaType = chroma || format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg'
  return admissionValue(world, path, processed.bytes, mediaType, face.model, args.prompt, processed.chroma)
}

/** 编辑输入：路径 → 字节面；相对路径以会话工作区为基准。 */
/** The edit input: paths → byte faces; relative paths resolve against the session's workspace. */
async function editInputs(world: ImagegenWorld, sessionId: SessionId | undefined, paths: readonly string[]): Promise<Array<{ bytes: Uint8Array; name: string }>> {
  const workspace = world.workspaceOf(sessionId)
  return Promise.all(paths.map(path => readInputImage(againstWorkspace(workspace, path))))
}

/** 相对路径按工作区解析（绝对路径原样）。Resolves a relative path against the workspace (absolute passes through). */
function againstWorkspace(workspace: string | undefined, path: string): string {
  if (isAbsolute(path) || workspace === undefined) return path
  return resolve(workspace, path)
}

/**
 * 编辑流：与生成流同链，只是 wire 换 edits 端点并带输入图（可选蒙版）。
 * The edit flow: the same chain as generation with the edits endpoint and
 * input images (optional mask).
 */
export async function runEdit(
  world: ImagegenWorld, sessionId: SessionId | undefined,
  args: CommonArgs & { readonly prompt: string; readonly inputPaths: readonly string[]; readonly maskPath?: string },
  signal?: AbortSignal,
): Promise<SavedValue> {
  ensureEnabled(world.config)
  const chroma = args.chromaKey !== undefined
  const format = chroma ? 'png' : args.outputFormat ?? 'png'
  const face: RequestFace = { ...requestFaceOf(world, args), outputFormat: format }
  gateRequest(face, args.prompt, args.chromaKey)
  const client = wireClientOf(world, await resolveApiKey(world))
  const workspace = world.workspaceOf(sessionId)
  const result = await editImage(client, {
    model: face.model,
    prompt: args.prompt,
    images: await editInputs(world, sessionId, args.inputPaths),
    ...(args.maskPath === undefined ? {} : { mask: await readInputImage(againstWorkspace(workspace, args.maskPath)) }),
    size: face.size,
    ...(face.background === undefined ? {} : { background: face.background }),
    ...(face.inputFidelity === undefined ? {} : { inputFidelity: face.inputFidelity }),
  }, signal)
  const processed = postProcess(decodeBase64(result.b64Json), args.chromaKey)
  const path = resolveSavePath(world, sessionId, args.outputPath, format)
  await writeToDisk(path, processed.bytes)
  const mediaType = chroma || format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg'
  return admissionValue(world, path, processed.bytes, mediaType, face.model, args.prompt, processed.chroma)
}
