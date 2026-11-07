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

const REQUIRED_TABLES: ReadonlyArray<string> = ["glyf", "head", "hhea", "hmtx", "loca", "maxp"];
const INSTRUCTION_TABLES: ReadonlyArray<string> = ["cvt ", "fpgm", "prep"];
const CHECKSUM_MAGIC: number = 0xB1B0AFBA;
const GLYPH_HEADER: number = 10;
const ARG_1_AND_2_ARE_WORDS: number = 0x0001;
const WE_HAVE_A_SCALE: number = 0x0008;
const MORE_COMPONENTS: number = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE: number = 0x0040;
const WE_HAVE_A_TWO_BY_TWO: number = 0x0080;

export class TrueTypeSubsetter {

    subset(tables: Readonly<Record<string, Buffer>>, requested: ReadonlySet<number>): Buffer {
        // ISO 32000-2 §9.9.1: glyf, head, hhea, hmtx, loca, maxp and the instruction tables, and no cmap for a CIDFont. The
        // glyphs keep their indexes, so the CIDToGIDMap stays Identity, and those that are not used are left empty.
        for (const tag of REQUIRED_TABLES) {
            if (tables[tag] === undefined) {
                throw new Error("the font has no " + tag + " table");
            }
        }
        const head: Buffer = tables["head"];
        const glyf: Buffer = tables["glyf"];
        const loca: Buffer = tables["loca"];
        const glyphCount: number = tables["maxp"].readUInt16BE(4);
        const longOffsets: boolean = head.readInt16BE(50) !== 0;
        const range: (glyph: number) => readonly [number, number] = (glyph: number): readonly [number, number] => {
            const start: number = longOffsets ? loca.readUInt32BE(glyph * 4) : loca.readUInt16BE(glyph * 2) * 2;
            const end: number = longOffsets ? loca.readUInt32BE(glyph * 4 + 4) : loca.readUInt16BE(glyph * 2 + 2) * 2;
            return [Math.min(start, glyf.length), Math.min(Math.max(start, end), glyf.length)];
        };
        const included: Set<number> = this.closure(glyf, requested, glyphCount, range);
        let last: number = 0;
        for (const glyph of included) {
            last = Math.max(last, glyph);
        }
        const count: number = last + 1;
        const pieces: Array<Buffer> = [];
        const newLoca: Buffer = Buffer.alloc((count + 1) * 4);
        let length: number = 0;
        for (let glyph: number = 0; glyph < count; glyph++) {
            newLoca.writeUInt32BE(length, glyph * 4);
            if (included.has(glyph)) {
                const [start, end]: readonly [number, number] = range(glyph);
                const padded: Buffer = Buffer.alloc(Math.ceil((end - start) / 4) * 4);
                glyf.copy(padded, 0, start, end);
                pieces.push(padded);
                length += padded.length;
            }
        }
        newLoca.writeUInt32BE(length, count * 4);
        const output: Map<string, Buffer> = new Map<string, Buffer>();
        output.set("glyf", Buffer.concat(pieces));
        output.set("loca", newLoca);
        output.set("head", this.head(head, glyf, included, range));
        output.set("hhea", this.hhea(tables["hhea"], count));
        output.set("maxp", this.maxp(tables["maxp"], count));
        output.set("hmtx", this.hmtx(tables["hhea"], tables["hmtx"], glyphCount, count));
        for (const tag of INSTRUCTION_TABLES) {
            const table: Buffer | undefined = tables[tag];
            if (table !== undefined) {
                output.set(tag, table);
            }
        }
        return this.assemble(output);
    }

    private closure(glyf: Buffer, requested: ReadonlySet<number>, glyphCount: number, range: (glyph: number) => readonly [number, number]): Set<number> {
        // OpenType glyf: a composite glyph is drawn with its components, which have to be in the subset too; glyph 0 is the
        // .notdef glyph that ISO 32000-2 §9.7.4.2 requires for CID 0.
        const included: Set<number> = new Set<number>([0]);
        const pending: Array<number> = [];
        for (const glyph of requested) {
            if (glyph > 0 && glyph < glyphCount) {
                pending.push(glyph);
            }
        }
        while (pending.length > 0) {
            const glyph: number = pending.pop() as number;
            if (included.has(glyph)) {
                continue;
            }
            included.add(glyph);
            for (const component of this.components(glyf, range(glyph))) {
                if (component < glyphCount && !included.has(component)) {
                    pending.push(component);
                }
            }
        }
        return included;
    }

    private components(glyf: Buffer, range: readonly [number, number]): Array<number> {
        const [start, end]: readonly [number, number] = range;
        const found: Array<number> = [];
        if (end - start < 10 || glyf.readInt16BE(start) >= 0) {
            return found;
        }
        let position: number = start + 10;
        let flags: number = MORE_COMPONENTS;
        while ((flags & MORE_COMPONENTS) !== 0 && position + 4 <= end) {
            flags = glyf.readUInt16BE(position);
            found.push(glyf.readUInt16BE(position + 2));
            position += 4 + ((flags & ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2);
            if ((flags & WE_HAVE_A_SCALE) !== 0) {
                position += 2;
            } else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) {
                position += 4;
            } else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) {
                position += 8;
            }
        }
        return found;
    }

    private head(source: Buffer, glyf: Buffer, included: ReadonlySet<number>, range: (glyph: number) => readonly [number, number]): Buffer {
        // OpenType head: checkSumAdjustment is computed again for the new file, the new loca has long offsets, and the bounding
        // box is "for all glyph bounding boxes", here those that are written.
        const table: Buffer = Buffer.from(source);
        table.writeUInt32BE(0, 8);
        table.writeInt16BE(1, 50);
        let left: number = Number.POSITIVE_INFINITY;
        let low: number = Number.POSITIVE_INFINITY;
        let right: number = Number.NEGATIVE_INFINITY;
        let high: number = Number.NEGATIVE_INFINITY;
        for (const glyph of included) {
            const [start, end]: readonly [number, number] = range(glyph);
            if (end - start >= GLYPH_HEADER) {
                left = Math.min(left, glyf.readInt16BE(start + 2));
                low = Math.min(low, glyf.readInt16BE(start + 4));
                right = Math.max(right, glyf.readInt16BE(start + 6));
                high = Math.max(high, glyf.readInt16BE(start + 8));
            }
        }
        if (left <= right) {
            table.writeInt16BE(left, 36);
            table.writeInt16BE(low, 38);
            table.writeInt16BE(right, 40);
            table.writeInt16BE(high, 42);
        }
        return table;
    }

    private hhea(source: Buffer, count: number): Buffer {
        const table: Buffer = Buffer.from(source);
        table.writeUInt16BE(count, 34);
        return table;
    }

    private maxp(source: Buffer, count: number): Buffer {
        const table: Buffer = Buffer.from(source);
        table.writeUInt16BE(count, 4);
        return table;
    }

    private hmtx(hhea: Buffer, source: Buffer, glyphCount: number, count: number): Buffer {
        // OpenType hmtx: numberOfHMetrics full records, then left side bearings only; the glyphs after them have the
        // advance of the last full record. The new table has a full record for every glyph.
        const metrics: number = hhea.readUInt16BE(34);
        const table: Buffer = Buffer.alloc(count * 4);
        for (let glyph: number = 0; glyph < count && glyph < glyphCount; glyph++) {
            const full: boolean = glyph < metrics;
            const advance: number = source.readUInt16BE((full ? glyph : metrics - 1) * 4);
            const bearing: number = full ? source.readInt16BE(glyph * 4 + 2) : source.readInt16BE(metrics * 4 + (glyph - metrics) * 2);
            table.writeUInt16BE(advance, glyph * 4);
            table.writeInt16BE(bearing, glyph * 4 + 2);
        }
        return table;
    }

    assemble(tables: Map<string, Buffer>): Buffer {
        // OpenType "Organization of an OpenType font": the table directory sorted by tag, each table on a 4-byte boundary
        // with its checksum, and checkSumAdjustment making the whole file add up to 0xB1B0AFBA.
        const tags: Array<string> = [...tables.keys()].sort();
        let power: number = 1;
        let exponent: number = 0;
        while (power * 2 <= tags.length) {
            power *= 2;
            exponent++;
        }
        const directory: number = 12 + tags.length * 16;
        const header: Buffer = Buffer.alloc(directory);
        header.writeUInt32BE(0x00010000, 0);
        header.writeUInt16BE(tags.length, 4);
        header.writeUInt16BE(power * 16, 6);
        header.writeUInt16BE(exponent, 8);
        header.writeUInt16BE(tags.length * 16 - power * 16, 10);
        const bodies: Array<Buffer> = [];
        let offset: number = directory;
        let headOffset: number = 0;
        tags.forEach((tag: string, index: number) => {
            const table: Buffer = tables.get(tag) as Buffer;
            const entry: number = 12 + index * 16;
            header.write(tag, entry, 4, "latin1");
            header.writeUInt32BE(this.checksum(table), entry + 4);
            header.writeUInt32BE(offset, entry + 8);
            header.writeUInt32BE(table.length, entry + 12);
            if (tag === "head") {
                headOffset = offset;
            }
            const padded: Buffer = Buffer.alloc(Math.ceil(table.length / 4) * 4);
            table.copy(padded);
            bodies.push(padded);
            offset += padded.length;
        });
        const font: Buffer = Buffer.concat([header, ...bodies]);
        font.writeUInt32BE((CHECKSUM_MAGIC - this.checksum(font)) >>> 0, headOffset + 8);
        return font;
    }

    private checksum(data: Buffer): number {
        let sum: number = 0;
        for (let position: number = 0; position < data.length; position += 4) {
            const word: number = position + 4 <= data.length ? data.readUInt32BE(position)
                : Buffer.concat([data.subarray(position), Buffer.alloc(4 - (data.length - position))]).readUInt32BE(0);
            sum = (sum + word) >>> 0;
        }
        return sum;
    }
}
