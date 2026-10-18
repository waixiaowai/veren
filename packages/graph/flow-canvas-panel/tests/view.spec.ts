/**
 * Viewport math contracts: fit, cursor-anchored zoom, pan, visibility and the
 * 100% reset. These are the parts of "pan/zoom/fit" that must stay correct
 * without a real browser.
 *
 * 视口数学契约：适应屏幕、以光标为锚点缩放、平移、可见性与重置 100%。
 * 这些是“平移/缩放/适应屏幕”中必须在无真实浏览器时也保持正确的部分。
 */

import { describe, expect, it } from 'vitest'
import {
    clampZoom,
    ensureVisible,
    fitView,
    MAX_ZOOM,
    MIN_ZOOM,
    panBy,
    resetZoom,
    zoomAt,
    zoomPercent,
} from '../src/client/view.ts'

describe('clampZoom', () => {
    it('keeps zoom inside the supported range and survives bad input', () => {
        expect(clampZoom(1)).toBe(1)
        expect(clampZoom(0.01)).toBe(MIN_ZOOM)
        expect(clampZoom(99)).toBe(MAX_ZOOM)
        expect(clampZoom(Number.NaN)).toBe(1)
    })
})

describe('fitView', () => {
    it('fits by the tighter axis and centers the content', () => {
        const view = fitView(1000, 500, 1200, 800, 50)
        expect(view.zoom).toBeCloseTo(1.05)
        expect(view.x).toBeCloseTo(75)
        expect(view.y).toBeCloseTo(137.5)
    })

    it('does not magnify a tiny graph beyond 105% and stays neutral for a zero viewport', () => {
        expect(fitView(100, 100, 400, 400).zoom).toBeCloseTo(1.05)
        expect(fitView(100, 100, 0, 0)).toEqual({ x: 0, y: 0, zoom: 1 })
    })
})

describe('zoomAt', () => {
    it('keeps the graph point under the cursor fixed', () => {
        const view = zoomAt({ x: 10, y: 20, zoom: 1 }, 100, 100, 2)
        expect(view).toEqual({ x: -80, y: -60, zoom: 2 })
        const before = { cx: (100 - 10) / 1, cy: (100 - 20) / 1 }
        expect(before.cx * view.zoom + view.x).toBeCloseTo(100)
        expect(before.cy * view.zoom + view.y).toBeCloseTo(100)
    })

    it('returns the same object when the zoom did not change', () => {
        const view = { x: 4, y: 5, zoom: 1.5 }
        expect(zoomAt(view, 10, 10, 1.5)).toBe(view)
    })
})

describe('panBy', () => {
    it('translates the view and avoids a useless object on zero delta', () => {
        const view = { x: 4, y: 5, zoom: 1 }
        expect(panBy(view, 10, -3)).toEqual({ x: 14, y: 2, zoom: 1 })
        expect(panBy(view, 0, 0)).toBe(view)
    })
})

describe('ensureVisible', () => {
    it('leaves a visible node untouched', () => {
        const view = { x: 0, y: 0, zoom: 1 }
        expect(ensureVisible(view, { x: 100, y: 100, width: 100, height: 60 }, 1000, 800, 20)).toBe(view)
    })

    it('pans just enough to reveal a node beyond the right and bottom edges', () => {
        const view = ensureVisible(
            { x: 0, y: 0, zoom: 1 },
            { x: 900, y: 700, width: 100, height: 100 },
            1000,
            800,
            20,
        )
        expect(view).toEqual({ x: -20, y: -20, zoom: 1 })
    })

    it('pans right and down for a node beyond the left and top edges', () => {
        const view = ensureVisible(
            { x: 0, y: 0, zoom: 1 },
            { x: -50, y: -50, width: 100, height: 100 },
            1000,
            800,
            20,
        )
        expect(view).toEqual({ x: 70, y: 70, zoom: 1 })
    })
})

describe('resetZoom', () => {
    it('returns to 100% around the viewport center', () => {
        const view = resetZoom({ x: 0, y: 0, zoom: 2 }, 400, 300)
        expect(view).toEqual({ x: 100, y: 75, zoom: 1 })
    })

    it('formats the zoom as a rounded percentage', () => {
        expect(zoomPercent({ x: 0, y: 0, zoom: 0.873 })).toBe(87)
    })
})
