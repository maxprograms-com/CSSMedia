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
import type { Matrix } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { Rectangle } from "../pdf/PageCanvas.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { BorderPainter, CornerRadii, PhysicalSides } from "./BorderPainter.js";
import type { ColorOutput } from "./ColorOutput.js";
import type { ImagePainter, Natural } from "./ImagePainter.js";

export interface BackgroundPlace {
    base: Matrix;
    page?: Rectangle;
    whole?: readonly [Rectangle, PhysicalSides, PhysicalSides];
    shapes?: (pdf: PdfPage, text: boolean, border: boolean) => void;
}

const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];
const NO_SIDES: PhysicalSides = [0, 0, 0, 0];
const UNPLACED: BackgroundPlace = { base: PathGeometry.IDENTITY };
const BLEND_MODES: ReadonlyMap<string, string> = new Map<string, string>([
    ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["color-dodge", "ColorDodge"],
    ["color-burn", "ColorBurn"], ["hard-light", "HardLight"], ["soft-light", "SoftLight"], ["difference", "Difference"], ["exclusion", "Exclusion"],
    ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"]
]);

export class BackgroundPainter {

    private readonly colors: ColorOutput;
    private readonly borders: BorderPainter;
    private readonly images: ImagePainter;
    private readonly document: PdfDocument;
    private readonly geometry: PathGeometry = new PathGeometry();

    constructor(colors: ColorOutput, borders: BorderPainter, images: ImagePainter, document: PdfDocument) {
        this.colors = colors;
        this.borders = borders;
        this.images = images;
        this.document = document;
    }

    paint(rectangle: Rectangle, borders: PhysicalSides, padding: PhysicalSides, style: ComputedStyle, pdf: PdfPage, clip?: string, radii: CornerRadii = NO_RADII,
        place: BackgroundPlace = UNPLACED): void {
        // CSS Backgrounds 4 §3: the color under all the layers, clipped as the bottom layer is, and the layers from the last to
        // the first. Compositing 1 §3.4: with a blend mode the layers blend with each other and the color in an isolated group.
        const values: Readonly<Record<string, CssValue>> = style.values;
        const images: ReadonlyArray<CssValue> = this.list(values["background-image"]);
        const layers: number = images.some((image: CssValue) => !(image.kind === "ident" && image.lower === "none")) ? images.length : 0;
        const blended: boolean = layers > 0 && this.list(values["background-blend-mode"]).some((mode: CssValue) => BLEND_MODES.has(this.keyword(mode)));
        let target: PdfPage = pdf;
        let base: Matrix = place.base;
        if (blended) {
            target = this.document.startForm(rectangle.width, rectangle.height, false);
            base = PathGeometry.IDENTITY;
        }
        const colorClip: CssValue = clip === undefined ? this.pick(values["background-clip"], images.length - 1) : { kind: "ident", name: clip, lower: clip };
        target.content.save();
        if (this.clipTo(colorClip, rectangle, borders, padding, radii, target, place)) {
            if (this.colors.fill(values["background-color"], style, target)) {
                target.content.rectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
                target.content.fill(false);
            }
        }
        target.content.restore();
        for (let layer: number = layers - 1; layer >= 0; layer--) {
            const image: CssValue = images[layer];
            if (image.kind === "ident" && image.lower === "none") {
                continue;
            }
            target.content.save();
            const mode: string | undefined = BLEND_MODES.get(this.keyword(this.pick(values["background-blend-mode"], layer)));
            if (mode !== undefined) {
                target.content.graphicsState(target.useState(1, 1, mode));
            }
            const clip: CssValue = this.pick(values["background-clip"], layer);
            if (this.clipTo(clip, rectangle, borders, padding, radii, target, place)) {
                const masked: boolean = this.list(clip, " ").some((word: CssValue) => this.keyword(word) === "text" || this.keyword(word) === "border-area");
                if (masked) {
                    // Cairo and Quartz lose a soft mask over a tiling pattern, and keep it over a form that holds one.
                    const form: PdfPage = this.document.startForm(rectangle.width, rectangle.height, false);
                    this.layer(image, layer, rectangle, borders, padding, style, form, { ...place, base: PathGeometry.IDENTITY });
                    target.content.paintXObject(target.useImage(this.document.finishForm(form, [rectangle.x, rectangle.y, rectangle.width, rectangle.height],
                        PathGeometry.IDENTITY)));
                } else {
                    this.layer(image, layer, rectangle, borders, padding, style, target, { ...place, base });
                }
            }
            target.content.restore();
        }
        if (blended) {
            pdf.content.paintXObject(pdf.useImage(this.document.finishForm(target, [rectangle.x, rectangle.y, rectangle.width, rectangle.height], PathGeometry.IDENTITY)));
        }
    }

    private clipTo(value: CssValue, rectangle: Rectangle, borders: PhysicalSides, padding: PhysicalSides, radii: CornerRadii, pdf: PdfPage, place: BackgroundPlace): boolean {
        // CSS Backgrounds 4 §2.8: the painting area is a box, or the text, or the area the border paints, or both, inside the
        // border box; the shapes of the text and the border make an alpha mask.
        const words: ReadonlyArray<string> = this.list(value, " ").map((item: CssValue) => this.keyword(item));
        const text: boolean = words.includes("text");
        const border: boolean = words.includes("border-area");
        const box: string = text || border ? "border-box" : words[0];
        const inset: PhysicalSides = box === "content-box" ? [borders[0] + padding[0], borders[1] + padding[1], borders[2] + padding[2], borders[3] + padding[3]]
            : (box === "padding-box" ? borders : NO_SIDES);
        const shape: readonly [Rectangle, CornerRadii] = this.borders.inner(rectangle, inset, radii);
        if (shape[0].width <= 0 || shape[0].height <= 0) {
            return false;
        }
        this.borders.shape(shape[0], shape[1], pdf);
        pdf.content.clip(false);
        if (text || border) {
            if (place.shapes === undefined) {
                throw new Error("The painting of background-clip: " + words.join(" ") + " in a formula is not implemented");
            }
            const mask: PdfPage = this.document.startForm(rectangle.width, rectangle.height, false);
            place.shapes(mask, text, border);
            this.document.applyMask(pdf, mask, [rectangle.x, rectangle.y, rectangle.width, rectangle.height], false);
        }
        return true;
    }

    private layer(image: CssValue, layer: number, rectangle: Rectangle, borders: PhysicalSides, padding: PhysicalSides, style: ComputedStyle, pdf: PdfPage,
        place: BackgroundPlace): void {
        const values: Readonly<Record<string, CssValue>> = style.values;
        const natural: Natural | undefined = this.images.natural(image, style);
        if (natural === undefined) {
            return;
        }
        // §2.9: the positioning area is a box of the element, of the whole element when it is sliced; §2.5: with fixed it is
        // the page box, since "a fixed background is fixed with respect to the page box".
        const attachment: string = this.keyword(this.pick(values["background-attachment"], layer));
        let area: Rectangle;
        if (attachment === "fixed" && place.page !== undefined) {
            area = place.page;
        } else {
            const [whole, wholeBorders, wholePadding] = place.whole ?? [rectangle, borders, padding];
            const origin: string = this.keyword(this.pick(values["background-origin"], layer));
            const inset: PhysicalSides = origin === "content-box" ? [wholeBorders[0] + wholePadding[0], wholeBorders[1] + wholePadding[1], wholeBorders[2] + wholePadding[2],
                wholeBorders[3] + wholePadding[3]] : (origin === "border-box" ? NO_SIDES : wholeBorders);
            area = this.borders.inner(whole, inset, NO_RADII)[0];
        }
        const repeatX: string = this.keyword(this.pick(values["background-repeat-x"], layer));
        const repeatY: string = this.keyword(this.pick(values["background-repeat-y"], layer));
        const size: readonly [number, number] = this.size(this.pick(values["background-size"], layer), natural, area, repeatX === "round", repeatY === "round");
        if (!(size[0] > 0) || !(size[1] > 0)) {
            return;
        }
        const rtl: boolean = this.keyword(values["direction"]) === "rtl";
        const mode: string = this.keyword(values["writing-mode"]);
        const vertical: boolean = mode !== "horizontal-tb" && mode !== "none";
        const flipped: boolean = vertical && mode.endsWith("-rl");
        const x: readonly [number, number] = this.axis(this.pick(values["background-position-x"], layer), area.x, area.width, size[0], repeatX,
            vertical ? flipped : rtl);
        const y: readonly [number, number] = this.axis(this.pick(values["background-position-y"], layer), area.y, area.height, size[1], repeatY, vertical && rtl);
        const tile: readonly [number, number, number, number] = [x[0], y[0], size[0], size[1]];
        const across: boolean = repeatX !== "no-repeat" && x[1] > 0;
        const down: boolean = repeatY !== "no-repeat" && y[1] > 0;
        if (!across && !down) {
            this.images.paintImage(image, tile, style, pdf);
            return;
        }
        // §2.3: a repeated image covers the painting area, so it is a tiling pattern; an axis that does not repeat keeps one
        // band of tiles. ISO 32000-2 §8.7.3.1: the pattern matrix maps the cell to the default space of the content stream.
        if (!across || !down) {
            pdf.content.rectangle(across ? rectangle.x : tile[0], down ? rectangle.y : tile[1], across ? rectangle.width : tile[2], down ? rectangle.height : tile[3]);
            pdf.content.clip(false);
        }
        const stepX: number = across ? x[1] : tile[2];
        const stepY: number = down ? y[1] : tile[3];
        const cell: PdfPage = this.document.startForm(stepX, stepY, false);
        this.images.paintImage(image, [0, 0, tile[2], tile[3]], style, cell);
        if (place.base !== PathGeometry.IDENTITY) {
            const matrix: Matrix = this.geometry.concat(place.base, this.geometry.translation(tile[0], tile[1]));
            const pattern: string = pdf.usePattern(this.document.finishPattern(cell, [0, 0, stepX, stepY], matrix));
            pdf.content.fillPattern(pattern);
            pdf.content.rectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
            pdf.content.fill(false);
            return;
        }
        // Quartz places a tiling pattern inside a form XObject apart from where the other viewers do, so there the tile is a
        // form painted at each place it repeats over the painting area.
        const form: string = pdf.useImage(this.document.finishForm(cell, [0, 0, stepX, stepY], PathGeometry.IDENTITY));
        const first: (start: number, step: number, from: number) => number = (start: number, step: number, from: number): number => Math.floor((from - start) / step);
        const columns: readonly [number, number] = across ? [first(tile[0], stepX, rectangle.x), first(tile[0], stepX, rectangle.x + rectangle.width)] : [0, 0];
        const rows: readonly [number, number] = down ? [first(tile[1], stepY, rectangle.y), first(tile[1], stepY, rectangle.y + rectangle.height)] : [0, 0];
        for (let row: number = rows[0]; row <= rows[1]; row++) {
            for (let column: number = columns[0]; column <= columns[1]; column++) {
                pdf.content.save();
                pdf.content.transform(1, 0, 0, 1, tile[0] + column * stepX, tile[1] + row * stepY);
                pdf.content.paintXObject(form);
                pdf.content.restore();
            }
        }
    }

    private size(value: CssValue, natural: Natural, area: Rectangle, roundX: boolean, roundY: boolean): readonly [number, number] {
        // §2.10: cover and contain keep the natural aspect ratio; an auto dimension comes from the ratio and the other
        // dimension, or the natural size, or 100%; both auto take the natural size, or contain without one. With round the
        // size is rescaled to fit a whole number of times, and an auto dimension keeps the ratio.
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
        // §2.6: a percentage is of the area less the image, an offset is from the edge it names, the start of the axis by default;
        // §2.3: space puts as many whole images as fit with the first and last on the edges, and needs two of them.
        // The result is the start of one tile and the distance between tiles, zero when the image is not repeated.
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

    private pick(value: CssValue | undefined, layer: number): CssValue {
        // §3: a list shorter than the layers repeats.
        const items: ReadonlyArray<CssValue> = this.list(value);
        return items.length === 0 ? { kind: "ident", name: "", lower: "" } : items[layer % items.length];
    }

    private list(value: CssValue | undefined, separator: string = ","): ReadonlyArray<CssValue> {
        if (value === undefined) {
            return [];
        }
        return value.kind === "list" && value.separator === (separator === "," ? "comma" : "space") ? value.items : [value];
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }
}
