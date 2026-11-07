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

import type { OutlinePoints } from "../GlyphOutlines.js";
import { GlyphOutlines } from "../GlyphOutlines.js";
import { AatLookup } from "./AatLookup.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { ATTACH_MARK } from "./GlyphInfo.js";
import { MetamorphosisApplier } from "./MetamorphosisApplier.js";

interface Subtable {
    start: number;
    body: number;
    crossStream: boolean;
    backwards: boolean;
    tupleCount: number;
}

interface Point {
    x: number;
    y: number;
}

const SUBTABLE_HEADER: number = 12;
const STATE_HEADER: number = 16;
const VERTICAL: number = 0x80000000;
const CROSS_STREAM: number = 0x40000000;
const BACKWARDS: number = 0x10000000;
const DONT_ADVANCE: number = 0x4000;
const NO_INDEX: number = 0xFFFF;
const END_OF_LIST: number = 0xFFFF;
const KERNING_STACK: number = 8;
const CLASS_END_OF_TEXT: number = 0;
const CLASS_OUT_OF_BOUNDS: number = 1;
const CLASS_DELETED: number = 2;
const VALUES_ARE_LONG: number = 0x00000001;
const CONTROL_POINTS: number = 0;
const ANCHOR_POINTS: number = 1;
const COORDINATES: number = 2;

export class ExtendedKerningApplier {

    private readonly tables: Readonly<Record<string, Buffer>>;
    private readonly table: Buffer;
    private readonly anchors?: Buffer;
    private readonly coordinates: Float64Array;
    private readonly scalars: ReadonlyArray<number>;
    private readonly lookup: AatLookup = new AatLookup();
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private infos: Array<GlyphInfo> = [];
    private vertical: boolean = false;

    constructor(tables: Readonly<Record<string, Buffer>>, coordinates: Float64Array, tupleScalars: ReadonlyArray<number>) {
        this.tables = tables;
        this.table = tables["kerx"];
        const anchors: Buffer | undefined = tables["ankr"];
        if (anchors !== undefined) {
            this.anchors = anchors;
        }
        this.coordinates = coordinates;
        this.scalars = tupleScalars;
    }

    apply(infos: Array<GlyphInfo>, vertical: boolean): void {
        // Apple TrueType Reference Manual, 'kerx': a header and subtables whose adjustments are additive; version 3 adds
        // glyph coverage after the last subtable, and version 4 allows vectors of kerning values for variation fonts.
        const version: number = this.table.readUInt16BE(0);
        if (version < 2 || version > 4) {
            return;
        }
        this.infos = infos;
        this.vertical = vertical;
        const count: number = this.table.readUInt32BE(4);
        let start: number = 8;
        for (let index: number = 0; index < count && start + SUBTABLE_HEADER <= this.table.length; index++) {
            const length: number = this.table.readUInt32BE(start);
            const coverage: number = this.table.readUInt32BE(start + 4);
            if (((coverage & VERTICAL) !== 0) === vertical) {
                this.run(coverage & 0xFF, {
                    start, body: start + SUBTABLE_HEADER, crossStream: (coverage & CROSS_STREAM) !== 0, backwards: (coverage & BACKWARDS) !== 0,
                    tupleCount: version >= 4 ? this.table.readUInt32BE(start + 8) : 0
                });
            }
            start += length;
        }
    }

    private run(format: number, subtable: Subtable): void {
        switch (format) {
            case 0:
                this.pairs(subtable, (left: number, right: number): number => this.listedPair(subtable, left, right));
                break;
            case 1:
                this.contextual(subtable);
                break;
            case 2:
                this.pairs(subtable, (left: number, right: number): number => this.offsetArrayPair(subtable, left, right));
                break;
            case 4:
                this.attach(subtable);
                break;
            case 6:
                this.pairs(subtable, (left: number, right: number): number => this.indexArrayPair(subtable, left, right));
                break;
            default:
                break;
        }
    }

    private pairs(subtable: Subtable, kerning: (left: number, right: number) => number): void {
        // "If this value is greater than zero, the glyphs are moved apart. If this value is less than zero, the glyphs are
        // moved together"; a cross-stream value moves the second glyph across the line instead.
        for (let index: number = 0; index + 1 < this.infos.length; index++) {
            const value: number = kerning(this.infos[index].glyph, this.infos[index + 1].glyph);
            if (value === 0) {
                continue;
            }
            if (subtable.crossStream) {
                this.across(this.infos[index + 1], value);
            } else {
                this.infos[index].xAdvance += value;
            }
        }
    }

    private across(info: GlyphInfo, value: number): void {
        // 'kerx' coverage: cross-stream kerning is "perpendicular to the flow of the text", so in vertical text it moves
        // the glyph left or right.
        if (this.vertical) {
            info.xOffset += value;
        } else {
            info.yOffset += value;
        }
    }

    private kerningAt(subtable: Subtable, position: number, size: number, vectors: number): number {
        // "Variation Font Support": with a tuple count, the value is the offset of a vector whose first item is the default
        // kerning and whose other items are deltas, each scaled by the scalar of one global coordinate of gvar.
        if (subtable.tupleCount === 0) {
            return size === 4 ? this.table.readInt32BE(position) : this.table.readInt16BE(position);
        }
        const vector: number = vectors + (size === 4 ? this.table.readUInt32BE(position) : this.table.readUInt16BE(position));
        if (vector + subtable.tupleCount * 2 > this.table.length) {
            return 0;
        }
        let result: number = this.table.readInt16BE(vector);
        for (let index: number = 1; index < subtable.tupleCount; index++) {
            result += this.table.readInt16BE(vector + index * 2) * (this.scalars[index - 1] ?? 0);
        }
        return result;
    }

    private listedPair(subtable: Subtable, left: number, right: number): number {
        // "Format 0 Kerning Subtable": the pairs are sorted by the 32-bit number that the left and right glyphs make.
        const key: number = left * 0x10000 + right;
        let low: number = 0;
        let high: number = this.table.readUInt32BE(subtable.body) - 1;
        while (low <= high) {
            const middle: number = (low + high) >>> 1;
            const record: number = subtable.body + 16 + middle * 6;
            if (record + 6 > this.table.length) {
                return 0;
            }
            const listed: number = this.table.readUInt16BE(record) * 0x10000 + this.table.readUInt16BE(record + 2);
            if (listed === key) {
                return this.kerningAt(subtable, record + 4, 2, subtable.start);
            }
            if (listed < key) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return 0;
    }

    private offsetArrayPair(subtable: Subtable, left: number, right: number): number {
        // "Format 2 Kerning Subtable": the class of the left glyph is the offset of its row from the start of the subtable and
        // the class of the right glyph the offset of its column; both "default to zero for glyphs not covered".
        const row: number = this.lookup.valueOf(this.table, subtable.start + this.table.readUInt32BE(subtable.body + 4), left, 2) ?? 0;
        const column: number = this.lookup.valueOf(this.table, subtable.start + this.table.readUInt32BE(subtable.body + 8), right, 2) ?? 0;
        const array: number = this.table.readUInt32BE(subtable.body + 12);
        const position: number = subtable.start + Math.max(row + column, array);
        return position + 2 <= this.table.length ? this.kerningAt(subtable, position, 2, subtable.start) : 0;
    }

    private indexArrayPair(subtable: Subtable, left: number, right: number): number {
        // "Format 6 Kerning Subtable": the row index, already multiplied by the column count, plus the column index gives the
        // index of the kerning value; with valuesAreLong the class values and the kerning values are four bytes.
        const size: number = (this.table.readUInt32BE(subtable.body) & VALUES_ARE_LONG) !== 0 ? 4 : 2;
        const row: number = this.lookup.valueOf(this.table, subtable.start + this.table.readUInt32BE(subtable.body + 8), left, size) ?? 0;
        const column: number = this.lookup.valueOf(this.table, subtable.start + this.table.readUInt32BE(subtable.body + 12), right, size) ?? 0;
        const position: number = subtable.start + this.table.readUInt32BE(subtable.body + 16) + (row + column) * size;
        if (position + size > this.table.length) {
            return 0;
        }
        const vectors: number = subtable.tupleCount === 0 ? 0 : subtable.start + this.table.readUInt32BE(subtable.body + 20);
        return this.kerningAt(subtable, position, size, vectors);
    }

    private walk(subtable: Subtable, transition: (entry: number, flags: number, index: number) => void): void {
        // "Extended State Tables", processed "from first to last in the glyph stream" or, with the process direction flag,
        // from last to first.
        const machine: number = subtable.body;
        const classCount: number = this.table.readUInt32BE(machine);
        const classes: number = machine + this.table.readUInt32BE(machine + 4);
        const states: number = machine + this.table.readUInt32BE(machine + 8);
        const entries: number = machine + this.table.readUInt32BE(machine + 12);
        if (subtable.backwards) {
            this.infos.reverse();
        }
        let state: number = 0;
        let index: number = 0;
        let budget: number = (this.infos.length + 1) * 16;
        while (index <= this.infos.length && budget-- > 0) {
            const atEnd: boolean = index === this.infos.length;
            let glyphClass: number = CLASS_END_OF_TEXT;
            if (!atEnd) {
                const glyph: number = this.infos[index].glyph;
                glyphClass = glyph === MetamorphosisApplier.DELETED_GLYPH ? CLASS_DELETED : (this.lookup.valueOf(this.table, classes, glyph, 2) ?? CLASS_OUT_OF_BOUNDS);
            }
            const cell: number = states + (state * classCount + (glyphClass < classCount ? glyphClass : CLASS_OUT_OF_BOUNDS)) * 2;
            if (cell + 2 > this.table.length) {
                break;
            }
            const entry: number = entries + this.table.readUInt16BE(cell) * 6;
            if (entry + 6 > this.table.length) {
                break;
            }
            const flags: number = this.table.readUInt16BE(entry + 2);
            transition(entry, flags, index);
            state = this.table.readUInt16BE(entry);
            if (atEnd) {
                break;
            }
            if ((flags & DONT_ADVANCE) === 0) {
                index++;
            }
        }
        if (subtable.backwards) {
            this.infos.reverse();
        }
    }

    private contextual(subtable: Subtable): void {
        // "Format 1 Kerning Subtable": the positions pushed on a stack of up to eight glyphs are popped, one for each value of
        // the list, and "The end of the list is marked by the value 0xFFFF".
        const values: number = subtable.body + this.table.readUInt32BE(subtable.body + STATE_HEADER);
        const step: number = Math.max(1, subtable.tupleCount) * 2;
        const stack: Array<number> = [];
        this.walk(subtable, (entry: number, flags: number, index: number): void => {
            if ((flags & 0x2000) !== 0) {
                stack.length = 0;
            }
            if ((flags & 0x8000) !== 0 && index < this.infos.length) {
                if (stack.length >= KERNING_STACK) {
                    stack.shift();
                }
                stack.push(index);
            }
            const valueIndex: number = this.table.readUInt16BE(entry + 4);
            if (valueIndex === NO_INDEX) {
                return;
            }
            let position: number = values + valueIndex * 2;
            while (stack.length > 0 && position + 2 <= this.table.length && this.table.readUInt16BE(position) !== END_OF_LIST) {
                const info: GlyphInfo = this.infos[stack.pop() as number];
                let value: number = this.table.readInt16BE(position);
                for (let tuple: number = 1; tuple < subtable.tupleCount; tuple++) {
                    value += this.table.readInt16BE(position + tuple * 2) * (this.scalars[tuple - 1] ?? 0);
                }
                if (subtable.crossStream) {
                    this.across(info, value);
                } else if (this.vertical) {
                    info.yOffset -= value;
                    info.xAdvance += value;
                } else {
                    info.xOffset += value;
                    info.xAdvance += value;
                }
                position += step;
            }
        });
    }

    private attach(subtable: Subtable): void {
        // "Format 4 Kerning Subtable": "The current glyph is positioned so that the two control/anchor points overlap"; the
        // points are anchor points of the 'ankr' table or coordinates, by the action type of the subtable.
        const flags: number = this.table.readUInt32BE(subtable.body + STATE_HEADER);
        const actionType: number = flags >>> 30;
        const actions: number = subtable.body + (flags & 0x00FFFFFF);
        let mark: number = -1;
        this.walk(subtable, (entry: number, entryFlags: number, index: number): void => {
            const action: number = this.table.readUInt16BE(entry + 4);
            if (action !== NO_INDEX && mark >= 0 && mark < this.infos.length && index < this.infos.length && mark !== index) {
                const points: [Point, Point] | undefined = this.actionPoints(actionType, actions, action, this.infos[mark].glyph, this.infos[index].glyph);
                if (points !== undefined) {
                    const current: GlyphInfo = this.infos[index];
                    current.xOffset = points[0].x - points[1].x;
                    current.yOffset = points[0].y - points[1].y;
                    current.attachmentKind = ATTACH_MARK;
                    // The walk holds the glyphs of a backwards subtable reversed, and they are back in order when this is read.
                    current.attachment = subtable.backwards ? index - mark : mark - index;
                }
            }
            if ((entryFlags & 0x8000) !== 0) {
                mark = index;
            }
        });
    }

    private actionPoints(actionType: number, actions: number, action: number, markGlyph: number, currentGlyph: number): [Point, Point] | undefined {
        if (actionType === CONTROL_POINTS) {
            const record: number = actions + action * 4;
            if (record + 4 > this.table.length) {
                return undefined;
            }
            const markPoint: Point | undefined = this.controlPoint(markGlyph, this.table.readUInt16BE(record));
            const currentPoint: Point | undefined = this.controlPoint(currentGlyph, this.table.readUInt16BE(record + 2));
            return markPoint === undefined || currentPoint === undefined ? undefined : [markPoint, currentPoint];
        }
        if (actionType === ANCHOR_POINTS) {
            const record: number = actions + action * 4;
            if (record + 4 > this.table.length) {
                return undefined;
            }
            const markPoint: Point | undefined = this.anchorPoint(markGlyph, this.table.readUInt16BE(record));
            const currentPoint: Point | undefined = this.anchorPoint(currentGlyph, this.table.readUInt16BE(record + 2));
            return markPoint === undefined || currentPoint === undefined ? undefined : [markPoint, currentPoint];
        }
        if (actionType === COORDINATES) {
            const record: number = actions + action * 8;
            if (record + 8 > this.table.length) {
                return undefined;
            }
            return [
                { x: this.table.readInt16BE(record), y: this.table.readInt16BE(record + 2) },
                { x: this.table.readInt16BE(record + 4), y: this.table.readInt16BE(record + 6) }
            ];
        }
        return undefined;
    }

    private controlPoint(glyph: number, point: number): Point | undefined {
        // 'kerx' format 4: the control points are those of the glyph outline, which gvar moves in a variation font.
        const outline: OutlinePoints | undefined = this.outlines.points(this.tables, glyph, this.coordinates);
        return outline === undefined || point >= outline.xs.length ? undefined : { x: outline.xs[point], y: outline.ys[point] };
    }

    private anchorPoint(glyph: number, point: number): Point | undefined {
        // Apple TrueType Reference Manual, 'ankr': the lookup table gives, for a glyph, the offset in the glyph data table of
        // its number of anchor points and their coordinates.
        const table: Buffer | undefined = this.anchors;
        if (table === undefined || table.length < 12) {
            return undefined;
        }
        const offset: number | undefined = this.lookup.valueOf(table, table.readUInt32BE(4), glyph, 2);
        if (offset === undefined) {
            return undefined;
        }
        const data: number = table.readUInt32BE(8) + offset;
        if (data + 4 > table.length || point >= table.readUInt32BE(data) || data + 4 + point * 4 + 4 > table.length) {
            return undefined;
        }
        return { x: table.readInt16BE(data + 4 + point * 4), y: table.readInt16BE(data + 4 + point * 4 + 2) };
    }
}
