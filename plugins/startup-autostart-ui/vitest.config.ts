/**
 * Vitest configuration for the panel package.
 *
 * No decorator transform is needed here: this package is the browser half and
 * declares no `@Remote` methods (those live in the Host service). Component
 * specs opt into the DOM per file with a `// @vitest-environment jsdom` pragma,
 * matching the Client test convention in the checkout, so the shared
 * environment stays `node`.
 *
 * 闈㈡澘鍖呯殑 Vitest 閰嶇疆銆傝繖閲屼笉闇€瑕佽楗板櫒杞瘧锛氭湰鍖呮槸娴忚鍣ㄥ崐杈癸紝涓嶅０鏄庝换浣?`@Remote`
 * 鏂规硶锛堥偅浜涘湪瀹夸富鏈嶅姟閲岋級銆傜粍浠舵祴璇曟寜妫€鍑轰粨搴撶殑瀹㈡埛绔祴璇曠害瀹氾紝鍦ㄦ枃浠堕琛岀敤
 * `// @vitest-environment jsdom` 鍗曠嫭鍒囨崲鍒?DOM 鐜锛屽洜姝ゅ叡浜幆澧冧繚鎸?`node`銆? */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // 无测试文件时通过：纯客户端面板包，行为由组合方覆盖。
    // Pass with no tests: a pure client panel; its behavior is covered by composers.
    passWithNoTests: true,
    environment: 'node',
  },
})

