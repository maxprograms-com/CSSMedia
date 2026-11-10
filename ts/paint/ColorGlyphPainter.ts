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

import { gunzipSync } from "node:zlib";
import type { DeclaredValue, DescriptorRule } from "../css/Stylesheet.js";
import type { ColorValue, CssValue } from "../css/values/CssValue.js";
import { CssValueSerializer } from "../css/values/CssValueSerializer.js";
import { CaseFolder } from "../fonts/CaseFolder.js";
import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import type { Bitmap, ColorStop, Matrix, Paint } from "../fonts/ColorFont.js";
import { ColorFont } from "../fonts/ColorFont.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { CatalogFace, FontInstance } from "../fonts/Typeface.js";
import type { PathData } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ImageFormats, ImageSamples, ImageSize } from "../images/ImageFormats.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Size } from "../pdf/PageCanvas.js";
import { StyleComputer } from "../pdf/StyleComputer.js";
import type { CustomValue } from "../pdf/ValueSubstitution.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PdfPage } from "../writer/PdfPage.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";
import type { ColorOutput } from "./ColorOutput.js";

export interface PaletteRule {
    name: string;
    families: ReadonlyArray<string>;
    base?: CssValue;
    overrides: ReadonlyArray<readonly [number, CssValue]>;
}

export interface ColorGlyph {
    x: number;
    y: number;
    glyph: number;
    text: string;
    font: FontInstance;
    size: number;
}

type Box = readonly [number, number, number, number];

interface PaintState {
    color: ColorFont;
    font: FontInstance;
    scalars?: Float64Array;
    palette: ReadonlyArray<CssValue>;
    style: ComputedStyle;
    matrix: Matrix;
    bounds: readonly [number, number, number, number];
    path: ReadonlySet<number>;
}

interface LineStop {
    offset: number;
    color: readonly [number, number, number];
    alpha: number;
}

const UNSCALED: ReadonlyArray<number> = [1, 0, 0, 1, 0, 0];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const REPEAT: number = 1;
const REFLECT: number = 2;
const PARALLEL: number = 1e-9;
const SMALLEST: number = 1e-9;
const FAR: number = 1e9;
const DIGITS: number = 12;
const D65_WHITE: ReadonlyArray<number> = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const SRGB_PRIMARIES: ReadonlyArray<number> = [
    0.41239079926595934, 0.21263900587151027, 0.01933081871559182, 0.357584339383878, 0.715168678767756, 0.11919477979462598,
    0.1804807884018343, 0.07219231536073371, 0.9505321522496607
];
const COMPOSITE_NAMES: ReadonlyArray<string> = ["SRC_ATOP", "DEST_ATOP", "XOR", "PLUS"];
const PALETTE_DESCRIPTORS: ReadonlyArray<string> = ["font-family", "base-palette", "override-colors"];
const BLEND_MODES: ReadonlyMap<number, string> = new Map<number, string>([
    [13, "Screen"], [14, "Overlay"], [15, "Darken"], [16, "Lighten"], [17, "ColorDodge"], [18, "ColorBurn"], [19, "HardLight"], [20, "SoftLight"],
    [21, "Difference"], [22, "Exclusion"], [23, "Multiply"], [24, "Hue"], [25, "Saturation"], [26, "Color"], [27, "Luminosity"]
]);

export class ColorGlyphPainter {

    private readonly document: PdfDocument;
    private readonly colors: ColorOutput;
    private readonly metrics: FontMetrics;
    private readonly images: ImageFormats;
    private readonly serializer: CssValueSerializer = new CssValueSerializer();
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly rules: ReadonlyMap<string, PaletteRule>;
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private readonly geometry: PathGeometry = new PathGeometry();
    private readonly caseFolder: CaseFolder = new CaseFolder();
    private readonly palettes: Map<FontInstance, Map<string, ReadonlyArray<CssValue>>> = new Map<FontInstance, Map<string, ReadonlyArray<CssValue>>>();    private linearSpace?: ColorSpaceResource;

    constructor(document: PdfDocument, colors: ColorOutput, metrics: FontMetrics, rules: ReadonlyArray<PaletteRule>, images: ImageFormats) {
        this.document = document;
        this.colors = colors;
        this.metrics = metrics;
        this.images = images;
        // CSS Fonts 4 §9.2: "If multiple @font-palette-values rules are defined with the same name, the last one in document
        // order wins, and all preceding ones are ignored."
        this.rules = new Map<string, PaletteRule>(rules.map((rule: PaletteRule): [string, PaletteRule] => [rule.name, rule]));
    }

    static fromRule(rule: DescriptorRule, computer: StyleComputer, root: ComputedStyle, viewport: Size): PaletteRule {
        // CSS Fonts 4 §9.2: var(), env() and relative units in the descriptors "are evaluated within the context of the root element".
        const cascaded: Map<string, DeclaredValue> = new Map<string, DeclaredValue>(Object.entries(rule.descriptors));
        return ColorGlyphPainter.fromValues(rule.name, computer.compute(StyleComputer.input(cascaded, viewport, StyleComputer.NO_CONTAINERS, root, root, undefined,
            undefined, { atRule: "@font-palette-values", names: PALETTE_DESCRIPTORS })).values);
    }

    static fromValues(name: string, values: Readonly<Record<string, CssValue>>): PaletteRule {
        const families: Array<string> = [];
        const family: CssValue | undefined = values["font-family"];
        for (const item of family === undefined ? [] : (family.kind === "list" && family.separator === "comma" ? family.items : [family])) {
            if (item.kind === "string" || item.kind === "ident") {
                families.push(item.kind === "string" ? item.value : item.name);
            } else if (item.kind === "list" && item.items.every((part: CssValue) => part.kind === "ident")) {
                families.push(item.items.map((part: CssValue) => (part as { name: string }).name).join(" "));
            }
        }
        const overrides: Array<readonly [number, CssValue]> = [];
        const colors: CssValue | undefined = values["override-colors"];
        for (const pair of colors === undefined ? [] : (colors.kind === "list" && colors.separator === "comma" ? colors.items : [colors])) {
            if (pair.kind === "list" && pair.items.length === 2 && pair.items[0].kind === "number") {
                overrides.push([pair.items[0].value, pair.items[1]]);
            }
        }
        const palette: PaletteRule = { name, families, overrides };
        const base: CssValue | undefined = values["base-palette"];
        if (base !== undefined) {
            palette.base = base;
        }
        return palette;
    }

    colored(font: FontInstance, glyph: number): boolean {
        const color: ColorFont | undefined = ColorFont.of(font.typeface);
        return color !== undefined && (color.paint(glyph) !== undefined || color.layers(glyph) !== undefined || color.svgDocument(glyph) !== undefined
            || color.bitmap(glyph) !== undefined);
    }

    outlined(font: FontInstance): boolean {
        // ISO 32000-2 §9.6.2.2: a reader has the outlines of the standard fonts, which come with no font tables.
        const tables: Readonly<Record<string, Buffer>> = font.typeface.tables;
        return font.typeface.standardFont !== undefined || tables["glyf"] !== undefined || tables["CFF "] !== undefined || tables["CFF2"] !== undefined;
    }

    private drawn(placed: ColorGlyph, color: ColorFont, style: ComputedStyle, opacity: number, pdf: PdfPage, sheared: boolean): void {
        const font: FontInstance = placed.font;
        const scale: number = placed.size / font.metrics.unitsPerEm;
        const document: readonly [number, number] | undefined = color.svgDocument(placed.glyph);
        pdf.content.save();
        this.shear(placed, sheared, pdf);
        if (opacity < 1) {
            pdf.content.graphicsState(pdf.useState(opacity, 1, "Normal"));
        }
        if (document === undefined) {
            this.bitmapGlyph(placed, color, color.bitmap(placed.glyph) as Bitmap, pdf);
            pdf.content.restore();
            return;
        }
        // OpenType SVG: a document "may either be plain text or gzip-encoded", whose "first three bytes ... must be 0x1F, 0x8B, 0x08".
        const href: string = this.address(font, "svg", document[0]);
        this.images.provide(href, (): Buffer => {
            const data: Buffer = color.svgData(document[0], document[1]);
            return data[0] === 0x1F && data[1] === 0x8B && data[2] === 0x08 ? gunzipSync(data) : data;
        });
        // ISO 32000-2 §8.7.3.1: a pattern matrix maps to "the default coordinate space of the pattern's parent content stream", so
        // the glyph is a form of its own, as an SVG image is, and the drawing gives the box of its ink.
        const matrix: readonly [number, number, number, number, number, number] = [scale, 0, 0, scale, placed.x, placed.y];
        const form: PdfPage = this.document.startForm(0, 0, false);
        form.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        const ink: readonly [number, number, number, number] | undefined = this.images.glyph(href, "glyph" + placed.glyph, font.metrics.unitsPerEm, scale,
            this.host(font, color, style), form, matrix, font.emboldening ?? 0);
        const area: Box = ink === undefined ? [placed.x, placed.y, 0, 0] : [placed.x + ink[0] * scale, placed.y + ink[1] * scale, ink[2] * scale, ink[3] * scale];
        const resource: ImageResource = this.document.finishForm(form, area, UNSCALED);
        if (area[2] > 0 && area[3] > 0) {
            pdf.content.paintXObject(pdf.useImage(resource));
        }
        pdf.content.restore();
    }

    private host(font: FontInstance, color: ColorFont, style: ComputedStyle): ComputedStyle {
        // OpenType SVG: "The text-layout engine or application defines a custom property for each palette entry", named "--color<num>",
        // and currentColor is "the text foreground color applied to a given run of text".
        const custom: Record<string, CustomValue> = {};
        for (const [entry, value] of this.palette(font, color, style).entries()) {
            custom["--color" + entry] = { text: this.serializer.serialize(value) };
        }
        return { values: style.values, inherited: style.inherited, custom };
    }

    private bitmapGlyph(placed: ColorGlyph, color: ColorFont, bitmap: Bitmap, pdf: PdfPage): void {
        const font: FontInstance = placed.font;
        const href: string = this.address(font, bitmap.table, bitmap.offset);
        this.images.provide(href, (): Buffer => color.bitmapData(bitmap));
        let box: Box;
        if (bitmap.metrics !== undefined) {
            // OpenType CBDT: the bearings are the "distance in pixels from the horizontal origin" to the left and to the top edge.
            const across: number = placed.size / bitmap.ppem[0];
            const down: number = placed.size / bitmap.ppem[1];
            const [width, height, left, top] = bitmap.metrics;
            box = [placed.x + left * across, placed.y - top * down, width * across, height * down];
        } else {
            // OpenType sbix: the origin offsets place the bottom left corner from the glyph origin, or "If there is a glyph contour,
            // the glyph design space origin for the graphic is placed at the lower left corner of the glyph bounding box".
            const size: ImageSize | undefined = this.images.size(href);
            const outline: OutlineBounds | undefined = this.outlines.bounds(font, placed.glyph);
            if (size?.width === undefined || size.height === undefined) {
                return;
            }
            const scale: number = placed.size / font.metrics.unitsPerEm;
            const units: number = font.metrics.unitsPerEm / bitmap.ppem[0];
            const contours: boolean = outline !== undefined && (outline.xMax > outline.xMin || outline.yMax > outline.yMin);
            const origin: readonly [number, number] = bitmap.origin ?? [0, 0];
            const left: number = (contours ? (outline as OutlineBounds).xMin : 0) + origin[0];
            const bottom: number = (contours ? (outline as OutlineBounds).yMin : 0) + origin[1];
            box = [placed.x + left * scale, placed.y - (bottom + size.height * units) * scale, size.width * units * scale, size.height * units * scale];
        }
        const grow: number = this.metrics.emboldening(font, placed.size);
        const thick: readonly [ImageResource, Box] | undefined = grow > 0 && box[2] > 0 && box[3] > 0 ? this.thickBitmap(href, box, grow) : undefined;
        const resource: ImageResource | undefined = thick?.[0] ?? this.images.image(href, { width: box[2], height: box[3], scale: 1, rendering: "auto", multiple: [1, 1] });
        if (thick !== undefined) {
            box = thick[1];
        }
        if (resource === undefined || box[2] <= 0 || box[3] <= 0) {
            return;
        }
        // ISO 32000-2 §8.9.4: an image fills the unit square with its first row at the top, and the page has y going down.
        pdf.content.save();
        pdf.content.transform(box[2], 0, 0, -box[3], box[0], box[1] + box[3]);
        pdf.content.paintXObject(pdf.useImage(resource));
        pdf.content.restore();
    }

    private thickBitmap(href: string, box: Box, grow: number): readonly [ImageResource, Box] | undefined {
        const read: readonly [ImageSamples, ColorSpaceResource] | undefined = this.images.samples(href);
        if (read === undefined || read[0].width === 0 || read[0].height === 0) {
            return undefined;
        }
        const across: number = box[2] / read[0].width;
        const down: number = box[3] / read[0].height;
        const radius: readonly [number, number] = [grow / 2 / across, grow / 2 / down];
        const resource: ImageResource = this.images.written(href + "|thick|" + radius[0] + "|" + radius[1], (): ImageResource =>
            this.images.write(this.dilated(read[0], radius[0], radius[1]), read[1], this.images.interpolates("auto")));
        const extra: readonly [number, number] = [Math.ceil(radius[0]), Math.ceil(radius[1])];
        return [resource, [box[0] - extra[0] * across, box[1] - extra[1] * down, box[2] + 2 * extra[0] * across, box[3] + 2 * extra[1] * down]];
    }

    private dilated(image: ImageSamples, radiusX: number, radiusY: number): ImageSamples {
        // The outline of a bitmap glyph is the edges of its pixels, all corners square, so a thin stroke with miter joins around it
        // grows each pixel into a rectangle wider by the radius on each side.
        const reachX: number = Math.ceil(radiusX);
        const reachY: number = Math.ceil(radiusY);
        const width: number = image.width + 2 * reachX;
        const height: number = image.height + 2 * reachY;
        const size: number = image.bits / 8;
        const channels: number = image.channels;
        const full: number = size === 1 ? 0xFF : 0xFFFF;
        const read: (buffer: Buffer, index: number) => number = (buffer: Buffer, index: number): number => size === 1 ? buffer[index] : buffer.readUInt16BE(index * 2);
        const write: (buffer: Buffer, index: number, value: number) => void = (buffer: Buffer, index: number, value: number): void => {
            if (size === 1) {
                buffer[index] = value;
            } else {
                buffer.writeUInt16BE(value, index * 2);
            }
        };
        const share: (offset: number, radius: number) => number = (offset: number, radius: number): number =>
            offset === 0 ? 1 : Math.max(0, Math.min(1, radius - Math.abs(offset) + 1));
        // The nearest of equally covering pixels gives the color, so the offsets go outwards.
        const offsets: Array<readonly [number, number, number]> = [];
        for (let dy: number = -reachY; dy <= reachY; dy++) {
            for (let dx: number = -reachX; dx <= reachX; dx++) {
                const weight: number = share(dx, radiusX) * share(dy, radiusY);
                if (weight > 0) {
                    offsets.push([dx, dy, weight]);
                }
            }
        }
        offsets.sort((first: readonly [number, number, number], second: readonly [number, number, number]) =>
            Math.max(Math.abs(first[0]), Math.abs(first[1])) - Math.max(Math.abs(second[0]), Math.abs(second[1])) || Math.hypot(first[0], first[1]) - Math.hypot(second[0], second[1]));
        const pixels: Buffer = Buffer.alloc(width * height * channels * size);
        const alpha: Buffer = Buffer.alloc(width * height * size);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                let best: number = 0;
                let source: number = -1;
                for (const [dx, dy, weight] of offsets) {
                    const sx: number = x - reachX - dx;
                    const sy: number = y - reachY - dy;
                    if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) {
                        continue;
                    }
                    const index: number = sy * image.width + sx;
                    const coverage: number = (image.alpha === undefined ? full : read(image.alpha, index)) * weight;
                    if (coverage > best) {
                        best = coverage;
                        source = index;
                    }
                }
                const target: number = y * width + x;
                if (source >= 0) {
                    write(alpha, target, Math.round(best));
                    for (let channel: number = 0; channel < channels; channel++) {
                        write(pixels, target * channels + channel, read(image.pixels, source * channels + channel));
                    }
                }
            }
        }
        return { width, height, bits: image.bits, channels: image.channels, pixels, alpha };
    }

    private address(font: FontInstance, table: string, offset: number): string {
        return "font:" + font.typeface.source + "#" + font.typeface.index + "/" + table + "/" + offset;
    }

    paint(glyphs: ReadonlyArray<ColorGlyph>, style: ComputedStyle, opacity: number, pdf: PdfPage, sheared: boolean = false): void {
        // CSS Fill and Stroke 3 §3.4.1: fill-opacity is the opacity of the painting that fills, so overlapping layers take it
        // once, in a group. OpenType COLR: "Applications that support COLR version 1 should give preference to the version 1 color glyph."
        const layered: Array<ColorGlyph> = [];
        for (const placed of glyphs) {
            const color: ColorFont = ColorFont.of(placed.font.typeface) as ColorFont;
            const root: number | undefined = color.paint(placed.glyph);
            if (root !== undefined) {
                this.painted(placed, color, root, style, opacity, pdf, sheared);
            } else if (color.layers(placed.glyph) !== undefined) {
                layered.push(placed);
            } else if (this.outlined(placed.font)) {
                this.drawn(placed, color, style, opacity, pdf, sheared);
            } else {
                // ISO 32000-2 §14.9.4: ActualText is the text that the marked content stands for, as for an image; a font without
                // outlines has no glyph to write as invisible text.
                pdf.content.beginMarked("Span", "<< /ActualText " + this.syntax.textString(placed.text) + " >>");
                this.drawn(placed, color, style, opacity, pdf, sheared);
                pdf.content.endMarked();
            }
        }
        const area: Box | undefined = opacity < 1 ? this.area(layered, sheared) : undefined;
        if (area === undefined) {
            for (const placed of layered) {
                this.glyph(placed, style, pdf, sheared);
            }
            return;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        for (const placed of layered) {
            this.glyph(placed, style, form, sheared);
        }
        pdf.content.save();
        pdf.content.graphicsState(pdf.useState(opacity, 1, "Normal"));
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, UNSCALED)));
        pdf.content.restore();
    }

    private shear(placed: ColorGlyph, sheared: boolean, pdf: PdfPage): void {
        // CSS Fonts 4 §2.8: a synthesized oblique face shears its glyphs about their origin, the top towards the inline end,
        // with y going down; a caller whose glyph space is already sheared asks for none.
        const skew: number = sheared ? 0 : Math.tan((placed.font.skew ?? 0) * Math.PI / 180);
        if (skew !== 0) {
            pdf.content.transform(1, 0, -skew, 1, skew * placed.y, 0);
        }
    }

    private painted(placed: ColorGlyph, color: ColorFont, root: number, style: ComputedStyle, opacity: number, pdf: PdfPage, sheared: boolean): void {
        // COLR version 1: compositing and the interpolation of gradients are "done after applying the inverse transfer function
        // to derive linear-light RGB values"; "Any content drawn outside the clip box must not render".
        const font: FontInstance = placed.font;
        const scalars: Float64Array | undefined = color.scalars(font.coordinates);
        const clip: readonly [number, number, number, number] | undefined = color.clip(placed.glyph, scalars);
        const scale: number = placed.size / font.metrics.unitsPerEm;
        // CSS Fonts 4 §2.8: the glyphs of a synthesized bold face are grown by half a thin stroke, and the clip box with them.
        const grow: number = font.emboldening ?? 0;
        const designed: readonly [number, number, number, number] = clip ?? font.metrics.bounds;
        const box: readonly [number, number, number, number] = [designed[0] - grow / 2, designed[1] - grow / 2, designed[2] + grow / 2, designed[3] + grow / 2];
        if (box[2] <= box[0] || box[3] <= box[1]) {
            return;
        }
        const area: Box = [placed.x + box[0] * scale, placed.y - box[3] * scale, (box[2] - box[0]) * scale, (box[3] - box[1]) * scale];
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        form.content.transform(scale, 0, 0, -scale, placed.x, placed.y);
        if (clip !== undefined) {
            form.content.rectangle(box[0], box[1], box[2] - box[0], box[3] - box[1]);
            form.content.clip(false);
        }
        const state: PaintState = {
            color, font, palette: this.palette(font, color, style), style, matrix: IDENTITY, bounds: [box[0], box[1], box[2], box[3]], path: new Set<number>()
        };
        if (scalars !== undefined) {
            state.scalars = scalars;
        }
        this.render(root, state, form);
        pdf.content.save();
        this.shear(placed, sheared, pdf);
        if (opacity < 1) {
            pdf.content.graphicsState(pdf.useState(opacity, 1, "Normal"));
        }
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, UNSCALED, this.linear())));
        pdf.content.restore();
    }

    private render(at: number, state: PaintState, pdf: PdfPage): void {
        // The "COLR version 1 rendering algorithm"; a paint already on the path from the root is a cycle, and "the paint table at
        // which the error occurs should be ignored", as are unknown formats.
        if (state.path.has(at)) {
            return;
        }
        const paint: Paint = state.color.paintAt(at, state.scalars);
        const inner: PaintState = { ...state, path: new Set<number>(state.path).add(at) };
        switch (paint.kind) {
            case "layers":
                for (const child of paint.children) {
                    this.render(child, inner, pdf);
                }
                return;
            case "solid":
                this.solid(paint.entry, paint.alpha, inner, pdf);
                return;
            case "linear":
            case "radial":
            case "sweep":
                this.gradient(paint, inner, pdf);
                return;
            case "glyph":
                this.clipped(paint.glyph, paint.child, inner, pdf);
                return;
            case "colr-glyph": {
                const root: number | undefined = state.color.paint(paint.glyph);
                if (root !== undefined) {
                    this.render(root, inner, pdf);
                }
                return;
            }
            case "transform": {
                const m: Matrix = paint.matrix;
                pdf.content.save();
                pdf.content.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
                this.render(paint.child, { ...inner, matrix: this.multiply(state.matrix, m) }, pdf);
                pdf.content.restore();
                return;
            }
            case "composite":
                this.composite(paint.mode, paint.source, paint.backdrop, inner, pdf);
                return;
            default:
                return;
        }
    }

    private clipped(glyph: number, child: number, state: PaintState, pdf: PdfPage): void {
        // Format 10: "the glyph outline specified by the PaintGlyph table defines a bounds, or clip region"; the region kept for
        // the fills below is the bounds of that outline, in the coordinates of the base glyph.
        const outline: PathData | undefined = this.outlines.path(state.font, glyph);
        const bounds: OutlineBounds | undefined = this.outlines.bounds(state.font, glyph);
        if (outline === undefined || bounds === undefined) {
            return;
        }
        const box: ReadonlyArray<readonly [number, number]> = [[bounds.xMin, bounds.yMin], [bounds.xMax, bounds.yMin], [bounds.xMin, bounds.yMax], [bounds.xMax, bounds.yMax]];
        const corners: Array<readonly [number, number]> = box.map((corner: readonly [number, number]) => this.apply(state.matrix, corner[0], corner[1]));
        const xs: Array<number> = corners.map((corner: readonly [number, number]) => corner[0]);
        const ys: Array<number> = corners.map((corner: readonly [number, number]) => corner[1]);
        const area: readonly [number, number, number, number] = [
            Math.max(state.bounds[0], Math.min(...xs)), Math.max(state.bounds[1], Math.min(...ys)), Math.min(state.bounds[2], Math.max(...xs)), Math.min(state.bounds[3], Math.max(...ys))
        ];
        if (area[2] <= area[0] || area[3] <= area[1]) {
            return;
        }
        pdf.content.save();
        this.geometry.trace(outline, pdf.content);
        pdf.content.clip(false);
        this.render(child, { ...state, bounds: area }, pdf);
        pdf.content.restore();
    }

    private solid(entry: number, alpha: number, state: PaintState, pdf: PdfPage): void {
        // Formats 2 and 3 fill the whole clip region, which the region kept for it covers.
        const color: readonly [number, number, number, number] | undefined = this.linearColor(entry, alpha, state);
        const region: Array<readonly [number, number]> | undefined = this.region(state);
        if (color === undefined || color[3] <= 0 || region === undefined) {
            return;
        }
        pdf.content.save();
        pdf.content.fillSpace(pdf.useColorSpace(this.linear()));
        pdf.content.fillColor([color[0], color[1], color[2]]);
        if (color[3] < 1) {
            pdf.content.graphicsState(pdf.useState(color[3], 1, "Normal"));
        }
        pdf.content.moveTo(region[0][0], region[0][1]);
        for (let corner: number = 1; corner < region.length; corner++) {
            pdf.content.lineTo(region[corner][0], region[corner][1]);
        }
        pdf.content.closePath();
        pdf.content.fill(false);
        pdf.content.restore();
    }

    private gradient(paint: Extract<Paint, { kind: "linear" | "radial" | "sweep" }>, state: PaintState, pdf: PdfPage): void {
        // Each point of the region takes the color of its position on the color line, which a calculator function finds by the
        // algorithm of its gradient; the alpha, interpolated with the colors premultiplied, is a soft mask of the same function.
        const domain: readonly [number, number, number, number] | undefined = this.domain(state);
        const position: string | undefined = paint.kind === "linear" ? this.linearPosition(paint.points)
            : (paint.kind === "radial" ? this.radialPosition(paint.circles) : this.sweepPosition(paint.center, paint.start, paint.end, paint.line.extend));
        const stops: Array<LineStop> = [];
        for (const stop of [...paint.line.stops].sort((first: ColorStop, second: ColorStop) => first.offset - second.offset)) {
            const color: readonly [number, number, number, number] = this.linearColor(stop.entry, stop.alpha, state) ?? [0, 0, 0, 0];
            stops.push({ offset: stop.offset, color: [color[0], color[1], color[2]], alpha: color[3] });
        }
        const colors: string | undefined = this.lineProgram(stops, paint.line.extend, false);
        const alphas: string | undefined = this.lineProgram(stops, paint.line.extend, true);
        if (domain === undefined || position === undefined || colors === undefined || alphas === undefined) {
            return;
        }
        const area: Box = [domain[0], domain[2], domain[1] - domain[0], domain[3] - domain[2]];
        pdf.content.save();
        if (paint.kind === "radial" || stops.some((stop: LineStop) => stop.alpha < 1)) {
            const mask: PdfPage = this.document.startForm(area[2], area[3], false);
            mask.content.shade(mask.useShading(this.document.shadings.calculated(PdfColorSpaces.GRAY, domain, position + " { " + alphas + " } { pop 0 } ifelse")));
            pdf.content.graphicsState(pdf.useMask(this.document.finishForm(mask, area, UNSCALED, PdfColorSpaces.GRAY).object, true));
        }
        pdf.content.shade(pdf.useShading(this.document.shadings.calculated(this.linear(), domain, position + " { " + colors + " } { pop 0 0 0 } ifelse")));
        pdf.content.restore();
    }

    private linearPosition(points: readonly [number, number, number, number, number, number]): string | undefined {
        // "If either point p₁ or p₂ is the same as point p₀", or the lines p₀p₁ and p₀p₂ are parallel, "the gradient is
        // ill-formed"; otherwise the offset is along p₀p₃, the projection of p₀p₁ perpendicular to p₀p₂.
        const [x0, y0, x1, y1, x2, y2] = points;
        const vx: number = x1 - x0;
        const vy: number = y1 - y0;
        const dx: number = x2 - x0;
        const dy: number = y2 - y0;
        const rotation: number = dx * dx + dy * dy;
        if ((vx === 0 && vy === 0) || rotation === 0) {
            return undefined;
        }
        const along: number = (vx * dx + vy * dy) / rotation;
        const wx: number = vx - along * dx;
        const wy: number = vy - along * dy;
        const length: number = wx * wx + wy * wy;
        if (length <= PARALLEL * (vx * vx + vy * vy)) {
            return undefined;
        }
        return this.number(y0) + " sub " + this.number(wy / length) + " mul exch " + this.number(x0) + " sub " + this.number(wx / length) + " mul add true";
    }

    private radialPosition(circles: readonly [number, number, number, number, number, number]): string | undefined {
        // "If c₀ = c₁ and r₀ = r₁ then paint nothing"; otherwise the largest ω for which the point is on the circle of center
        // c(ω) and radius r(ω) > 0, from (p - c(ω))² = r(ω)², which is A ω² - 2 B ω + C = 0; no such ω leaves the point unpainted.
        const [x0, y0, r0, x1, y1, r1] = circles;
        const cx: number = x1 - x0;
        const cy: number = y1 - y0;
        const dr: number = r1 - r0;
        if (cx === 0 && cy === 0 && dr === 0) {
            return undefined;
        }
        const a: number = cx * cx + cy * cy - dr * dr;
        const radius: string = this.number(dr) + " mul " + this.number(r0) + " add 0 ge";
        const start: string = this.number(y0) + " sub exch " + this.number(x0) + " sub 2 copy " + this.number(cx) + " mul exch " + this.number(cy) + " mul add "
            + this.number(r0 * dr) + " add 3 1 roll dup mul exch dup mul add " + this.number(r0 * r0) + " sub ";
        if (Math.abs(a) < PARALLEL * (cx * cx + cy * cy + dr * dr)) {
            return start + "exch dup 0 eq { pop pop 0 false } { 2 mul div dup " + radius + " } ifelse";
        }
        return start + this.number(a) + " mul 1 index dup mul exch sub dup 0 lt { pop pop 0 false } { sqrt 2 copy add " + this.number(1 / a) + " mul 3 1 roll sub "
            + this.number(1 / a) + " mul 2 copy gt { exch } if dup " + radius + " { exch pop true } { pop dup " + radius + " } ifelse } ifelse";
    }

    private sweepPosition(center: readonly [number, number], start: number, end: number, extend: number): string | undefined {
        // Angles are "counter-clockwise degrees from the direction of the positive x-axis", sampled from 0° up to 360°; with equal
        // angles the pad mode gives the first stop below and the last at and above, and the other modes draw nothing.
        const angle: string = this.number(center[1]) + " sub exch " + this.number(center[0]) + " sub 2 copy 0 eq exch 0 eq and { pop pop 0 } { atan } ifelse ";
        if (start === end) {
            return extend === REPEAT || extend === REFLECT ? undefined : angle + this.number(start) + " lt { " + this.number(-FAR) + " } { " + this.number(FAR) + " } ifelse true";
        }
        return angle + this.number(start) + " sub " + this.number(1 / (end - start)) + " mul true";
    }

    private lineProgram(stops: ReadonlyArray<LineStop>, extend: number, alpha: boolean): string | undefined {
        // Color lines: no stop is transparent black, one stop is its color; colors are interpolated between the stops in order
        // of offset, the first of stops at one offset below it and the last at and above it, and the extend mode fills the rest.
        const constant: (stop: LineStop) => string = (stop: LineStop): string =>
            alpha ? this.number(stop.alpha) : stop.color.map((channel: number) => this.number(channel)).join(" ");
        if (stops.length === 0) {
            return alpha ? "pop 0" : "pop 0 0 0";
        }
        const first: LineStop = stops[0];
        const last: LineStop = stops[stops.length - 1];
        if (stops.length === 1) {
            return "pop " + constant(first);
        }
        const low: number = first.offset;
        const high: number = last.offset;
        if (low === high) {
            // "If all color stops have the same offset ... if the extend mode is repeat or reflect, the color line is ill-formed".
            return extend === REPEAT || extend === REFLECT ? undefined : this.number(low) + " lt { " + constant(first) + " } { " + constant(last) + " } ifelse";
        }
        const length: string = this.number(high - low);
        const segments: string = this.segments(stops, alpha);
        if (extend === REPEAT) {
            return this.number(low) + " sub " + length + " div dup floor sub " + length + " mul " + this.number(low) + " add " + segments;
        }
        if (extend === REFLECT) {
            return this.number(low) + " sub " + length + " div dup floor dup 2 div dup floor sub 0 ne { sub 1 exch sub } { sub } ifelse " + length + " mul "
                + this.number(low) + " add " + segments;
        }
        // "If a ColorLine in a font has an unrecognized extend value, applications should use EXTEND_PAD".
        return "dup " + this.number(low) + " lt { pop " + constant(first) + " } { dup " + this.number(high) + " ge { pop " + constant(last) + " } { " + segments
            + " } ifelse } ifelse";
    }

    private segments(stops: ReadonlyArray<LineStop>, alpha: boolean): string {
        // A stop at the offset of the one before starts no segment, so a position at that offset falls in the segment that
        // the later stop starts.
        const pieces: Array<readonly [LineStop, LineStop]> = [];
        for (let index: number = 1; index < stops.length; index++) {
            if (stops[index].offset > stops[index - 1].offset) {
                pieces.push([stops[index - 1], stops[index]]);
            }
        }
        let code: string = this.segment(pieces[pieces.length - 1], alpha);
        for (let index: number = pieces.length - 2; index >= 0; index--) {
            code = "dup " + this.number(pieces[index][1].offset) + " lt { " + this.segment(pieces[index], alpha) + " } { " + code + " } ifelse";
        }
        return code;
    }

    private segment(piece: readonly [LineStop, LineStop], alpha: boolean): string {
        // CPAL, "Interpolation of colors": linear-light values with the alpha "pre-multiplied into each" component, interpolated,
        // and then "un-pre-multiplied by dividing each interpolated value by the corresponding interpolated alpha".
        const [from, to] = piece;
        const fraction: string = this.number(from.offset) + " sub " + this.number(1 / (to.offset - from.offset)) + " mul ";
        if (alpha) {
            return fraction + this.number(to.alpha - from.alpha) + " mul " + this.number(from.alpha) + " add";
        }
        if (from.alpha === to.alpha) {
            return fraction + "dup " + this.number(to.color[0] - from.color[0]) + " mul " + this.number(from.color[0]) + " add exch dup "
                + this.number(to.color[1] - from.color[1]) + " mul " + this.number(from.color[1]) + " add exch " + this.number(to.color[2] - from.color[2]) + " mul "
                + this.number(from.color[2]) + " add";
        }
        let code: string = fraction + "dup " + this.number(to.alpha - from.alpha) + " mul " + this.number(from.alpha) + " add dup " + this.number(SMALLEST)
            + " lt { pop " + this.number(SMALLEST) + " } if ";
        for (let channel: number = 0; channel < 3; channel++) {
            const start: number = from.color[channel] * from.alpha;
            code += (channel + 1) + " index " + this.number(to.color[channel] * to.alpha - start) + " mul " + this.number(start) + " add " + (channel + 1) + " index div ";
        }
        return code + "5 3 roll pop pop";
    }

    private composite(mode: number, source: number, backdrop: number, state: PaintState, pdf: PdfPage): void {
        // Format 32: the backdrop and then the source, combined by the mode of Compositing and Blending Level 1, and the result
        // composed over what is below; "If an unrecognized value is encountered, COMPOSITE_CLEAR must be used."
        const domain: readonly [number, number, number, number] | undefined = this.domain(state);
        if (domain === undefined) {
            return;
        }
        const area: Box = [domain[0], domain[2], domain[1] - domain[0], domain[3] - domain[2]];
        const group: (at: number) => PdfPage = (at: number): PdfPage => {
            const form: PdfPage = this.document.startForm(area[2], area[3], false);
            this.render(at, state, form);
            return form;
        };
        switch (mode) {
            case 1:
                this.render(source, state, pdf);
                return;
            case 2:
                this.render(backdrop, state, pdf);
                return;
            case 3:
                this.render(backdrop, state, pdf);
                this.render(source, state, pdf);
                return;
            case 4:
                this.render(source, state, pdf);
                this.render(backdrop, state, pdf);
                return;
            case 5:
            case 6:
            case 7:
            case 8: {
                // Source In keeps the source where the backdrop is, by the backdrop's alpha; Out where it is not, by one minus it.
                const kept: PdfPage = group(mode === 5 || mode === 7 ? source : backdrop);
                const mask: PdfPage = group(mode === 5 || mode === 7 ? backdrop : source);
                pdf.content.save();
                pdf.content.graphicsState(pdf.useMask(this.document.finishForm(mask, area, UNSCALED, this.linear()).object, false, mode >= 7));
                pdf.content.paintXObject(pdf.useImage(this.document.finishForm(kept, area, UNSCALED, this.linear())));
                pdf.content.restore();
                return;
            }
            case 9:
            case 10:
            case 11:
            case 12:
                throw new Error("The painting of the COLR composite mode " + COMPOSITE_NAMES[mode - 9] + " of the font " + state.font.typeface.names.postScriptName
                    + " is not implemented");
            default: {
                const blend: string | undefined = BLEND_MODES.get(mode);
                if (blend === undefined) {
                    return;
                }
                const form: PdfPage = this.document.startForm(area[2], area[3], false);
                this.render(backdrop, state, form);
                form.content.graphicsState(form.useState(1, 1, blend));
                this.render(source, state, form);
                pdf.content.paintXObject(pdf.useImage(this.document.finishForm(form, area, UNSCALED, this.linear())));
            }
        }
    }

    private linearColor(entry: number, alpha: number, state: PaintState): readonly [number, number, number, number] | undefined {
        // "The alpha value in the COLR structure is multiplied into the alpha value given in the CPAL color entry", and the
        // components become linear-light with the inverse transfer function of sRGB.
        const value: CssValue | undefined = entry === ColorFont.FOREGROUND ? state.style.values["color"] : state.palette[entry];
        const rgba: readonly [number, number, number, number] | undefined = value === undefined ? undefined : this.colors.rgba(value, state.style);
        if (rgba === undefined) {
            return undefined;
        }
        const linear: (channel: number) => number = (channel: number): number => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        return [linear(rgba[0]), linear(rgba[1]), linear(rgba[2]), rgba[3] * Math.min(1, Math.max(0, alpha))];
    }

    private region(state: PaintState): Array<readonly [number, number]> | undefined {
        const inverse: Matrix | undefined = this.invert(state.matrix);
        const [x0, y0, x1, y1] = state.bounds;
        return inverse === undefined ? undefined : [this.apply(inverse, x0, y0), this.apply(inverse, x1, y0), this.apply(inverse, x1, y1), this.apply(inverse, x0, y1)];
    }

    private domain(state: PaintState): readonly [number, number, number, number] | undefined {
        const corners: Array<readonly [number, number]> | undefined = this.region(state);
        if (corners === undefined) {
            return undefined;
        }
        const xs: Array<number> = corners.map((corner: readonly [number, number]) => corner[0]);
        const ys: Array<number> = corners.map((corner: readonly [number, number]) => corner[1]);
        const domain: readonly [number, number, number, number] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return domain[1] > domain[0] && domain[3] > domain[2] ? domain : undefined;
    }

    private multiply(outer: Matrix, inner: Matrix): Matrix {
        return [
            outer[0] * inner[0] + outer[2] * inner[1], outer[1] * inner[0] + outer[3] * inner[1], outer[0] * inner[2] + outer[2] * inner[3],
            outer[1] * inner[2] + outer[3] * inner[3], outer[0] * inner[4] + outer[2] * inner[5] + outer[4], outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
        ];
    }

    private invert(m: Matrix): Matrix | undefined {
        const determinant: number = m[0] * m[3] - m[1] * m[2];
        if (Math.abs(determinant) < SMALLEST) {
            return undefined;
        }
        return [m[3] / determinant, -m[1] / determinant, -m[2] / determinant, m[0] / determinant, (m[2] * m[5] - m[3] * m[4]) / determinant,
            (m[1] * m[4] - m[0] * m[5]) / determinant];
    }

    private apply(m: Matrix, x: number, y: number): readonly [number, number] {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    private number(value: number): string {
        // ISO 32000-2 §7.10.5: the operands of a calculator function are PDF numbers, which have no exponent.
        if (Math.abs(value) < SMALLEST) {
            return "0";
        }
        const text: string = value.toFixed(DIGITS).replace(/0+$/, "").replace(/\.$/, "");
        return text === "-0" ? "0" : text;
    }

    private linear(): ColorSpaceResource {
        // CSS Color 4 §10.2: sRGB without its transfer function, the D65 white and the primaries in CIE XYZ.
        this.linearSpace = this.linearSpace ?? this.document.colors.calibrated([1, 1, 1], D65_WHITE, SRGB_PRIMARIES);
        return this.linearSpace;
    }

    private glyph(placed: ColorGlyph, style: ComputedStyle, pdf: PdfPage, sheared: boolean): void {
        // OpenType COLR version 0: "the first record in this sequence is the bottom layer in the z-order", each one the outline
        // of its glyph "with a solid color fill"; the coordinates are those of the font, with y going up.
        const color: ColorFont = ColorFont.of(placed.font.typeface) as ColorFont;
        const palette: ReadonlyArray<CssValue> = this.palette(placed.font, color, style);
        const scale: number = placed.size / placed.font.metrics.unitsPerEm;
        pdf.content.save();
        this.shear(placed, sheared, pdf);
        pdf.content.transform(scale, 0, 0, -scale, placed.x, placed.y);
        for (const [glyph, entry] of color.layers(placed.glyph) ?? []) {
            // "A palette entry index value of 0xFFFF is a special case indicating that the text foreground color", which CSS
            // Fonts 4 §9.1 gives as the color property; an entry past the palette names no color.
            const fill: CssValue | undefined = entry === ColorFont.FOREGROUND ? style.values["color"] : palette[entry];
            const path: PathData | undefined = this.outlines.path(placed.font, glyph);
            if (fill === undefined || path === undefined) {
                continue;
            }
            pdf.content.save();
            if (this.colors.fill(fill, style, pdf)) {
                this.geometry.trace(path, pdf.content);
                pdf.content.fill(false);
            }
            pdf.content.restore();
        }
        pdf.content.restore();
    }

    private area(glyphs: ReadonlyArray<ColorGlyph>, sheared: boolean): Box | undefined {
        // The bounds of every layer, from font units to the font size and with y going down, sheared as the glyphs are.
        let left: number = Number.POSITIVE_INFINITY;
        let top: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let bottom: number = Number.NEGATIVE_INFINITY;
        for (const placed of glyphs) {
            const scale: number = placed.size / placed.font.metrics.unitsPerEm;
            const skew: number = sheared ? 0 : Math.tan((placed.font.skew ?? 0) * Math.PI / 180);
            for (const [glyph] of ColorFont.of(placed.font.typeface)?.layers(placed.glyph) ?? []) {
                const bounds: OutlineBounds | undefined = this.outlines.bounds(placed.font, glyph);
                if (bounds !== undefined) {
                    left = Math.min(left, placed.x + (bounds.xMin + Math.min(skew * bounds.yMin, skew * bounds.yMax)) * scale);
                    right = Math.max(right, placed.x + (bounds.xMax + Math.max(skew * bounds.yMin, skew * bounds.yMax)) * scale);
                    top = Math.min(top, placed.y - bounds.yMax * scale);
                    bottom = Math.max(bottom, placed.y - bounds.yMin * scale);
                }
            }
        }
        return left > right ? undefined : [left, top, right - left, bottom - top];
    }

    private palette(font: FontInstance, color: ColorFont, style: ComputedStyle): ReadonlyArray<CssValue> {
        // The palette depends on the font, which has the family the rules name, and on font-palette and color-scheme.
        const value: CssValue | undefined = style.values["font-palette"];
        const light: boolean = this.keywords(style.values["color-scheme"]).some((keyword: string) => keyword !== "normal");
        const key: string = JSON.stringify([value ?? null, light]);
        let known: Map<string, ReadonlyArray<CssValue>> | undefined = this.palettes.get(font);
        if (known === undefined) {
            known = new Map<string, ReadonlyArray<CssValue>>();
            this.palettes.set(font, known);
        }
        let palette: ReadonlyArray<CssValue> | undefined = known.get(key);
        if (palette === undefined) {
            const face: CatalogFace | undefined = this.metrics.matcher.faceOf(font);
            palette = this.resolve(value, color, face === undefined ? "" : this.caseFolder.fold(face.family), light);
            known.set(key, palette);
        }
        return palette;
    }

    private resolve(value: CssValue | undefined, color: ColorFont, family: string, light: boolean): ReadonlyArray<CssValue> {
        // CSS Fonts 4 §9.1: with normal, "If the color-scheme property is set to a value other than normal, user-agents should
        // select the first light or dark palette as appropriate", and the used color scheme of a page on paper is light.
        const normal: ReadonlyArray<CssValue> = this.fromFont(color, light ? this.first(color, ColorFont.LIGHT) ?? 0 : 0);
        if (value === undefined) {
            return normal;
        }
        if (value.kind === "function" && value.name === "palette-mix") {
            return this.mix(value.args, color, family, light);
        }
        if (value.kind !== "ident") {
            return normal;
        }
        if (value.lower === "light" || value.lower === "dark") {
            // "If the font file format does not account for this metadata, or no palette in the font is marked this way, this
            // value behaves as normal."
            const index: number | undefined = this.first(color, value.lower === "light" ? ColorFont.LIGHT : ColorFont.DARK);
            return index === undefined ? normal : this.fromFont(color, index);
        }
        // <palette-identifier>: "If no applicable @font-palette-values rule is present, this value behaves as normal."
        const rule: PaletteRule | undefined = this.rules.get(value.name);
        if (rule === undefined || !rule.families.some((name: string) => this.caseFolder.fold(name) === family)) {
            return normal;
        }
        return this.custom(rule, color);
    }

    private custom(rule: PaletteRule, color: ColorFont): ReadonlyArray<CssValue> {
        // §9.2.2: without base-palette, or with an index the font does not have, the palette is 0, and light or dark is the first
        // palette marked so, or 0; §9.2.3: each override replaces one entry, and "a key that is outside the range ... is ignored".
        const base: CssValue | undefined = rule.base;
        let index: number = 0;
        if (base !== undefined && base.kind === "number" && base.value < color.palettes.length) {
            index = base.value;
        } else if (base !== undefined && base.kind === "ident" && (base.lower === "light" || base.lower === "dark")) {
            index = this.first(color, base.lower === "light" ? ColorFont.LIGHT : ColorFont.DARK) ?? 0;
        }
        const palette: Array<CssValue> = [...this.fromFont(color, index)];
        for (const [entry, value] of rule.overrides) {
            if (entry < palette.length) {
                palette[entry] = value;
            }
        }
        return palette;
    }

    private mix(args: ReadonlyArray<CssValue>, color: ColorFont, family: string, light: boolean): ReadonlyArray<CssValue> {
        // §9.1: each entry is interpolated "between the matching color indices of the list of palettes", following "the rules
        // of the <color-mix()> function", so each entry is a color-mix() of the entries of the palettes mixed.
        const first: CssValue | undefined = args[0];
        const method: CssValue | undefined = first !== undefined && first.kind === "list" && first.items[0]?.kind === "ident" && first.items[0].lower === "in" ? first : undefined;
        const parts: Array<readonly [ReadonlyArray<CssValue>, CssValue | undefined]> = [];
        for (const item of method === undefined ? args : args.slice(1)) {
            const items: ReadonlyArray<CssValue> = item.kind === "list" && item.separator === "space" ? item.items : [item];
            const share: CssValue | undefined = items.find((part: CssValue) => part.kind === "percentage");
            const palette: CssValue | undefined = items.find((part: CssValue) => part !== share);
            parts.push([this.resolve(palette, color, family, light), share]);
        }
        const length: number = Math.min(...parts.map((part: readonly [ReadonlyArray<CssValue>, CssValue | undefined]) => part[0].length));
        const mixed: Array<CssValue> = [];
        for (let entry: number = 0; entry < length; entry++) {
            const colors: Array<CssValue> = parts.map((part: readonly [ReadonlyArray<CssValue>, CssValue | undefined]): CssValue =>
                part[1] === undefined ? part[0][entry] : { kind: "list", separator: "space", items: [part[0][entry], part[1]] });
            mixed.push({ kind: "function", name: "color-mix", args: method === undefined ? colors : [method, ...colors] });
        }
        return mixed;
    }

    private first(color: ColorFont, flag: number): number | undefined {
        const index: number = color.types.findIndex((type: number) => (type & flag) !== 0);
        return index < 0 ? undefined : index;
    }

    private fromFont(color: ColorFont, index: number): ReadonlyArray<CssValue> {
        // OpenType CPAL: the colors are sRGB with 8 bits for each channel and for alpha, "not pre-multiplied".
        const colors: Uint8Array | undefined = color.palettes[index];
        const palette: Array<CssValue> = [];
        for (let entry: number = 0; colors !== undefined && entry < color.entries; entry++) {
            const value: ColorValue = {
                kind: "color", space: "srgb", components: [colors[entry * 4] / 255, colors[entry * 4 + 1] / 255, colors[entry * 4 + 2] / 255],
                alpha: colors[entry * 4 + 3] / 255, legacy: false
            };
            palette.push(value);
        }
        return palette;
    }

    private keywords(value?: CssValue): Array<string> {
        if (value === undefined) {
            return [];
        }
        return (value.kind === "list" ? value.items : [value]).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }
}
