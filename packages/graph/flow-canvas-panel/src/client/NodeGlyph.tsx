/**
 * Inline node-type glyphs. They are drawn locally (no icon font or CDN) and
 * inherit `currentColor`, so the host theme controls every stroke.
 *
 * 内联节点类型图标。全部本地绘制（不引图标字体或 CDN），颜色继承 `currentColor`，
 * 由宿主主题决定描边颜色。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/NodeGlyph
 */

/** Shared SVG attributes for the 16px glyph frame. */
const FRAME = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
} as const

/**
 * Draw the type glyph used inside a node card.
 * @param props - the projected node type.
 * @returns a 16px inline SVG.
 */
export function NodeGlyph({ type }: { readonly type: string }) {
    return (
        <svg {...FRAME} aria-hidden="true" focusable="false" data-node-glyph={type}>
            {glyph(type)}
        </svg>
    )
}

/** Pick the path set for one node type; unknown types get a neutral diamond. */
function glyph(type: string) {
    switch (type) {
        case 'noop':
            // A pass-through arrow: the node does nothing but forwards.
            return (
                <>
                    <path d="M2.5 8h6.6" />
                    <path d="m7.4 5.6 2.6 2.4-2.6 2.4" />
                    <path d="M12.8 4.6v6.8" />
                </>
            )
        case 'fail':
            // Alert triangle.
            return (
                <>
                    <path d="M8 2.4 13.7 13H2.3L8 2.4Z" />
                    <path d="M8 6.2v3.1" />
                    <path d="M8 11.5h.01" />
                </>
            )
        case 'echo':
            // Return arrow: echo sends a value back into the flow.
            return (
                <>
                    <path d="M3 5.6h6.4a3.1 3.1 0 0 1 0 6.2H6.4" />
                    <path d="M5.4 3.2 3 5.6l2.4 2.4" />
                </>
            )
        case 'tool':
            // Terminal prompt: a tool call executes something.
            return (
                <>
                    <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2" />
                    <path d="m5 6.6 2 1.8-2 1.8" />
                    <path d="M8.6 10.2h2.6" />
                </>
            )
        default:
            // Generic node shape for extension types.
            return (
                <>
                    <path d="M8 2.6 13.4 8 8 13.4 2.6 8Z" />
                    <circle cx="8" cy="8" r="1.2" />
                </>
            )
    }
}
