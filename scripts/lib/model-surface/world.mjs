/**
 * 提取世界的底座：加载一个工作区（root 下每个插件包的 src 的全部 ts/tsx）并为
 * 每个文件建 Unit（顶层声明、相对导入、@veren 包导入、再导出映射）。解析器
 * （工具目录、页面、挂载面）都从 World 取导航与查找——Unit 是唯一寻址层。
 * The extraction world's substrate: loads a workspace (every ts/tsx under
 * root/plugins/&lt;pkg&gt;/src) and builds a Unit per file (top-level declarations,
 * relative imports, @veren package imports, re-export mapping). The resolvers
 * navigate and look up through the World — the Unit is the only addressing
 * layer.
 * @module scripts/lib/model-surface/world
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

/** 路径归一（反斜杠 → 正斜杠；TS AST 的 fileName 是正斜杠）/ path normalization (backslashes → slashes; TS AST fileNames use slashes) */
export function normPath(path) {
  return path.split('\\').join('/')
}

/** 每文件提取单元 / one file's extraction unit */
export class Unit {
  /** @param {string} path - absolute file path / 绝对路径 */
  constructor(path, sourceFile, packageEntries) {
    this.path = path
    this.sourceFile = sourceFile
    /** 顶层标识符 → 声明节点 / top-level name → declaring node */
    this.declarations = collectTopLevelDeclarations(sourceFile)
    /** 全文件变量声明（含函数体内，重名取先）/ every variable declaration in the file (first on redeclaration) */
    this.allVars = collectAllVariables(sourceFile)
    /** 导入名 → 目标绝对路径（相对文件或包入口）/ imported name → target path */
    this.imports = collectImports(path, sourceFile, packageEntries)
    /** 再导出名 → 源文件绝对路径 / re-exported name → source file path */
    this.reexports = collectReexports(path, sourceFile)
  }

  /** 取本文件的解析单元（self）/ the unit of a path (self) */
  unitOf() { return this }

  /** 按名找顶层函数声明 / find a top-level function declaration by name */
  functionOf(name) {
    const found = this.declarations.get(name)
    return found !== undefined && ts.isFunctionDeclaration(found) ? found : undefined
  }

  /** 按名找顶层变量声明 / find a top-level variable declaration by name */
  constOf(name) {
    const found = this.declarations.get(name)
    return found !== undefined && ts.isVariableDeclaration(found) ? found : undefined
  }
}

/** 顶层声明收集（变量与函数）/ collect top-level declarations (variables and functions) */
function collectTopLevelDeclarations(sourceFile) {
  const declarations = new Map()
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declarations.set(statement.name.text, statement)
    }
  }
  return declarations
}

/** 全文件变量声明（局部变量也算，重名取先）/ every variable declaration in the file (locals included, first wins) */
function collectAllVariables(sourceFile) {
  const allVars = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && !allVars.has(node.name.text)) {
      allVars.set(node.name.text, node)
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return allVars
}

/** 相对与 @veren 包导入映射（name → 绝对路径）/ relative and @veren-package import map (name → absolute path) */
function collectImports(path, sourceFile, packageEntries) {
  const imports = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const spec = statement.moduleSpecifier.text
    const target = importTarget(spec, path, packageEntries)
    const named = statement.importClause?.namedBindings
    if (target === undefined || named === undefined || !ts.isNamedImports(named)) continue
    for (const binding of named.elements) {
      imports.set((binding.propertyName ?? binding.name).text, target)
    }
  }
  return imports
}

/** 导入说明符 → 目标绝对路径（相对文件补后缀；@veren 包取 src/index.ts）/ an import specifier's absolute target */
function importTarget(spec, path, packageEntries) {
  if (spec.startsWith('.')) {
    return resolve(dirname(path), spec.endsWith('.ts') || spec.endsWith('.tsx') ? spec : `${spec}.ts`)
  }
  return packageEntries?.get(spec) ?? undefined
}

/** 再导出映射（`export { X } from './y.ts'`）/ the re-export map */
function collectReexports(path, sourceFile) {
  const reexports = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const target = importTarget(statement.moduleSpecifier.text, path)
    if (target === undefined || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue
    for (const binding of statement.exportClause.elements) {
      reexports.set((binding.propertyName ?? binding.name).text, normPath(target))
    }
  }
  return reexports
}

/**
 * 解析一个标识符的声明 Unit（本文件 → 导入源 → 再导出源，最多三跳）。
 * Resolve the Unit declaring an identifier (own file → import source →
 * re-export source, at most three hops).
 * @param {World} world - extraction world / 提取世界
 * @param {string} unitPath - current file / 当前文件
 * @param {string} name - identifier to resolve / 待解析标识符
 * @returns {{ unit: Unit, node: ts.Node }|undefined} declaration site / 声明处
 */
export function declarationOf(world, unitPath, name, hops = 0) {
  if (hops > 3) return undefined
  const unit = world.units.get(normPath(unitPath))
  if (unit === undefined) return undefined
  const local = unit.declarations.get(name)
  if (local !== undefined) return { unit, node: local }
  const targetPath = unit.imports.get(name) ?? unit.reexports.get(name)
  if (targetPath === undefined) return undefined
  return declarationOf(world, targetPath, name, hops + 1)
}

/**
 * 加载工作区：root 下每个插件包的 src 树全部 ts/tsx（跳过产物目录），并建
 * 包名（package.json name）→ src/index.ts 入口映射。
 * Load the workspace: every ts/tsx under each plugin package's src tree
 * (artifact dirs skipped), plus the package-name → src/index.ts entry map.
 * @param {string} root - workspace root / 工作区根
 * @returns {Promise<World>} the loaded world / 加载完成的世界
 */
export async function loadWorld(root) {
  const packagesDir = join(root, 'plugins')
  const packages = await listPackages(packagesDir)
  const packageEntries = new Map()
  for (const pkg of packages) {
    const name = await packageNameOf(join(packagesDir, pkg))
    if (name !== undefined) packageEntries.set(name, join(packagesDir, pkg, 'src', 'index.ts'))
  }
  const files = []
  for (const pkg of packages) files.push(...await collectSources(join(packagesDir, pkg, 'src')))
  const units = new Map()
  for (const file of files) {
    const unit = new Unit(file, ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS), packageEntries)
    unit.path = normPath(file)
    units.set(normPath(file), unit)
  }
  return { root, packages: new Set(packages), units }
}

/** 列插件包名 / list the plugin package names */
async function listPackages(packagesDir) {
  try {
    const entries = await readdir(packagesDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 读包名（package.json 的 name 字段）/ read a package's name field */
async function packageNameOf(packageDir) {
  try {
    return JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))?.name
  } catch {
    return undefined
  }
}

/** 递归收集一个 src 树的 ts/tsx（跳过 node_modules/dist）/ collect ts/tsx under one src tree */
async function collectSources(srcDir) {
  let entries
  try {
    entries = await readdir(srcDir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const path = join(srcDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...await collectSources(path))
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path)
    }
  }
  return files
}
