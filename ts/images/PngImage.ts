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

import { inflateSync } from "node:zlib";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { ImageResource } from "../writer/PdfPage.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";
import type { ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "./ImageFormats.js";

interface PngHeader {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    compression: number;
    filter: number;
    interlace: number;
}

interface PngFile {
    header: PngHeader;
    palette: Buffer;
    transparency: Buffer;
    data: Buffer;
    profile?: Buffer;
    codingPoints: boolean;
    standardRgb: boolean;
    gamma?: number;
    chromaticities?: ReadonlyArray<number>;
}

interface Pass {
    x: number;
    y: number;
    dx: number;
    dy: number;
}

const SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const BIT_DEPTHS: Readonly<Record<number, ReadonlyArray<number>>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const HEADER_LENGTH: number = 13;
const INDEXED: number = 3;
const ADAM7: ReadonlyArray<Pass> = [
    { x: 0, y: 0, dx: 8, dy: 8 }, { x: 4, y: 0, dx: 8, dy: 8 }, { x: 0, y: 4, dx: 4, dy: 8 }, { x: 2, y: 0, dx: 4, dy: 4 },
    { x: 0, y: 2, dx: 2, dy: 4 }, { x: 1, y: 0, dx: 2, dy: 2 }, { x: 0, y: 1, dx: 1, dy: 2 }
];
const SINGLE_PASS: ReadonlyArray<Pass> = [{ x: 0, y: 0, dx: 1, dy: 1 }];
const GAMMA_SCALE: number = 100000;
const SRGB_PRIMARIES: ReadonlyArray<number> = [0.3127, 0.329, 0.64, 0.33, 0.3, 0.6, 0.15, 0.06];
const CSS_PIXELS_PER_INCH: number = 96;
const METRES_PER_INCH: number = 0.0254;

export class PngImage implements ImageFormat {

    private readonly images: ImageFormats;
    private readonly syntax: PdfSyntax = new PdfSyntax();

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        return read(0, 8).equals(SIGNATURE);
    }

    size(read: ImageReader): ImageSize | undefined {
        // PNG §11.2.1 and §11.3.4.3: IHDR is the first chunk, and pHYs, which comes before the image data, gives the
        // pixels per unit, the unit being the metre when its specifier is 1.
        const header: Buffer = read(8, 25);
        if (header.length < 25 || header.toString("latin1", 4, 8) !== "IHDR") {
            return undefined;
        }
        let density: readonly [number, number] | undefined;
        for (let position: number = 33; ;) {
            const chunk: Buffer = read(position, 17);
            const type: string = chunk.length < 8 ? "IDAT" : chunk.toString("latin1", 4, 8);
            if (type === "IDAT" || type === "IEND") {
                break;
            }
            if (type === "pHYs" && chunk.length === 17 && chunk[16] === 1) {
                density = [chunk.readUInt32BE(8) * METRES_PER_INCH / CSS_PIXELS_PER_INCH, chunk.readUInt32BE(12) * METRES_PER_INCH / CSS_PIXELS_PER_INCH];
            }
            position += 12 + chunk.readUInt32BE(0);
        }
        return this.images.rasterSize(false, header.readUInt32BE(8), header.readUInt32BE(12), density);
    }

    key(drawing: ImageDrawing): string {
        return this.images.rasterKey(drawing);
    }

    draw(request: ImageRequest): ImageResource | undefined {
        const png: PngFile | undefined = this.parsed(request.href, request.data, true);
        if (png === undefined) {
            return undefined;
        }
        try {
            if (!this.images.isMultiple(request)) {
                return this.embed(png, this.images.interpolates(request.rendering));
            }
            const image: ImageSamples = this.decode(png);
            return this.images.write(this.images.repeated(image, request.multiple), this.space(png, image.channels), true);
        } catch (error) {
            this.images.report(request.href, "cannot be decoded: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    samples(href: string, data: Buffer): readonly [ImageSamples, ColorSpaceResource] | undefined {
        const png: PngFile | undefined = this.parsed(href, data, true);
        if (png === undefined) {
            return undefined;
        }
        try {
            const image: ImageSamples = this.decode(png);
            return [image, this.space(png, image.channels)];
        } catch (error) {
            this.images.report(href, "cannot be decoded: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    alpha(href: string, data: Buffer): ImageAlpha | undefined {
        const png: PngFile | undefined = this.parsed(href, data, false);
        try {
            return png === undefined ? undefined : this.decode(png);
        } catch (error) {
            this.images.report(href, "cannot be decoded: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    private parsed(href: string, data: Buffer, colors: boolean): PngFile | undefined {
        let png: PngFile;
        try {
            png = this.read(data);
        } catch (error) {
            this.images.report(href, "cannot be decoded: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
        if (colors && png.codingPoints) {
            throw this.images.missing(href, "the colour space of a PNG cICP chunk");
        }
        return png;
    }

    private embed(png: PngFile, interpolate: boolean): ImageResource {
        // PNG 3 §4.3: the colour space comes from the chunk of highest precedence that can be expressed in PDF. ISO
        // 32000-2 §7.4.4.4: FlateDecode with the PNG predictors reads the image data of a simple PNG file as it is.
        const header: PngHeader = png.header;
        const gray: boolean = header.colorType === 0 || header.colorType === 4;
        const space: ColorSpaceResource = this.space(png, gray ? 1 : 3);
        // §8.9.6.4 allows a colour key at 16 bits, but Acrobat ignores it, and a soft mask says the same. A smoothed image
        // no longer has the key's exact values where it was transparent, so its transparency is a soft mask too.
        const softKey: boolean = png.transparency.length > 0 && (header.bitDepth === 16 || interpolate);
        const passThrough: boolean = header.interlace === 0 && !softKey && (header.colorType === 0 || header.colorType === 2 || (header.colorType === 3 && png.transparency.length === 0));
        if (!passThrough) {
            return this.images.write(this.decode(png), space, interpolate);
        }
        const colors: number = header.colorType === 2 ? 3 : 1;
        let entries: string = "/Type /XObject /Subtype /Image /Width " + header.width + " /Height " + header.height + " /BitsPerComponent " + header.bitDepth
            + " /ColorSpace " + (header.colorType === 3 ? this.indexed(space, png.palette) : space.value) + " /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors "
            + colors + " /BitsPerComponent " + header.bitDepth + " /Columns " + header.width + " >>" + (interpolate ? " /Interpolate true" : "");
        if (header.colorType !== 3 && png.transparency.length >= colors * 2) {
            // §8.9.6.4: colour key masking, with each range made of the one value of the tRNS chunk.
            const key: Array<number> = [];
            for (let channel: number = 0; channel < colors; channel++) {
                const value: number = this.keyValue(png.transparency, channel, header.bitDepth);
                key.push(value, value);
            }
            entries += " /Mask [" + this.syntax.numbers(key) + "]";
        }
        const object: number = this.images.document.file.addStream(entries, png.data, false);
        return { key: "Im" + object, object, width: header.width, height: header.height };
    }

    private space(png: PngFile, components: number): ColorSpaceResource {
        // PNG 3 §11.3.2: an iCCP profile, then sRGB, then gAMA with cHRM; "For gAMA these are the reference viewing
        // conditions of the sRGB specification", so a gamma alone takes the primaries and the white point of sRGB.
        const colors: PdfColorSpaces = this.images.document.colors;
        if (png.profile !== undefined) {
            return colors.icc(png.profile, components);
        }
        if (png.standardRgb || png.gamma === undefined || png.gamma <= 0) {
            return components === 1 ? PdfColorSpaces.GRAY : PdfColorSpaces.RGB;
        }
        const chromaticities: ReadonlyArray<number> = png.chromaticities ?? SRGB_PRIMARIES;
        const white: ReadonlyArray<number> = this.whitePoint(chromaticities[0], chromaticities[1]);
        const exponent: number = 1 / png.gamma;
        return components === 1 ? colors.calibrated([exponent], white) : colors.calibrated([exponent, exponent, exponent], white, this.primaries(chromaticities, white));
    }

    private whitePoint(x: number, y: number): ReadonlyArray<number> {
        return [x / y, 1, (1 - x - y) / y];
    }

    private primaries(chromaticities: ReadonlyArray<number>, white: ReadonlyArray<number>): ReadonlyArray<number> {
        // ISO 32000-2 §8.6.5.3: the Matrix holds the X, Y and Z of the red, green and blue primaries at full intensity,
        // scaled so that the three together give the white point.
        const columns: Array<Array<number>> = [];
        for (let primary: number = 0; primary < 3; primary++) {
            const x: number = chromaticities[2 + primary * 2];
            const y: number = chromaticities[3 + primary * 2];
            columns.push([x / y, 1, (1 - x - y) / y]);
        }
        const scales: ReadonlyArray<number> = this.solve(columns, white);
        const matrix: Array<number> = [];
        for (let primary: number = 0; primary < 3; primary++) {
            matrix.push(columns[primary][0] * scales[primary], columns[primary][1] * scales[primary], columns[primary][2] * scales[primary]);
        }
        return matrix;
    }

    private solve(columns: ReadonlyArray<ReadonlyArray<number>>, target: ReadonlyArray<number>): ReadonlyArray<number> {
        const determinant: (a: ReadonlyArray<number>, b: ReadonlyArray<number>, c: ReadonlyArray<number>) => number =
            (a: ReadonlyArray<number>, b: ReadonlyArray<number>, c: ReadonlyArray<number>): number =>
                a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
        const whole: number = determinant(columns[0], columns[1], columns[2]);
        if (whole === 0) {
            return [1, 1, 1];
        }
        return [determinant(target, columns[1], columns[2]) / whole, determinant(columns[0], target, columns[2]) / whole, determinant(columns[0], columns[1], target) / whole];
    }

    private indexed(base: ColorSpaceResource, palette: Buffer): string {
        // ISO 32000-2 §8.6.6.3: [/Indexed base hival lookup], the lookup table holding the colours of the palette one after
        // the other.
        return "[/Indexed " + base.value + " " + (palette.length / 3 - 1) + " " + this.syntax.hex(palette) + "]";
    }

    private read(data: Buffer): PngFile {
        // PNG 3 §5.3: a chunk is its length, its type, its data and a CRC; IHDR comes first, and the IDAT chunks hold one
        // zlib stream. §4.3: cICP, iCCP, sRGB and cHRM with gAMA give the colour space, in that order of precedence.
        let header: PngHeader | undefined;
        let palette: Buffer = Buffer.alloc(0);
        let transparency: Buffer = Buffer.alloc(0);
        const compressed: Array<Buffer> = [];
        const file: Omit<PngFile, "header" | "palette" | "transparency" | "data"> = { codingPoints: false, standardRgb: false };
        for (let position: number = 8; position + 8 <= data.length;) {
            const length: number = data.readUInt32BE(position);
            const type: string = data.toString("latin1", position + 4, position + 8);
            const body: Buffer = data.subarray(position + 8, position + 8 + length);
            if (type === "IHDR") {
                if (length !== HEADER_LENGTH) {
                    throw new Error("The IHDR chunk of the PNG image has " + length + " bytes");
                }
                header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), bitDepth: body[8], colorType: body[9], compression: body[10], filter: body[11], interlace: body[12] };
            } else if (type === "PLTE") {
                palette = body;
            } else if (type === "tRNS") {
                transparency = body;
            } else if (type === "IDAT") {
                compressed.push(body);
            } else if (type === "iCCP") {
                // §11.3.2.3: the profile name ends with a null byte, then the compression method and the zlib data.
                const end: number = body.indexOf(0);
                file.profile = inflateSync(body.subarray(end + 2));
            } else if (type === "cICP") {
                file.codingPoints = true;
            } else if (type === "sRGB") {
                file.standardRgb = true;
            } else if (type === "gAMA" && length === 4) {
                file.gamma = body.readUInt32BE(0) / GAMMA_SCALE;
            } else if (type === "cHRM" && length === 32) {
                const values: Array<number> = [];
                for (let index: number = 0; index < 8; index++) {
                    values.push(body.readUInt32BE(index * 4) / GAMMA_SCALE);
                }
                file.chromaticities = values;
            } else if (type === "IEND") {
                break;
            }
            position += 12 + length;
        }
        if (header === undefined) {
            throw new Error("The PNG image has no IHDR chunk");
        }
        this.validate(header, palette);
        return { ...file, header, palette, transparency, data: compressed.length === 1 ? compressed[0] : Buffer.concat(compressed) };
    }

    private validate(header: PngHeader, palette: Buffer): void {
        // PNG 3 §11.2.1, Table 12: the colour types and the bit depths each allows, one compression method and one filter method
        // defined, two interlace methods; for indexed colour "a PLTE chunk shall appear". §11.2.2: "A chunk length not
        // divisible by 3 is an error."
        if (BIT_DEPTHS[header.colorType]?.includes(header.bitDepth) !== true) {
            throw new Error("The PNG image has the colour type " + header.colorType + " with the bit depth " + header.bitDepth);
        }
        if (header.compression !== 0 || header.filter !== 0 || header.interlace > 1) {
            throw new Error("The PNG image has the compression method " + header.compression + ", the filter method " + header.filter + " and the interlace method " + header.interlace);
        }
        if (header.colorType === INDEXED && (palette.length === 0 || palette.length % 3 !== 0)) {
            throw new Error("The indexed PNG image has a palette of " + palette.length + " bytes");
        }
    }

    private decode(file: PngFile): ImageSamples {
        // §7.3 and §9: the zlib data is the filtered scanlines of each pass, each with its filter type first. The rows are
        // unfiltered where they are, and 8-bit samples without a palette or a transparent colour keep that buffer.
        const header: PngHeader = file.header;
        const raw: Buffer = inflateSync(file.data);
        const inFile: number = CHANNELS[header.colorType];
        const passes: ReadonlyArray<Pass> = header.interlace === 1 ? ADAM7 : SINGLE_PASS;
        this.unfilterAll(raw, header, inFile, passes);
        if (header.interlace === 0 && header.bitDepth === 8 && header.colorType !== 3 && file.transparency.length === 0) {
            return this.compacted(raw, header, inFile);
        }
        return this.expanded(raw, file, inFile, passes);
    }

    private unfilterAll(raw: Buffer, header: PngHeader, inFile: number, passes: ReadonlyArray<Pass>): void {
        let offset: number = 0;
        for (const pass of passes) {
            const width: number = Math.ceil((header.width - pass.x) / pass.dx);
            const height: number = Math.ceil((header.height - pass.y) / pass.dy);
            if (width <= 0 || height <= 0) {
                continue;
            }
            const rowBytes: number = Math.ceil(width * inFile * header.bitDepth / 8);
            const step: number = Math.max(1, Math.ceil(inFile * header.bitDepth / 8));
            for (let row: number = 0; row < height; row++) {
                if (offset + 1 + rowBytes > raw.length) {
                    throw new Error("The image data of the PNG image ends before its last row");
                }
                this.unfilter(raw, offset, rowBytes, row === 0 ? -1 : offset - rowBytes - 1, step);
                offset += 1 + rowBytes;
            }
        }
    }

    private compacted(raw: Buffer, header: PngHeader, inFile: number): ImageSamples {
        // The colour of each pixel moves to the front of the same buffer, which never overtakes what is still to be read
        // since each pixel and row of the file is longer; an alpha channel in which every pixel is opaque masks nothing.
        const channels: 1 | 3 = inFile <= 2 ? 1 : 3;
        const ownAlpha: boolean = inFile === 2 || inFile === 4;
        const alpha: Buffer | undefined = ownAlpha ? Buffer.allocUnsafe(header.width * header.height) : undefined;
        let opaque: boolean = true;
        let source: number = 0;
        let target: number = 0;
        let mask: number = 0;
        for (let row: number = 0; row < header.height; row++) {
            source++;
            for (let column: number = 0; column < header.width; column++) {
                for (let channel: number = 0; channel < channels; channel++) {
                    raw[target++] = raw[source++];
                }
                if (alpha !== undefined) {
                    const value: number = raw[source++];
                    alpha[mask++] = value;
                    opaque = opaque && value === 0xFF;
                }
            }
        }
        const image: ImageSamples = { width: header.width, height: header.height, channels, bits: 8, pixels: raw.subarray(0, target) };
        if (alpha !== undefined && !opaque) {
            image.alpha = alpha;
        }
        return image;
    }

    private expanded(raw: Buffer, file: PngFile, inFile: number, passes: ReadonlyArray<Pass>): ImageSamples {
        // Samples of 16 bits are kept as they are, those of fewer bits are scaled to 8, palette indexes become their
        // colours, and transparency becomes an alpha channel.
        const header: PngHeader = file.header;
        const palette: boolean = header.colorType === 3;
        const ownAlpha: boolean = header.colorType === 4 || header.colorType === 6;
        const channels: 1 | 3 = header.colorType === 0 || header.colorType === 4 ? 1 : 3;
        const bits: 8 | 16 = header.bitDepth === 16 ? 16 : 8;
        const bytes: number = bits / 8;
        const pixels: Buffer = Buffer.alloc(header.width * header.height * channels * bytes);
        const alpha: Buffer | undefined = ownAlpha || file.transparency.length > 0 ? Buffer.alloc(header.width * header.height * bytes, 0xFF) : undefined;
        const samples: Array<number> = new Array<number>(inFile).fill(0);
        const scale: number = header.bitDepth < 8 ? 255 / ((1 << header.bitDepth) - 1) : 1;
        let offset: number = 0;
        for (const pass of passes) {
            const width: number = Math.ceil((header.width - pass.x) / pass.dx);
            const height: number = Math.ceil((header.height - pass.y) / pass.dy);
            if (width <= 0 || height <= 0) {
                continue;
            }
            const rowBytes: number = Math.ceil(width * inFile * header.bitDepth / 8);
            for (let row: number = 0; row < height; row++) {
                const current: Buffer = raw.subarray(offset + 1, offset + 1 + rowBytes);
                offset += 1 + rowBytes;
                for (let column: number = 0; column < width; column++) {
                    this.readSamples(current, column, inFile, header.bitDepth, samples);
                    const target: number = (pass.y + row * pass.dy) * header.width + pass.x + column * pass.dx;
                    if (palette) {
                        const index: number = samples[0];
                        for (let channel: number = 0; channel < 3; channel++) {
                            pixels[target * 3 + channel] = file.palette[index * 3 + channel] ?? 0;
                        }
                        if (alpha !== undefined && index < file.transparency.length) {
                            alpha[target] = file.transparency[index];
                        }
                        continue;
                    }
                    for (let channel: number = 0; channel < channels; channel++) {
                        this.writeSample(pixels, (target * channels + channel) * bytes, samples[channel] * scale, bits);
                    }
                    if (alpha !== undefined && ownAlpha) {
                        this.writeSample(alpha, target * bytes, samples[channels] * scale, bits);
                    } else if (alpha !== undefined && this.isKey(samples, channels, file.transparency, header.bitDepth)) {
                        this.writeSample(alpha, target * bytes, 0, bits);
                    }
                }
            }
        }
        const image: ImageSamples = { width: header.width, height: header.height, channels, bits, pixels };
        if (alpha !== undefined) {
            image.alpha = alpha;
        }
        return image;
    }

    private writeSample(target: Buffer, position: number, value: number, bits: 8 | 16): void {
        if (bits === 16) {
            target.writeUInt16BE(Math.round(value), position);
        } else {
            target[position] = Math.round(value);
        }
    }

    private isKey(samples: ReadonlyArray<number>, channels: number, transparency: Buffer, bitDepth: number): boolean {
        // §11.3.1.1: for greyscale and truecolour images tRNS gives one colour, as 16-bit values, that is fully transparent.
        if (transparency.length < channels * 2) {
            return false;
        }
        for (let channel: number = 0; channel < channels; channel++) {
            if (samples[channel] !== this.keyValue(transparency, channel, bitDepth)) {
                return false;
            }
        }
        return true;
    }

    private keyValue(transparency: Buffer, channel: number, bitDepth: number): number {
        // §11.3.1.1: "If the image bit depth is less than 16, the least significant bits are used ... decoders must mask the
        // other bits to 0 before the value is used."
        return transparency.readUInt16BE(channel * 2) & ((1 << bitDepth) - 1);
    }

    private readSamples(row: Buffer, column: number, channels: number, bitDepth: number, samples: Array<number>): void {
        for (let channel: number = 0; channel < channels; channel++) {
            const index: number = column * channels + channel;
            if (bitDepth === 8) {
                samples[channel] = row[index];
            } else if (bitDepth === 16) {
                samples[channel] = row.readUInt16BE(index * 2);
            } else {
                const bit: number = index * bitDepth;
                samples[channel] = (row[bit >> 3] >> (8 - bitDepth - (bit % 8))) & ((1 << bitDepth) - 1);
            }
        }
    }

    private unfilter(raw: Buffer, row: number, length: number, above: number, step: number): void {
        // §9.2: None, Sub, Up, Average and Paeth, each on the bytes of the scanline and of the one above it, which is
        // already unfiltered; the first scanline of a pass has zeros above it.
        const filter: number = raw[row];
        const first: number = row + 1;
        const end: number = first + length;
        const shift: number = above < 0 ? 0 : first - above - 1;
        if (filter === 1) {
            for (let index: number = first + step; index < end; index++) {
                raw[index] = (raw[index] + raw[index - step]) & 0xFF;
            }
        } else if (filter === 2 && above >= 0) {
            for (let index: number = first; index < end; index++) {
                raw[index] = (raw[index] + raw[index - shift]) & 0xFF;
            }
        } else if (filter === 3) {
            for (let index: number = first; index < end; index++) {
                const left: number = index - first >= step ? raw[index - step] : 0;
                const up: number = above < 0 ? 0 : raw[index - shift];
                raw[index] = (raw[index] + ((left + up) >> 1)) & 0xFF;
            }
        } else if (filter === 4) {
            for (let index: number = first; index < end; index++) {
                const before: boolean = index - first >= step;
                const left: number = before ? raw[index - step] : 0;
                const up: number = above < 0 ? 0 : raw[index - shift];
                const upLeft: number = above < 0 || !before ? 0 : raw[index - shift - step];
                raw[index] = (raw[index] + this.paeth(left, up, upLeft)) & 0xFF;
            }
        } else if (filter > 4) {
            throw new Error("A scanline of the PNG image has the unknown filter type " + filter);
        }
    }

    private paeth(left: number, up: number, upLeft: number): number {
        const estimate: number = left + up - upLeft;
        const toLeft: number = Math.abs(estimate - left);
        const toUp: number = Math.abs(estimate - up);
        const toUpLeft: number = Math.abs(estimate - upLeft);
        if (toLeft <= toUp && toLeft <= toUpLeft) {
            return left;
        }
        return toUp <= toUpLeft ? up : upLeft;
    }
}
