/**
 * 采集进程命令行入口：控制服务以子进程方式拉起（design/modules/launcher.md）。
 * The crawl process command-line entry: spawned as a subprocess by the
 * control service (design/modules/launcher.md).
 *
 * 唯一耦合是命令行参数约定：单参数 JSON（启动请求）。数据根与浏览器档案
 * 根可用环境变量覆盖（运维与本地验证用）。
 * The only coupling is the argv contract: one JSON argument (the start
 * request). Both roots are overridable by environment variables (ops and
 * local verification).
 *
 * @module @veren/crawler/cli
 */
import { DEFAULT_CONFIG } from './config.ts'
import { CrawlerError } from './errors.ts'
import { realDeps, type RealDepsOptions } from './runner/real-deps.ts'
import { runPipeline } from './pipeline.ts'
import type { CrawlerRunRequest } from './control/runner.ts'

/** CLI 运行选项 / the CLI run options */
export interface CliOptions extends RealDepsOptions {
  /** 数据输出根目录 / the data output root */
  dataRoot: string
}

/** 解析运行选项：环境变量优先，缺省回落到插件默认配置 / resolves the run options: env first, plugin defaults otherwise */
export function cliOptions(env: NodeJS.ProcessEnv = process.env): CliOptions {
  return {
    dataRoot: env.CRAWLER_DATA_ROOT ?? DEFAULT_CONFIG.dataRoot,
    browserDataRoot: env.CRAWLER_BROWSER_DATA_ROOT ?? DEFAULT_CONFIG.browserDataRoot,
    channel: DEFAULT_CONFIG.browserChannel,
    cdpPort: Number(env.CRAWLER_CDP_PORT ?? '9222'),
  }
}

/** CLI 主流程：解析 → 管线 → 退出码 / the CLI main flow: parse → pipeline → exit code */
async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const request = JSON.parse(argv[0] ?? '{}') as CrawlerRunRequest
  const options = cliOptions(env)
  return await runPipeline(request, realDeps(request, options), options.dataRoot)
}

/** 入口：错误统一兜底为退出码 1 / entry: every error bottoms out as exit code 1 */
async function bootstrap(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof CrawlerError) {
      console.log(`[ERROR] ${error.code}: ${error.message}`)
    } else {
      console.log(`[ERROR] ${String(error)}`)
    }
    process.exitCode = 1
  }
}

void bootstrap()
