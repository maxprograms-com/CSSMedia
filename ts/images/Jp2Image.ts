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
import type { ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "./ImageFormats.js";
import type { IsoBox } from "./IsoBoxes.js";
import { IsoBoxes } from "./IsoBoxes.js";

const JP2_SIGNATURE: Buffer = Buffer.from([0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A]);
const CODESTREAM: Buffer = Buffer.from([0xFF, 0x4F, 0xFF, 0x51]);

export class Jp2Image implements ImageFormat {

    private readonly images: ImageFormats;
    private readonly boxes: IsoBoxes = new IsoBoxes();

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        return read(0, JP2_SIGNATURE.length).equals(JP2_SIGNATURE) || read(0, CODESTREAM.length).equals(CODESTREAM);
    }

    size(read: ImageReader): ImageSize | undefined {
        const header: readonly [number, number] | undefined = this.header(read);
        return header === undefined ? undefined : this.images.rasterSize(false, header[0], header[1]);
    }

    key(drawing: ImageDrawing): string {
        return this.images.rasterKey(drawing);
    }

    draw(request: ImageRequest): ImageResource | undefined {
        // ISO 32000-2 §7.4.9: JPXDecode reads "a full JPX file structure", which a bare codestream lacks; a JP2 file goes in as
        // it is, without ColorSpace or BitsPerComponent, which "these packagings contain".
        const data: Buffer = request.data;
        if (data.subarray(0, CODESTREAM.length).equals(CODESTREAM)) {
            throw this.images.missing(request.href, "putting a JPEG 2000 codestream in a JP2 file");
        }
        if (this.images.isMultiple(request)) {
            throw this.images.missing(request.href, "JPEG 2000 decoding");
        }
        const header: readonly [number, number] | undefined = this.header((position: number, length: number) => data.subarray(position, position + length));
        if (header === undefined) {
            this.images.report(request.href, "is a JPEG 2000 file without an image header box");
            return undefined;
        }
        const object: number = this.images.document.file.addStream("/Type /XObject /Subtype /Image /Width " + header[0] + " /Height " + header[1] + " /Filter /JPXDecode"
            + (this.images.interpolates(request.rendering) ? " /Interpolate true" : ""), data, false);
        return { key: "Im" + object, object, width: header[0], height: header[1] };
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "JPEG 2000 decoding");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "JPEG 2000 decoding");
    }

    private header(read: ImageReader): readonly [number, number] | undefined {
        // The image header box inside the JP2 header box holds the height before the width.
        for (const box of this.boxes.children(read, 0, Number.MAX_SAFE_INTEGER)) {
            if (box[0] !== "jp2h") {
                continue;
            }
            const header: IsoBox | undefined = this.boxes.children(read, box[1], box[2]).find((child: IsoBox) => child[0] === "ihdr");
            const fields: Buffer = header === undefined ? Buffer.alloc(0) : read(header[1], 8);
            return fields.length === 8 ? [fields.readUInt32BE(4), fields.readUInt32BE(0)] : undefined;
        }
        return undefined;
    }
}
