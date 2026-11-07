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

import type { CssValue } from "../css/values/CssValue.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { Rectangle } from "../pdf/PageCanvas.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { ColorOutput } from "./ColorOutput.js";

export type PhysicalSides = readonly [number, number, number, number];

export type CornerRadii = readonly [number, number, number, number, number, number, number, number];

const TOP: number = 0;
const RIGHT: number = 1;
const BOTTOM: number = 2;
const LEFT: number = 3;
const ROUND_CAP: number = 1;
const BUTT_CAP: number = 0;
const DASH: number = 3;
const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const KAPPA: number = 4 / 3 * (Math.SQRT2 - 1);

export class BorderPainter {

    private readonly colors: ColorOutput;

    constructor(colors: ColorOutput) {
        this.colors = colors;
    }

    paint(rectangle: Rectangle, widths: PhysicalSides, styles: ReadonlyArray<string>, colors: ReadonlyArray<CssValue | undefined>, style: ComputedStyle, pdf: PdfPage,
        radii: CornerRadii = NO_RADII): void {
        // CSS Backgrounds 3 §4.4: where two sides meet, the transition between them is on the line from the outer corner to
        // the inner corner.
        for (let side: number = 0; side < 4; side++) {
            const line: string = styles[side];
            if (widths[side] <= 0 || line === "none" || line === "hidden") {
                continue;
            }
            pdf.content.save();
            this.region(rectangle, widths, side, pdf);
            this.line(rectangle, widths, radii, side, line, colors[side], style, pdf);
            pdf.content.restore();
        }
    }

    inner(rectangle: Rectangle, insets: PhysicalSides, radii: CornerRadii): readonly [Rectangle, CornerRadii] {
        // CSS Backgrounds 3 §4.2: the inner radii are the outer ones less the border widths, never below zero.
        const inside: Rectangle = {
            x: rectangle.x + insets[LEFT], y: rectangle.y + insets[TOP], width: Math.max(0, rectangle.width - insets[LEFT] - insets[RIGHT]),
            height: Math.max(0, rectangle.height - insets[TOP] - insets[BOTTOM])
        };
        const reduced: CornerRadii = [
            Math.max(0, radii[0] - insets[LEFT]), Math.max(0, radii[1] - insets[TOP]), Math.max(0, radii[2] - insets[RIGHT]), Math.max(0, radii[3] - insets[TOP]),
            Math.max(0, radii[4] - insets[RIGHT]), Math.max(0, radii[5] - insets[BOTTOM]), Math.max(0, radii[6] - insets[LEFT]), Math.max(0, radii[7] - insets[BOTTOM])
        ];
        return [inside, reduced];
    }

    shape(rectangle: Rectangle, radii: CornerRadii, pdf: PdfPage): void {
        if (radii.every((radius: number) => radius === 0)) {
            pdf.content.rectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        } else {
            pdf.content.roundedRectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height, radii);
        }
    }

    private region(rectangle: Rectangle, widths: PhysicalSides, side: number, pdf: PdfPage): void {
        const x: number = rectangle.x;
        const y: number = rectangle.y;
        const right: number = x + rectangle.width;
        const bottom: number = y + rectangle.height;
        const top: number = y + widths[TOP];
        const end: number = right - widths[RIGHT];
        const low: number = bottom - widths[BOTTOM];
        const start: number = x + widths[LEFT];
        const corners: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
            [[x, y], [right, y], [end, top], [start, top]],
            [[right, y], [right, bottom], [end, low], [end, top]],
            [[right, bottom], [x, bottom], [start, low], [end, low]],
            [[x, bottom], [x, y], [start, top], [start, low]]
        ];
        const points: ReadonlyArray<readonly [number, number]> = corners[side];
        pdf.content.moveTo(points[0][0], points[0][1]);
        for (let index: number = 1; index < points.length; index++) {
            pdf.content.lineTo(points[index][0], points[index][1]);
        }
        pdf.content.closePath();
        pdf.content.clip(false);
    }

    private line(rectangle: Rectangle, widths: PhysicalSides, radii: CornerRadii, side: number, line: string, color: CssValue | undefined, style: ComputedStyle,
        pdf: PdfPage): void {
        const darkFirst: boolean = side === TOP || side === LEFT;
        switch (line) {
            case "double":
                this.band(rectangle, widths, radii, 0, 1 / 3, color, style, pdf);
                this.band(rectangle, widths, radii, 2 / 3, 1, color, style, pdf);
                break;
            case "dotted":
            case "dashed":
                this.stroked(rectangle, widths, radii, side, line === "dotted", color, style, pdf);
                break;
            case "groove":
            case "ridge":
                this.band(rectangle, widths, radii, 0, 1 / 2, this.colors.shaded(color, style, darkFirst !== (line === "groove")), style, pdf);
                this.band(rectangle, widths, radii, 1 / 2, 1, this.colors.shaded(color, style, darkFirst === (line === "groove")), style, pdf);
                break;
            case "inset":
            case "outset":
                this.band(rectangle, widths, radii, 0, 1, this.colors.shaded(color, style, darkFirst !== (line === "inset")), style, pdf);
                break;
            default:
                this.band(rectangle, widths, radii, 0, 1, color, style, pdf);
                break;
        }
    }

    private band(rectangle: Rectangle, widths: PhysicalSides, radii: CornerRadii, from: number, to: number, color: CssValue | undefined, style: ComputedStyle,
        pdf: PdfPage): void {
        pdf.content.save();
        if (this.colors.fill(color, style, pdf)) {
            const outer: readonly [Rectangle, CornerRadii] = this.inner(rectangle, this.scaled(widths, from), radii);
            const inner: readonly [Rectangle, CornerRadii] = this.inner(rectangle, this.scaled(widths, to), radii);
            this.shape(outer[0], outer[1], pdf);
            this.shape(inner[0], inner[1], pdf);
            pdf.content.fill(true);
        }
        pdf.content.restore();
    }

    private stroked(rectangle: Rectangle, widths: PhysicalSides, radii: CornerRadii, side: number, dotted: boolean, color: CssValue | undefined, style: ComputedStyle,
        pdf: PdfPage): void {
        const width: number = widths[side];
        pdf.content.save();
        if (this.colors.stroke(color, style, pdf)) {
            if (radii.some((radius: number) => radius > 0)) {
                // One stroke width does not follow a corner between sides of different widths, so the border's ring ends it.
                const inside: readonly [Rectangle, CornerRadii] = this.inner(rectangle, widths, radii);
                this.shape(rectangle, radii, pdf);
                this.shape(inside[0], inside[1], pdf);
                pdf.content.clip(true);
            }
            pdf.content.lineWidth(width);
            pdf.content.lineCap(dotted ? ROUND_CAP : BUTT_CAP);
            pdf.content.dash(dotted ? [0, 2 * width] : [DASH * width, DASH * width], 0);
            const middle: readonly [Rectangle, CornerRadii] = this.inner(rectangle, this.scaled(widths, 1 / 2), radii);
            this.sidePath(middle[0], middle[1], widths, side, dotted, pdf);
            pdf.content.stroke();
        }
        pdf.content.restore();
    }

    private sidePath(middle: Rectangle, radii: CornerRadii, widths: PhysicalSides, side: number, dotted: boolean, pdf: PdfPage): void {
        // This side's line only, through both corners, which the region cuts at the transition, since the others have their
        // own width and dashes. At a square corner a dash starts at the outer edge, and a dot where it stays whole.
        const right: number = middle.x + middle.width;
        const bottom: number = middle.y + middle.height;
        const corners: ReadonlyArray<readonly [number, number]> = [[middle.x, middle.y], [right, middle.y], [right, bottom], [middle.x, bottom]];
        const next: number = (side + 1) % 4;
        const previous: number = (side + 3) % 4;
        const along: readonly [number, number] = DIRECTIONS[side];
        const reach: (corner: number, direction: readonly [number, number]) => number = (corner: number, direction: readonly [number, number]): number =>
            radii[corner * 2 + (direction[0] !== 0 ? 0 : 1)];
        const start: readonly [number, number] = corners[side];
        const end: readonly [number, number] = corners[next];
        const entering: number = reach(side, DIRECTIONS[previous]);
        const leaving: number = reach(side, along);
        if (entering > 0 || leaving > 0) {
            pdf.content.moveTo(start[0] - DIRECTIONS[previous][0] * entering, start[1] - DIRECTIONS[previous][1] * entering);
            this.quarter(start, DIRECTIONS[previous], entering, along, leaving, pdf);
        } else {
            const shift: number = dotted ? Math.hypot(widths[previous], widths[side]) / 2 : -widths[previous] / 2;
            pdf.content.moveTo(start[0] + along[0] * shift, start[1] + along[1] * shift);
        }
        const arriving: number = reach(next, along);
        const exiting: number = reach(next, DIRECTIONS[next]);
        if (arriving > 0 || exiting > 0) {
            pdf.content.lineTo(end[0] - along[0] * arriving, end[1] - along[1] * arriving);
            this.quarter(end, along, arriving, DIRECTIONS[next], exiting, pdf);
        } else {
            const shift: number = dotted ? -Math.hypot(widths[next], widths[side]) / 2 : widths[next] / 2;
            pdf.content.lineTo(end[0] + along[0] * shift, end[1] + along[1] * shift);
        }
    }

    private quarter(corner: readonly [number, number], from: readonly [number, number], fromRadius: number, to: readonly [number, number], toRadius: number, pdf: PdfPage): void {
        const x: number = corner[0] + to[0] * toRadius;
        const y: number = corner[1] + to[1] * toRadius;
        pdf.content.curveTo(corner[0] - from[0] * fromRadius * (1 - KAPPA), corner[1] - from[1] * fromRadius * (1 - KAPPA),
            x - to[0] * toRadius * KAPPA, y - to[1] * toRadius * KAPPA, x, y);
    }

    private scaled(widths: PhysicalSides, fraction: number): PhysicalSides {
        return [widths[0] * fraction, widths[1] * fraction, widths[2] * fraction, widths[3] * fraction];
    }
}
