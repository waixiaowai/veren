import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyOptions } from '@veren/compiler-options'
import { apply as applyHost } from '@veren/compiler-host'
import { apply as applyProgram } from '@veren/compiler-program'
import { apply as applyChecker } from '@veren/compiler-type-checker'
import {
    DefaultCompiler,
    type CompileInput,
    type EmitResult,
    type TypeMetadata,
    type TypeMetadataKind,
} from '../src/index'

/**
 * DefaultCompiler 测试共享夹具：服务链搭建、探针子类与元数据工厂。
 * Shared fixtures for the DefaultCompiler suites: service-chain setup, probe
 * subclasses and the metadata factory.
 */

/**
 * 每个用例各自创建的 Context 所产生的 disposer，统一在 afterEach 清理。
 * Disposers produced by the per-test Context, cleaned up together in afterEach.
 */
const disposers: Array<() => unknown> = []

/** 登记一个 disposer，afterEach 统一清理 / register one disposer, cleaned up together in afterEach */
export const trackDisposer = (dispose: () => unknown): void => {
    disposers.push(dispose)
}

/** 清理全部已登记的 disposer / dispose everything registered so far */
export const disposeTracked = async (): Promise<void> => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
}

/**
 * 按依赖顺序搭建完整服务链：options → host → program → checker；
 * rootNames 可为空（DefaultCompiler 在 compile 有输入时会另建 Program）。
 * 每次调用都 new 一个 Context，避免跨用例复用导致 "service already registered"。
 * Build the full service chain in dependency order: options → host →
 * program → checker; rootNames may be empty (DefaultCompiler builds a per-run
 * Program when compile receives inputs). Always a fresh Context so services
 * never collide across tests.
 */
export const setupCtx = (options: ts.CompilerOptions = {}, rootNames: readonly string[] = []): Context => {
    const ctx = new Context()
    trackDisposer(applyOptions(ctx, options))
    trackDisposer(applyHost(ctx, { setParentNodes: true }))
    trackDisposer(applyProgram(ctx, { rootNames }))
    trackDisposer(applyChecker(ctx))
    return ctx
}

/** 把 protected 的 load/parse 以公开方法转发出来，便于单独测试这两个阶段 */
/** Re-expose the protected load/parse as public methods so both stages can be tested in isolation */
export class ProbeCompiler extends DefaultCompiler {
    load(inputs: readonly CompileInput[]) {
        return super.load(inputs)
    }

    parse(files: readonly ts.SourceFile[]) {
        return super.parse(files)
    }
}

/** 只覆写 analyze 的子类：用于触发默认 collect 的抛错路径 */
/** Subclass overriding only analyze: triggers the default collect's throwing path */
export class AnalyzeOnlyCompiler extends DefaultCompiler {
    protected override analyze(): void {}
}

/** 覆写 analyze/collect 的子类：用于观察默认 emit 的返回值 */
/** Subclass overriding analyze/collect: observes the default emit's return value */
export class NoopStagesCompiler extends DefaultCompiler {
    protected override analyze(): void {}

    protected override collect(_files: readonly ts.SourceFile[]): void {}
}

/**
 * 完整流水线子类：analyze 置空；collect 借助源码文本按文件归档
 * interface 与 type-alias 各一条；emit 展平 registry 并生成可序列化 output。
 * A full-pipeline subclass: analyze is a no-op; collect archives one
 * interface and one type-alias entry per file (names parsed from the source
 * text); emit flattens the registry into a serializable output.
 */
export class PipelineCompiler extends DefaultCompiler {
    protected override analyze(): void {}

    protected override collect(files: readonly ts.SourceFile[]): void {
        for (const sf of files) {
            const span = { fileName: sf.fileName, start: 0, end: sf.end, line: 0, character: 0 }
            const interfaceName = /\binterface\s+(\w+)/.exec(sf.text)?.[1] ?? ''
            const typeName = /\btype\s+(\w+)/.exec(sf.text)?.[1] ?? ''
            this.addMetadata(sf.fileName, [makeEntry('interface', interfaceName, span)])
            this.addMetadata(sf.fileName, [makeEntry('type-alias', typeName, span)])
        }
    }

    protected override emit(): EmitResult {
        return {
            metadata: [...this.metadataRegistry.values()].flat(),
            output: JSON.stringify({ files: [...this.metadataRegistry.keys()] }),
        }
    }
}

/** 构造一条最小类型元数据 */
/** Build a minimal TypeMetadata entry */
export const makeEntry = (kind: TypeMetadataKind, name: string, span: TypeMetadata['span']): TypeMetadata => ({
    kind,
    name,
    span,
})
