# @veren/startup-autostart-skill

The **guidance member** of the Startup Autostart stack: one bundled,
model-invocable skill named `startup-autostart` that teaches an agent when a
startup item is the right request, which of the four actions to use, and how the
run rules and failure codes actually behave.

The skill answers the questions that used to live only in tool parameter
descriptions:

- When should something become a startup item, and when is it a one-off task?
- `new_session` / `resume_session` / `message_session` / `queue_message` — which
  one does the user mean?
- Why does a restart run the item again, and why is nothing debounced?
- What are the name/message limits and the target rules after an action change?
- What should an agent check before creating or changing an item?
- How should a missing id, a bad session id, or a disabled item be explained and
  repaired?

## When the skill appears automatically

The package registers a skill provider on `ctx.skills`; it does not register
tools, storage, or UI. After its Loader row is active:

1. The profile must mount the skill registry (`@deepseek-ai/dsh-skill`). This
   package's row injects `skills`; without that service Cordis keeps the row
   **pending** — it never fails or slows the boot that mounted it.
2. The profile must mount a model-facing skill surface
   (`@deepseek-ai/dsh-tool-skill`) for the catalog and the `skill` tool. Without
   it, the skill is still registered for other consumers but no model can see
   it.
3. On the next step of any session whose agent sees the `skill` tool, the
   session skill catalog lists `startup-autostart` with the routing description
   quoted below. It is available to every agent in the profile; there is no
   per-preset setup.

Removing the row removes the catalog entry at the next step; it leaves every
stored startup item untouched. A reload re-registers the same provider and
cannot leave a duplicate behind (the registry contribution is disposed with the
row; the spec asserts it).

## Routing description

The catalog carries exactly this text (494 characters, inside the 500-character
catalog budget so the exclusion clause is never truncated):

> Use when the user wants work to run at every DeepSeek Harness start ("每次都要", "以后每次都", "开机就"), or asks to list, add, change, disable, or delete their startup items. Covers which action fits (new_session / resume_session / message_session / queue_message) and the run rules: every enabled item runs on every successful start with no debounce, and a restart interrupts the previous start's work. Skip it for one-off work, clock-time scheduling, or a question that only asks what startup items are.

The first sentence names the recurring-start requests ("every start", "每次都要",
"以后每次都", "开机就") and the management requests (list / add / change / disable /
delete). The last sentence is the deliberate exclusion: a one-off task, a
clock-time schedule (that belongs to `@deepseek-ai/dsh-schedule`), and a question
that only asks what startup items are must not load the skill. A question about
how the actions differ is **not** excluded — that is exactly what the body
answers.

## Install

Install the aggregate bundle; it declares this package as a dependency and
inserts its Loader row together with the Host's, the tools', and the UI's:

```sh
plugin_manager  install_bundle  target = @veren/startup-autostart-bundle@1.4.9
```

Command-line equivalent:

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<test-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

This package declares **no** `dsh.bundle.patch`. Installing it alone adds a
dependency but no Loader row. To compose it by hand, insert one row:

```yaml
- insert:
    - id: skill-startup-autostart
      name: '@veren/startup-autostart-skill'
```

Its only configuration is `{}`.

## Relationship to the other three members

| Member | Role | How the skill relates to it |
| --- | --- | --- |
| `@veren/startup-autostart` | Host: startup trigger, item storage, `startup` Remote API | The skill explains the Host's real rules (every start, no debounce, `enabled` is the only gate, the four actions); it owns no behavior |
| `@veren/startup-autostart-tool` | Model-facing `startup_*` tools | The skill is the judgment an agent loads **before** calling those tools; it names only tools the plugin actually registers |
| `@veren/startup-autostart-ui` | Web page for listing, editing, running, deleting items | The skill tells the agent that the page and the tools read and write **one stored record set**, so an edit on either side counts |
| `@veren/startup-autostart-bundle` | The stack's only profile layer | It installs and activates all four members together |

At runtime this package needs only `ctx.skills`; it does **not** import the Host
service. The Host package is a **devDependency** so the spec can assert that the
numbers in the skill body equal `MAX_NAME_LENGTH` and `MAX_MESSAGE_LENGTH`
instead of drifting into a second copy.

## Verify in a real session

1. Install the bundle into a disposable profile, open **Plugins**, and confirm
   the row is active (the component is listed as **Startup Autostart Skill**).
   A row waiting for a service is reported as pending on `skills` in the host
   log.
2. Open a new session. Its first step carries a `<system-reminder>` with
   `<available_skills>`; `startup-autostart` must be listed there with the
   routing description above — no prompt is needed to make it appear.
3. Ask for the positive trigger, for example: *"以后每次 DSH 启动，都让这个会话
   提醒我检查昨天的构建"*. The model must call the `skill` tool with
   `name: "startup-autostart"` before any `startup_create` call, and the result
   is a `<skill_content name="startup-autostart">` block.
4. Force the deterministic path: start a message with `/startup-autostart`. The
   same `<skill_content>` block is injected without a tool call.
5. Check the negative triggers in a fresh session: *"帮我看看这个报错"* (one-off)
   and *"启动项是什么？"* (conceptual) must not load the skill; *"每天 9 点提醒
   我"* must route to the schedule feature instead.
6. If step 2 shows nothing, check that the profile mounts `@deepseek-ai/dsh-skill`
   and `@deepseek-ai/dsh-tool-skill`, and that this row is active rather than
   pending.

## Development

```sh
node scripts/gen-tsconfig-paths.mjs   # refresh tsconfig.paths.json from the checkout
pnpm typecheck                        # check src/ and tests/ against real Harness sources
pnpm build                            # emit dist/index.js
pnpm test                             # registry-level spec
```

`tests/skill.spec.ts` mounts the real skill registry, lists the catalog, loads
the skill by name, asserts that the body answers every run-semantics question
(including the exact Host limits), and disposes the row to prove the
contribution is removed.

## Model Experience

While the row is inactive: nothing enters a model request. While it is active:
one catalog line per session (the description above) plus the full body of
roughly 4,000 characters whenever the skill is loaded. Loading the skill changes
the prompt prefix from that point on, so it has the KV-cache effect of any other
skill body. The catalog line is re-published only when the catalog actually
changes.

## Known Limitations and Deferred Work

- **A guide, not enforcement.** The `startup_*` tools remain callable without
  loading the skill; routing depends on the model matching its description.
  `/startup-autostart` is the deterministic path.
- **Prose and Host constants can drift.** The spec pins the name/message limits
  to the Host exports, but a future semantics change (a new action, a new run
  rule) needs the asset updated in the same change.
- **No user-facing surface.** It contributes no page or command; the UI member
  owns the human-facing page.
- **A same-name skill can outrank it.** The registry ranks project and user
  skills ahead of bundled ones, so a workspace that ships its own
  `startup-autostart` skill replaces this guidance there. That is the intended
  precedence for user-authored guidance, not a bug.
- **Pinned registry package.** `@deepseek-ai/dsh-skill` is pinned to
  `0.2.0-rc.2`, the release line the rest of the stack targets.
