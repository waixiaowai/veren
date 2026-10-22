// 工具构建器：workspace_create / workspace_rename（只造定义，注册归应用层）。
// Tool builders: workspace_create / workspace_rename (definitions only; registration belongs to the app layer).
import { mkdir, stat } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
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
 * 构建 `workspace_create` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `workspace_create` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The host context carrying workspaceRegistry.
 * @param options - 部署开关。The deployment knobs.
 */
export function buildWorkspaceCreateDefinition(ctx: Context, options: WorkspaceCreateOptions): ToolDefinition {
  return defineTool({
      name: 'workspace_create',
      description:
        'Register a directory as a workspace so its sessions get their own grouping in the UI. ' +
        'The directory must already exist unless createDirectory is true. ' +
        HINT,
      parameters: {
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
      },
      output: {
        // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
        // Lossless JSON output: results are small and stable; the model reads
        // the raw value directly.
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args) {
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
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Create workspace',
        kind: 'other',
        rawInput: args,
      }),
    })
}

/**
 * 构建 `workspace_rename` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `workspace_rename` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The host context carrying workspaceRegistry.
 */
export function buildWorkspaceRenameDefinition(ctx: Context): ToolDefinition {
  return defineTool({
      name: 'workspace_rename',
      description: `Rename one existing workspace by id. ${HINT}`,
      parameters: {
        workspaceId: {
          type: 'string',
          required: true,
          description: 'The workspace id to rename.',
        },
        title: {
          type: 'string',
          required: true,
          description: 'The new display title (non-empty after trimming).',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args) {
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
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Rename workspace',
        kind: 'other',
        rawInput: args,
      }),
    })
}

