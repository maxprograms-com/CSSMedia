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
import { ByteCursor } from "./ByteCursor.js";
import type { SfntFont } from "./Typeface.js";
import { Woff2Decoder } from "./Woff2Decoder.js";

interface WoffEntry {
    tag: string;
    offset: number;
    compressedLength: number;
    length: number;
}

const WOFF: number = 0x774F4646;
const WOFF2: number = 0x774F4632;
const WOFF_HEADER_SIZE: number = 44;
const WOFF_ENTRY_SIZE: number = 20;

export class FontFileReader {

    static readonly COLLECTION: number = 0x74746366;
    static readonly SFNT_VERSIONS: ReadonlySet<number> = new Set<number>([0x00010000, 0x4F54544F, 0x74727565]);

    read(data: Buffer): Array<SfntFont> {
        if (data.length < 12) {
            throw new Error("The file is too short to hold a font");
        }
        const signature: number = data.readUInt32BE(0);
        if (signature === WOFF) {
            return [this.woff(data)];
        }
        if (signature === WOFF2) {
            return new Woff2Decoder().decode(data);
        }
        if (signature === FontFileReader.COLLECTION) {
            return this.collection(data);
        }
        if (FontFileReader.SFNT_VERSIONS.has(signature)) {
            return [this.sfnt(data, 0)];
        }
        throw new Error("The file is not an OpenType, TrueType, WOFF or WOFF2 font");
    }

    private collection(data: Buffer): Array<SfntFont> {
        const cursor: ByteCursor = new ByteCursor(data, 4, data.length);
        const major: number = cursor.uint16();
        cursor.skip(2);
        if (major !== 1 && major !== 2) {
            throw new Error("The font collection has an unknown version " + major);
        }
        const count: number = cursor.uint32();
        const fonts: Array<SfntFont> = [];
        for (let index: number = 0; index < count; index++) {
            fonts.push(this.sfnt(data, cursor.uint32()));
        }
        return fonts;
    }

    private sfnt(data: Buffer, offset: number): SfntFont {
        const cursor: ByteCursor = new ByteCursor(data, offset, data.length);
        const flavor: number = cursor.uint32();
        if (!FontFileReader.SFNT_VERSIONS.has(flavor)) {
            throw new Error("A font in the file has an unknown sfnt version");
        }
        const count: number = cursor.uint16();
        cursor.skip(6);
        const tables: Record<string, Buffer> = {};
        for (let index: number = 0; index < count; index++) {
            const tag: string = cursor.tag();
            cursor.skip(4);
            const start: number = cursor.uint32();
            const length: number = cursor.uint32();
            if (start + length > data.length) {
                throw new Error("The table " + tag + " lies outside the file");
            }
            // OpenType "Table Directory": a font with two tables of one tag is unpredictable; the first one is kept.
            if (tables[tag] === undefined) {
                tables[tag] = data.subarray(start, start + length);
            }
        }
        return { flavor, tables };
    }

    private woff(data: Buffer): SfntFont {
        // WOFF 1.0 §4 and §5: every rule that makes a file invalid rejects it.
        if (data.length < WOFF_HEADER_SIZE) {
            throw new Error("The WOFF header is incomplete");
        }
        const flavor: number = data.readUInt32BE(4);
        const count: number = data.readUInt16BE(12);
        if (data.readUInt16BE(14) !== 0) {
            throw new Error("The WOFF header has a reserved field that is not zero");
        }
        const blocks: Array<[number, number]> = [];
        for (const field of [24, 36]) {
            const blockOffset: number = data.readUInt32BE(field);
            const blockLength: number = data.readUInt32BE(field + 4);
            if (blockOffset === 0 && blockLength === 0) {
                continue;
            }
            blocks.push([blockOffset, blockOffset + blockLength]);
        }
        const entries: Array<WoffEntry> = [];
        const cursor: ByteCursor = new ByteCursor(data, WOFF_HEADER_SIZE, data.length);
        let sfntSize: number = 12 + 16 * count;
        for (let index: number = 0; index < count; index++) {
            const tag: string = cursor.tag();
            const offset: number = cursor.uint32();
            const compressedLength: number = cursor.uint32();
            const tableLength: number = cursor.uint32();
            cursor.skip(4);
            if (compressedLength > tableLength) {
                throw new Error("The WOFF table " + tag + " is longer compressed than uncompressed");
            }
            entries.push({ tag, offset, compressedLength, length: tableLength });
            blocks.push([offset, offset + compressedLength]);
            sfntSize += (tableLength + 3) & ~3;
        }
        if (sfntSize !== data.readUInt32BE(16)) {
            throw new Error("The WOFF header gives a wrong totalSfntSize");
        }
        this.checkBlocks(blocks, WOFF_HEADER_SIZE + WOFF_ENTRY_SIZE * count, data.length);
        const tables: Record<string, Buffer> = {};
        for (const entry of entries) {
            const stored: Buffer = data.subarray(entry.offset, entry.offset + entry.compressedLength);
            const table: Buffer = entry.compressedLength < entry.length ? inflateSync(stored) : stored;
            if (table.length !== entry.length) {
                throw new Error("The WOFF table " + entry.tag + " does not decompress to its original length");
            }
            if (tables[entry.tag] === undefined) {
                tables[entry.tag] = table;
            }
        }
        return { flavor, tables };
    }

    private checkBlocks(blocks: Array<[number, number]>, start: number, end: number): void {
        blocks.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
        let previous: number = start;
        for (const block of blocks) {
            if (block[0] < previous || block[1] > end) {
                throw new Error("The WOFF file has blocks that overlap or extend beyond the end of the file");
            }
            previous = block[1];
        }
    }
}
