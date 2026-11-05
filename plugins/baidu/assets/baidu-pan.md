# Baidu Netdisk operations (baidu_pan__*)

Operates the signed-in Baidu Netdisk account through the `baidu_pan__*` tools. Everything lives under the app's **authorized root** — displayed to users as `我的应用数据/…`. Paths outside it never reach the network: the guard refuses them locally with `BDPAN_PATH_OUT_OF_SCOPE`. Relative path arguments resolve against the root.

## Tool inventory

- Reads: `baidu_pan__whoami`, `baidu_pan__quota`, `baidu_pan__list`, `baidu_pan__search`, `baidu_pan__meta`
- Writes: `baidu_pan__mkdir`, `baidu_pan__copy`, `baidu_pan__move`, `baidu_pan__rename`, `baidu_pan__share`
- Transfers: `baidu_pan__upload`, `baidu_pan__download`
- Dangerous: `baidu_pan__delete` (irreversible; voucher-gated)

Chain via fsid: `list`/`search` outputs carry `fsid` values that `baidu_pan__meta` consumes; `share` and `download` accept paths directly.

## When to trigger

Trigger when the request concerns the user's Baidu Netdisk: list/browse/search, upload/download between the workspace and the disk, organize (mkdir/copy/move/rename), share links, quota or account questions. Within a session that already did a netdisk operation, later asks need no keyword.

Do **not** trigger for: local-file-only work, third-party share-link saving (转存) — not supported in this version —, document text extraction (`get-content`) — also not supported —, or other cloud drives. Say so plainly when asked; do not improvise calls.

## Risk discipline (mandatory ordering)

1. **Reads are safe**: `whoami`, `quota`, `list`, `search`, `meta` — call freely.
2. **Writes need the target stated**: `mkdir`, `copy`, `move`, `rename`, `share` — state the exact source and destination in your reply before or with the call.
3. **Destructive actions need prior user confirmation** — never call before an explicit yes:
   - `delete`: list every target (name + type + count), state that deletion is irreversible, and wait for confirmation. Then pass `paths` and `confirm_paths` as **exactly the same list**; any mismatch bounces with `BDPAN_CONFIRM_REQUIRED`. A changed target set means a new confirmation, never a reused one.
   - `upload`/`download` with `overwrite=true`: show the collision (local or remote) and get the user's agreement first.
4. **User cancels ("算了" / "不用了")**: stop immediately; make no further calls for that request.

## Display rules

- Speak display paths only: `我的应用数据/bdpan/…`. Never put fsids, dlinks, or raw `/apps/...` server paths into user-facing sentences — the tool JSON carries them for chaining, the rendered text is what the human reads.
- `share` output already contains the link + password; pass them through verbatim, never reassemble or trim URLs.
- Quote entry counts faithfully: if a batch returned 3 files, the summary names 3 files.
- Size facts come from the data (`bytes` fields), not from guesses.

## Failure handling

Errors arrive as `{kind:'error', code, message, retryable}` values — read the code, do not retry blindly:

- `BDPAN_AUTH_REQUIRED` / `BDPAN_TOKEN_EXPIRED` / `BDPAN_TOKEN_INVALID`: tell the user to sign in via the host's Baidu Netdisk authorization entry, then continue the original task afterwards.
- `BDPAN_CONFIRM_REQUIRED`: you skipped step 3 — obtain the confirmation (or the matching `confirm_paths` list) and call again.
- `BDPAN_PATH_OUT_OF_SCOPE`: the path left the root; propose a corrected path under the root.
- `BDPAN_ALREADY_EXISTS`: offer save-as (a new name) or an explicit overwrite with confirmation.
- `BDPAN_OUTPUT_UNCERTAIN` (upload create-step network failure): the landing state is unknown — **do not re-upload blindly**; first `list`/`search` the remote parent to check whether the file actually landed, then decide.
- `BDPAN_NETWORK` / `BDPAN_RATE_LIMITED` / `BDPAN_UPSTREAM` with `retryable:true`: retry a small number of times with backoff; give up with a clear message instead of hammering.

Copy follows the three-part rule — what happened, why, what to do next. Middle states are never success: nothing is "saved" until a call reports it saved. When you cannot tell (e.g. a search index looks stale), say "暂时无法确认" instead of inventing an answer.
