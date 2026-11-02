/**
 * @veren/zhihu-ops 插件入口：注册「知乎运营分析」应用（定义 → 工具 → 页面）
 * + 每日采集调度 + 报告生成与投递。
 *
 * 「怎样写一个 Veren 应用」的参考实现（README 有完整流程）：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. createZhihuOpsTools —— 6 个工具以全名（`zhihu_ops__<本地名>`）备好；
 * 3. ctx.apps.pages(id, ctx) —— 页面单入口注册（内部自动镜像进 page-registry）；
 * 4. 采集调度器 —— 到点跑一次，按天幂等，重启不重采。
 * 依赖全部显式声明（G13）：apps / pageRegistry / storageDomain / credentials /
 * llm / agentDefaultModel / taskCenter 都是硬 inject。
 *
 * The @veren/zhihu-ops plugin entry: registers the Zhihu operations-analysis
 * app (definition → tools → pages) plus the daily pull schedule and the report
 * generation and delivery.
 *
 * 1. ctx.apps.register(def, ctx) — the app binds to this fiber (dispose removes
 *    the whole app);
 * 2. createZhihuOpsTools — the six tools prepared under full names
 *    (`zhihu_ops__<localName>`);
 * 3. ctx.apps.pages(id, ctx) — the single-entry page registration (mirrored
 *    into page-registry internally);
 * 4. the pull scheduler — fires when due, idempotent per day, never re-pulls
 *    after a restart.
 * Dependencies are all declared (G13): apps / pageRegistry / storageDomain /
 * credentials / llm / agentDefaultModel / taskCenter are hard injects.
 *
 * @module @veren/zhihu-ops
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { OfficialZhihuClient } from '@veren/zhihu-client'
import type { ZhihuDataSource } from '@veren/zhihu-client'
import { APP_DEFINITION, APP_ID, TOOL_PREFIX } from './app.ts'
import { Config, resolveConfig } from './config.ts'
import type { RuntimeConfig } from './config.ts'
import { commitStoredSecret, readStoredSecret } from './credential.ts'
import { runPull } from './collect/pull.ts'
import type { PullOutcome } from './collect/pull.ts'
import { dayKey } from './collect/day.ts'
import { deliverReport } from './deliver.ts'
import { assembleFacts } from './report/facts.ts'
import { generateReport } from './report/generate.ts'
import { PullScheduler } from './schedule/runner.ts'
import { bindRuntime } from './runtime.ts'
import type { SecretState, ZhihuOpsRuntime } from './runtime.ts'
import { ZhihuOpsStorage } from './store/store.ts'
import type { ReportRow } from './store/store.ts'
import { createZhihuOpsTools } from './tools.ts'
import { ContentDetailMeta, ContentDetailPage } from './page-content-detail.tsx'
import { ContentsMeta, ContentsPage } from './page-contents.tsx'
import { OverviewMeta, OverviewPage } from './page-overview.tsx'
import { ReportsMeta, ReportsPage } from './page-reports.tsx'

export { Config } from './config.ts'

export const name = 'veren-zhihu-ops'

/** 三个宿主服务 + 存储 + 凭据 + 模型 + 任务中心全部显式声明 / the three host services plus storage, credentials, model, and task center are all declared */
export const inject = ['apps', 'pageRegistry', 'storageDomain', 'credentials', 'llm', 'agentDefaultModel', 'taskCenter']
export const provide = []

/**
 * 装配本插件：开域 → 建运行时面 → 注册应用 → 备工具 → 注册页面 → 起调度器。
 * Assembles the plugin: open the domain → build the runtime faces → register
 * the app → prepare the tools → register the pages → start the scheduler.
 *
 * @param ctx - the host context / 宿主上下文
 * @param config - the validated plugin configuration / 已校验的插件配置
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const runtime = resolveConfig(config)
  const storage = new ZhihuOpsStorage()
  await storage.open(ctx)
  const faces = buildFaces(ctx, storage, runtime)
  bindRuntime(faces.runtime)
  try {
    wireApp(ctx, faces)
  } catch (error: unknown) {
    await storage.close()
    throw error
  }
  if (runtime.autoPull) faces.scheduler.start()
  ctx.effect(async () => {
    await storage.close()
    return () => undefined
  }, 'zhihu-ops:storage')
}

/** 装配期构造出的各块面 / the faces built at assembly time */
interface AssembledFaces {
  /** 运行时面（页面与工具取数的唯一正道）/ the runtime faces (the only straight path for pages and tools) */
  readonly runtime: ZhihuOpsRuntime
  /** 采集调度器 / the pull scheduler */
  readonly scheduler: PullScheduler
}

/**
 * 构造运行时面与调度器。
 * Builds the runtime faces and the scheduler.
 *
 * @param ctx - the host context / 宿主上下文
 * @param storage - the opened storage / 已开的存储
 * @param runtime - the resolved runtime configuration / 解析后的运行配置
 * @returns the assembled faces / 装配好的各块面
 */
function buildFaces(ctx: Context, storage: ZhihuOpsStorage, runtime: RuntimeConfig): AssembledFaces {
  const refresh = async (): Promise<PullOutcome> => await runPull({
    source: await sourceOf(ctx, runtime),
    storage,
    contentLimit: runtime.contentLimit,
    now: () => new Date(),
  })
  const writeReport = async (): Promise<ReportRow> => await writeAndDeliver(ctx, storage, runtime)
  const scheduler = new PullScheduler(ctx, {
    pull: refresh,
    pulledOn: (day) => storage.getPullRun(day) !== undefined,
    now: () => new Date(),
  }, { pullLocalTime: runtime.pullLocalTime, tickMs: SCHEDULER_TICK_MS })
  return {
    runtime: {
      storage,
      tools: createZhihuOpsTools().map((tool) => ({ ...tool, name: `${TOOL_PREFIX}__${tool.name}` })),
      refresh,
      writeReport,
      secretState: async () => await secretStateOf(ctx),
      installSecret: async (secret) => { await commitStoredSecret(ctx.credentials, secret) },
      now: () => new Date(),
    },
    scheduler,
  }
}

/**
 * 造数据源：凭据每次现读（可能刚由用户配好），缺失就响亮地失败。
 * Builds the data source: the credential is read fresh every time (the user
 * may have just configured it), and its absence fails loudly.
 */
async function sourceOf(ctx: Context, runtime: RuntimeConfig): Promise<ZhihuDataSource> {
  const secret = await readStoredSecret(ctx.credentials)
  if (secret === undefined || secret.length === 0) {
    throw new Error('[zhihu-ops] no access secret is stored; run the setup_credentials tool first')
  }
  return new OfficialZhihuClient({
    accessSecret: secret,
    dailyCallLimit: runtime.dailyCallLimit,
    minIntervalMs: runtime.requestIntervalMs,
  })
}

/** 凭据是否已配置 / whether the credential is stored */
async function secretStateOf(ctx: Context): Promise<SecretState> {
  const secret = await readStoredSecret(ctx.credentials)
  return secret === undefined || secret.length === 0 ? 'missing' : 'configured'
}

/**
 * 写一份报告并投进收件箱。
 * Writes one report and delivers it to the inbox.
 */
async function writeAndDeliver(ctx: Context, storage: ZhihuOpsStorage, runtime: RuntimeConfig): Promise<ReportRow> {
  const facts = assembleFacts({
    accountStats: storage.accountStats(),
    contents: storage.contents(),
    contentStats: storage.contentStats(),
    comments: storage.comments(),
    hotItems: storage.hotItemsOf(dayKey(new Date())),
    questions: storage.questionsOf(dayKey(new Date())),
    windowDays: runtime.reportWindowDays,
  })
  const body = await generateReport(ctx.agentDefaultModel, ctx.llm, {
    facts,
    windowDays: runtime.reportWindowDays,
    day: dayKey(new Date()),
  })
  const report: ReportRow = {
    report_id: `report-${dayKey(new Date())}-${Date.now()}`,
    day: dayKey(new Date()),
    title: `知乎运营分析报告（截至 ${dayKey(new Date())}）`,
    body,
    window_days: runtime.reportWindowDays,
    generated_at: new Date().toISOString(),
  }
  await storage.putReport(report)
  await deliverReport(ctx.taskCenter, report)
  return report
}

/**
 * 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面；体内任何一步失败都把
 * 已完成的步骤逆序回滚——绝不留下"应用在、工具缺页"的半接线状态。
 * One effect owns the wiring (G13 rule 3): definition → tools → pages; any
 * failing step rolls the finished ones back in reverse.
 */
function wireApp(ctx: Context, faces: AssembledFaces): void {
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(ctx.apps.register(APP_DEFINITION, ctx))
      const pages = ctx.apps.pages(APP_ID, ctx)
      done.push(pages.register(OverviewPage, OverviewMeta))
      done.push(pages.register(ContentsPage, ContentsMeta))
      done.push(pages.register(ContentDetailPage, ContentDetailMeta))
      done.push(pages.register(ReportsPage, ReportsMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'zhihu-ops:app')
}

/** 调度器的检查间隔（五分钟）/ the scheduler's check interval (five minutes) */
const SCHEDULER_TICK_MS = 5 * 60 * 1000
