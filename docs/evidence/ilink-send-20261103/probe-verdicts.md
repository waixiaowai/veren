# iLink single-variable probe matrix: verdict sheet (2026-11-03)

> Environment: production box, recording proxy `127.0.0.1:19090` →
> `https://ilinkai.weixin.qq.com`; each cell changes exactly one factor and every
> exchange lands in the recorder
> (`docs/evidence/ilink-send-20261103/probe-matrix.jsonl`).
> Token: the current token of bot `959aef235f2b@im.bot` (fingerprint
> `sha256:12797c93e7 len=58`). Triggered around 2026-11-03T02:17Z.

## Verdicts

| Cell | Factor | Observation | Verdict |
|------|--------|-------------|---------|
| `baseline` | control (notifystart + 132102 + context) | notifystart `{"ret":0}`; send 200 + `message_id` | **send face alive** (control holds) |
| `version-4102` | client version header set to 4102 | notifystart `{"ret":0}`; send 200 + `message_id` | **H2 falsified**: the value is not a gate; 132102 is a client convention |
| `no-context` | omit `context_token` | send 200 + `message_id` | **context_token not required**: delivery works without it |
| `no-notifystart` | do not call notifystart in this process | send 200 + `message_id` | **PARTIAL / undecidable**: the token had notifystart called by the service at 02:43:45 (recorded), so this cell cannot construct "never opened"; H1 remains neither falsified nor proven |
| `dead-token` | flip the last byte of the current token | notifystart `{"errcode":-14,"errmsg":"session timeout"}`; send the same | **negative control passes**: a dead token still yields `-14`, and the code is in `errcode`, not `ret` |
| `bad-target` | unresolvable recipient | send 200 + `{"ret":-3}` | **business refusal is distinguishable**: -3 ≠ -14 and must not be treated as session death |
| `old-token` | an older real token | not executed | **NOT-EXERCISED**: the only older token belongs to the TS direct account (`32beb5e8`, a different bot family); moving it to production exceeds the credential policy; see contract §6.4 |

## Conclusions (aligned with contract §4)

1. Request shape (version header, context_token) is **not** a `-14` gate; `-14`
   tracks token/session state only.
2. The `-14` body is `errcode:-14, errmsg:"session timeout"`; clients must read
   both `ret` and `errcode`.
3. `-3` is an unresolvable-recipient business refusal and must be handled
   separately from `-14`.
4. notifystart necessity still awaits a clean experiment (a freshly scanned
   token on which notifystart is never called).
