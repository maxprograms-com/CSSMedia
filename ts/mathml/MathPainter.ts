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
import type { BoxFragment, LineFragment, TextPiece } from "../layout/Fragment.js";
import { BackgroundPainter } from "../paint/BackgroundPainter.js";
import type { CornerRadii, PhysicalSides } from "../paint/BorderPainter.js";
import { BorderPainter } from "../paint/BorderPainter.js";
import type { PaletteRule } from "../paint/ColorGlyphPainter.js";
import type { ColorOutput } from "../paint/ColorOutput.js";
import { ImagePainter } from "../paint/ImagePainter.js";
import { PagePainter } from "../paint/PagePainter.js";
import { TextPainter } from "../paint/TextPainter.js";
import type { ElementBox } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Rectangle, Size } from "../pdf/PageCanvas.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { PageRectangle, PdfPage } from "../writer/PdfPage.js";
import type { MathGraphics, MathPath, MathPathCommand } from "./MathLayout.js";

const SIDE_NAMES: ReadonlyArray<string> = ["block-start", "inline-end", "block-end", "inline-start"];
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse"]);
const RADII: ReadonlyArray<string> = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
const CLIPPING: ReadonlySet<string> = new Set<string>(["hidden", "clip", "scroll", "auto"]);
const DEFAULT_MITER_LIMIT: number = 10;

export type Area = readonly [number, number, number, number];

export class MathPainter {

    static readonly EDGE: number = 1;

    private readonly sizes: BoxSizes = new BoxSizes((): number | undefined => undefined);
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly colors: ColorOutput;
    private readonly text: TextPainter;
    private readonly borders: BorderPainter;
    private readonly backgrounds: BackgroundPainter;
    private readonly images: ImagePainter;
    private links: Array<readonly [PageRectangle, string, boolean]> = [];
    private ink?: Area;

    constructor(document: PdfDocument, colors: ColorOutput, metrics: FontMetrics, viewport: Size, images: ImageFormats, palettes: ReadonlyArray<PaletteRule>) {
        this.colors = colors;
        this.text = new TextPainter(document, colors, this.sizes, metrics, viewport, palettes, images);
        this.borders = new BorderPainter(colors);
        this.backgrounds = new BackgroundPainter(colors, this.borders);
        this.images = new ImagePainter(images, this.sizes);
    }

    paint(formula: BoxFragment, graphics: WeakMap<BoxFragment, MathGraphics>, transform: Transform, pdf: PdfPage): ReadonlyArray<readonly [PageRectangle, string, boolean]> {
        // The background and borders of the math element are those of the replaced box that shows the image, so the formula
        // starts with its content; each box inside is painted whole, as an atomic inline is (CSS 2 Appendix E.2).
        this.links = [];
        const frame: number = this.sizes.frame(formula.box.style);
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(formula, frame));
        this.content(formula, inner, frame, graphics, pdf, this.decorated([], formula.box.style));
        return this.links;
    }

    extent(formula: BoxFragment, graphics: WeakMap<BoxFragment, MathGraphics>, transform: Transform): Area | undefined {
        const frame: number = this.sizes.frame(formula.box.style);
        return this.reach(formula, this.sizes.compose(transform, this.sizes.inside(formula, frame)), frame, graphics, this.decorated([], formula.box.style));
    }

    private reach(fragment: BoxFragment, inner: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, decorators: ReadonlyArray<ComputedStyle>): Area | undefined {
        delete this.ink;
        this.measureContent(fragment, inner, frame, graphics, decorators);
        return this.ink;
    }

    private measureContent(fragment: BoxFragment, inner: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, decorators: ReadonlyArray<ComputedStyle>): void {
        const drawn: MathGraphics | undefined = graphics.get(fragment);
        if (drawn !== undefined && !this.hidden(fragment.box.style)) {
            this.measureDrawn(drawn, inner);
        }
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.measureFragment(child, inner, frame, graphics, decorators);
            } else {
                this.measureLine(child, inner, frame, graphics, decorators);
            }
        }
    }

    private measureFragment(fragment: BoxFragment, transform: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, decorators: ReadonlyArray<ComputedStyle>): void {
        if (fragment.box.placement === "running") {
            return;
        }
        this.touch(this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize));
        if (!fragment.box.replaced) {
            this.measureContent(fragment, this.sizes.compose(transform, this.sizes.inside(fragment, frame)), this.sizes.frame(fragment.box.style), graphics,
                this.decorated(decorators, fragment.box.style));
        }
    }

    private measureDrawn(drawn: MathGraphics, transform: Transform): void {
        for (const rule of drawn.rules ?? []) {
            this.touch(this.sizes.mapped(transform, rule.inline, rule.block, rule.inlineSize, rule.blockSize));
        }
        for (const path of drawn.paths ?? []) {
            this.touchPath(path, transform);
        }
        if (drawn.glyphs !== undefined) {
            this.touch(this.text.glyphsInk(drawn.glyphs, transform));
        }
    }

    private measureLine(line: LineFragment, transform: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, decorators: ReadonlyArray<ComputedStyle>): void {
        const local: Transform = this.sizes.compose(transform, [1, 0, 0, 1, line.inline ?? 0, line.block]);
        for (const piece of line.pieces) {
            if (piece.kind === "text") {
                this.touch(this.text.textInk(line, piece, transform));
                if (decorators.length > 0) {
                    this.touch(this.sizes.mapped(transform, (line.inline ?? 0) + piece.inline, line.block, piece.inlineSize, line.blockSize));
                }
            } else if (!piece.box.replaced && this.displays.isInlineBox(piece.box.display)) {
                this.touch(this.sizes.mapped(local, piece.inline, piece.block, piece.inlineSize, piece.blockSize));
            } else {
                this.measureFragment(piece, local, frame, graphics, []);
            }
        }
    }

    private touch(area?: Area): void {
        if (area === undefined) {
            return;
        }
        if (this.ink === undefined) {
            this.ink = area;
            return;
        }
        const left: number = Math.min(this.ink[0], area[0]);
        const top: number = Math.min(this.ink[1], area[1]);
        this.ink = [left, top, Math.max(this.ink[0] + this.ink[2], area[0] + area[2]) - left, Math.max(this.ink[1] + this.ink[3], area[1] + area[3]) - top];
    }

    private fragment(fragment: BoxFragment, transform: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, pdf: PdfPage,
        decorators: ReadonlyArray<ComputedStyle>): void {
        const box: ElementBox = fragment.box;
        if (box.placement === "running") {
            // GCPM 3 §1.2.1: a running element shows only where element() names it.
            return;
        }
        if ((box.linkUri !== undefined || box.linkDestination !== undefined) && !this.hidden(box.style)) {
            const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
            this.links.push([{ x: area[0], y: area[1], width: area[2], height: area[3] }, box.linkDestination ?? box.linkUri as string, box.linkDestination !== undefined]);
        }
        if (box.replaced) {
            this.decorations(fragment, transform, pdf);
            this.links.push(...this.images.paint(fragment, transform, frame, pdf));
            return;
        }
        this.decorations(fragment, transform, pdf);
        const clipped: boolean = this.clip(fragment, transform, frame, graphics, decorators, pdf);
        this.content(fragment, this.sizes.compose(transform, this.sizes.inside(fragment, frame)), this.sizes.frame(fragment.box.style), graphics, pdf,
            this.decorated(decorators, fragment.box.style));
        if (clipped) {
            pdf.content.restore();
        }
    }

    private content(fragment: BoxFragment, inner: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, pdf: PdfPage,
        decorators: ReadonlyArray<ComputedStyle>): void {
        // The bars, strokes and glyphs that math layout drew for the box are in its content box, under its children.
        const drawn: MathGraphics | undefined = graphics.get(fragment);
        if (drawn !== undefined && !this.hidden(fragment.box.style)) {
            this.drawn(drawn, fragment.box.style, inner, pdf);
        }
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.fragment(child, inner, frame, graphics, pdf, decorators);
            } else {
                this.line(child, inner, frame, graphics, pdf, decorators);
            }
        }
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

    private touchPath(path: MathPath, transform: Transform): void {
        // ISO 32000-2 §8.4.3.5: a miter reaches half the line width times the miter limit, whose default of §8.4.1 applies here;
        // a curve stays inside its control points.
        const reach: number = path.filled ? 0 : path.lineWidth / 2 * DEFAULT_MITER_LIMIT;
        for (const command of path.commands) {
            for (let at: number = 1; at + 1 < command.length; at += 2) {
                const point: readonly [number, number] = this.sizes.apply(transform, command[at] as number, command[at + 1] as number);
                this.touch([point[0] - reach, point[1] - reach, 2 * reach, 2 * reach]);
            }
        }
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

    private line(line: LineFragment, transform: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, pdf: PdfPage,
        decorators: ReadonlyArray<ComputedStyle>): void {
        // CSS 2 Appendix E.2: the boxes and the runs of text of a line in tree order. CSS Text Decoration 4 §5.1: line-throughs
        // go over all of the line.
        const local: Transform = this.sizes.compose(transform, [1, 0, 0, 1, line.inline ?? 0, line.block]);
        const texts: ReadonlyArray<TextPiece> = line.pieces.filter((piece: TextPiece | BoxFragment): piece is TextPiece => piece.kind === "text");
        let runs: Array<TextPiece> = [];
        for (const piece of line.pieces) {
            if (piece.kind === "text") {
                runs.push(piece);
                continue;
            }
            this.text.runs(line, texts, runs, transform, decorators, pdf);
            runs = [];
            if (!piece.box.replaced && this.displays.isInlineBox(piece.box.display)) {
                this.decorations(piece, local, pdf);
            } else {
                this.fragment(piece, local, frame, graphics, pdf, []);
            }
        }
        this.text.runs(line, texts, runs, transform, decorators, pdf);
        this.text.decorate(line, texts, texts, transform, decorators, pdf, true);
    }

    private decorated(decorators: ReadonlyArray<ComputedStyle>, style: ComputedStyle): ReadonlyArray<ComputedStyle> {
        const line: CssValue | undefined = style.values["text-decoration-line"];
        return line === undefined || (line.kind === "ident" && line.lower === "none") ? decorators : [...decorators, style];
    }

    private decorations(fragment: BoxFragment, transform: Transform, pdf: PdfPage): void {
        // CSS Backgrounds 3: the background, then the borders, of a box that is visible.
        const style: ComputedStyle = fragment.box.style;
        PagePainter.effectsSupported(style.values);
        if (this.hidden(style)) {
            return;
        }
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const own: number = this.sizes.frame(style);
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        const styles: Array<string> = ["none", "none", "none", "none"];
        const colors: Array<CssValue | undefined> = [undefined, undefined, undefined, undefined];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(own, side);
            styles[physical] = this.keyword(style.values["border-" + SIDE_NAMES[side] + "-style"]);
            colors[physical] = style.values["border-" + SIDE_NAMES[side] + "-color"];
        }
        const radii: CornerRadii = this.radii(style, rectangle);
        this.backgrounds.paint(rectangle, borders, padding, style, pdf, undefined, radii);
        this.borders.paint(rectangle, borders, styles, colors, style, pdf, radii);
    }

    private clip(fragment: BoxFragment, transform: Transform, frame: number, graphics: WeakMap<BoxFragment, MathGraphics>, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage): boolean {
        // CSS Overflow 3 §3: the content is clipped to the padding box only in the axes that clip.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        const across: boolean = CLIPPING.has(this.keyword(values["overflow-x"]));
        const down: boolean = CLIPPING.has(this.keyword(values["overflow-y"]));
        if (!across && !down) {
            return false;
        }
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const inner: readonly [Rectangle, CornerRadii] = this.borders.inner(rectangle, this.edges(fragment)[0], this.radii(fragment.box.style, rectangle));
        const clip: Rectangle = { ...inner[0] };
        if (!across || !down) {
            // A clip is a closed path, so in the axis that does not clip it goes as far as what the box paints.
            const reach: Area = this.reach(fragment, this.sizes.compose(transform, this.sizes.inside(fragment, frame)), this.sizes.frame(fragment.box.style), graphics,
                this.decorated(decorators, fragment.box.style)) ?? area;
            if (!across) {
                clip.x = Math.floor(reach[0]) - MathPainter.EDGE;
                clip.width = Math.ceil(reach[0] + reach[2]) + MathPainter.EDGE - clip.x;
            }
            if (!down) {
                clip.y = Math.floor(reach[1]) - MathPainter.EDGE;
                clip.height = Math.ceil(reach[1] + reach[3]) + MathPainter.EDGE - clip.y;
            }
        }
        pdf.content.save();
        this.borders.shape(clip, across && down ? inner[1] : [0, 0, 0, 0, 0, 0, 0, 0], pdf);
        pdf.content.clip(false);
        return true;
    }

    private edges(fragment: BoxFragment): readonly [PhysicalSides, PhysicalSides] {
        // The sides of a fragment are those of its own writing mode, whatever the frame of its container.
        const own: number = this.sizes.frame(fragment.box.style);
        const borders: [number, number, number, number] = [0, 0, 0, 0];
        const padding: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(own, side);
            borders[physical] = fragment.border === undefined ? 0 : fragment.border[side];
            padding[physical] = fragment.padding === undefined ? 0 : fragment.padding[side];
        }
        return [borders, padding];
    }

    private radii(style: ComputedStyle, rectangle: Rectangle): CornerRadii {
        // CSS Backgrounds 3 §4.5: when the curves of a side would overlap, all radii are scaled down alike.
        const radii: Array<number> = [];
        for (const property of RADII) {
            const value: CssValue | undefined = style.values[property];
            const items: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" ? value.items : [value]);
            const first: CssValue | undefined = items[0];
            const second: CssValue | undefined = items[1] ?? first;
            radii.push(first === undefined ? 0 : Math.max(0, this.sizes.pixels(first, rectangle.width)), second === undefined ? 0 : Math.max(0, this.sizes.pixels(second, rectangle.height)));
        }
        const sums: ReadonlyArray<readonly [number, number]> = [
            [radii[0] + radii[2], rectangle.width], [radii[3] + radii[5], rectangle.height], [radii[4] + radii[6], rectangle.width], [radii[1] + radii[7], rectangle.height]
        ];
        let factor: number = 1;
        for (const [sum, length] of sums) {
            factor = sum > 0 ? Math.min(factor, length / sum) : factor;
        }
        return [radii[0] * factor, radii[1] * factor, radii[2] * factor, radii[3] * factor, radii[4] * factor, radii[5] * factor, radii[6] * factor, radii[7] * factor];
    }

    private hidden(style: ComputedStyle): boolean {
        return HIDDEN.has(this.keyword(style.values["visibility"]));
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }
}
