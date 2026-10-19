/**
 * 调用 DSH 的索引生成器 / Invoke the DSH index generator.
 * 生成器负责读 registry、校验每一条版本、下载图标；本模块只负责进程参数与失败处理。
 * The generator reads the registry, validates every version, and fetches icons; this module only owns the argv and
 * the failure report.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GENERATOR_BIN, MARKET_DIR, REGISTRY, ROOT_DIR, SOURCES_FILE, TSX_CLI } from './paths.mjs'

const run = promisify(execFile)

/**
 * 运行生成器，把结果写进 `output`，图标写到同目录 icons/。
 * Run the generator, writing the index to `output` and icons to icons/ beside it.
 * @param {object} options - 运行参数 / Run options.
 * @param {string} options.output - 索引文件路径 / Index file path.
 * @param {string} options.title - 市场标题，元数据阶段会被覆盖 / Market title, replaced by the metadata stage.
 * @param {(line: string) => void} [options.onOutput] - 生成器输出回调 / Generator output callback.
 * @returns {Promise<void>} 生成器成功结束时 resolve / Resolves when the generator succeeds.
 */
export async function runGenerator({ output, title, onOutput = () => {} }) {
  const args = [
    TSX_CLI, GENERATOR_BIN,
    '--input', SOURCES_FILE,
    '--output', output,
    '--title', title,
    '--registry', REGISTRY,
    '--cache', `${MARKET_DIR}/.plugin-market-cache`,
  ]
  try {
    const { stdout, stderr } = await run(process.execPath, args, { cwd: ROOT_DIR, maxBuffer: 16 * 1024 * 1024 })
    for (const line of `${stdout}${stderr}`.split('\n')) if (line.trim() !== '') onOutput(line)
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    throw new Error(`索引生成器失败 / index generator failed (exit ${error.code ?? '?'}):\n${detail}`)
  }
}
