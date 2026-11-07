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

import type { CharacterMap, CharacterMapMode, VariationSequences } from "./Typeface.js";

interface Segment {
    start: number;
    end: number;
    mode: CharacterMapMode;
    base: number;
}

const LINEAR: CharacterMapMode = 0;
const CONSTANT: CharacterMapMode = 1;
const INDEXED: CharacterMapMode = 2;
const LONG_UNICODE: ReadonlySet<number> = new Set<number>([8, 10, 12]);
const SHORT_UNICODE: ReadonlySet<number> = new Set<number>([0, 4, 6]);

export class CharacterMapReader {

    private segments: Array<Segment> = [];
    private glyphs: Array<number> = [];
    private glyphCount: number = 0;

    read(glyphCount: number, cmap?: Buffer): CharacterMap {
        this.segments = [];
        this.glyphs = [];
        this.glyphCount = glyphCount;
        const variations: Array<VariationSequences> = [];
        if (cmap !== undefined && cmap.length >= 4) {
            let chosen: number = -1;
            let rank: number = 0;
            const count: number = cmap.readUInt16BE(2);
            for (let index: number = 0; index < count && 4 + index * 8 + 8 <= cmap.length; index++) {
                const record: number = 4 + index * 8;
                const platform: number = cmap.readUInt16BE(record);
                const encoding: number = cmap.readUInt16BE(record + 2);
                const offset: number = cmap.readUInt32BE(record + 4);
                if (offset + 2 > cmap.length) {
                    continue;
                }
                const format: number = cmap.readUInt16BE(offset);
                if (format === 14 && platform === 0 && encoding === 5) {
                    variations.push(...this.variationSequences(cmap, offset));
                    continue;
                }
                const candidate: number = this.rankOf(platform, encoding, format);
                if (candidate > rank) {
                    rank = candidate;
                    chosen = offset;
                }
            }
            if (chosen >= 0) {
                this.subtable(cmap, chosen);
            }
        }
        return this.result(variations);
    }

    private rankOf(platform: number, encoding: number, format: number): number {
        // OpenType cmap: a 32-bit Unicode subtable is preferred to a 16-bit one; Fonts 4 §5.4 leaves legacy encodings out.
        const unicode: boolean = (platform === 0 && encoding !== 5) || (platform === 3 && (encoding === 1 || encoding === 10));
        if (unicode && LONG_UNICODE.has(format)) {
            return 4;
        }
        if (unicode && SHORT_UNICODE.has(format)) {
            return 3;
        }
        if (unicode && format === 13) {
            return 2;
        }
        if (platform === 3 && encoding === 0 && (SHORT_UNICODE.has(format) || format === 12)) {
            return 1;
        }
        return 0;
    }

    private subtable(cmap: Buffer, offset: number): void {
        const format: number = cmap.readUInt16BE(offset);
        if (format === 0) {
            this.byteEncoding(cmap, offset + 6);
        } else if (format === 4) {
            this.segmentMapping(cmap, offset);
        } else if (format === 6) {
            this.indexed(cmap.readUInt16BE(offset + 6), cmap, offset + 10, cmap.readUInt16BE(offset + 8));
        } else if (format === 8) {
            this.groups(cmap, offset + 8208, cmap.readUInt32BE(offset + 8204), LINEAR);
        } else if (format === 10) {
            this.indexed(cmap.readUInt32BE(offset + 12), cmap, offset + 20, cmap.readUInt32BE(offset + 16));
        } else if (format === 12) {
            this.groups(cmap, offset + 16, cmap.readUInt32BE(offset + 12), LINEAR);
        } else if (format === 13) {
            this.groups(cmap, offset + 16, cmap.readUInt32BE(offset + 12), CONSTANT);
        }
    }

    private byteEncoding(cmap: Buffer, arrayOffset: number): void {
        // OpenType cmap format 0: "An array that maps character codes to glyph index values", 256 of one byte each.
        const available: number = Math.min(256, cmap.length - arrayOffset);
        if (available <= 0) {
            return;
        }
        const base: number = this.glyphs.length;
        for (let index: number = 0; index < available; index++) {
            this.glyphs.push(this.valid(cmap[arrayOffset + index]));
        }
        this.segments.push({ start: 0, end: available - 1, mode: INDEXED, base });
    }

    private indexed(first: number, cmap: Buffer, arrayOffset: number, count: number): void {
        const available: number = Math.min(count, Math.floor((cmap.length - arrayOffset) / 2));
        if (available <= 0) {
            return;
        }
        const base: number = this.glyphs.length;
        for (let index: number = 0; index < available; index++) {
            this.glyphs.push(this.valid(cmap.readUInt16BE(arrayOffset + index * 2)));
        }
        this.segments.push({ start: first, end: first + available - 1, mode: INDEXED, base });
    }

    private segmentMapping(cmap: Buffer, offset: number): void {
        const segmentCount: number = cmap.readUInt16BE(offset + 6) / 2;
        const ends: number = offset + 14;
        const starts: number = ends + segmentCount * 2 + 2;
        const deltas: number = starts + segmentCount * 2;
        const rangeOffsets: number = deltas + segmentCount * 2;
        if (rangeOffsets + segmentCount * 2 > cmap.length) {
            return;
        }
        for (let segment: number = 0; segment < segmentCount; segment++) {
            const start: number = cmap.readUInt16BE(starts + segment * 2);
            const end: number = cmap.readUInt16BE(ends + segment * 2);
            const delta: number = cmap.readUInt16BE(deltas + segment * 2);
            const rangeOffset: number = cmap.readUInt16BE(rangeOffsets + segment * 2);
            if (start > end || start === 0xFFFF) {
                continue;
            }
            if (rangeOffset === 0) {
                // OpenType cmap format 4: idDelta arithmetic is modulo 65536, so a segment can wrap to glyph 0.
                const firstGlyph: number = (start + delta) & 0xFFFF;
                const wrap: number = start + (0xFFFF - firstGlyph);
                this.linear(start, Math.min(end, wrap), firstGlyph);
                if (wrap < end) {
                    this.linear(wrap + 1, end, 0);
                }
                continue;
            }
            const base: number = this.glyphs.length;
            const origin: number = rangeOffsets + segment * 2 + rangeOffset;
            for (let code: number = start; code <= end; code++) {
                const position: number = origin + (code - start) * 2;
                const glyph: number = position + 2 <= cmap.length ? cmap.readUInt16BE(position) : 0;
                this.glyphs.push(glyph === 0 ? 0 : this.valid((glyph + delta) & 0xFFFF));
            }
            this.segments.push({ start, end, mode: INDEXED, base });
        }
    }

    private groups(cmap: Buffer, groupOffset: number, count: number, mode: CharacterMapMode): void {
        for (let index: number = 0; index < count && groupOffset + index * 12 + 12 <= cmap.length; index++) {
            const entry: number = groupOffset + index * 12;
            const start: number = cmap.readUInt32BE(entry);
            const end: number = Math.min(cmap.readUInt32BE(entry + 4), 0x10FFFF);
            const glyph: number = cmap.readUInt32BE(entry + 8);
            if (start > end) {
                continue;
            }
            if (mode === CONSTANT) {
                if (glyph < this.glyphCount) {
                    this.segments.push({ start, end, mode, base: glyph });
                }
            } else {
                this.linear(start, end, glyph);
            }
        }
    }

    private linear(start: number, end: number, firstGlyph: number): void {
        const last: number = Math.min(end, start + (this.glyphCount - 1 - firstGlyph));
        if (last >= start) {
            this.segments.push({ start, end: last, mode: LINEAR, base: firstGlyph });
        }
    }

    private valid(glyph: number): number {
        return glyph < this.glyphCount ? glyph : 0;
    }

    private variationSequences(cmap: Buffer, offset: number): Array<VariationSequences> {
        // OpenType cmap format 14: default sequences use the glyph of the base character, others name their own glyph.
        const sequences: Array<VariationSequences> = [];
        if (offset + 10 > cmap.length) {
            return sequences;
        }
        const count: number = cmap.readUInt32BE(offset + 6);
        for (let index: number = 0; index < count && offset + 10 + index * 11 + 11 <= cmap.length; index++) {
            const record: number = offset + 10 + index * 11;
            const selector: number = cmap.readUIntBE(record, 3);
            const defaultOffset: number = cmap.readUInt32BE(record + 3);
            const otherOffset: number = cmap.readUInt32BE(record + 7);
            const defaultStarts: Array<number> = [];
            const defaultEnds: Array<number> = [];
            if (defaultOffset !== 0 && offset + defaultOffset + 4 <= cmap.length) {
                const table: number = offset + defaultOffset;
                const ranges: number = cmap.readUInt32BE(table);
                for (let range: number = 0; range < ranges && table + 4 + range * 4 + 4 <= cmap.length; range++) {
                    const start: number = cmap.readUIntBE(table + 4 + range * 4, 3);
                    defaultStarts.push(start);
                    defaultEnds.push(start + cmap[table + 4 + range * 4 + 3]);
                }
            }
            const codes: Array<number> = [];
            const glyphs: Array<number> = [];
            if (otherOffset !== 0 && offset + otherOffset + 4 <= cmap.length) {
                const table: number = offset + otherOffset;
                const mappings: number = cmap.readUInt32BE(table);
                for (let mapping: number = 0; mapping < mappings && table + 4 + mapping * 5 + 5 <= cmap.length; mapping++) {
                    codes.push(cmap.readUIntBE(table + 4 + mapping * 5, 3));
                    glyphs.push(this.valid(cmap.readUInt16BE(table + 4 + mapping * 5 + 3)));
                }
            }
            sequences.push({
                selector,
                defaultStarts: Uint32Array.from(defaultStarts),
                defaultEnds: Uint32Array.from(defaultEnds),
                codes: Uint32Array.from(codes),
                glyphs: Uint16Array.from(glyphs)
            });
        }
        return sequences.sort((first: VariationSequences, second: VariationSequences) => first.selector - second.selector);
    }

    private result(variations: ReadonlyArray<VariationSequences>): CharacterMap {
        this.segments.sort((first: Segment, second: Segment) => first.start - second.start);
        const kept: Array<Segment> = [];
        for (const segment of this.segments) {
            const previous: Segment | undefined = kept[kept.length - 1];
            if (previous === undefined || segment.start > previous.end) {
                kept.push(segment);
            }
        }
        const map: CharacterMap = {
            starts: new Uint32Array(kept.length),
            ends: new Uint32Array(kept.length),
            modes: new Uint8Array(kept.length),
            bases: new Int32Array(kept.length),
            glyphs: Uint16Array.from(this.glyphs),
            variations
        };
        for (let index: number = 0; index < kept.length; index++) {
            map.starts[index] = kept[index].start;
            map.ends[index] = kept[index].end;
            map.modes[index] = kept[index].mode;
            map.bases[index] = kept[index].base;
        }
        this.segments = [];
        this.glyphs = [];
        return map;
    }
}
