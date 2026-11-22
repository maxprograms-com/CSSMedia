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
import type { ImageFormats } from "../images/ImageFormats.js";
import type { Transform } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment } from "../layout/Fragment.js";
import type { PaletteRule } from "../paint/ColorGlyphPainter.js";
import type { ColorOutput } from "../paint/ColorOutput.js";
import type { BoxContent } from "../paint/PagePainter.js";
import { TextPainter } from "../paint/TextPainter.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Size } from "../pdf/PageCanvas.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { MathGraphics, MathPath, MathPathCommand } from "./MathLayout.js";

const DEFAULT_MITER_LIMIT: number = 10;

export type Area = readonly [number, number, number, number];

export class MathPainter {

    static readonly EDGE: number = 1;

    private readonly sizes: BoxSizes = new BoxSizes((): number | undefined => undefined);
    private readonly colors: ColorOutput;
    private readonly text: TextPainter;

    constructor(document: PdfDocument, colors: ColorOutput, metrics: FontMetrics, viewport: Size, images: ImageFormats, palettes: ReadonlyArray<PaletteRule>) {
        this.colors = colors;
        this.text = new TextPainter(document, colors, this.sizes, metrics, viewport, palettes, images);
    }

    content(graphics: WeakMap<BoxFragment, MathGraphics>): BoxContent {
        // MathML Core §2.2.2: the boxes of a formula take the CSS features as all boxes do, so they are painted as all boxes are; the bars,
        // strokes and glyphs that math layout draws for a box are its content, in its content box.
        return {
            paint: (fragment: BoxFragment, inner: Transform, pdf: PdfPage): void => {
                const drawn: MathGraphics | undefined = graphics.get(fragment);
                if (drawn !== undefined) {
                    this.drawn(drawn, fragment.box.style, inner, pdf);
                }
            },
            ink: (fragment: BoxFragment, inner: Transform): Area | undefined => {
                const drawn: MathGraphics | undefined = graphics.get(fragment);
                return drawn === undefined ? undefined : this.ink(drawn, inner);
            },
            shapes: (fragment: BoxFragment, inner: Transform, pdf: PdfPage): void => {
                const drawn: MathGraphics | undefined = graphics.get(fragment);
                if (drawn?.glyphs !== undefined) {
                    this.text.singleShapes(drawn.glyphs, inner, pdf);
                }
            }
        };
    }

    private drawn(drawn: MathGraphics, style: ComputedStyle, transform: Transform, pdf: PdfPage): void {
        // The rules are filled and the paths stroked or filled with the color of the box, at its coordinates.
        const color: CssValue | undefined = style.values["color"];
        if ((drawn.rules !== undefined && drawn.rules.length > 0) || (drawn.paths !== undefined && drawn.paths.length > 0)) {
            pdf.content.save();
            pdf.content.transform(transform[0], transform[2], transform[1], transform[3], transform[4], transform[5]);
            for (const rule of drawn.rules ?? []) {
                if (rule.inlineSize > 0 && rule.blockSize > 0 && this.colors.fill(color, style, pdf)) {
                    pdf.content.rectangle(rule.inline, rule.block, rule.inlineSize, rule.blockSize);
                    pdf.content.fill(false);
                }
            }
            for (const path of drawn.paths ?? []) {
                this.path(path, color, style, pdf);
            }
            pdf.content.restore();
        }
        if (drawn.glyphs !== undefined) {
            this.text.paintGlyphs(drawn.glyphs, style, transform, pdf);
        }
    }

    private ink(drawn: MathGraphics, transform: Transform): Area | undefined {
        // ISO 32000-2 §8.4.3.5: a miter reaches half the line width times the miter limit, whose default of §8.4.1 applies here; a curve
        // stays inside its control points.
        let area: Area | undefined;
        for (const rule of drawn.rules ?? []) {
            area = this.union(area, this.sizes.mapped(transform, rule.inline, rule.block, rule.inlineSize, rule.blockSize));
        }
        for (const path of drawn.paths ?? []) {
            const reach: number = path.filled ? 0 : path.lineWidth / 2 * DEFAULT_MITER_LIMIT;
            for (const command of path.commands) {
                for (let at: number = 1; at + 1 < command.length; at += 2) {
                    const point: readonly [number, number] = this.sizes.apply(transform, command[at] as number, command[at + 1] as number);
                    area = this.union(area, [point[0] - reach, point[1] - reach, 2 * reach, 2 * reach]);
                }
            }
        }
        return drawn.glyphs === undefined ? area : this.union(area, this.text.glyphsInk(drawn.glyphs, transform));
    }

    private union(first: Area | undefined, second: Area | undefined): Area | undefined {
        if (first === undefined || second === undefined) {
            return first ?? second;
        }
        const left: number = Math.min(first[0], second[0]);
        const top: number = Math.min(first[1], second[1]);
        return [left, top, Math.max(first[0] + first[2], second[0] + second[2]) - left, Math.max(first[1] + first[3], second[1] + second[3]) - top];
    }

    private path(path: MathPath, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        if (!(path.filled ? this.colors.fill(color, style, pdf) : this.colors.stroke(color, style, pdf)) || (!path.filled && path.lineWidth <= 0)) {
            return;
        }
        for (const command of path.commands) {
            this.command(command, pdf);
        }
        if (path.filled) {
            pdf.content.fill(false);
        } else {
            pdf.content.lineWidth(path.lineWidth);
            pdf.content.stroke();
        }
    }

    private command(command: MathPathCommand, pdf: PdfPage): void {
        switch (command[0]) {
            case "M":
                pdf.content.moveTo(command[1], command[2]);
                break;
            case "L":
                pdf.content.lineTo(command[1], command[2]);
                break;
            case "C":
                pdf.content.curveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
                break;
            default:
                pdf.content.closePath();
                break;
        }
    }
}
