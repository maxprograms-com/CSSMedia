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
import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { FontInstance } from "../fonts/Typeface.js";
import type { PathData, StrokeStyle } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { BoxSizes, Transform } from "../layout/BoxSizes.js";
import type { LineFragment, TextPiece } from "../layout/Fragment.js";
import type { GlyphRun, Hyphen, InlineSequence, InlineText, TextRun } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Size } from "../pdf/PageCanvas.js";
import { TextSpacingTrim } from "../pdf/TextSpacingTrim.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { FontResource, FontRun, PdfFont } from "../writer/PdfFont.js";
import type { PdfFonts } from "../writer/PdfFonts.js";
import type { PdfPage } from "../writer/PdfPage.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";
import type { ColorOutput } from "./ColorOutput.js";

type Values = Readonly<Record<string, CssValue>>;

type Box = readonly [number, number, number, number];

type SingleGlyph = { font: FontInstance; size: number; glyph: number; text: string; inline: number; baseline: number; advance: number };

interface PlacedGlyph {
    x: number;
    y: number;
    glyph: number;
    text: string;
    font: FontInstance;
    size: number;
    hyphen?: boolean;
}

interface Span {
    left: number;
    right: number;
    baseline: number;
    run: TextRun;
    ideal: number;
    shown: boolean;
}

const UNITS: number = 1000;
const TOLERANCE: number = 0.001;
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse"]);
const DASH: number = 3;
const DECORATION: string = "text-decoration-";
const MATCH_TEXT: string = "match-text";
const SOFT_HYPHEN: string = "\u00AD";
const SPAN: string = "Span";
const FILL: number = 0;
const STROKE: number = 1;
const INVISIBLE: number = 3;
const CAPS: Readonly<Record<string, number>> = { "butt": 0, "round": 1, "square": 2 };
const MITER_JOIN: number = 0;
const ROUND_JOIN: number = 1;
const BEVEL_JOIN: number = 2;
const MITER_LIMIT: number = 4;
const UNSCALED: ReadonlyArray<number> = [1, 0, 0, 1, 0, 0];
const FLATNESS: number = 0.05;
const KAPPA: number = 4 / 3 * (Math.SQRT2 - 1);

export class TextPainter {

    private readonly document: PdfDocument;
    private readonly fonts: PdfFonts;
    private readonly colors: ColorOutput;
    private readonly sizes: BoxSizes;
    private readonly metrics: FontMetrics;
    private readonly viewport: Size;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private readonly geometry: PathGeometry = new PathGeometry();
    private readonly chains: WeakMap<InlineSequence, Array<ReadonlyArray<ComputedStyle> | undefined>> = new WeakMap<InlineSequence, Array<ReadonlyArray<ComputedStyle> | undefined>>();
    private readonly shiftParents: WeakMap<InlineSequence, Array<ComputedStyle | undefined>> = new WeakMap<InlineSequence, Array<ComputedStyle | undefined>>();

    constructor(document: PdfDocument, colors: ColorOutput, sizes: BoxSizes, metrics: FontMetrics, viewport: Size) {
        this.document = document;
        this.fonts = document.fonts;
        this.colors = colors;
        this.sizes = sizes;
        this.metrics = metrics;
        this.viewport = viewport;
    }

    runs(line: LineFragment, texts: ReadonlyArray<TextPiece>, runs: ReadonlyArray<TextPiece>, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage): void {
        // CSS Text Decoration 4 §5.1: the underlines and overlines of the runs between two boxes of the line, under their text.
        if (runs.length === 0) {
            return;
        }
        this.decorate(line, texts, runs, transform, decorators, pdf, false);
        for (const piece of runs) {
            this.paint(line, piece, transform, pdf);
        }
    }

    decorate(line: LineFragment, pieces: ReadonlyArray<TextPiece>, shown: ReadonlyArray<TextPiece>, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage, through: boolean): void {
        // CSS Text Decoration 4 §2.9: each decorating box has "a single thickness and position on each line", so all the text
        // of the line counts for the position, while only the runs given as shown are decorated now.
        const text: InlineText = line.sequence.text as InlineText;
        const owners: Map<ComputedStyle, Array<Span>> = new Map<ComputedStyle, Array<Span>>();
        for (const piece of pieces) {
            const index: number = this.itemAt(line.sequence, text, text.clusters[piece.from]);
            const applying: ReadonlyArray<ComputedStyle> = [...decorators, ...(this.chain(line.sequence)[index] ?? [])];
            if (applying.length === 0 || this.hidden(line.sequence.items[index].node.style)) {
                continue;
            }
            const inline: number = (line.inline ?? 0) + piece.inline;
            const block: number = line.block + piece.baseline;
            const start: readonly [number, number] = this.sizes.apply(transform, inline, block);
            const end: readonly [number, number] = this.sizes.apply(transform, inline + piece.inlineSize, block);
            const parent: ComputedStyle | undefined = this.shiftParent(line.sequence)[index];
            const span: Span = {
                left: Math.min(start[0], end[0]), right: Math.max(start[0], end[0]), baseline: start[1], run: piece.run, shown: shown.includes(piece),
                ideal: parent === undefined ? this.metrics.runUnderline(piece.run.font, piece.run.size) : this.metrics.underline(parent.values)[0]
            };
            for (const owner of applying) {
                const spans: Array<Span> | undefined = owners.get(owner);
                if (spans === undefined) {
                    owners.set(owner, [span]);
                } else {
                    spans.push(span);
                }
            }
        }
        for (const [owner, spans] of owners) {
            const kinds: ReadonlyArray<string> = this.keywords(owner.values["text-decoration-line"]);
            const thickness: number = this.thickness(owner);
            if (through && kinds.includes("line-through")) {
                // §2.5: a line-through goes through each run at the position its font gives.
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, span.baseline - this.metrics.strikeout(span.run.font, span.run.size)[0], thickness, 0, pdf);
                }
            }
            if (!through && kinds.includes("underline")) {
                const top: number = this.underlineTop(owner, spans);
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, top, thickness, 1, pdf);
                }
            }
            if (!through && kinds.includes("overline")) {
                // §2.5: over lines "with respect to the highest over EM-box edge of the considered text".
                const highest: number = Math.min(...spans.map((span: Span) => span.baseline - this.metrics.fontExtent(span.run.font, span.run.size)[0]));
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, highest - thickness, thickness, -1, pdf);
                }
            }
        }
    }

    private thickness(owner: ComputedStyle): number {
        const value: CssValue | undefined = owner.values["text-decoration-thickness"];
        if (value !== undefined && value.kind !== "ident") {
            return this.sizes.pixels(value, this.metrics.fontSize(owner.values));
        }
        return this.metrics.underline(owner.values)[1];
    }

    private underlineTop(owner: ComputedStyle, spans: ReadonlyArray<Span>): number {
        // §2.8.1: the zero position is the alphabetic baseline for auto, the position of the font for from-font and the
        // text-under edge for under; an auto offset takes the position of the font.
        const position: ReadonlyArray<string> = this.keywords(owner.values["text-underline-position"]);
        const offset: CssValue | undefined = owner.values["text-underline-offset"];
        const given: number | undefined = offset !== undefined && offset.kind !== "ident" ? this.sizes.pixels(offset, this.metrics.fontSize(owner.values)) : undefined;
        if (position.includes("under")) {
            // §2.5: under lines "with respect to the lowest under EM-box edge of the considered text".
            return Math.max(...spans.map((span: Span) => span.baseline + this.metrics.fontExtent(span.run.font, span.run.size)[1])) + (given ?? 0);
        }
        // §2.5: "the ideal offset (from the alphabetic baseline) of each run of considered text, averaging those, and then
        // using the lowest alphabetic baseline to actually position the line".
        const ideals: ReadonlyMap<TextRun, number> = new Map<TextRun, number>(spans.map((span: Span): [TextRun, number] => [span.run, span.ideal]));
        const font: number = [...ideals.values()].reduce((total: number, ideal: number) => total + ideal, 0) / ideals.size;
        const lowest: number = Math.max(...spans.map((span: Span) => span.baseline));
        return lowest + (position.includes("from-font") ? font + (given ?? 0) : given ?? font);
    }

    private shiftParent(sequence: InlineSequence): Array<ComputedStyle | undefined> {
        // §2.5: "an inline with a non-initial computed vertical-align is treated as having the ideal underline position of its
        // parent", so a text item inside one counts with the style of the parent of the outermost.
        let parents: Array<ComputedStyle | undefined> | undefined = this.shiftParents.get(sequence);
        if (parents !== undefined) {
            return parents;
        }
        parents = [];
        const open: Array<ComputedStyle> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "open") {
                open.push(item.node.style);
            } else if (item.kind === "close") {
                open.pop();
            } else if (item.kind === "text") {
                const shifted: number = open.findIndex((style: ComputedStyle) => this.aligned(style));
                parents[index] = shifted < 0 ? undefined : (open[shifted - 1] ?? sequence.style);
            }
        }
        this.shiftParents.set(sequence, parents);
        return parents;
    }

    private aligned(style: ComputedStyle): boolean {
        const shift: CssValue | undefined = style.values["baseline-shift"];
        const unshifted: boolean = shift === undefined || (shift.kind === "length" && shift.px === 0) || (shift.kind === "number" && shift.value === 0);
        const alignment: string = this.keywords(style.values["alignment-baseline"])[0] ?? "baseline";
        const source: string = this.keywords(style.values["baseline-source"])[0] ?? "auto";
        return !unshifted || alignment !== "baseline" || source !== "auto";
    }

    private line(owner: ComputedStyle, left: number, right: number, top: number, thickness: number, outward: number, pdf: PdfPage): void {
        // CSS Fill and Stroke 3 §5: a line decoration is filled and stroked by the text-decoration-* fill and stroke properties,
        // whose match-text takes the text's value; the wavy line is a band along a curve, filled by stroking the curve.
        const kind: string = this.keywords(owner.values["text-decoration-style"])[0] ?? "solid";
        if (!this.isNone(this.paintValue(owner, DECORATION, "fill-image"))) {
            throw new Error("The painting of " + DECORATION + "fill-image is not implemented");
        }
        const color: CssValue | undefined = this.paintValue(owner, DECORATION, "fill-color");
        const opacity: number = this.opacity(this.paintValue(owner, DECORATION, "fill-opacity"));
        const path: PathData = { verbs: [], points: [] };
        const bounds: Box = this.decorationPath(kind, left, right, top, thickness, outward, path);
        pdf.content.save();
        if (kind === "wavy") {
            if (this.colors.stroke(color, owner, pdf, opacity)) {
                pdf.content.lineWidth(thickness);
                this.geometry.trace(path, pdf.content);
                pdf.content.stroke();
            }
        } else if (this.colors.fill(color, owner, pdf, opacity)) {
            this.geometry.trace(path, pdf.content);
            pdf.content.fill(this.keywords(this.paintValue(owner, DECORATION, "fill-rule"))[0] === "evenodd");
        }
        pdf.content.restore();
        // A wavy line is a band filled by stroking its curve, so its own stroke goes along the edge of that band.
        let shape: PathData | undefined;
        this.strokeLayers(owner, DECORATION, pdf, (layer: number, width: number, paint: CssValue, alpha: number): void => {
            // §4.2.2: an inset or outset stroke lies inside or outside the outline, so it is drawn twice as wide and clipped
            // to the shape or to what is around it.
            const align: string = this.keywords(this.paintValue(owner, DECORATION, "stroke-align"))[0] ?? "center";
            const stroke: StrokeStyle = this.strokeOf(owner, DECORATION, layer, align === "center" ? width : 2 * width, align !== "inset");
            const drawable: boolean = this.drawable(stroke);
            if (drawable ? !this.colors.stroke(paint, owner, pdf, alpha) : !this.colors.fill(paint, owner, pdf, alpha)) {
                return;
            }
            shape = shape ?? (kind === "wavy" ? this.geometry.outline(path, thickness, FLATNESS) : path);
            if (align !== "center") {
                if (align === "outset") {
                    const reach: number = this.reach(stroke);
                    pdf.content.rectangle(bounds[0] - reach, bounds[1] - reach, bounds[2] + 2 * reach, bounds[3] + 2 * reach);
                }
                this.geometry.trace(shape, pdf.content);
                pdf.content.clip(align === "outset");
            }
            if (drawable) {
                this.pdfStroke(stroke, pdf);
                this.geometry.trace(shape, pdf.content);
                pdf.content.stroke();
            } else {
                this.geometry.trace(this.geometry.strokeOutline(shape, stroke, FLATNESS, PathGeometry.IDENTITY3), pdf.content);
                pdf.content.fill(false);
            }
        });
    }

    private decorationPath(kind: string, left: number, right: number, top: number, thickness: number, outward: number, path: PathData): Box {
        // CSS Text Decoration 4 §2.2 leaves the dots, dashes and the gap of a double line to the user agent; the shapes are
        // filled and stroked, so each dot and dash is a closed subpath. The bounds are left, top, width and height.
        const middle: number = top + thickness / 2;
        const width: number = right - left;
        const rectangle: (x: number, y: number, w: number, h: number) => void = (x: number, y: number, w: number, h: number): void => {
            path.verbs.push(PathGeometry.MOVE, PathGeometry.LINE, PathGeometry.LINE, PathGeometry.LINE, PathGeometry.CLOSE);
            path.points.push(x, y, x + w, y, x + w, y + h, x, y + h);
        };
        if (kind === "wavy") {
            // A cubic Bézier curve with both control points at 4/3 of the amplitude peaks at the amplitude.
            const half: number = 2 * thickness;
            const height: number = thickness * 4 / 3;
            path.verbs.push(PathGeometry.MOVE);
            path.points.push(left, middle);
            for (let x: number = left, up: boolean = true; x < right; x += half, up = !up) {
                const peak: number = up ? middle - height : middle + height;
                path.verbs.push(PathGeometry.CURVE);
                path.points.push(x + half / 3, peak, x + 2 * half / 3, peak, x + half, middle);
            }
            return [left, top - thickness, width + 2 * thickness, 3 * thickness];
        }
        if (kind === "dotted") {
            // Each dot is four quarter circles, each a cubic Bézier curve with its control points at 4/3 (√2 - 1) of the radius.
            const radius: number = thickness / 2;
            const handle: number = KAPPA * radius;
            for (let x: number = left; x <= right + TOLERANCE; x += 2 * thickness) {
                path.verbs.push(PathGeometry.MOVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CLOSE);
                path.points.push(x + radius, middle, x + radius, middle + handle, x + handle, middle + radius, x, middle + radius,
                    x - handle, middle + radius, x - radius, middle + handle, x - radius, middle, x - radius, middle - handle, x - handle, middle - radius, x, middle - radius,
                    x + handle, middle - radius, x + radius, middle - handle, x + radius, middle);
            }
            return [left - radius, top, width + thickness, thickness];
        }
        if (kind === "dashed") {
            for (let x: number = left; x < right; x += 2 * DASH * thickness) {
                rectangle(x, top, Math.min(DASH * thickness, right - x), thickness);
            }
            return [left, top, width, thickness];
        }
        rectangle(left, top, width, thickness);
        if (kind !== "double") {
            return [left, top, width, thickness];
        }
        const second: number = outward === 0 ? top - 2 * thickness : top + 2 * outward * thickness;
        rectangle(left, second, width, thickness);
        return [left, Math.min(top, second), width, Math.abs(second - top) + thickness];
    }

    private paintValue(style: ComputedStyle, prefix: string, name: string): CssValue | undefined {
        // §5: match-text "takes the value from the element's corresponding fill-*/stroke-* property".
        const own: CssValue | undefined = style.values[prefix + name];
        return prefix === "" || (own !== undefined && !(own.kind === "ident" && own.lower === MATCH_TEXT)) ? own : style.values[name];
    }

    private chain(sequence: InlineSequence): Array<ReadonlyArray<ComputedStyle> | undefined> {
        let chain: Array<ReadonlyArray<ComputedStyle> | undefined> | undefined = this.chains.get(sequence);
        if (chain !== undefined) {
            return chain;
        }
        chain = [];
        const open: Array<ComputedStyle | undefined> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "open") {
                const style: ComputedStyle = item.node.style;
                open.push(this.keywords(style.values["text-decoration-line"]).some((keyword: string) => keyword !== "none") ? style : undefined);
            } else if (item.kind === "close") {
                open.pop();
            } else if (item.kind === "text") {
                const decorating: Array<ComputedStyle> = open.filter((style: ComputedStyle | undefined): style is ComputedStyle => style !== undefined);
                chain[index] = decorating.length > 0 ? decorating : undefined;
            }
        }
        this.chains.set(sequence, chain);
        return chain;
    }

    private keywords(value?: CssValue): Array<string> {
        if (value === undefined) {
            return [];
        }
        return (value.kind === "list" ? value.items : [value]).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }

    private hidden(style: ComputedStyle): boolean {
        const visibility: CssValue | undefined = style.values["visibility"];
        return visibility !== undefined && visibility.kind === "ident" && HIDDEN.has(visibility.lower);
    }

    paint(line: LineFragment, piece: TextPiece, transform: Transform, pdf: PdfPage): void {
        const text: InlineText = line.sequence.text as InlineText;
        const style: ComputedStyle = line.sequence.items[this.itemAt(line.sequence, text, text.clusters[piece.from])].node.style;
        const values: Readonly<Record<string, CssValue>> = style.values;
        if (this.hidden(style)) {
            return;
        }
        this.supported(values, transform);
        const glyphs: Array<PlacedGlyph> = this.pieceGlyphs(line, piece, transform);
        if (glyphs.length === 0) {
            return;
        }
        this.strokeText(glyphs, style, this.fillText(glyphs, style, pdf), pdf);
    }

    private pieceGlyphs(line: LineFragment, piece: TextPiece, transform: Transform): Array<PlacedGlyph> {
        const text: InlineText = line.sequence.text as InlineText;
        const inline: number = (line.inline ?? 0) + piece.inline;
        const block: number = line.block + piece.baseline;
        const start: readonly [number, number] = this.sizes.apply(transform, inline, block);
        const end: readonly [number, number] = this.sizes.apply(transform, inline + piece.inlineSize, block);
        const left: number = Math.min(start[0], end[0]);
        return piece.leader === true ? this.leader(text, piece.run, piece, left, start[1]) : this.placed(text, piece.run, piece, left, start[1]);
    }

    textInk(line: LineFragment, piece: TextPiece, transform: Transform): Box | undefined {
        // The widest stroke counts at twice its width, which is what an outside stroke-align draws.
        const text: InlineText = line.sequence.text as InlineText;
        const style: ComputedStyle = line.sequence.items[this.itemAt(line.sequence, text, text.clusters[piece.from])].node.style;
        let reach: number = 0;
        for (const value of this.items(this.paintValue(style, "", "stroke-width"))) {
            const width: number = this.sizes.pixels(value, this.scaledViewport());
            reach = width > 0 ? Math.max(reach, this.reach(this.strokeOf(style, "", 0, 2 * width, true))) : reach;
        }
        return this.ink(this.pieceGlyphs(line, piece, transform), reach);
    }

    glyphsInk(glyphs: ReadonlyArray<SingleGlyph>, transform: Transform): Box | undefined {
        return this.ink(this.singleGlyphs(glyphs, transform), 0);
    }

    private singleGlyphs(glyphs: ReadonlyArray<SingleGlyph>, transform: Transform): Array<PlacedGlyph> {
        return glyphs.map((glyph: SingleGlyph): PlacedGlyph => {
            const start: readonly [number, number] = this.sizes.apply(transform, glyph.inline, glyph.baseline);
            const end: readonly [number, number] = this.sizes.apply(transform, glyph.inline + glyph.advance, glyph.baseline);
            return { x: Math.min(start[0], end[0]), y: start[1], glyph: glyph.glyph, text: glyph.text, font: glyph.font, size: glyph.size };
        });
    }

    paintGlyphs(glyphs: ReadonlyArray<SingleGlyph>, style: ComputedStyle, transform: Transform, pdf: PdfPage): void {
        // Glyphs placed one by one, such as the parts of a stretched symbol, are painted with the color of the style when it
        // is visible; a glyph that is not painted is still written, invisible, for its text.
        if (this.hidden(style) || glyphs.length === 0) {
            return;
        }
        this.supported(style.values, transform);
        const placed: Array<PlacedGlyph> = this.singleGlyphs(glyphs, transform);
        pdf.content.save();
        this.show(placed, pdf, this.colors.fill(style.values["color"], style, pdf) ? FILL : INVISIBLE, false);
        pdf.content.restore();
    }

    private supported(values: Values, transform: Transform): void {
        if (transform[1] !== 0 || transform[2] !== 0) {
            throw new Error("The painting of text in vertical writing modes is not implemented");
        }
        for (const property of ["text-shadow", "text-emphasis-style", "fill-image"]) {
            if (!this.isNone(values[property])) {
                throw new Error("The painting of " + property + " is not implemented");
            }
        }
    }

    private fillText(glyphs: ReadonlyArray<PlacedGlyph>, style: ComputedStyle, pdf: PdfPage): boolean {
        // CSS Fill and Stroke 3 §3.3.1: the fill color is drawn when the final layer of fill-image is none, and §3.4.1:
        // fill-opacity is "the opacity of the painting operation used to fill".
        const values: Values = style.values;
        pdf.content.save();
        const filled: boolean = this.colors.fill(values["fill-color"], style, pdf, this.opacity(values["fill-opacity"]));
        if (filled) {
            this.show(glyphs, pdf, FILL, false);
        }
        pdf.content.restore();
        return filled;
    }

    private strokeText(glyphs: ReadonlyArray<PlacedGlyph>, style: ComputedStyle, filled: boolean, pdf: PdfPage): void {
        // Text that no fill and no stroke shows as text is still written, invisible (ISO 32000-2 §9.3.6, mode 3), so that it
        // can be found and copied.
        let shown: boolean = filled;
        this.strokeLayers(style, "", pdf, (layer: number, width: number, color: CssValue, opacity: number): void => {
            if (this.outline(glyphs, style, layer, width, color, opacity, shown, pdf)) {
                shown = true;
            }
        });
        if (!shown) {
            // The text rendering mode is part of the graphics state, which outlives the text object.
            pdf.content.save();
            this.show(glyphs, pdf, INVISIBLE, false);
            pdf.content.restore();
        }
    }

    private strokeLayers(style: ComputedStyle, prefix: string, pdf: PdfPage, draw: (layer: number, width: number, color: CssValue, opacity: number) => void): void {
        // §4: strokes are drawn over the fill; §4.1: there are as many layers as values in the longer of stroke-image and
        // stroke-color, the two lists matched from their ends, and the last layer is drawn first.
        const colors: ReadonlyArray<CssValue> = this.items(this.paintValue(style, prefix, "stroke-color"));
        const images: ReadonlyArray<CssValue> = this.items(this.paintValue(style, prefix, "stroke-image"));
        const widths: ReadonlyArray<CssValue> = this.items(this.paintValue(style, prefix, "stroke-width"));
        const count: number = Math.max(colors.length, images.length);
        const opacity: number = this.opacity(this.paintValue(style, prefix, "stroke-opacity"));
        for (let layer: number = count - 1; layer >= 0; layer--) {
            // CSS Backgrounds 3 §3.1: a list with too few values repeats; §4.2.1: "A zero value causes no stroke to be painted".
            const width: number = widths.length === 0 ? 0 : this.sizes.pixels(widths[layer % widths.length], this.scaledViewport());
            const color: CssValue | undefined = colors[layer - count + colors.length];
            if (width <= 0) {
                continue;
            }
            if (!this.isNone(images[layer - count + images.length])) {
                throw new Error("The painting of " + prefix + "stroke-image is not implemented");
            }
            if (color !== undefined) {
                pdf.content.save();
                draw(layer, width, color, opacity);
                pdf.content.restore();
            }
        }
    }

    private outline(glyphs: ReadonlyArray<PlacedGlyph>, style: ComputedStyle, layer: number, width: number, color: CssValue, opacity: number, shown: boolean, pdf: PdfPage): boolean {
        // §4.2.2: an inset or outset stroke lies inside or outside the outline, so it is drawn twice as wide and kept to the
        // glyphs or to what is around them. What PDF's stroke draws is drawn by it; the rest is the stroke shape, filled.
        const align: string = this.keywords(style.values["stroke-align"])[0] ?? "center";
        const stroke: StrokeStyle = this.strokeOf(style, "", layer, align === "center" ? width : 2 * width, align !== "inset");
        if (align !== "inset" && this.drawable(stroke)) {
            const alpha: number = (this.colors.color(color, style)?.[2] ?? 0) * opacity;
            const area: Box | undefined = alpha > 0 && alpha < 1 && glyphs.length > 1 ? this.ink(glyphs, this.reach(stroke)) : undefined;
            if (area !== undefined) {
                // §4.6.2: the stroke shape of the text is one area, and PDF strokes glyph by glyph; ISO 32000-2 §11.6.4.3 NOTE 2:
                // an alpha constant on overlapping objects compounds "in the area of overlap", so a group takes the alpha once.
                const form: PdfPage = this.document.startForm(area[2], area[3], false);
                this.colors.solid(color, style, form, true);
                this.pdfStroke(stroke, form);
                if (align === "outset") {
                    this.exclude(glyphs, this.reach(stroke), form);
                }
                this.show(glyphs, form, STROKE, shown);
                pdf.content.graphicsState(pdf.useState(alpha, 1, "Normal"));
                pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, UNSCALED)));
                return true;
            }
            if (!this.colors.stroke(color, style, pdf, opacity)) {
                return false;
            }
            this.pdfStroke(stroke, pdf);
            if (align === "outset") {
                this.exclude(glyphs, this.reach(stroke), pdf);
            }
            this.show(glyphs, pdf, STROKE, shown);
            return true;
        }
        const path: PathData = this.glyphPaths(glyphs, align === "inset" ? "stroke-align: inset" : this.feature(stroke));
        if (!this.colors.fill(color, style, pdf, opacity)) {
            return false;
        }
        if (align === "inset") {
            this.geometry.trace(path, pdf.content);
            pdf.content.clip(false);
        } else if (align === "outset") {
            this.exclude(glyphs, this.reach(stroke), pdf);
        }
        this.geometry.trace(this.geometry.strokeOutline(path, stroke, FLATNESS, PathGeometry.IDENTITY3), pdf.content);
        pdf.content.fill(false);
        return false;
    }

    private glyphPaths(glyphs: ReadonlyArray<PlacedGlyph>, feature: string): PathData {
        // The outlines of the glyphs where they are drawn, from font units to the font size and with y going down.
        const path: PathData = { verbs: [], points: [] };
        for (const placed of glyphs) {
            const outline: PathData | undefined = this.outlines.path(placed.font, placed.glyph);
            if (outline === undefined) {
                throw new Error("The painting of " + feature + " with the font " + placed.font.typeface.names.postScriptName + " is not implemented");
            }
            const scale: number = placed.size / placed.font.metrics.unitsPerEm;
            path.verbs.push(...outline.verbs);
            for (let index: number = 0; index < outline.points.length; index += 2) {
                path.points.push(placed.x + outline.points[index] * scale, placed.y - outline.points[index + 1] * scale);
            }
        }
        return path;
    }

    private feature(stroke: StrokeStyle): string {
        if (stroke.corner !== undefined) {
            return "stroke-dash-corner";
        }
        return stroke.justify !== undefined ? "stroke-dash-justify" : "stroke-linejoin: " + stroke.extension + " " + stroke.shape;
    }

    private strokeOf(style: ComputedStyle, prefix: string, layer: number, width: number, joins: boolean): StrokeStyle {
        // §4.2.4: an omitted extension is crop and an omitted limit shape fallback. §4.3.3: corner dashes and justification
        // change a dash pattern, so they count only with one.
        const keywords: ReadonlyArray<string> = this.keywords(this.paintValue(style, prefix, "stroke-linejoin"));
        const limit: CssValue | undefined = this.paintValue(style, prefix, "stroke-miterlimit");
        const stroke: StrokeStyle = {
            width, cap: this.keywords(this.paintValue(style, prefix, "stroke-linecap"))[0] ?? "butt",
            extension: keywords.find((keyword: string) => keyword === "crop" || keyword === "arcs" || keyword === "miter") ?? "crop",
            shape: keywords.find((keyword: string) => keyword === "bevel" || keyword === "round" || keyword === "fallback") ?? "fallback",
            limit: limit !== undefined && limit.kind === "number" ? limit.value : MITER_LIMIT, joins
        };
        const dashes: readonly [ReadonlyArray<number>, number] | undefined = this.dashes(style, prefix, layer);
        if (dashes === undefined) {
            return stroke;
        }
        stroke.dashes = dashes;
        const corner: CssValue | undefined = this.paintValue(style, prefix, "stroke-dash-corner");
        if (!this.isNone(corner)) {
            stroke.corner = this.sizes.pixels(corner as CssValue, 0);
        }
        const justify: ReadonlyArray<string> = this.keywords(this.paintValue(style, prefix, "stroke-dash-justify"));
        if (justify.length > 0 && !justify.includes("none")) {
            stroke.justify = {
                mode: justify.includes("stretch") ? "stretch" : (justify.includes("compress") ? "compress" : ""), dashes: justify.includes("dashes"),
                gaps: justify.includes("gaps")
            };
        }
        return stroke;
    }

    private drawable(stroke: StrokeStyle): boolean {
        // §4.2.4: crop forces the miter limit to 1, which leaves the bevel or the round corner, and miter fallback becomes a
        // bevel past the limit, as the PDF miter join does; the other joins and the dash corners are not PDF's.
        return (stroke.extension === "crop" || (stroke.extension === "miter" && stroke.shape === "fallback")) && stroke.corner === undefined && stroke.justify === undefined;
    }

    private pdfStroke(stroke: StrokeStyle, pdf: PdfPage): void {
        const crop: boolean = stroke.extension === "crop";
        pdf.content.lineWidth(stroke.width);
        pdf.content.lineCap(CAPS[stroke.cap] ?? 0);
        pdf.content.lineJoin(crop ? (stroke.shape === "round" ? ROUND_JOIN : BEVEL_JOIN) : MITER_JOIN);
        pdf.content.miterLimit(crop ? 1 : stroke.limit);
        if (stroke.dashes !== undefined) {
            pdf.content.dash(stroke.dashes[0], stroke.dashes[1]);
        }
    }

    private reach(stroke: StrokeStyle): number {
        // ISO 32000-2 §8.4.3.5: a miter reaches half the line width times the miter limit from the outline, a square cap half
        // the width times the square root of two; the round end of a cut join adds at most half the width to the limit.
        const half: number = stroke.width / 2;
        const join: number = stroke.extension === "crop" ? 1 : stroke.limit + (stroke.shape === "round" ? 1 : 0);
        return half * Math.max(join, stroke.cap === "square" ? Math.SQRT2 : 1);
    }

    private dashes(style: ComputedStyle, prefix: string, layer: number): readonly [ReadonlyArray<number>, number] | undefined {
        // §4.1: each stroke layer has its own list, repeated as those of background layers are. §4.6.3: an odd list is repeated,
        // a list that adds up to zero is none, and a negative offset counts back from the end of the pattern.
        const value: CssValue | undefined = this.paintValue(style, prefix, "stroke-dasharray");
        if (this.isNone(value)) {
            return undefined;
        }
        const groups: ReadonlyArray<CssValue> = this.items(value);
        const group: CssValue = groups[layer % groups.length];
        if (this.isNone(group)) {
            return undefined;
        }
        const basis: number = this.scaledViewport();
        const lengths: ReadonlyArray<number> = (group.kind === "list" ? group.items : [group]).map((item: CssValue) => this.sizes.pixels(item, basis));
        // ISO 32000-2 §8.4.3.6 restarts the pattern at each subpath, as §4.3.1 asks.
        const pattern: ReadonlyArray<number> = lengths.length % 2 === 1 ? [...lengths, ...lengths] : lengths;
        const sum: number = pattern.reduce((total: number, length: number) => total + length, 0);
        if (sum <= 0) {
            return undefined;
        }
        const offset: CssValue | undefined = this.paintValue(style, prefix, "stroke-dashoffset");
        const phase: number = offset === undefined ? 0 : this.sizes.pixels(offset, basis) % sum;
        return [pattern, phase < 0 ? phase + sum : phase];
    }

    private exclude(glyphs: ReadonlyArray<PlacedGlyph>, reach: number, pdf: PdfPage): void {
        // A soft mask that is white around the glyphs and black on them; ISO 32000-2 §11.6.5.2: outside the bounding box of
        // the group the mask takes the black of its backdrop, so the box holds all the stroke can reach.
        const area: Box | undefined = this.ink(glyphs, reach);
        if (area === undefined) {
            return;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        form.content.fillSpace(form.useColorSpace(PdfColorSpaces.GRAY));
        form.content.fillColor([1]);
        form.content.rectangle(area[0], area[1], area[2], area[3]);
        form.content.fill(false);
        form.content.fillColor([0]);
        this.show(glyphs, form, FILL, true);
        pdf.content.graphicsState(pdf.useMask(this.document.finishForm(form, area, UNSCALED).object, true));
    }

    private ink(glyphs: ReadonlyArray<PlacedGlyph>, reach: number): Box | undefined {
        // The bounding box of each glyph's outline, from font units to the font size and with y going down.
        let left: number = Number.POSITIVE_INFINITY;
        let top: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let bottom: number = Number.NEGATIVE_INFINITY;
        for (const placed of glyphs) {
            const bounds: OutlineBounds | undefined = this.outlines.bounds(placed.font, placed.glyph);
            if (bounds !== undefined) {
                const scale: number = placed.size / placed.font.metrics.unitsPerEm;
                left = Math.min(left, placed.x + bounds.xMin * scale);
                right = Math.max(right, placed.x + bounds.xMax * scale);
                top = Math.min(top, placed.y - bounds.yMax * scale);
                bottom = Math.max(bottom, placed.y - bounds.yMin * scale);
            }
        }
        return left > right ? undefined : [left - reach, top - reach, right - left + 2 * reach, bottom - top + 2 * reach];
    }

    private scaledViewport(): number {
        // §4.2.1: percentages are relative to "the geometric mean of the viewport width and height".
        return Math.sqrt(this.viewport.width * this.viewport.height);
    }

    private opacity(value?: CssValue): number {
        // §3.4.1 and §4.5.1: "the specified value converted to a <number>, clamped to the range [0,1]".
        const amount: number = value === undefined ? 1 : (value.kind === "number" ? value.value : (value.kind === "percentage" ? value.value / 100 : 1));
        return Math.min(1, Math.max(0, amount));
    }

    private items(value?: CssValue): ReadonlyArray<CssValue> {
        if (value === undefined) {
            return [];
        }
        return value.kind === "list" && value.separator === "comma" ? value.items : [value];
    }

    private isNone(value?: CssValue): boolean {
        return value === undefined || this.items(value).every((item: CssValue) => item.kind === "ident" && item.lower === "none");
    }

    private placed(text: InlineText, run: TextRun, piece: TextPiece, left: number, baseline: number): Array<PlacedGlyph> {
        // The glyphs of a run are in the order of the text, so a right-to-left run is drawn from its last character, with
        // the spacing after each character on its left.
        const from: number = text.clusters[piece.from];
        const to: number = piece.to < run.glyphEnd ? text.clusters[piece.to] : run.end;
        const firsts: Array<number> = [];
        let glyph: number = piece.from;
        for (let position: number = from; position < to; position++) {
            firsts.push(glyph);
            while (glyph < piece.to && text.clusters[glyph] === position) {
                glyph++;
            }
        }
        firsts.push(piece.to);
        const reversed: boolean = (run.level & 1) === 1;
        const placed: Array<PlacedGlyph> = [];
        let pen: number = left;
        if (reversed && piece.hyphenated === true && run.hyphen !== undefined) {
            this.hyphen(run.hyphen, true, left - run.hyphen.advance, baseline, placed);
        }
        for (let step: number = 0; step < to - from; step++) {
            const position: number = reversed ? to - 1 - step : from + step;
            const index: number = position - from;
            const before: number = text.spacingBefore[position];
            const after: number = text.spacingAfter[position];
            let natural: number = before + after;
            for (let current: number = firsts[index]; current < firsts[index + 1]; current++) {
                natural += text.advances[current];
            }
            const used: number = piece.advances === undefined ? natural : piece.advances[index];
            // CSS Text 4 §8.5: a fullwidth mark set half-width loses the half that has no ink, the start side of an
            // opening mark and the end side of a closing one.
            const type: number = text.punctuation[position];
            const trimmed: boolean = (type === TextSpacingTrim.OPENING && !reversed) || (type === TextSpacingTrim.CLOSING && reversed);
            let x: number = pen + (reversed ? after : before) - (trimmed ? natural - used : 0);
            const content: string = this.clusterText(text, position, firsts, index, to - from);
            const count: number = firsts[index + 1] - firsts[index];
            for (let order: number = 0; order < count; order++) {
                const current: number = reversed ? firsts[index + 1] - 1 - order : firsts[index] + order;
                placed.push({
                    x: x + (text.xOffsets?.[current] ?? 0), y: baseline - (text.yOffsets?.[current] ?? 0), glyph: text.glyphs[current],
                    text: current === firsts[index] ? content : "", font: run.font, size: run.size
                });
                x += text.advances[current];
            }
            pen += used;
        }
        if (!reversed && piece.hyphenated === true && run.hyphen !== undefined) {
            this.hyphen(run.hyphen, false, pen, baseline, placed);
        }
        return placed;
    }

    private leader(text: InlineText, run: TextRun, piece: TextPiece, left: number, baseline: number): Array<PlacedGlyph> {
        // CSS Content 3 §2.5.3: the leader string is drawn "starting from the end edge, repeating as many times as possible
        // until reaching the start edge", and a copy that does not fit whole is not shown.
        const copy: Array<PlacedGlyph> = this.placed(text, run, piece, 0, baseline);
        const from: number = text.clusters[piece.from];
        const to: number = piece.to < run.glyphEnd ? text.clusters[piece.to] : run.end;
        let width: number = 0;
        for (let position: number = from; position < to; position++) {
            width += piece.advances === undefined ? text.spacingBefore[position] + text.spacingAfter[position] : piece.advances[position - from];
        }
        for (let glyph: number = piece.from; piece.advances === undefined && glyph < piece.to; glyph++) {
            width += text.advances[glyph];
        }
        const glyphs: Array<PlacedGlyph> = [];
        const count: number = width > 0 ? Math.floor(piece.inlineSize / width + TOLERANCE) : 0;
        const reversed: boolean = (run.level & 1) === 1;
        for (let copyIndex: number = 0; copyIndex < count; copyIndex++) {
            const start: number = reversed ? left + copyIndex * width : left + piece.inlineSize - (count - copyIndex) * width;
            for (const placed of copy) {
                glyphs.push({ ...placed, x: placed.x + start });
            }
        }
        return glyphs;
    }

    private clusterText(text: InlineText, position: number, firsts: ReadonlyArray<number>, index: number, count: number): string {
        let end: number = index + 1;
        while (end < count && firsts[end + 1] === firsts[end]) {
            end++;
        }
        return String.fromCodePoint(...text.codepoints.slice(position, position + end - index));
    }

    private hyphen(hyphen: Hyphen, reversed: boolean, left: number, baseline: number, placed: Array<PlacedGlyph>): void {
        // ISO 32000-2 §14.8.2.3: the hyphen of a divided word "may be represented as a soft hyphen", and the writer "shall
        // distinguish explicitly between soft and hard hyphens"; its glyphs also draw hard hyphens, so ActualText says it.
        let pen: number = left;
        const parts: ReadonlyArray<GlyphRun> = hyphen.parts;
        for (let step: number = 0; step < parts.length; step++) {
            const part: GlyphRun = parts[reversed ? parts.length - 1 - step : step];
            for (let order: number = 0; order < part.glyphs.length; order++) {
                const index: number = reversed ? part.glyphs.length - 1 - order : order;
                placed.push({
                    x: pen + part.xOffsets[index], y: baseline - part.yOffsets[index], glyph: part.glyphs[index], text: "", font: part.font, size: part.size, hyphen: true
                });
                pen += part.advances[index];
            }
        }
    }

    private show(glyphs: ReadonlyArray<PlacedGlyph>, pdf: PdfPage, mode: number, replica: boolean): void {
        // ISO 32000-2 §9.4.3: in TJ a number moves the next glyph back by thousandths of the font size, which takes each
        // glyph from where the width of the one before leaves it to where the layout put it.
        let parts: Array<string | number> = [];
        let resource: FontResource | undefined;
        let size: number = 0;
        let pen: number = Number.NaN;
        let line: number = Number.NaN;
        let marked: boolean = false;
        const flush: () => void = (): void => {
            if (parts.length > 0) {
                pdf.content.showAdjusted(parts);
                parts = [];
            }
        };
        if (replica) {
            // §14.9.4: ActualText "shall be used as a replacement", so the copies of the glyphs that stroke or clip them give
            // no text of their own.
            pdf.content.beginMarked(SPAN, "<< /ActualText " + this.syntax.textString("") + " >>");
        }
        pdf.content.beginText();
        if (mode !== FILL) {
            pdf.content.textRenderingMode(mode);
        }
        for (const placed of glyphs) {
            if ((placed.hyphen === true) !== marked) {
                flush();
                if (marked) {
                    pdf.content.endMarked();
                } else {
                    pdf.content.beginMarked(SPAN, "<< /ActualText " + this.syntax.textString(SOFT_HYPHEN) + " >>");
                }
                marked = !marked;
            }
            const font: PdfFont = this.fonts.font(placed.font, false);
            font.use(placed.glyph, placed.text);
            const shown: FontRun = font.show([placed.glyph], 0, 1)[0];
            if (Math.abs(placed.y - line) > TOLERANCE || Number.isNaN(pen)) {
                flush();
                pdf.content.textMatrix(1, 0, 0, -1, placed.x, placed.y);
                pen = placed.x;
                line = placed.y;
            }
            if (shown[0] !== resource || placed.size !== size) {
                flush();
                pdf.content.font(pdf.useFont(shown[0]), placed.size);
                resource = shown[0];
                size = placed.size;
            }
            const adjustment: number = (pen - placed.x) * UNITS / size;
            if (Math.abs(adjustment) > TOLERANCE) {
                parts.push(adjustment);
            }
            parts.push(shown[1]);
            pen = placed.x + font.width(placed.glyph) * size / UNITS;
        }
        flush();
        if (marked) {
            pdf.content.endMarked();
        }
        pdf.content.endText();
        if (replica) {
            pdf.content.endMarked();
        }
    }

    private itemAt(sequence: InlineSequence, text: InlineText, position: number): number {
        let low: number = 0;
        let high: number = sequence.items.length - 1;
        while (low < high) {
            const middle: number = (low + high + 1) >> 1;
            if (text.starts[middle] <= position) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        while (low > 0 && sequence.items[low].kind !== "text") {
            low--;
        }
        return low;
    }
}
