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

import { TextNode, XMLElement } from "typesxml";
import type { CssValue } from "../css/values/CssValue.js";
import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { FontInstance } from "../fonts/Typeface.js";
import type { ImageAlpha, ImageFormats } from "../images/ImageFormats.js";
import type { PaletteRule } from "../paint/ColorGlyphPainter.js";
import { ColorGlyphPainter } from "../paint/ColorGlyphPainter.js";
import type { ColorOutput } from "../paint/ColorOutput.js";
import type { WrappingArea } from "../layout/BlockLayout.js";
import { BlockLayout } from "../layout/BlockLayout.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { LineFragment } from "../layout/Fragment.js";
import { InlineLayout } from "../layout/InlineLayout.js";
import type { Hyphen, InlineItem, InlineSequence, InlineText, TextRun, TextSequence } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { InlineTextBuilder } from "../pdf/InlineTextBuilder.js";
import type { DocumentFonts } from "../PdfGenerator.js";
import type { ContentStream } from "../writer/ContentStream.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { FontRun, PdfFont } from "../writer/PdfFont.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { Box, Matrix, SvgPath } from "./SvgGeometry.js";
import { SvgGeometry } from "./SvgGeometry.js";
import type { SvgPainter } from "./SvgPainter.js";
import type { SvgNode, SvgStyles } from "./SvgStyles.js";

const CONTENT: ReadonlySet<string> = new Set<string>(["tspan", "textPath", "a"]);
const LIST_SEPARATOR: RegExp = /[\t\n\f\r ,]+/;
const BASELINES: Readonly<Record<string, string>> = { "text-before-edge": "text-top", "text-after-edge": "text-bottom", auto: "alphabetic" };
const SUB_DROP: number = 1 / 5;
const SUPER_RISE: number = 1 / 3;
const LINE_FEED: number = 0x0A;
const RESET: RegExp = /^(?:margin-|padding-|border-.*-style$|float$|position$)/;
const ALIGNMENT: ReadonlySet<string> = new Set<string>(["text-align-all", "text-align-last", "text-justify"]);
const SHAPE_ELEMENTS: ReadonlySet<string> = new Set<string>(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const BASIC_SHAPES: ReadonlySet<string> = new Set<string>(["inset", "xywh", "rect", "circle", "ellipse", "polygon", "path", "shape"]);
const CLIP: number = 0;
const STROKE: number = 1;
const INVISIBLE: number = 3;

type Outline = readonly [Array<number>, Array<boolean>, boolean];

export class SvgText {

    private readonly document: PdfDocument;
    private readonly formats: ImageFormats;
    private readonly painter: SvgPainter;
    private readonly geometry: SvgGeometry = new SvgGeometry();
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private items: Array<InlineItem> = [];
    private owners: Array<SvgNode> = [];
    private paths: Array<SvgNode | undefined> = [];
    private ranges: Map<SvgNode, readonly [number, number]> = new Map<SvgNode, readonly [number, number]>();
    private children: Map<SvgNode, Array<SvgNode>> = new Map<SvgNode, Array<SvgNode>>();
    private nodeStyles: Map<SvgNode, ComputedStyle> = new Map<SvgNode, ComputedStyle>();
    private text?: InlineText;
    private owner: Array<SvgNode> = [];
    private runOf: Array<TextRun> = [];
    private firstGlyph: Int32Array = new Int32Array(0);
    private glyphCount: Int32Array = new Int32Array(0);
    private middle: Uint8Array = new Uint8Array(0);
    private forced: Uint8Array = new Uint8Array(0);
    private hidden: Uint8Array = new Uint8Array(0);
    private anchored: Uint8Array = new Uint8Array(0);
    private x: Float64Array = new Float64Array(0);
    private y: Float64Array = new Float64Array(0);
    private angle: Float64Array = new Float64Array(0);
    private advance: Float64Array = new Float64Array(0);
    private stretch: Float64Array = new Float64Array(0);
    private combined: Float64Array = new Float64Array(0);
    private dominant: number = 0;
    private inline: readonly [number, number] = [1, 0];
    private over: readonly [number, number] = [0, -1];
    private forward: number = 1;
    private turn: number = 0;
    private wrapped: boolean = false;
    private shaped: boolean = false;
    private hyphens: Map<number, readonly [Hyphen, number]> = new Map<number, readonly [Hyphen, number]>();
    private host?: BlockLayout;
    private wrapper?: InlineLayout;
    private wrapFonts?: DocumentFonts;
    private painting: boolean = false;
    private readonly colors: ColorOutput;
    private colorGlyphs?: ColorGlyphPainter;
    private colorFonts?: DocumentFonts;
    private colorRules?: ReadonlyArray<PaletteRule>;

    constructor(document: PdfDocument, formats: ImageFormats, colors: ColorOutput, painter: SvgPainter) {
        this.document = document;
        this.formats = formats;
        this.colors = colors;
        this.painter = painter;
    }

    private get metrics(): FontMetrics {
        return this.painter.styles.fonts()[0];
    }

    private get builder(): InlineTextBuilder {
        return this.painter.styles.fonts()[1];
    }

    paint(node: SvgNode, style: ComputedStyle, clipping: boolean): void {
        // A paint server, mask or clipping path of this text can hold text of its own, which must not take over this layout.
        if (this.painting) {
            this.fresh().paint(node, style, clipping);
            return;
        }
        this.painting = true;
        try {
            this.paintLaidOut(node, style, clipping);
        } finally {
            this.painting = false;
        }
    }

    private fresh(): SvgText {
        return new SvgText(this.document, this.formats, this.colors, this.painter);
    }

    private paintLaidOut(node: SvgNode, style: ComputedStyle, clipping: boolean): void {
        // SVG 2 §11.9: the characters in order, each with the fill, stroke and decorations of its element; in a clipping path
        // only their shapes count.
        if (this.painter.isCollecting() || !this.layout(node, style)) {
            return;
        }
        const count: number = this.owner.length;
        for (let from: number = 0, to: number = 0; from < count; from = to) {
            to = from + 1;
            while (to < count && this.owner[to] === this.owner[from]) {
                to++;
            }
            const ownerStyle: ComputedStyle = this.nodeStyles.get(this.owner[from]) as ComputedStyle;
            if (clipping) {
                this.glyphs(from, to, CLIP, false, false);
                continue;
            }
            if (this.painter.hidden(ownerStyle)) {
                continue;
            }
            this.decorate(from, to, node, style, false);
            // The characters of glyphs without outlines are written once, with the fill or, when there is none, with the stroke.
            const unfilled: boolean = this.keyword(ownerStyle.values["fill"]) === "none";
            for (const operation of this.painter.paintOrder(ownerStyle)) {
                const stroking: boolean = operation === "stroke";
                if (operation === "markers") {
                    continue;
                }
                this.painter.pdf.content.save();
                const opacity: number = this.painter.fraction(ownerStyle.values[operation + "-opacity"]);
                const painting: boolean = (!stroking || this.painter.strokeStyle(ownerStyle, undefined))
                    && this.painter.paintWith(ownerStyle.values[operation], opacity, stroking, node, style, undefined);
                const draw: () => void = (): void => {
                    if (stroking) {
                        this.painter.strokeStyle(ownerStyle, undefined);
                    }
                    this.glyphs(from, to, stroking ? 1 : 0, !stroking, !stroking || unfilled);
                };
                if (painting && !this.painter.masked(draw)) {
                    draw();
                }
                this.painter.pdf.content.restore();
                if (painting && !stroking) {
                    this.paintColored(from, to, this.painter.fraction(ownerStyle.values["fill-opacity"]));
                }
            }
            this.decorate(from, to, node, style, true);
        }
    }

    bbox(node: SvgNode, style: ComputedStyle, within?: XMLElement): Box | undefined {
        // SVG 2 §8.10: each glyph counts with its full cell, its advance by the ascent and descent of its font; with an element
        // given, only the characters of that element and of what it holds count.
        if (this.painting) {
            return this.fresh().bbox(node, style, within);
        }
        if (!this.layout(node, style)) {
            return undefined;
        }
        let box: Box | undefined;
        for (let index: number = 0; index < this.owner.length; index++) {
            if (this.middle[index] === 0 && this.hidden[index] === 0 && this.forced[index] === 0 && (within === undefined || this.holds(this.owner[index], within))) {
                // An upright glyph's cell is 1em across, centred on the central baseline.
                const run: TextRun = this.runOf[index];
                const [ascent, descent]: readonly [number, number] = this.metrics.fontExtent(run.font, run.size, this.upright(index));
                const central: number = this.upright(index) ? this.metrics.baseline((this.nodeStyles.get(this.owner[index]) as ComputedStyle).values, "central") : 0;
                const cell: Box = this.upright(index) ? [Math.min(0, this.advance[index]), -central - run.size / 2, Math.abs(this.advance[index]), run.size]
                    : [Math.min(0, this.advance[index]), -ascent, Math.abs(this.advance[index]), ascent + descent];
                box = this.geometry.union(box, this.geometry.transformBox(this.lineFrame(index), cell));
            }
        }
        return box;
    }

    private holds(owner: SvgNode, element: XMLElement): boolean {
        for (let current: SvgNode | undefined = owner; current !== undefined; current = current.parent) {
            if (current.element === element) {
                return true;
            }
        }
        return false;
    }

    private frame(index: number): Matrix {
        // CSS Inline 3 §4.1: a character's position is on the dominant baseline, and its glyphs are drawn from the alphabetic
        // one; CSS Writing Modes 4 §5.1: upright glyphs are centred on the central baseline, sideways ones turned.
        const frame: Matrix = this.geometry.concat(this.geometry.translation(this.x[index], this.y[index]), this.geometry.rotation(this.angle[index]));
        if (!this.upright(index)) {
            return this.geometry.concat(this.geometry.concat(frame, this.geometry.rotation(this.turn)), this.geometry.translation(0, this.dominant));
        }
        const centre: number = this.metrics.baseline((this.nodeStyles.get(this.owner[index]) as ComputedStyle).values, "central") - this.dominant;
        return this.geometry.concat(frame, this.geometry.translation(this.over[0] * centre, this.over[1] * centre));
    }

    private lineFrame(index: number): Matrix {
        // The frame of the line at a character, along the inline axis with the alphabetic baseline at zero, for decorations.
        const frame: Matrix = this.geometry.concat(this.geometry.translation(this.x[index], this.y[index]), this.geometry.rotation(this.angle[index]));
        return this.geometry.concat(this.geometry.concat(frame, this.geometry.rotation(this.turn)), this.geometry.translation(0, this.dominant));
    }

    private upright(index: number): boolean {
        const run: TextRun = this.runOf[index];
        return this.turn !== 0 && (run.upright || run.combined);
    }

    private along(index: number): number {
        return this.x[index] * this.inline[0] + this.y[index] * this.inline[1];
    }

    private move(index: number, distance: number): void {
        this.x[index] += this.inline[0] * distance;
        this.y[index] += this.inline[1] * distance;
    }

    private axes(mode: string): void {
        // CSS Writing Modes 4 §3.1 and §5.1: the inline direction, the line-over side and the way lines stack; sideways
        // glyphs turn a quarter clockwise, or anticlockwise in sideways-lr, whose lines run from bottom to top.
        this.inline = mode === "horizontal-tb" ? [1, 0] : (mode === "sideways-lr" ? [0, -1] : [0, 1]);
        this.over = mode === "horizontal-tb" ? [0, -1] : (mode === "sideways-lr" ? [-1, 0] : [1, 0]);
        this.forward = mode === "vertical-lr" ? -1 : 1;
        this.turn = mode === "horizontal-tb" ? 0 : (mode === "sideways-lr" ? -90 : 90);
    }

    private typographic(values: Readonly<Record<string, CssValue>>): boolean {
        // CSS Writing Modes 4 §5.1: the vertical typographic mode is a vertical writing mode not typeset sideways.
        const mode: string = this.keyword(values["writing-mode"]) ?? "horizontal-tb";
        return (mode === "vertical-rl" || mode === "vertical-lr") && (this.keyword(values["text-orientation"]) ?? "mixed") !== "sideways";
    }

    private layout(node: SvgNode, style: ComputedStyle): boolean {
        // SVG 2 §11.5: the text laid out on one line by CSS, then each character moved by the positioning attributes, by
        // textLength, by the anchoring of its chunk and by its text path.
        this.axes(this.keyword(style.values["writing-mode"]) ?? "horizontal-tb");
        // CSS Inline 3 §4.1: auto is central in the vertical typographic mode and alphabetic otherwise.
        const dominant: string = this.keyword(style.values["dominant-baseline"]) ?? "auto";
        this.dominant = this.metrics.baseline(style.values, dominant === "auto" && this.typographic(style.values) ? "central" : BASELINES[dominant] ?? dominant);
        const mirror: number = this.rightToLeft(style.values) ? -1 : 1;
        const shape: Outline | undefined = this.insideShape(style, [mirror * this.inline[0], -this.forward * this.over[0], mirror * this.inline[1],
            -this.forward * this.over[1], 0, 0]);
        this.shaped = shape !== undefined;
        this.items = [];
        this.owners = [];
        this.paths = [];
        this.ranges = new Map<SvgNode, readonly [number, number]>();
        this.children = new Map<SvgNode, Array<SvgNode>>();
        this.nodeStyles = new Map<SvgNode, ComputedStyle>();
        this.collect(node, style, undefined, [false]);
        this.trimEnd();
        if (this.items.length === 0) {
            return false;
        }
        const sequence: InlineSequence = { style: this.used(style), items: this.items };
        this.builder.prepare([sequence]);
        const text: InlineText = sequence.text as InlineText;
        this.text = text;
        const count: number = text.codepoints.length;
        if (count === 0) {
            return false;
        }
        this.characters(text, count);
        // SVG 2 §11.4.1: inline-size refers to the viewport's width, or its height for vertical text; zero wraps nothing.
        const inlineSize: CssValue | undefined = style.values["inline-size"];
        const wrap: number = inlineSize === undefined || this.keyword(inlineSize) === "auto" ? 0
            : this.painter.styles.pixels(inlineSize, this.turn === 0 ? this.painter.width : this.painter.height);
        this.wrapped = wrap > 0 || this.shaped;
        this.hyphens = new Map<number, readonly [Hyphen, number]>();
        if (this.wrapped) {
            this.wrap(sequence, text, count, wrap, style, shape);
        } else {
            this.cssPositions(text, count);
        }
        this.positioning(node, text, count);
        if (!this.wrapped) {
            this.textLength(node, text);
            this.anchoring(count);
        }
        this.textPaths(text, count);
        return true;
    }

    private wrap(sequence: InlineSequence, text: InlineText, count: number, size: number, style: ComputedStyle, shape?: Outline): void {
        // SVG 2 §11.4.1 and §11.7: CSS lays the text out in lines size long, with the first line's baseline through the
        // initial text position; §11.10.1.1: text-anchor puts the start, middle or end of each line on that position.
        const fonts: DocumentFonts = this.painter.styles.fonts();
        if (this.host === undefined || this.wrapper === undefined || this.wrapFonts !== fonts) {
            this.wrapFonts = fonts;
            this.host = new BlockLayout(fonts[0], fonts[1], this.formats);
            this.wrapper = new InlineLayout(fonts[0], new BoxSizes(() => undefined), fonts[1], this.host);
        }
        const wrapper: InlineLayout = this.wrapper;
        this.resetPositions(count);
        const rtl: boolean = this.rightToLeft(style.values);
        const anchor: string = this.keyword(style.values["text-anchor"]) ?? "start";
        const [lines, origin, top]: readonly [Array<LineFragment>, number, number] = shape === undefined ? [wrapper.layout(sequence, size, 0, 0, 0, []) ?? [], 0, 0]
            : this.inShape(sequence, shape, size, anchor, rtl);
        const first: number = lines.length === 0 || shape !== undefined ? -top : lines[0].block + lines[0].baseline;
        const along: Float64Array = new Float64Array(count);
        const under: Float64Array = new Float64Array(count);
        const placed: Uint8Array = new Uint8Array(count);
        for (const line of lines) {
            const characters: Array<number> = [];
            let near: number = Number.POSITIVE_INFINITY;
            let far: number = Number.NEGATIVE_INFINITY;
            for (const piece of line.pieces) {
                if (piece.kind !== "text") {
                    continue;
                }
                // TextPainter's order: a right-to-left run from its last character, with its hyphen before it.
                const run: TextRun = piece.run;
                const from: number = text.clusters[piece.from];
                const to: number = piece.to < run.glyphEnd ? text.clusters[piece.to] : run.end;
                const reversed: boolean = (run.level & 1) === 1;
                const start: number = (line.inline ?? 0) + piece.inline;
                const left: number = shape !== undefined ? (rtl ? -(origin + start + piece.inlineSize) : origin + start) : (rtl ? size - start - piece.inlineSize : start);
                const base: number = this.forward * (line.block + piece.baseline - first);
                let pen: number = left;
                for (let step: number = 0; step < to - from; step++) {
                    const position: number = reversed ? to - 1 - step : from + step;
                    const used: number = piece.advances === undefined ? (this.middle[position] === 1 ? 0 : this.advance[position]) : piece.advances[position - from];
                    along[position] = reversed ? pen + used : pen;
                    this.advance[position] = reversed ? -used : used;
                    under[position] = base;
                    placed[position] = 1;
                    characters.push(position);
                    pen += used;
                }
                near = Math.min(near, left);
                far = Math.max(far, pen);
                if (piece.hyphenated === true && run.hyphen !== undefined && to > from) {
                    const hyphen: number = reversed ? left - run.hyphen.advance : pen;
                    this.hyphens.set(to - 1, [run.hyphen, hyphen - along[to - 1]]);
                    near = Math.min(near, hyphen);
                    far = Math.max(far, hyphen + run.hyphen.advance);
                }
            }
            // §11.10.1.1: text-anchor does not apply to text in a shape.
            const shift: number = shape !== undefined ? 0 : (anchor === "middle" ? (near + far) / 2 : ((anchor === "end") !== rtl ? far : near));
            for (const position of characters) {
                along[position] -= shift;
            }
        }
        for (let index: number = 0; index < count; index++) {
            this.hidden[index] = placed[index] === 1 ? 0 : 1;
            this.x[index] = this.inline[0] * along[index] - this.over[0] * under[index];
            this.y[index] = this.inline[1] * along[index] - this.over[1] * under[index];
        }
        this.anchored[0] = 1;
    }

    private resetPositions(count: number): void {
        this.x = new Float64Array(count);
        this.y = new Float64Array(count);
        this.angle = new Float64Array(count);
        this.stretch = new Float64Array(count).fill(1);
        this.hidden = new Uint8Array(count);
        this.anchored = new Uint8Array(count);
    }

    private rightToLeft(values: Readonly<Record<string, CssValue>>): boolean {
        // CSS Writing Modes 4 §6.4: in vertical modes "a text-orientation value of upright forces the used direction to ltr".
        return this.keyword(values["direction"]) === "rtl" && !(this.typographic(values) && this.keyword(values["text-orientation"]) === "upright");
    }

    private inShape(sequence: InlineSequence, shape: Outline, size: number, anchor: string, rtl: boolean): readonly [Array<LineFragment>, number, number] {
        // CSS Shapes 2 §9.2: the shape takes from the content area, which inline-size bounds along the line from the initial
        // text position as text-anchor places it, and which is infinite otherwise; SVG 2 §11.7.1.1: lines start at its top.
        const [edges, rules, crossing]: Outline = shape;
        let start: number = Number.NEGATIVE_INFINITY;
        let end: number = Number.POSITIVE_INFINITY;
        if (size > 0) {
            const position: readonly [number, number] = this.initialPosition();
            start = (rtl ? -1 : 1) * (position[0] * this.inline[0] + position[1] * this.inline[1]) - (anchor === "middle" ? size / 2 : (anchor === "end" ? size : 0));
            end = start + size;
        }
        let low: number = Number.POSITIVE_INFINITY;
        let high: number = Number.NEGATIVE_INFINITY;
        let top: number = Number.POSITIVE_INFINITY;
        for (let index: number = 0; index < edges.length; index += BlockLayout.EDGE_FIELDS) {
            low = Math.min(low, edges[index], edges[index + 2]);
            high = Math.max(high, edges[index], edges[index + 2]);
            top = Math.min(top, edges[index + 1], edges[index + 3]);
        }
        low = Math.max(low, start);
        high = Math.min(high, end);
        if (!(high > low)) {
            return [[], 0, 0];
        }
        const shifted: Array<number> = edges.map((value: number, index: number) => {
            const field: number = index % BlockLayout.EDGE_FIELDS;
            return field === 4 ? value : value - (field % 2 === 0 ? low : top);
        });
        const host: BlockLayout = this.host as BlockLayout;
        const area: WrappingArea = { edges: shifted, rules, crossing, area: [start - low, Number.NEGATIVE_INFINITY, end - low, Number.POSITIVE_INFINITY] };
        host.wrapIn(area);
        try {
            return [(this.wrapper as InlineLayout).layout(sequence, high - low, 0, 0, 0, []) ?? [], low, top];
        } finally {
            host.wrapIn();
        }
    }

    private initialPosition(): readonly [number, number] {
        // SVG 2 §11.7: the x and y of the text element, or of the tspan that holds the first rendered character.
        const chain: Array<SvgNode> = [];
        for (let node: SvgNode | undefined = this.owner[0]; node !== undefined && this.nodeStyles.has(node); node = node.parent) {
            chain.unshift(node);
        }
        let position: readonly [number, number] = [0, 0];
        for (const node of chain) {
            const style: ComputedStyle = this.nodeStyles.get(node) as ComputedStyle;
            position = [this.lengths(node.element, "x", style, this.painter.width)[0] ?? position[0], this.lengths(node.element, "y", style, this.painter.height)[0] ?? position[1]];
        }
        return position;
    }

    private insideShape(style: ComputedStyle, matrix: Matrix): Outline | undefined {
        // CSS Shapes 2 §9.2 and CSS Round Display 1 §5.1: the shape that the text wraps in, in the axes of its layout; an SVG
        // element has no CSS box, so the box keywords and the percentages take the viewport, as view-box does.
        const value: CssValue | undefined = style.values["shape-inside"];
        const keyword: string | undefined = this.keyword(value);
        if (value === undefined || keyword === "auto") {
            return undefined;
        }
        const reference: Box = [0, 0, this.painter.width, this.painter.height];
        const whole: Outline = [this.tagged(this.geometry.edges(this.geometry.rectangle(0, 0, reference[2], reference[3], 0, 0), matrix, this.painter.tolerance()), 0),
            [false], false];
        if (keyword === "display") {
            // The display of a page is rectangular, and the viewport is all of it that the image has.
            return whole;
        }
        if (keyword !== "outside-shape") {
            return this.shapeFrom(value, style, reference, matrix);
        }
        // The shape of shape-outside, the box for none, grown by shape-margin, whose percentages refer to the inline size.
        const outside: CssValue | undefined = style.values["shape-outside"];
        const shape: Outline | undefined = outside === undefined || this.keyword(outside) === "none" ? whole : this.shapeFrom(outside, style, reference, matrix);
        const margin: CssValue | undefined = style.values["shape-margin"];
        const grown: number = margin === undefined ? 0 : this.painter.styles.pixels(margin, this.turn === 0 ? reference[2] : reference[3]);
        if (shape === undefined || grown <= 0) {
            return shape;
        }
        const plain: Array<number> = [];
        for (let index: number = 0; index < shape[0].length; index++) {
            if (index % BlockLayout.EDGE_FIELDS !== 4) {
                plain.push(shape[0][index]);
            }
        }
        return [[...shape[0], ...this.tagged(this.geometry.grown(plain, grown, this.painter.tolerance()), shape[1].length)], [...shape[1], false], true];
    }

    private shapeFrom(value: CssValue, style: ComputedStyle, reference: Box, matrix: Matrix): Outline | undefined {
        // A basic shape in the box, the box alone, or an image; a basic shape without area leaves no room.
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const image: CssValue | undefined = items.find((item: CssValue) => item.kind === "url" || (item.kind === "function" && !BASIC_SHAPES.has(item.name.toLowerCase())));
        if (image !== undefined) {
            return this.imageShape(image, style, reference, matrix);
        }
        const shape: CssValue | undefined = items.find((item: CssValue) => item.kind === "function");
        const outline: readonly [SvgPath, boolean] | undefined = shape === undefined ? [this.geometry.rectangle(reference[0], reference[1], reference[2], reference[3], 0, 0), false]
            : this.geometry.basicShape(shape, reference, this.keyword(style.values["direction"]) === "rtl");
        return outline === undefined ? [[], [false], false] : [this.tagged(this.geometry.edges(outline[0], matrix, this.painter.tolerance()), 0), [outline[1]], true];
    }

    private imageShape(image: CssValue, style: ComputedStyle, reference: Box, matrix: Matrix): Outline | undefined {
        // CSS Shapes 2 §9.2: a URL that names an SVG shape element gives its shape, with its transform as a text path takes
        // it, and one that names an image the shape of its alpha channel; anything else is as if auto had been given.
        const styles: SvgStyles = this.painter.styles;
        if (image.kind !== "url") {
            throw new Error("The shape-inside value " + (image.kind === "function" ? image.name + "()" : "") + " of a text element in the SVG image " + styles.url
                + " is not implemented");
        }
        const url: string = styles.resolve(image.href);
        if (url.includes("#")) {
            const target: readonly [XMLElement, SvgStyles] | undefined = this.painter.lookup(image.href);
            if (target === undefined || !target[1].isSvg(target[0]) || !SHAPE_ELEMENTS.has(target[1].localName(target[0]))) {
                return undefined;
            }
            const [shapeNode, shapeStyle]: readonly [SvgNode, ComputedStyle] = target[1].placed(target[0]);
            const path: SvgPath | undefined = this.painter.shapePath(shapeNode, shapeStyle, target[1]);
            if (path === undefined) {
                return [[], [false], false];
            }
            const tolerance: number = this.painter.tolerance();
            const placed: SvgPath = this.geometry.projectPath(path, this.painter.elementTransform(shapeNode, shapeStyle, target[1]), tolerance);
            return [this.tagged(this.geometry.edges(placed, matrix, tolerance), 0), [this.keyword(shapeStyle.values["fill-rule"]) === "evenodd"], true];
        }
        const alpha: ImageAlpha | undefined = this.formats.alpha(url);
        return alpha === undefined ? undefined : this.alphaShape(alpha, style, reference, matrix);
    }

    private alphaShape(image: ImageAlpha, style: ComputedStyle, reference: Box, matrix: Matrix): Outline | undefined {
        // CSS Shapes 1 §4: the shape encloses the pixels whose alpha is greater than shape-image-threshold, with the image
        // stretched over the box as a replaced element of that size is; an image without alpha is opaque.
        const value: CssValue | undefined = style.values["shape-image-threshold"];
        const threshold: number = value === undefined ? 0 : (value.kind === "percentage" ? value.value / 100 : (value.kind === "number" ? value.value : 0));
        const samples: Buffer | undefined = image.alpha;
        if (samples === undefined) {
            const whole: SvgPath = this.geometry.rectangle(reference[0], reference[1], reference[2], reference[3], 0, 0);
            return threshold < 1 ? [this.tagged(this.geometry.edges(whole, matrix, this.painter.tolerance()), 0), [false], false] : [[], [false], false];
        }
        const wide: boolean = image.bits === 16;
        const opacity: (index: number) => number = (index: number): number => wide ? samples.readUInt16BE(index * 2) / 65535 : samples[index] / 255;
        const scaleX: number = reference[2] / image.width;
        const scaleY: number = reference[3] / image.height;
        const corner: (x: number, y: number) => readonly [number, number] = (x: number, y: number): readonly [number, number] =>
            this.geometry.point(matrix, reference[0] + x * scaleX, reference[1] + y * scaleY);
        const edges: Array<number> = [];
        let open: Map<string, number> = new Map<string, number>();
        for (let row: number = 0; row <= image.height; row++) {
            // A run of pixels that goes on unchanged in the next row grows into one rectangle with it.
            const runs: Map<string, number> = new Map<string, number>();
            for (let column: number = 0; row < image.height && column < image.width; column++) {
                if (opacity(row * image.width + column) <= threshold) {
                    continue;
                }
                let end: number = column + 1;
                while (end < image.width && opacity(row * image.width + end) > threshold) {
                    end++;
                }
                const key: string = column + " " + end;
                runs.set(key, open.get(key) ?? row);
                column = end;
            }
            for (const [key, from] of open) {
                if (!runs.has(key)) {
                    const [left, right]: ReadonlyArray<number> = key.split(" ").map(Number);
                    const points: ReadonlyArray<readonly [number, number]> = [corner(left, from), corner(left, row), corner(right, row), corner(right, from)];
                    points.forEach((point: readonly [number, number], index: number) => {
                        const next: readonly [number, number] = points[(index + 1) % points.length];
                        edges.push(point[0], point[1], next[0], next[1], 0);
                    });
                }
            }
            open = runs;
        }
        return [edges, [false], false];
    }

    private tagged(edges: ReadonlyArray<number>, group: number): Array<number> {
        const result: Array<number> = [];
        for (let index: number = 0; index < edges.length; index += 4) {
            result.push(edges[index], edges[index + 1], edges[index + 2], edges[index + 3], group);
        }
        return result;
    }

    private collect(node: SvgNode, style: ComputedStyle, path: SvgNode | undefined, space: [boolean]): void {
        // SVG 2 §11.5: tspan, textPath and a are inline elements, and any other child of a text element is not rendered.
        const styles: SvgStyles = this.painter.styles;
        this.nodeStyles.set(node, style);
        const first: number = this.items.length;
        const kids: Array<SvgNode> = [];
        for (const child of node.element.getContent()) {
            if (child instanceof TextNode) {
                const text: string = this.whiteSpace(child.getValue(), style, space);
                if (text.length > 0) {
                    const sequence: TextSequence = { kind: "text", text, style: this.used(style) };
                    const language: string = styles.language(node);
                    if (language.length > 0) {
                        sequence.language = language;
                    }
                    this.items.push({ kind: "text", node: sequence });
                    this.owners.push(node);
                    this.paths.push(path);
                }
                continue;
            }
            if (!(child instanceof XMLElement) || !styles.isSvg(child) || !CONTENT.has(styles.localName(child)) || styles.attribute(child, "requiredExtensions") !== undefined
                || styles.attribute(child, "systemLanguage") !== undefined || (path !== undefined && styles.localName(child) === "textPath")) {
                continue;
            }
            const childNode: SvgNode = { element: child, parent: node };
            const childStyle: ComputedStyle = styles.style(childNode, style);
            if (this.keyword(childStyle.values["display"]) !== "none") {
                kids.push(childNode);
                this.collect(childNode, childStyle, styles.localName(child) === "textPath" ? childNode : path, space);
            }
        }
        this.children.set(node, kids);
        this.ranges.set(node, [first, this.items.length]);
    }

    private whiteSpace(text: string, style: ComputedStyle, space: [boolean]): string {
        // CSS Text 4 §4.1.1: collapsible spaces and segment breaks become one space, none at the start of the line, and a
        // preserved segment break is a forced line break; SVG 2 §11.10.3.2: xml:space="preserve" is preserve-spaces.
        const mode: string = this.keyword(style.values["white-space-collapse"]) ?? "collapse";
        let result: string = "";
        for (const character of text) {
            if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") {
                result += character;
                space[0] = false;
            } else if ((character === "\n" || character === "\r") && (mode === "preserve" || mode === "preserve-breaks" || mode === "break-spaces")) {
                // §4.1.1: with preserve-breaks, the collapsible spaces around a segment break are removed.
                if (mode === "preserve-breaks") {
                    result = result.endsWith(" ") ? result.substring(0, result.length - 1) : result;
                    this.trimPrevious(result);
                }
                result += "\n";
                space[0] = mode === "preserve-breaks";
            } else if (mode === "collapse" || mode === "preserve-breaks") {
                if (!space[0] && this.started(result)) {
                    result += " ";
                    space[0] = true;
                }
            } else if (mode !== "discard") {
                result += mode === "preserve-spaces" || character === "\n" || character === "\r" ? " " : character;
                space[0] = false;
            }
        }
        return result;
    }

    private used(style: ComputedStyle): ComputedStyle {
        // SVG 2 §11.5: border-style, float, margin, padding and position have their initial values, which layout reads from
        // absent ones; §11.10: so do text-align and text-justify unless a shape holds the text.
        const values: Record<string, CssValue> = {};
        for (const name in style.values) {
            if (!RESET.test(name) && (this.shaped || !ALIGNMENT.has(name))) {
                values[name] = style.values[name];
            }
        }
        return { ...style, values };
    }

    private started(pending: string): boolean {
        return pending.length > 0 || this.items.length > 0;
    }

    private trimPrevious(pending: string): void {
        // A collapsible space that ends the text of an earlier element also comes before the segment break.
        const last: InlineItem | undefined = this.items[this.items.length - 1];
        if (pending.length > 0 || last === undefined) {
            return;
        }
        const sequence: TextSequence = last.node as TextSequence;
        const mode: string = this.keyword(sequence.style.values["white-space-collapse"]) ?? "collapse";
        if ((mode === "collapse" || mode === "preserve-breaks") && sequence.text.endsWith(" ")) {
            sequence.text = sequence.text.substring(0, sequence.text.length - 1);
        }
    }

    private trimEnd(): void {
        // CSS Text 4 §4.1.2: a collapsible space at the end of the line is removed.
        while (this.items.length > 0) {
            const last: TextSequence = this.items[this.items.length - 1].node as TextSequence;
            const mode: string = this.keyword(last.style.values["white-space-collapse"]) ?? "collapse";
            if ((mode !== "collapse" && mode !== "preserve-breaks") || !last.text.endsWith(" ")) {
                return;
            }
            last.text = last.text.substring(0, last.text.length - 1);
            if (last.text.length > 0) {
                return;
            }
            this.items.pop();
            this.owners.pop();
            this.paths.pop();
        }
    }

    private characters(text: InlineText, count: number): void {
        // SVG 2 §11.5: a character without glyphs of its own is part of the typographic character before it.
        this.owner = new Array<SvgNode>(count);
        this.runOf = new Array<TextRun>(count);
        for (let index: number = 0, item: number = 0; index < count; index++) {
            while (text.starts[item + 1] <= index) {
                item++;
            }
            this.owner[index] = this.owners[item];
        }
        for (const run of text.runs) {
            this.runOf.fill(run, run.start, run.end);
        }
        this.firstGlyph = new Int32Array(count).fill(-1);
        this.glyphCount = new Int32Array(count);
        for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
            const cluster: number = text.clusters[glyph];
            this.firstGlyph[cluster] = this.firstGlyph[cluster] < 0 ? glyph : this.firstGlyph[cluster];
            this.glyphCount[cluster]++;
        }
        this.middle = new Uint8Array(count);
        this.advance = new Float64Array(count);
        this.forced = new Uint8Array(count);
        let owner: number = 0;
        for (let index: number = 0; index < count; index++) {
            this.forced[index] = text.codepoints[index] === LINE_FEED ? 1 : 0;
            this.middle[index] = index > 0 && this.glyphCount[index] === 0 && this.forced[index] === 0 ? 1 : 0;
            owner = this.middle[index] === 1 ? owner : index;
            if (this.forced[index] === 0) {
                this.advance[owner] += text.spacingBefore[index] + text.spacingAfter[index];
                for (let glyph: number = 0; glyph < this.glyphCount[index]; glyph++) {
                    this.advance[owner] += text.advances[this.firstGlyph[index] + glyph];
                }
            }
            this.runOf[index] = this.runOf[index] ?? this.runOf[Math.max(0, index - 1)] ?? text.runs[0];
        }
        // CSS Writing Modes 4 §9.1: combined text is one upright character 1em long, its glyphs side by side within it.
        this.combined = new Float64Array(count);
        for (const combination of text.combinations) {
            if (combination.start < count) {
                this.combined[combination.start] = combination.scale;
                this.advance[combination.start] = this.runOf[combination.start].size;
                for (let index: number = combination.start + 1; index < Math.min(count, combination.end); index++) {
                    this.middle[index] = 1;
                    this.advance[index] = 0;
                }
            }
        }
    }

    private cssPositions(text: InlineText, count: number): void {
        // SVG 2 §11.6.1: each forced line break starts a line box, and §11.5 places a right-to-left character by its start
        // edge with a negative advance; UAX #9 L1 and L2 reorder each line on its own.
        this.resetPositions(count);
        const along: Float64Array = new Float64Array(count);
        let baseline: number = 0;
        let previous: readonly [number, number] = [0, 0];
        for (let start: number = 0, end: number = 0; start < count; start = end) {
            end = start;
            while (end < count && this.forced[end] === 0) {
                end++;
            }
            end = Math.min(count, end + 1);
            const levels: Uint8Array = this.builder.lineLevels(text, start, end);
            let pen: number = 0;
            for (const index of this.visualOrder(levels, start)) {
                if (this.middle[index] === 1) {
                    continue;
                }
                const reversed: boolean = (levels[index - start] & 1) === 1;
                along[index] = reversed ? pen + this.advance[index] : pen;
                pen += this.advance[index];
                this.advance[index] = reversed ? -this.advance[index] : this.advance[index];
            }
            // CSS 2 §10.8.1: the next line's baseline is past the line before it, on the side towards which the lines stack.
            const extent: readonly [number, number] = this.lineExtent(start, end);
            if (start > 0) {
                baseline += this.forward > 0 ? previous[1] - extent[0] : previous[0] - extent[1];
            }
            previous = extent;
            this.anchored[start] = 1;
            for (let index: number = start; index < end; index++) {
                along[index] = this.middle[index] === 1 ? along[index - 1] : along[index];
                const under: number = baseline + this.baselineShift(this.owner[index]);
                this.x[index] = this.inline[0] * along[index] - this.over[0] * under;
                this.y[index] = this.inline[1] * along[index] - this.over[1] * under;
            }
        }
    }

    private visualOrder(levels: Uint8Array, start: number): Array<number> {
        // UAX #9 L2: from the highest level down to the lowest odd one, each sequence at that level or above is reversed.
        const order: Array<number> = Array.from(levels.keys(), (index: number) => start + index);
        const highest: number = Math.max(0, ...levels);
        const lowest: number = Math.min(...levels);
        for (let level: number = highest; level >= (lowest % 2 === 1 ? lowest : lowest + 1) && level >= 1; level--) {
            for (let first: number = 0; first < order.length; first++) {
                if (levels[order[first] - start] >= level) {
                    let last: number = first;
                    while (last + 1 < order.length && levels[order[last + 1] - start] >= level) {
                        last++;
                    }
                    order.splice(first, last - first + 1, ...order.slice(first, last + 1).reverse());
                    first = last;
                }
            }
        }
        return order;
    }

    private lineExtent(start: number, end: number): readonly [number, number] {
        // CSS 2 §10.8.1: each inline box on the line, the text's strut included, spans its ascent and descent, centred on the
        // central baseline in the vertical typographic mode, with half the leading on each side; the line box spans them all.
        let top: number = 0;
        let bottom: number = 0;
        const seen: Set<SvgNode> = new Set<SvgNode>();
        for (let index: number = start; index < end; index++) {
            for (let node: SvgNode | undefined = this.owner[index]; node !== undefined && this.nodeStyles.has(node) && !seen.has(node); node = node.parent) {
                seen.add(node);
                const values: Readonly<Record<string, CssValue>> = (this.nodeStyles.get(node) as ComputedStyle).values;
                const ascent: number = this.metrics.ascent(values);
                const descent: number = this.metrics.descent(values);
                const half: number = (this.metrics.lineHeight(values) - ascent - descent) / 2;
                const centred: boolean = this.typographic(values);
                const middle: number = centred ? (ascent + descent) / 2 : 0;
                const reference: number = this.baselineShift(node) + this.dominant - (centred ? this.metrics.baseline(values, "central") : 0);
                top = Math.min(top, reference - (centred ? middle : ascent) - half);
                bottom = Math.max(bottom, reference + (centred ? middle : descent) + half);
            }
        }
        return [top, bottom];
    }

    private baselineShift(node: SvgNode): number {
        // CSS Inline 3 §4.2.2: each inline box is shifted by its baseline-shift, where sub and super drop a fifth and raise a
        // third of the parent's font size.
        let shift: number = 0;
        for (let current: SvgNode | undefined = node; current !== undefined && this.nodeStyles.has(current); current = current.parent) {
            const style: ComputedStyle = this.nodeStyles.get(current) as ComputedStyle;
            const parent: ComputedStyle | undefined = current.parent === undefined ? undefined : this.nodeStyles.get(current.parent);
            const value: CssValue | undefined = style.values["baseline-shift"];
            const keyword: string | undefined = this.keyword(value);
            if (keyword === "sub" || keyword === "super") {
                const size: number = this.metrics.fontSize((parent ?? style).values);
                shift += keyword === "sub" ? size * SUB_DROP : -size * SUPER_RISE;
            } else if (value !== undefined && keyword === undefined) {
                shift -= this.painter.styles.pixels(value, this.metrics.lineHeight(style.values));
            }
        }
        return shift;
    }

    private positioning(root: SvgNode, text: InlineText, count: number): void {
        // SVG 2 §11.5 and §11.1.1: a node's lists, indexed by code points, apply to its descendants unless theirs override them;
        // dx and dy accumulate, then x and y place their character and move those after it with it.
        const resolvedX: Array<number | undefined> = new Array<number | undefined>(count).fill(undefined);
        const resolvedY: Array<number | undefined> = new Array<number | undefined>(count).fill(undefined);
        const dx: Float64Array = new Float64Array(count);
        const dy: Float64Array = new Float64Array(count);
        const horizontal: boolean = this.turn === 0;
        // §11.5: "A textPath element always creates an anchored chunk", and a line start does so "chunks" do "not span multiple lines".
        const starts: Uint8Array = this.anchored.slice();
        const styles: SvgStyles = this.painter.styles;
        const visit: (node: SvgNode, inPath: boolean) => void = (node: SvgNode, inPath: boolean): void => {
            const name: string = styles.localName(node.element);
            const [from, to]: readonly [number, number] = this.characterRange(node, text);
            if (name === "textPath" && from < count) {
                starts[from] = 1;
                this.anchored[from] = 1;
            } else if (name === "text" || name === "tspan") {
                const style: ComputedStyle = this.nodeStyles.get(node) as ComputedStyle;
                const xs: Array<number> = this.lengths(node.element, "x", style, this.painter.width);
                const ys: Array<number> = this.lengths(node.element, "y", style, this.painter.height);
                const dxs: Array<number> = this.lengths(node.element, "dx", style, this.painter.width);
                const dys: Array<number> = this.lengths(node.element, "dy", style, this.painter.height);
                const rotations: Array<number> = this.geometry.numbers(styles.attribute(node.element, "rotate") ?? "");
                const chunks: number = !inPath ? Math.max(xs.length, ys.length) : (horizontal ? xs.length : ys.length);
                for (let index: number = from; index < to; index++) {
                    const position: number = index - from;
                    this.anchored[index] = position < chunks ? 1 : starts[index];
                    resolvedX[index] = inPath && !horizontal ? undefined : (position < xs.length ? xs[position] : resolvedX[index]);
                    resolvedY[index] = inPath && horizontal ? undefined : (position < ys.length ? ys[position] : resolvedY[index]);
                    dx[index] = position < dxs.length ? dxs[position] : dx[index];
                    dy[index] = position < dys.length ? dys[position] : dy[index];
                    if (position < rotations.length) {
                        this.angle[index] = rotations[position];
                    } else if (rotations.length > 0 && index > 0) {
                        this.angle[index] = this.angle[index - 1];
                    }
                }
            }
            for (const child of this.children.get(node) ?? []) {
                visit(child, inPath || styles.localName(child.element) === "textPath");
            }
        };
        visit(root, false);
        this.anchored[0] = 1;
        if (this.wrapped) {
            // SVG 2 §11.5: wrapped text has "no further post-processing"; §11.7: only the first character's x and y count, as
            // the initial text position, and in text that a shape places none do.
            this.angle.fill(0);
            for (let index: number = 0; !this.shaped && index < count; index++) {
                this.x[index] += resolvedX[0] ?? 0;
                this.y[index] += resolvedY[0] ?? 0;
            }
            return;
        }
        // §11.2: the first glyph starts at the initial current text position even without x or y, while CSS lays a right-to-left
        // line out from its far end; §11.5's windows on a closed path count from that position.
        const startX: number = horizontal ? this.x[0] : 0;
        const startY: number = horizontal ? 0 : this.y[0];
        let shiftX: number = 0;
        let shiftY: number = 0;
        for (let index: number = 0; index < count; index++) {
            shiftX += dx[index];
            shiftY += dy[index];
            this.x[index] += shiftX - startX;
            this.y[index] += shiftY - startY;
        }
        shiftX = 0;
        shiftY = 0;
        for (let index: number = 0; index < count; index++) {
            const setX: number | undefined = resolvedX[index];
            const setY: number | undefined = resolvedY[index];
            shiftX = setX === undefined ? shiftX : setX - this.x[index];
            shiftY = setY === undefined ? shiftY : setY - this.y[index];
            this.x[index] += shiftX;
            this.y[index] += shiftY;
            if (this.middle[index] === 1 && this.anchored[index] === 1) {
                this.anchored[index] = 0;
                if (index + 1 < count) {
                    this.anchored[index + 1] = 1;
                }
            }
        }
    }

    private lengths(element: XMLElement, attribute: string, style: ComputedStyle, basis: number): Array<number> {
        // SVG 2 §11.2.1: a list of lengths, percentages and numbers; an invalid list is as if it were not there.
        const value: string = (this.painter.styles.attribute(element, attribute) ?? "").trim();
        const result: Array<number> = [];
        for (const part of value.length === 0 ? [] : value.split(LIST_SEPARATOR)) {
            const length: number | undefined = this.painter.styles.length(part, style, basis);
            if (length === undefined) {
                return [];
            }
            result.push(length);
        }
        return result;
    }

    private characterRange(node: SvgNode, text: InlineText): readonly [number, number] {
        const items: readonly [number, number] | undefined = this.ranges.get(node);
        return items === undefined ? [0, 0] : [text.starts[items[0]], text.starts[items[1]]];
    }

    private textLength(node: SvgNode, text: InlineText): boolean {
        // SVG 2 §11.5, "Apply textLength": children first; spacing moves each character by an equal share, a descendant with
        // its own textLength as one, and spacingAndGlyphs stretches the glyphs too.
        const resolved: Array<readonly [number, number]> = [];
        for (const child of this.children.get(node) ?? []) {
            if (this.textLength(child, text)) {
                resolved.push(this.characterRange(child, text));
            }
        }
        const styles: SvgStyles = this.painter.styles;
        const name: string = styles.localName(node.element);
        const value: string | undefined = styles.attribute(node.element, "textLength");
        const style: ComputedStyle = this.nodeStyles.get(node) as ComputedStyle;
        const length: number | undefined = value === undefined || (name !== "text" && name !== "tspan") ? undefined : styles.length(value, style, this.painter.width);
        if (length === undefined || length < 0) {
            return false;
        }
        const [from, to]: readonly [number, number] = this.characterRange(node, text);
        if (this.forced.subarray(from, to).includes(1)) {
            return false;
        }
        let low: number = Number.POSITIVE_INFINITY;
        let high: number = Number.NEGATIVE_INFINITY;
        let characters: number = 0;
        for (let index: number = from; index < to; index++) {
            if (this.middle[index] === 0) {
                low = Math.min(low, this.along(index), this.along(index) + this.advance[index]);
                high = Math.max(high, this.along(index), this.along(index) + this.advance[index]);
                const inside: readonly [number, number] | undefined = resolved.find((range: readonly [number, number]) => index >= range[0] && index < range[1]);
                characters += inside === undefined || inside[0] === index ? 1 : 0;
            }
        }
        if (low === Number.POSITIVE_INFINITY || high <= low) {
            return true;
        }
        if (styles.attribute(node.element, "lengthAdjust") === "spacingAndGlyphs") {
            const scale: number = length / (high - low);
            for (let index: number = from; index < to; index++) {
                this.move(index, (this.along(index) - low) * (scale - 1));
                this.advance[index] *= scale;
                this.stretch[index] *= scale;
            }
            return true;
        }
        const step: number = characters > 1 ? (length - (high - low)) / (characters - 1) : 0;
        const direction: number = this.keyword(style.values["direction"]) === "rtl" ? -1 : 1;
        let shift: number = 0;
        let started: boolean = false;
        for (let index: number = from; index < to; index++) {
            const inside: readonly [number, number] | undefined = resolved.find((range: readonly [number, number]) => index >= range[0] && index < range[1]);
            if (this.middle[index] === 0 && (inside === undefined || inside[0] === index)) {
                shift += started ? step : 0;
                started = true;
            }
            this.move(index, direction * shift);
        }
        return true;
    }

    private anchoring(count: number): void {
        // SVG 2 §11.5, "Apply anchoring": each anchored chunk moves so that its start, middle or end falls on its position,
        // following text-anchor and the direction of the element of its first character.
        for (let start: number = 0, end: number = 0; start < count; start = end + 1) {
            end = start;
            while (end + 1 < count && this.anchored[end + 1] === 0) {
                end++;
            }
            let low: number = Number.POSITIVE_INFINITY;
            let high: number = Number.NEGATIVE_INFINITY;
            for (let index: number = start; index <= end; index++) {
                if (this.middle[index] === 0) {
                    low = Math.min(low, this.along(index), this.along(index) + this.advance[index]);
                    high = Math.max(high, this.along(index), this.along(index) + this.advance[index]);
                }
            }
            if (low === Number.POSITIVE_INFINITY) {
                continue;
            }
            const style: ComputedStyle = this.nodeStyles.get(this.owner[start]) as ComputedStyle;
            const anchor: string = this.keyword(style.values["text-anchor"]) ?? "start";
            const rtl: boolean = this.keyword(style.values["direction"]) === "rtl";
            const shift: number = this.along(start) - (anchor === "middle" ? (low + high) / 2 : ((anchor === "start") !== rtl ? low : high));
            for (let index: number = start; index <= end; index++) {
                this.move(index, shift);
            }
        }
    }

    private textPaths(text: InlineText, count: number): void {
        // SVG 2 §11.5, "Position on path": each character's middle goes to its distance along the path, turned with it, hidden
        // past the ends of an open path or one circuit of a closed one; the text after a textPath continues from its end.
        let pathNode: SvgNode | undefined;
        let path: SvgPath | undefined;
        let length: number = 0;
        let offset: number = 0;
        let closed: boolean = false;
        let after: boolean = false;
        let endShift: readonly [number, number] = [0, 0];
        const tolerance: number = this.painter.tolerance();
        for (let index: number = 0, item: number = 0; index < count; index++) {
            while (text.starts[item + 1] <= index) {
                item++;
            }
            const current: SvgNode | undefined = this.paths[item];
            if (current === undefined) {
                if (pathNode !== undefined) {
                    const end: readonly [number, number, number] | undefined = path === undefined ? undefined : this.geometry.along(path, length, tolerance);
                    endShift = end === undefined ? [0, 0] : [end[0] - this.x[index], end[1] - this.y[index]];
                    after = true;
                    pathNode = undefined;
                }
                after = after && this.anchored[index] === 0;
                if (after) {
                    this.x[index] += endShift[0];
                    this.y[index] += endShift[1];
                }
                continue;
            }
            if (current !== pathNode) {
                pathNode = current;
                [path, offset] = this.pathOf(current);
                length = path === undefined ? 0 : this.geometry.length(path, tolerance);
                closed = path !== undefined && this.geometry.closed(path);
            }
            if (this.middle[index] === 1) {
                this.x[index] = this.x[index - 1];
                this.y[index] = this.y[index - 1];
                this.angle[index] = this.angle[index - 1];
                this.hidden[index] = this.hidden[index - 1];
                continue;
            }
            const distance: number = this.along(index) + this.advance[index] / 2;
            let middle: number = distance + offset;
            let outside: boolean = middle < 0 || middle > length;
            if (closed && length > 0) {
                // §11.5: "the special wrapping criteria for single closed subpaths".
                const values: Readonly<Record<string, CssValue>> = (this.nodeStyles.get(this.owner[index]) as ComputedStyle).values;
                const anchor: string = this.keyword(values["text-anchor"]) ?? "start";
                const low: number = anchor === "middle" ? -length / 2 : ((anchor === "start") !== (this.keyword(values["direction"]) === "rtl") ? 0 : -length);
                outside = distance < low || distance > low + length || !Number.isFinite(middle);
                middle = ((middle % length) + length) % length;
            }
            const point: readonly [number, number, number] | undefined = path === undefined || outside ? undefined : this.geometry.along(path, middle, tolerance);
            if (point === undefined) {
                this.hidden[index] = 1;
                continue;
            }
            // The distance under the line goes along the path's normal, which turns from its tangent as under from inline.
            const tangent: readonly [number, number] = [Math.cos(point[2]), Math.sin(point[2])];
            const centre: number = this.advance[index] / 2;
            const under: number = -(this.x[index] * this.over[0] + this.y[index] * this.over[1]);
            this.x[index] = point[0] - centre * tangent[0] - under * tangent[1];
            this.y[index] = point[1] - centre * tangent[1] + under * tangent[0];
            this.angle[index] += (point[2] - Math.atan2(this.inline[1], this.inline[0])) * 180 / Math.PI;
        }
    }

    private pathOf(node: SvgNode): readonly [SvgPath | undefined, number] {
        // SVG 2 §11.8.2: the path attribute, or the shape that href names with its transform; startOffset is a percentage of
        // the length of the path or a length along it, scaled by the path-length of the shape.
        const styles: SvgStyles = this.painter.styles;
        const style: ComputedStyle = this.nodeStyles.get(node) as ComputedStyle;
        const tolerance: number = this.painter.tolerance();
        let path: SvgPath | undefined;
        let authored: number | undefined;
        const data: string | undefined = styles.attribute(node.element, "path");
        const target: readonly [XMLElement, SvgStyles] | undefined = data === undefined ? this.painter.target(node.element) : undefined;
        if (data !== undefined) {
            path = this.geometry.parse(data);
        } else if (target !== undefined) {
            const [targetNode, targetStyle]: readonly [SvgNode, ComputedStyle] = target[1].placed(target[0]);
            const shape: SvgPath | undefined = this.painter.shapePath(targetNode, targetStyle, target[1]);
            path = shape === undefined ? undefined : this.geometry.projectPath(shape, this.painter.elementTransform(targetNode, targetStyle, target[1]), tolerance);
            const pathLength: CssValue | undefined = targetStyle.values["path-length"];
            authored = pathLength === undefined || this.keyword(pathLength) === "none" ? undefined : target[1].pixels(pathLength, 0);
        }
        if (path !== undefined && styles.attribute(node.element, "side") === "right") {
            path = this.geometry.reverse(path);
        }
        const value: string = (styles.attribute(node.element, "startOffset") ?? "0").trim();
        const total: number = path === undefined ? 0 : this.geometry.length(path, tolerance);
        const given: number = styles.length(value, style, this.painter.width) ?? 0;
        // §9.6.1: a path length of zero scales by infinity, and "a value of zero scaled infinitely must remain zero"; a
        // negative one is an error and scales nothing.
        const scaled: number = authored === undefined || authored < 0 ? given : (authored > 0 ? given * total / authored : (given === 0 ? 0 : given * Number.POSITIVE_INFINITY));
        const offset: number = value.endsWith("%") ? total * Number(value.substring(0, value.length - 1)) / 100 : scaled;
        return [path, Number.isNaN(offset) ? 0 : offset];
    }

    private glyphs(from: number, to: number, mode: number, filling: boolean, asText: boolean): void {
        // ISO 32000-2 §9.4.2 and §9.3.6: each glyph placed by its own text matrix in a user space whose y goes down, filled
        // with mode 0, stroked with mode 1, and a color glyph's outline written invisible with mode 3 for its characters.
        const content: ContentStream = this.painter.pdf.content;
        const colors: ColorGlyphPainter = this.colorPainter();
        content.beginText();
        content.textRenderingMode(mode);
        let shown: string = "";
        let size: number = 0;
        let current: number = mode;
        const stroked: boolean = mode === STROKE && this.painter.isProjected();
        this.placements(from, to, (instance: FontInstance, glyph: number, glyphSize: number, matrix: Matrix, characters: string, style: ComputedStyle): void => {
            // A font without outlines is written with no font program, so its glyphs are only text, and its color glyphs carry
            // their characters themselves.
            const outlined: boolean = colors.outlined(instance);
            const colored: boolean = filling && colors.colored(instance, glyph);
            if (!outlined && (colored || !asText)) {
                return;
            }
            const target: number = colored || !outlined ? INVISIBLE : mode;
            if (target !== current) {
                content.textRenderingMode(target);
                current = target;
            }
            const font: PdfFont = this.document.fonts.font(instance, false);
            font.use(glyph, characters);
            const [resource, codes]: FontRun = font.show([glyph], 0, 1)[0];
            if (resource.key !== shown || glyphSize !== size) {
                content.font(this.painter.pdf.useFont(resource), glyphSize);
                shown = resource.key;
                size = glyphSize;
            }
            const placed: readonly [Matrix, number] | undefined = this.painter.placed(matrix);
            if (placed === undefined) {
                return;
            }
            if (stroked) {
                this.painter.scaledStroke(style, placed[1]);
            }
            content.textMatrix(placed[0][0], placed[0][1], placed[0][2], placed[0][3], placed[0][4], placed[0][5]);
            content.showText(codes);
        });
        content.endText();
    }

    private paintColored(from: number, to: number, opacity: number): void {
        // OpenType COLR, SVG, sbix and CBDT: a color glyph is drawn instead of its outline, with the palette of font-palette and
        // the color of the color property; its text space has y going up, and ColorGlyphPainter draws with y going down.
        const colors: ColorGlyphPainter = this.colorPainter();
        const pdf: PdfPage = this.painter.pdf;
        this.placements(from, to, (instance: FontInstance, glyph: number, size: number, matrix: Matrix, characters: string, style: ComputedStyle): void => {
            if (!colors.colored(instance, glyph)) {
                return;
            }
            const placed: readonly [Matrix, number] | undefined = this.painter.placed(matrix);
            if (placed === undefined) {
                return;
            }
            const space: Matrix = placed[0];
            pdf.content.save();
            pdf.content.transform(space[0], space[1], -space[2], -space[3], space[4], space[5]);
            colors.paint([{ x: 0, y: 0, glyph, text: characters, font: instance, size }], style, opacity, pdf, true);
            pdf.content.restore();
        });
    }

    private colorPainter(): ColorGlyphPainter {
        // The fonts and the palettes are the image's, and a painter keeps the palettes it resolves for its fonts.
        const styles: SvgStyles = this.painter.styles;
        const fonts: DocumentFonts = styles.fonts();
        const palettes: ReadonlyArray<PaletteRule> = styles.palettes();
        if (this.colorGlyphs === undefined || this.colorFonts !== fonts || this.colorRules !== palettes) {
            this.colorGlyphs = new ColorGlyphPainter(this.document, this.colors, fonts[0], palettes, this.formats);
            this.colorFonts = fonts;
            this.colorRules = palettes;
        }
        return this.colorGlyphs;
    }

    ink(node: SvgNode, style: ComputedStyle): Box | undefined {
        // The area that the glyphs and the decorations paint: the bounding box of each glyph's outline, which can reach out
        // of its cell, scaled from font units to the font size.
        if (this.painting) {
            return this.fresh().ink(node, style);
        }
        if (!this.layout(node, style)) {
            return undefined;
        }
        let box: Box | undefined;
        this.placements(0, this.owner.length, (instance: FontInstance, glyph: number, size: number, matrix: Matrix): void => {
            const bounds: OutlineBounds | undefined = this.outlines.bounds(instance, glyph);
            if (bounds !== undefined) {
                const scale: number = size / instance.metrics.unitsPerEm;
                box = this.geometry.union(box, this.geometry.transformBox(matrix, [bounds.xMin * scale, bounds.yMin * scale,
                    (bounds.xMax - bounds.xMin) * scale, (bounds.yMax - bounds.yMin) * scale]));
            }
        });
        for (const through of [false, true]) {
            for (const [, path] of this.decorations(0, this.owner.length, through)) {
                box = this.geometry.union(box, this.geometry.bounds(path, SvgGeometry.IDENTITY));
            }
        }
        return box;
    }

    private placements(from: number, to: number, visit: (instance: FontInstance, glyph: number, size: number, matrix: Matrix, characters: string, style: ComputedStyle) => void): void {
        // Each glyph of the characters in order, with its font, its size, the matrix from its text space to the user space
        // and the text of the document that it shows, given with its first glyph.
        const text: InlineText = this.text as InlineText;
        for (let index: number = from; index < to; index++) {
            const ownerStyle: ComputedStyle = this.nodeStyles.get(this.owner[index]) as ComputedStyle;
            if (this.middle[index] === 1 || this.hidden[index] === 1 || this.forced[index] === 1 || this.glyphCount[index] === 0 || this.painter.hidden(ownerStyle)) {
                continue;
            }
            const run: TextRun = this.runOf[index];
            const reversed: boolean = (run.level & 1) === 1;
            const stretch: number = this.stretch[index];
            const frame: Matrix = this.frame(index);
            const characters: string = this.clusterText(text, index);
            if (this.combined[index] > 0) {
                // CSS Writing Modes 4 §9.1.3: the combined glyphs, compressed to fit, centred in their square of 1em.
                const [first, last]: readonly [number, number] = this.combinedGlyphs(index);
                const scale: number = this.combined[index];
                let width: number = 0;
                for (let glyph: number = first; glyph < last; glyph++) {
                    width += text.advances[glyph] * scale;
                }
                const central: number = this.metrics.baseline(ownerStyle.values, "central");
                let pen: number = -width / 2;
                for (let glyph: number = first; glyph < last; glyph++) {
                    visit(run.font, text.glyphs[glyph], run.size, this.sheared(this.geometry.concat(frame, [scale, 0, 0, -1, pen + (text.xOffsets?.[glyph] ?? 0) * scale,
                        run.size / 2 + central - (text.yOffsets?.[glyph] ?? 0)]), run.font, true), glyph === first ? characters : "", ownerStyle);
                    pen += text.advances[glyph] * scale;
                }
                continue;
            }
            const upright: boolean = this.upright(index);
            const count: number = this.glyphCount[index];
            let pen: number = reversed ? this.advance[index] + text.spacingAfter[index] * stretch : text.spacingBefore[index] * stretch;
            for (let order: number = 0; order < count; order++) {
                const glyph: number = this.firstGlyph[index] + (reversed ? count - 1 - order : order);
                const xOffset: number = text.xOffsets?.[glyph] ?? 0;
                const yOffset: number = text.yOffsets?.[glyph] ?? 0;
                // An upright glyph's offsets place its outline from its vertical origin, with the pen going down the line.
                const placement: Matrix = upright ? [1, 0, 0, -stretch, xOffset, pen - yOffset * stretch] : [stretch, 0, 0, -1, pen + xOffset * stretch, -yOffset];
                visit(run.font, text.glyphs[glyph], run.size, this.sheared(this.geometry.concat(frame, placement), run.font, upright), order === 0 ? characters : "", ownerStyle);
                pen += text.advances[glyph] * stretch;
            }
            const hyphen: readonly [Hyphen, number] | undefined = this.hyphens.get(index);
            if (hyphen !== undefined) {
                // The hyphenation string is not text of the document, so it maps to no characters.
                const hyphenFrame: Matrix = upright ? this.lineFrame(index) : frame;
                let at: number = hyphen[1];
                for (const part of reversed ? [...hyphen[0].parts].reverse() : hyphen[0].parts) {
                    for (let order: number = 0; order < part.glyphs.length; order++) {
                        const glyph: number = reversed ? part.glyphs.length - 1 - order : order;
                        visit(part.font, part.glyphs[glyph], part.size, this.sheared(this.geometry.concat(hyphenFrame, [1, 0, 0, -1, at + part.xOffsets[glyph], -part.yOffsets[glyph]]),
                            part.font, false), "", ownerStyle);
                        at += part.advances[glyph];
                    }
                }
            }
        }
    }

    private sheared(matrix: Matrix, font: FontInstance, upright: boolean): Matrix {
        // CSS Fonts 4 §2.8: a synthesized oblique face shears the glyphs, the top towards the line-right side; §2.8.2: "In vertical
        // text, for positive oblique angles, the glyph is skewed such that the line-over edge shifts towards the line-right side".
        const skew: number = Math.tan((font.skew ?? 0) * Math.PI / 180);
        if (skew === 0) {
            return matrix;
        }
        return this.geometry.concat(matrix, upright ? [1, -skew, 0, 1, 0, 0] : [1, 0, skew, 1, 0, 0]);
    }

    private combinedGlyphs(index: number): readonly [number, number] {
        const text: InlineText = this.text as InlineText;
        let end: number = index + 1;
        while (end < text.codepoints.length && this.middle[end] === 1 && this.combined[end] === 0) {
            end++;
        }
        let first: number = Number.POSITIVE_INFINITY;
        let last: number = 0;
        for (let character: number = index; character < end; character++) {
            if (this.glyphCount[character] > 0) {
                first = Math.min(first, this.firstGlyph[character]);
                last = Math.max(last, this.firstGlyph[character] + this.glyphCount[character]);
            }
        }
        return first === Number.POSITIVE_INFINITY ? [0, 0] : [first, last];
    }

    private clusterText(text: InlineText, index: number): string {
        let end: number = index + 1;
        while (end < text.codepoints.length && this.middle[end] === 1) {
            end++;
        }
        return String.fromCodePoint(...text.codepoints.slice(index, end));
    }

    private decorate(from: number, to: number, node: SvgNode, style: ComputedStyle, through: boolean): void {
        // SVG 2 §11.11: the decorations of an element are painted with its own fill and stroke across its characters.
        for (const [owner, path] of this.decorations(from, to, through)) {
            const ownerStyle: ComputedStyle = this.nodeStyles.get(owner) as ComputedStyle;
            // Decorations are paths, so through a projection a stroked one is its stroke's shape filled.
            const projected: boolean = this.painter.isProjected();
            for (const operation of this.painter.paintOrder(ownerStyle).filter((name: string) => name !== "markers")) {
                const stroking: boolean = operation === "stroke";
                this.painter.pdf.content.save();
                if ((!stroking || this.painter.strokeStyle(ownerStyle, undefined))
                    && this.painter.paintWith(ownerStyle.values[operation], this.painter.fraction(ownerStyle.values[operation + "-opacity"]), stroking && !projected, node, style,
                        undefined)) {
                    if (stroking && projected) {
                        if (this.painter.strokeArea(path, ownerStyle)) {
                            this.painter.painted(false);
                        }
                    } else if (this.painter.outline(path)) {
                        if (stroking) {
                            this.painter.pdf.content.stroke();
                        } else {
                            this.painter.painted(false);
                        }
                    }
                }
                this.painter.pdf.content.restore();
            }
        }
    }

    private decorations(from: number, to: number, through: boolean): Array<readonly [SvgNode, SvgPath]> {
        // CSS Text Decoration 4 §2: underlines and overlines are below the text, and a line-through above it; each element
        // that has them gets the rectangles across its characters.
        const decorated: Map<SvgNode, Array<number>> = new Map<SvgNode, Array<number>>();
        for (let index: number = from; index < to; index++) {
            for (let current: SvgNode | undefined = this.owner[index]; current !== undefined && this.nodeStyles.has(current) && this.middle[index] === 0 && this.hidden[index] === 0
                && this.forced[index] === 0;
                current = current.parent) {
                const lines: CssValue | undefined = (this.nodeStyles.get(current) as ComputedStyle).values["text-decoration-line"];
                if (lines !== undefined && this.keyword(lines) !== "none") {
                    decorated.set(current, [...decorated.get(current) ?? [], index]);
                }
            }
        }
        const result: Array<readonly [SvgNode, SvgPath]> = [];
        for (const [owner, indexes] of decorated) {
            const ownerStyle: ComputedStyle = this.nodeStyles.get(owner) as ComputedStyle;
            const lines: CssValue = ownerStyle.values["text-decoration-line"];
            const kinds: Array<string> = (lines.kind === "list" ? lines.items : [lines]).map((item: CssValue) => this.keyword(item) ?? "");
            const [underline, thickness]: readonly [number, number] = this.metrics.underline(ownerStyle.values);
            const tops: Array<number> = through ? [] : [...kinds.includes("underline") ? [underline] : [], ...kinds.includes("overline") ? [-this.metrics.ascent(ownerStyle.values) - thickness] : []];
            if (tops.length === 0 && !(through && kinds.includes("line-through"))) {
                continue;
            }
            const path: SvgPath = { verbs: [], points: [] };
            for (const index of indexes) {
                const run: TextRun = this.runOf[index];
                for (const top of through ? [-this.metrics.strikeout(run.font, run.size)[0]] : tops) {
                    this.rectangle(path, this.lineFrame(index), Math.min(0, this.advance[index]), top, Math.abs(this.advance[index]), thickness);
                }
            }
            result.push([owner, path]);
        }
        return result;
    }

    private rectangle(path: SvgPath, frame: Matrix, x: number, y: number, width: number, height: number): void {
        const corners: ReadonlyArray<readonly [number, number]> = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
        const polygon: SvgPath = this.geometry.polygonPath(corners.map((corner: readonly [number, number]) => this.geometry.point(frame, corner[0], corner[1])));
        path.verbs.push(...polygon.verbs);
        path.points.push(...polygon.points);
    }

    private keyword(value: CssValue | undefined): string | undefined {
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }
}
