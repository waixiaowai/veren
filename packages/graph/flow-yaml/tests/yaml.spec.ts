/**
 * YAML flow 加载测试：真实 Loader 组合（内核 + 引擎 + yaml-parser + yaml
 * 插件），加载含并行分支的 flow 并注册进引擎、可运行。
 *
 * YAML flow loading tests: a real-Loader composition (kernel + engine +
 * yaml-parser + the yaml plugin) loads a parallel-branch flow, registers it
 * into the engine and runs it.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as yamlParserPlugin } from '@veren/yaml-parser';
import { apply as yamlPlugin, Config as yamlConfig, FlowYamlLoaderToken } from '../src/index.js';
import { flowFromYaml, YamlFlowError } from '../src/loader.js';

const PARALLEL_YAML = `
id: yaml-demo
nodes:
  - id: start
    type: noop
  - id: left
    type: echo
    config:
      message: L
  - id: right
    type: echo
    config:
      message: R
  - id: join
    type: noop
    input:
      l: "\${left.message}"
      r: "\${right.message}"
edges:
  - { from: start, to: left }
  - { from: start, to: right }
  - { from: left, to: join }
  - { from: right, to: join }
output:
  l: "\${join.l}"
  r: "\${join.r}"
`;

const dir = await mkdtemp(join(tmpdir(), 'veren-flow-yaml-'));
const flowFile = join(dir, 'parallel.flow.yaml');
await writeFile(flowFile, PARALLEL_YAML, 'utf8');
afterAll(() => rm(dir, { recursive: true, force: true }));

/** 真实 Loader 组合 / the real-Loader composition */
async function makeStack() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin(yamlParserPlugin);
    const fiber = await ctx.plugin(yamlPlugin as never, yamlConfig({ files: [flowFile] }));
    return { ctx, engine: ctx.get(FlowEngineToken)!, fiber };
}

/** 轮询等待 flow 注册（装载是异步 effect，固定 sleep 会时序脆弱）/
    poll until the flow registers (mounting is an async effect; a fixed sleep is timing-fragile) */
async function waitForFlow(engine: { hasFlow(id: string): boolean }, id: string): Promise<void> {
    for (let i = 0; i < 50 && !engine.hasFlow(id); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

describe('yaml flow loader', () => {
    it('maps a YAML document into a FlowDefinition', () => {
        const def = flowFromYaml({ id: 'x', nodes: [{ id: 'a', type: 'echo' }], edges: [] });
        expect(def.id).toBe('x');
        expect(def.nodes[0]!.id).toBe('a');
    });

    it('fails loud on malformed documents', () => {
        expect(() => flowFromYaml(null)).toThrowError(YamlFlowError);
        expect(() => flowFromYaml({ nodes: [] })).toThrowError(YamlFlowError);
    });

    it('loads the parallel-branch flow through the real Loader into the engine', async () => {
        const { engine } = await makeStack();
        await waitForFlow(engine, 'yaml-demo');
        expect(engine.hasFlow('yaml-demo')).toBe(true);
        // 并行分支真的能跑：join 同时读到左右分支的产出 / the parallel branches actually run
        const result = await engine.run('yaml-demo').awaitCompletion();
        expect(result.status).toBe('completed');
        // 并行分支在 join 汇聚 / the parallel branches join
        expect(result.output['l']).toBe('L');
        expect(result.output['r']).toBe('R');
    });

    it('unregisters loaded flows when the yaml plugin fiber unloads', async () => {
        const { engine, fiber } = await makeStack();
        await waitForFlow(engine, 'yaml-demo');
        expect(engine.hasFlow('yaml-demo')).toBe(true);
        await fiber.dispose();
        // 注册走 ctx.effect：fiber 卸载逆序清理，不留注册泄漏 /
        // Registration goes through ctx.effect: fiber unload cleans up in reverse order, no leaks.
        expect(engine.hasFlow('yaml-demo')).toBe(false);
    });

    it('exposes the loader capability and reports missing ids', async () => {
        const { ctx } = await makeStack();
        const loader = ctx.get(FlowYamlLoaderToken)!;
        const bad = join(dir, 'bad.flow.yaml');
        await writeFile(bad, 'nodes: []\n', 'utf8');
        await expect(loader.loadFile(bad)).rejects.toBeInstanceOf(YamlFlowError);
    });
});
