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

import type { ImageReader } from "./ImageFormats.js";

const CSS_PIXELS_PER_INCH: number = 96;
const CENTIMETRES_PER_INCH: number = 2.54;
const TIFF_ORIENTATION: number = 274;
const TIFF_X_RESOLUTION: number = 282;
const TIFF_Y_RESOLUTION: number = 283;
const TIFF_RESOLUTION_UNIT: number = 296;

export class TiffTags {

    static readonly WIDTH: number = 256;
    static readonly HEIGHT: number = 257;

    read(read: ImageReader, base: number): ReadonlyMap<number, number> | undefined {
        // TIFF 6.0 §2: the byte order, the number 42 and the offset of the first directory, whose 12-byte entries hold a
        // tag, a type, a count and the value or its offset.
        const header: Buffer = read(base, 8);
        const little: boolean = header.length === 8 && header[0] === 0x49 && header[1] === 0x49;
        if (header.length < 8 || (!little && !(header[0] === 0x4D && header[1] === 0x4D))) {
            return undefined;
        }
        const short: (buffer: Buffer, offset: number) => number = (buffer: Buffer, offset: number): number => little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
        const long: (buffer: Buffer, offset: number) => number = (buffer: Buffer, offset: number): number => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
        if (short(header, 2) !== 42) {
            return undefined;
        }
        const directory: number = base + long(header, 4);
        const size: Buffer = read(directory, 2);
        const entries: Buffer = size.length < 2 ? size : read(directory + 2, short(size, 0) * 12);
        const tags: Map<number, number> = new Map<number, number>();
        for (let offset: number = 0; offset + 12 <= entries.length; offset += 12) {
            const type: number = short(entries, offset + 2);
            if (type === 3) {
                tags.set(short(entries, offset), short(entries, offset + 8));
            } else if (type === 4) {
                tags.set(short(entries, offset), long(entries, offset + 8));
            } else if (type === 5) {
                const rational: Buffer = read(base + long(entries, offset + 8), 8);
                if (rational.length === 8 && long(rational, 4) !== 0) {
                    tags.set(short(entries, offset), long(rational, 0) / long(rational, 4));
                }
            }
        }
        return tags;
    }

    density(tags: ReadonlyMap<number, number>): readonly [number, number] | undefined {
        // TIFF 6.0 §8: ResolutionUnit 2 is the inch, the default, and 3 the centimetre; 1 has no absolute unit.
        const unit: number = tags.get(TIFF_RESOLUTION_UNIT) ?? 2;
        const across: number | undefined = tags.get(TIFF_X_RESOLUTION);
        const down: number | undefined = tags.get(TIFF_Y_RESOLUTION);
        if (unit === 1 || across === undefined || down === undefined || across <= 0 || down <= 0) {
            return undefined;
        }
        const scale: number = (unit === 3 ? CENTIMETRES_PER_INCH : 1) / CSS_PIXELS_PER_INCH;
        return [across * scale, down * scale];
    }

    orientation(tags: ReadonlyMap<number, number> | undefined): number | undefined {
        const orientation: number | undefined = tags?.get(TIFF_ORIENTATION);
        return orientation !== undefined && orientation >= 1 && orientation <= 8 ? orientation : undefined;
    }

    isTurned(tags: ReadonlyMap<number, number>): boolean {
        // Exif 2.32 §4.6.4: the orientations 5 to 8 have the rows of the image along its visual height.
        const orientation: number = tags.get(TIFF_ORIENTATION) ?? 1;
        return orientation >= 5 && orientation <= 8;
    }
}
