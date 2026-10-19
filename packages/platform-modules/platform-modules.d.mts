/**
 * 外壳冻结模块表的字面量元组声明：拼错的模块名是编译错误，而不是运行期空 external。
 *
 * Literal-tuple declaration for the shell's frozen module table: a misspelled
 * specifier is a compile error instead of an empty external at runtime.
 */
export declare const PLATFORM_MODULES: readonly [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]
