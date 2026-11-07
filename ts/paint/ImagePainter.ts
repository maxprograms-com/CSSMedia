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
import type { ImageFormats, ImageSize } from "../images/ImageFormats.js";
import type { BoxSizes, Transform } from "../layout/BoxSizes.js";
import type { BoxFragment, ObjectArea } from "../layout/Fragment.js";
import type { BoxNode } from "../pdf/BoxTree.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";

const NO_LINKS: ReadonlyArray<readonly [PageRectangle, string, boolean]> = [];
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

    constructor(images: ImageFormats, sizes: BoxSizes) {
        this.images = images;
        this.sizes = sizes;
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
        if (value === undefined || value.kind !== "url") {
            if (value !== undefined) {
                throw new Error("The painting of the image " + (value.kind === "function" ? value.name + "()" : "value") + " is not implemented");
            }
            return NO_LINKS;
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const inlineSize: number = fragment.inlineSize - this.edge(fragment, INLINE_START) - this.edge(fragment, INLINE_END);
        const blockSize: number = fragment.blockSize - this.edge(fragment, BLOCK_START) - this.edge(fragment, BLOCK_END);
        const area: ObjectArea = fragment.object ?? [0, 0, inlineSize, blockSize];
        const box: readonly [number, number, number, number] = this.sizes.mapped(inner, 0, 0, inlineSize, blockSize);
        const target: readonly [number, number, number, number] = this.sizes.mapped(inner, area[0], area[1], area[2], area[3]);
        const unclipped: boolean = this.images.unclipped(value.href);
        if ((target[2] <= 0 || target[3] <= 0) && !unclipped) {
            return NO_LINKS;
        }
        // Exif 2.32 §4.6.4: each orientation puts the stored column s and row t of a point at X = xs s + xt t + x0 across
        // and Y = ys s + yt t + y0 down the displayed image.
        const [xs, xt, x0, ys, yt, y0]: readonly [number, number, number, number, number, number] = ORIENTATIONS[this.orientation(fragment.box.style.values["image-orientation"], value.href) - 1];
        // CSS Images 3 §5.2: the multiple of pixelated is taken along the axes of the stored image, which a turn swaps.
        const rendering: CssValue | undefined = fragment.box.style.values["image-rendering"];
        const keyword: string = rendering !== undefined && rendering.kind === "ident" ? rendering.lower : "auto";
        const natural: readonly [number, number, number, number] | undefined = fragment.natural === undefined ? undefined
            : this.sizes.mapped(inner, 0, 0, fragment.natural[0], fragment.natural[1]);
        const shown: readonly [number, number] = this.images.multiple(keyword, [target[2], target[3]], natural === undefined ? [0, 0] : [natural[2], natural[3]]);
        const resource: ImageResource | undefined = this.images.image(value.href, {
            width: target[2], height: target[3], scale: 1, rendering: keyword, multiple: xs === 0 ? [shown[1], shown[0]] : shown
        });
        if (resource === undefined) {
            return NO_LINKS;
        }
        const x: number = target[0];
        const y: number = target[1];
        const width: number = target[2];
        const height: number = target[3];
        // A form with ink outside a box of no size cannot be scaled to it, so its matrix and this one keep the scale 1 in that axis.
        const across: number = width > 0 ? width : 1;
        const down: number = height > 0 ? height : 1;
        // ISO 32000-2 §8.9.4: an image fills the unit square with its first row at the top, so s = u and t = 1 - v; the page
        // has y going down.
        const matrix: readonly [number, number, number, number, number, number] = [across * xs, down * ys, -across * xt, -down * yt, x + width * (x0 + xt),
            y + height * (y0 + yt)];
        pdf.content.save();
        if (!unclipped) {
            pdf.content.rectangle(box[0], box[1], box[2], box[3]);
            pdf.content.clip(false);
        }
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

    private orientation(value: CssValue | undefined, href: string): number {
        // CSS Images 3 §5.1: flip mirrors the image after the turn.
        const items: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" ? value.items : [value]);
        const first: CssValue | undefined = items[0];
        if (first === undefined || (first.kind === "ident" && first.lower === "from-image")) {
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
