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

import { AatLookup } from "./AatLookup.js";
import type { GlyphInfo } from "./GlyphInfo.js";

export type AatSetting = readonly [number, number];

interface StateTable {
    start: number;
    classCount: number;
    classes: number;
    states: number;
    entries: number;
}

type Transition = (flags: number, index: number, entry: number) => number;

const CHAIN_HEADER: number = 16;
const FEATURE_ENTRY: number = 12;
const SUBTABLE_HEADER: number = 12;
const STATE_HEADER: number = 16;
const VERTICAL: number = 0x80000000;
const DESCENDING: number = 0x40000000;
const ALL_DIRECTIONS: number = 0x20000000;
const LOGICAL: number = 0x10000000;
const REARRANGEMENT: number = 0;
const CONTEXTUAL: number = 1;
const LIGATURE: number = 2;
const NONCONTEXTUAL: number = 4;
const INSERTION: number = 5;
const DONT_ADVANCE: number = 0x4000;
const CLASS_END_OF_TEXT: number = 0;
const CLASS_OUT_OF_BOUNDS: number = 1;
const CLASS_DELETED: number = 2;
const NO_INDEX: number = 0xFFFF;
const MAX_COMPONENTS: number = 64;
const REARRANGEMENTS: ReadonlyArray<readonly [number, boolean, number, boolean]> = [
    [0, false, 0, false], [1, false, 0, false], [0, false, 1, false], [1, false, 1, false], [2, false, 0, false], [2, true, 0, false],
    [0, false, 2, false], [0, false, 2, true], [1, false, 2, false], [1, false, 2, true], [2, false, 1, false], [2, true, 1, false],
    [2, false, 2, false], [2, true, 2, false], [2, false, 2, true], [2, true, 2, true]
];

export class MetamorphosisApplier {

    static readonly DELETED_GLYPH: number = 0xFFFF;

    private readonly table: Buffer;
    private readonly lookup: AatLookup = new AatLookup();
    private infos: Array<GlyphInfo> = [];

    constructor(table: Buffer) {
        this.table = table;
    }

    apply(infos: Array<GlyphInfo>, requested: ReadonlyArray<AatSetting>, rtl: boolean, vertical: boolean): void {
        // Apple TrueType Reference Manual, 'morx': a header, then chains; each chain has its feature table and its subtables,
        // and version 3 adds glyph coverage after the subtables of a chain.
        const version: number = this.table.readUInt16BE(0);
        if (version !== 2 && version !== 3) {
            return;
        }
        this.infos = infos;
        const chainCount: number = this.table.readUInt32BE(4);
        let chain: number = 8;
        for (let index: number = 0; index < chainCount && chain + CHAIN_HEADER <= this.table.length; index++) {
            const featureCount: number = this.table.readUInt32BE(chain + 8);
            const subtableCount: number = this.table.readUInt32BE(chain + 12);
            const flags: number = this.subFeatureFlags(chain, featureCount, requested);
            let subtable: number = chain + CHAIN_HEADER + featureCount * FEATURE_ENTRY;
            for (let item: number = 0; item < subtableCount && subtable + SUBTABLE_HEADER <= this.table.length; item++) {
                const coverage: number = this.table.readUInt32BE(subtable + 4);
                if ((this.table.readUInt32BE(subtable + 8) & flags) !== 0 && this.inDirection(coverage, vertical)) {
                    this.run(coverage, subtable + SUBTABLE_HEADER, rtl);
                }
                subtable += this.table.readUInt32BE(subtable);
            }
            chain += this.table.readUInt32BE(chain + 4);
        }
        for (let index: number = infos.length - 1; index >= 0; index--) {
            if (infos[index].glyph === MetamorphosisApplier.DELETED_GLYPH) {
                infos.splice(index, 1);
            }
        }
    }

    private subFeatureFlags(chain: number, featureCount: number, requested: ReadonlyArray<AatSetting>): number {
        // "The result is initialized to the chain's defaultFlags. The entries in the feature table are processed in order. If
        // the setting is in the requested list, the result is ANDed with the entry's disableFlags and ORed with" its enableFlags.
        let flags: number = this.table.readUInt32BE(chain);
        for (let index: number = 0; index < featureCount; index++) {
            const entry: number = chain + CHAIN_HEADER + index * FEATURE_ENTRY;
            const type: number = this.table.readUInt16BE(entry);
            const setting: number = this.table.readUInt16BE(entry + 2);
            if (requested.some((candidate: AatSetting) => candidate[0] === type && candidate[1] === setting)) {
                flags = ((flags & this.table.readUInt32BE(entry + 8)) | this.table.readUInt32BE(entry + 4)) >>> 0;
            }
        }
        return flags;
    }

    private inDirection(coverage: number, vertical: boolean): boolean {
        return (coverage & ALL_DIRECTIONS) !== 0 || ((coverage & VERTICAL) !== 0) === vertical;
    }

    private run(coverage: number, body: number, rtl: boolean): void {
        // The glyphs are held in logical order; layout order is the reverse of it in right-to-left text, and the descending
        // bit reverses whichever order the logical bit selects.
        const reversed: boolean = ((coverage & DESCENDING) !== 0) !== ((coverage & LOGICAL) === 0 && rtl);
        if (reversed) {
            this.infos.reverse();
        }
        switch (coverage & 0xFF) {
            case REARRANGEMENT:
                this.rearrange(body);
                break;
            case CONTEXTUAL:
                this.substituteInContext(body);
                break;
            case LIGATURE:
                this.formLigatures(body);
                break;
            case NONCONTEXTUAL:
                this.substitute(body);
                break;
            case INSERTION:
                this.insert(body);
                break;
            default:
                break;
        }
        if (reversed) {
            this.infos.reverse();
        }
    }

    private stateTable(start: number): StateTable {
        // "Extended State Tables": the class table is a lookup table, and the state array holds 16-bit indexes of entries.
        return {
            start,
            classCount: this.table.readUInt32BE(start),
            classes: start + this.table.readUInt32BE(start + 4),
            states: start + this.table.readUInt32BE(start + 8),
            entries: start + this.table.readUInt32BE(start + 12)
        };
    }

    private walk(machine: StateTable, entrySize: number, transition: Transition): void {
        // State 0 is the start of text; after the last glyph the machine takes the transition of the end of text class. The
        // transition returns how far the glyph index moved because of the glyphs it inserted before the current one.
        let state: number = 0;
        let index: number = 0;
        let budget: number = (this.infos.length + 1) * 16;
        while (index <= this.infos.length && budget-- > 0) {
            const atEnd: boolean = index === this.infos.length;
            const glyphClass: number = atEnd ? CLASS_END_OF_TEXT : this.classOf(machine, this.infos[index].glyph);
            const cell: number = machine.states + (state * machine.classCount + (glyphClass < machine.classCount ? glyphClass : CLASS_OUT_OF_BOUNDS)) * 2;
            if (cell + 2 > this.table.length) {
                return;
            }
            const entry: number = machine.entries + this.table.readUInt16BE(cell) * entrySize;
            if (entry + entrySize > this.table.length) {
                return;
            }
            const flags: number = this.table.readUInt16BE(entry + 2);
            index += transition(flags, index, entry);
            state = this.table.readUInt16BE(entry);
            if (atEnd) {
                return;
            }
            if ((flags & DONT_ADVANCE) === 0) {
                index++;
            }
        }
    }

    private classOf(machine: StateTable, glyph: number): number {
        if (glyph === MetamorphosisApplier.DELETED_GLYPH) {
            return CLASS_DELETED;
        }
        return this.lookup.valueOf(this.table, machine.classes, glyph, 2) ?? CLASS_OUT_OF_BOUNDS;
    }

    private rearrange(body: number): void {
        // "Indic Rearrangement Subtable": markFirst and markLast remember a range, and the verb moves up to two glyphs of
        // each end of it to the other end, in the same or the opposite order.
        const machine: StateTable = this.stateTable(body);
        let first: number = 0;
        let last: number = 0;
        this.walk(machine, 4, (flags: number, index: number): number => {
            if ((flags & 0x8000) !== 0) {
                first = index;
            }
            if ((flags & 0x2000) !== 0) {
                last = Math.min(index, this.infos.length - 1);
            }
            const [startCount, startReversed, endCount, endReversed]: readonly [number, boolean, number, boolean] = REARRANGEMENTS[flags & 0x000F];
            if (startCount + endCount > 0 && first <= last && last - first + 1 >= startCount + endCount) {
                const range: Array<GlyphInfo> = this.infos.slice(first, last + 1);
                const start: Array<GlyphInfo> = range.slice(0, startCount);
                const end: Array<GlyphInfo> = range.slice(range.length - endCount);
                const middle: Array<GlyphInfo> = range.slice(startCount, range.length - endCount);
                this.infos.splice(first, range.length, ...(endReversed ? end.reverse() : end), ...middle, ...(startReversed ? start.reverse() : start));
            }
            return 0;
        });
    }

    private substituteInContext(body: number): void {
        // "Contextual Glyph Substitution Subtable": the marked glyph and the current glyph each go through the lookup table
        // the entry names, and "If the setMark flag is set, the current glyph is made the marked glyph after the substitutions".
        const machine: StateTable = this.stateTable(body);
        const substitutions: number = body + this.table.readUInt32BE(body + STATE_HEADER);
        let mark: number = -1;
        this.walk(machine, 8, (flags: number, index: number, entry: number): number => {
            const markIndex: number = this.table.readUInt16BE(entry + 4);
            const currentIndex: number = this.table.readUInt16BE(entry + 6);
            if (markIndex !== NO_INDEX && mark >= 0 && mark < this.infos.length) {
                this.replace(this.infos[mark], substitutions + this.table.readUInt32BE(substitutions + markIndex * 4));
            }
            if (currentIndex !== NO_INDEX && index < this.infos.length) {
                this.replace(this.infos[index], substitutions + this.table.readUInt32BE(substitutions + currentIndex * 4));
            }
            if ((flags & 0x8000) !== 0) {
                mark = index;
            }
            return 0;
        });
    }

    private replace(info: GlyphInfo, lookup: number): void {
        // "Lookup tables in a 'morx'": a value of 0 means "make no substitution".
        const value: number | undefined = this.lookup.valueOf(this.table, lookup, info.glyph, 2);
        if (value !== undefined && value !== 0) {
            info.glyph = value;
        }
    }

    private substitute(body: number): void {
        for (const info of this.infos) {
            this.replace(info, body);
        }
    }

    private formLigatures(body: number): void {
        // "Ligature subtables": the glyphs pushed on the component stack are popped in reverse order; each adds, through the
        // component table, to the index of the ligature, which is stored in place of the glyph popped when the action says so.
        const machine: StateTable = this.stateTable(body);
        const actions: number = body + this.table.readUInt32BE(body + STATE_HEADER);
        const components: number = body + this.table.readUInt32BE(body + STATE_HEADER + 4);
        const ligatures: number = body + this.table.readUInt32BE(body + STATE_HEADER + 8);
        const stack: Array<number> = [];
        this.walk(machine, 6, (flags: number, index: number, entry: number): number => {
            if ((flags & 0x8000) !== 0 && index < this.infos.length) {
                if (stack.length >= MAX_COMPONENTS) {
                    stack.shift();
                }
                stack.push(index);
            }
            if ((flags & 0x2000) === 0 || stack.length === 0) {
                return 0;
            }
            let action: number = actions + this.table.readUInt16BE(entry + 4) * 4;
            let ligature: number = 0;
            const stored: Array<number> = [];
            while (stack.length > 0 && action + 4 <= this.table.length) {
                const value: number = this.table.readUInt32BE(action);
                const position: number = stack.pop() as number;
                const info: GlyphInfo = this.infos[position];
                // The offset is a 30-bit value, sign-extended and added to the glyph index to find the component.
                const offset: number = (value << 2) >> 2;
                const component: number = components + (info.glyph + offset) * 2;
                if (component < 0 || component + 2 > this.table.length) {
                    break;
                }
                ligature += this.table.readUInt16BE(component);
                if ((value & 0xC0000000) !== 0) {
                    const glyph: number = ligatures + ligature * 2;
                    if (glyph + 2 > this.table.length) {
                        break;
                    }
                    info.glyph = this.table.readUInt16BE(glyph);
                    stored.push(position);
                } else {
                    info.glyph = MetamorphosisApplier.DELETED_GLYPH;
                }
                if ((value & 0x80000000) !== 0) {
                    break;
                }
                action += 4;
            }
            // A stored ligature can be a component of a later ligature.
            stack.push(...stored.reverse());
            return 0;
        });
    }

    private insert(body: number): void {
        // "Glyph Insertion Subtable": up to 31 glyphs go before or after the marked glyph and the current glyph; when the
        // glyph index advances, it passes the glyphs inserted after the current glyph.
        const machine: StateTable = this.stateTable(body);
        const glyphs: number = body + this.table.readUInt32BE(body + STATE_HEADER);
        let mark: number = -1;
        this.walk(machine, 8, (flags: number, index: number, entry: number): number => {
            const currentInsert: number = this.table.readUInt16BE(entry + 4);
            const markedInsert: number = this.table.readUInt16BE(entry + 6);
            const currentCount: number = (flags & 0x03E0) >> 5;
            const markedCount: number = flags & 0x001F;
            let moved: number = 0;
            let current: number = index;
            if (markedInsert !== NO_INDEX && markedCount > 0 && mark >= 0 && mark < this.infos.length) {
                const before: boolean = (flags & 0x0400) !== 0;
                this.insertGlyphs(glyphs + markedInsert * 2, markedCount, mark, before);
                if (mark < current || (mark === current && before)) {
                    current += markedCount;
                    moved += markedCount;
                } else if (mark === current && (flags & DONT_ADVANCE) === 0) {
                    moved += markedCount;
                }
                if (before) {
                    mark += markedCount;
                }
            }
            if ((flags & 0x8000) !== 0) {
                mark = current;
            }
            if (currentInsert !== NO_INDEX && currentCount > 0 && current < this.infos.length) {
                const before: boolean = (flags & 0x0800) !== 0;
                this.insertGlyphs(glyphs + currentInsert * 2, currentCount, current, before);
                if (before && mark >= current) {
                    mark += currentCount;
                }
                if ((flags & DONT_ADVANCE) === 0) {
                    moved += currentCount;
                }
            }
            return moved;
        });
    }

    private insertGlyphs(list: number, count: number, position: number, before: boolean): void {
        const reference: GlyphInfo = this.infos[position];
        const inserted: Array<GlyphInfo> = [];
        for (let index: number = 0; index < count && list + index * 2 + 2 <= this.table.length; index++) {
            inserted.push({ ...reference, glyph: this.table.readUInt16BE(list + index * 2) });
        }
        this.infos.splice(before ? position : position + 1, 0, ...inserted);
    }
}
