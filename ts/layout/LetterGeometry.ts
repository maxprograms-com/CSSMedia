/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { PathData, Point } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { InlineText, TextRun } from "../pdf/BoxTree.js";

export type Ink = readonly [number, number, number, number];

const FLATNESS: number = 0.05;

export class LetterGeometry extends PathGeometry {

    private readonly outlines: GlyphOutlines = new GlyphOutlines();

    ink(text: InlineText, start: number, end: number, central: (run: TextRun) => number): Ink | undefined {
        // CSS Inline 3 §7.5.5: the glyph outlines of an initial letter, as its ink edges along the line from its pen start and its ink
        // over and under its alphabetic baseline; a glyph without an outline gives none.
        let left: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let over: number = Number.NEGATIVE_INFINITY;
        let under: number = Number.NEGATIVE_INFINITY;
        this.glyphs(text, start, end, (run: TextRun, glyph: number, pen: number, offsetX: number, offsetY: number) => {
            const bounds: OutlineBounds | undefined = this.outlines.bounds(run.font, glyph);
            if (bounds === undefined) {
                return;
            }
            for (const [x, y] of [[bounds.xMin, bounds.yMin], [bounds.xMax, bounds.yMax]] as const) {
                const point: Point = this.lineRelative(run, pen, offsetX, offsetY, x, y, central);
                left = Math.min(left, point[0]);
                right = Math.max(right, point[0]);
                over = Math.max(over, -point[1]);
                under = Math.max(under, point[1]);
            }
        });
        return left > right ? undefined : [left, right, over, under];
    }

    edges(text: InlineText, start: number, end: number, central: (run: TextRun) => number): Array<number> {
        // §7.7: the glyph outline of the letter as straight edges, along the line from its pen start and down from its baseline toward
        // the line-under side, four numbers each.
        const result: Array<number> = [];
        this.glyphs(text, start, end, (run: TextRun, glyph: number, pen: number, offsetX: number, offsetY: number) => {
            const path: PathData | undefined = this.outlines.path(run.font, glyph);
            if (path === undefined) {
                return;
            }
            const scale: number = run.size / run.font.metrics.unitsPerEm;
            for (const [points] of this.flattened(path, FLATNESS / scale, PathGeometry.IDENTITY3)) {
                for (let index: number = 0; index < points.length; index++) {
                    const from: Point = points[index];
                    const to: Point = points[(index + 1) % points.length];
                    result.push(...this.lineRelative(run, pen, offsetX, offsetY, from[0], from[1], central),
                        ...this.lineRelative(run, pen, offsetX, offsetY, to[0], to[1], central));
                }
            }
        });
        return result;
    }

    private lineRelative(run: TextRun, pen: number, offsetX: number, offsetY: number, x: number, y: number, central: (run: TextRun) => number): Point {
        // A point of a glyph in font units, as its place along the line and its distance under the alphabetic baseline. CSS Writing
        // Modes 4 §4.2 and §5.1: an upright glyph goes down the line from the pen by offsets that hold its vertical origin, on the
        // central baseline, which lies over the alphabetic one; a sideways or horizontal glyph runs along the line from its origin.
        const scale: number = run.size / run.font.metrics.unitsPerEm;
        if (!run.upright) {
            return [pen + offsetX + x * scale, -(y * scale + offsetY)];
        }
        return [pen - offsetY - y * scale, -(central(run) + offsetX + x * scale)];
    }

    reach(edges: ReadonlyArray<number>, margin: number, top: number, bottom: number): number {
        // The right-most point of the outline grown by shape-margin, all points within that distance of it, beside the band from top to
        // bottom: inside the band an edge reaches farthest at an end of its part there; above or below it, where the margin's circle
        // reaches into the band, the sum of the edge and the circle is largest at a known point or at an end.
        let right: number = Number.NEGATIVE_INFINITY;
        for (let index: number = 0; index < edges.length; index += 4) {
            const x0: number = edges[index];
            const y0: number = edges[index + 1];
            const x1: number = edges[index + 2];
            const y1: number = edges[index + 3];
            const low: number = Math.min(y0, y1);
            const high: number = Math.max(y0, y1);
            if (high < top - margin || low > bottom + margin) {
                continue;
            }
            const at: (y: number) => number = (y: number): number => y1 === y0 ? Math.max(x0, x1) : x0 + (x1 - x0) * (y - y0) / (y1 - y0);
            const inside: number = Math.max(low, top);
            const outside: number = Math.min(high, bottom);
            if (inside <= outside) {
                right = Math.max(right, at(inside) + margin, at(outside) + margin);
            }
            if (margin <= 0) {
                continue;
            }
            if (y1 === y0) {
                const distance: number = y0 < top ? top - y0 : y0 - bottom;
                right = distance > 0 ? Math.max(right, Math.max(x0, x1) + Math.sqrt(Math.max(0, margin * margin - distance * distance))) : right;
                continue;
            }
            const slope: number = (x1 - x0) / (y1 - y0);
            for (const [edge, direction] of [[top, -1], [bottom, 1]] as const) {
                // y = edge + direction * t for t in (0, margin]: x(y) + sqrt(margin^2 - t^2), largest where its derivative is zero.
                const first: number = Math.max(0, direction < 0 ? edge - high : low - edge);
                const last: number = Math.min(margin, direction < 0 ? edge - low : high - edge);
                if (first > last) {
                    continue;
                }
                const turn: number = direction * slope > 0 ? margin * direction * slope / Math.sqrt(1 + slope * slope) : 0;
                for (const t of [first, last, Math.min(last, Math.max(first, turn))]) {
                    right = Math.max(right, at(edge + direction * t) + Math.sqrt(Math.max(0, margin * margin - t * t)));
                }
            }
        }
        return right;
    }

    private glyphs(text: InlineText, start: number, end: number, visit: (run: TextRun, glyph: number, pen: number, offsetX: number, offsetY: number) => void): void {
        // The pen starts at the letter and moves along the line by the advance of each glyph; a glyph's own offsets move it from there.
        let pen: number = 0;
        for (const run of text.runs) {
            if (run.end <= start || run.start >= end) {
                continue;
            }
            for (let glyph: number = run.glyphStart; glyph < run.glyphEnd; glyph++) {
                const cluster: number = text.clusters[glyph];
                if (cluster < start || cluster >= end) {
                    continue;
                }
                visit(run, text.glyphs[glyph], pen, text.xOffsets?.[glyph] ?? 0, text.yOffsets?.[glyph] ?? 0);
                pen += text.advances[glyph];
            }
        }
    }
}
