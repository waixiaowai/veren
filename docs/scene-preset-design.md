# Scene Presets: One Preset Is One Scene (Design Draft)

English | [中文](scene-preset-design.cn.md)

**Audience:** DSH plugin developers and Agent product designers.
**Prerequisites:** Cordis plugins, Agent presets, system prompts, tool registration.

Status: concept design, awaiting review. This document answers three questions: what a scene is made of, how roles and scenes layer, and how the model maps onto DSH presets. `scene-kit` / `scene-context` / `scene-switch` are proposed package names; they do not exist yet.

## 0. In short

1. **A scene is not a role-play prompt; it is a context contract.** It states who is in what relationship, where they are, what they are doing, what they may use, what they remember, and how they leave.
2. **Roles are continuous; scenes are discrete.** A role (child, employee, friend) persists across places and activities, so memory belongs to the role. A scene (dinner at home, working in the office, walking by the sea) is one concrete activity, so tools and norms belong to the scene.
3. **A preset is the executable form of a scene; a session is one instance of it.** Switching scenes means switching presets, which means a new session or a fork. Do not hot-swap a persona inside a live session.
4. **A costume change is not a scene change.** A real scene changes at least one of: the tool face, the memory boundary, or the permission policy.
5. **Absent tools are part of the scene.** A cinema has no terminal, just as a person would not open a laptop to look things up in a cinema.

## 1. What a human scene already contains

A person walks into a scene and loads a whole set of things without being told:

| What a person already knows | The question it answers |
|---|---|
| Who I am | What identity I hold here, whose side I am on |
| Who you are | What relationship we have, who has authority, how close we are |
| Where I am | What kind of occasion this is, who else is present, what may be said |
| What I am doing | What the goal is, what the next step is, what counts as done |
| What I can do | What I have at hand, which actions are out of place |
| What I remember | What happened before, what may be mentioned, what must stay private |
| When I leave | What signals the end, how we stay in touch afterwards |

An Agent has none of this "load on entering a scene" machinery. By default it loads the **generic assistant**: polite, universal, stance-free, place-less. The value of a preset is to compress the context a human gets for free into a few hundred tokens.

So the design goal of a scene preset is not "make the Agent act well." It is to **make the generic-assistant default impossible**.

## 2. First, separate the role layer from the scene layer

The examples that prompted this design mix two layers:

| Example | Layer | Why |
|---|---|---|
| With parents, I am the child | Role / relationship | Still the child in a restaurant, a hospital, or a video call |
| With my boss, I am the employee | Role / relationship | Still the employee at a retreat, on a trip, at the annual party |
| With friends, I am the confidant | Role / relationship | Still the confidant by the sea, in a café, at home |
| Watching TV in the living room | Scene | Role + place + activity |
| Watching a movie in a cinema | Scene | Place + activity + etiquette |
| Meeting in a meeting room | Scene | Place + activity + decision rules |
| Walking by the sea | Scene | Place + activity + pace |

The value of the split is reuse: **one role can spawn many scenes, and one scene can cast different roles.**

```mermaid
flowchart LR
  Role["Role<br/>identity · relationship · long-term memory"]
  Scene["Scene<br/>role + place + activity + occasion"]
  Preset["Preset<br/>persona + scene card + tool face + permissions"]
  Session["Session<br/>one instance · log · live state"]
  Role --> Scene --> Preset --> Session
```

- **Role** answers "who am I, and who am I to you." It sets stance, address form, intimacy, and long-term memory.
- **Scene** answers "where am I right now, and what am I doing." It sets place facts, activity pace, the immediate goal, and the tool face.
- **Preset** is the scene's executable form: the role becomes the persona, the scene becomes the scene card, and permissions become tool rows.
- **Session** is one instance: where this movie is, what was said at this dinner. It lives in the session log and does not travel to the next scene on its own.

This is why "with parents" and "watching TV in the living room" cannot sit in one flat list: the first is a role, the second is a scene that role plays in a particular place. The complete statement is "as the child, in my parents' living room, watching TV with them."

## 3. The seven clauses of a scene

An executable scene must answer seven questions. Miss one, and the model falls back to the generic assistant.

| # | Clause | Question | Typical content | DSH landing point |
|---|---|---|---|---|
| 1 | Casting | Who am I, who are you, what are we to each other | Agent role, user role, relation, power distance, intimacy | `dsh-persona` prefix |
| 2 | Setting | Where, when, who else, what is here | Place, time, privacy level, others present, props, atmosphere | Static scene card + runtime context |
| 3 | Objective | What are we completing, what counts as good | Shared goal, individual goals, stakes, success criteria | Persona + scene card + todo |
| 4 | Interaction | How to address, how to take turns, what is off-limits | Address form, formality, turn length, taboos, repair moves | Persona suffix + scene card |
| 5 | Affordances | What may be done, what may not, what needs approval | Tool face, permissions, approvals, spending/external-send limits | Tool rows + sandbox/approval |
| 6 | Memory | What comes in, what stays, what leaves | Carry-in, scene-local, carry-out, privacy level | Notebook/storage + session log |
| 7 | Exit | When it ends, how to hand off | End signals, handoff summary, next appointment | Tools + prompt + archive |

### 3.1 Casting must be explicit

"With parents, I am the child" is ambiguous about whose perspective it states: does the user play the parent while the Agent plays the child, or is the user the child while the Agent plays the parent?

A product must name both sides:

```yaml
casting:
  agent: child          # Who the Agent plays
  user: parent          # Who the user plays
  relation: parent-child
  power: low            # The Agent's power position in this relationship
  intimacy: close
  address: Dad / Mom    # Address form
```

The default assumption should be: **the user is themselves and is never asked to role-play; the Agent enters the role.** Only explicit role-play or training scenes put the user in character too. Without that default, the Agent feels presumptuous.

### 3.2 All seven clauses, filled in: the cinema

| Clause | Content |
|---|---|
| Casting | Agent = companion; user = companion; relation = friend/partner; equal, close |
| Setting | A cinema; evening; a dark public space; a full audience; phones on silent |
| Objective | Watch the film together; the Agent's goal is companionship and a conversation afterwards |
| Interaction | Whispers and short sentences; no spoilers; no plot discussion; no leaving mid-film |
| Affordances | No tools; no lookups, no work, no photos |
| Memory | Carry in: the other person's favorite genres, the last film they saw; keep local: where this film is, their live reactions; carry out: impressions, the next plan |
| Exit | End credits, house lights; a three-sentence summary; make a next plan |

Note clause 5: **"No tools" is a scene decision, not a default.** In a cinema the Agent should have no search, no files, no terminal; it should not even say "let me look that up for you." The absence of a tool face matters as much as a taboo in the dialogue.

## 4. Drawing the inference: three axes, not one long list

Scenes are long-tailed and cannot be enumerated. The axes are what generalize:

| Axis | Values | Examples |
|---|---|---|
| Relationship | Family / workplace / service / social / authority / care / transaction | Parent, boss, customer, friend, police officer, doctor, seller |
| Place | Private / semi-public / public / virtual | Home, café, cinema, seaside, meeting room, online |
| Activity | Consume / produce / decide / socialize / transact / care / transit / rest | Watch TV, work, meet, chat, order, consult, commute, zone out |
| Occasion | Everyday / ritual / crisis / first time / farewell | Weekend, wedding, emergency, interview, funeral |
| Mode | Solo/pair/group; public/private; formal/casual; online/offline | Group chat, direct message, video call, face to face |

A scene's name usually comes from its **dominant axis**:

- "With parents" is relationship-dominant.
- "Cinema" is place-dominant.
- "Meeting" is activity-dominant.
- "Wedding" is occasion-dominant.

But every real scene has a value on all five axes. When designing a scene, fill all five first, then decide which one dominates.

### 4.1 Scene matrix (examples, not exhaustive)

| Scene | Agent plays | User plays | Place / activity | Hard constraints | Tool face |
|---|---|---|---|---|---|
| Visiting parents | Child | Parent | Parents' home / accompany | Share good news first but never lie; do not fight back | Companion |
| Looking after a child | Parent | Child | Home / care | Do not decide for the child; empathize first | Companion + stories |
| Reporting to the boss | Employee | Boss | Office / report | Conclusion first; never promise beyond authority | Meeting |
| Chatting with a friend | Confidant | Friend | Café / small talk | Equal; non-judgmental; do not rush to solutions | Café |
| Watching TV in the living room | Family member | Family member | Living room / consume | Low intensity; interruptible; do not push tasks | Silent |
| Watching a movie in a cinema | Companion | Companion | Cinema / consume | Silence; no spoilers; no lookups | Silent |
| Drinking coffee in a café | Barista or companion | Customer or friend | Café / consume and socialize | Light; work or chat is fine | Café |
| Eating in a restaurant | Companion or server | Friend or diner | Restaurant / consume | Dietary needs; ordering; do not rush | Service |
| Walking by the sea | Companion | Companion | Seaside / talk | Slow; open; no KPIs | Silent + camera |
| Meeting in a meeting room | Participant/scribe | Chair/colleague | Meeting room / decide | Agenda; turn-taking; minutes | Meeting |
| Working in the office | Colleague | Colleague | Office / produce | Focus; few interruptions; executable | Office |
| Attending a lecture | Classmate/TA | Speaker/audience | Lecture hall / learn | Do not interrupt; take notes; ask short questions | Study |
| Job interview | Candidate | Interviewer | Meeting room / decide | Neither servile nor arrogant; STAR; never invent experience | Interview |
| Medical consultation | Doctor's assistant | Patient | Clinic / care | Do not diagnose; recommend care; protect privacy | Care |
| Handling a complaint | Support agent | Customer | Online / transact | Emotion before problem; never promise what you cannot do | Service |
| Wedding | Guest | Couple/guest | Banquet hall / ritual | Bless; do not steal the spotlight; do not push drinks | Ceremony |
| Funeral | Mourner | Family | Funeral home / ritual | Restrained; accompany; no photos | Silent |

The table extrapolates further: interviewer's perspective, teacher and parent, landlord and tenant, doctor and family, driver and passenger, guide and tourist, barber and customer, bookseller and reader, trainer and trainee, gate agent and traveler, lawyer and client in court. The method is unchanged: **fill the five axes, fill the seven clauses, then choose the tool face.**

### 4.2 When axes conflict, who wins

Real scenes conflict constantly: walking by the sea with your boss — is this "reporting line" or "a walk"?

Rule: **each scene declares a dominant frame; the other axes only modify it.**

```yaml
dominant: relation   # With the boss by the sea: relationship dominates; the place only relaxes it
```

- Cinema: `dominant: place` — however close the two people are, they cannot discuss work loudly in the theater.
- Wedding: `dominant: occasion` — however senior the boss, today they are a guest.
- Emergency room: `dominant: activity` (care) — whatever the usual pleasantries, saving the patient comes first.
- Funeral: `dominant: occasion` — every relationship is downgraded to "mourner."

The dominant frame is not decoration; it decides which rule wins in a conflict. A scene without one breaks character at random the first time the axes disagree.

## 5. The scene card: what to inject, and where

The scene card has two layers, matching the two DSH injection mechanisms:

| Layer | Content | Change rate | DSH mechanism | Cache effect |
|---|---|---|---|---|
| Static card | Casting, place facts, rules, taboos, exit | Low | `dsh-persona` / system-prompt section | Stable prefix, cacheable |
| Runtime facts | Current time, who else is present, current goal, open threads, previous scene | May change every step | Dynamic context (user-role snapshot) | Append only changes; never rewrite the prefix |

This matches the existing `person-agent-dynamic-context` pattern: **static material goes into the system prompt, dynamic material goes into sourced user messages, and the dynamic part is diffed by section so only changes are appended.**

### 5.1 Scene card sketch (cinema)

```yaml
scene: cinema
casting:
  agent: companion
  user: companion
  relation: friend/partner
  power: equal
  intimacy: close
setting:
  place: cinema
  privacy: public-dark
  others: full audience
  props: [ticket, popcorn]
  norms: [phones on silent, whispers, no spoilers]
objective:
  shared: watch this film together
  agent: accompany; talk about it afterwards
interaction:
  formality: casual
  turns: whispers, short sentences
  taboo: [loud discussion, spoilers, leaving mid-film]
affordances:
  tools: []
  reason: no lookups, no work, no photos in the dark
memory:
  carryIn: [their favorite genres, the last film they saw]
  sceneLocal: [where this film is, their live reactions]
  carryOut: [impressions, the next plan]
exit:
  signals: [end credits, house lights]
  handoff: three-sentence summary
```

### 5.2 Put the static card in the persona, not in every turn

The static part of the scene card belongs in the system prompt, not in a per-turn append. Reasons:

- A stable prefix is what makes the KV cache hit.
- Rules belong to the persona, not to "the facts of this turn."
- Repeating them every turn teaches the model to treat them as noise.

Only runtime facts travel through dynamic context, and only their changes are appended. **Re-sending the static card every turn is the most common waste in scene design.**

## 6. The tool face: shape a scene with absence

More tools is not better. Every tool costs schema tokens and widens the chance of breaking character. A scene should decide **what not to give** first.

| Tool face | Contains | Fits | Explicitly withheld |
|---|---|---|---|
| `silent` | Nothing | Cinema, seaside, funeral, living room | Every tool |
| `companion` | Memory, `ask_user`, schedule | Visiting parents, looking after a child | Terminal, web, files |
| `cafe` | `read`/`glob`/`grep`, `web`, notes, schedule | Café, restaurant (chat mode) | Terminal, `edit` |
| `meeting` | Notes, `todo`, `present`, schedule, `ask_user` | Meeting room, lecture, interview | Terminal |
| `office` | `fs`, `fs-search`, `pwsh`, `jobs`, `working-directory`, `todo`, `present`, `subagent` | Office, production scenes | None (as needed) |
| `research` | `web`, `workflow`, `fs` | Research, fact-finding | Terminal (optional) |
| `service` | Domain tools (menu/order/ticket) + schedule | Restaurant, shop, support | General engineering tools |
| `care` | Record, remind, escalate to a human | Medical, support, counseling | Diagnosis, prescriptions, promises |

Three rules:

1. **Minimal by default.** Give only what the current activity requires.
2. **No `edit`/`bash`/`pwsh` outside production scenes.** Writing, reporting, and chatting do not need to change code.
3. **Anything that spends money, sends externally, or commits on the user's behalf needs approval in every scene.** That is the permission layer, not the scene layer.

## 7. Memory: roles continue, scenes isolate

| Layer | Content | Owner | Lifetime | Example |
|---|---|---|---|---|
| Persona | Language, values, address habits | Deployment/global | Long | Always speaks Simplified Chinese |
| Role | Relationship history with one person, taboos, important dates | Role/relationship | Long | Mom's checkup report, the boss's sore spots |
| Scene | Facts of this activity | Session | One scene | Where this film is |
| Handoff | Leaving summary | Explicit handoff | Until the next scene | "We talked about my cousin's wedding; ask how it went next time" |

Key rules:

- **Scenes are isolated by default.** Scene A's memory never appears in scene B on its own.
- **Cross-scene reads must be declared.** `carryIn` is an allowlist, not a capability.
- **Relationship memory is keyed by person, not by preset.** The existing `notebook` is per preset; if preset ≈ role, it can be reused directly. If one role spawns several scenes, an extra relation key is needed; otherwise the notes from "dinner with Mom" are unreadable in "taking Mom to the doctor."
- **A handoff is a summary, not a transcript.** Scenes pass written summaries, not whole conversations.
- **Privacy levels.** `public` / `internal` / `private` / `secret`; a scene declares the highest level it may read, and a violation fails loudly instead of "trying not to mention it."

The last rule is where things usually go wrong: an Agent does not "accidentally let something slip," but it will **carry scene A's context into scene B verbatim**. Privacy must be structural, not a prompt reminder.

## 8. Switching scenes: exit, handoff, entrance

### 8.1 Why not hot-swap

- The system prompt is a cacheable stable prefix; rewriting it mid-session invalidates the cache and confuses the model.
- Adding or removing tool schemas mid-session makes "what I can do" drift.
- The memory boundary needs one clean cut.
- The user must see that the scene changed; otherwise the behavior change reads as a bug.

### 8.2 Switching mechanisms

| Need | Approach | DSH mechanism |
|---|---|---|
| Enter a new scene | New session + target preset | `session_create` |
| Change role with context | Fork + explicit `presetId` | `session_fork_with_options` |
| Sub-scene within one scene | Keep the preset; append a scene-card section | Prompt section / context |
| Return to an old scene | Resume the old session, or fork from it | Resume / fork |
| End a scene | Leaving summary + archive | `scene_exit` tool + archive |

### 8.3 A proposed `scene_switch` tool

```ts
scene_switch({
  to: 'office',                 // Target scene id
  handoff: 'Finished dinner with Mom; we agreed I would take her for the checkup next Wednesday.',
  carry: ['checkup report', 'next Wednesday'], // Explicitly carried memory keys
})
```

It does four things: write the leaving summary, fork the current session, mount the target preset, and put the summary in as the new session's first scene card. It returns the new session id.

**Entrances need ritual too.** The first sentence in a new scene should speak in that scene's voice, not "Switched you to the office scene." The latter is a system notification; the former is a scene.

## 9. Landing on DSH: what a scene preset looks like

A scene preset is an ordinary Cordis plugin tree:

```yaml
- id: scene-cinema
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: cinema
    name: Watching a Movie
    description: A quiet companion in a cinema: no lookups, no work, a conversation after the credits.
    order: 30
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: |
            You are in a cinema, the user's companion. The lights are down and the screen is bright.
            You speak softly and briefly; you do not know the plot and do not pretend to.
          suffix: |
            Do not look anything up, do not work, do not take photos. Talk about the film afterwards.
      - id: scene-context
        name: '@veren/scene-context'   # Proposed: runtime scene card
        config:
          scene: cinema
          inject: [runtime, openThreads]
      - id: tool-ask-user
        name: '@deepseek-ai/dsh-tool-ask-user'
```

Note the absence of `tool-fs`, `tool-web`, and `tool-pwsh`. **The tool face's absence is enforced by composition, not by the prompt's good behavior.**

### 9.1 `scene-kit`: compile a scene spec into a preset

The proposed `@veren/scene-kit` exposes one pure function:

```ts
export interface SceneSpec {
  id: string
  name: string
  dominant: 'relation' | 'place' | 'activity' | 'occasion'
  casting: { agent: string; user: string; relation: string; power: 'low' | 'equal' | 'high'; intimacy: 'stranger' | 'acquaintance' | 'close' }
  setting: { place: string; privacy: 'public' | 'semi' | 'private'; others?: string[]; norms: string[] }
  objective: { shared: string; agent?: string; success: string[] }
  interaction: { formality: 'casual' | 'neutral' | 'formal'; turns: string; taboo: string[] }
  tools: ToolFaceName
  memory: { carryIn: string[]; carryOut: string[] }
  exit: { signals: string[]; handoff: 'summary' | 'none' }
}

export function buildScenePreset(spec: SceneSpec): PresetDefinition
```

Mapping:

| SceneSpec field | Output |
|---|---|
| `casting` | Opening of `dsh-persona.prefix`, plus address form and stance |
| `setting` + `interaction` | Persona rule block + hard constraints in the suffix |
| `objective` | Persona goal block + scene card |
| `tools` | Tool row list (looked up from the `ToolFace` table) |
| `memory` | Scene card `carryIn` + notebook/storage config |
| `exit` | Exit rules in the suffix + optional `scene_exit` tool |

Adding a scene then costs **one object**, not a plugin tree. Tool faces, validation, and defaults live in the kit.

### 9.2 Validation rules (fail loud)

- Any of the seven clauses missing → reject the build.
- `casting` missing the agent or the user → reject.
- No `dominant` declared → reject.
- Unknown tool face → reject.
- A high-stakes scene (medical/legal/financial) with no human-escalation path → reject.
- Two scenes declaring the same `id` → the registry already fails; do not swallow it.

## 10. Code layout and delivery path

```text
plugins/scene-kit/        # SceneSpec types, tool faces, buildScenePreset, validation (pure logic)
plugins/scene-context/    # Runtime scene card: static block + dynamic facts + per-section diffing
plugins/scene-switch/     # scene_switch tool: leaving summary + fork + mount
plugins/scene-catalogue/  # Scene specs (no runtime), twelve to start
```

Per AGENTS.md: at most five source files per package, at most 300 lines per file, at most 30 lines per function. `scene-kit` is pure logic and does not depend on the Host; `scene-context` reuses the per-section change detection of `person-agent-dynamic-context`; `scene-switch` reuses the preset-mount path of `session_fork_with_options`.

| Phase | Deliverable | Acceptance |
|---|---|---|
| P0 | `scene-kit` + four scenes (visiting parents, reporting to the boss, cinema, meeting room) | Unit tests: seven-clause validation, tool-face mapping, absence assertions |
| P1 | `scene-context` | Unit tests: static/dynamic split, append-only changes, stable cached prefix |
| P2 | `scene-switch` | E2E on a real Host: fork with a new preset, handoff summary appears in the new session |
| P3 | Scene catalogue + GUI picker | Users see scene names/icons/descriptions; entering and leaving is announced |

Tests follow the repository conventions: `*.spec.ts` runs on vitest; `*.e2e.ts` runs against a real Host and skips without credentials. Behavioral acceptance should be **observable assertions**:

- The cinema tool list contains no `web`/`fs`.
- Reporting to the boss never emits terminal commands.
- After a scene switch, the new session's first scene card contains the handoff summary.
- Scene A's notebook is unreadable from scene B.

"Does it feel right" is hard to test; "did it cross a line" is testable. Test the latter first.

## 11. Risks and open questions

| Risk | Description | Mitigation |
|---|---|---|
| Scene explosion | One prompt/tool set per scene is expensive to maintain | Reuse axes + roles + tool faces; generate instead of hand-writing |
| Token cost | Scene cards and tool schemas consume context | Static card ≤400 tokens; minimal tool faces |
| Cache invalidation | Dynamic facts rewrite the prefix | Static in the prefix; dynamic append-only |
| Casting confusion | Users do not want to role-play | Default to "the user is themselves"; only explicit casting puts them in character |
| Safety | Medical/legal/financial scenes pretend expertise | Disclaimers + human escalation + no diagnosis or promises |
| Cultural variation | Address forms and taboos vary by region | Locale variants of the scene card |
| Evaluation | "In character" is not measurable | Test observable behavior only: tools, taboos, handoff, privacy |
| Multiple roles at once | Boss + friend + parent in the same room | Dominant frame + explicit precedence; split the scene when needed |
| Memory consent | Private facts carried across scenes | `carryIn` allowlist + visible and editable |

Open questions:

1. Scene granularity: one preset per scene, or switchable sub-scenes inside a preset? This document leans toward "one scene per session; sub-scenes add a scene-card section without changing the tool face."
2. Who owns relationship memory: the person, the role, or the preset? The existing notebook is per preset and needs an explicit ownership decision.
3. Named tool faces versus free composition per scene? Named faces are validatable and reusable; free composition is flexible but hard to test.
4. Who owns the catalogue: a built-in bundle, user-created scenes, or both?
5. How do users author scenes: YAML, GUI, or conversation?
6. Should a "scene consistency" checker flag lines that do not belong to the current scene?
7. Parallel scenes: the same person in "the office" and "the family group chat" at once — how is memory isolated?

## 12. One sentence

A role gives you continuity; a scene gives you presence. The preset packages both, and the session makes it happen. A scene succeeds not when the lines sound right, but when the **tools, memory, and permissions** actually change with it.
