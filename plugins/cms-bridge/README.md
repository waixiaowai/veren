# @veren/cms-bridge

[English](./README.md) | [简体中文](./README.cn.md)

> Requirements: `docs/designer/REQUIREMENTS-plugin.md` (acceptance P1–P10). Server counterpart: `docs/designer/REQUIREMENTS-server.md`.

A Cordis plugin that keeps one long-lived WebSocket connection from a Node-side DSH host to a CMS server: it authenticates with a CMS credential, reconnects automatically after a drop, dispatches server commands to locally registered action handlers with per-command timeouts, reports plugin events with offline replay, and exposes a runtime status snapshot for observability.

## Use it when / not when

- **Use it when** a Cordis host must stay attached to a CMS server (long-lived command channel + outbound event channel) and you want reconnect/parking/backoff handled for you.
- **Skip it when** you only need one-shot HTTP calls, or you want the mapping table to live on the server — here the plugin itself declares what it can run (requirement 8).

## Install

```bash
pnpm add @veren/cms-bridge
```

## Configure

```ts
import { Context } from '@deepseek-ai/cordis';
import * as CmsBridgePlugin from '@veren/cms-bridge';

const ctx = new Context();
await ctx.plugin(CmsBridgePlugin, {
  url: 'wss://cms.example/ws',
  token: process.env.CMS_API_KEY!,   // user API Key or a long-lived exchanged credential
  commandTimeoutMs: 30_000,
  reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 },
  credentialCloseCodes: [4001, 4401],
});
```

| Option | Default | Meaning |
|---|---|---|
| `url` | *(required)* | CMS WebSocket endpoint |
| `token` | `''` | Credential sent as `Authorization: Bearer …` |
| `commandTimeoutMs` | `30000` | Per-command execution timeout (P6) |
| `reconnect` | `1s → ×2 → 30s` | Backoff for automatic reconnect (P2) |
| `credentialCloseCodes` | `[4001, 4401]` | Close codes treated as a dead credential → parked state (P3) |

## Use

```ts
import { CmsBridge } from '@veren/cms-bridge';
const bridge = ctx.get(CmsBridge)!;

// Declare an action mapping — the server needs no change when you add one (P10).
bridge.registerAction('shell.exec', {
  validate: (payload) => (typeof payload?.['command'] === 'string' ? null : 'payload.command must be a string'),
  handler: async (payload) => run(payload['command']),
});

// Report an event — queued and replayed in order when offline (P6/P7/P8).
bridge.report('host.ready', { version: '1.0.0' });

// Inspect runtime state (P9).
bridge.status(); // { state, reconnectAttempts, pendingEvents, inflightCommands, … }

// Rotate the credential — reconnects from the awaiting-credential state (P3).
bridge.setCredential('new-long-lived-token');
```

## Behavior guarantees

| Guarantee | Where |
|---|---|
| Unknown action → explicit `UNKNOWN_ACTION` failure, never swallowed (P5) | `src/dispatcher.ts` |
| Every command has its own timeout; a stuck handler never blocks later commands (P6) | `src/dispatcher.ts` |
| Offline events queue in FIFO and replay exactly once in order (P8) | `src/reporter.ts` |
| Credential failure parks the bridge (no infinite retry) until reconfiguration (P3) | `src/connection.ts` |
| Key nodes logged + `cms-bridge/status` event broadcast (P9) | `src/connection.ts` |

## Web UI

The bundle ships a Client module that mounts on the plugin's detail page (Plugins → Veren CMS Bridge) with two sections:

- **Connection status card** — live state (`connected / connecting / reconnecting / awaiting-credential / …`) with a color dot, credential fingerprint, uptime, reconnect attempts, pending-event and in-flight counters, and the last error. Polls `GET /cms-bridge/api/status` every 3s (same-origin, no extra auth).
- **API Key configuration** — a secret input that persists through `configEditor` into the profile patch (`POST /cms-bridge/api/credential`); the Loader hot-reloads the plugin, which reconnects with the new credential. The raw value is never rendered back; only the fingerprint.

Both APIs are mounted only when the host provides a `webServer` (the DSH web/desktop profiles do); on plain CLI hosts the plugin logs a warning and runs without them.

## Development

```bash
pnpm build   # tsc
pnpm test    # vitest run (offline, fake sockets; no real CMS needed)
```

Tests use a programmable fake socket, so every acceptance path runs locally without a network.

## License

See the workspace root.
