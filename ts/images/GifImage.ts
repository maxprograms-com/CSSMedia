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

export class GifImage implements ImageFormat {

    private readonly images: ImageFormats;

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        return read(0, 4).toString("latin1") === "GIF8";
    }

    size(read: ImageReader): ImageSize | undefined {
        // GIF89a §17 and §18: the logical screen descriptor follows the six bytes of the signature and the version.
        const head: Buffer = read(0, 10);
        return head.length < 10 ? undefined : this.images.rasterSize(false, head.readUInt16LE(6), head.readUInt16LE(8));
    }

    key(): string {
        return "";
    }

    draw(request: ImageRequest): ImageResource | undefined {
        throw this.images.missing(request.href, "GIF decoding");
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "GIF decoding");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "GIF decoding");
    }
}
