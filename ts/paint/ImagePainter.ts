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
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ImageFormats, ImageSize } from "../images/ImageFormats.js";
import type { BoxSizes, Transform } from "../layout/BoxSizes.js";
import type { BoxFragment, ObjectArea } from "../layout/Fragment.js";
import type { BoxNode } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import type { ColorOutput } from "./ColorOutput.js";
import { GradientPainter } from "./GradientPainter.js";

export type Natural = readonly [number | undefined, number | undefined, number | undefined];

const NO_LINKS: ReadonlyArray<readonly [PageRectangle, string, boolean]> = [];
const NO_NATURAL: Natural = [undefined, undefined, undefined];
const SUPPORTED_TYPES: ReadonlySet<string> = new Set<string>([
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff", "image/jp2", "image/svg+xml", "application/mathml+xml"
]);
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
            return this.images.natural(image.href, style.values, style.zoom ?? 1, true, undefined, density);
        }
        if (image.kind === "function" && image.name === "cross-fade") {
            return this.crossFadeSize(image, style);
        }
        return NO_NATURAL;
    }

    paintImage(value: CssValue, target: readonly [number, number, number, number], style: ComputedStyle, pdf: PdfPage): void {
        // The image drawn at its concrete object size, the target, given as x, y, width and height.
        const chosen: readonly [CssValue, number | undefined] | undefined = this.chosen(value, style);
        if (chosen === undefined || target[2] <= 0 || target[3] <= 0) {
            return;
        }
        const image: CssValue = chosen[0];
        if (image.kind === "url") {
            const natural: Natural | undefined = this.images.natural(image.href, style.values, style.zoom ?? 1, true, undefined, chosen[1]);
            const size: readonly [number, number] | undefined = natural?.[0] !== undefined && natural[1] !== undefined ? [natural[0], natural[1]] : undefined;
            pdf.content.save();
            pdf.content.rectangle(target[0], target[1], target[2], target[3]);
            pdf.content.clip(false);
            this.draw(image.href, target, style.values, true, pdf, size);
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

    private chosen(value: CssValue, style: ComputedStyle): readonly [CssValue, number | undefined] | undefined {
        // CSS Images 4 §2.4: image-set() represents one of its options; its resolution is the natural resolution of a raster
        // image. §2.5.1: an image() whose image cannot be shown is its color, if it has one.
        if (value.kind === "url") {
            return this.images.size(value.href) === undefined ? undefined : [value, undefined];
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
        // §2.4: options of an unsupported type are removed, then those with the resolution of an earlier one; the choice among
        // the rest is the user agent's, and a PDF for print takes the one of the highest resolution.
        // A resolution left out selects as 1x but supplies no natural resolution, so the image's own one is honored.
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
        return source.kind === "url" ? source.href : (source.kind === "string" ? source.value : "");
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
        const direction: CssValue | undefined = style.values["direction"];
        const rtl: boolean = direction !== undefined && direction.kind === "ident" && direction.lower === "rtl";
        const flip: boolean = tag !== undefined && tag.kind === "ident" && (tag.lower === "rtl") !== rtl && (tag.lower === "ltr" || tag.lower === "rtl");
        const mode: CssValue | undefined = style.values["writing-mode"];
        const vertical: boolean = mode !== undefined && mode.kind === "ident" && mode.lower !== "horizontal-tb";
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
        // §2.6.2: the weighted average of the premultiplied pixels of the images, each rescaled to the size, and of a transparent
        // image for what is left over. ISO 32000-2 §11.4.6: an isolated knockout group composites each element with the
        // transparent backdrop and mixes the result with the ones before by the element's shape, which alpha is with AIS, so
        // each image painted with the shape w / (sum of the weights so far) leaves the average.
        // Over opaque images the next one painted with the opacity w / (sum of the weights so far) leaves the same average with
        // no knockout, which some viewers do not draw; so does one image alone.
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

    paint(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): ReadonlyArray<readonly [PageRectangle, string, boolean]> {
        // The result is the links inside the image, as areas where the image is drawn, a destination name or a URI.
        const value: CssValue | undefined = this.image(fragment);
        if (value === undefined) {
            return NO_LINKS;
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const inlineSize: number = fragment.inlineSize - this.edge(fragment, INLINE_START) - this.edge(fragment, INLINE_END);
        const blockSize: number = fragment.blockSize - this.edge(fragment, BLOCK_START) - this.edge(fragment, BLOCK_END);
        const area: ObjectArea = fragment.object ?? [0, 0, inlineSize, blockSize];
        const box: readonly [number, number, number, number] = this.sizes.mapped(inner, 0, 0, inlineSize, blockSize);
        const target: readonly [number, number, number, number] = this.sizes.mapped(inner, area[0], area[1], area[2], area[3]);
        if (value.kind !== "url") {
            pdf.content.save();
            pdf.content.rectangle(box[0], box[1], box[2], box[3]);
            pdf.content.clip(false);
            this.paintImage(value, target, fragment.box.style, pdf);
            pdf.content.restore();
            return NO_LINKS;
        }
        const unclipped: boolean = this.images.unclipped(value.href);
        if ((target[2] <= 0 || target[3] <= 0) && !unclipped) {
            return NO_LINKS;
        }
        const natural: readonly [number, number, number, number] | undefined = fragment.natural === undefined ? undefined
            : this.sizes.mapped(inner, 0, 0, fragment.natural[0], fragment.natural[1]);
        pdf.content.save();
        if (!unclipped) {
            pdf.content.rectangle(box[0], box[1], box[2], box[3]);
            pdf.content.clip(false);
        }
        const links: ReadonlyArray<readonly [PageRectangle, string, boolean]> = this.draw(value.href, [target[0], target[1], target[2], target[3]],
            fragment.box.style.values, false, pdf, natural === undefined ? undefined : [natural[2], natural[3]]);
        pdf.content.restore();
        return links;
    }

    draw(href: string, target: readonly [number, number, number, number], values: Readonly<Record<string, CssValue>>, decorative: boolean, pdf: PdfPage,
        natural?: readonly [number, number]): ReadonlyArray<readonly [PageRectangle, string, boolean]> {
        // The image fills the target, given as x, y, width and height on the page; the result is the links inside it.
        // Exif 2.32 §4.6.4: each orientation puts the stored column s and row t of a point at X = xs s + xt t + x0 across
        // and Y = ys s + yt t + y0 down the displayed image.
        const [xs, xt, x0, ys, yt, y0]: readonly [number, number, number, number, number, number] = ORIENTATIONS[this.orientation(values["image-orientation"], href, decorative) - 1];
        // CSS Images 3 §5.2: the multiple of pixelated is taken along the axes of the stored image, which a turn swaps.
        const rendering: CssValue | undefined = values["image-rendering"];
        const keyword: string = rendering !== undefined && rendering.kind === "ident" ? rendering.lower : "auto";
        const shown: readonly [number, number] = this.images.multiple(keyword, [target[2], target[3]], natural ?? [0, 0]);
        const resource: ImageResource | undefined = this.images.image(href, {
            width: target[2], height: target[3], scale: 1, rendering: keyword, multiple: xs === 0 ? [shown[1], shown[0]] : shown
        });
        if (resource === undefined) {
            return NO_LINKS;
        }
        const [x, y, width, height] = target;
        // A form with ink outside a box of no size cannot be scaled to it, so its matrix and this one keep the scale 1 in that axis.
        const across: number = width > 0 ? width : 1;
        const down: number = height > 0 ? height : 1;
        // ISO 32000-2 §8.9.4: an image fills the unit square with its first row at the top, so s = u and t = 1 - v; the page
        // has y going down.
        const matrix: readonly [number, number, number, number, number, number] = [across * xs, down * ys, -across * xt, -down * yt, x + width * (x0 + xt),
            y + height * (y0 + yt)];
        pdf.content.save();
        pdf.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        pdf.content.paintXObject(pdf.useImage(resource));
        pdf.content.restore();
        return resource.links === undefined ? NO_LINKS : resource.links.map(([area, name, internal]: readonly [PageRectangle, string, boolean]):
            readonly [PageRectangle, string, boolean] => [this.placed(area, matrix), name, internal]);
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
