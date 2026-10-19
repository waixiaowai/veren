# @veren/compiler-host

[中文文档](./README.cn.md)

Turns the compiler options already in the context into a `ts.CompilerHost` service for the Veren compiler pipeline.

## When to use

- A TypeScript build stage needs a `ts.CompilerHost` service from the context — including the in-memory host factory for sources that never touch disk — instead of creating a host by hand.
- Several stages should share a single host instance derived from the same compiler options.
- You compile sources that live in memory only (virtual files, editor buffers, tests) and module resolution still has to work.

## Install

The package is part of the pnpm workspace. Depend on it through the workspace protocol in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/compiler-host": "workspace:*"
  }
}
```

At runtime the context must already provide the compiler options service, because this package declares `inject = ['verenCompilerOptions']`; normally `@veren/compiler-options` supplies it.

## Quick start

```ts
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import * as CompilerOptions from '@veren/compiler-options'
import * as CompilerHost from '@veren/compiler-host'
import * as Program from '@veren/compiler-program'
import { get } from '@veren/core'

const ctx = new Context()
await ctx.plugin(CompilerOptions, { target: ts.ScriptTarget.ES2022 })
await ctx.plugin(CompilerHost, { setParentNodes: true })
await ctx.plugin(Program, { rootNames: ['./src/index.ts'] })

const program = get(ctx, Program.name)!      // ts.Program
const host = get(ctx, CompilerHost.name)!    // ts.CompilerHost
```

For sources that never touch disk, build a host with the in-memory factory. The given `SourceFile`s are served first, everything else falls back to the default disk host:

```ts
import * as ts from 'typescript'
import { createMemoryCompilerHost } from '@veren/compiler-host'

const fileName = '/virtual/sum.ts'
const source = ts.createSourceFile(
  fileName,
  'export function sum(a: number, b: number): number { return a + b; }',
  ts.ScriptTarget.ES2022,
  true,
)

const host = createMemoryCompilerHost({ noLib: true, types: [] }, [source])
host.getSourceFile(fileName, ts.ScriptTarget.ES2022) // === source
```

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<ts.CompilerHost>`, the string `'verenCompilerHost'` | Token under which the created host is provided. |
| `Config` | Schemastery schema plus `interface Config` | Validates the plugin config. `setParentNodes` is a boolean defaulting to `false`, and a value of another type throws; `Config({})` normalizes to `{ setParentNodes: false }`. |
| `inject` | `Token[]` | `['verenCompilerOptions']`: the compiler options service must exist before `apply` runs. |
| `apply(ctx, config)` | `(ctx: Context, config: Config) => () => void` | Reads the compiler options service, calls `ts.createCompilerHost(options, config.setParentNodes)` and provides the host under `name`. The returned disposer unregisters it. |
| `createMemoryCompilerHost(options, sources)` | `(options: ts.CompilerOptions, sources: readonly ts.SourceFile[]) => ts.CompilerHost`, exported from the package entry | Serves the given in-memory `SourceFile`s first (matched exactly by `f.fileName` in `getSourceFile`, `getSourceFileByPath`, `fileExists` and `readFile`) and falls back to the default disk host for everything else. |

## Development

```bash
pnpm --filter @veren/compiler-host build
pnpm --filter @veren/compiler-host test
```

Tests live in `test/*.test.ts` and run through `vitest run`: `test/index.test.ts` (9 cases) and `test/memory-host.test.ts` (8 cases), 17 cases in total.

```
packages/compiler/compiler-host
├── README.md           # English docs
├── README.cn.md        # Chinese docs
├── package.json
├── src/
│   ├── index.ts        # provider entry: name / Config / inject / apply
│   └── memory-host.ts  # createMemoryCompilerHost (re-exported from ".")
└── test/
    ├── index.test.ts        # 9 cases
    └── memory-host.test.ts  # 8 cases
```

Build output goes to `dist/` through `tsc`; `main` and `exports` both point at `./dist/index.js`.

## Notes & constraints

- Tokens are plain strings and carry the `veren` prefix so they cannot collide across packages.
- Consume the provider with `await ctx.plugin(Module, config)` — the fiber activates asynchronously, so services are ready only after the `await` — or call `Module.apply(ctx, config)` synchronously for low-level unit tests.
- Providing the same service name twice on one `Context` throws `service already registered`; dispose the previous registration first.
- In-memory `fileName`s must be canonical absolute paths. TypeScript 5.9 normalizes paths to forward slashes and lowercases them on case-insensitive systems, and the memory map is keyed by the normalized `f.fileName`, so a mismatched spelling misses the map. When compilation goes through module resolution, the containing directory must really exist on disk.
- `createMemoryCompilerHost` is re-exported from `src/index.ts`, so external consumers import it directly from `@veren/compiler-host`. The package still exposes only the `"."` entry; there is no `@veren/compiler-host/memory-host` subpath.
- Keep `setParentNodes: true` whenever later stages need parent links or position computations on the produced nodes.
