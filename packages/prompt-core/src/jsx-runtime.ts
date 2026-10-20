/**
 * JSX runtime：esbuild `jsx: "react-jsx"` + `jsxImportSource: "@veren/prompt-core"` 的入口。
 * JSX runtime for the automatic transform — pages are authored in TSX.
 *
 * children 走 props.children（数组即 Fragment 组件语义）；key 从 props 提升；对象冻结。
 */
import { createElement } from './element.ts'
import type { PromptElement } from './types.ts'

/** Fragment：children 数组原样返回（组件返回数组即 Fragment）*/
export function Fragment(props: { children?: PromptElement[] }): PromptElement[] {
  return props.children ?? []
}

/** 自动转换的 jsx 入口 / automatic-runtime jsx entry */
export function jsx(type: unknown, props: Record<string, unknown> | null, key?: string): PromptElement {
  return fromProps(type, props, key)
}

/** 静态 children 变体（与 jsx 等价，转换器按 children 是否可能变化区分调用）*/
export const jsxs = jsx

/** 开发变体（与 jsx 等价；source 信息暂不接入）/ dev variant (same behavior) */
export const jsxDEV = jsx

function fromProps(type: unknown, props: Record<string, unknown> | null, key?: string): PromptElement {
  const { children, ...rest } = props ?? {}
  return createElement(
    type as never,
    {
      ...(children !== undefined ? { children } : {}),
      ...rest,
      ...(key !== undefined ? { key } : {}),
    } as Record<string, unknown>,
  )
}

/** 最小 JSX 命名空间声明（Element = 单元素或数组，TSX 组件两种返回都合法）*/
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = PromptElement | readonly PromptElement[]
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface ElementClass {}
    interface ElementChildrenAttribute {
      children: {}
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>
    }
  }
}
