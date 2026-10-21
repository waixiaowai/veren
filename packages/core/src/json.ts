/**
 * 无损 JSON 投影：把只读视图投影成工具结果所携带的可变一般 JSON。
 * Lossless JSON projection: turns a readonly view into the mutable plain JSON a
 * tool result carries.
 *
 * 这一份是本仓库的唯一声明。此前 forum 与 notebook 各抄一份逐字相同的实现，
 * 两处一旦分叉（例如一方补了可选成员的处理），工具输出契约就会静默分家。
 * This is the repository's single declaration. forum and notebook used to carry
 * byte-identical copies; any divergence between them would silently split the
 * tool-output contract in two.
 *
 * @module @veren/core/json
 */

/**
 * 无损 JSON 联合（不可经 interface 再打开，故以子类型递归写成）。
 * The lossless-JSON union, spelled as a recursive alias because an interface
 * cannot be re-opened.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined }

/**
 * 视图作为 Tool 结果所携带的、可变的一般 JSON。
 *
 * 可选成员保持可选、数组一律变可变，因为声明的输出 schema 推导出的正是这样；
 * 递归在 {@link Json} 联合处终止，该联合已包含自身。
 * A view as the plain, mutable JSON a Tool result carries. Optional members stay
 * optional and arrays become mutable, matching what the declared output schema
 * infers; recursion terminates on {@link Json}, which already contains itself.
 */
export type JsonShape<T> = T extends readonly (infer Item)[]
  ? JsonShape<Item>[]
  : T extends object
    ? { [K in keyof T]: JsonShape<T[K]> }
    : T extends Json
      ? T
      : never

/**
 * 把视图投影成 Tool 结果携带的规范 JSON。
 *
 * 序列化再解析正好完成这一步投影，并且是无法经受 JSON 往返的值暴露出来的地方
 * （而不是让它悄悄送到模型面前）。
 * Projects a view onto the canonical JSON a tool result carries. A
 * serialize-and-parse pass performs exactly that projection, and it is where a
 * value that cannot survive a JSON round trip surfaces instead of silently
 * reaching the model.
 *
 * @param value 待投影的视图或视图列表 / the view or list of views to project
 * @returns 同一份数据的规范 JSON / the same data as canonical JSON
 */
export function jsonOf<T>(value: T): JsonShape<T> {
  return JSON.parse(JSON.stringify(value)) as JsonShape<T>
}
