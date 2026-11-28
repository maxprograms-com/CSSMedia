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
import type { JpegSamples } from "./JpegDecoder.js";
import { JpegDecoder } from "./JpegDecoder.js";
import { TiffTags } from "./TiffTags.js";

interface JpegInfo {
    width: number;
    height: number;
    frame: number;
    precision: number;
    components: number;
    hierarchical: boolean;
    deferred: boolean;
    named: boolean;
    adobe: boolean;
    profile: Array<Buffer>;
    incomplete: boolean;
    density?: readonly [number, number];
    exif?: ReadonlyMap<number, number>;
}

const JPEG_FRAMES: ReadonlySet<number> = new Set<number>([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const JPEG_BARE: ReadonlySet<number> = new Set<number>([0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8]);
const DCT_FRAMES: ReadonlySet<number> = new Set<number>([0xC0, 0xC2]);
const DCT_COMPONENTS: ReadonlySet<number> = new Set<number>([1, 3, 4]);
const DCT_PRECISION: number = 8;
const DHP_MARKER: number = 0xDE;
const DNL_MARKER: number = 0xDC;
const SOS_MARKER: number = 0xDA;
const RED: number = 0x52;
const GREEN: number = 0x47;
const BLUE: number = 0x42;
const ICC_MARKER: string = "ICC_PROFILE\u0000";
const CSS_PIXELS_PER_INCH: number = 96;
const CENTIMETRES_PER_INCH: number = 2.54;
const SEGMENT_HEAD: number = 18;
const ENTROPY_CHUNK: number = 65536;

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
        const data: Buffer = request.data;
        const info: JpegInfo | undefined = this.parsed(request.href, data, true);
        if (info === undefined) {
            return undefined;
        }
        const multiple: boolean = this.images.isMultiple(request);
        if (multiple || !this.filtered(info)) {
            const decoded: readonly [ImageSamples, ColorSpaceResource] | undefined = this.decoded(request.href, data, info);
            if (decoded === undefined) {
                return undefined;
            }
            return multiple ? this.images.write(this.images.repeated(decoded[0], request.multiple), decoded[1], true)
                : this.images.write(decoded[0], decoded[1], this.images.interpolates(request.rendering));
        }
        // ISO 32000-2 §7.4.8: the JPEG data is the stream of a DCTDecode image. Adobe applications write the inks of a CMYK
        // JPEG inverted, which their APP14 segment marks, and an ICC profile in APP2 segments gives the colour space.
        const space: ColorSpaceResource = this.space(request.href, info, info.components);
        const decode: string = info.components === 4 && info.adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
        // Table 13: without an APP14 segment three components are YCbCr to the filter, and the decoder takes components named
        // R, G and B as RGB, so both read such an image alike.
        const transform: string = info.components === 3 && !info.adobe && info.named ? " /DecodeParms << /ColorTransform 0 >>" : "";
        const object: number = this.images.document.file.addStream("/Type /XObject /Subtype /Image /Width " + info.width + " /Height " + info.height + " /ColorSpace "
            + space.value + " /BitsPerComponent 8 /Filter /DCTDecode" + transform + decode + (this.images.interpolates(request.rendering) ? " /Interpolate true" : ""), data, false);
        return { key: "Im" + object, object, width: info.width, height: info.height };
    }

    samples(href: string, data: Buffer): readonly [ImageSamples, ColorSpaceResource] | undefined {
        const info: JpegInfo | undefined = this.parsed(href, data, true);
        return info === undefined ? undefined : this.decoded(href, data, info);
    }

    alpha(href: string, data: Buffer): ImageAlpha | undefined {
        // A JPEG image has no alpha channel, so it is opaque everywhere.
        const info: JpegInfo | undefined = this.parsed(href, data, false);
        return info === undefined ? undefined : { width: info.width, height: info.height, bits: 8 };
    }

    private parsed(href: string, data: Buffer, profiles: boolean): JpegInfo | undefined {
        const info: JpegInfo | undefined = this.scan((position: number, length: number) => data.subarray(position, position + length), profiles);
        if (info === undefined) {
            this.images.report(href, "cannot be decoded: the JPEG data has no frame header");
        }
        return info;
    }

    private filtered(info: JpegInfo): boolean {
        // §7.4.8: DCTDecode reads "the JPEG baseline format" and "the progressive JPEG extension" of "one, three, or four colour
        // components", each in "a byte"; a hierarchical image is neither, and the libjpeg of viewers refuses lines given by DNL.
        return DCT_FRAMES.has(info.frame) && info.precision === DCT_PRECISION && DCT_COMPONENTS.has(info.components) && !info.hierarchical && !info.deferred;
    }

    private decoded(href: string, data: Buffer, info: JpegInfo): readonly [ImageSamples, ColorSpaceResource] | undefined {
        const decoder: JpegDecoder = new JpegDecoder();
        const decoded: JpegSamples | undefined = decoder.samples(data);
        if (decoded === undefined) {
            this.images.report(href, "cannot be decoded: " + decoder.diagnostics.join("; "));
            return undefined;
        }
        const components: number = decoded.components;
        if (components !== 1 && components !== 3 && components !== 4) {
            // ISO 32000-2 §8.6.5.5: an ICCBased space has 1, 3 or 4 components, as the device spaces; any other count needs named inks.
            this.images.report(href, "has " + components + " colour components, for which PDF has no colour space");
            return undefined;
        }
        return [this.converted(decoded, components), this.space(href, info, components)];
    }

    private converted(decoded: JpegSamples, channels: 1 | 3 | 4): ImageSamples {
        // ISO 32000-2 Table 87: BitsPerComponent is 1, 2, 4, 8 or 16, so a sample of another precision goes to 8 or 16 bits and
        // keeps its fraction of the full range.
        const bits: 8 | 16 = decoded.bits > 8 ? 16 : 8;
        const scale: number = (bits === 16 ? 0xFFFF : 0xFF) / ((1 << decoded.bits) - 1);
        const source: Uint16Array = decoded.pixels;
        const pixels: Buffer = Buffer.allocUnsafe(source.length * bits / 8);
        for (let index: number = 0; index < source.length; index++) {
            const value: number = Math.round(source[index] * scale);
            if (bits === 16) {
                pixels.writeUInt16BE(value, index * 2);
            } else {
                pixels[index] = value;
            }
        }
        return { width: decoded.width, height: decoded.height, channels, bits, pixels };
    }

    private space(href: string, info: JpegInfo, components: number): ColorSpaceResource {
        if (info.incomplete) {
            // ICC.1:2010 B.4: the segments must be numbered from 1 and each must give the total, so a profile that breaks it cannot be used.
            this.images.report(href, "has an ICC profile that is incomplete, so its colors are taken as device colors");
        }
        return info.profile.length > 0 ? this.images.document.colors.icc(Buffer.concat(info.profile), components)
            : (components === 1 ? PdfColorSpaces.GRAY : (components === 4 ? PdfColorSpaces.CMYK : PdfColorSpaces.RGB));
    }

    private scan(read: ImageReader, profiles: boolean): JpegInfo | undefined {
        // ITU-T T.81 B.1.1.4: a segment's two-byte length counts itself. ICC.1:2010 B.4: the ICC profile is split into APP2
        // segments, each with "ICC_PROFILE", its sequence number counted from 1, and the total number of chunks.
        let adobe: boolean = false;
        let density: readonly [number, number] | undefined;
        let exif: ReadonlyMap<number, number> | undefined;
        let progression: Buffer | undefined;
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
                // T.81 §B.3.2: the DHP segment, with the syntax of a frame header, gives the size, the precision and the
                // components of the image that the frames of the hierarchical mode build.
                const header: Buffer = progression ?? segment;
                if (header.length < 10) {
                    return undefined;
                }
                chunks.sort((first: readonly [number, number, Buffer], second: readonly [number, number, Buffer]) => first[0] - second[0]);
                const whole: boolean = chunks.every((chunk: readonly [number, number, Buffer], index: number) => chunk[0] === index + 1 && chunk[1] === chunks.length);
                const info: JpegInfo = {
                    height: header.readUInt16BE(5), width: header.readUInt16BE(7), frame: marker, precision: header[4], components: header[9],
                    hierarchical: progression !== undefined, deferred: false, adobe,
                    named: header.length > 16 && header[9] === 3 && header[10] === RED && header[13] === GREEN && header[16] === BLUE,
                    profile: whole ? chunks.map((chunk: readonly [number, number, Buffer]) => chunk[2]) : [], incomplete: !whole
                };
                if (info.height === 0 && progression === undefined) {
                    info.deferred = true;
                    info.height = this.definedLines(read, position + 2 + length);
                }
                if (density !== undefined) {
                    info.density = density;
                }
                if (exif !== undefined) {
                    info.exif = exif;
                }
                return info;
            }
            if (marker === DHP_MARKER) {
                progression = segment;
            } else if (marker === 0xE0 && segment.length === SEGMENT_HEAD && segment.toString("latin1", 4, 9) === "JFIF\u0000" && segment[11] !== 0) {
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

    private definedLines(read: ImageReader, start: number): number {
        // T.81 §B.2.5: a frame header of zero lines takes them from the DNL segment that ends the first scan; B.1.1.5: in the
        // entropy-coded data X'FF' is followed by a stuffed zero or a restart marker, and any other code is a marker.
        let position: number = start;
        for (; ;) {
            const head: Buffer = read(position, 4);
            if (head.length < 4 || head[0] !== 0xFF) {
                return 0;
            }
            if (head[1] === 0xFF || JPEG_BARE.has(head[1])) {
                position += head[1] === 0xFF ? 1 : 2;
                continue;
            }
            position += 2 + head.readUInt16BE(2);
            if (head[1] === SOS_MARKER) {
                break;
            }
        }
        for (; ;) {
            const chunk: Buffer = read(position, ENTROPY_CHUNK);
            if (chunk.length < 2) {
                return 0;
            }
            const at: number = chunk.indexOf(0xFF);
            if (at < 0 || at === chunk.length - 1) {
                position += at < 0 ? chunk.length : at;
                continue;
            }
            const code: number = chunk[at + 1];
            if (code === 0x00 || (code >= 0xD0 && code <= 0xD7)) {
                position += at + 2;
                continue;
            }
            if (code === 0xFF) {
                position += at + 1;
                continue;
            }
            if (code !== DNL_MARKER) {
                return 0;
            }
            const segment: Buffer = read(position + at, 6);
            return segment.length < 6 ? 0 : segment.readUInt16BE(4);
        }
    }
}
