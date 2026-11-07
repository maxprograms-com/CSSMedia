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

import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import type { ImageResource } from "../writer/PdfPage.js";
import type { ImageAlpha, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "./ImageFormats.js";

const CSS_PIXELS_PER_INCH: number = 96;
const METRES_PER_INCH: number = 0.0254;
const CORE_HEADER: number = 12;

export class BmpImage implements ImageFormat {

    private readonly images: ImageFormats;

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        const head: Buffer = read(0, 2);
        return head.length === 2 && head[0] === 0x42 && head[1] === 0x4D;
    }

    size(read: ImageReader): ImageSize | undefined {
        // The header after the 14 bytes of the file header has 16-bit sizes when it is the 12-byte core header, and 32-bit
        // ones otherwise, with a negative height for an image stored from the top and the pixels per metre after them.
        const header: Buffer = read(14, 32);
        if (header.length < CORE_HEADER) {
            return undefined;
        }
        if (header.readUInt32LE(0) === CORE_HEADER) {
            return this.images.rasterSize(false, header.readUInt16LE(4), header.readUInt16LE(6));
        }
        if (header.length < 32) {
            return undefined;
        }
        const across: number = header.readInt32LE(24);
        const down: number = header.readInt32LE(28);
        const density: readonly [number, number] | undefined = across > 0 && down > 0
            ? [across * METRES_PER_INCH / CSS_PIXELS_PER_INCH, down * METRES_PER_INCH / CSS_PIXELS_PER_INCH] : undefined;
        return this.images.rasterSize(false, header.readInt32LE(4), Math.abs(header.readInt32LE(8)), density);
    }

    key(): string {
        return "";
    }

    draw(request: ImageRequest): ImageResource | undefined {
        throw this.images.missing(request.href, "BMP decoding");
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "BMP decoding");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "BMP decoding");
    }
}
