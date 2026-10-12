/**
 * 编译器流水线的数据类型：编译输入、源码区间、被搜集的类型信息与产出。
 * 流水线本身的编排（抽象类 Compiler）见 ./compiler.ts。
 *
 * Data types of the compiler pipeline: compile inputs, source spans, the
 * collected type information and the emitted product. The pipeline
 * orchestration itself (the abstract Compiler class) lives in ./compiler.ts.
 */

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
