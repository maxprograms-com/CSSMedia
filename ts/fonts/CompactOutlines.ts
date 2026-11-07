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

import type { PathData } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import { InstanceBuilder } from "./InstanceBuilder.js";
import type { ItemVariationData, ItemVariationStore } from "./Typeface.js";
import { VariationReader } from "./VariationReader.js";

export interface OutlineBounds {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
}

export interface SubroutineUsage {
    locals: Array<Set<number>>;
    globals: Set<number>;
    glyphs: Set<number>;
}

interface Index {
    offsets: Uint32Array;
    end: number;
}

interface FontDictionary {
    subroutines: Uint32Array;
    regions: number;
}

const CHAR_STRINGS: number = 17;
const PRIVATE: number = 18;
const SUBROUTINES: number = 19;
const CHARSET: number = 15;
const VARIATION_STORE: number = 24;
const REGIONS: number = 22;
const DICTIONARY_BLEND: number = 23;
const ESCAPE: number = 12;
const ESCAPED: number = 1200;
const FONT_DICTIONARIES: number = ESCAPED + 36;
const FONT_DICTIONARY_SELECT: number = ESCAPED + 37;
const REGISTRY_ORDERING_SUPPLEMENT: number = ESCAPED + 30;
const EXPERT: number = 1;
const EXPERT_SUBSET: number = 2;
const SUBROUTINE_DEPTH: number = 10;
const REAL_NIBBLES: ReadonlyArray<string> = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "E", "E-", "", "-"];
const STANDARD_ENCODING: ReadonlyArray<readonly [number, number, number]> = [
    [32, 126, 1], [161, 175, 96], [177, 180, 111], [182, 189, 115], [191, 191, 123], [193, 200, 124], [202, 203, 132], [205, 208, 134],
    [225, 225, 138], [227, 227, 139], [232, 235, 140], [241, 241, 144], [245, 245, 145], [248, 251, 146]
];
const EXPERT_GLYPHS: Readonly<Record<number, number>> = { 1: 1, 13: 12, 14: 13, 15: 14, 99: 15, 27: 26, 28: 27, 109: 46, 110: 47 };
const EXPERT_SUBSET_GLYPHS: Readonly<Record<number, number>> = { 1: 1, 13: 8, 14: 9, 15: 10, 99: 11, 27: 22, 28: 23, 109: 41, 110: 42 };

export class CompactOutlines {

    private readonly data: Buffer;
    private readonly second: boolean;
    private readonly charStrings: Uint32Array;
    private readonly globals: Uint32Array;
    private readonly dictionaries: Array<FontDictionary> = [];
    private readonly select: number;
    private readonly charset: number;
    private readonly cidKeyed: boolean;
    private readonly store?: ItemVariationStore;
    private readonly scalars?: Float64Array;
    private readonly blends: Map<number, Float64Array> = new Map<number, Float64Array>();
    private readonly stack: Array<number> = [];
    private readonly transient: Array<number> = [];
    private locals: Uint32Array = new Uint32Array(1);
    private regions: number = 0;
    private x: number = 0;
    private y: number = 0;
    private stems: number = 0;
    private finished: boolean = false;
    private composing: boolean = false;
    private drawn: boolean = false;
    private xMin: number = 0;
    private yMin: number = 0;
    private xMax: number = 0;
    private yMax: number = 0;
    private path?: PathData;
    private contour: boolean = false;
    private usage?: SubroutineUsage;

    static of(tables: Readonly<Record<string, Buffer>>, coordinates: Float64Array): CompactOutlines | undefined {
        // OpenType: a font has its outlines in 'glyf', in 'CFF ' or in CFF2; CFF2 has major version 2 and 'CFF ' version 1.
        const second: Buffer | undefined = tables["CFF2"];
        if (second !== undefined && second.length >= 5 && second[0] === 2) {
            return new CompactOutlines(second, true, coordinates);
        }
        const first: Buffer | undefined = tables["CFF "];
        return first !== undefined && first.length >= 4 && first[0] === 1 ? new CompactOutlines(first, false, coordinates) : undefined;
    }

    private constructor(data: Buffer, second: boolean, coordinates: Float64Array) {
        this.data = data;
        this.second = second;
        let top: Map<number, Array<number>>;
        if (second) {
            // CFF2, "Header": the TopDICT starts at headerSize and the GlobalSubrINDEX follows it.
            const globals: number = data[2] + data.readUInt16BE(3);
            top = this.dictionary(data[2], globals);
            this.globals = this.index(globals).offsets;
        } else {
            // Adobe Technical Note 5176 §6 to §10: the header, then the Name, Top DICT, String and Global Subr INDEXes.
            const tops: Index = this.index(this.index(data[2]).end);
            top = this.dictionary(tops.offsets[0], tops.offsets[1]);
            this.globals = this.index(this.index(tops.end).end).offsets;
        }
        const charStrings: Array<number> | undefined = top.get(CHAR_STRINGS);
        if (charStrings === undefined) {
            throw new Error("The font has no CharStrings INDEX");
        }
        this.charStrings = this.index(charStrings[0]).offsets;
        const fonts: Array<number> | undefined = top.get(FONT_DICTIONARIES);
        if (fonts === undefined) {
            this.dictionaries.push(this.privateDictionary(top.get(PRIVATE)));
        } else {
            const offsets: Uint32Array = this.index(fonts[0]).offsets;
            for (let font: number = 0; font + 1 < offsets.length; font++) {
                this.dictionaries.push(this.privateDictionary(this.dictionary(offsets[font], offsets[font + 1]).get(PRIVATE)));
            }
        }
        this.select = top.get(FONT_DICTIONARY_SELECT)?.[0] ?? 0;
        this.charset = top.get(CHARSET)?.[0] ?? 0;
        this.cidKeyed = !second && top.has(REGISTRY_ORDERING_SUPPLEMENT);
        const store: Array<number> | undefined = top.get(VARIATION_STORE);
        if (second && store !== undefined) {
            // CFF2, "VariationStore": "a length field followed by an ItemVariationStore table of that length".
            const builder: InstanceBuilder = new InstanceBuilder();
            this.store = new VariationReader().store(data, store[0] + 2);
            this.scalars = builder.scalars(this.store, coordinates);
        }
    }

    bounds(glyph: number): OutlineBounds | undefined {
        // OpenType vmtx: for CFF outlines "the top of the glyph's bounding box can only be calculated from the CharString data".
        if (glyph < 0 || glyph + 1 >= this.charStrings.length) {
            return undefined;
        }
        const dictionary: FontDictionary = this.dictionaryOf(glyph);
        this.locals = dictionary.subroutines;
        this.regions = dictionary.regions;
        this.transient.length = 0;
        this.drawn = false;
        this.composing = false;
        this.start(0, 0);
        this.run(this.charStrings[glyph], this.charStrings[glyph + 1], 0);
        return this.drawn ? { xMin: this.xMin, yMin: this.yMin, xMax: this.xMax, yMax: this.yMax } : undefined;
    }

    outline(glyph: number): PathData | undefined {
        // Technical Note 5177 §4.1: "If the current path is open when a moveto operator is encountered, the path is closed
        // before performing the moveto operation"; the contours of a glyph enclose its areas, so endchar closes the last one.
        if (glyph < 0 || glyph + 1 >= this.charStrings.length) {
            return undefined;
        }
        const path: PathData = { verbs: [], points: [] };
        this.path = path;
        this.contour = false;
        this.bounds(glyph);
        this.close();
        delete this.path;
        return path;
    }

    trace(glyphs: Iterable<number>): SubroutineUsage {
        // A subset keeps the CharStrings and the subroutines that running the glyphs reaches, composed glyphs included.
        const usage: SubroutineUsage = { locals: this.dictionaries.map((): Set<number> => new Set<number>()), globals: new Set<number>(), glyphs: new Set<number>() };
        this.usage = usage;
        for (const glyph of glyphs) {
            usage.glyphs.add(glyph);
            this.bounds(glyph);
        }
        delete this.usage;
        return usage;
    }

    private record(local: boolean, subroutine: number): void {
        const usage: SubroutineUsage = this.usage as SubroutineUsage;
        if (!local) {
            usage.globals.add(subroutine);
            return;
        }
        usage.locals[this.dictionaries.findIndex((dictionary: FontDictionary): boolean => dictionary.subroutines === this.locals)]?.add(subroutine);
    }

    private close(): void {
        if (this.path !== undefined && this.contour) {
            this.path.verbs.push(PathGeometry.CLOSE);
        }
        this.contour = false;
    }

    private begin(): void {
        if (this.path !== undefined && !this.contour) {
            this.path.verbs.push(PathGeometry.MOVE);
            this.path.points.push(this.x, this.y);
            this.contour = true;
        }
    }

    cids(): Uint32Array | undefined {
        // Technical Note 5176 §18 and §13: a CID-keyed font has the ROS operator in its Top DICT, and its charset gives the
        // CID of each glyph after .notdef, in format 0 one by one and in formats 1 and 2 by ranges.
        if (!this.cidKeyed) {
            return undefined;
        }
        const data: Buffer = this.data;
        const total: number = this.charStrings.length - 1;
        const cids: Uint32Array = new Uint32Array(total);
        const format: number = data[this.charset];
        let position: number = this.charset + 1;
        for (let glyph: number = 1; glyph < total;) {
            if (format === 0) {
                cids[glyph++] = data.readUInt16BE(position);
                position += 2;
                continue;
            }
            const first: number = data.readUInt16BE(position);
            const left: number = format === 2 ? data.readUInt16BE(position + 2) : data[position + 2];
            for (let step: number = 0; step <= left && glyph < total; step++) {
                cids[glyph++] = first + step;
            }
            position += format === 2 ? 4 : 3;
        }
        return cids;
    }

    private start(x: number, y: number): void {
        this.x = x;
        this.y = y;
        this.stems = 0;
        this.stack.length = 0;
        this.finished = false;
    }

    private index(offset: number): Index {
        // Technical Note 5176 §5 and CFF2 "INDEX data": the offsets count "from the byte preceding object data"; the count
        // has two bytes in 'CFF ' and four in CFF2, and an empty INDEX is the count alone.
        const data: Buffer = this.data;
        const count: number = this.second ? data.readUInt32BE(offset) : data.readUInt16BE(offset);
        const header: number = offset + (this.second ? 4 : 2);
        if (count === 0) {
            return { offsets: Uint32Array.of(header), end: header };
        }
        const size: number = data[header];
        const base: number = header + (count + 1) * size;
        const offsets: Uint32Array = new Uint32Array(count + 1);
        for (let entry: number = 0; entry <= count; entry++) {
            offsets[entry] = base + data.readUIntBE(header + 1 + entry * size, size);
        }
        return { offsets, end: offsets[count] };
    }

    private dictionary(start: number, end: number): Map<number, Array<number>> {
        // Technical Note 5176 §4: operands come before their operator; a blend of CFF2 only changes the operands of the
        // key that follows it, and none of the keys read here can be blended.
        const data: Buffer = this.data;
        const entries: Map<number, Array<number>> = new Map<number, Array<number>>();
        const operands: Array<number> = [];
        let position: number = start;
        while (position < end) {
            const byte: number = data[position++];
            if (byte === 28) {
                operands.push(data.readInt16BE(position));
                position += 2;
            } else if (byte === 29) {
                operands.push(data.readInt32BE(position));
                position += 4;
            } else if (byte === 30) {
                let text: string = "";
                let more: boolean = true;
                while (more && position < end) {
                    const pair: number = data[position++];
                    for (const nibble of [pair >> 4, pair & 0x0F]) {
                        if (nibble === 0x0F) {
                            more = false;
                            break;
                        }
                        text += REAL_NIBBLES[nibble];
                    }
                }
                operands.push(Number(text));
            } else if (byte >= 32 && byte <= 246) {
                operands.push(byte - 139);
            } else if (byte >= 247 && byte <= 250) {
                operands.push((byte - 247) * 256 + data[position++] + 108);
            } else if (byte >= 251 && byte <= 254) {
                operands.push(-(byte - 251) * 256 - data[position++] - 108);
            } else if (byte !== DICTIONARY_BLEND || !this.second) {
                entries.set(byte === ESCAPE ? ESCAPED + data[position++] : byte, operands.slice());
                operands.length = 0;
            }
        }
        return entries;
    }

    private privateDictionary(location?: Array<number>): FontDictionary {
        // The Private DICT is given by its size and offset; the offset of its local subroutines counts from its own start.
        if (location === undefined || location.length < 2 || location[0] === 0) {
            return { subroutines: new Uint32Array(1), regions: 0 };
        }
        const entries: Map<number, Array<number>> = this.dictionary(location[1], location[1] + location[0]);
        const subroutines: Array<number> | undefined = entries.get(SUBROUTINES);
        return {
            subroutines: subroutines === undefined ? new Uint32Array(1) : this.index(location[1] + subroutines[0]).offsets,
            regions: this.second ? (entries.get(REGIONS)?.[0] ?? 0) : 0
        };
    }

    private dictionaryOf(glyph: number): FontDictionary {
        // Technical Note 5176 §19 and CFF2 "FontDICTSelect": format 0 lists a Font DICT for every glyph, formats 3 and 4 list
        // ranges by their first glyph, each range ending where the next one starts.
        if (this.select === 0 || this.dictionaries.length === 1) {
            return this.dictionaries[0];
        }
        const data: Buffer = this.data;
        const format: number = data[this.select];
        let font: number = 0;
        if (format === 0) {
            font = data[this.select + 1 + glyph];
        } else if (format === 3 || format === 4) {
            const wide: boolean = format === 4;
            const records: number = this.select + (wide ? 5 : 3);
            const size: number = wide ? 6 : 3;
            let low: number = 0;
            let high: number = (wide ? data.readUInt32BE(this.select + 1) : data.readUInt16BE(this.select + 1)) - 1;
            while (low < high) {
                const middle: number = (low + high + 1) >> 1;
                const first: number = wide ? data.readUInt32BE(records + middle * size) : data.readUInt16BE(records + middle * size);
                if (first <= glyph) {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            font = wide ? data.readUInt16BE(records + low * size + 4) : data[records + low * size + 2];
        }
        return this.dictionaries[font] ?? this.dictionaries[0];
    }

    private run(start: number, end: number, depth: number): void {
        // Technical Note 5177 §3 and CFF2 "CharString": numbers go to the stack and most operators take the whole stack and
        // clear it; the first operator of a 'CFF ' CharString may have the width below its own arguments.
        const data: Buffer = this.data;
        const stack: Array<number> = this.stack;
        let position: number = start;
        while (position < end && !this.finished) {
            const byte: number = data[position++];
            if (byte === 28) {
                stack.push(data.readInt16BE(position));
                position += 2;
                continue;
            }
            if (byte >= 32) {
                if (byte <= 246) {
                    stack.push(byte - 139);
                } else if (byte <= 250) {
                    stack.push((byte - 247) * 256 + data[position++] + 108);
                } else if (byte <= 254) {
                    stack.push(-(byte - 251) * 256 - data[position++] - 108);
                } else {
                    stack.push(data.readInt32BE(position) / 65536);
                    position += 4;
                }
                continue;
            }
            const count: number = stack.length;
            switch (byte) {
                case 1:
                case 3:
                case 18:
                case 23:
                    this.stems += count >> 1;
                    break;
                case 19:
                case 20:
                    // "the vstem hint operator need not be included" before a mask, whose bytes hold one bit for each stem.
                    this.stems += count >> 1;
                    position += (this.stems + 7) >> 3;
                    break;
                case 21:
                    this.close();
                    if (count >= 2) {
                        this.x += stack[count - 2];
                        this.y += stack[count - 1];
                    }
                    break;
                case 22:
                    this.close();
                    this.x += stack[count - 1] ?? 0;
                    break;
                case 4:
                    this.close();
                    this.y += stack[count - 1] ?? 0;
                    break;
                case 5:
                    for (let index: number = 0; index + 1 < count; index += 2) {
                        this.line(stack[index], stack[index + 1]);
                    }
                    break;
                case 6:
                case 7:
                    for (let index: number = 0; index < count; index++) {
                        if ((byte === 6) === ((index & 1) === 0)) {
                            this.line(stack[index], 0);
                        } else {
                            this.line(0, stack[index]);
                        }
                    }
                    break;
                case 8:
                    for (let index: number = 0; index + 5 < count; index += 6) {
                        this.curve(stack[index], stack[index + 1], stack[index + 2], stack[index + 3], stack[index + 4], stack[index + 5]);
                    }
                    break;
                case 24: {
                    let index: number = 0;
                    for (; index + 8 <= count; index += 6) {
                        this.curve(stack[index], stack[index + 1], stack[index + 2], stack[index + 3], stack[index + 4], stack[index + 5]);
                    }
                    if (index + 1 < count) {
                        this.line(stack[index], stack[index + 1]);
                    }
                    break;
                }
                case 25: {
                    let index: number = 0;
                    for (; index + 8 <= count; index += 2) {
                        this.line(stack[index], stack[index + 1]);
                    }
                    if (index + 5 < count) {
                        this.curve(stack[index], stack[index + 1], stack[index + 2], stack[index + 3], stack[index + 4], stack[index + 5]);
                    }
                    break;
                }
                case 26:
                case 27: {
                    // An odd count gives the first curve the cross coordinate that its start tangent otherwise lacks.
                    let cross: number = (count & 1) !== 0 ? stack[0] : 0;
                    for (let index: number = count & 1; index + 3 < count; index += 4) {
                        if (byte === 26) {
                            this.curve(cross, stack[index], stack[index + 1], stack[index + 2], 0, stack[index + 3]);
                        } else {
                            this.curve(stack[index], cross, stack[index + 1], stack[index + 2], stack[index + 3], 0);
                        }
                        cross = 0;
                    }
                    break;
                }
                case 30:
                case 31: {
                    // The curves alternate between a horizontal and a vertical start tangent; "The last curve (the odd
                    // argument case) need not end horizontal/vertical".
                    let horizontal: boolean = byte === 31;
                    for (let index: number = 0; index + 4 <= count; index += 4) {
                        const last: number = count - index === 5 ? stack[index + 4] : 0;
                        if (horizontal) {
                            this.curve(stack[index], 0, stack[index + 1], stack[index + 2], last, stack[index + 3]);
                        } else {
                            this.curve(0, stack[index], stack[index + 1], stack[index + 2], stack[index + 3], last);
                        }
                        horizontal = !horizontal;
                    }
                    break;
                }
                case 10:
                case 29: {
                    const subroutines: Uint32Array = byte === 10 ? this.locals : this.globals;
                    const total: number = subroutines.length - 1;
                    const subroutine: number = (stack.pop() ?? 0) + (total < 1240 ? 107 : (total < 33900 ? 1131 : 32768));
                    if (subroutine >= 0 && subroutine < total && depth < SUBROUTINE_DEPTH) {
                        if (this.usage !== undefined) {
                            this.record(byte === 10, subroutine);
                        }
                        this.run(subroutines[subroutine], subroutines[subroutine + 1], depth + 1);
                    }
                    continue;
                }
                case 11:
                    if (!this.second) {
                        return;
                    }
                    break;
                case 14:
                    if (!this.second) {
                        this.finished = true;
                        if (count >= 4 && !this.composing) {
                            this.compose(stack[count - 4], stack[count - 3], stack[count - 2], stack[count - 1]);
                        }
                    }
                    break;
                case 15:
                    if (this.second) {
                        this.regions = stack[count - 1] ?? 0;
                    }
                    break;
                case 16:
                    if (this.second) {
                        this.blend();
                        continue;
                    }
                    break;
                case ESCAPE:
                    if (this.escaped(data[position++])) {
                        continue;
                    }
                    break;
                default:
                    break;
            }
            stack.length = 0;
        }
    }

    private escaped(operator: number): boolean {
        // The flex operators draw two curves and clear the stack; the arithmetic, storage and conditional operators exist only
        // in 'CFF ' and leave their result on the stack. CFF2: an unrecognized operator "is ignored and the stack is cleared".
        const stack: Array<number> = this.stack;
        if (operator >= 34 && operator <= 37) {
            this.flex(operator);
            return false;
        }
        if (this.second) {
            return false;
        }
        const pop: () => number = (): number => stack.pop() ?? 0;
        switch (operator) {
            case 3: {
                const second: number = pop();
                stack.push(pop() !== 0 && second !== 0 ? 1 : 0);
                return true;
            }
            case 4: {
                const second: number = pop();
                stack.push(pop() !== 0 || second !== 0 ? 1 : 0);
                return true;
            }
            case 5:
                stack.push(pop() === 0 ? 1 : 0);
                return true;
            case 9:
                stack.push(Math.abs(pop()));
                return true;
            case 10:
                stack.push(pop() + pop());
                return true;
            case 11: {
                const second: number = pop();
                stack.push(pop() - second);
                return true;
            }
            case 12: {
                const second: number = pop();
                stack.push(pop() / second);
                return true;
            }
            case 14:
                stack.push(-pop());
                return true;
            case 15:
                stack.push(pop() === pop() ? 1 : 0);
                return true;
            case 18:
                pop();
                return true;
            case 20: {
                const slot: number = pop();
                this.transient[slot] = pop();
                return true;
            }
            case 21:
                stack.push(this.transient[pop()] ?? 0);
                return true;
            case 22: {
                const second: number = pop();
                const first: number = pop();
                const otherwise: number = pop();
                const result: number = pop();
                stack.push(first <= second ? result : otherwise);
                return true;
            }
            case 23:
                // "returns a pseudo random number num2 in the range (0,1]".
                stack.push(1 - Math.random());
                return true;
            case 24:
                stack.push(pop() * pop());
                return true;
            case 26:
                stack.push(Math.sqrt(pop()));
                return true;
            case 27: {
                const value: number = pop();
                stack.push(value, value);
                return true;
            }
            case 28: {
                const second: number = pop();
                const first: number = pop();
                stack.push(second, first);
                return true;
            }
            case 29: {
                // "If i is negative, the top element is copied."
                const depth: number = Math.max(0, pop());
                stack.push(stack[stack.length - 1 - depth] ?? 0);
                return true;
            }
            case 30: {
                // "Positive J indicates upward motion of the stack", the top being its upper end.
                const shift: number = pop();
                const size: number = Math.min(Math.max(0, pop()), stack.length);
                const items: Array<number> = stack.splice(stack.length - size, size);
                for (let index: number = 0; index < size; index++) {
                    stack.push(items[(((index - shift) % size) + size) % size]);
                }
                return true;
            }
            default:
                return false;
        }
    }

    private flex(operator: number): void {
        // Technical Note 5177 §4.1: the four flex operators differ in the coordinates they leave out; in flex1 the last
        // argument is the x or the y of the end point, by the larger of the two distances covered by the other points.
        const stack: Array<number> = this.stack;
        const value: (index: number) => number = (index: number): number => stack[index] ?? 0;
        if (operator === 35) {
            this.curve(value(0), value(1), value(2), value(3), value(4), value(5));
            this.curve(value(6), value(7), value(8), value(9), value(10), value(11));
        } else if (operator === 34) {
            this.curve(value(0), 0, value(1), value(2), value(3), 0);
            this.curve(value(4), 0, value(5), -value(2), value(6), 0);
        } else if (operator === 36) {
            this.curve(value(0), value(1), value(2), value(3), value(4), 0);
            this.curve(value(5), 0, value(6), value(7), value(8), -(value(1) + value(3) + value(7)));
        } else {
            const dx: number = value(0) + value(2) + value(4) + value(6) + value(8);
            const dy: number = value(1) + value(3) + value(5) + value(7) + value(9);
            const horizontal: boolean = Math.abs(dx) > Math.abs(dy);
            this.curve(value(0), value(1), value(2), value(3), value(4), value(5));
            this.curve(value(6), value(7), value(8), value(9), horizontal ? value(10) : -dx, horizontal ? -dy : value(10));
        }
    }

    private blend(): void {
        // CFF2, "blend": "The k delta values for a particular default value are respectively multiplied by the k scalars.
        // These k products are then all added to the default value".
        const stack: Array<number> = this.stack;
        const scalars: Float64Array = this.blendScalars();
        const regions: number = scalars.length;
        const values: number = stack.pop() ?? 0;
        const base: number = stack.length - values * (regions + 1);
        if (values < 0 || base < 0) {
            stack.length = 0;
            return;
        }
        for (let value: number = 0; value < values; value++) {
            let blended: number = stack[base + value];
            for (let region: number = 0; region < regions; region++) {
                blended += scalars[region] * stack[base + values + value * regions + region];
            }
            stack[base + value] = blended;
        }
        stack.length = base + values;
    }

    private blendScalars(): Float64Array {
        let scalars: Float64Array | undefined = this.blends.get(this.regions);
        if (scalars === undefined) {
            const data: ItemVariationData | undefined = this.store?.data?.get(this.regions);
            const all: Float64Array | undefined = this.scalars;
            scalars = data === undefined || all === undefined ? new Float64Array(0) : Float64Array.from(data.regionIndexes, (region: number) => all[region]);
            this.blends.set(this.regions, scalars);
        }
        return scalars;
    }

    private compose(dx: number, dy: number, base: number, accent: number): void {
        // Technical Note 5177 Appendix C: endchar with four more arguments builds an accented glyph; "The bchar and achar
        // refer to glyph names in StandardEncoding", and "This construct may not be nested".
        this.composing = true;
        for (const [code, x, y] of [[base, 0, 0], [accent, dx, dy]]) {
            const glyph: number | undefined = this.standardGlyph(code);
            if (glyph !== undefined) {
                this.usage?.glyphs.add(glyph);
                this.close();
                this.start(x, y);
                this.run(this.charStrings[glyph], this.charStrings[glyph + 1], 0);
            }
        }
        this.finished = true;
    }

    private standardGlyph(code: number): number | undefined {
        // Technical Note 5176 §13 and Appendixes B and C: a code of the Standard Encoding names a string, and the charset
        // gives the glyph of that string, .notdef excluded; the ISOAdobe charset has the strings in glyph order.
        const range: readonly [number, number, number] | undefined = STANDARD_ENCODING.find((entry: readonly [number, number, number]) => code >= entry[0] && code <= entry[1]);
        if (range === undefined) {
            return undefined;
        }
        const name: number = range[2] + code - range[0];
        const total: number = this.charStrings.length - 1;
        let glyph: number | undefined;
        if (this.charset === EXPERT || this.charset === EXPERT_SUBSET) {
            glyph = (this.charset === EXPERT ? EXPERT_GLYPHS : EXPERT_SUBSET_GLYPHS)[name];
        } else if (this.charset === 0) {
            glyph = name;
        } else {
            const data: Buffer = this.data;
            const format: number = data[this.charset];
            let position: number = this.charset + 1;
            if (format === 0) {
                for (let candidate: number = 1; candidate < total && glyph === undefined; candidate++, position += 2) {
                    if (data.readUInt16BE(position) === name) {
                        glyph = candidate;
                    }
                }
            } else if (format === 1 || format === 2) {
                for (let candidate: number = 1; candidate < total && glyph === undefined;) {
                    const first: number = data.readUInt16BE(position);
                    const left: number = format === 2 ? data.readUInt16BE(position + 2) : data[position + 2];
                    if (name >= first && name <= first + left) {
                        glyph = candidate + name - first;
                    }
                    candidate += left + 1;
                    position += format === 2 ? 4 : 3;
                }
            }
        }
        return glyph !== undefined && glyph < total ? glyph : undefined;
    }

    private line(dx: number, dy: number): void {
        this.begin();
        this.include(this.x, this.y);
        this.x += dx;
        this.y += dy;
        this.include(this.x, this.y);
        if (this.path !== undefined) {
            this.path.verbs.push(PathGeometry.LINE);
            this.path.points.push(this.x, this.y);
        }
    }

    private curve(dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number): void {
        // The control points are relative, each to the point before it; the box of a curve is that of its end points and of
        // the points where the derivative of a coordinate is zero.
        const x0: number = this.x;
        const y0: number = this.y;
        const x1: number = x0 + dxa;
        const y1: number = y0 + dya;
        const x2: number = x1 + dxb;
        const y2: number = y1 + dyb;
        const x3: number = x2 + dxc;
        const y3: number = y2 + dyc;
        this.begin();
        if (this.path !== undefined) {
            this.path.verbs.push(PathGeometry.CURVE);
            this.path.points.push(x1, y1, x2, y2, x3, y3);
        }
        this.include(x0, y0);
        this.include(x3, y3);
        for (const t of this.extrema(x0, x1, x2, x3)) {
            this.include(this.at(x0, x1, x2, x3, t), y0);
        }
        for (const t of this.extrema(y0, y1, y2, y3)) {
            this.include(x0, this.at(y0, y1, y2, y3, t));
        }
        this.x = x3;
        this.y = y3;
    }

    private extrema(p0: number, p1: number, p2: number, p3: number): Array<number> {
        const times: Array<number> = [];
        if (Math.min(p1, p2) >= Math.min(p0, p3) && Math.max(p1, p2) <= Math.max(p0, p3)) {
            return times;
        }
        const a: number = p3 - 3 * p2 + 3 * p1 - p0;
        const b: number = 2 * (p2 - 2 * p1 + p0);
        const c: number = p1 - p0;
        if (a === 0) {
            if (b !== 0) {
                times.push(-c / b);
            }
        } else {
            const discriminant: number = b * b - 4 * a * c;
            if (discriminant >= 0) {
                const root: number = Math.sqrt(discriminant);
                times.push((-b + root) / (2 * a), (-b - root) / (2 * a));
            }
        }
        return times.filter((t: number) => t > 0 && t < 1);
    }

    private at(p0: number, p1: number, p2: number, p3: number, t: number): number {
        const s: number = 1 - t;
        return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
    }

    private include(x: number, y: number): void {
        if (!this.drawn) {
            this.drawn = true;
            this.xMin = x;
            this.xMax = x;
            this.yMin = y;
            this.yMax = y;
            return;
        }
        this.xMin = Math.min(this.xMin, x);
        this.xMax = Math.max(this.xMax, x);
        this.yMin = Math.min(this.yMin, y);
        this.yMax = Math.max(this.yMax, y);
    }
}
