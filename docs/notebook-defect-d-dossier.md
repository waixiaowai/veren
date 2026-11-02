# notebook defect D dossier (note detail page tool face never lands)

Status: mechanism mapped, ruled-out list on file, prime suspect pinned on isolate/fork resolution — **one instrumented live run from conviction** (recipe §5)
Related: `docs/acceptance/notebook-4.0.0-rc.1/acceptance-report.md` §2 (blame), forensic audit `docs/notebook-audit-results.md` (N1: the lifecycle face's zero live usage is ROOTED HERE — promote/archive are page-scoped and the page face never came up)
Lane: page-registry / app-host (clean at writing time; unoccupied)

## 1. Symptoms (live node 3080, per acceptance)

1. Opening `/apps/notebook/note/:noteId` by any path → `detail page "notebook/note" registered no tools; its write duty cannot be fulfilled` (page-registry §3.10.5 rule-3 mount audit, `open-page.ts:288`).
2. The body's six `agent.ctx.tools.register` calls (pages.tsx:127-132) all execute without throwing, yet the mount snapshot delta is zero (before==after).
3. **Indeterminate across boots**: sessions created in the restart#2 era showed 7 tools at model assembly (including body-registered list_hubs/box_stats); the same flow after restart#3 shows zero.
4. The list page is unaffected — but that is an **audit-blind-spot illusion**: the audit only fires on "parameterized URL + writes:true" (open-page.ts:288); and the list page's body-registered names equal the global five (M1 design), so landing is invisible there anyway.

## 2. Mount-chain mechanism map (file:line all on file)

```
gateway.open (gateway.ts:153) → pageRegistry.openUrl → createPageSession (open-page.ts:169)
  ① reserveRow (row state=reserved)                     open-page.ts:184
  ② createSessionOrRollback → port.create → openPageSession (session-port-open.ts:73)
       agents.create → agent/created (serial await) → remountPageAgent (page-identity.ts:102)
         → rerenderLivePage (guard: row state!=='live' skips → fresh create never double-renders)  page-rerender.ts:63
         → attachPageIdentity (reserved rows match too)
       handles.hold → agent.ctx.tools.restrict({deny:[app_open,app_list,app_pages]})  session-port-open.ts:83
  ③ renderAndCommit → renderOnce (open-page.ts:262)
       before = toolFace(sessionId)                     ← read A
       body = match.live.mount(params, agent)           ← six synchronous registers (pages.tsx:127-132)
       pageTools = collectPageTools(before, toolFace())  ← read B (open-page.ts:282)
       audit: parameterized+writes+empty delta → DetailInvalid       open-page.ts:288
```

Real-face semantics (dsh-tools 0.2.1-rc.2; root and profile versions verified identical):
- `register` → `ScopedLayers.effect(this.ctx, …)`: layer key = `scopeOf(this.ctx)` (dsh-scope), **synchronous** insert (the vendor fiber `_execute` runs sync generators inline — vendor/cordis/src/fiber.ts:375-382, matching the node_modules copy; the async-seam hypothesis is dead).
- `schemas(scope)` → `view(scope)` **recomputed fresh, no cache** (index.js:3055): own=`peek(scope)` + inherited chain (restrict filters the inherited surface only; the own layer is exempt).
- `toolFaceOf` = `agent.ctx.tools.schemas(scopeOf(agent.ctx))` (session-port.ts:80-82).

## 3. Ruled out (each with evidence)

| # | Hypothesis | Evidence |
| --- | --- | --- |
| X1 | Registrations land asynchronously (microtask seam) | vendor fiber `_execute` drives sync generators **inline to completion** (fiber.ts:375-382); ScopedLayers.effect's generator has no yield |
| X2 | Stale view cache | `view()` recomputes every call (dsh-tools index.js:3055); no cache/invalidation |
| X3 | Installed dist drifts from source | profile app-host/page-registry dist carries all HEAD markers (collectPageTools/rerenderLivePage/schemas(scopeOf/restrict({deny); versions 2.2.1 both; dsh-tools root and profile both 0.2.1-rc.2 |
| X4 | register throws (output contract) | a throw would abort the body — forensics counted six calls; and the error face would be SessionCreateFailed, not DetailInvalid |
| X5 | Remount races in and consumes the one-shot | rerenderLivePage skips reserved rows (`state!=='live'`, page-rerender.ts:63); even if it raced, renderOnce has no WeakSet check and would render **again** (non-zero delta) — contradicts the zero-delta signature |
| X6 | collectPageTools defect | a plain name diff (page-block.ts:64-66), no filtering |
| X7 | Composition tests should have caught it | **the fixtures admit it**: app-host.harness.ts:11 "ToolRuntime's scope layer is out of scope here"; page-registry runtime.harness.ts:34's fake toolFace is only "assumed isomorphic" — the real-face scope semantics have **zero test coverage** |

## 4. Prime suspect: instance/layer misalignment under per-session service isolation

The vendor cordis `Service` resolution is **isolate-filtered** (vendor/cordis/src/service.ts:64-66):

```ts
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

And the standard preset is exactly "per-session service realms" (memory dsh-session-isolation-patterns: preset isolate = per-session service realms). If `tools` is isolated in the session realm:

- `agent.ctx.tools` may resolve to **different instances or different `this.ctx`** at the four moments: restrict (inside create) / register (inside mount) / snapshot (renderOnce) / model assembly (first turn) — depending on the lazy materialization timing of the isolate fork.
- If a fork's `this.ctx` is not agent.ctx itself (the isolate child fiber's ctx), the registration lands in layer `scopeOf(forkCtx)` ≠ `scopeOf(agent.ctx)`; the snapshot reads the latter → **the registration lands in an orphan layer**.
- The cross-boot indeterminacy = the race between isolate-fork materialization and first-turn assembly swings with boot timing (in the restart#2 era the assembly read an instance that already held the registrations).
- Corroboration: the live restrict did NOT throw "requires a scoped context" (restrict requires `scopeOf(this.ctx)≠undefined`, dsh-tools index.js:2989) — so the instance's `this.ctx` at restrict time need not be the one at register time.

## 5. Conviction experiments (one instrumented run, in order)

1. **Four-moment instance fingerprints** (preferred; one restart + one GUI open convicts): a temporary diagnostic patch (per the acceptance TEMP-DIAG recipe) logging at four points in session-port: before/after restrict, before/after the mount in renderOnce, and at first-turn assembly — each printing the `agent.ctx.tools` instance identity (e.g., a minted instance id) and `scopeOf(that instance's this.ctx)`. Inconsistent instance ids or scope keys across the four → convicted.
2. **Read the model-assembly channel**: how dsh-agent-loop resolves the model's tool list (which instance/scope) — if it diverges from toolFaceOf's channel (instance or scope key), the fork between "snapshot zero" and "model sees them later" is fully explained.
3. **loader-smoke reproduction** (no GUI): the standard preset + a probe plugin through the real loader, asserting four-moment consistency inside the probe; isolated temp DSH_HOME (script-created, deleted after).
4. Fix shape (pick one after conviction, minimal face): toolFaceOf re-routed through the **same resolution channel** as model assembly; or the mount returns registration handles instead of relying on the global accessor; or restrict/register unified to after fork materialization (completed within the agent/created serial await).

## 6. Acceptance hooks after the fix

- Unit tests: real-face ToolRuntime + real isolate topology scope-layer tests (filling the blind spot admitted at harness.ts:11), asserting "restrict → body register → immediate schemas visibility".
- Live: notebook 4.0.0-rc.1 checklist items ③⑤⑥ re-verification (acceptance-report §2) + the forensic audit's PR1-PR3 preconditions unlocked.
