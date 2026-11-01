# app-host domain (领域模型)

> Decision record for the app-host plugin (the host-side assembly that binds
> apps, pages and sessions together). English is primary; Chinese key terms
> stay in parentheses. Every invariant names the test that guards it; one
> without a guard is marked `unguarded`. Declared faces at the bottom are
> checked by `scripts/check-docs.mjs`.
> 本文件是 app-host 的决策沉淀：概念表 + 不变式 + 拒绝清单。每条不变式标注守护
> 测试；无守护的标注 `unguarded`。

## Concepts (概念)

| Concept | Definition | Rules it keeps |
| --- | --- | --- |
| Assembly (装配) | `wireAppHost`: every seam between the three services is wired explicitly in one place — task resolver, page mirror, real session port, host tools (`app_list`/`app_pages`/`app_open`/`page_send`) | All-or-nothing (G13 rule 3): any failing step rolls the finished ones back in reverse; unload undoes everything in reverse order |
| Page instance (页面实例) | One URL's live session: its agent activates at create, the body renders exactly once, and the instance lives and dies with that agent fiber | Deprecation retires the agent; everything the body registered unwinds with the fiber — no separate cleanup registry |
| One-shot render (一次性渲染) | The body runs once on the live agent; its registrations (tools, single-session skills, effects) ARE the page's face; the PAGE block's `tools:` line is the registration delta | `writes: true` + zero registrations is refused at mount for parameterized pages (§3.10.5 rule 3); coverage warnings are judged at mount, never at registration |
| Pick = open (选择即打开) | Picking an app in the GUI opens the page session right away: model → workspace → create + activate → page-scope masking → workspace membership → authoritative title | The tool face is mounted at pick time (the render lands at `agent/created`); there is no staged intermediate state to promote |
| Page-scope masking (页面作用域屏蔽) | `app_open` / `app_list` / `app_pages` are denied inside a page session (`page_send` is NOT masked — url-addressed delivery is the agent's autonomy carrier) | The deny rides the agent fiber; re-opening the same URL via `app_open` would self-ignite the page recursion (live session avalanche, 真机实测) |
| Delivery-report face (投递回报面) | The page-scoped task trio (`task_take`/`task_complete`/`task_fail`) a target page mounts so deliveries can be settled in-session | Names match the host global face verbatim so the TASK block reads true; page sessions cannot reach the host-global `task_*` tools |

## Invariants (不变式)

1. **The assembly is all-or-nothing (全成或全回滚)** — a failing wiring step
   rolls the system back to "nothing wired"; the disposer unwinds in reverse.
   Guard: `plugins/app-host/tests/assembly-rollback.spec.ts` 「镜像面抛错 → resolver
   被回滚、端口未绑定、镜像面不在场」+ `assembly-wiring.spec.ts` 「装配 disposer
   撤销全部注入」.
2. **Lifecycle listeners must be `global` (真机 2.0.8 反例)** — `agent/created`
   and `agent/disposed` dispatch through a dsh-scope carrier that preserves the
   agent's isolate baseFilter; plain root-realm listeners never see the events.
   Guard: `tests/assembly-wiring.spec.ts` 「重启后再激活：agent/created 经 realm
   过滤载体派发，重挂 + PAGE 重发 + 身份仍然到位（真机 2.0.8 反例的收编）」.
3. **Pick opens immediately and the tool face is mounted at pick (选择=打开，
   工具面当场挂好)** — create activates the agent, `agent/created` renders the
   body once, masking is applied, and the PAGE block lands; no staged
   "promote on first message" state exists any more.
   Guard: `tests/assembly-wiring.spec.ts` 「选择应用 = 立即打开页面会话（一次性渲染
   语义）：新建会话、agent 当场激活、工具挂好、屏蔽生效」+ `page-pipeline.spec.ts`
   「选择=打开全链：stage 即新建页面会话…实例即刻 live」.
4. **Single-session skills register in the body (单会话 skill 组件体直登)** —
   the body calls `agent.ctx.skills.register` directly; the registry rides the
   agent fiber (a real SkillRegistry is mounted into the skills isolate only
   when the property probe fails), so nothing leaks across sessions.
   Guard: `tests/assembly-wiring.spec.ts` 「单会话 skill 随组件体直登进 agent
   作用域：本页可见，重开（废弃=退役 agent）时随 fiber 释放」.
5. **The first screen is the body's own lifecycle (异步首屏=组件体自取)** — the
   body starts its async reads via `agent.ctx.effect` and delivers them as
   followup messages with the `app/page` source; the host never fetches on the
   body's behalf.
   Guard: `tests/page-pipeline.spec.ts` 「store 首屏全链：openUrl 激活 agent，PAGE
   块正文含 store 当前状态；工具差集与屏蔽就位」.
6. **Unpick/close retires the whole instance (unpick=整体拆除)** — the agent
   retires (registrations unwind with the fiber) and the index row flips to
   deprecated; logs stay readable.
   Guard: `tests/assembly-wiring.spec.ts` 「unstage = 关闭该会话的页面实例：agent
   退役（登记随 fiber 拆除）、索引行翻废弃」.
7. **The gateway adds no state (网关零状态)** — every gateway method is a pure
   forward over the declared `ctx.apps` / `ctx.pageRegistry` faces; failures
   carry stable codes, and the Remote envelope renders them as
   `{ok:false,error}` with no second ok/error layer.
   Guard: `tests/assembly-isolation.spec.ts` (isolation of the gateway face);
   the stable-code discipline itself is `unguarded` here.

## Meta behavior hooks: all retired (meta 行为钩子全退役)

`PageDefinition` carries no behavior hooks — `load`, `useSnapshot`, `skills`,
`mountSkills` are all gone. The body (the `PageFC` render) is the only behavior
site: it registers tools, skills and effects in its one render, and first-screen
data rides followup messages. `writes` and `instructions` remain as
declarations the mount-time checks cross-read against the registered facts.

Guard: the type face itself (`packages/prompt-page/src/types.ts` `PageDefinition`)
plus the composition tests above; a retired hook cannot regress silently because
re-adding one would be a new type member — `unguarded` as a negative property.

## Rejected (拒绝清单)

| Rejected | Reason |
| --- | --- |
| Meta behavior hooks (`load` / `useSnapshot` / `skills` / `mountSkills`) | A second render path behind a config field: untestable ordering against the one-shot render, and every real page ended up needing the body anyway |
| Staged pick with "promote on first message" (staged → promoted 两段态) | The staged session stayed blank and unreachable (GUI hides blank sessions), deadlocking activation; pick-now-renders-now removed the state machine entirely |
| A ctx-repackaging middleware layer between app plugins and the host (ctx 重打包中间层) | It would shadow declaration merging with a hand-written copy of the service faces — drift by construction; apps read the real faces, the assembly only wires seams |
| Derived data self-subscription (派生数据自订阅) | Derived values are pure functions over host-hook data or stable snapshots; one-shot render has no re-render to subscribe to, and a subscription would outlive the render |
| Degrading when a service is missing (服务缺席降级) | Misconfiguration fails loud: a missing `apps`/`pageRegistry`/`taskCenter`/`tools` face is an assembly error caught by the inject wait, not a silent blank |
| Masking `page_send` in page sessions (屏蔽 page_send) | Page agents must keep url-addressed delivery — it is the autonomy carrier; cascade abuse is capped by page-registry's hop ledger instead |

## Declared faces (check-docs 声明面)

- service: `appHost`
- event: `agent/created`
- event: `agent/disposed`
- tool: `app_open`
