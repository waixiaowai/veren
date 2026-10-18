/**
 * 小型 DOM 工具：取元素、建 HTML/SVG 节点、格式化时间与截断。
 * Tiny DOM helpers: element lookup, HTML/SVG construction, time formatting and
 * truncation. No page state lives here.
 */

/** 取元素 / get an element */
export function byId<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`missing element #${id}`);
    return node as T;
}

/** 建 HTML 元素 / create an HTML element */
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/** 建 SVG 元素 / create an SVG element */
export function svgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}

/** 展示：时间 / display: clock time */
export function formatTime(value: number): string {
    const date = new Date(value);
    const clock = date.toLocaleTimeString(undefined, { hour12: false });
    return `${clock}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** 截断展示文字 / truncate display text */
export function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
