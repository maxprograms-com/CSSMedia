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

import { brotliDecompressSync } from "node:zlib";
import { ByteCursor } from "./ByteCursor.js";
import { FontFileReader } from "./FontFileReader.js";
import type { SfntFont } from "./Typeface.js";

interface Woff2Entry {
    tag: string;
    transformed: boolean;
    length: number;
    storedLength: number;
    offset: number;
}

interface CollectionEntry {
    flavor: number;
    indices: ReadonlyArray<number>;
}

interface GlyphTables {
    glyf: Buffer;
    loca: Buffer;
    xMins: Int16Array;
}

type TripletEncoding = readonly [number, number, number, number, number, number, number];

interface GlyphStreams {
    contours: ByteCursor;
    points: ByteCursor;
    flags: ByteCursor;
    glyphs: ByteCursor;
    composites: ByteCursor;
    boxes: ByteCursor;
    instructions: ByteCursor;
    boxBitmap: Buffer;
    overlapBitmap?: Buffer;
}

const KNOWN_TAGS: ReadonlyArray<string> = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"
];

const TRIPLET_ENCODINGS: ReadonlyArray<TripletEncoding> = [
    [2, 0, 8, 0, 0, 0, -1], [2, 0, 8, 0, 0, 0, 1], [2, 0, 8, 0, 256, 0, -1], [2, 0, 8, 0, 256, 0, 1],
    [2, 0, 8, 0, 512, 0, -1], [2, 0, 8, 0, 512, 0, 1], [2, 0, 8, 0, 768, 0, -1], [2, 0, 8, 0, 768, 0, 1],
    [2, 0, 8, 0, 1024, 0, -1], [2, 0, 8, 0, 1024, 0, 1], [2, 8, 0, 0, 0, -1, 0], [2, 8, 0, 0, 0, 1, 0],
    [2, 8, 0, 256, 0, -1, 0], [2, 8, 0, 256, 0, 1, 0], [2, 8, 0, 512, 0, -1, 0], [2, 8, 0, 512, 0, 1, 0],
    [2, 8, 0, 768, 0, -1, 0], [2, 8, 0, 768, 0, 1, 0], [2, 8, 0, 1024, 0, -1, 0], [2, 8, 0, 1024, 0, 1, 0],
    [2, 4, 4, 1, 1, -1, -1], [2, 4, 4, 1, 1, 1, -1], [2, 4, 4, 1, 1, -1, 1], [2, 4, 4, 1, 1, 1, 1],
    [2, 4, 4, 1, 17, -1, -1], [2, 4, 4, 1, 17, 1, -1], [2, 4, 4, 1, 17, -1, 1], [2, 4, 4, 1, 17, 1, 1],
    [2, 4, 4, 1, 33, -1, -1], [2, 4, 4, 1, 33, 1, -1], [2, 4, 4, 1, 33, -1, 1], [2, 4, 4, 1, 33, 1, 1],
    [2, 4, 4, 1, 49, -1, -1], [2, 4, 4, 1, 49, 1, -1], [2, 4, 4, 1, 49, -1, 1], [2, 4, 4, 1, 49, 1, 1],
    [2, 4, 4, 17, 1, -1, -1], [2, 4, 4, 17, 1, 1, -1], [2, 4, 4, 17, 1, -1, 1], [2, 4, 4, 17, 1, 1, 1],
    [2, 4, 4, 17, 17, -1, -1], [2, 4, 4, 17, 17, 1, -1], [2, 4, 4, 17, 17, -1, 1], [2, 4, 4, 17, 17, 1, 1],
    [2, 4, 4, 17, 33, -1, -1], [2, 4, 4, 17, 33, 1, -1], [2, 4, 4, 17, 33, -1, 1], [2, 4, 4, 17, 33, 1, 1],
    [2, 4, 4, 17, 49, -1, -1], [2, 4, 4, 17, 49, 1, -1], [2, 4, 4, 17, 49, -1, 1], [2, 4, 4, 17, 49, 1, 1],
    [2, 4, 4, 33, 1, -1, -1], [2, 4, 4, 33, 1, 1, -1], [2, 4, 4, 33, 1, -1, 1], [2, 4, 4, 33, 1, 1, 1],
    [2, 4, 4, 33, 17, -1, -1], [2, 4, 4, 33, 17, 1, -1], [2, 4, 4, 33, 17, -1, 1], [2, 4, 4, 33, 17, 1, 1],
    [2, 4, 4, 33, 33, -1, -1], [2, 4, 4, 33, 33, 1, -1], [2, 4, 4, 33, 33, -1, 1], [2, 4, 4, 33, 33, 1, 1],
    [2, 4, 4, 33, 49, -1, -1], [2, 4, 4, 33, 49, 1, -1], [2, 4, 4, 33, 49, -1, 1], [2, 4, 4, 33, 49, 1, 1],
    [2, 4, 4, 49, 1, -1, -1], [2, 4, 4, 49, 1, 1, -1], [2, 4, 4, 49, 1, -1, 1], [2, 4, 4, 49, 1, 1, 1],
    [2, 4, 4, 49, 17, -1, -1], [2, 4, 4, 49, 17, 1, -1], [2, 4, 4, 49, 17, -1, 1], [2, 4, 4, 49, 17, 1, 1],
    [2, 4, 4, 49, 33, -1, -1], [2, 4, 4, 49, 33, 1, -1], [2, 4, 4, 49, 33, -1, 1], [2, 4, 4, 49, 33, 1, 1],
    [2, 4, 4, 49, 49, -1, -1], [2, 4, 4, 49, 49, 1, -1], [2, 4, 4, 49, 49, -1, 1], [2, 4, 4, 49, 49, 1, 1],
    [3, 8, 8, 1, 1, -1, -1], [3, 8, 8, 1, 1, 1, -1], [3, 8, 8, 1, 1, -1, 1], [3, 8, 8, 1, 1, 1, 1],
    [3, 8, 8, 1, 257, -1, -1], [3, 8, 8, 1, 257, 1, -1], [3, 8, 8, 1, 257, -1, 1], [3, 8, 8, 1, 257, 1, 1],
    [3, 8, 8, 1, 513, -1, -1], [3, 8, 8, 1, 513, 1, -1], [3, 8, 8, 1, 513, -1, 1], [3, 8, 8, 1, 513, 1, 1],
    [3, 8, 8, 257, 1, -1, -1], [3, 8, 8, 257, 1, 1, -1], [3, 8, 8, 257, 1, -1, 1], [3, 8, 8, 257, 1, 1, 1],
    [3, 8, 8, 257, 257, -1, -1], [3, 8, 8, 257, 257, 1, -1], [3, 8, 8, 257, 257, -1, 1], [3, 8, 8, 257, 257, 1, 1],
    [3, 8, 8, 257, 513, -1, -1], [3, 8, 8, 257, 513, 1, -1], [3, 8, 8, 257, 513, -1, 1], [3, 8, 8, 257, 513, 1, 1],
    [3, 8, 8, 513, 1, -1, -1], [3, 8, 8, 513, 1, 1, -1], [3, 8, 8, 513, 1, -1, 1], [3, 8, 8, 513, 1, 1, 1],
    [3, 8, 8, 513, 257, -1, -1], [3, 8, 8, 513, 257, 1, -1], [3, 8, 8, 513, 257, -1, 1], [3, 8, 8, 513, 257, 1, 1],
    [3, 8, 8, 513, 513, -1, -1], [3, 8, 8, 513, 513, 1, -1], [3, 8, 8, 513, 513, -1, 1], [3, 8, 8, 513, 513, 1, 1],
    [4, 12, 12, 0, 0, -1, -1], [4, 12, 12, 0, 0, 1, -1], [4, 12, 12, 0, 0, -1, 1], [4, 12, 12, 0, 0, 1, 1],
    [5, 16, 16, 0, 0, -1, -1], [5, 16, 16, 0, 0, 1, -1], [5, 16, 16, 0, 0, -1, 1], [5, 16, 16, 0, 0, 1, 1]
];

const HEADER_SIZE: number = 48;
const ARBITRARY_TAG: number = 63;
const ON_CURVE: number = 0x01;
const X_SHORT: number = 0x02;
const Y_SHORT: number = 0x04;
const REPEAT: number = 0x08;
const X_SAME_OR_POSITIVE: number = 0x10;
const Y_SAME_OR_POSITIVE: number = 0x20;
const OVERLAP_SIMPLE: number = 0x40;
const HAVE_INSTRUCTIONS: number = 0x0100;

export class Woff2Decoder {

    static readonly ARGS_ARE_WORDS: number = 0x0001;
    static readonly HAVE_SCALE: number = 0x0008;
    static readonly MORE_COMPONENTS: number = 0x0020;
    static readonly HAVE_X_AND_Y_SCALE: number = 0x0040;
    static readonly HAVE_TWO_BY_TWO: number = 0x0080;

    decode(data: Buffer): Array<SfntFont> {
        if (data.length < HEADER_SIZE) {
            throw new Error("The WOFF2 header is incomplete");
        }
        const flavor: number = data.readUInt32BE(4);
        const count: number = data.readUInt16BE(12);
        const compressedSize: number = data.readUInt32BE(20);
        const cursor: ByteCursor = new ByteCursor(data, HEADER_SIZE, data.length);
        const entries: Array<Woff2Entry> = [];
        let blockSize: number = 0;
        for (let index: number = 0; index < count; index++) {
            const entry: Woff2Entry = this.entry(cursor, blockSize);
            entries.push(entry);
            blockSize += entry.storedLength;
        }
        const fonts: Array<CollectionEntry> = flavor === FontFileReader.COLLECTION ? this.collectionDirectory(cursor, count) : [{ flavor, indices: this.allTables(count) }];
        const compressed: Buffer = cursor.bytes(compressedSize);
        let block: Buffer;
        try {
            block = brotliDecompressSync(compressed);
        } catch (error) {
            throw new Error("The WOFF2 font data cannot be decompressed: " + (error instanceof Error ? error.message : String(error)));
        }
        // WOFF2 §5: the table lengths must add up to the size of the decompressed block.
        if (block.length !== blockSize) {
            throw new Error("The WOFF2 table directory does not match the decompressed font data");
        }
        const glyphTables: Map<number, GlyphTables> = new Map<number, GlyphTables>();
        return fonts.map((font: CollectionEntry) => this.font(font, entries, block, glyphTables, flavor === FontFileReader.COLLECTION));
    }

    private entry(cursor: ByteCursor, offset: number): Woff2Entry {
        // WOFF2 §4.1: bits 0-5 index the known tags, bits 6-7 give the transformation version.
        const flags: number = cursor.uint8();
        const tagIndex: number = flags & 0x3F;
        const version: number = flags >> 6;
        const tag: string = tagIndex === ARBITRARY_TAG ? cursor.tag() : KNOWN_TAGS[tagIndex];
        const length: number = cursor.uintBase128();
        const glyphData: boolean = tag === "glyf" || tag === "loca";
        const transformed: boolean = glyphData ? version !== 3 : version !== 0;
        if (transformed && !(glyphData && version === 0) && !(tag === "hmtx" && version === 1)) {
            throw new Error("The WOFF2 table " + tag + " uses an unknown transformation " + version);
        }
        const storedLength: number = transformed ? cursor.uintBase128() : length;
        if (tag === "loca" && transformed && storedLength !== 0) {
            throw new Error("The transformed WOFF2 loca table has a length that is not zero");
        }
        return { tag, transformed, length, storedLength, offset };
    }

    private allTables(count: number): Array<number> {
        const indices: Array<number> = [];
        for (let index: number = 0; index < count; index++) {
            indices.push(index);
        }
        return indices;
    }

    private collectionDirectory(cursor: ByteCursor, tableCount: number): Array<CollectionEntry> {
        cursor.skip(4);
        const fontCount: number = cursor.uint255();
        const fonts: Array<CollectionEntry> = [];
        for (let font: number = 0; font < fontCount; font++) {
            const count: number = cursor.uint255();
            const flavor: number = cursor.uint32();
            const indices: Array<number> = [];
            for (let index: number = 0; index < count; index++) {
                const table: number = cursor.uint255();
                if (table >= tableCount) {
                    throw new Error("A font of the WOFF2 collection refers to a table that does not exist");
                }
                indices.push(table);
            }
            fonts.push({ flavor, indices });
        }
        return fonts;
    }

    private font(font: CollectionEntry, entries: ReadonlyArray<Woff2Entry>, block: Buffer, glyphTables: Map<number, GlyphTables>, collection: boolean): SfntFont {
        const tables: Record<string, Buffer> = {};
        let glyfIndex: number = -1;
        let locaIndex: number = -1;
        let hmtxIndex: number = -1;
        for (const index of font.indices) {
            const entry: Woff2Entry = entries[index];
            if (entry.tag === "glyf") {
                glyfIndex = index;
            } else if (entry.tag === "loca") {
                locaIndex = index;
            }
            if (entry.transformed) {
                if (entry.tag === "hmtx") {
                    hmtxIndex = index;
                }
                continue;
            }
            if (tables[entry.tag] === undefined) {
                tables[entry.tag] = block.subarray(entry.offset, entry.offset + entry.length);
            }
        }
        const glyf: Woff2Entry | undefined = glyfIndex < 0 ? undefined : entries[glyfIndex];
        const loca: Woff2Entry | undefined = locaIndex < 0 ? undefined : entries[locaIndex];
        let xMins: Int16Array | undefined;
        if (glyf !== undefined && glyf.transformed) {
            // WOFF2 §5.3 and §5.5: a transformed glyf has its transformed loca, which in a collection follows it directly.
            if (loca === undefined || !loca.transformed || (collection && locaIndex !== glyfIndex + 1)) {
                throw new Error("The WOFF2 glyf table is not paired with its loca table");
            }
            let tablesOfGlyphs: GlyphTables | undefined = glyphTables.get(glyfIndex);
            if (tablesOfGlyphs === undefined) {
                tablesOfGlyphs = this.glyphs(block.subarray(glyf.offset, glyf.offset + glyf.storedLength));
                glyphTables.set(glyfIndex, tablesOfGlyphs);
            }
            if (tablesOfGlyphs.loca.length !== loca.length) {
                throw new Error("The WOFF2 loca table has a length that does not match its glyphs");
            }
            tables["glyf"] = tablesOfGlyphs.glyf;
            tables["loca"] = tablesOfGlyphs.loca;
            xMins = tablesOfGlyphs.xMins;
        } else if (loca !== undefined && loca.transformed) {
            throw new Error("The WOFF2 loca table is transformed but its glyf table is not");
        }
        if (hmtxIndex >= 0) {
            const hmtx: Woff2Entry = entries[hmtxIndex];
            tables["hmtx"] = this.horizontalMetrics(block.subarray(hmtx.offset, hmtx.offset + hmtx.storedLength), tables, xMins);
        }
        return { flavor: font.flavor, tables };
    }

    private glyphs(table: Buffer): GlyphTables {
        // WOFF2 §5.1: the glyph records are rebuilt one glyph at a time from seven streams.
        const header: ByteCursor = new ByteCursor(table, 0, table.length);
        header.skip(2);
        const options: number = header.uint16();
        const glyphCount: number = header.uint16();
        const indexFormat: number = header.uint16();
        const sizes: Array<number> = [];
        for (let index: number = 0; index < 7; index++) {
            sizes.push(header.uint32());
        }
        let position: number = header.position;
        const next: (size: number) => ByteCursor = (size: number): ByteCursor => {
            const stream: ByteCursor = new ByteCursor(table, position, position + size);
            position += size;
            return stream;
        };
        const contours: ByteCursor = next(sizes[0]);
        const points: ByteCursor = next(sizes[1]);
        const flags: ByteCursor = next(sizes[2]);
        const glyphs: ByteCursor = next(sizes[3]);
        const composites: ByteCursor = next(sizes[4]);
        const boxArea: ByteCursor = next(sizes[5]);
        const instructions: ByteCursor = next(sizes[6]);
        const bitmapLength: number = 4 * Math.floor((glyphCount + 31) / 32);
        const boxBitmap: Buffer = boxArea.bytes(bitmapLength);
        const boxes: ByteCursor = new ByteCursor(table, boxArea.position, boxArea.end);
        const overlapBitmap: Buffer | undefined = (options & 1) !== 0 ? next((glyphCount + 7) >> 3).bytes((glyphCount + 7) >> 3) : undefined;
        const streams: GlyphStreams = { contours, points, flags, glyphs, composites, boxes, instructions, boxBitmap };
        if (overlapBitmap !== undefined) {
            streams.overlapBitmap = overlapBitmap;
        }
        const records: Array<Buffer> = [];
        const offsets: Array<number> = [];
        const xMins: Int16Array = new Int16Array(glyphCount);
        const alignment: number = indexFormat === 0 ? 2 : 4;
        let offset: number = 0;
        for (let glyph: number = 0; glyph < glyphCount; glyph++) {
            offsets.push(offset);
            const record: Buffer = this.glyph(glyph, streams, xMins);
            if (record.length === 0) {
                continue;
            }
            const padding: number = (alignment - (record.length % alignment)) % alignment;
            records.push(record);
            if (padding > 0) {
                records.push(Buffer.alloc(padding));
            }
            offset += record.length + padding;
        }
        offsets.push(offset);
        return { glyf: Buffer.concat(records, offset), loca: this.locations(offsets, indexFormat), xMins };
    }

    private glyph(glyph: number, streams: GlyphStreams, xMins: Int16Array): Buffer {
        const contourCount: number = streams.contours.int16();
        const explicitBox: boolean = (streams.boxBitmap[glyph >> 3] & (0x80 >> (glyph & 7))) !== 0;
        if (contourCount === 0) {
            if (explicitBox) {
                throw new Error("An empty glyph of the WOFF2 font has a bounding box");
            }
            return Buffer.alloc(0);
        }
        if (contourCount === -1) {
            if (!explicitBox) {
                throw new Error("A composite glyph of the WOFF2 font has no bounding box");
            }
            return this.compositeGlyph(glyph, streams, xMins);
        }
        if (contourCount < 0) {
            throw new Error("A glyph of the WOFF2 font has an invalid number of contours");
        }
        return this.simpleGlyph(glyph, contourCount, explicitBox, streams, xMins);
    }

    private simpleGlyph(glyph: number, contourCount: number, explicitBox: boolean, streams: GlyphStreams, xMins: Int16Array): Buffer {
        const endPoints: Array<number> = [];
        let pointCount: number = 0;
        for (let contour: number = 0; contour < contourCount; contour++) {
            pointCount += streams.points.uint255();
            endPoints.push(pointCount - 1);
        }
        const xs: Int32Array = new Int32Array(pointCount);
        const ys: Int32Array = new Int32Array(pointCount);
        const onCurve: Uint8Array = new Uint8Array(pointCount);
        let x: number = 0;
        let y: number = 0;
        for (let point: number = 0; point < pointCount; point++) {
            const flag: number = streams.flags.uint8();
            onCurve[point] = (flag & 0x80) === 0 ? 1 : 0;
            const deltas: [number, number] = this.triplet(flag & 0x7F, streams.glyphs);
            x += deltas[0];
            y += deltas[1];
            xs[point] = x;
            ys[point] = y;
        }
        const instructionLength: number = streams.glyphs.uint255();
        const instructions: Buffer = streams.instructions.bytes(instructionLength);
        let box: [number, number, number, number];
        if (explicitBox) {
            box = [streams.boxes.int16(), streams.boxes.int16(), streams.boxes.int16(), streams.boxes.int16()];
        } else {
            box = this.bounds(xs, ys);
        }
        xMins[glyph] = box[0];
        const overlap: boolean = streams.overlapBitmap !== undefined && (streams.overlapBitmap[glyph >> 3] & (0x80 >> (glyph & 7))) !== 0;
        return this.encodeSimple(contourCount, box, endPoints, instructions, xs, ys, onCurve, overlap);
    }

    private triplet(flag: number, stream: ByteCursor): [number, number] {
        // WOFF2 §5.2: the byte count includes the flag, and the X bits come before the Y bits, most significant bit first.
        const row: TripletEncoding = TRIPLET_ENCODINGS[flag];
        let bits: number = 0;
        for (let index: number = 1; index < row[0]; index++) {
            bits = bits * 256 + stream.uint8();
        }
        const yScale: number = Math.pow(2, row[2]);
        return [row[5] * (Math.floor(bits / yScale) + row[3]), row[6] * (bits % yScale + row[4])];
    }

    private bounds(xs: Int32Array, ys: Int32Array): [number, number, number, number] {
        if (xs.length === 0) {
            return [0, 0, 0, 0];
        }
        let xMin: number = xs[0];
        let yMin: number = ys[0];
        let xMax: number = xs[0];
        let yMax: number = ys[0];
        for (let index: number = 1; index < xs.length; index++) {
            xMin = Math.min(xMin, xs[index]);
            xMax = Math.max(xMax, xs[index]);
            yMin = Math.min(yMin, ys[index]);
            yMax = Math.max(yMax, ys[index]);
        }
        return [xMin, yMin, xMax, yMax];
    }

    private encodeSimple(contourCount: number, box: [number, number, number, number], endPoints: ReadonlyArray<number>, instructions: Buffer, xs: Int32Array, ys: Int32Array, onCurve: Uint8Array, overlap: boolean): Buffer {
        const pointCount: number = xs.length;
        const pointFlags: Uint8Array = new Uint8Array(pointCount);
        const xBytes: Buffer = Buffer.alloc(pointCount * 2);
        const yBytes: Buffer = Buffer.alloc(pointCount * 2);
        let xLength: number = 0;
        let yLength: number = 0;
        let previousX: number = 0;
        let previousY: number = 0;
        for (let point: number = 0; point < pointCount; point++) {
            let flag: number = onCurve[point] === 1 ? ON_CURVE : 0;
            if (point === 0 && overlap) {
                flag |= OVERLAP_SIMPLE;
            }
            const dx: number = xs[point] - previousX;
            const dy: number = ys[point] - previousY;
            previousX = xs[point];
            previousY = ys[point];
            if (dx === 0) {
                flag |= X_SAME_OR_POSITIVE;
            } else if (dx >= -255 && dx <= 255) {
                flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0);
                xBytes[xLength++] = Math.abs(dx);
            } else {
                xBytes.writeInt16BE(dx, xLength);
                xLength += 2;
            }
            if (dy === 0) {
                flag |= Y_SAME_OR_POSITIVE;
            } else if (dy >= -255 && dy <= 255) {
                flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0);
                yBytes[yLength++] = Math.abs(dy);
            } else {
                yBytes.writeInt16BE(dy, yLength);
                yLength += 2;
            }
            pointFlags[point] = flag;
        }
        const flagBytes: Buffer = Buffer.alloc(pointCount * 2);
        let flagLength: number = 0;
        for (let point: number = 0; point < pointCount;) {
            const flag: number = pointFlags[point];
            let repeats: number = 0;
            while (point + repeats + 1 < pointCount && pointFlags[point + repeats + 1] === flag && repeats < 255) {
                repeats++;
            }
            if (repeats > 0) {
                flagBytes[flagLength++] = flag | REPEAT;
                flagBytes[flagLength++] = repeats;
            } else {
                flagBytes[flagLength++] = flag;
            }
            point += repeats + 1;
        }
        const record: Buffer = Buffer.alloc(10 + 2 * contourCount + 2 + instructions.length + flagLength + xLength + yLength);
        let offset: number = record.writeInt16BE(contourCount, 0);
        for (const value of box) {
            offset = record.writeInt16BE(value, offset);
        }
        for (const endPoint of endPoints) {
            offset = record.writeUInt16BE(endPoint, offset);
        }
        offset = record.writeUInt16BE(instructions.length, offset);
        offset += instructions.copy(record, offset);
        offset += flagBytes.copy(record, offset, 0, flagLength);
        offset += xBytes.copy(record, offset, 0, xLength);
        yBytes.copy(record, offset, 0, yLength);
        return record;
    }

    private compositeGlyph(glyph: number, streams: GlyphStreams, xMins: Int16Array): Buffer {
        const start: number = streams.composites.position;
        let instructed: boolean = false;
        let more: boolean = true;
        while (more) {
            const flags: number = streams.composites.uint16();
            let size: number = 2 + ((flags & Woff2Decoder.ARGS_ARE_WORDS) !== 0 ? 4 : 2);
            if ((flags & Woff2Decoder.HAVE_SCALE) !== 0) {
                size += 2;
            } else if ((flags & Woff2Decoder.HAVE_X_AND_Y_SCALE) !== 0) {
                size += 4;
            } else if ((flags & Woff2Decoder.HAVE_TWO_BY_TWO) !== 0) {
                size += 8;
            }
            streams.composites.skip(size);
            instructed = instructed || (flags & HAVE_INSTRUCTIONS) !== 0;
            more = (flags & Woff2Decoder.MORE_COMPONENTS) !== 0;
        }
        const components: Buffer = streams.composites.data.subarray(start, streams.composites.position);
        const instructions: Buffer | undefined = instructed ? streams.instructions.bytes(streams.glyphs.uint255()) : undefined;
        const box: Array<number> = [streams.boxes.int16(), streams.boxes.int16(), streams.boxes.int16(), streams.boxes.int16()];
        xMins[glyph] = box[0];
        const record: Buffer = Buffer.alloc(10 + components.length + (instructions === undefined ? 0 : 2 + instructions.length));
        let offset: number = record.writeInt16BE(-1, 0);
        for (const value of box) {
            offset = record.writeInt16BE(value, offset);
        }
        offset += components.copy(record, offset);
        if (instructions !== undefined) {
            offset = record.writeUInt16BE(instructions.length, offset);
            instructions.copy(record, offset);
        }
        return record;
    }

    private locations(offsets: ReadonlyArray<number>, indexFormat: number): Buffer {
        if (indexFormat === 0) {
            const loca: Buffer = Buffer.alloc(offsets.length * 2);
            for (let index: number = 0; index < offsets.length; index++) {
                if (offsets[index] / 2 > 0xFFFF) {
                    throw new Error("The glyphs of the WOFF2 font do not fit the short loca format");
                }
                loca.writeUInt16BE(offsets[index] / 2, index * 2);
            }
            return loca;
        }
        const loca: Buffer = Buffer.alloc(offsets.length * 4);
        for (let index: number = 0; index < offsets.length; index++) {
            loca.writeUInt32BE(offsets[index], index * 4);
        }
        return loca;
    }

    private horizontalMetrics(table: Buffer, tables: Readonly<Record<string, Buffer>>, transformedXMins?: Int16Array): Buffer {
        // WOFF2 §5.4: missing side bearings are the xMin of each glyph's bounding box.
        const hhea: Buffer | undefined = tables["hhea"];
        const maxp: Buffer | undefined = tables["maxp"];
        if (hhea === undefined || hhea.length < 36 || maxp === undefined || maxp.length < 6) {
            throw new Error("The transformed WOFF2 hmtx table has no hhea or maxp table");
        }
        const metricCount: number = hhea.readUInt16BE(34);
        const glyphCount: number = maxp.readUInt16BE(4);
        const xMins: Int16Array = transformedXMins ?? this.xMinsOf(tables, glyphCount);
        const cursor: ByteCursor = new ByteCursor(table, 0, table.length);
        const flags: number = cursor.uint8();
        if ((flags & 3) === 0 || (flags & 0xFC) !== 0 || metricCount > glyphCount || metricCount === 0) {
            throw new Error("The transformed WOFF2 hmtx table has invalid flags");
        }
        const advances: Array<number> = [];
        for (let index: number = 0; index < metricCount; index++) {
            advances.push(cursor.uint16());
        }
        const output: Buffer = Buffer.alloc(metricCount * 4 + (glyphCount - metricCount) * 2);
        for (let index: number = 0; index < metricCount; index++) {
            output.writeUInt16BE(advances[index], index * 4);
            output.writeInt16BE((flags & 1) !== 0 ? xMins[index] : cursor.int16(), index * 4 + 2);
        }
        for (let index: number = metricCount; index < glyphCount; index++) {
            output.writeInt16BE((flags & 2) !== 0 ? xMins[index] : cursor.int16(), metricCount * 4 + (index - metricCount) * 2);
        }
        return output;
    }

    private xMinsOf(tables: Readonly<Record<string, Buffer>>, glyphCount: number): Int16Array {
        const glyf: Buffer | undefined = tables["glyf"];
        const loca: Buffer | undefined = tables["loca"];
        const head: Buffer | undefined = tables["head"];
        if (glyf === undefined || loca === undefined || head === undefined || head.length < 54) {
            throw new Error("The transformed WOFF2 hmtx table belongs to a font without TrueType outlines");
        }
        const longOffsets: boolean = head.readInt16BE(50) !== 0;
        const xMins: Int16Array = new Int16Array(glyphCount);
        for (let glyph: number = 0; glyph < glyphCount; glyph++) {
            const start: number = longOffsets ? loca.readUInt32BE(glyph * 4) : loca.readUInt16BE(glyph * 2) * 2;
            const end: number = longOffsets ? loca.readUInt32BE(glyph * 4 + 4) : loca.readUInt16BE(glyph * 2 + 2) * 2;
            if (end > start && start + 4 <= glyf.length) {
                xMins[glyph] = glyf.readInt16BE(start + 2);
            }
        }
        return xMins;
    }
}
