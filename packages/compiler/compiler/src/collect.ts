/**
 * 类型元数据搜集：找出 JS 会擦除的声明，再用 TypeChecker 反解类型。
 * Type-metadata collection: find declarations erased by JS, then resolve their
 * types through the TypeChecker.
 */
import * as ts from 'typescript'
import type { SourceSpan, TypeMetadata, TypeMetadataKind } from './types.js'

/** 一个待解析的声明及其元数据种类 / A declaration to resolve and its metadata kind */
export interface Target {
    readonly node: ts.Node
    readonly kind: TypeMetadataKind
    readonly sourceFile: ts.SourceFile
}

/** 找出一个源文件里会被擦除的顶层声明 / Find top-level declarations erased in JS */
export function findTargets(sourceFile: ts.SourceFile): Target[] {
    const targets: Target[] = []
    for (const statement of sourceFile.statements) {
        const kind = topLevelKind(statement)
        if (kind) targets.push({ node: statement, kind, sourceFile })
    }
    return targets
}

/** 把一个目标解析成完整的 TypeMetadata / Resolve one target into full metadata */
export function resolveTarget(target: Target, checker: ts.TypeChecker): TypeMetadata {
    const base = describe(target.node, target.kind, target.sourceFile, checker)
    const node = target.node
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        return { ...base, ...containerFields(node, checker, target.sourceFile) }
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node)) {
        const typeParameters = typeParametersOf(node.typeParameters, checker, target.sourceFile)
        return { ...base, ...(typeParameters.length > 0 ? { typeParameters } : {}) }
    }
    return base
}

/** 顶层声明 → 元数据种类；不属于擦除清单的返回 undefined / Top-level statement → kind, or undefined */
function topLevelKind(node: ts.Statement): TypeMetadataKind | undefined {
    if (ts.isInterfaceDeclaration(node)) return 'interface'
    if (ts.isTypeAliasDeclaration(node)) return 'type-alias'
    if (ts.isEnumDeclaration(node)) return 'enum'
    if (ts.isClassDeclaration(node)) return 'class'
    if (ts.isFunctionDeclaration(node)) return 'function'
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return 'type-import'
    if (ts.isExportDeclaration(node) && node.isTypeOnly) return 'type-import'
    return undefined
}

/** 构造单条元数据（名字、区间、类型文本、可见性）/ Build one metadata entry */
function describe(
    node: ts.Node,
    kind: TypeMetadataKind,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
): TypeMetadata {
    const typeText = typeTextOf(node, checker)
    const visibility = visibilityOf(node)
    return {
        kind,
        name: nameOf(node),
        span: spanOf(node, sourceFile),
        ...(typeText === undefined ? {} : { typeText }),
        ...(visibility === undefined ? {} : { visibility }),
    }
}

/** interface / class 的成员、泛型参数与继承链 / Members, type parameters and heritage of an interface/class */
function containerFields(
    node: ts.InterfaceDeclaration | ts.ClassDeclaration,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
): Pick<TypeMetadata, 'members' | 'typeParameters' | 'baseTypes'> {
    const members = node.members
        .map((member) => memberMetadata(member, checker, sourceFile))
        .filter((member): member is TypeMetadata => member !== undefined)
    const typeParameters = typeParametersOf(node.typeParameters, checker, sourceFile)
    const baseTypes = (node.heritageClauses ?? []).flatMap((clause) =>
        clause.types.map((type) => checker.typeToString(checker.getTypeAtLocation(type))),
    )
    return {
        ...(members.length > 0 ? { members } : {}),
        ...(typeParameters.length > 0 ? { typeParameters } : {}),
        ...(baseTypes.length > 0 ? { baseTypes } : {}),
    }
}

/** 类/接口成员 → property / method 元数据 / Class or interface member → property/method metadata */
function memberMetadata(
    node: ts.ClassElement | ts.TypeElement,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
): TypeMetadata | undefined {
    if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
        return describe(node, 'property', sourceFile, checker)
    }
    if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) {
        return describe(node, 'method', sourceFile, checker)
    }
    return undefined
}

/** 泛型参数列表 → generic 元数据 / Type parameter list → generic metadata */
function typeParametersOf(
    parameters: readonly ts.TypeParameterDeclaration[] | undefined,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
): TypeMetadata[] {
    return (parameters ?? []).map((parameter) => {
        const constraint = parameter.constraint
            ? checker.typeToString(checker.getTypeFromTypeNode(parameter.constraint))
            : undefined
        const fallback = parameter.default
            ? checker.typeToString(checker.getTypeFromTypeNode(parameter.default))
            : undefined
        const typeText = [constraint ? `extends ${constraint}` : '', fallback ? `= ${fallback}` : '']
            .filter(Boolean)
            .join(' ')
        return {
            kind: 'generic',
            name: parameter.name.text,
            span: spanOf(parameter, sourceFile),
            ...(typeText ? { typeText } : {}),
        }
    })
}

/** 用 checker 反解声明名字上的类型；类型别名取右侧表达式的类型 / Resolve the type at the declaration name; aliases use their right-hand side */
function typeTextOf(node: ts.Node, checker: ts.TypeChecker): string | undefined {
    if (ts.isTypeAliasDeclaration(node)) {
        return checker.typeToString(checker.getTypeFromTypeNode(node.type))
    }
    const name = (node as ts.NamedDeclaration).name
    if (!name) return undefined
    const symbol = checker.getSymbolAtLocation(name)
    if (!symbol) return checker.typeToString(checker.getTypeAtLocation(name))
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
        return checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol))
    }
    return checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, name))
}

/** 声明名；匿名声明为空串，type-only import/export 用模块名 / Declaration name; empty for anonymous declarations, module text for type-only imports */
function nameOf(node: ts.Node): string {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : ''
    }
    const name = (node as ts.NamedDeclaration).name
    if (!name) return ''
    return ts.isIdentifier(name) ? name.text : name.getText()
}

/** 可见性只在显式写出时记录 / Visibility is recorded only when explicitly written */
function visibilityOf(node: ts.Node): TypeMetadata['visibility'] {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (!modifiers) return undefined
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) return 'private'
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected'
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PublicKeyword)) return 'public'
    return undefined
}

/** 声明区间与从 0 开始的行列号 / Declaration span and zero-based line/character */
function spanOf(node: ts.Node, sourceFile: ts.SourceFile): SourceSpan {
    const start = node.getStart(sourceFile)
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
    return { fileName: sourceFile.fileName, start, end: node.getEnd(), line, character }
}
