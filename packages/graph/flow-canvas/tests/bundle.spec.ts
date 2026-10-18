/**
 * Bundle 契约测试：graph 插件族若承诺包含全部可安装包，flow-canvas 就必须
 * 同时出现在 bundle 的 file: 依赖与 cordis.patch.yml 里，且 tarball 真实存在。
 *
 * Bundle contract test: if the graph bundle promises the whole installable
 * family, flow-canvas must appear in both the file: dependencies and
 * cordis.patch.yml, with a real tarball on disk.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUNDLE_DIR = fileURLToPath(new URL('../../bundle/', import.meta.url));
const PACKAGE = '@deepseek-ai/dsh-graph-flow-canvas';

/** The tarball name follows the canvas package's own version. */
function canvasVersion(): string {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    return manifest.version;
}

describe('graph bundle packaging', () => {
    it('carries flow-canvas as a file dependency, patch row and tarball', () => {
        const manifest = JSON.parse(readFileSync(join(BUNDLE_DIR, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
        };
        const dependency = manifest.dependencies?.[PACKAGE];
        expect(dependency).toBeTypeOf('string');
        expect(dependency).toContain(`flow-canvas-${canvasVersion()}.tgz`);
        expect(existsSync(join(BUNDLE_DIR, dependency!.replace(/^file:\.\//, '')))).toBe(true);

        const patch = readFileSync(join(BUNDLE_DIR, 'cordis.patch.yml'), 'utf8');
        expect(patch).toContain(PACKAGE);
    });
});
