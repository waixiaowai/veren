# @veren/workbuddy-protocol

The WorkBuddy (CN, copilot.tencent.com) and WorkBuddy AI (international,
workbuddy.ai) upstream wire protocol as a **zero-host-dependency pure library**:
the region table, OAuth device-code sign-in, rotating token refresh, device
fingerprint derivation, the multi-account pool, display-layer redaction, the
upstream client (chat / catalog / billing / probe), and the body dialect.

**When to use it**: any plugin or tool that must talk to the WorkBuddy /
CodeBuddy upstreams directly; the DSH shell plugin `@veren/workbuddy-auth` is its
first consumer. The sole contract surface for protocol facts is
[docs/workbuddy-protocol.md](../../docs/workbuddy-protocol.md) (Chinese edition
[docs/workbuddy-protocol.cn.md](../../docs/workbuddy-protocol.cn.md)) — change the
document before changing wire behavior.

**How (faces, not a tutorial)**: import from `@veren/workbuddy-protocol`; every
module's header comment states its responsibility and risk-control constraints.
The tests (`pnpm test`) replay the measured shapes in `tests/fixtures/` offline —
a second, executable document.

```bash
pnpm --dir packages/workbuddy-protocol test    # vitest, never touches the network
pnpm --dir packages/workbuddy-protocol build   # tsc → dist/
```
