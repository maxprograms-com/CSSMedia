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
import type { ImagePainter } from "./ImagePainter.js";

export interface BackgroundPlace {
    base: Matrix;
    page?: Rectangle;
    whole?: readonly [Rectangle, PhysicalSides, PhysicalSides];
    shapes?: (pdf: PdfPage, text: boolean, border: boolean) => void;
}

const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];
const NO_SIDES: PhysicalSides = [0, 0, 0, 0];
const UNPLACED: BackgroundPlace = { base: PathGeometry.IDENTITY };
export class BackgroundPainter {

    static readonly BLEND_MODES: ReadonlyMap<string, string> = new Map<string, string>([
        ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["color-dodge", "ColorDodge"],
        ["color-burn", "ColorBurn"], ["hard-light", "HardLight"], ["soft-light", "SoftLight"], ["difference", "Difference"], ["exclusion", "Exclusion"],
        ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"]
    ]);

    private readonly colors: ColorOutput;
    private readonly borders: BorderPainter;
    private readonly images: ImagePainter;
    private readonly document: PdfDocument;

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
        const blended: boolean = layers > 0 && this.list(values["background-blend-mode"]).some((mode: CssValue) => BackgroundPainter.BLEND_MODES.has(this.keyword(mode)));
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
            const mode: string | undefined = BackgroundPainter.BLEND_MODES.get(this.keyword(this.pick(values["background-blend-mode"], layer)));
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
        this.images.tile(image, {
            size: this.pick(values["background-size"], layer), x: this.pick(values["background-position-x"], layer), y: this.pick(values["background-position-y"], layer),
            repeatX: this.keyword(this.pick(values["background-repeat-x"], layer)), repeatY: this.keyword(this.pick(values["background-repeat-y"], layer))
        }, area, rectangle, place.base, style, pdf);
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
