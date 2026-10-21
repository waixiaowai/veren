/** Request for one `dsh web` launch after Config validation. */
export interface DshTestConfig {
  /** Executable that launches the dsh CLI, for example `pnpm` or an absolute `dsh` path. */
  command: string
  /** Arguments after the executable. */
  args: string[]
  /** TCP port handed to the web runner as `--port`; omitted follows a `--port` argument or the CLI default. */
  port?: number | undefined
  /** Working directory of the spawned process; omitted follows `srcDir`. */
  cwd?: string | undefined
  /** Source directory reported as DSH_SRC; omitted is the checkout containing this plugin. */
  srcDir?: string | undefined
  /** Harness home reported as DSH_HOME; omitted follows `$DSH_HOME`, then `~/.dsh`. */
  dshHome?: string | undefined
  /** Budget in milliseconds for the subprocess to print its ready URL. */
  startupTimeoutMs: number
}

/** One model-facing content block; this plugin only renders plain text. */
export interface TextContentBlock {
  type: 'text'
  text: string
}

/** Canonical JSON output contract of the instance tools. */
export interface DshTestInfo {
  /** Token-bearing access URL of the managed web instance; present once ready. */
  WEB_URL?: string | undefined
  /** Harness home directory. */
  DSH_HOME: string
  /** Source directory of the deepseek-harness checkout. */
  DSH_SRC: string
  /**
   * Target port pre-checked before launch; absent when neither `port` nor a
   * `--port` argument was configured, so the CLI picked the port itself.
   */
  PORT?: number | undefined
  /** Lifecycle of the managed instance. */
  STATUS: 'starting' | 'ready' | 'error'
  /** Readable startup or restart failure reason; present only after a failure. */
  ERROR?: string | undefined
}

/**
 * The subset of the Cordis tool registry this plugin consumes. Full
 * `@deepseek-ai/cordis` typings live in the harness tree; the bundle stays
 * dependency-free and validates its Config through the Standard Schema.
 */
export interface ToolRegistry {
  register(definition: ToolDefinition): () => void
}

/** Minimal Cordis context carrying the declared injections and effect scope. */
export interface PluginContext {
  tools: ToolRegistry
  effect(register: () => () => void | Promise<void>): () => Promise<void>
}

/** A registered tool: schema plus execution function (structural subset). */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: DshTestInfo): TextContentBlock[]
  }
  isConcurrencySafe?(args: unknown): boolean
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<DshTestInfo>
}

/** Standard Schema validation result. */
export type StandardValidation =
  | { value: DshTestConfig }
  | { issues: Array<{ message: string }> }
