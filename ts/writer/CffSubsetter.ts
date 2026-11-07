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

import type { CompactOutlines, SubroutineUsage } from "../fonts/CompactOutlines.js";

interface Entry {
    operator: number;
    operands: Buffer;
    values: Array<number>;
}

interface Index {
    offsets: Array<number>;
    end: number;
}

interface Block {
    size: number;
    data: Buffer;
}

interface Offsets {
    charset: number;
    select: number;
    charStrings: number;
    fonts: number;
    privates: number;
}

const CHARSET: number = 15;
const ENCODING: number = 16;
const CHAR_STRINGS: number = 17;
const PRIVATE: number = 18;
const SUBROUTINES: number = 19;
const ESCAPED: number = 1200;
const FONT_DICTIONARIES: number = ESCAPED + 36;
const FONT_DICTIONARY_SELECT: number = ESCAPED + 37;
const LAST_PREDEFINED_CHARSET: number = 2;
const ESCAPE: number = 12;
const ENDCHAR: Buffer = Buffer.from([14]);
const RETURN: Buffer = Buffer.from([11]);

export class CffSubsetter {

    subset(table: Buffer, used: ReadonlySet<number>, compact: CompactOutlines): Buffer {
        // Technical Note 5176 §5 to §19: the glyphs keep their indexes, so the charset and the CIDs stay as they are; the
        // CharStrings and the subroutines that no used glyph reaches become an endchar and a return.
        const requested: Set<number> = new Set<number>(used);
        requested.add(0);
        const usage: SubroutineUsage = compact.trace(requested);
        const names: Index = this.index(table, table[2]);
        const tops: Index = this.index(table, names.end);
        const strings: Index = this.index(table, tops.end);
        const globals: Index = this.index(table, strings.end);
        const top: Array<Entry> = this.dictionary(table, tops.offsets[0], tops.offsets[1]).filter((entry: Entry): boolean => entry.operator !== ENCODING);
        const charStringsAt: number | undefined = this.operand(top, CHAR_STRINGS);
        if (charStringsAt === undefined) {
            throw new Error("The font has no CharStrings INDEX");
        }
        const charStrings: Index = this.index(table, charStringsAt);
        const count: number = charStrings.offsets.length - 1;
        const kept: Array<Buffer> = [];
        for (let glyph: number = 0; glyph < count; glyph++) {
            kept.push(usage.glyphs.has(glyph) ? table.subarray(charStrings.offsets[glyph], charStrings.offsets[glyph + 1]) : ENDCHAR);
        }
        const charStringsIndex: Buffer = this.writeIndex(kept);
        const globalsIndex: Buffer = this.writeIndex(this.keep(table, globals, usage.globals));
        const charsetAt: number | undefined = this.operand(top, CHARSET);
        const charset: Buffer = charsetAt !== undefined && charsetAt > LAST_PREDEFINED_CHARSET
            ? table.subarray(charsetAt, charsetAt + this.charsetLength(table, charsetAt, count)) : Buffer.alloc(0);
        const selectAt: number | undefined = this.operand(top, FONT_DICTIONARY_SELECT);
        const select: Buffer = selectAt !== undefined ? table.subarray(selectAt, selectAt + this.selectLength(table, selectAt, count)) : Buffer.alloc(0);
        const fontsAt: number | undefined = this.operand(top, FONT_DICTIONARIES);
        const fonts: Array<Array<Entry>> = [];
        const privates: Array<Block | undefined> = [];
        if (fontsAt === undefined) {
            privates.push(this.block(table, top, usage.locals[0]));
        } else {
            const list: Index = this.index(table, fontsAt);
            for (let font: number = 0; font + 1 < list.offsets.length; font++) {
                const entries: Array<Entry> = this.dictionary(table, list.offsets[font], list.offsets[font + 1]);
                fonts.push(entries);
                privates.push(this.block(table, entries, usage.locals[font]));
            }
        }
        const fontObjects: (offsets: ReadonlyArray<number>) => Array<Buffer> = (offsets: ReadonlyArray<number>): Array<Buffer> => fonts.map((entries: Array<Entry>, font: number): Buffer => {
            const block: Block | undefined = privates[font];
            return this.serialize(entries, block === undefined ? new Map<number, Array<number>>() : new Map<number, Array<number>>([[PRIVATE, [block.size, offsets[font]]]]));
        });
        const topBytes: (offsets: Offsets, privateAt: number) => Buffer = (offsets: Offsets, privateAt: number): Buffer => {
            const patches: Map<number, Array<number>> = new Map<number, Array<number>>([[CHAR_STRINGS, [offsets.charStrings]]]);
            if (charset.length > 0) {
                patches.set(CHARSET, [offsets.charset]);
            }
            if (selectAt !== undefined) {
                patches.set(FONT_DICTIONARY_SELECT, [offsets.select]);
            }
            if (fontsAt !== undefined) {
                patches.set(FONT_DICTIONARIES, [offsets.fonts]);
            } else if (privates[0] !== undefined) {
                patches.set(PRIVATE, [privates[0].size, privateAt]);
            }
            return this.serialize(top, patches);
        };
        // Every offset is written with four bytes, so the sizes of the DICTs do not depend on the offsets and the layout can
        // be computed before they are known.
        const zero: Offsets = { charset: 0, select: 0, charStrings: 0, fonts: 0, privates: 0 };
        const base: number = names.end + this.writeIndex([topBytes(zero, 0)]).length + (strings.end - tops.end) + globalsIndex.length;
        const offsets: Offsets = { charset: base, select: 0, charStrings: 0, fonts: 0, privates: 0 };
        offsets.select = offsets.charset + charset.length;
        offsets.charStrings = offsets.select + select.length;
        offsets.fonts = offsets.charStrings + charStringsIndex.length;
        const fontsLength: number = fontsAt === undefined ? 0 : this.writeIndex(fontObjects(fonts.map((): number => 0))).length;
        offsets.privates = offsets.fonts + fontsLength;
        const places: Array<number> = [];
        let place: number = offsets.privates;
        for (const block of privates) {
            places.push(place);
            place += block === undefined ? 0 : block.data.length;
        }
        const output: Array<Buffer> = [
            table.subarray(0, names.end),
            this.writeIndex([topBytes(offsets, offsets.privates)]),
            table.subarray(tops.end, strings.end),
            globalsIndex,
            charset,
            select,
            charStringsIndex
        ];
        if (fontsAt !== undefined) {
            output.push(this.writeIndex(fontObjects(places)));
        }
        for (const block of privates) {
            if (block !== undefined) {
                output.push(block.data);
            }
        }
        return Buffer.concat(output);
    }

    private block(table: Buffer, entries: ReadonlyArray<Entry>, kept: ReadonlySet<number> | undefined): Block | undefined {
        // The Private DICT gives its size and its offset; the offset of its local subroutines counts from its own start, and
        // the INDEX of the subroutines is written right after the DICT.
        const location: Array<number> | undefined = entries.find((entry: Entry): boolean => entry.operator === PRIVATE)?.values;
        if (location === undefined || location.length < 2 || location[0] === 0) {
            return undefined;
        }
        const [size, offset]: [number, number] = [location[0], location[1]];
        const inner: Array<Entry> = this.dictionary(table, offset, offset + size);
        const subroutines: Array<number> | undefined = inner.find((entry: Entry): boolean => entry.operator === SUBROUTINES)?.values;
        if (subroutines === undefined) {
            return { size, data: table.subarray(offset, offset + size) };
        }
        const dictionary: Buffer = this.serialize(inner, new Map<number, Array<number>>([[SUBROUTINES, [this.serialize(inner, new Map<number, Array<number>>([[SUBROUTINES, [0]]])).length]]]));
        const list: Buffer = this.writeIndex(this.keep(table, this.index(table, offset + subroutines[0]), kept ?? new Set<number>()));
        return { size: dictionary.length, data: Buffer.concat([dictionary, list]) };
    }

    private keep(table: Buffer, index: Index, used: ReadonlySet<number>): Array<Buffer> {
        const objects: Array<Buffer> = [];
        for (let subroutine: number = 0; subroutine + 1 < index.offsets.length; subroutine++) {
            objects.push(used.has(subroutine) ? table.subarray(index.offsets[subroutine], index.offsets[subroutine + 1]) : RETURN);
        }
        return objects;
    }

    private operand(entries: ReadonlyArray<Entry>, operator: number): number | undefined {
        return entries.find((entry: Entry): boolean => entry.operator === operator)?.values[0];
    }

    private index(data: Buffer, offset: number): Index {
        // Technical Note 5176 §5: the offsets count "from the byte preceding object data", and an empty INDEX is the count alone.
        const count: number = data.readUInt16BE(offset);
        const header: number = offset + 2;
        if (count === 0) {
            return { offsets: [header], end: header };
        }
        const size: number = data[header];
        const base: number = header + (count + 1) * size;
        const offsets: Array<number> = [];
        for (let entry: number = 0; entry <= count; entry++) {
            offsets.push(base + data.readUIntBE(header + 1 + entry * size, size));
        }
        return { offsets, end: offsets[count] };
    }

    private writeIndex(objects: ReadonlyArray<Buffer>): Buffer {
        if (objects.length === 0) {
            return Buffer.alloc(2);
        }
        let total: number = 0;
        for (const object of objects) {
            total += object.length;
        }
        const size: number = total + 1 > 0xFFFFFF ? 4 : (total + 1 > 0xFFFF ? 3 : (total + 1 > 0xFF ? 2 : 1));
        const header: Buffer = Buffer.alloc(3 + (objects.length + 1) * size);
        header.writeUInt16BE(objects.length, 0);
        header[2] = size;
        let offset: number = 1;
        for (let entry: number = 0; entry <= objects.length; entry++) {
            header.writeUIntBE(offset, 3 + entry * size, size);
            if (entry < objects.length) {
                offset += objects[entry].length;
            }
        }
        const parts: Array<Buffer> = [header];
        for (const object of objects) {
            parts.push(object);
        }
        return Buffer.concat(parts);
    }

    private dictionary(data: Buffer, start: number, end: number): Array<Entry> {
        // Technical Note 5176 §4: operands come before their operator, and the bytes of the operands are kept as they are.
        const entries: Array<Entry> = [];
        let values: Array<number> = [];
        let begin: number = start;
        let position: number = start;
        while (position < end) {
            const byte: number = data[position];
            if (byte === 28) {
                values.push(data.readInt16BE(position + 1));
                position += 3;
            } else if (byte === 29) {
                values.push(data.readInt32BE(position + 1));
                position += 5;
            } else if (byte === 30) {
                position++;
                let more: boolean = true;
                while (more && position < end) {
                    const pair: number = data[position++];
                    more = (pair & 0x0F) !== 0x0F && (pair >> 4) !== 0x0F;
                }
                values.push(0);
            } else if (byte >= 32 && byte <= 246) {
                values.push(byte - 139);
                position++;
            } else if (byte >= 247 && byte <= 250) {
                values.push((byte - 247) * 256 + data[position + 1] + 108);
                position += 2;
            } else if (byte >= 251 && byte <= 254) {
                values.push(-(byte - 251) * 256 - data[position + 1] - 108);
                position += 2;
            } else {
                const escaped: boolean = byte === ESCAPE;
                entries.push({ operator: escaped ? ESCAPED + data[position + 1] : byte, operands: data.subarray(begin, position), values });
                position += escaped ? 2 : 1;
                values = [];
                begin = position;
            }
        }
        return entries;
    }

    private serialize(entries: ReadonlyArray<Entry>, patches: ReadonlyMap<number, Array<number>>): Buffer {
        const parts: Array<Buffer> = [];
        for (const entry of entries) {
            const values: Array<number> | undefined = patches.get(entry.operator);
            if (values === undefined) {
                parts.push(entry.operands);
            } else {
                for (const value of values) {
                    const operand: Buffer = Buffer.alloc(5);
                    operand[0] = 29;
                    operand.writeInt32BE(value, 1);
                    parts.push(operand);
                }
            }
            parts.push(entry.operator >= ESCAPED ? Buffer.from([ESCAPE, entry.operator - ESCAPED]) : Buffer.from([entry.operator]));
        }
        return Buffer.concat(parts);
    }

    private charsetLength(table: Buffer, offset: number, glyphs: number): number {
        // Technical Note 5176 §13: format 0 has a SID for each glyph after .notdef, and formats 1 and 2 have ranges, each
        // with the number of glyphs that follow its first one.
        const format: number = table[offset];
        if (format === 0) {
            return 1 + 2 * (glyphs - 1);
        }
        const step: number = format === 2 ? 4 : 3;
        let position: number = offset + 1;
        let left: number = glyphs - 1;
        while (left > 0) {
            left -= (format === 2 ? table.readUInt16BE(position + 2) : table[position + 2]) + 1;
            position += step;
        }
        return position - offset;
    }

    private selectLength(table: Buffer, offset: number, glyphs: number): number {
        // Technical Note 5176 §19: format 0 has a Font DICT for each glyph; format 3 has the ranges and a sentinel glyph.
        return table[offset] === 0 ? 1 + glyphs : 3 + 3 * table.readUInt16BE(offset + 1) + 2;
    }
}
