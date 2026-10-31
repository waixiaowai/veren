/**
 * 页面运行时门面：原单文件按职责域拆分后，本模块只做组装 + re-export，保持
 * `./runtime.ts` 的既有导入路径与导出面零变化。
 * The page-runtime facade: after splitting the original single file by
 * responsibility, this module only assembles and re-exports — the
 * `./runtime.ts` import path and its export face stay byte-for-byte stable.
 *
 * 职责域（内部结构）：
 * - runtime-ports：宿主对接的端口契约（sessions/apps/tasks/deliveries/…）；
 * - resolve-target：页面 URL 目标解析（canonicalize + 应用校验 + 页面命中）；
 * - page-block：PAGE 块与标题/用途短语的纯文本推导；
 * - open-page：打开 URL 的完整流程（幂等守卫/废弃/两阶段创建/渲染/收件箱）；
 * - page-rerender：agent 重建后的重挂（一次性渲染重放）。
 * Responsibility domains (internal structure):
 * - runtime-ports: the port contracts facing the host (sessions/apps/tasks/
 *   deliveries/...);
 * - resolve-target: page-url target resolution (canonicalize + app checks +
 *   page hit);
 * - page-block: pure text derivation for the PAGE block and title/usage
 *   phrases;
 * - open-page: the full open-url flow (idempotence guard/deprecate/two-phase
 *   create/render/inbox pump);
 * - page-rerender: the remount after an agent is recreated (one-shot replay).
 *
 * 打开语义不变：打开一个 URL 一律新建一条会话，旧会话废弃（§3.5.3、§9.1）；
 * 宿主对接走注入端口，端口全部由装配层（app-host）经 bindPorts 纯参数传入。
 * The open semantics are unchanged: opening a url ALWAYS creates a fresh
 * session and deprecates the previous one (§3.5.3, §9.1); host access goes
 * through injected ports passed as pure parameters by app-host's bindPorts.
 *
 * @module @veren/page-registry/runtime
 */
export * from './runtime-ports.ts'
export * from './resolve-target.ts'
export * from './page-block.ts'
export * from './open-page.ts'
export * from './page-rerender.ts'
