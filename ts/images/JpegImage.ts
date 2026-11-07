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
import { TiffTags } from "./TiffTags.js";

interface JpegInfo {
    width: number;
    height: number;
    frame: number;
    precision: number;
    components: number;
    adobe: boolean;
    profile: Array<Buffer>;
    brokenProfile: boolean;
    density?: readonly [number, number];
    exif?: ReadonlyMap<number, number>;
}

const JPEG_FRAMES: ReadonlySet<number> = new Set<number>([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const JPEG_BARE: ReadonlySet<number> = new Set<number>([0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8]);
const DCT_FRAMES: ReadonlySet<number> = new Set<number>([0xC0, 0xC1, 0xC2]);
const DCT_COMPONENTS: ReadonlySet<number> = new Set<number>([1, 3, 4]);
const DCT_PRECISION: number = 8;
const ICC_MARKER: string = "ICC_PROFILE\u0000";
const CSS_PIXELS_PER_INCH: number = 96;
const CENTIMETRES_PER_INCH: number = 2.54;
const SEGMENT_HEAD: number = 18;

export class JpegImage implements ImageFormat {

    private readonly images: ImageFormats;
    private readonly tags: TiffTags = new TiffTags();

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        const head: Buffer = read(0, 3);
        return head.length === 3 && head[0] === 0xFF && head[1] === 0xD8;
    }

    size(read: ImageReader): ImageSize | undefined {
        const info: JpegInfo | undefined = this.scan(read, false);
        if (info === undefined) {
            return undefined;
        }
        const size: ImageSize | undefined = this.images.rasterSize(info.exif !== undefined && this.tags.isTurned(info.exif), info.width, info.height, info.density);
        const orientation: number | undefined = this.tags.orientation(info.exif);
        if (size !== undefined && orientation !== undefined) {
            size.orientation = orientation;
        }
        return size;
    }

    key(drawing: ImageDrawing): string {
        return this.images.rasterKey(drawing);
    }

    draw(request: ImageRequest): ImageResource | undefined {
        // ISO 32000-2 §7.4.8: the JPEG data is the stream of a DCTDecode image. Adobe applications write the inks of a CMYK
        // JPEG inverted, which their APP14 segment marks, and an ICC profile in APP2 segments gives the colour space.
        if (this.images.isMultiple(request)) {
            throw this.images.missing(request.href, "JPEG decoding");
        }
        const data: Buffer = request.data;
        const info: JpegInfo | undefined = this.scan((position: number, length: number) => data.subarray(position, position + length), true);
        if (info === undefined) {
            this.images.report(request.href, "cannot be decoded: the JPEG data has no frame header");
            return undefined;
        }
        // §7.4.8: DCTDecode reads baseline and progressive JPEG of "one, three, or four colour components", and Table 87: it
        // "shall always deliver 8-bit samples". T.81 Table 1: an extended sequential frame at 8 bits only allows more tables than baseline.
        if (!DCT_FRAMES.has(info.frame) || info.precision !== DCT_PRECISION || !DCT_COMPONENTS.has(info.components)) {
            throw this.images.missing(request.href, "JPEG decoding");
        }
        if (info.brokenProfile) {
            this.images.report(request.href, "has an incomplete ICC profile, which is ignored");
        }
        const space: ColorSpaceResource = info.profile.length > 0 ? this.images.document.colors.icc(Buffer.concat(info.profile), info.components)
            : (info.components === 1 ? PdfColorSpaces.GRAY : (info.components === 4 ? PdfColorSpaces.CMYK : PdfColorSpaces.RGB));
        const decode: string = info.components === 4 && info.adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
        const object: number = this.images.document.file.addStream("/Type /XObject /Subtype /Image /Width " + info.width + " /Height " + info.height + " /ColorSpace "
            + space.value + " /BitsPerComponent 8 /Filter /DCTDecode" + decode + (this.images.interpolates(request.rendering) ? " /Interpolate true" : ""), data, false);
        return { key: "Im" + object, object, width: info.width, height: info.height };
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "JPEG decoding");
    }

    alpha(href: string, data: Buffer): ImageAlpha | undefined {
        // A JPEG image has no alpha channel, so it is opaque everywhere.
        const info: JpegInfo | undefined = this.scan((position: number, length: number) => data.subarray(position, position + length), false);
        if (info === undefined) {
            this.images.report(href, "cannot be decoded: the JPEG data has no frame header");
            return undefined;
        }
        return { width: info.width, height: info.height, bits: 8 };
    }

    private scan(read: ImageReader, profiles: boolean): JpegInfo | undefined {
        // ITU-T T.81 B.1.1.4: a segment's two-byte length counts itself. ICC.1:2010 B.4: the ICC profile is split into APP2
        // segments, each with "ICC_PROFILE", its sequence number counted from 1, and the total number of chunks.
        let adobe: boolean = false;
        let density: readonly [number, number] | undefined;
        let exif: ReadonlyMap<number, number> | undefined;
        const chunks: Array<readonly [number, number, Buffer]> = [];
        for (let position: number = 2; ;) {
            const segment: Buffer = read(position, SEGMENT_HEAD);
            if (segment.length < 4) {
                return undefined;
            }
            if (segment[0] !== 0xFF) {
                position++;
                continue;
            }
            const marker: number = segment[1];
            if (marker === 0xFF || JPEG_BARE.has(marker)) {
                position += marker === 0xFF ? 1 : 2;
                continue;
            }
            const length: number = segment.readUInt16BE(2);
            if (JPEG_FRAMES.has(marker)) {
                if (segment.length < 10) {
                    return undefined;
                }
                chunks.sort((first: readonly [number, number, Buffer], second: readonly [number, number, Buffer]) => first[0] - second[0]);
                const whole: boolean = chunks.every((chunk: readonly [number, number, Buffer], index: number) => chunk[0] === index + 1 && chunk[1] === chunks.length);
                const info: JpegInfo = {
                    height: segment.readUInt16BE(5), width: segment.readUInt16BE(7), frame: marker, precision: segment[4], components: segment[9], adobe,
                    profile: whole ? chunks.map((chunk: readonly [number, number, Buffer]) => chunk[2]) : [], brokenProfile: !whole
                };
                if (density !== undefined) {
                    info.density = density;
                }
                if (exif !== undefined) {
                    info.exif = exif;
                }
                return info;
            }
            if (marker === 0xE0 && segment.length === SEGMENT_HEAD && segment.toString("latin1", 4, 9) === "JFIF\u0000" && segment[11] !== 0) {
                // JFIF 1.02: units 1 is dots per inch and 2 dots per centimetre.
                const scale: number = (segment[11] === 2 ? CENTIMETRES_PER_INCH : 1) / CSS_PIXELS_PER_INCH;
                density = density ?? [segment.readUInt16BE(12) * scale, segment.readUInt16BE(14) * scale];
            } else if (marker === 0xE1 && segment.toString("latin1", 4, 10) === "Exif\u0000\u0000") {
                const tags: ReadonlyMap<number, number> | undefined = this.tags.read(read, position + 10);
                density = tags === undefined ? density : this.tags.density(tags) ?? density;
                exif = tags;
            } else if (marker === 0xEE && segment.toString("latin1", 4, 9) === "Adobe") {
                adobe = true;
            } else if (profiles && marker === 0xE2 && segment.length === SEGMENT_HEAD && segment.toString("latin1", 4, 16) === ICC_MARKER) {
                chunks.push([segment[16], segment[17], read(position + 18, length - 16)]);
            }
            position += 2 + length;
        }
    }
}
