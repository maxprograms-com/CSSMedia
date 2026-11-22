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

import { CssUnits } from "../css/values/CssUnits.js";
import type { ColorValue, CssValue, FunctionValue } from "../css/values/CssValue.js";
import type { Matrix } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ImageAlpha, ImageDrawing, ImageFormats, ImageSize } from "../images/ImageFormats.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { Transform } from "../layout/BoxSizes.js";
import type { BoxFragment, ObjectArea } from "../layout/Fragment.js";
import type { BoxNode } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { Rectangle } from "../pdf/PageCanvas.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import type { ColorOutput } from "./ColorOutput.js";
import { GradientPainter } from "./GradientPainter.js";

export type Natural = readonly [number | undefined, number | undefined, number | undefined];

export interface TileLayer {
    size: CssValue;
    x: CssValue;
    y: CssValue;
    repeatX: string;
    repeatY: string;
}

export interface ImageMarks {
    links: ReadonlyArray<readonly [PageRectangle, string, boolean]>;
    destinations: ReadonlyArray<readonly [string, number, number]>;
}

const NO_MARKS: ImageMarks = { links: [], destinations: [] };
const NO_NATURAL: Natural = [undefined, undefined, undefined];
const SUPPORTED_TYPES: ReadonlySet<string> = new Set<string>([
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff", "image/jp2", "image/svg+xml", "application/mathml+xml"
]);
const LARGEST_GRID: number = 2048;
const BLOCK_START: number = 0;
const INLINE_END: number = 1;
const BLOCK_END: number = 2;
const INLINE_START: number = 3;
const ORIENTATIONS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [1, 0, 0, 0, 1, 0], [-1, 0, 1, 0, 1, 0], [-1, 0, 1, 0, -1, 1], [1, 0, 0, 0, -1, 1],
    [0, 1, 0, 1, 0, 0], [0, -1, 1, 1, 0, 0], [0, -1, 1, -1, 0, 1], [0, 1, 0, -1, 0, 1]
];

export class ImagePainter {

    private readonly images: ImageFormats;
    private readonly sizes: BoxSizes;
    private readonly document: PdfDocument;
    private readonly colors: ColorOutput;
    private readonly gradients: GradientPainter;
    private readonly units: CssUnits = new CssUnits();
    private readonly geometry: PathGeometry = new PathGeometry();
    resolver?: (reference: string) => string;

    constructor(images: ImageFormats, sizes: BoxSizes, document: PdfDocument, colors: ColorOutput) {
        this.images = images;
        this.sizes = sizes;
        this.document = document;
        this.colors = colors;
        this.gradients = new GradientPainter(document, colors, new PathGeometry());
    }

    natural(value: CssValue, style: ComputedStyle): Natural | undefined {
        // CSS Images 3 §4.1: the natural width, height and aspect ratio of an <image>, any of which can be missing; undefined
        // for an image that cannot be shown, which still counts as a layer and draws nothing.
        const chosen: readonly [CssValue, number | undefined] | undefined = this.chosen(value, style);
        if (chosen === undefined) {
            return undefined;
        }
        const [image, density] = chosen;
        if (image.kind === "url") {
            return this.images.natural(this.located(image.href), style.values, style.zoom ?? 1, true, undefined, density);
        }
        if (image.kind === "function" && image.name === "cross-fade") {
            return this.crossFadeSize(image, style);
        }
        return NO_NATURAL;
    }

    alpha(value: CssValue, style: ComputedStyle, width: number, height: number): ImageAlpha | undefined {
        // CSS Shapes 1 §3.4: the shape of an <image> is where its alpha is above the threshold; a file gives its channel, a gradient the
        // alpha of its colors over a grid, a cross-fade the weighted average of its images, and image() the alpha of its color.
        const chosen: readonly [CssValue, number | undefined] | undefined = this.chosen(value, style);
        if (chosen === undefined) {
            return undefined;
        }
        const image: CssValue = chosen[0];
        if (image.kind === "url") {
            return this.images.alpha(this.located(image.href));
        }
        if (image.kind !== "function") {
            return undefined;
        }
        if (GradientPainter.NAMES.has(image.name)) {
            const sampler: ((x: number, y: number) => number) | undefined = this.gradients.alphaAt(image, [0, 0, width, height], style);
            return sampler === undefined ? undefined : this.grid(width, height, (x: number, y: number): number => sampler(x, y));
        }
        if (image.name === "image") {
            const source: CssValue | undefined = this.imageSource(image);
            const href: string | undefined = source === undefined ? undefined : this.href(source);
            if (href !== undefined && this.images.size(href) !== undefined) {
                return this.images.alpha(href);
            }
            const color: ColorValue | undefined = this.colors.colorValue(this.imageColor(image, style), style);
            return this.grid(1, 1, (): number => color?.alpha ?? 0);
        }
        return image.name === "cross-fade" ? this.crossFadeAlpha(image, style, width, height) : undefined;
    }

    private crossFadeAlpha(value: FunctionValue, style: ComputedStyle, width: number, height: number): ImageAlpha {
        // CSS Images 4 §2.6.2: the average of the premultiplied pixels with the weights, so the alpha is the average of the
        // alphas by the same weights, and what is left over is a transparent image.
        const [weights]: readonly [ReadonlyArray<readonly [CssValue, number]>, number] = this.weights(value);
        const layers: Array<readonly [(x: number, y: number) => number, number]> = [];
        for (const [image, weight] of weights) {
            const color: ColorValue | undefined = this.colors.colorValue(image, style);
            if (color !== undefined) {
                layers.push([(): number => color.alpha ?? 0, weight]);
                continue;
            }
            const alpha: ImageAlpha | undefined = this.alpha(image, style, width, height);
            if (alpha !== undefined) {
                layers.push([(x: number, y: number): number => this.alphaAt(alpha, x / width, y / height), weight]);
            }
        }
        return this.grid(width, height, (x: number, y: number): number => layers.reduce((sum: number, layer: readonly [(x: number, y: number) => number, number]) =>
            sum + layer[0](x, y) * layer[1], 0));
    }

    private alphaAt(image: ImageAlpha, fx: number, fy: number): number {
        // The nearest pixel of the image at a fraction of its width and height; an image without an alpha channel is opaque.
        if (image.alpha === undefined) {
            return 1;
        }
        const column: number = Math.min(image.width - 1, Math.max(0, Math.floor(fx * image.width)));
        const row: number = Math.min(image.height - 1, Math.max(0, Math.floor(fy * image.height)));
        return image.bits === 16 ? image.alpha.readUInt16BE((row * image.width + column) * 2) / 65535 : image.alpha[row * image.width + column] / 255;
    }

    private grid(width: number, height: number, alpha: (x: number, y: number) => number): ImageAlpha {
        // Samples at the centers of the pixels of a grid over the box, a pixel to a CSS pixel and no more than the largest
        // image allows along an axis.
        const columns: number = Math.min(LARGEST_GRID, Math.max(1, Math.ceil(width)));
        const rows: number = Math.min(LARGEST_GRID, Math.max(1, Math.ceil(height)));
        const samples: Buffer = Buffer.alloc(columns * rows);
        for (let row: number = 0; row < rows; row++) {
            for (let column: number = 0; column < columns; column++) {
                samples[row * columns + column] = Math.round(Math.min(1, Math.max(0, alpha((column + 0.5) * width / columns, (row + 0.5) * height / rows))) * 255);
            }
        }
        return { width: columns, height: rows, bits: 8, alpha: samples };
    }

    private located(href: string): string {
        // A reference in an SVG image is against the address of that image, which the document's painters do not know.
        return this.resolver === undefined ? href : this.resolver(href);
    }

    paintImage(value: CssValue, target: readonly [number, number, number, number], style: ComputedStyle, pdf: PdfPage): void {
        // The image drawn at its concrete object size, the target, given as x, y, width and height.
        const chosen: readonly [CssValue, number | undefined] | undefined = this.chosen(value, style);
        if (chosen === undefined || target[2] <= 0 || target[3] <= 0) {
            return;
        }
        const image: CssValue = chosen[0];
        if (image.kind === "url") {
            const natural: Natural | undefined = this.images.natural(this.located(image.href), style.values, style.zoom ?? 1, true, undefined, chosen[1]);
            const size: readonly [number, number] | undefined = natural?.[0] !== undefined && natural[1] !== undefined ? [natural[0], natural[1]] : undefined;
            pdf.content.save();
            pdf.content.rectangle(target[0], target[1], target[2], target[3]);
            pdf.content.clip(false);
            this.draw(this.located(image.href), target, style.values, true, pdf, size);
            pdf.content.restore();
            return;
        }
        if (image.kind !== "function") {
            return;
        }
        if (GradientPainter.NAMES.has(image.name)) {
            this.gradients.paint(image, target, style, pdf);
        } else if (image.name === "image") {
            this.imageFunction(image, target, style, pdf);
        } else if (image.name === "cross-fade") {
            this.crossFade(image, target, style, pdf);
        }
    }

    tile(image: CssValue, layer: TileLayer, area: Rectangle, painting: Rectangle, base: Matrix, style: ComputedStyle, pdf: PdfPage, sizing?: Rectangle): void {
        // The image sized, positioned and repeated in the positioning area, and where it repeats, over the painting area.
        const natural: Natural | undefined = this.natural(image, style);
        if (natural === undefined) {
            return;
        }
        let size: readonly [number, number] = this.size(layer.size, natural, area, layer.repeatX === "round", layer.repeatY === "round");
        if (sizing !== undefined) {
            // CSS Fragmentation 4 §5.4.1: "if the used height (width) of an image is derived from the width (height) of the box, then it is calculated
            // using the widest fragment's width and maintained as a fixed size"; the sizing area is wider only across the joined axis.
            const widest: readonly [number, number] = this.size(layer.size, natural, sizing, layer.repeatX === "round", layer.repeatY === "round");
            const across: boolean = sizing.width !== area.width;
            if (across ? widest[1] !== size[1] : (sizing.height !== area.height && widest[0] !== size[0])) {
                size = widest;
            }
        }
        if (!(size[0] > 0) || !(size[1] > 0)) {
            return;
        }
        // CSS Backgrounds 4 §2.6: the start of each physical axis is the start of the flow-relative axis that runs along it, whose
        // direction the frame of the box gives (CSS Writing Modes 4 §6.4).
        const frame: number = this.sizes.frame(style);
        const vertical: boolean = (frame & BoxSizes.VERTICAL) !== 0;
        const inlineReversed: boolean = (frame & BoxSizes.INLINE_REVERSED) !== 0;
        const blockReversed: boolean = (frame & BoxSizes.BLOCK_REVERSED) !== 0;
        const x: readonly [number, number] = this.axis(layer.x, area.x, area.width, size[0], layer.repeatX, vertical ? blockReversed : inlineReversed);
        const y: readonly [number, number] = this.axis(layer.y, area.y, area.height, size[1], layer.repeatY, vertical ? inlineReversed : blockReversed);
        const tile: readonly [number, number, number, number] = [x[0], y[0], size[0], size[1]];
        const across: boolean = layer.repeatX !== "no-repeat" && x[1] > 0;
        const down: boolean = layer.repeatY !== "no-repeat" && y[1] > 0;
        if (!across && !down) {
            this.paintImage(image, tile, style, pdf);
            return;
        }
        // CSS Backgrounds 4 §2.3: a repeated image covers the painting area, so it is a tiling pattern, with one band of tiles on an axis that
        // does not repeat. ISO 32000-2 §8.7.3.1: the pattern matrix maps the cell to the default space of the content stream.
        if (!across || !down) {
            pdf.content.rectangle(across ? painting.x : tile[0], down ? painting.y : tile[1], across ? painting.width : tile[2], down ? painting.height : tile[3]);
            pdf.content.clip(false);
        }
        const stepX: number = across ? x[1] : tile[2];
        const stepY: number = down ? y[1] : tile[3];
        const cell: PdfPage = this.document.startForm(stepX, stepY, false);
        this.paintImage(image, [0, 0, tile[2], tile[3]], style, cell);
        if (base !== PathGeometry.IDENTITY) {
            const matrix: Matrix = this.geometry.concat(base, this.geometry.translation(tile[0], tile[1]));
            const pattern: string = pdf.usePattern(this.document.finishPattern(cell, [0, 0, stepX, stepY], matrix));
            pdf.content.fillPattern(pattern);
            pdf.content.rectangle(painting.x, painting.y, painting.width, painting.height);
            pdf.content.fill(false);
            return;
        }
        // Quartz places a tiling pattern inside a form XObject apart from where the other viewers do, so there the tile is a
        // form painted at each place it repeats over the painting area.
        const form: string = pdf.useImage(this.document.finishForm(cell, [0, 0, stepX, stepY], PathGeometry.IDENTITY));
        const first: (start: number, step: number, from: number) => number = (start: number, step: number, from: number): number => Math.floor((from - start) / step);
        const columns: readonly [number, number] = across ? [first(tile[0], stepX, painting.x), first(tile[0], stepX, painting.x + painting.width)] : [0, 0];
        const rows: readonly [number, number] = down ? [first(tile[1], stepY, painting.y), first(tile[1], stepY, painting.y + painting.height)] : [0, 0];
        for (let row: number = rows[0]; row <= rows[1]; row++) {
            for (let column: number = columns[0]; column <= columns[1]; column++) {
                pdf.content.save();
                pdf.content.transform(1, 0, 0, 1, tile[0] + column * stepX, tile[1] + row * stepY);
                pdf.content.paintXObject(form);
                pdf.content.restore();
            }
        }
    }

    maskTile(position: CssValue | undefined, size: CssValue | undefined, repeat: CssValue | undefined): TileLayer {
        // CSS Masking 1 §7.4 to §7.6: mask-position is a <position>, mask-size is the <bg-size> of backgrounds, and mask-repeat
        // a <repeat-style>, which Backgrounds 4 §2.3 reads as repeat-x, repeat-y, or one or two keywords for the two axes.
        const [x, y]: readonly [CssValue, CssValue] = this.positionAxes(position);
        const words: ReadonlyArray<string> = repeat === undefined ? [] : this.list(repeat, " ").map((word: CssValue) => this.keyword(word));
        let repeatX: string = words[0] ?? "repeat";
        let repeatY: string = words[1] ?? repeatX;
        if (repeatX === "repeat-x") {
            repeatX = "repeat";
            repeatY = "no-repeat";
        } else if (repeatX === "repeat-y") {
            repeatX = "no-repeat";
            repeatY = "repeat";
        }
        return { size: size ?? { kind: "ident", name: "auto", lower: "auto" }, x, y, repeatX, repeatY };
    }

    private positionAxes(value: CssValue | undefined): readonly [CssValue, CssValue] {
        // CSS Values 4 §6.1.1: one value gives an axis and centers the other; two values give the horizontal first unless the
        // first is top or bottom, or the second left or right; three or four are edges, each with an optional offset.
        const center: CssValue = { kind: "ident", name: "center", lower: "center" };
        const items: ReadonlyArray<CssValue> = value === undefined ? [] : this.list(value, " ");
        if (items.length === 0) {
            const origin: CssValue = { kind: "percentage", value: 0 };
            return [origin, origin];
        }
        const groups: Array<Array<CssValue>> = [];
        for (const item of items) {
            const last: Array<CssValue> | undefined = groups[groups.length - 1];
            if (item.kind !== "ident" && last !== undefined && last.length === 1 && last[0].kind === "ident" && last[0].lower !== "center") {
                last.push(item);
            } else {
                groups.push([item]);
            }
        }
        const vertical: (group: ReadonlyArray<CssValue>) => boolean = (group: ReadonlyArray<CssValue>): boolean => ["top", "bottom", "y-start", "y-end", "block-start", "block-end"].includes(this.keyword(group[0]));
        const horizontal: (group: ReadonlyArray<CssValue>) => boolean = (group: ReadonlyArray<CssValue>): boolean => ["left", "right", "x-start", "x-end", "inline-start", "inline-end"].includes(this.keyword(group[0]));
        const axis: (group: ReadonlyArray<CssValue>) => CssValue = (group: ReadonlyArray<CssValue>): CssValue => group.length === 1 ? group[0] : { kind: "list", separator: "space", items: group };
        const first: ReadonlyArray<CssValue> = groups[0];
        const second: ReadonlyArray<CssValue> | undefined = groups[1];
        if (second === undefined) {
            return vertical(first) ? [center, axis(first)] : [axis(first), center];
        }
        return vertical(first) || horizontal(second) ? [axis(second), axis(first)] : [axis(first), axis(second)];
    }

    private size(value: CssValue, natural: Natural, area: Rectangle, roundX: boolean, roundY: boolean): readonly [number, number] {
        // CSS Backgrounds 4 §2.10: cover and contain keep the natural ratio; auto comes from the ratio and the other dimension, or the
        // natural size, or 100%; both auto take the natural size, or contain without one. round rescales to whole tiles, auto keeps the ratio.
        const [naturalWidth, naturalHeight, ratio] = natural;
        const keyword: string = this.keyword(value);
        if (keyword === "cover" || keyword === "contain") {
            if (ratio === undefined) {
                return this.rounded([area.width, area.height], area, roundX, roundY, false, false);
            }
            const wide: boolean = area.width / area.height > ratio;
            const byWidth: boolean = keyword === "cover" ? wide : !wide;
            return this.rounded(byWidth ? [area.width, area.width / ratio] : [area.height * ratio, area.height], area, roundX, roundY, false, false);
        }
        const items: ReadonlyArray<CssValue> = this.list(value, " ");
        const first: CssValue = items[0];
        const second: CssValue | undefined = items[1];
        let width: number | undefined = first === undefined || this.keyword(first) === "auto" ? undefined : this.geometry.pixels(first, area.width);
        let height: number | undefined = second === undefined || this.keyword(second) === "auto" ? undefined : this.geometry.pixels(second, area.height);
        const autoWidth: boolean = width === undefined;
        const autoHeight: boolean = height === undefined;
        if (width === undefined && height === undefined) {
            if (naturalWidth === undefined && naturalHeight === undefined) {
                return this.size({ kind: "ident", name: "contain", lower: "contain" }, natural, area, roundX, roundY);
            }
            width = naturalWidth;
            height = naturalHeight;
        }
        if (width === undefined) {
            width = ratio !== undefined && height !== undefined ? height * ratio : (naturalWidth ?? area.width);
        }
        if (height === undefined) {
            height = ratio !== undefined ? width / ratio : (naturalHeight ?? area.height);
        }
        return this.rounded([width, height], area, roundX, roundY, autoWidth, autoHeight);
    }

    private rounded(size: readonly [number, number], area: Rectangle, roundX: boolean, roundY: boolean, autoWidth: boolean, autoHeight: boolean): readonly [number, number] {
        // Backgrounds 4 §2.10: X' = W / round(W / X), with round() the nearest natural number greater than zero; rounded in
        // one dimension only, an auto other dimension is scaled to keep the aspect ratio.
        let [width, height] = size;
        if (roundX && width > 0) {
            const rounded: number = area.width / Math.max(1, Math.round(area.width / width));
            height = !roundY && autoHeight ? height * rounded / width : height;
            width = rounded;
        }
        if (roundY && height > 0) {
            const rounded: number = area.height / Math.max(1, Math.round(area.height / height));
            width = !roundX && autoWidth ? width * rounded / height : width;
            height = rounded;
        }
        return [width, height];
    }

    private axis(value: CssValue, start: number, length: number, size: number, repeat: string, reversed: boolean): readonly [number, number] {
        // Backgrounds 4 §2.6: a percentage is of the area less the image, an offset is from the edge it names, else the axis start; §2.3:
        // space needs two whole images, first and last on the edges. The result is the start of a tile and the distance, zero if not repeated.
        if (repeat === "space") {
            const count: number = Math.floor(length / size);
            if (count >= 2) {
                return [start, size + (length - count * size) / (count - 1)];
            }
        }
        const items: ReadonlyArray<CssValue> = this.list(value, " ");
        let edge: string = "start";
        let offset: CssValue | undefined;
        for (const item of items) {
            if (item.kind === "ident") {
                edge = item.lower;
            } else {
                offset = item;
            }
        }
        // start, x-start and y-start follow the direction of the axis in the writing mode, which reversed gives.
        const free: number = length - size;
        const logicalStart: boolean = edge === "start" || edge === "x-start" || edge === "y-start";
        const logicalEnd: boolean = edge === "end" || edge === "x-end" || edge === "y-end";
        const fromEnd: boolean = edge === "right" || edge === "bottom" || (logicalEnd && !reversed) || (logicalStart && reversed);
        const distance: number = offset === undefined ? 0 : this.geometry.pixels(offset, free);
        const position: number = edge === "center" ? free / 2 : (fromEnd ? free - distance : distance);
        return [start + position, repeat === "repeat" || repeat === "round" ? size : 0];
    }

    private list(value: CssValue, separator: string): ReadonlyArray<CssValue> {
        return value.kind === "list" && value.separator === (separator === "," ? "comma" : "space") ? value.items : [value];
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }

    private chosen(value: CssValue, style: ComputedStyle): readonly [CssValue, number | undefined] | undefined {
        // CSS Images 4 §2.4: image-set() represents one of its options; its resolution is the natural resolution of a raster
        // image. §2.5.1: an image() whose image cannot be shown is its color, if it has one.
        if (value.kind === "url") {
            return this.images.size(this.located(value.href)) === undefined ? undefined : [value, undefined];
        }
        if (value.kind !== "function") {
            return undefined;
        }
        switch (value.name) {
            case "image-set":
                return this.option(value, style);
            case "image": {
                const source: CssValue | undefined = this.imageSource(value);
                if (source !== undefined && this.images.size(this.href(source)) !== undefined) {
                    return [value, undefined];
                }
                return this.imageColor(value, style) === undefined ? undefined : [value, undefined];
            }
            case "element":
                throw new Error("The painting of the image element() is not implemented");
            default:
                return GradientPainter.NAMES.has(value.name) || value.name === "cross-fade" ? [value, undefined] : undefined;
        }
    }

    private option(value: FunctionValue, style: ComputedStyle): readonly [CssValue, number | undefined] | undefined {
        // §2.4: options of an unsupported type are removed, then those with the resolution of an earlier one; a PDF for print takes the one of
        // the highest resolution. A resolution left out selects as 1x but gives no natural resolution, so the image's own is honored.
        const seen: Set<number> = new Set<number>();
        let best: readonly [CssValue, number, boolean] | undefined;
        for (const option of value.args) {
            const items: ReadonlyArray<CssValue> = option.kind === "list" && option.separator === "space" ? option.items : [option];
            let resolution: number = 1;
            let given: boolean = false;
            let supported: boolean = true;
            for (const item of items.slice(1)) {
                if (item.kind === "dimension") {
                    resolution = this.units.toCanonical(item.value, item.unit) ?? 1;
                    given = true;
                } else if (item.kind === "function" && item.name === "type") {
                    const type: CssValue | undefined = item.args[0];
                    supported = type !== undefined && type.kind === "string" && SUPPORTED_TYPES.has(type.value.trim().toLowerCase().split(";")[0].trim());
                }
            }
            if (!supported || seen.has(resolution)) {
                continue;
            }
            seen.add(resolution);
            const image: CssValue = items[0].kind === "string" ? { kind: "url", href: items[0].value } : items[0];
            const chosen: readonly [CssValue, number | undefined] | undefined = this.chosen(image, style);
            if (chosen !== undefined && (best === undefined || resolution > best[1])) {
                best = [chosen[0], resolution, given];
            }
        }
        return best === undefined ? undefined : [best[0], best[0].kind === "url" && best[2] ? best[1] : undefined];
    }

    private imageSource(value: FunctionValue): CssValue | undefined {
        const first: CssValue | undefined = value.args[0];
        const items: ReadonlyArray<CssValue> = first === undefined ? [] : (first.kind === "list" && first.separator === "space" ? first.items : [first]);
        return items.find((item: CssValue) => item.kind === "url" || item.kind === "string");
    }

    private imageColor(value: FunctionValue, style: ComputedStyle): CssValue | undefined {
        // §2.5: image( <image-tags>? [ <image-src>? , <color>? ]! ), the color after the comma or alone.
        const last: CssValue | undefined = value.args[value.args.length - 1];
        if (last === undefined || (value.args.length === 1 && this.imageSource(value) !== undefined)) {
            return undefined;
        }
        return this.colors.colorValue(last, style) === undefined ? undefined : last;
    }

    private href(source: CssValue): string {
        return this.located(source.kind === "url" ? source.href : (source.kind === "string" ? source.value : ""));
    }

    private imageFunction(value: FunctionValue, target: readonly [number, number, number, number], style: ComputedStyle, pdf: PdfPage): void {
        // §2.5.4: an image tagged with a direction is flipped in the inline direction on an element of the other one.
        const source: CssValue | undefined = this.imageSource(value);
        const href: string | undefined = source === undefined ? undefined : this.href(source);
        if (href === undefined || this.images.size(href) === undefined) {
            pdf.content.save();
            if (this.colors.fill(this.imageColor(value, style), style, pdf)) {
                pdf.content.rectangle(target[0], target[1], target[2], target[3]);
                pdf.content.fill(false);
            }
            pdf.content.restore();
            return;
        }
        const first: CssValue | undefined = value.args[0];
        const tag: CssValue | undefined = first !== undefined && first.kind === "list" ? first.items[0] : undefined;
        const frame: number = this.sizes.frame(style);
        const rtl: boolean = (frame & BoxSizes.RIGHT_TO_LEFT) !== 0;
        const flip: boolean = tag !== undefined && tag.kind === "ident" && (tag.lower === "rtl") !== rtl && (tag.lower === "ltr" || tag.lower === "rtl");
        const vertical: boolean = (frame & BoxSizes.VERTICAL) !== 0;
        pdf.content.save();
        pdf.content.rectangle(target[0], target[1], target[2], target[3]);
        pdf.content.clip(false);
        if (flip) {
            pdf.content.transform(vertical ? 1 : -1, 0, 0, vertical ? -1 : 1, vertical ? 0 : 2 * target[0] + target[2], vertical ? 2 * target[1] + target[3] : 0);
        }
        this.draw(href, target, style.values, true, pdf);
        pdf.content.restore();
    }

    private weights(value: FunctionValue): readonly [ReadonlyArray<readonly [CssValue, number]>, number] {
        // §2.6: the percentages left out share what the others leave of 100%, floored at 0%; "normalize mix percentages" makes
        // the sum at most 100% and gives what is left over.
        const parts: Array<readonly [CssValue, number | undefined]> = value.args.map((argument: CssValue): readonly [CssValue, number | undefined] => {
            const items: ReadonlyArray<CssValue> = argument.kind === "list" && argument.separator === "space" ? argument.items : [argument];
            const percentage: CssValue | undefined = items.find((item: CssValue) => item.kind === "percentage");
            const image: CssValue = items.find((item: CssValue) => item.kind !== "percentage") as CssValue;
            return [image, percentage !== undefined && percentage.kind === "percentage" ? percentage.value / 100 : undefined];
        });
        const given: number = parts.reduce((sum: number, part: readonly [CssValue, number | undefined]) => sum + (part[1] ?? 0), 0);
        const missing: number = parts.filter((part: readonly [CssValue, number | undefined]) => part[1] === undefined).length;
        const share: number = missing === 0 ? 0 : Math.max(0, 1 - given) / missing;
        const weights: Array<readonly [CssValue, number]> = parts.map((part: readonly [CssValue, number | undefined]): readonly [CssValue, number] => [part[0], part[1] ?? share]);
        const total: number = weights.reduce((sum: number, part: readonly [CssValue, number]) => sum + part[1], 0);
        return total > 1 ? [weights.map((part: readonly [CssValue, number]): readonly [CssValue, number] => [part[0], part[1] / total]), 0] : [weights, 1 - total];
    }

    private crossFadeSize(value: FunctionValue, style: ComputedStyle): Natural {
        // §2.6.1: the weighted average of the sizes of the images that have natural dimensions; colors take no part.
        const [weights, leftover] = this.weights(value);
        if (leftover >= 1) {
            return NO_NATURAL;
        }
        let width: number = 0;
        let height: number = 0;
        let total: number = 0;
        for (const [image, weight] of weights) {
            const natural: Natural | undefined = this.colors.colorValue(image, style) === undefined ? this.natural(image, style) : undefined;
            if (natural !== undefined && natural[0] !== undefined && natural[1] !== undefined) {
                width += natural[0] * weight;
                height += natural[1] * weight;
                total += weight;
            }
        }
        return total > 0 ? [width / total, height / total, height > 0 ? width / height : undefined] : NO_NATURAL;
    }

    private crossFade(value: FunctionValue, target: readonly [number, number, number, number], style: ComputedStyle, pdf: PdfPage): void {
        // §2.6.2: the weighted average of premultiplied pixels. ISO 32000-2 §11.4.6: an isolated knockout group, each image with the shape
        // w / (sum of the weights so far). Over opaque images the opacity w / (sum so far) gives the same average, which viewers without knockout draw.
        const [weights, leftover] = this.weights(value);
        const present: ReadonlyArray<readonly [CssValue, number]> = weights.filter((part: readonly [CssValue, number]) => part[1] > 0);
        const knockout: boolean = present.length > 1 && !present.every((part: readonly [CssValue, number]) => this.opaque(part[0], style));
        const area: readonly [number, number, number, number] = [target[0], target[1], target[2], target[3]];
        const group: PdfPage = this.document.startForm(area[2], area[3], false);
        let sum: number = 0;
        for (const [image, weight] of present) {
            sum += weight;
            const element: PdfPage = this.document.startForm(area[2], area[3], false);
            if (this.colors.colorValue(image, style) !== undefined) {
                element.content.save();
                if (this.colors.fill(image, style, element)) {
                    element.content.rectangle(area[0], area[1], area[2], area[3]);
                    element.content.fill(false);
                }
                element.content.restore();
            } else {
                this.paintImage(image, area, style, element);
            }
            group.content.save();
            group.content.graphicsState(knockout ? group.useShape(weight / sum) : group.useState(weight / sum, 1, "Normal"));
            group.content.paintXObject(group.useImage(this.document.finishForm(element, area, PathGeometry.IDENTITY)));
            group.content.restore();
        }
        pdf.content.save();
        if (leftover > 0) {
            pdf.content.graphicsState(pdf.useState(1 - leftover, 1, "Normal"));
        }
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(group, area, PathGeometry.IDENTITY, undefined, knockout)));
        pdf.content.restore();
    }

    private opaque(image: CssValue, style: ComputedStyle): boolean {
        // A color or a gradient whose colors are all opaque; an image file may have transparent pixels.
        const color: ColorValue | undefined = this.colors.colorValue(image, style);
        if (color !== undefined) {
            return (color.alpha ?? 0) >= 1;
        }
        if (image.kind !== "function" || !GradientPainter.NAMES.has(image.name)) {
            return false;
        }
        return image.args.every((argument: CssValue) => {
            const first: CssValue = argument.kind === "list" && argument.separator === "space" ? argument.items[0] : argument;
            const stop: ColorValue | undefined = this.colors.colorValue(first, style);
            return stop === undefined || (stop.alpha ?? 0) >= 1;
        });
    }

    private image(fragment: BoxFragment): CssValue | undefined {
        const content: BoxNode | undefined = fragment.box.children.find((node: BoxNode) => node.kind === "deferred");
        return content !== undefined && content.kind === "deferred" ? content.value : undefined;
    }

    unclipped(fragment: BoxFragment): boolean {
        const value: CssValue | undefined = this.image(fragment);
        return value !== undefined && value.kind === "url" && this.images.unclipped(value.href);
    }

    paint(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage, page?: Rectangle): ImageMarks {
        // The result is the links and the destinations inside the image, where the image is drawn; the page box is given where
        // a fixed background inside the image is placed by it.
        const value: CssValue | undefined = this.image(fragment);
        if (value === undefined) {
            return NO_MARKS;
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        // The sizes of the fragment are in the axes of its container and its edges in its own, which an orthogonal flow turns.
        const turned: boolean = this.sizes.isOrthogonal(this.sizes.frame(fragment.box.style), frame);
        const inlineSize: number = (turned ? fragment.blockSize : fragment.inlineSize) - this.edge(fragment, INLINE_START) - this.edge(fragment, INLINE_END);
        const blockSize: number = (turned ? fragment.inlineSize : fragment.blockSize) - this.edge(fragment, BLOCK_START) - this.edge(fragment, BLOCK_END);
        const area: ObjectArea = fragment.object ?? [0, 0, inlineSize, blockSize];
        const box: readonly [number, number, number, number] = this.sizes.mapped(inner, 0, 0, inlineSize, blockSize);
        const target: readonly [number, number, number, number] = this.sizes.mapped(inner, area[0], area[1], area[2], area[3]);
        if (value.kind !== "url") {
            pdf.content.save();
            pdf.content.rectangle(box[0], box[1], box[2], box[3]);
            pdf.content.clip(false);
            this.paintImage(value, target, fragment.box.style, pdf);
            pdf.content.restore();
            return NO_MARKS;
        }
        const unclipped: boolean = this.images.unclipped(value.href);
        if ((target[2] <= 0 || target[3] <= 0) && !unclipped) {
            return NO_MARKS;
        }
        const natural: readonly [number, number, number, number] | undefined = fragment.natural === undefined ? undefined
            : this.sizes.mapped(inner, 0, 0, fragment.natural[0], fragment.natural[1]);
        pdf.content.save();
        if (!unclipped) {
            pdf.content.rectangle(box[0], box[1], box[2], box[3]);
            pdf.content.clip(false);
        }
        const marks: ImageMarks = this.draw(value.href, [target[0], target[1], target[2], target[3]], fragment.box.style.values, false, pdf,
            natural === undefined ? undefined : [natural[2], natural[3]], page);
        pdf.content.restore();
        return marks;
    }

    draw(href: string, target: readonly [number, number, number, number], values: Readonly<Record<string, CssValue>>, decorative: boolean, pdf: PdfPage,
        natural?: readonly [number, number], page?: Rectangle): ImageMarks {
        // The image fills the target, given as x, y, width and height on the page; the result is the links and destinations inside it. Exif 2.32
        // §4.6.4: each orientation puts the stored column s and row t of a point at X = xs s + xt t + x0 across and Y = ys s + yt t + y0 down the image.
        const [xs, xt, x0, ys, yt, y0]: readonly [number, number, number, number, number, number] = ORIENTATIONS[this.orientation(values["image-orientation"], href, decorative) - 1];
        const [x, y, width, height] = target;
        // A form with ink outside a box of no size cannot be scaled to it, so its matrix and this one keep the scale 1 in that axis.
        const across: number = width > 0 ? width : 1;
        const down: number = height > 0 ? height : 1;
        // ISO 32000-2 §8.9.4: an image fills the unit square with its first row at the top, so s = u and t = 1 - v; the page
        // has y going down.
        const matrix: readonly [number, number, number, number, number, number] = [across * xs, down * ys, -across * xt, -down * yt, x + width * (x0 + xt),
            y + height * (y0 + yt)];
        // CSS Images 3 §5.2: the multiple of pixelated is taken along the axes of the stored image, which a turn swaps.
        const rendering: CssValue | undefined = values["image-rendering"];
        const keyword: string = rendering !== undefined && rendering.kind === "ident" ? rendering.lower : "auto";
        const shown: readonly [number, number] = this.images.multiple(keyword, [target[2], target[3]], natural ?? [0, 0]);
        const drawing: ImageDrawing = { width: target[2], height: target[3], scale: 1, rendering: keyword, multiple: xs === 0 ? [shown[1], shown[0]] : shown };
        const unit: readonly [number, number, number, number] | undefined = page === undefined ? undefined : this.unitArea(page, matrix);
        if (unit !== undefined) {
            drawing.page = unit;
        }
        const resource: ImageResource | undefined = this.images.image(href, drawing);
        if (resource === undefined) {
            return NO_MARKS;
        }
        pdf.content.save();
        pdf.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        pdf.content.paintXObject(pdf.useImage(resource));
        pdf.content.restore();
        if (resource.links === undefined && resource.destinations === undefined) {
            return NO_MARKS;
        }
        return {
            links: (resource.links ?? []).map(([area, name, internal]: readonly [PageRectangle, string, boolean]): readonly [PageRectangle, string, boolean] =>
                [this.placed(area, matrix), name, internal]),
            destinations: (resource.destinations ?? []).map(([name, u, v]: readonly [string, number, number]): readonly [string, number, number] =>
                [name, matrix[0] * u + matrix[2] * (1 - v) + matrix[4], matrix[1] * u + matrix[3] * (1 - v) + matrix[5]])
        };
    }

    private unitArea(page: Rectangle, matrix: readonly [number, number, number, number, number, number]): readonly [number, number, number, number] | undefined {
        // The page box in the unit square of the image, with v going down; the orientations turn by quarter turns, so the corners taken back
        // by the inverse of the matrix bound it exactly.
        const determinant: number = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        if (determinant === 0) {
            return undefined;
        }
        const us: Array<number> = [];
        const vs: Array<number> = [];
        for (const px of [page.x, page.x + page.width]) {
            for (const py of [page.y, page.y + page.height]) {
                const dx: number = px - matrix[4];
                const dy: number = py - matrix[5];
                us.push((matrix[3] * dx - matrix[2] * dy) / determinant);
                vs.push(1 - (matrix[0] * dy - matrix[1] * dx) / determinant);
            }
        }
        const left: number = Math.min(...us);
        const top: number = Math.min(...vs);
        return [left, top, Math.max(...us) - left, Math.max(...vs) - top];
    }

    private placed(area: PageRectangle, matrix: readonly [number, number, number, number, number, number]): PageRectangle {
        // A link area is given in the unit square with v going down, where the image has t = 1 - v; its corners on the page
        // bound the area there.
        const across: Array<number> = [];
        const down: Array<number> = [];
        for (const u of [area.x, area.x + area.width]) {
            for (const v of [area.y, area.y + area.height]) {
                across.push(matrix[0] * u + matrix[2] * (1 - v) + matrix[4]);
                down.push(matrix[1] * u + matrix[3] * (1 - v) + matrix[5]);
            }
        }
        const left: number = Math.min(...across);
        const top: number = Math.min(...down);
        return { x: left, y: top, width: Math.max(...across) - left, height: Math.max(...down) - top };
    }

    private orientation(value: CssValue | undefined, href: string, decorative: boolean): number {
        // CSS Images 3 §5.1: flip mirrors the image after the turn; an angle or flip "only applies to content images", and
        // decorative images behave as from-image.
        const items: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" ? value.items : [value]);
        const first: CssValue | undefined = items[0];
        if (first !== undefined && first.kind === "ident" && first.lower === "none") {
            return 1;
        }
        if (first === undefined || (first.kind === "ident" && first.lower === "from-image") || decorative) {
            const size: ImageSize | undefined = this.images.size(href);
            return size?.orientation ?? 1;
        }
        let turns: number = 0;
        let flip: boolean = false;
        for (const item of items) {
            if (item.kind === "dimension") {
                turns = ((Math.round(item.value / 90) % 4) + 4) % 4;
            } else if (item.kind === "ident" && item.lower === "flip") {
                flip = true;
            }
        }
        return flip ? [2, 5, 4, 7][turns] : [1, 6, 3, 8][turns];
    }

    private edge(fragment: BoxFragment, side: number): number {
        return (fragment.border === undefined ? 0 : fragment.border[side]) + (fragment.padding === undefined ? 0 : fragment.padding[side]);
    }
}
