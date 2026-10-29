/**
 * 两个模型工具：`imagegen__generate` 与 `imagegen__edit`。execute 编排
 * （assets.ts），render 投影模型面（result.ts），输出是 oneOf[saved, error]
 * 的规范值——错误走值不走异常，模型读结构化 code 自行纠偏。
 * The two model tools: `imagegen__generate` and `imagegen__edit`. execute
 * orchestrates (assets.ts), render projects the model face (result.ts), and
 * the output is a oneOf[saved, error] canonical value — errors travel as
 * values, not exceptions, so the model reads structured codes and self-corrects.
 *
 * @module @veren/imagegen
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { runEdit, runGenerate, type CommonArgs, type ImagegenWorld } from './assets.js'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { toErrorValue } from './errors.js'
import { pendingCard, renderValue } from './result.js'

/** 参数：两个工具共享的执行面。Parameters: the execution face shared by both tools. */const EXECUTION_PARAMS = {
  model: { type: 'string', description: 'Image model override; default is the deployment-configured model' },
  size: { type: 'string', description: 'Image size: auto, or WIDTHxHEIGHT obeying the model matrix (gpt-image-2: edges multiple of 16px, max edge 3840, ratio <= 3:1)' },
  quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Rendering quality; low suits drafts and iteration, high suits final assets and dense text' },
  output_format: { type: 'string', enum: ['png', 'webp', 'jpeg'], description: 'Output format; png is the default' },
  output_path: { type: 'string', description: 'Where to save inside the workspace (relative) or an absolute path; never overwrites - a collided name becomes name-v2.ext' },
  chroma_key: { type: 'string', description: 'Hex RGB key color (e.g. #00ff00) to convert to transparency after generation; forces png output' },
} as const

/** 编辑专属参数：输入图与蒙版。Edit-only parameters: input images and the mask. */
const EDIT_PARAMS = {
  input_paths: {
    type: 'array', required: true, items: { type: 'string' },
    description: 'Workspace or absolute paths of the images to edit (first is the base)',
  },
  mask_path: { type: 'string', description: 'Optional PNG mask: transparent areas are replaced' },
} as const

/** saved 规范值的 schema 面。The schema face of the saved canonical value. */
const SAVED_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'saved' },
    path: { type: 'string', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    bytes: { type: 'integer', required: true },
    mediaType: { type: 'string', required: true },
    model: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    attachment: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
    chroma: {
      type: 'object', additionalProperties: false,
      properties: {
        key: { type: 'string', required: true },
        transparent: { type: 'integer', required: true },
        total: { type: 'integer', required: true },
      },
    },
  },
} as const

/** 错误规范值的 schema 面（两个工具共用信封）。The error value's schema face (one envelope for both tools). */
const ERROR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'error' },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

/** 输出 = oneOf[saved, error]。The output = oneOf[saved, error]. */
const OUTPUT_SCHEMA = { oneOf: [SAVED_SCHEMA, ERROR_SCHEMA] } as const

/** 工具参数的 wire 形态：schema 键是 snake_case（模型可见）。 */
/** The tool arguments' wire shape: schema keys are snake_case (model-visible). */
interface ToolArgs extends CommonArgs {
  readonly prompt: string
  readonly output_format?: 'png' | 'webp' | 'jpeg'
  readonly output_path?: string
  readonly chroma_key?: string
  readonly input_paths?: readonly string[]
  readonly mask_path?: string
}

/** wire 参数 → 编排参数的映射。Maps wire arguments onto orchestration arguments. */
function orchestrationArgs(args: ToolArgs): CommonArgs & { readonly prompt: string } {
  return {
    prompt: args.prompt,
    model: args.model,
    size: args.size,
    quality: args.quality,
    outputFormat: args.output_format,
    outputPath: args.output_path,
    chromaKey: args.chroma_key,
  }
}

/** 执行包装的共同形态（agent.id 是调用会话，signal 是协作取消）。 */
/** The common shape of the execute wrappers (agent.id is the calling session; signal is cooperative cancellation). */
type ExecFace = { readonly signal: AbortSignal; readonly agent?: { readonly id: SessionId } }

/** 生成工具的 execute 包装：抛出折成规范错误值。The generate execute wrapper: throws fold into canonical error values. */
function generateExecute(world: ImagegenWorld) {
  return async (args: ToolArgs, exec: ExecFace) => {
    try {
      return await runGenerate(world, exec.agent?.id, orchestrationArgs(args), exec.signal)
    } catch (error) {
      return toErrorValue(error)
    }
  }
}

/** 编辑工具的 execute 包装（同信封）。The edit execute wrapper (same envelope). */
function editExecute(world: ImagegenWorld) {
  return async (args: ToolArgs, exec: ExecFace) => {
    try {
      return await runEdit(world, exec.agent?.id, {
        ...orchestrationArgs(args),
        inputPaths: args.input_paths ?? [],
        ...(args.mask_path === undefined ? {} : { maskPath: args.mask_path }),
      }, exec.signal)
    } catch (error) {
      return toErrorValue(error)
    }
  }
}

/**
 * 在当前作用域注册两个工具；逆序清理，随作用域卸载不泄漏。
 * Registers both tools on the calling scope; reverse-order disposal, no leak
 * when the scope unloads.
 */
export function registerImagegenTools(ctx: Context, world: ImagegenWorld): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'imagegen__generate',
      description: 'Generate one raster image with an image model and save it into the workspace. Returns the saved file path plus the image itself so you can inspect it. One call produces one image; request several assets by calling once per asset. For transparency without model support, generate on a flat key-color background and pass chroma_key.',
      parameters: { prompt: { type: 'string', required: true, description: 'The full image prompt: scene, subject, style, composition, lighting, exact quoted text, constraints and avoid list' }, ...EXECUTION_PARAMS },
      output: { schema: OUTPUT_SCHEMA, render: renderValue },
      timeoutMs: 600_000,
      presentCall: args => pendingCard('Generate image', args.prompt),
      execute: generateExecute(world),
    })),
    ctx.tools.register(defineTool({
      name: 'imagegen__edit',
      description: 'Edit existing image files with an image model (inpainting, background replacement, object removal, style transfer, compositing) and save the result into the workspace. Returns the saved path plus the image. State invariants explicitly: change only X, keep Y unchanged.',
      parameters: { prompt: { type: 'string', required: true, description: 'The edit prompt: what to change plus explicit invariants (change only X; keep Y unchanged)' }, ...EDIT_PARAMS, ...EXECUTION_PARAMS },
      output: { schema: OUTPUT_SCHEMA, render: renderValue },
      timeoutMs: 600_000,
      presentCall: args => pendingCard('Edit image', args.prompt),
      execute: editExecute(world),
    })),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
