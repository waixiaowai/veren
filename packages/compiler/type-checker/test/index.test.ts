import { afterEach, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { get, provideValue } from '@veren/core'
import { name as ProgramToken } from '@veren/compiler-program'
import { apply, inject, name } from '../src/index'

/**
 * 收集当前用例产生的所有 disposer,afterEach 中统一清理。
 * Collect every disposer created by the current test and release them in afterEach.
 */
const disposers: Array<() => unknown> = []

/** 当前用例创建的临时目录,afterEach 中递归删除。Temp dirs of the current test, removed recursively in afterEach. */
let tempDirs: string[] = []

/**
 * 记录并返回 disposer:既进入 afterEach 的统一清理队列,也便于用例内提前取消提供。
 * Track and return a disposer: it joins the afterEach cleanup queue and can still
 * be called early inside the test to unprovide.
 */
const track = (disposer: unknown): (() => unknown) => {
    const dispose = disposer as () => unknown
    disposers.push(dispose)
    return dispose
}

afterEach(async () => {
    // allSettled:单个 disposer 抛错不掩盖其余清理,也不掩盖用例自身的断言结果。
    // allSettled: one failing dispose must not mask the others or the test's own assertions.
    await Promise.allSettled(disposers.map(dispose => dispose()))
    disposers.length = 0

    await Promise.all(tempDirs.map(dir => fs.promises.rm(dir, { recursive: true, force: true })))
    tempDirs = []
})

/**
 * 每个用例新建独立 Context,避免跨用例复用触发 "service already registered"。
 * A fresh Context per test; reusing one across tests triggers "service already registered".
 */
const createContext = () => new Context()

/**
 * 轻量 program 桩:只实现 getTypeChecker,用于验证接线逻辑。
 * Minimal program stub that only implements getTypeChecker, for wiring tests.
 */
const stubProgram = (checker: ts.TypeChecker): ts.Program =>
    ({ getTypeChecker: () => checker }) as unknown as ts.Program

/**
 * 用真实源码文件搭起完整编译管线,返回 program 实例与源文件路径,
 * 供派生 checker 做真实语义断言。
 * Wire a real compilation pipeline against a real source file and return the
 * program plus the file path for real semantic assertions.
 *
 * 只用 typescript 本身构建 program:本包的唯一依赖是 program 服务,
 * 不需要引入 compiler-options / compiler-host 这两个非声明依赖。
 * The program is built with plain typescript: this package only depends on the
 * program service, so no undeclared sibling packages are involved.
 */
const setupRealProgram = (ctx: Context) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veren-type-checker-'))
    tempDirs.push(dir)
    const fileName = path.join(dir, 'main.ts')
    fs.writeFileSync(fileName, 'export const answer: number = 42\n', 'utf8')

    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022 }
    const host = ts.createCompilerHost(options, /* setParentNodes */ true)
    const program = ts.createProgram([fileName], options, host)
    track(provideValue(ctx, ProgramToken, program))

    return { program, fileName }
}

describe('token', () => {
    it("name 为 'verenTypeChecker' / name is 'verenTypeChecker'", () => {
        // 令牌加 `veren` 前缀以避免跨包重名。
        // The token carries the `veren` prefix to avoid collisions between packages.
        expect(name).toBe('verenTypeChecker')
    })

    it('inject 仅依赖 program token / inject depends only on the program token', () => {
        expect(inject).toHaveLength(1)
        expect(inject).toEqual([ProgramToken])
    })
})

describe('apply', () => {
    it('缺少 program 时抛错,错误消息包含 token 名 / throws with the token name when program is missing', () => {
        const ctx = createContext()

        expect(() => apply(ctx)).toThrowError(`Value for token ${ProgramToken} not found in context`)
    })

    it('stub program 时,提供的是 getTypeChecker() 的返回值 / with a stub program the provided value is getTypeChecker()\'s result', () => {
        const ctx = createContext()
        const sentinel = { __stub: true } as unknown as ts.TypeChecker

        track(provideValue(ctx, ProgramToken, stubProgram(sentinel)))
        track(apply(ctx))

        expect(get(ctx, name)).toBe(sentinel)
    })

    it('同一 program 多次 apply,得到的 checker 相同 / repeated apply on the same program yields the same checker', () => {
        const ctx = createContext()
        const sentinel = { __stub: true } as unknown as ts.TypeChecker

        track(provideValue(ctx, ProgramToken, stubProgram(sentinel)))

        const firstDispose = track(apply(ctx))
        expect(get(ctx, name)).toBe(sentinel)

        // cordis 不允许同名服务重复注册,先取消提供再重新 apply。
        // cordis rejects duplicate registration, so unprovide before applying again.
        firstDispose()
        track(apply(ctx))

        expect(get(ctx, name)).toBe(sentinel)
    })

    it('返回的 disposer 调用后服务被移除,且同一 Context 可重新 apply / the disposer removes the service and apply can run again', () => {
        const ctx = createContext()
        const sentinel = { __stub: true } as unknown as ts.TypeChecker

        track(provideValue(ctx, ProgramToken, stubProgram(sentinel)))

        const dispose = track(apply(ctx))
        expect(get(ctx, name)).toBe(sentinel)

        dispose()
        expect(get(ctx, name)).toBeUndefined()

        track(apply(ctx))
        expect(get(ctx, name)).toBe(sentinel)
    })
})

describe('派生 checker(真实 program)/ derived checker with a real program', () => {
    it('能反解临时目录中 ts 文件的变量类型 / resolves the variable type of a real ts file', () => {
        const ctx = createContext()
        const { program, fileName } = setupRealProgram(ctx)
        track(apply(ctx))

        const checker = get(ctx, name)!
        const sourceFile = program.getSourceFile(fileName)
        expect(sourceFile).toBeDefined()

        // 定位 `export const answer: number = 42` 对应的变量声明。
        // Locate the variable declaration of `export const answer: number = 42`.
        const statement = sourceFile!.statements.find(ts.isVariableStatement)!
        const declaration = statement.declarationList.declarations[0]

        expect(checker.typeToString(checker.getTypeAtLocation(declaration))).toBe('number')
    })

    it('提供的 checker 与 program.getTypeChecker() 同源(同一实例)/ the provided checker is the very same instance as program.getTypeChecker()', () => {
        const ctx = createContext()
        const { program } = setupRealProgram(ctx)
        track(apply(ctx))

        // ts.Program 会缓存 TypeChecker,apply 派生的正是同一实例。
        // ts.Program caches its TypeChecker, so the derived one is the very same instance.
        expect(get(ctx, name)).toBe(program.getTypeChecker())
    })
})
