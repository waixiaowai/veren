# @veren/commander-discovery

[English](./README.md)

veren 宸ヤ綔鍖哄崟鍏冨彂鐜?鈥斺€?鏍囧噯 Cordis 鎻掍欢妯″潡锛歚DiscoveryService`锛堢户鎵?`Service`锛屾彁渚?`list`/`find`锛夋寜鏂囦欢绾﹀畾锛坄package.json` 浼樺厛浜?`Cargo.toml`锛夎瘑鍒伐浣滃尯鍗曞厓 `{ name, description, dir }`锛屽甫娣卞害涓婇檺銆佹寜
`dir` 鎺掑簭锛涚函鎵弿鍑芥暟鍚屾椂淇濈暀銆?
## 浣曟椂浣跨敤

- 鏌愪釜 Cordis 鎻掍欢闇€瑕佹妸宸ヤ綔鍖哄崟鍏冧綔涓虹粨鏋勫寲鏁版嵁锛坴eren CLI 鐨?`list`/`doc`
  鍛戒护鍗虫敞鍏ユ湰鏈嶅姟锛夈€?- 浣犲笇鏈?npm 浼樺厛浜?Rust銆佹繁搴︿笂闄愩€佽烦杩囧悕鍗曪紙`node_modules`銆乣dist`銆?  `target`銆侀殣钘忕洰褰曪級杩欎簺绾﹀畾琚竴鑷村湴搴旂敤锛屽苟鍙€氳繃鎻掍欢閰嶇疆寰皟銆?
濡傛灉浣跨敤鍏朵粬宸ュ叿鎵弿宸ヤ綔鍖猴紝璇疯烦杩囨湰鍖呫€?
## 瀹夎

```json
{
  "dependencies": {
    "@veren/commander-discovery": "workspace:*"
  }
}
```

## 蹇€熷紑濮?
```ts
import { Context } from '@deepseek-ai/cordis'
import { getOrThrow } from '@veren/core'
import { Project } from '@veren/commander-project'
import { Discovery } from '@veren/commander-discovery'
import * as DiscoveryPlugin from '@veren/commander-discovery'

const ctx = new Context()
ctx.provide(Project, { root: '/path/to/project', config: { scanRoots: ['/path/to/project/apps'] } })
await ctx.plugin(DiscoveryPlugin) // inject = [Project]锛汣onfig锛歿 maxDepth, skip }

const units = await getOrThrow(ctx, Discovery).list()
// [{ name: '@x/pkg', description: '鈥?, dir: 'apps/pkg' }, 鈥
await getOrThrow(ctx, Discovery).find('@x/pkg') // 鈫?鍗曞厓 | undefined
```

闈炴彃浠惰皟鐢ㄦ柟涔熷彲浠ョ洿鎺ョ敤绾嚱鏁帮細

```ts
import { discoverUnits } from '@veren/commander-discovery'

const units = await discoverUnits(fs, path, '/path/to/project', { scanRoots: ['/path/to/project/apps'] })
```

## 浠ょ墝瀛愯矾寰勶紙骞冲彴鏃犲叧锛?
`./tokens` 鍙鍑?`Discovery` 浠ょ墝鍙婂叾缁撴瀯鍖栬鍥?`UnitInventory` / `Unit` 鈥斺€?涓嶅惈 Cordis銆佷笉鍚?Node 鍐呯疆妯″潡 鈥斺€?鍙共鍑€鍦版墦杩涙祻瑙堝櫒鎴栧叾浠栧彧闇€瑕佸紩鐢ㄦ湇鍔″悕
鐨勭幆澧冿細

```ts
import { Discovery } from '@veren/commander-discovery/tokens' // 鍙湁浠ょ墝锛屼笉鎷栧叆 Cordis
```

## 鎺ュ彛

妯″潡鍗虫彃浠?鈥斺€?浠ュ懡鍚嶇┖闂村鍏ヨ杞斤紙`ctx.plugin(...)`锛夛細

| 瀵煎嚭 | 绫诲瀷 | 璇存槑 |
| --- | --- | --- |
| `name` | 瀛楃涓诧紙`'verenCliDiscovery'`锛?| 鏈嶅姟浠ょ墝锛? `Discovery`锛夊吋鎻掍欢鏄剧ず鍚嶃€?|
| `inject` | `[Project]` | 渚濊禆椤圭洰鏈嶅姟锛堥」鐩牴涓庢壂鎻忔牴锛夈€?|
| `Config` | schemastery schema | `{ maxDepth: number, skip: string[] }` 鈥斺€?鎵弿娣卞害涓婇檺锛堢己鐪?`4`锛変笌鍦?`SKIP_DIRS` 涔嬪杩藉姞璺宠繃鐨勭洰褰曞悕锛堢己鐪?`[]`锛夈€?|
| `apply(ctx, config)` | 鎻掍欢鍑芥暟 | 浠庝笂涓嬫枃鐨?`Project` 鍒涘缓 `DiscoveryService`銆?|
| `Discovery` | 浠ょ墝锛屽瓧绗︿覆 `'verenCliDiscovery'` | `DiscoveryService` 鐨勬彁渚涗护鐗屻€?|
| `DiscoveryService` | 缁ф壙 `Service` 鐨勭被 | `list()`锛堟寜 `dir` 鎺掑簭鐨勫崟鍏冿紝姣忔璋冪敤閲嶆柊鎵弿锛夈€乣find(name)`銆乣root`锛堥」鐩牴锛夈€乣config`锛堝綊涓€鍖栭厤缃級銆?|
| `UnitInventory` | 鎺ュ彛 | 浠ょ墝绾х粨鏋勮鍥撅紙鏉ヨ嚜 `./tokens`锛夛細`root`/`list`/`find`锛屾棤 Cordis 渚濊禆銆?|
| `discoverUnits(root, config, options?)` | 鍑芥暟 | 绾壂鎻忥細閫掑綊鎵弿姣忎釜鎵弿鏍癸紝鎸?`dir` 鎺掑簭锛沗options` = `{ maxDepth?, skip? }`銆?|
| `ScanConfig` | 鎺ュ彛 | `{ scanRoots: string[] }` 鈥斺€?鏈€灏忔壂鎻忓舰鐘讹紙涓?`@veren/commander-project` 鐨?`Config` 缁撴瀯鍏煎锛夈€?|
| `ScanOptions` | 鎺ュ彛 | `{ maxDepth?, skip? }` 鈥斺€?鍙€夌殑鍗曟鎵弿瑕嗙洊椤广€?|
| `Unit` | 鎺ュ彛 | `{ name, description, dir }`锛沗dir` 涓虹浉瀵规牴銆佷互姝ｆ枩鏉犲垎闅旂殑璺緞銆?|
| `readNpmUnit` / `readCargoUnit` | 鍑芥暟 | 浠?`package.json` / `Cargo.toml` 璇诲彇鍗曚釜鍗曞厓锛涢潪鍗曞厓杩斿洖 `null`锛堝潖娓呭崟鍚?stderr 鍛婅锛夈€?|
| `parseCargoPackageFields` | 鍑芥暟 | 闆朵緷璧栨彁鍙?`[package]` 鐨?`name`/`description`锛堝弻寮曞彿杞箟銆佸崟寮曞彿瀛楅潰閲忋€佽灏炬敞閲婏級銆?|
| `MAX_SCAN_DEPTH` / `SKIP_DIRS` | 甯搁噺 | 娣卞害涓婇檺缂虹渷鍊硷紙4锛変笌鍐呯疆璺宠繃鍚嶅崟锛坄node_modules`銆乣dist`銆乣target`銆乣.git`锛夈€?|

## 寮€鍙?
```bash
pnpm --filter @veren/commander-discovery build
pnpm --filter @veren/commander-discovery test   # 15 涓敤渚?```

```
packages/commander/discovery
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ discovery.ts   # 绾壂鎻忎笌娓呭崟璇诲彇 / pure scanning + manifest readers
鈹?  鈹溾攢鈹€ service.ts     # Config schema + DiscoveryService / 閰嶇疆 schema 涓庢湇鍔?鈹?  鈹溾攢鈹€ tokens.ts      # 骞冲彴鏃犲叧鐨?Discovery 浠ょ墝 + UnitInventory/Unit / platform-agnostic token + views
鈹?  鈹斺攢鈹€ index.ts       # 鎻掍欢妯″潡 name/inject/Config/apply 涓庡啀瀵煎嚭 / plugin module + re-exports
鈹斺攢鈹€ test/index.test.ts
```

## 娉ㄦ剰浜嬮」涓庣害鏉?
- 鍛戒腑鍗曞厓鍚庝笉鍐嶅悜鍏跺瓙鐩綍涓嬮捇锛氬崟鍏冨嵆鏈€灏忓垎鍙戣竟鐣屻€?- 鍗曚釜鍧忔竻鍗曚笉浼氫腑鏂壂鎻?鈥斺€?鍚?stderr 鍛婅骞惰烦杩囷紝stdout 淇濇寔骞插噣渚?JSON 娑堣垂鏂硅В鏋愩€?- `list()` 姣忔璋冪敤閲嶆柊鎵弿锛欳LI 杩涚▼鐢熷懡鍛ㄦ湡鐭紝鏂伴矞搴︿紭鍏堜簬缂撳瓨锛涙湇鍔￠殢 fiber
  鍗歌浇銆?
