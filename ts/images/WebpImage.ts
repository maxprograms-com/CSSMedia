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
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { ImageResource } from "../writer/PdfPage.js";
import type { ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "./ImageFormats.js";
import type { LossyImage } from "./Vp8Decoder.js";
import { Vp8Decoder } from "./Vp8Decoder.js";
import type { LosslessImage } from "./Vp8lDecoder.js";
import { Vp8lDecoder } from "./Vp8lDecoder.js";

interface WebpFile {
    profile?: Buffer;
    alpha?: Buffer;
    image?: Buffer;
    lossless: boolean;
    animated: boolean;
}

const ANIMATION_FLAG: number = 0x02;
const RED_WEIGHT: number = 0.299;
const BLUE_WEIGHT: number = 0.114;
const GREEN_WEIGHT: number = 1 - RED_WEIGHT - BLUE_WEIGHT;
const LUMA_SCALE: number = 255 / 219;
const CHROMA_SCALE: number = 255 / 112;
const RED_FROM_CR: number = CHROMA_SCALE * (1 - RED_WEIGHT);
const BLUE_FROM_CB: number = CHROMA_SCALE * (1 - BLUE_WEIGHT);
const GREEN_FROM_CB: number = CHROMA_SCALE * (1 - BLUE_WEIGHT) * BLUE_WEIGHT / GREEN_WEIGHT;
const GREEN_FROM_CR: number = CHROMA_SCALE * (1 - RED_WEIGHT) * RED_WEIGHT / GREEN_WEIGHT;

export class WebpImage implements ImageFormat {

    private readonly images: ImageFormats;

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        const head: Buffer = read(0, 12);
        return head.length === 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP";
    }

    size(read: ImageReader): ImageSize | undefined {
        // RFC 9649 §2.5 to §2.7: the first chunk is VP8, VP8L or VP8X, and each keeps the size of the image in its own way.
        const chunk: Buffer = read(12, 18);
        if (chunk.length < 18) {
            return undefined;
        }
        const type: string = chunk.toString("latin1", 0, 4);
        if (type === "VP8X") {
            return this.images.rasterSize(false, 1 + chunk.readUIntLE(12, 3), 1 + chunk.readUIntLE(15, 3));
        }
        if (type === "VP8L") {
            const bits: number = chunk.readUInt32LE(9);
            return this.images.rasterSize(false, 1 + (bits & 0x3FFF), 1 + ((bits >>> 14) & 0x3FFF));
        }
        return type === "VP8 " ? this.images.rasterSize(false, chunk.readUInt16LE(14) & 0x3FFF, chunk.readUInt16LE(16) & 0x3FFF) : undefined;
    }

    key(drawing: ImageDrawing): string {
        return this.images.rasterKey(drawing);
    }

    draw(request: ImageRequest): ImageResource | undefined {
        const decoded: readonly [ImageSamples, ColorSpaceResource] | undefined = this.samples(request.href, request.data);
        if (decoded === undefined) {
            return undefined;
        }
        const image: ImageSamples = this.images.isMultiple(request) ? this.images.repeated(decoded[0], request.multiple) : decoded[0];
        return this.images.write(image, decoded[1], this.images.interpolates(request.rendering));
    }

    samples(href: string, data: Buffer): readonly [ImageSamples, ColorSpaceResource] | undefined {
        const file: WebpFile = this.read(data);
        if (file.animated) {
            throw this.images.missing(href, "the decoding of animated WebP images");
        }
        try {
            const image: ImageSamples = this.decode(file);
            return [image, file.profile === undefined ? PdfColorSpaces.RGB : this.images.document.colors.icc(file.profile, 3)];
        } catch (error) {
            this.images.report(href, "cannot be decoded: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    alpha(href: string, data: Buffer): ImageAlpha | undefined {
        return this.samples(href, data)?.[0];
    }

    private read(data: Buffer): WebpFile {
        // RFC 9649 §2.4 and §2.7: chunks of a four-character code, a little-endian size and the data, padded to an even size.
        const file: WebpFile = { lossless: false, animated: false };
        for (let position: number = 12; position + 8 <= data.length;) {
            const type: string = data.toString("latin1", position, position + 4);
            const size: number = data.readUInt32LE(position + 4);
            const body: Buffer = data.subarray(position + 8, position + 8 + size);
            if (type === "VP8X") {
                file.animated = (body[0] & ANIMATION_FLAG) !== 0;
            } else if (type === "ICCP") {
                file.profile = body;
            } else if (type === "ALPH") {
                file.alpha = body;
            } else if (type === "ANIM" || type === "ANMF") {
                file.animated = true;
            } else if ((type === "VP8 " || type === "VP8L") && file.image === undefined) {
                file.image = body;
                file.lossless = type === "VP8L";
            }
            position += 8 + size + (size & 1);
        }
        return file;
    }

    private decode(file: WebpFile): ImageSamples {
        if (file.image === undefined) {
            throw new Error("the file has no VP8 or VP8L image data");
        }
        if (file.lossless) {
            const image: LosslessImage = new Vp8lDecoder().image(file.image);
            return this.argb(image.width, image.height, image.pixels);
        }
        const image: LossyImage = new Vp8Decoder().decode(file.image);
        const samples: ImageSamples = this.rgb(image);
        const alpha: Buffer | undefined = file.alpha === undefined ? undefined : this.alphaPlane(file.alpha, image.width, image.height);
        if (alpha !== undefined && !alpha.every((value: number) => value === 0xFF)) {
            samples.alpha = alpha;
        }
        return samples;
    }

    private argb(width: number, height: number, pixels: Uint32Array): ImageSamples {
        const colors: Buffer = Buffer.allocUnsafe(width * height * 3);
        const alpha: Buffer = Buffer.allocUnsafe(width * height);
        let opaque: boolean = true;
        for (let index: number = 0; index < pixels.length; index++) {
            const pixel: number = pixels[index];
            colors[index * 3] = (pixel >>> 16) & 0xFF;
            colors[index * 3 + 1] = (pixel >>> 8) & 0xFF;
            colors[index * 3 + 2] = pixel & 0xFF;
            alpha[index] = pixel >>> 24;
            opaque = opaque && alpha[index] === 0xFF;
        }
        const image: ImageSamples = { width, height, channels: 3, bits: 8, pixels: colors };
        if (!opaque) {
            image.alpha = alpha;
        }
        return image;
    }

    private rgb(image: LossyImage): ImageSamples {
        // RFC 9649 §2.5: "To convert to RGB, Recommendation 601 SHOULD be used", with luma from 16 to 235 and chroma from 16
        // to 240; each chroma sample covers two by two luma samples.
        const width: number = image.width;
        const height: number = image.height;
        const colors: Buffer = Buffer.allocUnsafe(width * height * 3);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                const luma: number = (image.y[image.yOrigin + y * image.yStride + x] - 16) * LUMA_SCALE;
                const chroma: number = image.uvOrigin + (y >> 1) * image.uvStride + (x >> 1);
                const blueDifference: number = image.u[chroma] - 128;
                const redDifference: number = image.v[chroma] - 128;
                const target: number = (y * width + x) * 3;
                colors[target] = this.channel(luma + RED_FROM_CR * redDifference);
                colors[target + 1] = this.channel(luma - GREEN_FROM_CB * blueDifference - GREEN_FROM_CR * redDifference);
                colors[target + 2] = this.channel(luma + BLUE_FROM_CB * blueDifference);
            }
        }
        return { width, height, channels: 3, bits: 8, pixels: colors };
    }

    private channel(value: number): number {
        return Math.min(255, Math.max(0, Math.round(value)));
    }

    private alphaPlane(chunk: Buffer, width: number, height: number): Buffer {
        // RFC 9649 §2.7.1.2: the compression method in the two lowest bits, the filtering method in the next two; a
        // lossless stream of the image's size keeps the alpha in its green channel.
        const header: number = chunk[0];
        const compression: number = header & 3;
        const filter: number = (header >> 2) & 3;
        const payload: Buffer = chunk.subarray(1);
        let alpha: Buffer;
        if (compression === 0) {
            if (payload.length < width * height) {
                throw new Error("the ALPH chunk is shorter than the image");
            }
            alpha = Buffer.from(payload.subarray(0, width * height));
        } else if (compression === 1) {
            const pixels: Uint32Array = new Vp8lDecoder().stream(width, height, payload);
            alpha = Buffer.allocUnsafe(width * height);
            for (let index: number = 0; index < pixels.length; index++) {
                alpha[index] = (pixels[index] >>> 8) & 0xFF;
            }
        } else {
            throw new Error("the ALPH chunk has the unknown compression method " + compression);
        }
        if (filter !== 0) {
            this.unfiltered(alpha, width, height, filter);
        }
        return alpha;
    }

    private unfiltered(alpha: Buffer, width: number, height: number, filter: number): void {
        // §2.7.1.2: 0 predicts the first pixel, the pixel above the rest of the left column for horizontal and gradient, and the
        // pixel on the left the rest of the top row for vertical and gradient.
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                const index: number = y * width + x;
                let prediction: number;
                if (x === 0 && y === 0) {
                    prediction = 0;
                } else if (y === 0) {
                    prediction = alpha[index - 1];
                } else if (x === 0) {
                    prediction = alpha[index - width];
                } else if (filter === 1) {
                    prediction = alpha[index - 1];
                } else if (filter === 2) {
                    prediction = alpha[index - width];
                } else {
                    prediction = Math.min(255, Math.max(0, alpha[index - 1] + alpha[index - width] - alpha[index - width - 1]));
                }
                alpha[index] = (alpha[index] + prediction) & 0xFF;
            }
        }
    }
}
