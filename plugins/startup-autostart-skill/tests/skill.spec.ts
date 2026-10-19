// Registry-level proof: the bundled skill is listed, loads by name, keeps its
// routing text inside the catalog budget, and its body states the runtime rules
// the plugin stack actually implements. Disposal removes the contribution, so
// an HMR reload cannot leave a duplicate behind.
// 注册表级验证：技能能被列出、按名字加载、路由文字在目录预算内，正文覆盖技术栈
// 真实的运行规则。卸载会移除贡献，HMR 重载不会留下重复项。
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH } from '@veren/startup-autostart'
import * as StartupAutostartSkill from '../src/index.ts'

const SKILL_NAME = 'startup-autostart'
const PROVIDER_NAME = 'startup-autostart-skill'
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/** Mount the real registry and the plugin under test. / 挂载真实注册表与被测插件。 */
async function mount() {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(StartupAutostartSkill)
  return { ctx, fiber }
}

describe('@veren/startup-autostart-skill', () => {
  it('lists and loads the skill through the real registry, then drops it on dispose', async () => {
    const { ctx, fiber } = await mount()

    const summaries = await ctx.skills.list()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      name: SKILL_NAME,
      provider: PROVIDER_NAME,
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory', path: ASSET_DIR },
    })

    const loaded = await ctx.skills.get(SKILL_NAME)
    expect(loaded?.name).toBe(SKILL_NAME)
    expect(loaded?.content).toContain('# 启动项（Startup Autostart）')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships routing text that names recurring requests and the requests that must not load it', async () => {
    const { ctx, fiber } = await mount()
    const summary = (await ctx.skills.list())[0]!
    const description = summary.description

    // 目录按 500 字符截断描述；超出就会把「不该加载」的条件截掉。
    // The catalog truncates at 500 characters; exceeding it cuts the exclusion clause.
    expect(description.length).toBeLessThanOrEqual(500)
    for (const trigger of ['every DeepSeek Harness start', '每次都要', '以后每次都', '开机就', 'list, add, change, disable, or delete']) {
      expect(description, `routing text must name "${trigger}"`).toContain(trigger)
    }
    for (const exclusion of ['one-off work', 'clock-time scheduling', 'question that only asks what startup items are']) {
      expect(description, `routing text must exclude "${exclusion}"`).toContain(exclusion)
    }

    await fiber.dispose()
  })

  it('loads a body that answers the run semantics the Host implements', async () => {
    const { ctx, fiber } = await mount()
    const loaded = await ctx.skills.get(SKILL_NAME)
    const content = loaded?.content ?? ''

    // 一个键一个问题：动作选择、运行语义、输入边界、先看再改、失败补救。
    // One entry per question the skill must answer: action choice, run
    // semantics, input bounds, look-before-change, and failure recovery.
    const required: ReadonlyArray<readonly [string, string]> = [
      ['only every-start work becomes an item', '每次 DSH 启动都自动做同一件事'],
      ['one-off work is refused', '一次性任务'],
      ['new_session is explained', '| `new_session` |'],
      ['resume_session is explained', '| `resume_session` |'],
      ['message_session is explained', '| `message_session` |'],
      ['queue_message is explained', '| `queue_message` |'],
      ['queue_message does not wake the target', '`queue_message` 之后目标会话仍然是静止的'],
      ['message_session wakes with a new turn', '把 `message` 作为**新一轮**送进去'],
      ['resume_session carries no message', '`resume_session` **不接受** `message`'],
      ['every start runs with no debounce', '每次成功启动都跑，没有防抖、没有去重、没有排队'],
      ['a restart interrupts the previous run', '重启会打断上一次启动开始的工作'],
      ['remounting is another start', '重新挂载这一行也算一次新的启动'],
      ['enabled is the only gate', '`enabled` 是唯一的门'],
      ['run history gates nothing', '运行历史不做门禁'],
      ['delivered messages carry the startup header', '`[STARTUP AUTOSTART]`'],
      ['items survive project deletion', '`$DSH_HOME/storages/startup.json`'],
      ['cwd and workspace_id are exclusive', '`cwd` 与 `workspace_id` **互斥**'],
      ['changing action re-applies target rules', '**改 `action` 会重新套用该动作的目标规则**'],
      ['workspace and preset targets need the Web profile', '`preset` 和 `workspace_id` 只有在 Web 应用'],
      ['list before creating or changing', '先调用 `startup_list`'],
      ['the Web page and the tools share storage', '同一份存储'],
      ['item_not_found is explained', '`item_not_found`'],
      ['invalid_target is explained', '`invalid_target`'],
      ['item_disabled and force are explained', '`item_disabled`'],
      ['a failed run reports the target problem', '不会**校验目标会话是否存在'],
    ]
    for (const [label, fragment] of required) {
      expect(content, `skill body must cover ${label}`).toContain(fragment)
    }

    await fiber.dispose()
  })

  it('states the same name and message bounds the Host enforces', async () => {
    const { ctx, fiber } = await mount()
    const content = (await ctx.skills.get(SKILL_NAME))?.content ?? ''

    // 正文里的数字必须等于宿主导出的常量，不能各写一份。
    // The numbers in the body must equal the Host's exported constants.
    expect(content).toContain(`最多 **${MAX_NAME_LENGTH}** 个字符`)
    expect(content).toContain(`最多 **${MAX_MESSAGE_LENGTH}** 个字符`)

    await fiber.dispose()
  })

  it('stays pending instead of failing when the profile has no skill registry', async () => {
    // 没有 skills 服务的 profile：注入让这一行保持 pending，绝不报错或拖垮启动。
    // A profile without `skills`: the injection keeps the row pending; it never
    // throws or takes the boot down. Cordis inlines the vendor FiberState
    // values, so 0 is PENDING and 4 is DISPOSED.
    const ctx = new Context()
    const fiber = ctx.plugin(StartupAutostartSkill)
    expect(fiber.state).toBe(0)
    await fiber.dispose()
    expect(fiber.state).toBe(4)
  })

  it('publishes the body asset and stays a member without its own bundle layer', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { files?: string[]; dsh?: { bundle?: unknown }; exports?: Record<string, string> }

    expect(manifest.files).toContain('assets/*.md')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    // 成员包不得自带 bundle：组合包必须是整栈唯一的 profile 层。
    // A member must not carry a bundle: the aggregate must stay the stack's only profile layer.
    expect(manifest.dsh?.bundle).toBeUndefined()
  })
})
