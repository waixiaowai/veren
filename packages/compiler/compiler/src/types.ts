/**
 * 定义一个编译器抽象类，用于解析ts源码
 * 搜集ts编译成js后丢失的类型信息
 *
 * 参考: angular.compiler 设计
 *
 * 编译流水线（模板方法编排，子类按阶段实现扩展点）:
 *   load    资源加载 —— 对应 angular 的 ResourceLoader
 *   parse   构建 ts.Program —— 获得 AST、模块图与 TypeChecker
 *   analyze 扫描 AST —— 找出"会被擦除的声明"，产出待搜集符号
 *   collect 借助 TypeChecker 反解完整类型信息，写入元数据仓库
 *   emit    汇总仓库，产出最终元数据（可序列化）
 *
 * An abstract compiler that parses TypeScript sources and collects the type
 * information that is lost once TypeScript is compiled down to JavaScript.
 *
 * Reference: the angular.compiler design.
 *
 * Pipeline (orchestrated by a template method; subclasses implement the stages):
 *   load    resource loading — angular's ResourceLoader
 *   parse   build ts.Program — AST, module graph and TypeChecker
 *   analyze scan the AST — find the declarations that will be erased
 *   collect resolve full type information through the TypeChecker into the registry
 *   emit    aggregate the registry into the final, serializable metadata
 */
import { DiagnosticCategory } from 'typescript';
import type * as ts from 'typescript';

/* ============================================================
 * 支撑类型定义 / Supporting type definitions
 * ============================================================ */

/**
 * 编译输入：磁盘文件或内存源码（后者用于单测 / 虚拟文件系统）
 *
 * Compile input: a file on disk or an in-memory source (the latter is used by
 * unit tests and virtual file systems).
 */
export interface CompileInput {
  /**
   * 文件路径，同时作为模块标识符与元数据归档键
   *
   * File path; it also serves as the module identifier and the metadata archive key.
   */
  readonly fileName: string;
  /**
   * 源码文本；缺省时由资源加载阶段从磁盘读取
   *
   * Source text; when omitted, the resource loading stage reads it from disk.
   */
  readonly content?: string;
}

/**
 * 源码区间，用于定位声明（错误上报 / 文档生成）
 *
 * A source span used to locate a declaration (error reporting / documentation).
 */
export interface SourceSpan {
  readonly fileName: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly character: number;
}

/**
 * 类型信息种类 —— TS→JS 编译过程中会被擦除的内容清单
 *
 * Metadata kinds — the inventory of what TypeScript erases while compiling to JS.
 */
export type TypeMetadataKind =
  | 'interface'    // interface 声明整体被擦除 / the whole declaration is erased
  | 'type-alias'   // type 别名整体被擦除 / the whole alias declaration is erased
  | 'enum'         // enum 的类型侧信息（成员类型关系）丢失 / the type side of an enum (member type relations) is lost
  | 'class'        // 泛型参数、implements、成员类型丢失 / generic parameters, implements clauses and member types are lost
  | 'function'     // 重载签名、泛型参数丢失 / overload signatures and generic parameters are lost
  | 'method'       // 同 function，override 标记丢失 / like function, plus the override marker is lost
  | 'property'     // 类型注解、readonly、可见性丢失 / type annotations, readonly and visibility are lost
  | 'parameter'    // 参数类型注解、parameter property 修饰符丢失 / parameter type annotations and parameter-property modifiers are lost
  | 'generic'      // 泛型参数的约束、默认值丢失 / generic parameter constraints and defaults are lost
  | 'decorator'    // 装饰器元数据丢失 / decorator metadata is lost
  | 'type-import'; // import type / export type 整条语句被擦除 / whole import type or export type statements are erased

/**
 * 单条被搜集的类型信息
 *
 * A single collected piece of type information.
 */
export interface TypeMetadata {
  readonly kind: TypeMetadataKind;
  /**
   * 声明名；匿名声明为空字符串
   *
   * Declaration name; an empty string for anonymous declarations.
   */
  readonly name: string;
  /**
   * 类型文本（如 "Promise<Map<string, User>>"），由 TypeChecker 反解
   *
   * Type text (e.g. "Promise<Map<string, User>>"), resolved by the TypeChecker.
   */
  readonly typeText?: string;
  /**
   * 源码位置
   *
   * Location of the declaration in the source.
   */
  readonly span: SourceSpan;
  /**
   * 泛型参数（含约束与默认值），嵌套同构
   *
   * Generic parameters, constraints and defaults included; nested the same way.
   */
  readonly typeParameters?: readonly TypeMetadata[];
  /**
   * 成员列表（class / interface 的属性与方法）
   *
   * Member list (properties and methods of a class or interface).
   */
  readonly members?: readonly TypeMetadata[];
  /**
   * 继承 / 实现的类型名（extends、implements 链）
   *
   * Names of the extended / implemented types (the extends and implements chain).
   */
  readonly baseTypes?: readonly string[];
  /**
   * 可见性 —— 修饰符在 JS 中被擦除
   *
   * Visibility — the modifier itself is erased in JS.
   */
  readonly visibility?: 'public' | 'protected' | 'private';
  /**
   * 附加信息（JSDoc 等，是否保留由子类策略决定）
   *
   * Extra information such as JSDoc; whether to keep it is the subclass's policy.
   */
  readonly jsDoc?: string;
}

/**
 * emit 阶段产物
 *
 * The product of the emit stage.
 */
export interface EmitResult {
  /**
   * 本次搜集到的全部类型信息（按文件归并展开）
   *
   * All type information collected in this run, merged per file and flattened.
   */
  readonly metadata: readonly TypeMetadata[];
  /**
   * 可序列化产物（如 JSON manifest 文本），是否生成由子类决定
   *
   * A serializable product (e.g. JSON manifest text); whether to produce it is
   * the subclass's decision.
   */
  readonly output?: string;
}

/* ============================================================
 * 编译器抽象类 / The abstract compiler
 * ============================================================ */

export abstract class Compiler {
  /* ---------------- 属性 / Properties ---------------- */

  /**
   * 编译选项（target / strict 等）；子类负责默认值与合并策略
   *
   * Compiler options (target / strict, ...); subclasses own the defaults and the
   * merging strategy.
   */
  abstract get options(): ts.CompilerOptions;

  /**
   * 当前 TS 程序（AST + 模块图）；仅在 parse 之后有效
   *
   * The current TS program (AST + module graph); valid only after parse.
   */
  abstract get program(): ts.Program;

  /**
   * 类型检查器 —— 反解类型信息的唯一来源；
   * 必须与 program 同源（program.getTypeChecker()），仅在 parse 之后有效
   *
   * Type checker — the single source for resolving type information; it must come
   * from the same source as the program (program.getTypeChecker()) and is valid
   * only after parse.
   */
  abstract get checker(): ts.TypeChecker;

  /**
   * 元数据仓库: fileName -> 该文件的类型信息，也是增量编译的基础
   *
   * Metadata registry: fileName -> the type information of that file; it is also
   * the basis for incremental compilation.
   */
  protected readonly metadataRegistry = new Map<string, TypeMetadata[]>();

  /**
   * 诊断队列，贯穿整条流水线（语法 / 语义 / 搜集阶段共用）
   *
   * Diagnostic queue shared across the whole pipeline (syntax / semantic /
   * collection stages).
   */
  private readonly diagnostics: ts.Diagnostic[] = [];

  /**
   * parse 是否已完成，用于查询接口的状态守卫
   *
   * Whether parse has completed; used as the state guard of the query API.
   */
  private parseDone = false;

  /* ---------------- 模板方法: 流水线编排（子类不应重写）/ Template method: pipeline orchestration (subclasses should not override) ---------------- */

  /**
   * 完整编译入口。幂等：每次调用先复位状态再走完整流水线。
   * 如需异步资源加载，可仿照 angular JitCompiler 增设 compileAsync 变体。
   *
   * The full compilation entry point. Idempotent: every call resets the state and
   * then runs the complete pipeline. For asynchronous resource loading, a
   * compileAsync variant can be added in the spirit of angular's JitCompiler.
   */
  compile(inputs: readonly CompileInput[]): EmitResult {
    this.reset();
    const files = this.load(inputs);   // 1. 资源加载 / resource loading
    this.parse(files);                 // 2. 构建 Program / build the Program
    this.analyze();                    // 3. 扫描将被擦除的声明 / scan declarations erased in JS
    this.collect(files);               // 4. 反解并搜集类型信息 / resolve and collect type information
    const result = this.emit();        // 5. 汇总产出 / aggregate the product
    this.parseDone = true;
    return result;
  }

  /* ---------------- 各阶段抽象方法: 子类必须实现 / Stage hooks: subclasses must implement ---------------- */

  /**
   * 资源加载：决定从磁盘还是虚拟 FS 读取源码，
   * 并创建 ts.SourceFile（对应 angular 的 ResourceLoader）
   *
   * Resource loading: decides whether sources come from disk or a virtual file
   * system and creates the ts.SourceFile instances (angular's ResourceLoader).
   */
  protected abstract load(inputs: readonly CompileInput[]): readonly ts.SourceFile[];

  /**
   * 解析：创建 ts.Program（含模块图与 checker）
   *
   * Parsing: creates the ts.Program (module graph and checker included).
   */
  protected abstract parse(files: readonly ts.SourceFile[]): ts.Program;

  /**
   * 扫描：遍历 AST，识别"会被编译到 JS 时擦除的声明"，
   * 产出待搜集符号清单（对应 angular NgCompiler 的 analyze 阶段）
   *
   * Analysis: walks the AST, identifies the declarations whose types are erased
   * when compiling to JS and produces the list of symbols to resolve (angular
   * NgCompiler's analyze stage).
   */
  protected abstract analyze(): void;

  /**
   * 搜集：借助 checker 把符号反解为 TypeMetadata，写入 metadataRegistry
   *
   * Collection: resolves the symbols into TypeMetadata through the checker and
   * writes them into metadataRegistry.
   */
  protected abstract collect(files: readonly ts.SourceFile[]): void;

  /**
   * 产出：汇总 registry 生成最终元数据（对应 angular 的 emit 阶段）
   *
   * Emission: aggregates the registry into the final metadata (angular's emit stage).
   */
  protected abstract emit(): EmitResult;

  /* ---------------- 查询接口 / Query API ---------------- */

  /**
   * 读取某文件搜集到的类型信息：compile 之前调用抛错（快速失败），
   * 未知文件返回空数组
   *
   * Type information collected for one file: throws before a successful compile
   * (fail fast) and returns an empty array for unknown files.
   */
  getMetadata(fileName: string): readonly TypeMetadata[] {
    this.ensureParsed();
    return this.metadataRegistry.get(fileName) ?? [];
  }

  /**
   * 读取全部诊断信息
   *
   * Reads every diagnostic reported so far.
   */
  getDiagnostics(): readonly ts.Diagnostic[] {
    return this.diagnostics;
  }

  /**
   * 是否存在错误级诊断
   *
   * Whether an error-level diagnostic exists.
   */
  hasErrors(): boolean {
    return this.diagnostics.some((d) => d.category === DiagnosticCategory.Error);
  }

  /* ---------------- 供子类使用的工具方法 / Helpers for subclasses ---------------- */

  /**
   * 上报一条诊断（analyze / collect 阶段均可调用）
   *
   * Reports one diagnostic (callable from the analyze and collect stages).
   */
  protected report(diagnostic: ts.Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  /**
   * 归档单个文件的类型信息（collect 阶段调用）；
   * 同一文件多次调用会累加而不是覆盖
   *
   * Archives the type information of one file (called from the collect stage);
   * repeated calls for the same file append instead of replacing.
   */
  protected addMetadata(fileName: string, entries: readonly TypeMetadata[]): void {
    const list = this.metadataRegistry.get(fileName) ?? [];
    this.metadataRegistry.set(fileName, [...list, ...entries]);
  }

  /**
   * 流水线复位，保证 compile() 幂等
   *
   * Resets the pipeline so that compile() stays idempotent.
   */
  protected reset(): void {
    this.diagnostics.length = 0;
    this.metadataRegistry.clear();
    this.parseDone = false;
  }

  /**
   * 依赖 parse 产物的接口在未解析时快速失败
   *
   * Query APIs that depend on the parse product fail fast when it is missing.
   */
  protected ensureParsed(): void {
    if (!this.parseDone) {
      throw new Error('Compiler: parse 尚未完成，请先调用 compile()');
    }
  }
}
