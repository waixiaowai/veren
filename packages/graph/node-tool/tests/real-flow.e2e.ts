/**
 * 真实环境验收 e2e：装载真实 dsh-tools ToolRuntime + 一个真实 exec 工具
 * （node:child_process 起真实子进程），经 YAML 装载含并行分支的 flow 并运行，
 * 依据执行历史（listRuns + 持久化介质）与运行结果做验收。无凭据，失败重试 2 次。
 *
 * Real-environment acceptance e2e: mounts the real dsh-tools ToolRuntime plus
 * a real exec tool (real child processes via node:child_process), loads a
 * parallel-branch flow from YAML, runs it, and accepts on the execution
 * history (listRuns + the persisted medium) and the run results. No
 * credentials; retried twice.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken, FlowStorageToken } from '@deepseek-ai/dsh-graph-flow-engine';
import * as flowStorage from '@deepseek-ai/dsh-graph-flow-storage';
import { apply as yamlParserPlugin } from '@veren/yaml-parser';
import { apply as yamlPlugin, Config as yamlConfig } from '@deepseek-ai/dsh-graph-flow-yaml';
import * as nodeTool from '../src/index.js';
import ToolRuntime from '@deepseek-ai/dsh-tools';

/** 真实 exec 工具：起真实子进程跑 node 脚本（跨平台，无 shell 引号问题）/
    the real exec tool: spawns a real child process running a node script (cross-platform, no shell quoting) */
const execTool = {
    name: 'exec',
    description: 'Run a node script in a real child process',
    parameters: { script: { type: 'string', required: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    output: {
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: { exitCode: { type: 'integer' }, stdout: { type: 'string' } },
        },
        render: () => [] as never,
    },
    execute: async (args: { script: string }, exec: { signal: AbortSignal }) => {
        const child = spawn(process.execPath, ['-e', args.script], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
        const abort = (): void => child.kill();
        exec.signal.addEventListener('abort', abort, { once: true });
        const exitCode = await new Promise<number>((resolve, reject) => {
            child.on('close', (code) => resolve(code ?? -1));
            child.on('error', reject);
        });
        exec.signal.removeEventListener('abort', abort);
        // 非零退出即工具失败（真实 exec 语义）/ a nonzero exit is a tool failure (real exec semantics)
        if (exitCode !== 0) throw new Error(`script exited with ${exitCode}`);
        return { exitCode, stdout: stdout.trim() };
    },
};

const FLOW_YAML = `
id: real-ci
nodes:
  - id: gen
    type: echo
    config:
      message: "console.log('JOIN-FROM-UPSTREAM')"
  - id: probe-a
    type: tool
    config: { tool: exec }
    input: { script: "console.log('A-OK')" }
  - id: probe-b
    type: tool
    config: { tool: exec }
    input: { script: "console.log('B-OK')" }
  - id: gate
    type: tool
    config: { tool: exec }
    input:
      script: "\${gen.message}"
edges:
  - { from: probe-a, to: gate }
  - { from: probe-b, to: gate }
  - { from: gen, to: gate }
output:
  a: "\${probe-a.stdout}"
  b: "\${probe-b.stdout}"
  join: "\${gate.stdout}"
`;

describe('real flow execution (real tools, real processes, real storage)', () => {
    it('executes a YAML-loaded parallel flow end to end and records the history', async () => {
        // 每次尝试独立介质目录（vitest retry 幂等）/ a fresh medium per attempt (retry idempotence)
        const dir = await mkdtemp(join(tmpdir(), 'veren-real-flow-'));
        try {
            await runScenario(dir);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

/** 完整验收场景 / the full acceptance scenario */
async function runScenario(dir: string): Promise<void> {
    const ctx = new Context();
    // 1) dsh storage 栈（hub + json 后端 + domain 层）/ the dsh storage stack
    const storage = await import('@deepseek-ai/dsh-storage');
    await ctx.plugin({ apply: (c: Context) => void new (storage.Storage as never as new (c: Context) => object)(c) } as never);
    const storageJson = await import('@deepseek-ai/dsh-storage-json');
    await ctx.plugin({ inject: storageJson.inject, apply: storageJson.apply } as never, { root: dir });
    const storageDomain = await import('@deepseek-ai/dsh-storage-domain');
    await ctx.plugin({ inject: storageDomain.inject, apply: storageDomain.apply } as never, { backend: 'json' });
    // 2) 内核 + flow-storage + systemPrompt（ToolRuntime 的依赖）+ 引擎 + 真实 ToolRuntime + tool 节点
    await ctx.plugin(kernelPlugin);
    await ctx.plugin({ inject: flowStorage.inject, apply: flowStorage.apply } as never, {});
    // flow-storage 的 Domain 在异步 effect 里打开，FlowStorage 能力晚一步提供；
    // 等它就绪再装引擎，否则引擎装载时快照不到该能力，运行记录不会落盘。
    // flow-storage opens its domain in an async effect, so FlowStorage arrives a
    // step later; wait for it before mounting the engine, otherwise the engine
    // cannot see the capability and run records never reach the medium.
    for (let i = 0; i < 50 && !ctx.get(FlowStorageToken); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(ctx.get(FlowStorageToken)).toBeDefined();
    const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).SystemPrompt as unknown as new (c: Context, config: Record<string, unknown>) => object;
    await ctx.plugin({ apply: (c: Context) => void new SystemPrompt(c, {}) } as never);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 30_000 });
    // ToolRuntime 声明的 inject（如 systemPrompt）由静态字段带出 / ToolRuntime carries its own inject list
    await ctx.plugin({ inject: (ToolRuntime as unknown as { inject: string[] }).inject, apply: (c: Context) => void new ToolRuntime(c) } as never);
    await ctx.plugin({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
    // 3) 真实 exec 工具注册进真实注册表 / register the real exec tool into the real registry
    const tools = (ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools;
    const disposeTool = tools.register(execTool);
    // 4) YAML 装载真实 flow / load the real flow from YAML
    await ctx.plugin(yamlParserPlugin);
    const flowFile = join(dir, 'real-ci.flow.yaml');
    await writeFile(flowFile, FLOW_YAML, 'utf8');
    await ctx.plugin(yamlPlugin as never, yamlConfig({ files: [flowFile] }));
    const engine = ctx.get(FlowEngineToken)!;
    for (let i = 0; i < 50 && !engine.hasFlow('real-ci'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(engine.hasFlow('real-ci')).toBe(true);

    // ---- 运行并验收结果 / run and accept the results ----
    const result = await engine.run('real-ci').awaitCompletion();
    expect(result.status).toBe('completed');
    // 真实子进程的 stdout / real child-process stdout
    expect(result.output['a']).toBe('A-OK');
    expect(result.output['b']).toBe('B-OK');
    // 上游黑板数据流入真实进程 / upstream blackboard data flowed into a real process
    expect(result.output['join']).toBe('JOIN-FROM-UPSTREAM');
    // 并行分支确实重叠执行（startedAt 区间相交）/ the parallel branches actually overlapped
    const a = result.nodes['probe-a']!;
    const b = result.nodes['probe-b']!;
    expect(Math.min(a.endedAt!, b.endedAt!)).toBeGreaterThanOrEqual(Math.max(a.startedAt!, b.startedAt!) - 1);

    // ---- 执行历史验收 / accept the execution history ----
    const summaries = engine.listRuns();
    expect(summaries.length).toBe(1);
    expect(summaries[0]).toMatchObject({ flowId: 'real-ci', status: 'completed' });
    // 持久化介质上的真实文件 / the real file on the medium
    const raw = await readFile(join(dir, 'graph_flow.json'), 'utf8');
    expect(raw).toContain('real-ci');
    expect(raw).toContain(result.runId);
    // 介质里的定义与运行记录可被重新读取（restore 面的依据）/ the stored definition & run record read back
    const medium = JSON.parse(raw) as { tables: { flows: Record<string, unknown>; runs: Record<string, unknown> } };
    expect(medium.tables.flows['real-ci']).toMatchObject({ id: 'real-ci' });
    expect(medium.tables.runs[result.runId]).toMatchObject({ id: result.runId, status: 'completed' });

    // ---- 失败也进历史 / failures are recorded too ----
    await engine.registerFlow({
        id: 'real-ci-fail',
        nodes: [{ id: 'boom', type: 'tool', config: { tool: 'exec' }, input: { script: 'process.exit(3)' } }],
        edges: [],
    } as never);
    const failed = await engine.run('real-ci-fail').awaitCompletion();
    expect(failed.status).toBe('failed');
    // 非零退出 → 工具失败 → NODE_FAILED（无工具自带 code 时的兜底）/ nonzero exit → tool failure → NODE_FAILED fallback
    expect(failed.nodes['boom']!.error!.code).toBe('TOOL_FAILED');
    expect(engine.listRuns().length).toBe(2);
    // 失败运行同样落盘进历史 / failed runs persist into the history too
    const rawAfter = await readFile(join(dir, 'graph_flow.json'), 'utf8');
    const mediumAfter = JSON.parse(rawAfter) as { tables: { runs: Record<string, unknown> } };
    expect(mediumAfter.tables.runs[failed.runId]).toMatchObject({ status: 'failed' });
    disposeTool();
}
