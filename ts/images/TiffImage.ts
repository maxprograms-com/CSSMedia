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
import { TiffTags } from "./TiffTags.js";

export class TiffImage implements ImageFormat {

    private readonly images: ImageFormats;
    private readonly tags: TiffTags = new TiffTags();

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        const tag: string = read(0, 4).toString("latin1");
        return tag === "II*\u0000" || tag === "MM\u0000*";
    }

    size(read: ImageReader): ImageSize | undefined {
        const tags: ReadonlyMap<number, number> | undefined = this.tags.read(read, 0);
        if (tags === undefined) {
            return undefined;
        }
        const size: ImageSize | undefined = this.images.rasterSize(this.tags.isTurned(tags), tags.get(TiffTags.WIDTH), tags.get(TiffTags.HEIGHT), this.tags.density(tags));
        const orientation: number | undefined = this.tags.orientation(tags);
        if (size !== undefined && orientation !== undefined) {
            size.orientation = orientation;
        }
        return size;
    }

    key(): string {
        return "";
    }

    draw(request: ImageRequest): ImageResource | undefined {
        throw this.images.missing(request.href, "TIFF decoding");
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "TIFF decoding");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "TIFF decoding");
    }
}
