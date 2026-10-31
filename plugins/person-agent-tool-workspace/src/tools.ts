// 工具构建器：workspace_create / workspace_rename（只造定义，注册归应用层）。
// Tool builders: workspace_create / workspace_rename (definitions only; registration belongs to the app layer).
import { mkdir, stat } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferArgs, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 workspaceRegistry 的 Context 声明合并与 WorkspaceId 品牌。
// Type-only imports: pull the workspaceRegistry Context declaration merging and the WorkspaceId brand.
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceToolError,
  requireTitle,
} from './types.js'

/** 工具描述里对使用边界的提示，两个工具共用。 */
/** The usage-boundary hint shared by both tool descriptions. */
const HINT =
  'Workspace ids appear in the page\'s Workspace List (or the session\'s working-memory snapshot); prefer reusing an existing workspace over creating a new one.'

/** `registerWorkspaceCreate` 的部署开关。Deployment knobs of `registerWorkspaceCreate`. */
export interface WorkspaceCreateOptions {
  /** 部署是否允许递归创建缺失目录。Whether the deployment allows recursive directory creation. */
  allowCreateDirectory: boolean
}

/**
 * `workspace_create` 的参数面。`as const` 保留字面量（`required: true`），供
 * defineTool 的 const 泛型推断参数类型。
 * The parameter face of `workspace_create`. `as const` keeps the literals
 * (`required: true`) so defineTool's const generic infers argument types.
 */
const CREATE_PARAMETERS = {
  path: {
    type: 'string',
    required: true,
    description: 'Fully qualified directory path to own, in Host path syntax.',
  },
  title: {
    type: 'string',
    description: 'Display title used only when a new record is created; defaults to the final path segment.',
  },
  createDirectory: {
    type: 'boolean',
    description: 'Create the directory recursively when it does not exist (default false).',
  },
} as const

/**
 * `workspace_rename` 的参数面（`as const` 理由同 CREATE_PARAMETERS）。
 * The parameter face of `workspace_rename` (`as const` for the same reason as CREATE_PARAMETERS).
 */
const RENAME_PARAMETERS = {
  workspaceId: { type: 'string', required: true, description: 'The workspace id to rename.' },
  title: { type: 'string', required: true, description: 'The new display title (non-empty after trimming).' },
} as const

/**
 * 确认路径是一个已存在的目录（不跟随不存在路径）。
 * Ensure the path is an existing directory (missing paths never pass).
 * @param path - 完整路径拼写。The fully qualified path.
 */
async function requireDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined)
  if (info?.isDirectory() !== true) {
    throw new WorkspaceToolError(
      'WORKSPACE_PATH_NOT_A_DIRECTORY',
      `path is not an existing directory: ${path}`,
      { path },
    )
  }
}

/**
 * `workspace_create` 的执行体：按需递归建目录、确认目录存在、注册工作区。
 * 返回类型保持推断的匿名对象：JsonValue 的 object 分支要求隐式 index signature。
 * The `workspace_create` body: create the directory recursively on demand,
 * confirm it exists, then register the workspace. The return type stays an
 * inferred anonymous object: JsonValue's object branch requires an implicit
 * index signature.
 */
async function executeWorkspaceCreate(
  ctx: Context,
  options: WorkspaceCreateOptions,
  args: InferArgs<typeof CREATE_PARAMETERS>,
) {
  const title = args.title === undefined ? undefined : requireTitle(args.title)
  if (args.createDirectory === true) {
    if (!options.allowCreateDirectory) {
      throw new WorkspaceToolError(
        'WORKSPACE_CREATE_DIRECTORY_DISABLED',
        'createDirectory is disabled by this deployment; ask the user to create the directory first',
        { path: args.path },
      )
    }
    // 递归创建是幂等的：已存在目录不会报错。
    // Recursive mkdir is idempotent: an existing directory does not fail.
    await mkdir(args.path, { recursive: true })
  }
  await requireDirectory(args.path)
  const workspace = await ctx.workspaceRegistry.create(args.path, title)
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    created: workspace.createdAt === workspace.updatedAt,
  }
}

/**
 * `workspace_rename` 的执行体：取目标工作区并改名。返回类型保持推断的匿名
 * 对象：JsonValue 的 object 分支要求隐式 index signature。
 * The `workspace_rename` body: read the target workspace and rename it. The
 * return type stays an inferred anonymous object: JsonValue's object branch
 * requires an implicit index signature.
 */
async function executeWorkspaceRename(
  ctx: Context,
  args: InferArgs<typeof RENAME_PARAMETERS>,
) {
  const title = requireTitle(args.title)
  const workspace = ctx.workspaceRegistry.get(args.workspaceId as WorkspaceId)
  if (workspace === undefined) {
    throw new WorkspaceToolError(
      'WORKSPACE_NOT_FOUND',
      `workspace not found: ${args.workspaceId}`,
      { workspaceId: args.workspaceId },
    )
  }
  await workspace.setTitle(title)
  return { workspaceId: workspace.id, title: workspace.title }
}

/**
 * 构建 `workspace_create` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `workspace_create` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 * @param options - 部署开关。The deployment knobs.
 */
export function buildWorkspaceCreateDefinition(ctx: Context, options: WorkspaceCreateOptions): ToolDefinition {
  return defineTool({
    name: 'workspace_create',
    description:
      'Register a directory as a workspace so its sessions get their own grouping in the UI. ' +
      'The directory must already exist unless createDirectory is true. ' +
      HINT,
    parameters: CREATE_PARAMETERS,
    output: {
      // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
      // Lossless JSON output: results are small and stable; the model reads
      // the raw value directly.
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: args => executeWorkspaceCreate(ctx, options, args),
    presentCall: args => ({ card: 'generic', title: 'Create workspace', kind: 'other', rawInput: args }),
  })
}

/**
 * 构建 `workspace_rename` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `workspace_rename` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 */
export function buildWorkspaceRenameDefinition(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'workspace_rename',
    description: `Rename one existing workspace by id. ${HINT}`,
    parameters: RENAME_PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: args => executeWorkspaceRename(ctx, args),
    presentCall: args => ({ card: 'generic', title: 'Rename workspace', kind: 'other', rawInput: args }),
  })
}
