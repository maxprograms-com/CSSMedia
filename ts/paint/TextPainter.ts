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
import { CharacterMapLookup } from "../fonts/CharacterMapLookup.js";
import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { ImageFormats } from "../images/ImageFormats.js";
import type { FontInstance } from "../fonts/Typeface.js";
import type { PathData, StrokeStyle } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ShadowMask } from "../geometry/ShadowRaster.js";
import { ShadowRaster } from "../geometry/ShadowRaster.js";
import type { BoxSizes, Transform } from "../layout/BoxSizes.js";
import type { BoxFragment, LineFragment, TextPiece } from "../layout/Fragment.js";
import { PieceSpans } from "../layout/PieceSpans.js";
import type { Combination, GlyphRun, Hyphen, InlineSequence, InlineText, TextRun } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Size } from "../pdf/PageCanvas.js";
import { EmphasisMarks } from "../pdf/EmphasisMarks.js";
import type { EmphasisStyle } from "../pdf/EmphasisMarks.js";
import { VerticalOrientation } from "../pdf/VerticalOrientation.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { FontResource, FontRun, PdfFont } from "../writer/PdfFont.js";
import type { PdfFonts } from "../writer/PdfFonts.js";
import type { ImageResource, PdfPage } from "../writer/PdfPage.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";
import type { PaletteRule } from "./ColorGlyphPainter.js";
import { ColorGlyphPainter } from "./ColorGlyphPainter.js";
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
    cluster?: number;
    actual?: string;
    alone?: boolean;
}

type Locator = (pen: number, glyph: number, offsetX: number, offsetY: number) => readonly [number, number];

interface Frame {
    at: Locator;
    alone: boolean;
}

interface Placement {
    glyphs: Array<PlacedGlyph>;
    matrix?: Transform;
    marks?: Array<readonly [number, number]>;
}

interface Shadow {
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: CssValue | undefined;
    inset: boolean;
}

interface Composition {
    width: number;
    offsets: Map<number, number>;
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
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse", "force-hidden"]);
const DASH: number = 3;
const DECORATION: string = "text-decoration-";
const MATCH_TEXT: string = "match-text";
const SOFT_HYPHEN: string = "\u00AD";
const SPAN: string = "Span";
const HYPHEN_SPAN: number = -1;
const FILL: number = 0;
const STROKE: number = 1;
const FILL_STROKE: number = 2;
const SHADOW_SCALE: number = 2;
const INVISIBLE: number = 3;
const CLIP: number = 7;
const CAPS: Readonly<Record<string, number>> = { "butt": 0, "round": 1, "square": 2 };
const MITER_JOIN: number = 0;
const ROUND_JOIN: number = 1;
const BEVEL_JOIN: number = 2;
const MITER_LIMIT: number = 4;
const FLATNESS: number = 0.05;
const KAPPA: number = 4 / 3 * (Math.SQRT2 - 1);
const CLOCKWISE: Transform = [0, 1, -1, 0, 0, 0];
const COUNTERCLOCKWISE: Transform = [0, -1, 1, 0, 0, 0];

export class TextPainter {

    private readonly document: PdfDocument;
    private readonly fonts: PdfFonts;
    private readonly colors: ColorOutput;
    private readonly sizes: BoxSizes;
    private readonly metrics: FontMetrics;
    private readonly viewport: Size;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private clusters: number = 0;
    private readonly orientation: VerticalOrientation = new VerticalOrientation();
    private readonly emphasis: EmphasisMarks = new EmphasisMarks();
    private readonly spans: PieceSpans = new PieceSpans();
    private readonly raster: ShadowRaster = new ShadowRaster();
    private readonly images: ImageFormats;
    private collected?: Array<PathData>;
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly characters: CharacterMapLookup = new CharacterMapLookup();
    private readonly compositions: WeakMap<Combination, Composition> = new WeakMap<Combination, Composition>();
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private readonly geometry: PathGeometry = new PathGeometry();
    private readonly colorGlyphs: ColorGlyphPainter;
    private readonly chains: WeakMap<InlineSequence, Array<ReadonlyArray<ComputedStyle> | undefined>> = new WeakMap<InlineSequence, Array<ReadonlyArray<ComputedStyle> | undefined>>();
    private readonly shiftParents: WeakMap<InlineSequence, Array<ComputedStyle | undefined>> = new WeakMap<InlineSequence, Array<ComputedStyle | undefined>>();
    private readonly veils: WeakMap<InlineSequence, Array<boolean>> = new WeakMap<InlineSequence, Array<boolean>>();

    constructor(document: PdfDocument, colors: ColorOutput, sizes: BoxSizes, metrics: FontMetrics, viewport: Size, palettes: ReadonlyArray<PaletteRule>, images: ImageFormats) {
        this.document = document;
        this.fonts = document.fonts;
        this.colors = colors;
        this.sizes = sizes;
        this.metrics = metrics;
        this.viewport = viewport;
        this.images = images;
        this.colorGlyphs = new ColorGlyphPainter(document, colors, metrics, palettes, images);
    }

    runs(line: LineFragment, texts: ReadonlyArray<TextPiece>, runs: ReadonlyArray<TextPiece>, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage): void {
        // CSS Text Decoration 4 §5.1: the underlines and overlines of the runs between two boxes of the line, under their text.
        if (runs.length === 0) {
            return;
        }
        // §4: outer shadows are the bottommost layer, "between the element's border/background and the text and text decoration",
        // and inner shadows are painted over the text and its decorations.
        for (const piece of runs) {
            this.shadows(line, texts, piece, transform, decorators, pdf, false);
        }
        this.decorate(line, texts, runs, transform, decorators, pdf, false);
        for (const piece of runs) {
            this.paint(line, piece, transform, pdf);
        }
        for (const piece of runs) {
            this.shadows(line, texts, piece, transform, decorators, pdf, true);
        }
    }

    private shadowsOf(style: ComputedStyle): Array<Shadow> {
        // CSS Text Decoration 4 §4: the values are those of box-shadow, which are two to four lengths, a color and inset.
        const layers: Array<Shadow> = [];
        const value: CssValue | undefined = style.values["text-shadow"];
        if (this.isNone(value)) {
            return layers;
        }
        for (const layer of this.items(value)) {
            const lengths: Array<number> = [];
            let color: CssValue | undefined;
            let inset: boolean = false;
            for (const part of layer.kind === "list" ? layer.items : [layer]) {
                if (part.kind === "ident" && part.lower === "inset") {
                    inset = true;
                } else if (part.kind === "length" || part.kind === "dimension" || part.kind === "number" || part.kind === "calc" || part.kind === "percentage") {
                    lengths.push(this.sizes.pixels(part, this.metrics.fontSize(style.values)));
                } else {
                    color = part;
                }
            }
            if (lengths.length >= 2) {
                layers.push({ x: lengths[0], y: lengths[1], blur: Math.max(0, lengths[2] ?? 0), spread: Math.max(0, lengths[3] ?? 0), color, inset });
            }
        }
        return layers;
    }

    private shadows(line: LineFragment, texts: ReadonlyArray<TextPiece>, piece: TextPiece, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage, inner: boolean): void {
        // §4: "Each layer shadows the element's text and all its text decorations (composited together)" and "the first shadow is on
        // top", so the layers are painted from the last to the first.
        const text: InlineText = line.sequence.text as InlineText;
        const item: number = this.itemAt(line.sequence, text, text.clusters[piece.from]);
        const style: ComputedStyle = line.sequence.items[item].node.style;
        const layers: Array<Shadow> = this.shadowsOf(style).filter((shadow: Shadow) => shadow.inset === inner);
        if (layers.length === 0 || this.itemHidden(line.sequence, item)) {
            return;
        }
        const placement: Placement = this.pieceGlyphs(line, piece, transform);
        const turn: number = this.turn(line.sequence.style.values);
        this.collected = [];
        this.decorate(line, texts, [piece], transform, decorators, pdf, false);
        this.decorate(line, texts, [piece], transform, decorators, pdf, true);
        const decorations: Array<PathData> = this.collected.map((path: PathData): PathData => this.mapPath(path, (point: readonly [number, number]) => turn === 0 ? point : this.global(turn, point)));
        delete this.collected;
        const matrix: Transform | undefined = placement.matrix;
        const outlines: Array<PathData> | undefined = this.glyphShapes(placement.glyphs);
        const glyphs: Array<PathData> | undefined = outlines === undefined || matrix === undefined ? outlines : outlines.map((outline: PathData): PathData =>
            this.mapPath(outline, (point: readonly [number, number]) => [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]]));
        for (let index: number = layers.length - 1; index >= 0; index--) {
            pdf.content.save();
            this.shadow(layers[index], style, placement, glyphs, decorations, pdf);
            pdf.content.restore();
        }
    }

    private mapPath(path: PathData, change: (point: readonly [number, number]) => readonly [number, number]): PathData {
        const points: Array<number> = [];
        for (let index: number = 0; index < path.points.length; index += 2) {
            const point: readonly [number, number] = change([path.points[index], path.points[index + 1]]);
            points.push(point[0], point[1]);
        }
        return { verbs: path.verbs, points };
    }

    private shadow(shadow: Shadow, style: ComputedStyle, placement: Placement, glyphs: ReadonlyArray<PathData> | undefined, decorations: ReadonlyArray<PathData>,
        pdf: PdfPage): void {
        const color: CssValue | undefined = shadow.color === undefined || (shadow.color.kind === "ident" && shadow.color.lower === "currentcolor") ? style.values["color"] : shadow.color;
        if (glyphs === undefined) {
            // A standard font has no outlines, so the viewer draws its glyphs: a shadow is the text moved, with its outline widened
            // by the spread, and a blur or an inner shadow is made of the viewer's own glyphs too, in a soft mask.
            if (shadow.blur > 0 || shadow.inset) {
                this.viewerShadow(shadow, color, style, placement, pdf);
            } else {
                this.shadowText(shadow, color, style, placement, pdf);
            }
            this.rasterShadow(decorations, shadow, color, style, pdf);
            return;
        }
        this.rasterShadow([...glyphs, ...decorations], shadow, color, style, pdf);
    }

    private rasterShadow(shapes: ReadonlyArray<PathData>, shadow: Shadow, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        if (shapes.length === 0) {
            return;
        }
        const shifted: (path: PathData) => PathData = (path: PathData): PathData => this.mapPath(path, (point: readonly [number, number]) => [point[0] + shadow.x, point[1] + shadow.y]);
        if (shadow.blur === 0 && !shadow.inset) {
            this.fillPaths(shapes.map(shifted), shadow.spread, color, style, pdf);
            return;
        }
        const extent: Box | undefined = this.pathsInk(shapes);
        const mask: ShadowMask | undefined = this.raster.mask(shapes.map(shifted), shadow.spread, shadow.blur / 2, SHADOW_SCALE, extent ?? [0, 0, 0, 0],
            shadow.inset, shadow.inset);
        if (mask === undefined) {
            return;
        }
        this.maskedFill(mask, shadow.inset ? shapes : undefined, color, style, pdf);
    }

    private viewerShadow(shadow: Shadow, color: CssValue | undefined, style: ComputedStyle, placement: Placement, pdf: PdfPage): void {
        // The luminosity of the mask is the alpha of the shadow: copies of the viewer's glyphs, moved by the offsets and weighted as a
        // Gaussian is. An inner shadow is the mask inverted, in the clip of the text, so that it is where the moved text is not.
        if (placement.glyphs.length === 0) {
            return;
        }
        const deviation: number = shadow.blur / 2;
        const area: Box = this.viewerArea(placement, shadow, deviation);
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        form.content.fillSpace(form.useColorSpace(PdfColorSpaces.GRAY));
        form.content.fillColor([1]);
        if (shadow.spread > 0) {
            form.content.strokeSpace(form.useColorSpace(PdfColorSpaces.GRAY));
            form.content.strokeColor([1]);
            form.content.lineWidth(2 * shadow.spread);
            form.content.lineCap(1);
            form.content.lineJoin(ROUND_JOIN);
        }
        for (const [x, y, weight] of this.copies(deviation)) {
            form.content.save();
            form.content.graphicsState(form.useState(weight, weight, "Screen"));
            form.content.transform(1, 0, 0, 1, shadow.x + x, shadow.y + y);
            if (placement.matrix !== undefined) {
                this.concatenate(placement.matrix, form);
            }
            this.show(placement.glyphs, form, shadow.spread > 0 ? FILL_STROKE : FILL, true);
            form.content.restore();
        }
        pdf.content.save();
        if (shadow.inset) {
            // An inner shadow is drawn only where the text is, which the viewer's glyphs clip to in their own frame.
            const matrix: Transform | undefined = placement.matrix;
            if (matrix !== undefined) {
                this.concatenate(matrix, pdf);
            }
            this.show(placement.glyphs, pdf, CLIP, true);
            if (matrix !== undefined) {
                const determinant: number = matrix[0] * matrix[3] - matrix[1] * matrix[2];
                pdf.content.transform(matrix[3] / determinant, -matrix[1] / determinant, -matrix[2] / determinant, matrix[0] / determinant,
                    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant, (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant);
            }
        }
        this.document.applyMask(pdf, form, area, true, PdfColorSpaces.GRAY, shadow.inset);
        if (this.colors.fill(color, style, pdf, 1)) {
            pdf.content.rectangle(area[0], area[1], area[2], area[3]);
            pdf.content.fill(false);
        }
        pdf.content.restore();
    }

    private copies(deviation: number): ReadonlyArray<readonly [number, number, number]> {
        // The text is drawn once for no blur, and otherwise in a center and three rings of eight copies, whose weights follow the
        // Gaussian; screening them adds the weights, and the factor makes a solid area come out nearly opaque.
        if (deviation <= 0) {
            return [[0, 0, 1]];
        }
        const points: Array<[number, number, number]> = [[0, 0, 1]];
        for (const ring of [0.9, 1.8, 2.7]) {
            const radius: number = ring * deviation;
            for (let step: number = 0; step < 8; step++) {
                const angle: number = step * Math.PI / 4;
                points.push([radius * Math.cos(angle), radius * Math.sin(angle), Math.exp(-ring * ring / 2)]);
            }
        }
        const total: number = points.reduce((sum: number, point: [number, number, number]) => sum + point[2], 0);
        return points.map((point: [number, number, number]): readonly [number, number, number] => [point[0], point[1], Math.min(1, 2.2 * point[2] / total)]);
    }

    private viewerArea(placement: Placement, shadow: Shadow, deviation: number): Box {
        // Where the copies can reach on the page: the glyphs with room around them, through the matrix of their frame, widened by the
        // blur, the spread and the offsets.
        let left: number = Number.POSITIVE_INFINITY;
        let top: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let bottom: number = Number.NEGATIVE_INFINITY;
        for (const glyph of placement.glyphs) {
            left = Math.min(left, glyph.x - glyph.size);
            right = Math.max(right, glyph.x + 2 * glyph.size);
            top = Math.min(top, glyph.y - 1.5 * glyph.size);
            bottom = Math.max(bottom, glyph.y + glyph.size);
        }
        const matrix: Transform | undefined = placement.matrix;
        let minX: number = left;
        let minY: number = top;
        let maxX: number = right;
        let maxY: number = bottom;
        if (matrix !== undefined) {
            minX = Number.POSITIVE_INFINITY;
            minY = Number.POSITIVE_INFINITY;
            maxX = Number.NEGATIVE_INFINITY;
            maxY = Number.NEGATIVE_INFINITY;
            for (const corner of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
                const x: number = matrix[0] * corner[0] + matrix[2] * corner[1] + matrix[4];
                const y: number = matrix[1] * corner[0] + matrix[3] * corner[1] + matrix[5];
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
        const reach: number = 3 * deviation + shadow.spread;
        return [minX - reach - Math.abs(shadow.x), minY - reach - Math.abs(shadow.y), maxX - minX + 2 * (reach + Math.abs(shadow.x)), maxY - minY + 2 * (reach + Math.abs(shadow.y))];
    }

    private pathsInk(paths: ReadonlyArray<PathData>): Box | undefined {
        let left: number = Number.POSITIVE_INFINITY;
        let top: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let bottom: number = Number.NEGATIVE_INFINITY;
        for (const path of paths) {
            for (let index: number = 0; index < path.points.length; index += 2) {
                left = Math.min(left, path.points[index]);
                right = Math.max(right, path.points[index]);
                top = Math.min(top, path.points[index + 1]);
                bottom = Math.max(bottom, path.points[index + 1]);
            }
        }
        return left > right ? undefined : [left, top, right - left, bottom - top];
    }

    private fillPaths(paths: ReadonlyArray<PathData>, spread: number, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        // Text Decoration 4 §4: the text and its decorations are "composited together", so each shape is filled with its own
        // winding; ISO 32000-2 §11.6.4.3 NOTE 2: an alpha compounds where fills overlap, so a group takes the alpha once.
        if (paths.length === 0) {
            return;
        }
        const alpha: number = this.colors.color(color, style)?.[2] ?? 0;
        const ink: Box | undefined = alpha > 0 && alpha < 1 && (paths.length > 1 || spread > 0) ? this.pathsInk(paths) : undefined;
        if (ink !== undefined) {
            const reach: number = spread + 1;
            const area: Box = [ink[0] - reach, ink[1] - reach, ink[2] + 2 * reach, ink[3] + 2 * reach];
            const form: PdfPage = this.document.startForm(area[2], area[3], false);
            if (this.colors.solid(color, style, form, false) && (spread <= 0 || this.colors.solid(color, style, form, true))) {
                this.drawPaths(paths, spread, form);
            }
            pdf.content.graphicsState(pdf.useState(alpha, 1, "Normal"));
            pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, PathGeometry.IDENTITY)));
            return;
        }
        if (this.colors.fill(color, style, pdf, 1) && (spread <= 0 || this.colors.stroke(color, style, pdf, 1))) {
            this.drawPaths(paths, spread, pdf);
        }
    }

    private drawPaths(paths: ReadonlyArray<PathData>, spread: number, pdf: PdfPage): void {
        for (const path of paths) {
            this.geometry.trace(path, pdf.content);
            pdf.content.fill(false);
        }
        if (spread <= 0) {
            return;
        }
        pdf.content.lineWidth(2 * spread);
        pdf.content.lineCap(1);
        pdf.content.lineJoin(ROUND_JOIN);
        for (const path of paths) {
            this.geometry.trace(path, pdf.content);
            pdf.content.stroke();
        }
    }

    private shadowText(shadow: Shadow, color: CssValue | undefined, style: ComputedStyle, placement: Placement, pdf: PdfPage): void {
        // The glyphs of the text, moved by the offsets of the shadow, in its color; ActualText of nothing keeps them out of the text.
        if (placement.glyphs.length === 0 || !this.colors.fill(color, style, pdf, 1)) {
            return;
        }
        pdf.content.transform(1, 0, 0, 1, shadow.x, shadow.y);
        if (placement.matrix !== undefined) {
            this.concatenate(placement.matrix, pdf);
        }
        if (shadow.spread > 0 && this.colors.stroke(color, style, pdf, 1)) {
            pdf.content.lineWidth(2 * shadow.spread);
            pdf.content.lineCap(1);
            pdf.content.lineJoin(ROUND_JOIN);
            this.show(placement.glyphs, pdf, FILL_STROKE, true);
        } else {
            this.show(placement.glyphs, pdf, FILL, true);
        }
    }

    private maskedFill(mask: ShadowMask, within: ReadonlyArray<PathData> | undefined, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        // The alpha of the shadow is a gray image that becomes the soft mask of the fill of its color (ISO 32000-2 §11.6.5.2).
        // An inner shadow is only where the text is: the image is drawn once in the clip of each shape, which makes their union.
        const resource: ImageResource = this.images.write({ width: mask.width, height: mask.height, bits: 8, channels: 1, pixels: mask.pixels }, PdfColorSpaces.GRAY, true);
        const area: Box = [mask.left, mask.top, mask.width / mask.scale, mask.height / mask.scale];
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        for (const shape of within ?? [undefined]) {
            form.content.save();
            if (shape !== undefined) {
                this.geometry.trace(shape, form.content);
                form.content.clip(false);
            }
            form.content.transform(area[2], 0, 0, -area[3], area[0], area[1] + area[3]);
            form.content.paintXObject(form.useImage(resource));
            form.content.restore();
        }
        pdf.content.save();
        this.document.applyMask(pdf, form, area, true, PdfColorSpaces.GRAY);
        if (this.colors.fill(color, style, pdf, 1)) {
            pdf.content.rectangle(area[0], area[1], area[2], area[3]);
            pdf.content.fill(false);
        }
        pdf.content.restore();
    }

    decorate(line: LineFragment, pieces: ReadonlyArray<TextPiece>, shown: ReadonlyArray<TextPiece>, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage | undefined,
        through: boolean): void {
        // CSS Text Decoration 4 §2.9: each decorating box has "a single thickness and position on each line", so all the text
        // of the line counts for the position, while only the runs given as shown are decorated now.
        const text: InlineText = line.sequence.text as InlineText;
        const owners: Map<ComputedStyle, Array<Span>> = new Map<ComputedStyle, Array<Span>>();
        // In vertical writing modes the lines are measured in the frame of the glyphs, where the text runs along x with its
        // alphabetic baseline at y, and the content stream turns that frame to the page.
        const turn: number = this.turn(line.sequence.style.values);
        for (const piece of pieces) {
            const index: number = this.itemAt(line.sequence, text, text.clusters[piece.from]);
            const applying: ReadonlyArray<ComputedStyle> = [...decorators, ...(this.chain(line.sequence)[index] ?? [])];
            if (applying.length === 0 || this.itemHidden(line.sequence, index)) {
                continue;
            }
            const inline: number = (line.inline ?? 0) + piece.inline;
            const block: number = line.block + piece.baseline;
            const start: readonly [number, number] = this.local(turn, this.sizes.apply(transform, inline, block));
            const end: readonly [number, number] = this.local(turn, this.sizes.apply(transform, inline + piece.inlineSize, block));
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
        if (owners.size === 0) {
            return;
        }
        // The shapes collected for a shadow or for the ink stay in the frame of the glyphs, which their collector turns.
        const drawing: PdfPage | undefined = this.collected === undefined ? pdf : undefined;
        drawing?.content.save();
        if (turn !== 0 && drawing !== undefined) {
            this.concatenate(turn > 0 ? CLOCKWISE : COUNTERCLOCKWISE, drawing);
        }
        for (const [owner, spans] of owners) {
            const kinds: ReadonlyArray<string> = this.keywords(owner.values["text-decoration-line"]);
            const thickness: number = this.thickness(owner);
            // §2.8.1: left and right place the underline on that side of the text "in vertical typographic modes", and the
            // frame of the glyphs has its over side to the right, so the underline is on the over side with right.
            const sided: boolean = this.orientation.typographicVertical(owner.values);
            const position: ReadonlyArray<string> = this.keywords(owner.values["text-underline-position"]);
            const over: boolean = sided && position.includes("right");
            if (through && kinds.includes("line-through")) {
                // §2.5: a line-through goes through each run at the position its font gives.
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, span.baseline - this.metrics.strikeout(span.run.font, span.run.size)[0], thickness, 0, pdf);
                }
            }
            if (!through && kinds.includes("underline")) {
                const top: number = this.underlineTop(owner, spans, thickness, sided, over);
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, top, thickness, over ? -1 : 1, pdf);
                }
            }
            if (!through && kinds.includes("overline")) {
                // §2.5: over lines "with respect to the highest over EM-box edge of the considered text"; when the underline is
                // on the over side, the overline "also switches sides and is drawn on the 'under' side".
                const lowest: number = Math.max(...spans.map((span: Span) => span.baseline + this.metrics.fontEmBox(span.run.font, span.run.size, sided, span.run.upright)[1]));
                const highest: number = Math.min(...spans.map((span: Span) => span.baseline - this.metrics.fontEmBox(span.run.font, span.run.size, sided, span.run.upright)[0]));
                for (const span of spans.filter((candidate: Span) => candidate.shown)) {
                    this.line(owner, span.left, span.right, over ? lowest : highest - thickness, thickness, over ? 1 : -1, pdf);
                }
            }
        }
        drawing?.content.restore();
    }

    private turn(values: Values): number {
        // CSS Writing Modes 4 §5.1: sideways text is "rotated 90° clockwise", and sideways-lr turns it the other way.
        const mode: string = this.keywords(values["writing-mode"])[0] ?? "horizontal-tb";
        return mode === "horizontal-tb" ? 0 : (mode === "sideways-lr" ? -1 : 1);
    }

    private local(turn: number, point: readonly [number, number]): readonly [number, number] {
        // The inverse of CLOCKWISE and COUNTERCLOCKWISE, which turn the frame of the glyphs to the page.
        return turn === 0 ? point : (turn > 0 ? [point[1], -point[0]] : [-point[1], point[0]]);
    }

    private thickness(owner: ComputedStyle): number {
        const value: CssValue | undefined = owner.values["text-decoration-thickness"];
        if (value !== undefined && value.kind !== "ident") {
            return this.sizes.pixels(value, this.metrics.fontSize(owner.values));
        }
        return this.metrics.underline(owner.values)[1];
    }

    private underlineTop(owner: ComputedStyle, spans: ReadonlyArray<Span>, thickness: number, sided: boolean, over: boolean): number {
        // §2.8.1: the zero position is the alphabetic baseline for auto, the position of the font for from-font and the
        // text-under edge for under; an auto offset takes the position of the font.
        const position: ReadonlyArray<string> = this.keywords(owner.values["text-underline-position"]);
        const offset: CssValue | undefined = owner.values["text-underline-offset"];
        const given: number | undefined = offset !== undefined && offset.kind !== "ident" ? this.sizes.pixels(offset, this.metrics.fontSize(owner.values)) : undefined;
        if (over) {
            // "aligned as for under, except it is always aligned to the right edge of the text": the text-over edge, outward.
            return Math.min(...spans.map((span: Span) => span.baseline - this.metrics.fontContent(span.run.font, span.run.size, span.run.upright)[0])) - thickness - (given ?? 0);
        }
        if (position.includes("under") || (sided && position.includes("left"))) {
            // §2.8.1: under and left have their zero position at the text-under edge, the lowest one of the considered text.
            return Math.max(...spans.map((span: Span) => span.baseline + this.metrics.fontContent(span.run.font, span.run.size, span.run.upright)[1])) + (given ?? 0);
        }
        // §2.5: "the ideal offset (from the alphabetic baseline) of each run of considered text, averaging those, and then
        // using the lowest alphabetic baseline to actually position the line".
        // A run is text of one font at one size: the shaping runs that a change of script splits it into count once.
        const ideals: Array<number> = [];
        let previous: Span | undefined;
        for (const span of spans) {
            if (previous === undefined || previous.run.font !== span.run.font || previous.run.size !== span.run.size || previous.ideal !== span.ideal) {
                ideals.push(span.ideal);
            }
            previous = span;
        }
        const font: number = ideals.reduce((total: number, ideal: number) => total + ideal, 0) / ideals.length;
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

    private line(owner: ComputedStyle, left: number, right: number, top: number, thickness: number, outward: number, pdf: PdfPage | undefined): void {
        // The wavy line is a band along a curve, filled by stroking the curve.
        const kind: string = this.keywords(owner.values["text-decoration-style"])[0] ?? "solid";
        if (!this.isNone(this.paintValue(owner, DECORATION, "fill-image"))) {
            throw new Error("The painting of " + DECORATION + "fill-image is not implemented");
        }
        // Text Decoration 4 §2.3: text-decoration-color "sets the color of underlines, overlines, and line-throughs"; at its
        // initial currentcolor, match-text takes fill-color as Fill and Stroke 3 §5 says.
        const own: CssValue | undefined = owner.values[DECORATION + "fill-color"];
        const decoration: CssValue | undefined = owner.values["text-decoration-color"];
        const given: boolean = decoration !== undefined && !(decoration.kind === "ident" && decoration.lower === "currentcolor");
        const color: CssValue | undefined = own !== undefined && !(own.kind === "ident" && own.lower === MATCH_TEXT) ? own
            : (given ? decoration : owner.values["fill-color"]);
        const opacity: number = this.opacity(this.paintValue(owner, DECORATION, "fill-opacity"));
        const path: PathData = { verbs: [], points: [] };
        const bounds: Box = this.decorationPath(kind, left, right, top, thickness, outward, path);
        if (this.collected !== undefined) {
            // The shape of a decoration, for the shadow of the text, which is drawn from its geometry.
            this.collected.push(kind === "wavy" ? this.geometry.outline(path, thickness, FLATNESS) : path);
            return;
        }
        if (pdf === undefined) {
            return;
        }
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
            const stroke: StrokeStyle = this.strokeOf(owner, DECORATION, layer, align === "center" ? width : 2 * width, align === "inset");
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

    private itemHidden(sequence: InlineSequence, index: number): boolean {
        return this.hidden(sequence.items[index].node.style) || this.veiled(sequence)[index] === true;
    }

    private veiled(sequence: InlineSequence): Array<boolean> {
        // CSS Display 4 §5: with force-hidden "Any boxes generated by the element and its descendants are invisible (regardless of their
        // visibility value)", so the text inside an inline element that has it is not drawn.
        let veils: Array<boolean> | undefined = this.veils.get(sequence);
        if (veils !== undefined) {
            return veils;
        }
        veils = [];
        let depth: number = 0;
        const open: Array<boolean> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "open") {
                const forced: boolean = this.keywords(item.node.style.values["visibility"])[0] === "force-hidden";
                open.push(forced);
                depth += forced ? 1 : 0;
            } else if (item.kind === "close") {
                depth -= open.pop() === true ? 1 : 0;
            } else if (item.kind === "text") {
                veils[index] = depth > 0;
            }
        }
        this.veils.set(sequence, veils);
        return veils;
    }

    paint(line: LineFragment, piece: TextPiece, transform: Transform, pdf: PdfPage): void {
        const text: InlineText = line.sequence.text as InlineText;
        const index: number = this.itemAt(line.sequence, text, text.clusters[piece.from]);
        const style: ComputedStyle = line.sequence.items[index].node.style;
        const values: Readonly<Record<string, CssValue>> = style.values;
        if (this.itemHidden(line.sequence, index)) {
            return;
        }
        this.supported(values);
        const placement: Placement = this.pieceGlyphs(line, piece, transform);
        if (placement.glyphs.length === 0) {
            return;
        }
        if (placement.matrix !== undefined) {
            pdf.content.save();
            this.concatenate(placement.matrix, pdf);
        }
        this.strokeText(placement.glyphs, style, this.fillText(placement.glyphs, style, pdf), pdf);
        if (placement.matrix !== undefined) {
            pdf.content.restore();
        }
        if (placement.marks !== undefined && placement.marks.length > 0) {
            this.drawMarks(placement.marks, piece.run, style, pdf);
        }
    }

    private drawMarks(marks: ReadonlyArray<readonly [number, number]>, run: TextRun, style: ComputedStyle, pdf: PdfPage): void {
        // CSS Text Decoration 4 §3.1: the marks are the glyphs of the shape at 50% of the size of the text, or a synthesized shape;
        // §3.2: their color is text-emphasis-color, which is currentcolor unless it is given.
        const mark: EmphasisStyle = this.emphasis.style(style.values) as EmphasisStyle;
        const given: CssValue | undefined = style.values["text-emphasis-color"];
        const color: CssValue | undefined = given === undefined || (given.kind === "ident" && given.lower === "currentcolor") ? style.values["color"] : given;
        for (const spot of marks) {
            pdf.content.save();
            if (mark.shape === "string") {
                this.markString(mark.text as string, spot, run, color, style, pdf);
            } else {
                this.markShape(mark, spot, run.size / 2, color, style, pdf);
            }
            pdf.content.restore();
        }
    }

    private markString(characters: string, spot: readonly [number, number], run: TextRun, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        // The string is shown at half the size of the text, its middle on the spot; a font without a glyph for it shows no mark.
        const glyph: number = this.characters.glyphOf(run.font.typeface.characters, characters.codePointAt(0) as number);
        if (glyph === 0 || !this.colors.fill(color, style, pdf, 1)) {
            return;
        }
        const size: number = run.size / 2;
        const advance: number = (run.font.advances[glyph] ?? 0) * size / run.font.metrics.unitsPerEm;
        const baseline: number = spot[1] + this.metrics.fontBaseline(run.font, size, "central", false, false);
        this.show([{ x: spot[0] - advance / 2, y: baseline, glyph, text: "", font: run.font, size }], pdf, FILL, true);
    }

    private markShape(mark: EmphasisStyle, spot: readonly [number, number], size: number, color: CssValue | undefined, style: ComputedStyle, pdf: PdfPage): void {
        // The shapes of the glyphs that §3.1 names, drawn in a square of the given size: a filled shape is filled and an open one is
        // its outline, a double circle is a ring with a disc or a ring inside it, and a sesame is a slanted drop.
        const x: number = spot[0];
        const y: number = spot[1];
        const line: number = 0.08 * size;
        const solid: PathData = { verbs: [], points: [] };
        const lines: PathData = { verbs: [], points: [] };
        const target: PathData = mark.filled ? solid : lines;
        const inset: number = mark.filled ? 0 : line / 2;
        if (mark.shape === "dot") {
            this.ellipse(target, x, y, 0.19 * size - inset, 0.19 * size - inset, 0);
        } else if (mark.shape === "circle") {
            this.ellipse(target, x, y, 0.36 * size - inset, 0.36 * size - inset, 0);
        } else if (mark.shape === "double-circle") {
            this.ellipse(lines, x, y, 0.4 * size - line / 2, 0.4 * size - line / 2, 0);
            this.ellipse(target, x, y, 0.2 * size - inset, 0.2 * size - inset, 0);
        } else if (mark.shape === "triangle") {
            const half: number = 0.4 * size - inset;
            target.verbs.push(PathGeometry.MOVE, PathGeometry.LINE, PathGeometry.LINE, PathGeometry.CLOSE);
            target.points.push(x, y - 0.36 * size + inset, x + half, y + 0.3 * size - inset, x - half, y + 0.3 * size - inset);
        } else {
            this.ellipse(target, x, y, 0.11 * size - inset, 0.3 * size - inset, Math.PI / 7);
        }
        if (solid.verbs.length > 0 && this.colors.fill(color, style, pdf, 1)) {
            this.geometry.trace(solid, pdf.content);
            pdf.content.fill(false);
        }
        if (lines.verbs.length > 0 && this.colors.stroke(color, style, pdf, 1)) {
            pdf.content.lineWidth(line);
            pdf.content.lineJoin(MITER_JOIN);
            this.geometry.trace(lines, pdf.content);
            pdf.content.stroke();
        }
    }

    private ellipse(path: PathData, x: number, y: number, radiusX: number, radiusY: number, angle: number): void {
        // Four cubic Bézier curves with their control points at 4/3 (√2 - 1) of the radii, turned about the center.
        const handleX: number = KAPPA * radiusX;
        const handleY: number = KAPPA * radiusY;
        const cosine: number = Math.cos(angle);
        const sine: number = Math.sin(angle);
        const corners: ReadonlyArray<readonly [number, number]> = [
            [radiusX, 0], [radiusX, handleY], [handleX, radiusY], [0, radiusY], [-handleX, radiusY], [-radiusX, handleY], [-radiusX, 0],
            [-radiusX, -handleY], [-handleX, -radiusY], [0, -radiusY], [handleX, -radiusY], [radiusX, -handleY], [radiusX, 0]
        ];
        path.verbs.push(PathGeometry.MOVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CURVE, PathGeometry.CLOSE);
        for (const [px, py] of corners) {
            path.points.push(x + px * cosine - py * sine, y + px * sine + py * cosine);
        }
    }

    private concatenate(matrix: Transform, pdf: PdfPage): void {
        pdf.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    }

    shapes(line: LineFragment, piece: TextPiece, transform: Transform, decorators: ReadonlyArray<ComputedStyle>, pdf: PdfPage): void {
        // CSS Backgrounds 4 §2.8: the geometry of the text and its decorations, whatever their color, for background-clip: text.
        const text: InlineText = line.sequence.text as InlineText;
        if (this.itemHidden(line.sequence, this.itemAt(line.sequence, text, text.clusters[piece.from]))) {
            return;
        }
        const placement: Placement = this.pieceGlyphs(line, piece, transform);
        pdf.content.save();
        this.decorate(line, [piece], [piece], transform, decorators, pdf, false);
        this.decorate(line, [piece], [piece], transform, decorators, pdf, true);
        if (placement.glyphs.length > 0) {
            if (placement.matrix !== undefined) {
                this.concatenate(placement.matrix, pdf);
            }
            this.show(placement.glyphs, pdf, FILL, true);
        }
        pdf.content.restore();
    }

    private pieceGlyphs(line: LineFragment, piece: TextPiece, transform: Transform): Placement {
        // CSS Writing Modes 4 §5.1: sideways glyphs are drawn as horizontal text turned a quarter, so they are placed in the
        // frame of the text with a matrix that turns it; upright glyphs and combined text keep the page's frame.
        const text: InlineText = line.sequence.text as InlineText;
        const run: TextRun = piece.run;
        const inline: number = (line.inline ?? 0) + piece.inline;
        const block: number = line.block + piece.baseline;
        const start: readonly [number, number] = this.sizes.apply(transform, inline, block);
        const end: readonly [number, number] = this.sizes.apply(transform, inline + piece.inlineSize, block);
        const turn: number = this.turn(line.sequence.style.values);
        const values: Values = line.sequence.items[this.itemAt(line.sequence, text, text.clusters[piece.from])].node.style.values;
        if (turn === 0) {
            const left: number = Math.min(start[0], end[0]);
            const frame: Frame = { at: (pen: number, _glyph: number, offsetX: number, offsetY: number) => [left + pen + offsetX, start[1] - offsetY], alone: false };
            return { glyphs: this.glyphsOf(text, piece, frame), marks: this.spots(text, piece, frame, values, 0) };
        }
        if (run.upright) {
            // §4.2: upright glyphs are aligned on the central baseline, which lies "above" the alphabetic one as far as the
            // font says, and each one hangs from its vertical origin down the line.
            const top: number = Math.min(start[1], end[1]);
            const centre: number = start[0] + turn * this.metrics.fontBaseline(run.font, run.size, "central", true, true);
            const frame: Frame = { at: (pen: number, _glyph: number, offsetX: number, offsetY: number) => [centre + offsetX, top + pen - offsetY], alone: true };
            return { glyphs: this.glyphsOf(text, piece, frame), marks: this.spots(text, piece, frame, values, turn) };
        }
        if (run.combined) {
            return this.composed(line, piece, transform, text, start[0], values);
        }
        const first: readonly [number, number] = this.local(turn, start);
        const last: readonly [number, number] = this.local(turn, end);
        const left: number = Math.min(first[0], last[0]);
        const frame: Frame = { at: (pen: number, _glyph: number, offsetX: number, offsetY: number) => [left + pen + offsetX, first[1] - offsetY], alone: false };
        return { glyphs: this.glyphsOf(text, piece, frame), matrix: turn > 0 ? CLOCKWISE : COUNTERCLOCKWISE, marks: this.spots(text, piece, frame, values, turn) };
    }

    private spots(text: InlineText, piece: TextPiece, frame: Frame, values: Values, turn: number): Array<readonly [number, number]> {
        // CSS Text Decoration 4 §3.4: ruby-like marks centered on each unit, on the given side of the base.
        // They stay upright, so they are put on the page, not in the frame of the glyphs.
        const run: TextRun = piece.run;
        if (piece.leader === true || this.emphasis.style(values) === undefined) {
            return [];
        }
        // §3.4 places them as ruby, outside the content box; upright glyphs are placed from the central baseline, so the edges of the
        // content box, counted from the alphabetic one, are moved to it.
        const content: readonly [number, number] = this.metrics.fontContent(run.font, run.size, run.upright);
        const central: number = run.upright ? this.metrics.fontBaseline(run.font, run.size, "central", true, true) : 0;
        const under: boolean = this.emphasis.isUnder(values);
        const reach: number = (under ? content[1] + central : content[0] - central) + run.size / 4;
        return this.centers(text, piece, values).map((spot: readonly [number, number]): readonly [number, number] => {
            const signed: number = under ? -(reach + spot[1]) : reach + spot[1];
            const center: number = spot[0];
            const point: readonly [number, number] = run.upright ? frame.at(center, -1, signed, 0) : frame.at(center, -1, 0, signed);
            return turn !== 0 && !run.upright ? this.global(turn, point) : point;
        });
    }

    private global(turn: number, point: readonly [number, number]): readonly [number, number] {
        // The matrix that CLOCKWISE or COUNTERCLOCKWISE puts in the content stream, for a point.
        return turn > 0 ? [-point[1], point[0]] : [point[1], -point[0]];
    }

    private centers(text: InlineText, piece: TextPiece, values: Values): Array<readonly [number, number]> {
        // The middle of the glyphs of each typographic character unit that gets a mark, along the line from the start of the
        // piece, placed as placed() places them, and how far the layout moved the mark outward for its ruby and decorations.
        const run: TextRun = piece.run;
        const from: number = text.clusters[piece.from];
        const to: number = piece.to < run.glyphEnd ? text.clusters[piece.to] : run.end;
        const spans: Array<readonly [number, number]> = this.spans.of(text, piece);
        let characters: string = "";
        for (let position: number = from; position < to; position++) {
            characters += String.fromCodePoint(text.codepoints[position]);
        }
        const centers: Array<readonly [number, number]> = [];
        let at: number = 0;
        for (const cluster of this.graphemes.segment(characters)) {
            const length: number = Array.from(cluster.segment).length;
            if (this.emphasis.unit(cluster.segment, values)) {
                let first: number = Number.POSITIVE_INFINITY;
                let last: number = Number.NEGATIVE_INFINITY;
                let lift: number = 0;
                for (let index: number = at; index < at + length; index++) {
                    first = Math.min(first, spans[index][0]);
                    last = Math.max(last, spans[index][1]);
                    lift = Math.max(lift, piece.lifts?.[index] ?? 0);
                }
                centers.push([(first + last) / 2, lift]);
            }
            at += length;
        }
        return centers;
    }

    private glyphsOf(text: InlineText, piece: TextPiece, frame: Frame): Array<PlacedGlyph> {
        return piece.leader === true ? this.leader(text, piece.run, piece, frame) : this.placed(text, piece.run, piece, frame, 0);
    }

    private composed(line: LineFragment, piece: TextPiece, transform: Transform, text: InlineText, baseline: number, values: Values): Placement {
        // §9.1.2: the glyphs are "composed horizontally" in a square of 1em, centered in it along the line and across it on the
        // central baseline; §9.1.3: what is wider than the square is compressed to it.
        const run: TextRun = piece.run;
        const position: number = text.clusters[piece.from];
        const combination: Combination = text.combinations.find((candidate: Combination) => candidate.start <= position && position < candidate.end) as Combination;
        let first: number = Number.POSITIVE_INFINITY;
        let last: number = Number.NEGATIVE_INFINITY;
        for (const other of line.pieces) {
            if (other.kind === "text" && other.run.combined) {
                const at: number = text.clusters[other.from];
                if (at >= combination.start && at < combination.end) {
                    first = Math.min(first, other.inline);
                    last = Math.max(last, other.inline + other.inlineSize);
                }
            }
        }
        const turn: number = this.turn(line.sequence.style.values);
        const centreY: number = this.sizes.apply(transform, (line.inline ?? 0) + (first + last) / 2, line.block + piece.baseline)[1];
        const centreX: number = baseline + turn * this.metrics.fontBaseline(run.font, run.size, "central", true, false);
        const bottom: number = centreY + this.metrics.fontBaseline(run.font, run.size, "central", false, false);
        const composition: Composition = this.composition(text, combination);
        const left: number = centreX - composition.width / 2;
        const placement: Placement = {
            glyphs: this.glyphsOf(text, piece, {
                at: (_pen: number, glyph: number, offsetX: number, offsetY: number) => [left + (composition.offsets.get(glyph) ?? 0) + offsetX, bottom - offsetY], alone: true
            })
        };
        if (combination.scale !== 1) {
            placement.matrix = [combination.scale, 0, 0, 1, (1 - combination.scale) * centreX, 0];
        }
        // §9.1.2: "for other text layout purposes, e.g. emphasis marks, ... the resulting composition is treated as a single glyph", so
        // it gets one mark, beside its square of 1em.
        if (position === combination.start && this.emphasis.style(values) !== undefined && this.emphasis.marked(text.codepoints, combination.start, combination.end, values)) {
            const reach: number = 3 * run.size / 4 + Math.max(0, ...(piece.lifts ?? []));
            placement.marks = [[centreX + (this.emphasis.isUnder(values) ? -reach : reach) * turn, centreY]];
        }
        return placement;
    }

    private composition(text: InlineText, combination: Combination): Composition {
        // UAX #9 rule L2 orders the runs of the composition, which is bidi-isolated (§9.1.2). Its ends carry the slack that the
        // shaper added to make it 1em, which is no part of the glyphs.
        let known: Composition | undefined = this.compositions.get(combination);
        if (known !== undefined) {
            return known;
        }
        const runs: ReadonlyArray<TextRun> = text.runs.filter((run: TextRun) => run.start >= combination.start && run.start < combination.end && run.glyphEnd > run.glyphStart);
        const order: Array<number> = Array.from(runs.keys());
        const levels: ReadonlyArray<number> = runs.map((run: TextRun) => run.level);
        const lowest: number = Math.min(...levels.filter((level: number) => (level & 1) === 1));
        for (let level: number = Math.max(...levels); level >= lowest; level--) {
            for (let from: number = 0; from < order.length; from++) {
                if (levels[order[from]] < level) {
                    continue;
                }
                let to: number = from;
                while (to + 1 < order.length && levels[order[to + 1]] >= level) {
                    to++;
                }
                order.splice(from, to - from + 1, ...order.slice(from, to + 1).reverse());
                from = to;
            }
        }
        const firstGlyph: number = runs.length > 0 ? runs[0].glyphStart : -1;
        const lastGlyph: number = runs.length > 0 ? runs[runs.length - 1].glyphEnd - 1 : -1;
        const offsets: Map<number, number> = new Map<number, number>();
        let width: number = 0;
        for (const index of order) {
            const run: TextRun = runs[index];
            const clusters: Array<Array<number>> = [];
            for (let glyph: number = run.glyphStart; glyph < run.glyphEnd; glyph++) {
                const current: Array<number> | undefined = clusters[clusters.length - 1];
                if (current !== undefined && text.clusters[current[0]] === text.clusters[glyph]) {
                    current.push(glyph);
                } else {
                    clusters.push([glyph]);
                }
            }
            if ((run.level & 1) === 1) {
                clusters.reverse();
            }
            for (const glyph of clusters.flat()) {
                offsets.set(glyph, width);
                width += text.advances[glyph] - (glyph === firstGlyph ? combination.slack / 2 : 0) - (glyph === lastGlyph ? combination.slack / 2 : 0);
            }
        }
        known = { width, offsets };
        this.compositions.set(combination, known);
        return known;
    }

    textInk(line: LineFragment, piece: TextPiece, transform: Transform): Box | undefined {
        // Sideways glyphs are placed in the frame of the text, which the matrix of their placement turns to the page.
        const text: InlineText = line.sequence.text as InlineText;
        const style: ComputedStyle = line.sequence.items[this.itemAt(line.sequence, text, text.clusters[piece.from])].node.style;
        const placement: Placement = this.pieceGlyphs(line, piece, transform);
        return this.mapped(this.ink(placement.glyphs, this.strokeReach(style, "")), placement.matrix);
    }

    lineInk(line: LineFragment, transform: Transform, decorators: ReadonlyArray<ComputedStyle>): Box | undefined {
        // CSS Overflow 3 §2.2: the ink of text is what painting it reaches: the glyphs with their strokes, the decorations with theirs, the
        // emphasis marks, and the outer shadows (CSS Text Decoration 4 §4), whose blur reaches three deviations of half the blur radius.
        const texts: Array<TextPiece> = line.pieces.filter((piece: TextPiece | BoxFragment): piece is TextPiece => piece.kind === "text");
        const text: InlineText = line.sequence.text as InlineText;
        const turn: number = this.turn(line.sequence.style.values);
        let box: Box | undefined;
        for (const piece of texts) {
            const index: number = this.itemAt(line.sequence, text, text.clusters[piece.from]);
            const style: ComputedStyle = line.sequence.items[index].node.style;
            if (this.itemHidden(line.sequence, index)) {
                continue;
            }
            const placement: Placement = this.pieceGlyphs(line, piece, transform);
            let own: Box | undefined = this.mapped(this.ink(placement.glyphs, this.strokeReach(style, "")), placement.matrix);
            // §3.1: a mark is half the size of the text, centered on its spot.
            const half: number = piece.run.size / 4;
            for (const spot of placement.marks ?? []) {
                own = this.union(own, [spot[0] - half, spot[1] - half, 2 * half, 2 * half]);
            }
            this.collected = [];
            this.decorate(line, texts, [piece], transform, decorators, undefined, false);
            this.decorate(line, texts, [piece], transform, decorators, undefined, true);
            const decorations: Array<PathData> = this.collected.map((path: PathData): PathData => this.mapPath(path, (point: readonly [number, number]) => turn === 0 ? point
                : this.global(turn, point)));
            delete this.collected;
            const lines: Box | undefined = this.pathsInk(decorations);
            if (lines !== undefined) {
                let reach: number = 0;
                for (const owner of [...decorators, ...(this.chain(line.sequence)[index] ?? [])]) {
                    reach = Math.max(reach, this.strokeReach(owner, DECORATION));
                }
                own = this.union(own, [lines[0] - reach, lines[1] - reach, lines[2] + 2 * reach, lines[3] + 2 * reach]);
            }
            box = this.union(box, own);
            for (const shadow of own === undefined ? [] : this.shadowsOf(style)) {
                const reach: number = 3 * shadow.blur / 2 + shadow.spread;
                if (!shadow.inset && own !== undefined) {
                    box = this.union(box, [own[0] + shadow.x - reach, own[1] + shadow.y - reach, own[2] + 2 * reach, own[3] + 2 * reach]);
                }
            }
        }
        return box;
    }

    private strokeReach(style: ComputedStyle, prefix: string): number {
        // The widest stroke counts at twice its width, which is what an outside stroke-align draws.
        let reach: number = 0;
        for (const value of this.items(this.paintValue(style, prefix, "stroke-width"))) {
            const width: number = this.sizes.pixels(value, this.scaledViewport());
            reach = width > 0 ? Math.max(reach, this.reach(this.strokeOf(style, prefix, 0, 2 * width, false))) : reach;
        }
        return reach;
    }

    private mapped(box: Box | undefined, matrix: Transform | undefined): Box | undefined {
        if (box === undefined || matrix === undefined) {
            return box;
        }
        let result: Box | undefined;
        for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
            result = this.union(result, [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5], 0, 0]);
        }
        return result;
    }

    private union(first: Box | undefined, second: Box | undefined): Box | undefined {
        if (first === undefined || second === undefined) {
            return first ?? second;
        }
        const left: number = Math.min(first[0], second[0]);
        const top: number = Math.min(first[1], second[1]);
        return [left, top, Math.max(first[0] + first[2], second[0] + second[2]) - left, Math.max(first[1] + first[3], second[1] + second[3]) - top];
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
        this.supported(style.values);
        const placed: Array<PlacedGlyph> = this.singleGlyphs(glyphs, transform);
        pdf.content.save();
        const filled: boolean = this.colors.fill(style.values["color"], style, pdf);
        this.show(placed, pdf, filled ? FILL : INVISIBLE, false);
        pdf.content.restore();
    }

    singleShapes(glyphs: ReadonlyArray<SingleGlyph>, transform: Transform, pdf: PdfPage): void {
        // CSS Backgrounds 4 §2.8: glyphs placed one by one are text of the element too, so their geometry is part of background-clip: text.
        if (glyphs.length === 0) {
            return;
        }
        pdf.content.save();
        this.show(this.singleGlyphs(glyphs, transform), pdf, FILL, true);
        pdf.content.restore();
    }

    private supported(values: Values): void {
        for (const property of ["fill-image"]) {
            if (!this.isNone(values[property])) {
                throw new Error("The painting of " + property + " is not implemented");
            }
        }
    }

    private fillText(glyphs: ReadonlyArray<PlacedGlyph>, style: ComputedStyle, pdf: PdfPage): boolean {
        // CSS Fill and Stroke 3 §3.3.1: the fill color is drawn when the final layer of fill-image is none, and §3.4.1:
        // fill-opacity is "the opacity of the painting operation used to fill".
        const values: Values = style.values;
        const opacity: number = this.opacity(values["fill-opacity"]);
        pdf.content.save();
        const filled: boolean = this.colors.fill(values["fill-color"], style, pdf, opacity);
        const colored: Set<PlacedGlyph> = new Set<PlacedGlyph>(filled ? glyphs.filter((placed: PlacedGlyph) => this.colorGlyphs.colored(placed.font, placed.glyph)) : []);
        // A font without outlines is written with no font program, so a viewer would fill its glyphs with another font's;
        // such a glyph that has no color image is only text.
        const plain: Array<PlacedGlyph> = filled ? glyphs.filter((placed: PlacedGlyph) => !colored.has(placed) && this.colorGlyphs.outlined(placed.font)) : [];
        if (plain.length > 0) {
            this.show(plain, pdf, FILL, false);
        }
        pdf.content.restore();
        // OpenType COLR: a color glyph is shown "prior to final presentation of glyphs" instead of its base glyph, which
        // stays as invisible text for its characters.
        const invisible: Array<PlacedGlyph> = filled ? glyphs.filter((placed: PlacedGlyph) => colored.has(placed) === this.colorGlyphs.outlined(placed.font)) : [];
        if (invisible.length > 0) {
            pdf.content.save();
            this.show(invisible, pdf, INVISIBLE, false);
            pdf.content.restore();
        }
        if (colored.size > 0) {
            this.colorGlyphs.paint([...colored], style, opacity, pdf);
        }
        return filled;
    }

    private strokeText(glyphs: ReadonlyArray<PlacedGlyph>, style: ComputedStyle, filled: boolean, pdf: PdfPage): void {
        // Text that no fill and no stroke shows as text is still written, invisible (ISO 32000-2 §9.3.6, mode 3), so that it
        // can be found and copied.
        let shown: boolean = filled;
        const outlined: Array<PlacedGlyph> = glyphs.filter((placed: PlacedGlyph) => this.colorGlyphs.outlined(placed.font));
        this.strokeLayers(style, "", pdf, (layer: number, width: number, color: CssValue, opacity: number): void => {
            if (outlined.length > 0 && this.outline(outlined, style, layer, width, color, opacity, shown, pdf)) {
                shown = true;
            }
        });
        // A stroke shows only the glyphs that have outlines, so without a fill the others stay text alone.
        const unshown: ReadonlyArray<PlacedGlyph> = !shown ? glyphs : (filled ? [] : glyphs.filter((placed: PlacedGlyph) => !this.colorGlyphs.outlined(placed.font)));
        if (unshown.length > 0) {
            // The text rendering mode is part of the graphics state, which outlives the text object.
            pdf.content.save();
            this.show(unshown, pdf, INVISIBLE, false);
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
        const stroke: StrokeStyle = this.strokeOf(style, "", layer, align === "center" ? width : 2 * width, align === "inset");
        if (align !== "inset" && this.drawable(stroke)) {
            // SVG 2 §11.9: the equivalent path of text has "one subpath per glyph" around its shape, and PDF strokes a glyph's
            // contours as they are, so a run with a glyph whose contours overlap is stroked as a path.
            const path: PathData | undefined = glyphs.some((placed: PlacedGlyph) => this.outlines.overlapping(placed.font, placed.glyph) !== undefined)
                ? this.glyphPaths(glyphs) : undefined;
            const draw: (target: PdfPage) => boolean = (target: PdfPage): boolean => {
                if (path === undefined) {
                    this.show(glyphs, target, STROKE, shown);
                    return true;
                }
                this.geometry.trace(path, target.content);
                target.content.stroke();
                return false;
            };
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
                const text: boolean = draw(form);
                pdf.content.graphicsState(pdf.useState(alpha, 1, "Normal"));
                pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, PathGeometry.IDENTITY)));
                return text;
            }
            if (!this.colors.stroke(color, style, pdf, opacity)) {
                return false;
            }
            this.pdfStroke(stroke, pdf);
            if (align === "outset") {
                this.exclude(glyphs, this.reach(stroke), pdf);
            }
            return draw(pdf);
        }
        const path: PathData | undefined = this.glyphPaths(glyphs);
        if (path === undefined) {
            return this.viewerStroke(glyphs, align, stroke, style, color, opacity, shown, pdf);
        }
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

    private viewerStroke(glyphs: ReadonlyArray<PlacedGlyph>, align: string, stroke: StrokeStyle, style: ComputedStyle, color: CssValue, opacity: number, shown: boolean,
        pdf: PdfPage): boolean {
        // A standard font has only metrics and its glyphs are the viewer's, so only the viewer can clip to them or stroke them.
        if (!this.colors.stroke(color, style, pdf, opacity)) {
            return false;
        }
        if (align === "inset") {
            this.show(glyphs, pdf, CLIP, true);
        } else if (align === "outset") {
            this.exclude(glyphs, this.reach(stroke), pdf);
        }
        const nearest: StrokeStyle = align === "inset" ? { width: stroke.width, cap: stroke.cap, extension: stroke.extension, shape: stroke.shape, limit: stroke.limit }
            : { width: stroke.width, cap: stroke.cap, extension: "miter", shape: "fallback", limit: stroke.limit };
        if (stroke.dashes !== undefined) {
            nearest.dashes = stroke.dashes;
        }
        this.pdfStroke(nearest, pdf);
        this.show(glyphs, pdf, STROKE, shown);
        return true;
    }

    private glyphPaths(glyphs: ReadonlyArray<PlacedGlyph>): PathData | undefined {
        const path: PathData = { verbs: [], points: [] };
        for (const placed of glyphs) {
            const outline: PathData | undefined = this.glyphPath(placed);
            if (outline === undefined) {
                return undefined;
            }
            path.verbs.push(...outline.verbs);
            path.points.push(...outline.points);
        }
        return path;
    }

    private glyphShapes(glyphs: ReadonlyArray<PlacedGlyph>): Array<PathData> | undefined {
        // Each glyph apart, since the outlines of two glyphs can wind in opposite senses where they overlap.
        const shapes: Array<PathData> = [];
        for (const placed of glyphs) {
            const outline: PathData | undefined = this.glyphPath(placed);
            if (outline === undefined) {
                return undefined;
            }
            if (outline.verbs.length > 0) {
                shapes.push(outline);
            }
        }
        return shapes;
    }

    private glyphPath(placed: PlacedGlyph): PathData | undefined {
        // A glyph's stroke follows the outline of its area, which differs from its contours where they overlap.
        const outline: PathData | undefined = this.outlines.overlapping(placed.font, placed.glyph) ?? this.outlines.path(placed.font, placed.glyph);
        if (outline === undefined) {
            return undefined;
        }
        const scale: number = placed.size / placed.font.metrics.unitsPerEm;
        const skew: number = Math.tan((placed.font.skew ?? 0) * Math.PI / 180);
        const points: Array<number> = [];
        for (let index: number = 0; index < outline.points.length; index += 2) {
            points.push(placed.x + (outline.points[index] + skew * outline.points[index + 1]) * scale, placed.y - outline.points[index + 1] * scale);
        }
        return { verbs: outline.verbs, points };
    }

    private strokeOf(style: ComputedStyle, prefix: string, layer: number, width: number, inset: boolean): StrokeStyle {
        // §4.2.4: an omitted extension is crop and an omitted limit shape fallback. §4.3.3: corner dashes and justification
        // change a dash pattern, so they count only with one.
        const keywords: ReadonlyArray<string> = this.keywords(this.paintValue(style, prefix, "stroke-linejoin"));
        const limit: CssValue | undefined = this.paintValue(style, prefix, "stroke-miterlimit");
        // §4.2.2: an inset stroke ignores stroke-linejoin; SVG Strokes, which §4.2.2 comes from, gives its area as the outline "offset
        // orthogonal from the outline into the fill area", which goes round a corner where the fill is on its outer side.
        const stroke: StrokeStyle = {
            width, cap: this.keywords(this.paintValue(style, prefix, "stroke-linecap"))[0] ?? "butt",
            extension: inset ? "crop" : keywords.find((keyword: string) => keyword === "crop" || keyword === "arcs" || keyword === "miter") ?? "crop",
            shape: inset ? "round" : keywords.find((keyword: string) => keyword === "bevel" || keyword === "round" || keyword === "fallback") ?? "fallback",
            limit: limit !== undefined && limit.kind === "number" ? limit.value : MITER_LIMIT
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
        this.document.applyMask(pdf, form, area, true);
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
                const skew: number = Math.tan((placed.font.skew ?? 0) * Math.PI / 180);
                left = Math.min(left, placed.x + (bounds.xMin + Math.min(skew * bounds.yMin, skew * bounds.yMax)) * scale);
                right = Math.max(right, placed.x + (bounds.xMax + Math.max(skew * bounds.yMin, skew * bounds.yMax)) * scale);
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

    private placed(text: InlineText, run: TextRun, piece: TextPiece, frame: Frame, origin: number): Array<PlacedGlyph> {
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
        let pen: number = origin;
        if (reversed && piece.hyphenated === true && run.hyphen !== undefined) {
            this.hyphen(run.hyphen, true, origin - run.hyphen.advance, frame, placed);
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
            natural += piece.extras?.[index] ?? 0;
            const used: number = piece.advances === undefined ? natural : piece.advances[index];
            let x: number = pen + (reversed ? after : before) + (piece.shifts?.[index] ?? 0);
            const content: string = this.clusterText(text, position, firsts, index, to - from);
            const count: number = firsts[index + 1] - firsts[index];
            const cluster: number | undefined = count > 1 && content.length > 0 ? this.clusters++ : undefined;
            for (let order: number = 0; order < count; order++) {
                const current: number = reversed ? firsts[index + 1] - 1 - order : firsts[index] + order;
                const location: readonly [number, number] = frame.at(x, current, text.xOffsets?.[current] ?? 0, text.yOffsets?.[current] ?? 0);
                const glyph: PlacedGlyph = {
                    x: location[0], y: location[1], glyph: text.glyphs[current], text: current === firsts[index] ? content : "", font: run.font, size: run.size
                };
                if (frame.alone) {
                    glyph.alone = true;
                }
                if (cluster !== undefined) {
                    glyph.cluster = cluster;
                    glyph.actual = content;
                }
                placed.push(glyph);
                x += text.advances[current];
            }
            pen += used;
        }
        if (!reversed && piece.hyphenated === true && run.hyphen !== undefined) {
            this.hyphen(run.hyphen, false, pen, frame, placed);
        }
        return placed;
    }

    private leader(text: InlineText, run: TextRun, piece: TextPiece, frame: Frame): Array<PlacedGlyph> {
        // CSS Content 3 §2.5.3: the leader string is drawn "starting from the end edge, repeating as many times as possible
        // until reaching the start edge", and a copy that does not fit whole is not shown.
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
            // Each copy of the leader string is text of its own, so its clusters are too.
            glyphs.push(...this.placed(text, run, piece, frame, reversed ? copyIndex * width : piece.inlineSize - (count - copyIndex) * width));
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

    private hyphen(hyphen: Hyphen, reversed: boolean, left: number, frame: Frame, placed: Array<PlacedGlyph>): void {
        // ISO 32000-2 §14.8.2.3: the hyphen of a divided word "may be represented as a soft hyphen", and the writer "shall
        // distinguish explicitly between soft and hard hyphens"; its glyphs also draw hard hyphens, so ActualText says it.
        let pen: number = left;
        const parts: ReadonlyArray<GlyphRun> = hyphen.parts;
        for (let step: number = 0; step < parts.length; step++) {
            const part: GlyphRun = parts[reversed ? parts.length - 1 - step : step];
            for (let order: number = 0; order < part.glyphs.length; order++) {
                const index: number = reversed ? part.glyphs.length - 1 - order : order;
                const location: readonly [number, number] = frame.at(pen, -1, part.xOffsets[index], part.yOffsets[index]);
                const glyph: PlacedGlyph = { x: location[0], y: location[1], glyph: part.glyphs[index], text: "", font: part.font, size: part.size, hyphen: true };
                if (frame.alone) {
                    glyph.alone = true;
                }
                placed.push(glyph);
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
        let marked: number | undefined;
        let face: FontInstance | undefined;
        let slant: number = 0;
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
            // §14.9.4: the glyphs of one cluster, such as the two S that stand for a ß, are the replacement text of the cluster
            // together, since a code gives one text and the later glyphs would give theirs again.
            const wanted: number | undefined = placed.hyphen === true ? HYPHEN_SPAN : (replica ? undefined : placed.cluster);
            if (wanted !== marked) {
                flush();
                if (marked !== undefined) {
                    pdf.content.endMarked();
                }
                if (wanted !== undefined) {
                    pdf.content.beginMarked(SPAN, "<< /ActualText " + this.syntax.textString(placed.hyphen === true ? SOFT_HYPHEN : placed.actual ?? "") + " >>");
                }
                marked = wanted;
            }
            if (placed.font !== face) {
                // CSS Fonts 4 §2.8: a synthesized oblique face is the glyphs sheared.
                face = placed.font;
                const skew: number = Math.tan((face.skew ?? 0) * Math.PI / 180);
                if (skew !== slant) {
                    flush();
                    slant = skew;
                    pen = Number.NaN;
                }
            }
            const font: PdfFont = this.fonts.font(placed.font, false);
            const shown: FontRun = font.show(placed.glyph, placed.text);
            if (placed.alone === true || Math.abs(placed.y - line) > TOLERANCE || Number.isNaN(pen)) {
                flush();
                pdf.content.textMatrix(1, 0, slant, -1, placed.x, placed.y);
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
        if (marked !== undefined) {
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
