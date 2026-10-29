# @veren/imagegen

Raster image generation and editing for DSH agents, backed by any OpenAI-compatible Images API endpoint.

## What it provides

Mounting the plugin registers three things:

1. **Two model tools**
   - `imagegen__generate` — one image per call, from a full prompt; saves into the workspace (never overwrites — collisions derive `hero-v2.png`) and returns the durable image reference so vision-capable models can inspect their own output.
   - `imagegen__edit` — the same loop against existing image files (inpainting, background replacement, object removal, compositing) with an optional mask.
2. **The `image-generation` skill** — the prompting discipline ported from a battle-tested image skill: generate-vs-edit intent split, a 19-slug use-case taxonomy, a structured prompt schema, a specificity-graded augmentation policy, and single-change iteration. Reference files (`prompting.md`, `sample-prompts.md`) ship alongside the body for progressive disclosure.
3. **A guided sign-in flow** — paste an Images API key (or import `IMAGEGEN_API_KEY`/`OPENAI_API_KEY` from the host environment, read-only). The key lands in the credential store only after `GET /models` validation passes online; it never enters config files or logs.

A chroma-key post-processor (`chroma_key: "#00ff00"`) converts a flat key-color backdrop into a real alpha channel — the transparency path for models without true alpha (gpt-image-2 rejects transparent backgrounds).

## Cost governance

`enabled` defaults to **false**. While off, every tool call refuses with `IMAGEGEN_DISABLED` — installing the plugin is not consenting to paid API calls. Turn it on explicitly in the config row.

## Install (stable test node)

```powershell
# bundle row via the plugin's own patch (or add @veren/imagegen to the bundle you install)
pnpm --dir deepseek\deepseek-harness dsh plugin --profile web add plugins\imagegen
```

Config row (profile overlay example lives in `cordis.patch.yml`):

```yaml
- insert:
    - id: imagegen
      name: '@veren/imagegen'
      config:
        enabled: true            # the paid-call gate
        # baseURL: https://api.openai.com/v1
        # model: gpt-image-2
```

Then sign in once through the authorization flow (Settings → credentials, or the flow key `imagegen/account`).

## Config reference

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Paid-call gate; off → `IMAGEGEN_DISABLED` |
| `baseURL` | `https://api.openai.com/v1` | OpenAI-compatible Images API root |
| `model` | `gpt-image-2` | Default image model |
| `requestTimeoutMs` | `600000` | Per-request timeout (generation can take minutes) |
| `maxAttempts` | `3` | Transient-failure attempts (429/5xx; Retry-After honored) |

## Stable error codes

`IMAGEGEN_DISABLED`, `IMAGEGEN_NO_KEY`, `IMAGEGEN_NO_WORKSPACE`, `IMAGEGEN_SIZE_INVALID`, `IMAGEGEN_QUALITY_INVALID`, `IMAGEGEN_FORMAT_INVALID`, `IMAGEGEN_TRANSPARENCY_UNSUPPORTED`, `IMAGEGEN_OPTION_UNSUPPORTED`, `IMAGEGEN_PROMPT_EMPTY`, `IMAGEGEN_INPUT_FILE_MISSING`, `IMAGEGEN_CHROMA_INVALID`, `IMAGEGEN_CHROMA_FAILED`, `IMAGEGEN_API_ERROR`, `IMAGEGEN_INVALID_RESPONSE`. Tools return them as structured values (`{ kind: 'error', code, message }`), never as throws across the tool boundary.

## Model capability matrix (validated up front, fails loud)

- `gpt-image-2`: sizes `auto` or `WxH` with edges ≤ 3840px, both multiples of 16px, ratio ≤ 3:1, total pixels 655 360–8 294 400; no transparent background; no `input_fidelity`.
- Legacy (`gpt-image-1.5`/`1`/`1-mini` and unknown models): sizes `1024x1024`/`1536x1024`/`1024x1536`/`auto`; transparent background requires `png`/`webp` output.

## Development

```bash
pnpm --dir plugins/imagegen run typecheck
pnpm --dir plugins/imagegen run test        # 73 unit + composition tests
pnpm --dir plugins/imagegen run test:e2e    # real paid call; self-skips without IMAGEGEN_E2E_KEY/OPENAI_API_KEY
```

Verify on the stable node (DSH_HOME=deepseek\.dsh, port 3080): start the web profile, open a session, ask the agent to draw something, and check that (a) the PNG lands in the workspace, (b) the session log shows the tool result with the image, (c) a vision model can describe the picture, and (d) asking "how do you know the path?" is answered from the tool result.

See [README.cn.md](README.cn.md) for the Chinese version. / 中文版见 [README.cn.md](README.cn.md)。
