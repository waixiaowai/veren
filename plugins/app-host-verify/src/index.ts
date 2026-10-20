/**
 * 鐪熸満楠岃瘉鎺㈤拡锛堝彧鍦ㄩ殧绂绘祴璇?profile 閲岃锛夛細鍦ㄧ湡瀹炲涓昏繘绋嬪唴璺戝叚椤规鏌ワ紝
 * 缁撴灉鍐?JSON锛坈onfig.outputPath锛夈€傛鏌ラ」瑙?{@link runChecks}銆? * Real-host verification probe (isolated test profiles only): runs the six
 * phase-2 checks inside the real host process and writes a JSON verdict.
 *
 * 鍏」锛? * 1. ctx.apps / ctx.pageRegistry / ctx.taskCenter 鍙В鏋愶紙瑁呴厤鎸変緷璧栧簭鐢熸晥锛夛紱
 * 2. agent/created 鐪熷疄杞借嵎褰㈢姸锛堣褰曢敭涓?agent 瀛楁锛屼緵姣斿鏇胯韩鍋囪锛夛紱
 * 3. 鐪熷疄浼氳瘽閲屾墦寮€ /apps/task-workbench/task/1 涓?/list锛氶〉闈㈠伐鍏峰垎鍒寕杩? *    鍚勮嚜 agent 浣滅敤鍩燂紙list 椤垫湁 take_task 鏃?abandon_task锛宒etail 椤电浉鍙? *    鈥斺€斿伐鍏烽泦鍚堜笉鍚屾墠璇佸緱鍑?浜掍笉鍙"锛屽悓鍚嶉泦鍚堣瘉涓嶅嚭锛夛紱
 * 4. 鍙嶅悜鍙鎬э細list 鐨?agent 鐪嬩笉鍒?abandon_task锛宒etail 鐨?agent 鐪嬩笉鍒? *    take_task锛堣法浼氳瘽闆舵硠婕忥級锛? * 5. 閲嶅紑鍚屼竴 URL 鍥炲埌鍘熶細璇濓紙鐪熷疄 SessionStore 鎸佷箙鍖栵紝闈炴浛韬級锛? * 6. 浠诲姟閫氱煡缁忕湡瀹?followup 钀借繘鐪熷疄浼氳瘽鏃ュ織锛堟姇閫掓车璺戝湪鐪熷涓讳笂锛夈€? * @module @veren/app-host-verify
 */
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PageInstanceKey } from '@veren/prompt-page'

// Module-scope marker: written the moment the Loader imports this module.
// 妯″潡椤跺眰鏍囪锛歀oader 涓€ import 鏈ā鍧楀氨鍐欍€?try { writeFileSync(new URL('../../../deepseek/.dsh/profiles/web/app-host-verify-result.json.imported', import.meta.url), new Date().toISOString()) } catch { /* marker only */ }

export const name = 'veren-app-host-verify'

export interface Config {
  /** 楠屾敹缁撴灉 JSON 杈撳嚭璺緞 / where the verdict JSON is written */
  outputPath: string
  /** 鏄惁鎵ц锛堥粯璁ゅ紑锛沷verlay patch 閲屾樉寮忕粰 true锛?*/
  run: boolean
}

export const Config: z<Config> = z.object({
  outputPath: z.string().description('楠屾敹缁撴灉 JSON 杈撳嚭璺緞 / where the verdict JSON is written'),
  run: z.boolean().default(true).description('鏄惁鎵ц楠岃瘉 / whether to run the verification'),
})

export const inject = ['apps', 'pageRegistry', 'taskCenter', 'sessions', 'agents', 'tools']
export const provide = []

/** 涓€椤规鏌ョ殑缁撹 / one check's verdict */
interface Check {
  readonly name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail }
}

/** 瀹夸富闈㈢殑缁撴瀯鎬ц鍙栵紙鎺㈤拡鍙湪鐪熷涓婚噷璺戯紝璇诲埌鍟ヨ鍟ワ紝涓嶅亣瑁咃級 */
function hostFaces(ctx: Context) {
  const host = ctx as unknown as {
    apps?: { catalog(): unknown[]; listPages(id: string): unknown[] }
    pageRegistry?: { openUrl(url: string, o?: object): Promise<{ sessionId: string; created: boolean }> }
    taskCenter?: { send(d: unknown): Promise<{ id: string }>; get(id: string): Promise<{ status?: string } | undefined> }
    sessions?: unknown
    agents?: { get(id: string): { ctx: Context; session: { id: string; log?: unknown[]; messages?: unknown[] }; followup(m: unknown): void } | undefined; create(o: { sessionId: string }): Promise<unknown> }
  }
  return host
}

/** agent 浣滅敤鍩熼噷鐨勫伐鍏峰悕闆嗗悎锛圱oolRuntime 鐪熷疄 scope 瑙ｆ瀽锛?*/
function scopedToolNames(agentCtx: Context, names: readonly string[]): string[] {
  const runtime = (agentCtx as { tools?: { get(name: string): { name: string } | undefined } }).tools
  if (runtime === undefined) return []
  return names.filter((n) => runtime.get(n) !== undefined)
}

/** 鐪熷疄浼氳瘽鏃ュ織閲屾槸鍚﹀嚭鐜版煇娈垫枃鏈紙闃插尽寮忥細涓嶅悓鐗堟湰鐨勬棩蹇楅潰瀛楁閮借瘯涓€閬嶏級 */
function sessionContains(agent: { session: { log?: unknown; messages?: unknown } }, needle: string): boolean {
  const haystack = JSON.stringify({ log: agent.session.log, messages: agent.session.messages }) ?? ''
  return haystack.includes(needle)
}

export const apply = (ctx: Context, config: Config): void => {
  // Sync activation marker: distinguishes "row never activated" from "async checks failed".
  // 鍚屾婵€娲绘爣璁帮細鍖哄垎銆岃鏍规湰娌℃縺娲汇€嶄笌銆屽紓姝ユ鏌ュけ璐ャ€嶃€?  try { writeFileSync(config.outputPath + '.activated', new Date().toISOString()) } catch (error: unknown) { ctx.logger.error(`app-host-verify: marker failed: ${String(error)}`) }
  ctx.logger.info('app-host-verify: apply() entered')
  if (!config.run) return
  const checks: Check[] = []
  const agentCreatedPayloads: unknown[] = []
  ;(ctx.on as unknown as (e: string, l: (p: unknown) => void) => void)('agent/created', (p: unknown) => {
    agentCreatedPayloads.push(p)
  })
  const finish = (): void => {
    try {
      writeFileSync(config.outputPath, JSON.stringify({ checks, agentCreatedPayloads }, null, 2))
      ctx.logger.info(`app-host-verify: verdict written to ${config.outputPath} (${checks.filter((c) => c.pass).length}/${checks.length} passed)`)
    } catch (error: unknown) {
      ctx.logger.error(`app-host-verify: could not write verdict: ${String(error)}`)
    }
  }
  // 绛?task-workbench 鐨勯〉闈㈡敞鍐屼笌瑁呴厤瀹屾垚锛涙暣涓祦绋嬪紓姝ヨ窇锛岀粨鏉熷啓鏂囦欢銆?  // Global watchdog: any hang still lands a verdict naming the last step reached.
  // 鍏ㄥ眬鐪嬮棬鐙楋細浠讳綍鎸傝捣涔熶細钀界洏 verdict锛屽苟鎸囪鏈€鍚庡埌杈剧殑姝ラ銆?  let lastStep = 'start'
  const watchdog = setTimeout(() => { checks.push(check('watchdog', false, `flow hung after step "${lastStep}"`)); finish() }, 60000)
  void (async () => {
    try {
      const host = hostFaces(ctx)
      lastStep = 'services'
      if (!servicesOk) {}

      // 1) 涓変釜鏈嶅姟鍙В鏋?      const servicesOk = host.apps !== undefined && host.pageRegistry !== undefined && host.taskCenter !== undefined
      checks.push(check('1.services-resolve', servicesOk,
        `apps=${typeof host.apps} pageRegistry=${typeof host.pageRegistry} taskCenter=${typeof host.taskCenter}`))
      if (!servicesOk) return

      // 3+4) 涓や釜鐪熷疄浼氳瘽锛歭ist 椤典笌 detail 椤碉紝宸ュ叿闆嗗悎涓嶅悓
      // Row activation has no global ordering: wait until the app's page lands in
      // the URL index (up to ~8s) before continuing. 琛屾縺娲绘棤鍏ㄥ眬椤哄簭锛氬厛绛夊簲鐢?      // 椤甸潰钀借繘 URL 绱㈠紩锛堟渶澶?~8s锛夊啀缁х画銆?      lastStep = 'openUrl-list'
      let list: { sessionId: string; created: boolean } | undefined
      for (let waited = 0; ; waited += 200) {
        try {
          list = await host.pageRegistry!.openUrl('/apps/task-workbench/list')
          break
        } catch {
          if (waited >= 8000) {
            // 璇婃柇锛氭敞鍐屽埌搴曞彂鐢熶簡浠€涔堬紙鐩綍/闀滃儚/瑁呴厤闈㈢姸鎬佸師鏍疯惤鐩橈級
            // Diagnostics: dump catalog/mirror/assembly state as-is for the verdict.
            const catalog = (host.apps as { catalog(): unknown[] }).catalog()
            const pages = (host.apps as { listPages(id: string): unknown[] }).listPages('task-workbench')
            const pr = host.pageRegistry as { get(name: string): unknown; resolve(url: string): unknown }
            const byName = pr.get?.('list')
            const byUrl = pr.resolve?.('/apps/task-workbench/list')
            const dump = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'function' ? 'fn' : item)
            throw new Error(`pages never appeared; byName=${dump(byName)?.slice(0, 300)}; byUrl=${dump(byUrl)?.slice(0, 300)}; appPages=${dump(pages)?.slice(0, 400)}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      lastStep = 'openUrl-detail'
      const detail = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('3.real-sessions-created', list.created && detail.created,
        `list=${list.sessionId} detail=${detail.sessionId}`))
      const agentList = host.agents?.get(list.sessionId)
      const agentDetail = host.agents?.get(detail.sessionId)
      lastStep = 'agents-create'
      if (agentList === undefined || agentDetail === undefined) {
        // 鏃犳椿 agent锛氶〉闈㈠伐鍏峰湪 app-host 鐨勭瓑寰呴槦鍒楅噷銆傚垱寤虹湡瀹?agent 瑙﹀彂鎸傝浇銆?        // create may pend indefinitely without model credentials: race a timeout so
        // the verdict still lands and names the hang point.
        // create 鍦ㄦ棤妯″瀷鍑嵁鏃跺彲鑳芥案涔?pending锛氫笌瓒呮椂绔為€燂紝淇濊瘉 verdict 钀界洏骞舵寚璁ゅ崱鐐广€?        const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
          Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))])
        await withTimeout(host.agents!.create({ sessionId: list.sessionId }), 15000, `agents.create(${list.sessionId})`)
        await withTimeout(host.agents!.create({ sessionId: detail.sessionId }), 15000, `agents.create(${detail.sessionId})`)
      }
      const listAgent2 = host.agents?.get(list.sessionId)
      const detailAgent2 = host.agents?.get(detail.sessionId)
      const listTools = listAgent2 ? scopedToolNames(listAgent2.ctx, ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']) : []
      const detailTools = detailAgent2 ? scopedToolNames(detailAgent2.ctx, ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']) : []
      checks.push(check('4.scoped-visibility', listTools.includes('task_workbench__take_task') && !listTools.includes('task_workbench__abandon_task')
        && detailTools.includes('task_workbench__abandon_task') && !detailTools.includes('task_workbench__take_task'),
        `list scope=[${listTools.join(',')}] detail scope=[${detailTools.join(',')}]`))

      // 2) agent/created 鐪熷疄杞借嵎褰㈢姸
      const payload = agentCreatedPayloads[0] as { agent?: unknown } | undefined
      checks.push(check('2.agent-created-payload', payload !== undefined && (payload as { agent?: { session?: unknown; ctx?: unknown } }).agent !== undefined,
        `payloadKeys=${payload ? Object.keys(payload).join(',') : 'none'}; agentKeys=${payload && typeof payload.agent === 'object' && payload.agent !== null ? Object.keys(payload.agent).join(',') : 'none'}`))

      // 5) 閲嶅紑鍚屼竴 URL 鍥炲埌鍘熶細璇?      const reopened = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('5.reopen-reuses-session', !reopened.created && reopened.sessionId === detail.sessionId,
        `reopened=${reopened.sessionId} created=${reopened.created}`))

      // 6) 浠诲姟閫氱煡缁忕湡瀹?followup 钀借繘鐪熷疄浼氳瘽鏃ュ織
      const task = await host.taskCenter!.send({
        kind: 'task-workbench/verify',
        title: '鐪熸満楠岃瘉浠诲姟',
        target: { url: '/apps/task-workbench/task/1', appId: 'task-workbench', page: 'detail', params: { taskId: '1' } },
      })
      // 鎵撳紑鍗虫帴鍙栵紙openUrl 甯?taskId锛夆啋 鎶曢€掓车鎶婇€氱煡 followup 杩涜浼氳瘽
      await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey, { taskId: task.id })
      const detailAgent3 = host.agents?.get(detail.sessionId)
      const delivered = detailAgent3 !== undefined && sessionContains(detailAgent3, '[task-center]')
      checks.push(check('6.notice-in-real-session-log', delivered,
        delivered ? 'notice text found in the real session log' : 'notice text NOT found in the session log'))
    } catch (error: unknown) {
      checks.push(check('probe-error', false, String(error)))
    } finally {
      clearTimeout(watchdog)
      finish()
    }
  })()
}

