# Prompt Core

English | [中文](./README.cn.md)

## What & When to Use

React-style reconciler kernel for LLM prompt streams — the `react` of this architecture. Use it to author pages as function components whose diffs become append-only context effects. It knows nothing about message formats or LLM providers; pair it with `@veren/prompt-host-messages` (the `react-dom`). Not for business logic — domain stores and buttons live in consumers.

## Concepts → React mapping

| prompt-core | React | Notes |
|---|---|---|
| `createElement(type, props)` | same | `key` lifted from props; objects frozen |
| `Component` `(props) => PromptElement[]` | function component + Fragment | returning an array is a fragment |
| `memo(component, areEqual?)` | same | canonical comparison by default → whole-subtree bailout, zero effects |
| `reconcileChildren` | fiber diff | same type at same slot → update; type change → remount; keyed elements matched across slots |
| `scheduleRender(root, elements, lane)` | render+commit | render phase is pure and discardable; commit is atomic via the host |
| `lane: sync / transition / background` | lanes | background effects buffer in `root.pending` until a sync commit or `flushBackground` |
| `bindStore(root, store, mapState)` | `useSyncExternalStore` | authoritative external store → re-render → commit |

## Immutability Discipline

Effects are computed by comparing props/content with `canonicalJson` (sorted keys). Fibers bail out on reference equality (memo semantics). Always replace changed data with a fresh copy before re-rendering — in-place mutation of the previous tree's data makes the diff see "no change".

## Run

```bash
pnpm --filter @veren/prompt-core test
```
