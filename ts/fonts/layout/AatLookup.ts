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

const SEARCH_HEADER: number = 12;

export class AatLookup {

    valueOf(buffer: Buffer, offset: number, glyph: number, valueSize: number): number | undefined {
        // Apple TrueType Reference Manual, "Lookup Tables": six formats give a value for a glyph index, and a glyph that a
        // table does not list has no value; the size of a value depends on the table that holds the lookup.
        const format: number = buffer.readUInt16BE(offset);
        switch (format) {
            case 0:
                return this.read(buffer, offset + 2 + glyph * valueSize, valueSize);
            case 2: {
                const segment: number | undefined = this.segmentOf(buffer, offset, glyph);
                return segment === undefined ? undefined : this.read(buffer, segment + 4, valueSize);
            }
            case 4: {
                // The value of a segment is the offset, from the start of the lookup table, of one value for each of its glyphs.
                const segment: number | undefined = this.segmentOf(buffer, offset, glyph);
                if (segment === undefined) {
                    return undefined;
                }
                return this.read(buffer, offset + buffer.readUInt16BE(segment + 4) + (glyph - buffer.readUInt16BE(segment + 2)) * valueSize, valueSize);
            }
            case 6:
                return this.single(buffer, offset, glyph, valueSize);
            case 8: {
                const first: number = buffer.readUInt16BE(offset + 2);
                const count: number = buffer.readUInt16BE(offset + 4);
                return glyph >= first && glyph < first + count ? this.read(buffer, offset + 6 + (glyph - first) * 2, 2) : undefined;
            }
            case 10: {
                const unitSize: number = buffer.readUInt16BE(offset + 2);
                const first: number = buffer.readUInt16BE(offset + 4);
                const count: number = buffer.readUInt16BE(offset + 6);
                if (glyph < first || glyph >= first + count || unitSize < 1 || unitSize > 4) {
                    return undefined;
                }
                return this.read(buffer, offset + 8 + (glyph - first) * unitSize, unitSize);
            }
            default:
                return undefined;
        }
    }

    private read(buffer: Buffer, position: number, size: number): number | undefined {
        return position >= 0 && position + size <= buffer.length ? buffer.readUIntBE(position, size) : undefined;
    }

    private segmentOf(buffer: Buffer, offset: number, glyph: number): number | undefined {
        // A LookupSegment starts with its last glyph and then its first glyph, and the segments are sorted by the last glyph.
        const unitSize: number = buffer.readUInt16BE(offset + 2);
        let low: number = 0;
        let high: number = buffer.readUInt16BE(offset + 4) - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const segment: number = offset + SEARCH_HEADER + middle * unitSize;
            if (glyph > buffer.readUInt16BE(segment)) {
                low = middle + 1;
            } else if (glyph < buffer.readUInt16BE(segment + 2)) {
                high = middle - 1;
            } else {
                return segment;
            }
        }
        return undefined;
    }

    private single(buffer: Buffer, offset: number, glyph: number, valueSize: number): number | undefined {
        const unitSize: number = buffer.readUInt16BE(offset + 2);
        let low: number = 0;
        let high: number = buffer.readUInt16BE(offset + 4) - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const entry: number = offset + SEARCH_HEADER + middle * unitSize;
            const listed: number = buffer.readUInt16BE(entry);
            if (listed === glyph) {
                return this.read(buffer, entry + 2, valueSize);
            }
            if (listed < glyph) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return undefined;
    }
}
