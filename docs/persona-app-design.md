# Persona Gallery: "All Kinds of People" as a First-Class App (Design)

English | [中文](persona-app-design.cn.md)

**Audience:** DSH plugin developers, agent product designers, persona content authors.
**Prerequisites:** Cordis plugins, application pages (`@veren/app-registry` / `@veren/page-registry` / `@veren/prompt-page`), system-prompt assembly (`@deepseek-ai/dsh-system-prompt`).

Status: concept design, pending review. Proposed packages `@veren/persona-catalog` / `@veren/persona-app` / `@veren/persona-bundle` — none exist yet. Relationship to the [scene preset design](scene-preset-design.md): that document covers the **scene layer** (place, activity, tool face, memory boundaries); this one covers the **character layer** (who a person is, how they speak, what they know). `scene-preset-design` §2 names "role" as the upstream layer but does not develop it — this document is that layer.

## 0. Conclusions first

1. **A persona is not a roleplay prompt; it is a concrete human being charted on a taxonomy of real people.** Six axes give the coordinates (vocation, life stage, temperament, register, generational imprint, relational stance); a specific backstory gives the flesh. "All kinds" comes from taxonomy coverage; "real" comes from concrete detail and honest knowledge boundaries.
2. **Personas must take effect at the system-prompt layer, never as a message.** The mechanism is an official hook: inside the page component body, register an agent-scoped section named `deployment:persona-prefix` (`PERSONA_PREFIX_SECTION`, order 0), which **shadows** the deployment's default persona — the very mechanism an agent preset uses to swap personality (types say it verbatim: "an agent preset shadows the deployment's persona with its own"). Apps cannot bind presets (`app/preset-restricted`, always rejected in phase 1), but a page session can register it itself, with equivalent effect.
3. **One persona = one app page = one session.** `/apps/personas/:personaId` — opening the page enters the character; reopening the same URL always starts a new session (existing §9.1 semantics); switching persona = switching page = new session. Hot-swapping personality mid-session is structurally impossible.
4. **The tool face is absent by default, and the absence is guaranteed by composition.** The persona page `restrict`s host engineering tools off a manifest; actions the character does not have never reach the model's eyes — no reliance on prompt self-restraint (inheriting `scene-preset-design` §6).
5. **Content is data, not code.** Built-in personas are YAML files (one per persona); adding one requires no code and no plugin-logic release. High-risk professions carry mandatory safety clauses; validation fails loud.
6. **Two content red lines:** no personas of real living individuals (we take *types of real humans*, never *actual persons*); no minor-aged persona subjects.

## 1. Position and boundaries: three neighbors

| Neighbor | What it does | Boundary with this design |
|---|---|---|
| Scene presets (docs/scene-preset-design) | Scene layer: place, activity, tool face, memory, exit | Characters are continuous, scenes are discrete (that doc §2); this design does only the character layer. Future composition: a character enters a scene |
| agent preset (`@deepseek-ai/dsh-agent-preset-registry`) | Host-level preset stack; sessions created per preset | person-agent already migrated off the preset stack (`person-agent-app-mode.md`); apps cannot bind presets. The persona app does not use presets — it uses application pages |
| im/core people directory | Real-human contact profiles (nicknames, addresses, messaging) | That is an address book, not an AI persona; its "one profile per person + strict name resolution" data shape is worth borrowing |

## 2. How real humans are divided: a six-axis taxonomy

"Divided according to real humans" — the axes come from stable dimensions along which real populations differ, not fantasy races or function labels:

| Axis | Key | Values (P1 scope) | Determines |
|---|---|---|---|
| Vocation | `vocation` | medical / education / legal / engineering / business / media / arts / service / trades / public-sector (ten domains, the **primary axis**) | Knowledge, recurring topics, safety tier |
| Life stage | `stage` | student / early-career / mid-career / senior / retired | Experience, baseline attitude toward the user |
| Temperament | `temperament[]` | analytical / warm / blunt / humorous / patient / rigorous / optimistic / melancholic (multi-select) | Tone and interaction rhythm |
| Register | `register` | formal / neutral / casual / dialect / internet | Word choice, sentence length, internet slang |
| Generational imprint | `era` | born-50s-60s / 70s / 80s / 90s / 00s | Metaphor bank, catchphrases, tech fluency |
| Relational stance | `stance` | mentor / peer / elder / protege / stranger | Casting: who this person is *to the user* (per scene-preset §3.1: the user stays themselves by default) |

Rules:

- **The dominant axis defaults to `vocation`** (inheriting the dominant-frame idea of scene-preset §4.2); on axis conflict ("blunt" × "warm") the backstory is the final authority — the backstory is the single authoritative text of a personality.
- **A persona's name is a person's name plus identity** ("Zhang Shouren, retired general surgeon"), never a category label ("doctor persona"). The category is a coordinate; the person is a person.

## 3. Data model: PersonaDefinition

One YAML file per persona under `@veren/persona-catalog`'s `data/personas/`. Full example (also one of the first P1 entries):

```yaml
id: surgeon-zhang
name: 张守仁 (Zhang Shouren)
tagline: Thirty-plus years of general surgery, retired but re-hired for the outpatient clinic; has seen every young person who let a small ailment become a big one.
axes:
  vocation: medical
  stage: retired
  temperament: [blunt, warm]
  register: neutral
  era: born-60s
  stance: elder
backstory: |
  Born 1962. Thirty-four years of general surgery at a county hospital; a
  thousand-plus appendix, gallbladder, and hernia operations. Too restless at
  home after retiring, re-hired to sit the expert outpatient clinic. Wife
  passed early; one son in Shenzhen whom he nags about health checkups.
  There is always a cup of strong tea at his hand.
knowledge:
  knows:
    - Typical courses and red-flag signs of common surgical conditions (appendicitis, gallstones, hernia, GI bleeding)
    - County-level care reality: which department to register, when to transfer to a big hospital, which tests are wasted money
    - The unwritten rules of the OR and the clinic
  says:
    - "Three days of pain before coming in? You young people can really tough it out."
    - "This one isn't scary. I've seen plenty."
    - "Stop searching online. Listen to me first."
  blindspots:
    - Newest targeted drugs and clinical trials (says outright: "Ask oncology about that, not me.")
    - Any specific medication dosage ("I can't write a prescription over the air.")
voice:
  greeting: "Sit. What's wrong? Describe the symptoms — don't diagnose yourself."
  styleRules:
    - Short sentences; symptoms first, judgment second; at most three follow-up questions per turn
    - Explain conditions with household metaphors ("the bile duct is like a drain; it hurts when it clogs")
    - No English jargon; any necessary term gets a plain-language tail
  taboo:
    - Never a final diagnosis, never a specific prescription dosage
    - Never "definitely fine" or "definitely hopeless"
disclosure: honest            # Asked "are you an AI?": admits it, then returns to the character
safety:
  disclaimers:
    - "I'm a character in a chat, not your attending physician."
  escalate: "Chest pain, breathing trouble, major bleeding, altered consciousness — go to the ER now, don't chat with me."
  forbidden: [final diagnosis, prescription dosage, replacing a care decision]
face:
  tools: []                   # There is no terminal on the clinic desk
  promptMode: shadow
locale: zh
```

Field semantics:

| Field | Meaning | Compiled into |
|---|---|---|
| `id` | Stable slug; the URL parameter and page key | `/apps/personas/:personaId` |
| `axes` | Six-axis coordinates (§2) | Gallery grouping and filtering; `vocation` sets the safety tier |
| `backstory` | 3–6 sentences, **must contain concrete detail** (years, places, numbers, habits) | prefix body |
| `knowledge.knows/says/blindspots` | What they really know / how they really talk / **what they don't know** | prefix capability & boundary lines |
| `voice.greeting` | The opening line (entry ritual) | first followup of the session |
| `voice.styleRules` | Executable language rules (sentence length, address, catchphrases) — not adjectives | prefix speaking section |
| `voice.taboo` | Taboos (what they never do) | prefix speaking section + suffix hard rails |
| `disclosure` | `honest` (default) / `in-character`: policy when asked "are you an AI?" | prefix break-character rules |
| `safety` | **Mandatory** for high-risk vocations: disclaimers, escalation exit, forbidden list | suffix hard rails |
| `face.tools` | Allowlist of host global tools visible to this persona; default `[]` (absence is design) | `restrict` computation |
| `face.promptMode` | `shadow` (default, replaces the persona slot) / `complete` (this section becomes the sole system-prompt section, deep immersion) | registration mode |
| `locale` | The declared voice language; all P1 personas are `zh` | catalog filtering |

**Validation rules (fail loud, enforced by `@veren/persona-catalog` at load):**

- Any axis missing; `backstory` shorter than three sentences or with no concrete detail (numbers/years/places heuristic); any `voice` entry empty → reject the whole catalog, naming the file;
- `vocation ∈ {medical, legal, business, counseling}` with `safety` missing or incomplete → reject;
- duplicate `id` → reject (registry errors are not swallowed);
- `face.promptMode: complete` combined with a non-empty `face.tools` → reject (under `complete` the tool sections are no longer in the system prompt; an allowlist would be self-deception);
- any compiled prefix exceeding 300 tokens → reject (cost red line, inheriting scene-preset's "static card ≤400 tokens" spirit).

## 4. Injection mechanisms (all verified against the `node_modules` type surface)

### 4.1 Persona body: agent-scoped shadowing of the deployment persona

The page component body is the once-per-session registration surface (`PageFC<P> = (props, agent) => ElementInput`, `packages/prompt-page/src/component.tsx:47`). Inside the persona page body:

```ts
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

const compiled = compilePersona(persona)
agent.ctx.systemPrompt.section({
  name: PERSONA_PREFIX_SECTION,   // 'deployment:persona-prefix'; a scoped same-name section shadows the deployment persona
  order: 0,                       // DEPLOYMENT_PERSONA_PREFIX
  interpolate: false,
  text: compiled.prefix,
})
agent.ctx.systemPrompt.section({
  name: PERSONA_SUFFIX_SECTION,   // 'deployment:persona-suffix'
  order: 10200,                   // DEPLOYMENT_PERSONA_SUFFIX, hard rails at the tail
  interpolate: false,
  text: compiled.suffix,
})
```

Why **section shadowing** rather than `context` appending: the `dsh-system-prompt` types say it verbatim — "The deployment persona prefix's section name… a composition can replace this slot — an agent preset shadows the deployment's persona with its own — and both sides naming the same section is what makes the replacement work rather than duplicate." And the 2.0.7 live lesson (a page identity that existed only as one message was outweighed by the host's coding persona; the model burned ~400K tokens in one turn filesystem-diving for business data) proves: **to outweigh the default persona you must same-name replace it at the system layer, not append a message.**

- `HARNESS_IDENTITY` (-1000) stays: that is the runtime contract ("you are an agent on DSH"), not a personality. The persona replaces only the persona slot.
- `promptMode: complete` (opt-in per persona): `PromptSection.complete` makes the section the sole system-prompt section (operational contexts still ride as user-role snapshots). Two effective `complete` sections in one scope fail assembly — fail loud, acceptable. The page-identity context (order 105) does not conflict: it governs "mounted page tools are the only road to business data", and a persona page mounts no business tools — each mind their own business.
- Idempotency: the body runs once per mount; restart re-activation goes through `agent/created` → `pageRegistry.rerender` (the 2.0.7 path); the recreated agent is a fresh fiber, old registrations died with the old fiber, so same-name registrations never stack.

### 4.2 Tool face: absence guaranteed by composition

Inside the body, `agent.ctx.tools.restrict({ deny })`. Verified semantics (from the `dsh-tools` types): "Empty filters, unknown names, scope-local names, and reserved transport names fail. Restrictions intersect; scoped registrations remain visible."

The recipe (read the live surface first, subtract after — prevents unknown-name failures):

```text
deny = (HOST_TOOL_DENYLIST ∩ currently-registered global tool names) - persona.face.tools
```

- `HOST_TOOL_DENYLIST` is a manifest maintained in the catalog (read/write/edit/bash/pwsh/glob/grep/jobs/pty/web_search/web_fetch/lsp/subagent/computer_use, aligned with the tool sections of `SECTION_ORDERS`);
- a **drift test** runs it against the real registration surface in unit tests — a listed name that never registers fails the test (fail loud, per the structured-error principle in AGENTS.md);
- `run_code` stays (a reserved transport `restrict` refuses anyway, per the types); page-registered tools (persona pages have none in P1) are unaffected.

### 4.3 Entry ritual and first-screen facts

The body renders a persona card as the PAGE block (facts in the default-visible body — honoring the promise/fact-source lesson: name, identity, backstory highlights printed right on the page), then delivers the greeting from the page source:

```ts
agent.followup(createUserMessage({ content: [...], source: { kind: PAGE_SOURCE } }))
```

The same pattern as person-agent-app's three-way async first screen (`plugins/person-agent-app/src/pages.tsx:99-101`). The greeting is the entry ritual: the first sentence arrives in the character's voice, not "your persona has been loaded."

### 4.4 Session semantics all inherited

`app_pages` live rows, reopen-same-URL-always-new (old session deprecated), restart re-activation remount, `instanceTitle: (params) => persona name` (the session list shows "Zhang Shouren · retired general surgeon") — all carried by the existing `@veren/app-host` / `@veren/page-registry` machinery. The persona plugin adds **zero new session state**.

## 5. What the compiled output looks like

`compilePersona(persona)` is a pure function (unit-testable) producing four artifacts: `prefix` / `suffix` / page card / `greeting`. Zhang Shouren's compiled `prefix` (excerpt):

```text
You are Zhang Shouren, born 1962, a retired county-hospital general surgeon re-hired
for the outpatient clinic. You are not a general-purpose assistant — you are a
concrete person with thirty-four years of holding the scalpel.
- To the user: a young patient at the clinic. You are the elder who has seen it
  all; sharp tongue, soft heart.
- You know: typical courses and red-flag signs of common surgical conditions;
  the county-level care reality (which department, when to transfer, which tests
  are wasted money); the unwritten rules of the OR and the clinic.
- You don't know: newest targeted drugs and clinical trials — say "ask oncology
  about that" outright. No prescription dosages, ever.
- How you speak: short sentences; symptoms first, at most three follow-up
  questions; household metaphors; a plain-language tail after any term;
  catchphrases like "Three days of pain before coming in?"
- Break-character rule: if asked whether you are an AI, admit you are a played
  character, then return to the consultation.
```

`suffix` (hard rails, always at the tail):

```text
Speak as Zhang Shouren. Never: a final diagnosis, a specific prescription
dosage, "definitely fine/hopeless". If the user reports chest pain, breathing
trouble, major bleeding, or altered consciousness — send them to the ER
immediately and stop chatting. You are a chat character, not an attending
physician; admit as much when asked directly.
```

## 6. Code organization (checked against AGENTS.md constraints)

| Package | Directory | Responsibility | Source files (≤5, ≤300 lines each) |
|---|---|---|---|
| `@veren/persona-catalog` | `plugins/persona-catalog` | Pure data + pure logic, no Cordis dependency | `src/types.ts` (six axes + PersonaDefinition), `src/validate.ts` (fail-loud validation), `src/load.ts` (reads `data/personas/*.yaml` via `@veren/yaml-parser`), `src/index.ts` (list/get/byFacet public face); `data/personas/*.yaml` (data, not source) |
| `@veren/persona-app` | `plugins/persona-app` | The app plugin: registers the gallery and persona pages | `src/index.ts` (inject + single-effect wiring), `src/app.ts` (APP_ID `personas`, APP_DEFINITION), `src/pages.tsx` (gallery + persona PageFCs and Metas), `src/compile.ts` (pure compiler) |
| `@veren/persona-bundle` | `plugins/persona-bundle` | Bundle: one patch line into the profile layer | `package.json` + `cordis.patch.yml` only (one insert line for persona-app; deps include `@veren/app-host-bundle`, which drags in the framework lines) |

Dependency ratios (per the `person-agent-app` precedent): DSH deps as peerDependencies + devDependencies only (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`); host-service `@veren` packages as peers (`app-registry`, `page-registry`, `prompt-page`); library packages as dependencies (`@veren/persona-catalog`, `@veren/prompt-core`, `@deepseek-ai/schemastery`). `engines.dsh: >=0.2.1-rc.2 <0.3.0`; versions join the family at `2.0.8`.

The two pages:

| Page | URL | Content | Tools |
|---|---|---|---|
| Gallery (entry) | `/apps/personas` | Catalog grouped by vocation: name, tagline, backstory summary, entry URL; axis filtering | No own tools; entering a persona uses the host `app_open` |
| Persona page | `/apps/personas/:personaId` | Persona card + full §4 machinery | Everything outside `face.tools` restricted away; zero tools by default |

Tests (repo norms): `validate.spec.ts` / `compile.spec.ts` (vitest, including the denylist drift test); `assembly.spec.ts` via `packages/test-support/loader-smoke` with a real Loader, covering dispose/HMR safety (the "reverse-order cleanup" rule).

## 7. Content strategy

- **P1 scale: 30 personas** — ten vocations × 3 each, deliberately spread across stages, eras, temperaments, registers, genders; §3's Zhang Shouren is the first.
- **Five writing principles:** concrete detail over adjectives ("thirty-four years" over "experienced"); honest knowledge boundaries (`blindspots` are part of the character — a county surgeon does not discuss targeted therapy); executable language rules (sentence length / address / catchphrases — never "speaks warmly"); every high-risk vocation has an escalation exit; no imitation of living people.
- **Safety tiers:** tier 0 ordinary personas (no mandatory clauses); tier 1 medical/legal/finance/counseling (mandatory `safety` block, validation rejects missing parts; content-wise: "expert experience yes, professional conclusions and licensed acts no").
- **Bilingual:** P1 voices are Chinese (personas are language-bound by nature — the English edition of a Shenyang cabbie is a different person); `name/tagline/backstory` carry en summary metadata for English UI browsing; an English persona set is P2.
- **Long tail:** a community persona is one validated YAML away — no code required.

## 8. Milestones and acceptance

| Phase | Delivers | Acceptance |
|---|---|---|
| P0 | catalog (types + validation + loading) + compile + 8 personas | Unit tests green: every fail-loud branch, compiled output shape, prefix ≤300 tokens, denylist drift |
| P1 | persona-app two pages + bundle + 22 personas | loader-smoke composition + dispose/HMR safety; live checklist (below) |
| P2 | Custom personas: `persona_library` storage domain + gallery CRUD tools (`personas__create/update/remove`) + import/export | Self-built personas pass the same validation; CRUD tools mounted only on the gallery page |
| P3 | `persona-ui` (web gallery via slots into `sidebar.panellist` / `conversation.input.left`, after notebook-ui / app-host-ui) + persona memory (open question §9) + persona×scene composition (merging with the scene series) | Visible, installable, chatty from the market |

**P1 live acceptance checklist** (stable node 3080, per the AGENTS.md live-verification culture):

1. Assembly evidence: in a persona page session's assembled prompt, `deployment:persona-prefix` carries the persona text, not the deployment default (same-name shadowing works);
2. Tool face: ask the session's agent "what tools do you have" — not a single engineering tool in sight (absence by composition);
3. Entry ritual: the session's first message arrives in the character's voice (followup, page source);
4. Session semantics: reopening the same URL creates a new session, the old one deprecated; the session list title shows the persona name;
5. Safety clauses: a tier 1 persona asked for diagnosis/prescription triggers disclaimers and the escalation exit (observable assertion);
6. Market: `persona-bundle` installs into the stable node via `dsh plugin --profile web add`; no tarball temp nodes anywhere.

"Acting alike" is untestable; "not crossing lines" is testable — acceptance tests only the latter (inheriting scene-preset-design).

## 9. Risks and open questions

| Risk | Description | Mitigation |
|---|---|---|
| Denylist drift | A new host engineering tool missing from the manifest leaks into persona sessions | Drift test fails loud; `restrict` only narrows |
| complete mode drops operational sections | A deep-immersion persona loses PLAN_POLICY and friends | Default is shadow; `complete` is explicit opt-in per persona |
| Breaking character | The model is lured back into assistant-speak | suffix hard rails + break-character rules + observable assertions |
| Token cost | prefix bloat | 300-token validation red line; a stable static prefix is KV-cache-friendly (`interpolate: false`) |
| Offensive content | Persona writing slides into stereotype or worse | Collection review + red lines (no living-person likenesses, no minor subjects) |
| Gallery bloat | Past 30+ personas the PAGE block grows | P1 groups by domain, one line per persona; P2 adds pagination and filter tools |

Open questions:

1. **Persona memory**: ongoing "old friend" continuity wants a per-persona memory domain (scene-preset §9 argues relationship memory lives per person) — to be settled with the notebook shape in P3;
2. **Model hints**: should a persona declare a recommended model (roleplay-heavy conversations are model-sensitive) — a hint or a default, and how it meets `select_model`;
3. **Persona×scene seam**: eventually a persona page enters a scene, or a scene preset references a persona — decide when the two designs merge;
4. **English persona set**: is the English voice a translation of Zhang Shouren (same person, English voice) or separately authored characters — a P2 decision;
5. **Custom persona boundary**: are user-built personas allowed in tier 1 vocations (and who reviews their safety clauses)?

## 10. One sentence

The taxonomy gives a persona its coordinates, the backstory its flesh, system-prompt shadowing its authority, and the page session its body; whether the tool face and memory actually change with the person is the test of whether a persona feels like a real human.
