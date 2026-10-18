# @deepseek-ai/dsh-graph-flow-canvas-node-echo

A minimal standalone DSH client plugin that registers one custom renderer for the
`echo` node type in the Flow Canvas panel. It exists to prove the panel's
`flow.canvas.node` extension point: install it to see both demo echo nodes switch
to a distinct card, uninstall or disable it to fall back to the panel's default
card. The registration is owned by the plugin fiber and is HMR-safe.

## Install

It requires the canvas panel in the same profile. Then:

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-node-echo-0.1.4.tgz
```

Restart `dsh web` (or disable the plugin row) and reopen the panel. The two
`echo` nodes (`recover` and `normal` in the demo) render the custom card; the
other node types keep the default card.

## What it contributes

- One locale namespace (`flowCanvasEcho`) with Chinese and English dictionaries.
- One keyed registration: `ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({ name: 'flow.canvas.node', key: 'echo', locale: NS }, EchoNode))`.
- No Host code, no transport, no state: this is the smallest useful extension.

The card receives the slot's owner props — `node`, `runtime`, `selected`,
`onSelect` — and renders the node's live status plus an **extension renderer**
badge identifying the custom renderer.

## Tests

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo test
```

The suite mounts the plugin on the real slot registry and asserts the `echo`
entry appears and disappears with the fiber (HMR), and that both dictionaries
share one key set.
