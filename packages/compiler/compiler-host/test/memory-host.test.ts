import { afterEach, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryCompilerHost } from '../src/index'

/** Windows 下把反斜杠换成正斜杠,与 TS 内部的路径形态保持一致。
 *  Convert backslashes to forward slashes to match TS's internal path shape. */
const toPosix = (p: string) => p.replace(/\\/g, '/')

/** TS 内部把路径规范化为正斜杠,且在大小写不敏感的系统上转小写;
 *  内存文件的 fileName 只有与该形态一致,才能被模块解析精确命中。
 *  TS canonicalizes paths to forward slashes (lowercased on
 *  case-insensitive systems); in-memory fileNames must use the same shape
 *  for module resolution to hit them. */
const canonicalize = (p: string) => {
    const posix = toPosix(p)
    return ts.sys.useCaseSensitiveFileNames ? posix : posix.toLowerCase()
}

/** 测试运行时创建的临时目录统一记录在这里,afterEach 中全部删除。
 *  Temporary directories created at runtime, all removed again in afterEach. */
const tempDirs: string[] = []

afterEach(async () => {
    const dirs = tempDirs.splice(0)
    await Promise.allSettled(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

/** 构造一个内存 SourceFile(parentNodes 开启,便于断言节点结构)。
 *  Build an in-memory SourceFile (parentNodes on, so nodes carry parents). */
const createMemoryFile = (fileName: string, text = 'export const a = 1;') =>
    ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)

/** 磁盘上不存在的绝对路径,专用于内存文件的 fileName。TS 的
 *  createSourceFile 会把 fileName 规范化为正斜杠形态,这里同样转成正
 *  斜杠,保证与内存 map 的键(f.fileName)精确一致。
 *  An absolute path that does not exist on disk, used as an in-memory
 *  fileName. ts.createSourceFile normalizes fileName to forward slashes,
 *  so convert here too to match the memory map key (f.fileName) exactly. */
const memPath = (name: string) => toPosix(fileURLToPath(new URL(`./__mem__/${name}`, import.meta.url)))

/** 被测包自身的 package.json(真实存在的磁盘文件,用于回落验证)。
 *  同样使用正斜杠形态:createSourceFile 对 .json 会断言 fileName 与
 *  规范化后的路径完全相等,反斜杠会触发 Debug Failure。
 *  This package's own package.json: a real on-disk file for fallback
 *  checks. Posix form again — createSourceFile asserts fileName equals
 *  its normalized path for .json, and backslashes trigger a Debug Failure. */
const packageJsonPath = toPosix(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('createMemoryCompilerHost', () => {
    it('getSourceFile 对内存文件精确命中并返回同一引用', () => {
        const sf = createMemoryFile(memPath('a.ts'))
        // byFile 以 f.fileName(TS 规范化后的形态)为键,查找串必须完全一致。
        // byFile is keyed by f.fileName (TS-normalized); lookups must match it exactly.
        const file = sf.fileName
        const host = createMemoryCompilerHost({}, [sf])

        expect(host.getSourceFile!(file, ts.ScriptTarget.ES2022)).toBe(sf)
    })

    it('fileExists / readFile / getSourceFileByPath 同样命中内存文件', () => {
        const text = 'export const a = 1;'
        const sf = createMemoryFile(memPath('a.ts'), text)
        const file = sf.fileName
        const host = createMemoryCompilerHost({}, [sf])

        expect(host.fileExists(file)).toBe(true)
        expect(host.readFile!(file)).toBe(text)
        expect(host.getSourceFileByPath!(file, file as ts.Path, ts.ScriptTarget.ES2022)).toBe(sf)
    })

    it('内存文件优先于磁盘上的同名文件', () => {
        // package.json 真实存在,但内存 SourceFile 应当优先命中。
        // package.json exists on disk, yet the in-memory SourceFile wins.
        const override = createMemoryFile(packageJsonPath, 'export const overridden = true;')
        const file = override.fileName
        const host = createMemoryCompilerHost({}, [override])

        expect(host.getSourceFile!(file, ts.ScriptTarget.ES2022)).toBe(override)
        expect(host.readFile!(file)).toBe('export const overridden = true;')
        expect(host.fileExists(file)).toBe(true)
    })

    it('其余请求回落磁盘:真实存在的文件可读、可解析', () => {
        const host = createMemoryCompilerHost({}, [])

        expect(host.fileExists(packageJsonPath)).toBe(true)
        expect(host.readFile!(packageJsonPath)).toContain('"name"')
        expect(host.getSourceFile!(packageJsonPath, ts.ScriptTarget.ES2022)).toBeDefined()
    })

    it('不存在的路径:fileExists false / readFile undefined / getSourceFile undefined', () => {
        const host = createMemoryCompilerHost({}, [])
        const missing = packageJsonPath + '.nonexistent'

        expect(host.fileExists(missing)).toBe(false)
        expect(host.readFile!(missing)).toBeUndefined()
        expect(host.getSourceFile!(missing, ts.ScriptTarget.ES2022)).toBeUndefined()
    })

    it('spread 保留 base host 的其余方法', () => {
        const host = createMemoryCompilerHost({}, [])

        expect(host.getCanonicalFileName).toBeTypeOf('function')
        expect(host.writeFile).toBeTypeOf('function')
        expect(host.getCurrentDirectory).toBeTypeOf('function')
        expect(host.getNewLine).toBeTypeOf('function')
        // 行为也与默认 host 一致。
        expect(host.getCurrentDirectory()).toBe(ts.sys.getCurrentDirectory())
    })

    it('回落磁盘读取测试运行时创建的临时文件', async () => {
        // 临时目录记录进 tempDirs,由 afterEach 负责删除。
        // The temp dir is recorded in tempDirs and removed by afterEach.
        const dir = await mkdtemp(join(tmpdir(), 'compiler-host-'))
        tempDirs.push(dir)
        const file = join(dir, 'on-disk.ts')
        await writeFile(file, 'export const b = 2;\n', 'utf8')

        const host = createMemoryCompilerHost({}, [])
        const sf = host.getSourceFile!(file, ts.ScriptTarget.ES2022)

        expect(sf).toBeDefined()
        expect(sf!.text).toBe('export const b = 2;\n')
    })

    it('内存文件参与模块解析与 createProgram', async () => {
        // 目录真实存在于磁盘,避免 TS 目录存在性检查影响解析。
        // The directory really exists on disk, so TS's directory checks pass.
        const dir = canonicalize(await mkdtemp(join(tmpdir(), 'compiler-host-mem-')))
        tempDirs.push(toPosix(dir))

        // 根文件 main.ts 导入内存文件 a.ts;两者都只存在于内存。
        // Root main.ts imports in-memory a.ts; both exist in memory only.
        const mainPath = `${dir}/main.ts`
        const libPath = `${dir}/a.ts`
        const main = createMemoryFile(
            mainPath,
            "import { a } from './a';\nexport const total = a + 1;\n",
        )
        const lib = createMemoryFile(libPath)
        const host = createMemoryCompilerHost({}, [main, lib])

        // 1) resolveModuleName 直接解析命中内存文件。
        const resolved = ts.resolveModuleName('./a', mainPath, {}, host)
        expect(resolved.resolvedModule?.resolvedFileName).toBe(libPath)

        // 2) createProgram 全流程:根文件与导入均来自内存。
        const program = ts.createProgram({ rootNames: [mainPath], options: {}, host })
        expect(program.getSourceFile(mainPath)).toBe(main)
        // 若 './a' 未命中内存文件,这里会出现 2307 (Cannot find module) 诊断。
        // If './a' missed the memory host, a 2307 diagnostic would appear here.
        expect(program.getSemanticDiagnostics(main)).toHaveLength(0)
    })
})
