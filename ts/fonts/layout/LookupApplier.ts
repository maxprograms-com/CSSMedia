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

import type { ContextRule, GlyphTest, SequenceRecord } from "./ContextSubtable.js";
import { ContextSubtable } from "./ContextSubtable.js";
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import type { LayoutTable, LookupHeader } from "./LayoutTable.js";

const FLAG_IGNORE_BASE: number = 0x0002;
const FLAG_IGNORE_LIGATURES: number = 0x0004;
const FLAG_IGNORE_MARKS: number = 0x0008;
const FLAG_MARK_ATTACHMENT_TYPE: number = 0xFF00;
const MAX_NESTING: number = 8;

export abstract class LookupApplier {

    protected readonly layout: FontLayout;
    protected readonly table: LayoutTable;
    protected infos: Array<GlyphInfo> = [];
    protected mask: number = 0;
    protected alternate: number = 1;
    protected rtl: boolean = false;
    protected readonly backwardLookupType?: number;
    protected header: LookupHeader = { type: 0, flag: 0, subtables: [] };
    private readonly classified: boolean;
    private depth: number = 0;

    constructor(layout: FontLayout, table: LayoutTable) {
        this.layout = layout;
        this.table = table;
        this.classified = layout.gdef?.hasGlyphClasses() === true;
    }

    run(lookupIndex: number, infos: Array<GlyphInfo>, mask: number, alternate: number, rtl: boolean): void {
        this.infos = infos;
        this.mask = mask;
        this.alternate = alternate;
        this.rtl = rtl;
        const header: LookupHeader | undefined = this.table.lookupHeaderAt(lookupIndex);
        if (header === undefined) {
            return;
        }
        if (header.type === this.backwardLookupType) {
            for (let position: number = infos.length - 1; position >= 0; position--) {
                if (position < infos.length && this.canStartAt(position)) {
                    this.applyLookupAt(lookupIndex, position);
                }
            }
            return;
        }
        let position: number = 0;
        while (position < this.infos.length) {
            if (this.canStartAt(position)) {
                const next: number = this.applyLookupAt(lookupIndex, position);
                if (next >= 0) {
                    position = Math.max(next, 0);
                    continue;
                }
            }
            position++;
        }
    }

    protected abstract applySubtable(type: number, offset: number, position: number): number;

    private canStartAt(position: number): boolean {
        // OpenType common formats: "Lookup flags affect pattern matching for other glyphs in the input sequence but not the
        // current glyph."
        return (this.infos[position].mask & this.mask) !== 0;
    }

    protected isSkipped(info: GlyphInfo): boolean {
        // OpenType common formats, "Lookup table": the lookup flag tells which glyph classes and which marks a lookup skips, and
        // "If any of these flags are set, a Glyph Class Definition table must be present".
        if (!this.classified) {
            return false;
        }
        const flag: number = this.header.flag;
        if (info.glyphClass === GlyphDefinition.MARK) {
            if ((flag & FLAG_IGNORE_MARKS) !== 0) {
                return true;
            }
            const gdef: GlyphDefinition | undefined = this.layout.gdef;
            if (this.header.markFilteringSet !== undefined) {
                return gdef === undefined || !gdef.inMarkGlyphSet(this.header.markFilteringSet, info.glyph);
            }
            const attachment: number = (flag & FLAG_MARK_ATTACHMENT_TYPE) >> 8;
            return attachment !== 0 && (gdef === undefined || gdef.markAttachClassOf(info.glyph) !== attachment);
        }
        if (info.glyphClass === GlyphDefinition.BASE) {
            return (flag & FLAG_IGNORE_BASE) !== 0;
        }
        if (info.glyphClass === GlyphDefinition.LIGATURE) {
            return (flag & FLAG_IGNORE_LIGATURES) !== 0;
        }
        return false;
    }

    private applyLookupAt(lookupIndex: number, position: number): number {
        if (this.depth >= MAX_NESTING) {
            return -1;
        }
        const header: LookupHeader | undefined = this.table.lookupHeaderAt(lookupIndex);
        if (header === undefined || position < 0 || position >= this.infos.length) {
            return -1;
        }
        const saved: LookupHeader = this.header;
        this.header = header;
        this.depth++;
        let next: number = -1;
        for (const subtable of header.subtables) {
            next = this.applySubtable(header.type, subtable, position);
            if (next >= 0) {
                break;
            }
        }
        this.depth--;
        this.header = saved;
        return next;
    }

    protected previousMatchable(position: number): number {
        let index: number = position - 1;
        while (index >= 0 && (this.isSkipped(this.infos[index]) || this.infos[index].ignorable)) {
            index--;
        }
        return index;
    }

    protected nextMatchable(position: number): number {
        let index: number = position + 1;
        while (index < this.infos.length && (this.isSkipped(this.infos[index]) || this.infos[index].ignorable)) {
            index++;
        }
        return index < this.infos.length ? index : -1;
    }

    private matchSequence(position: number, tests: ReadonlyArray<GlyphTest>): Array<number> | undefined {
        const positions: Array<number> = [position];
        let current: number = position;
        for (const test of tests) {
            let next: number = current + 1;
            for (; ;) {
                if (next >= this.infos.length) {
                    return undefined;
                }
                const info: GlyphInfo = this.infos[next];
                if (this.isSkipped(info)) {
                    next++;
                    continue;
                }
                if ((info.mask & this.mask) === 0) {
                    return undefined;
                }
                if (test(info.glyph)) {
                    break;
                }
                if (info.ignorable) {
                    next++;
                    continue;
                }
                return undefined;
            }
            positions.push(next);
            current = next;
        }
        return positions;
    }

    protected matchBacktrack(position: number, tests: ReadonlyArray<GlyphTest>): boolean {
        let current: number = position;
        for (const test of tests) {
            let previous: number = current - 1;
            for (; ;) {
                if (previous < 0) {
                    return false;
                }
                const info: GlyphInfo = this.infos[previous];
                if (this.isSkipped(info)) {
                    previous--;
                    continue;
                }
                if (test(info.glyph)) {
                    break;
                }
                if (info.ignorable) {
                    previous--;
                    continue;
                }
                return false;
            }
            current = previous;
        }
        return true;
    }

    protected matchLookahead(position: number, tests: ReadonlyArray<GlyphTest>): boolean {
        let current: number = position;
        for (const test of tests) {
            let next: number = current + 1;
            for (; ;) {
                if (next >= this.infos.length) {
                    return false;
                }
                const info: GlyphInfo = this.infos[next];
                if (this.isSkipped(info)) {
                    next++;
                    continue;
                }
                if (test(info.glyph)) {
                    break;
                }
                if (info.ignorable) {
                    next++;
                    continue;
                }
                return false;
            }
            current = next;
        }
        return true;
    }

    protected applyContext(offset: number, chained: boolean, position: number): number {
        const subtable: ContextSubtable = this.table.subtableAt(offset, (at: number): ContextSubtable => new ContextSubtable(this.table, at, chained));
        const rules: ReadonlyArray<ContextRule> | undefined = subtable.rulesFor(this.infos[position].glyph);
        if (rules === undefined) {
            return -1;
        }
        for (const rule of rules) {
            const positions: Array<number> | undefined = this.matchSequence(position, rule.input);
            if (positions === undefined) {
                continue;
            }
            if (rule.backtrack.length > 0 && !this.matchBacktrack(position, rule.backtrack)) {
                continue;
            }
            if (rule.lookahead.length > 0 && !this.matchLookahead(positions[positions.length - 1], rule.lookahead)) {
                continue;
            }
            return this.applyRecords(rule.records, positions, position);
        }
        return -1;
    }

    private applyRecords(records: ReadonlyArray<SequenceRecord>, positions: Array<number>, start: number): number {
        let end: number = positions[positions.length - 1] + 1;
        for (const record of records) {
            if (record.sequenceIndex >= positions.length) {
                continue;
            }
            const at: number = positions[record.sequenceIndex];
            const before: number = this.infos.length;
            this.applyLookupAt(record.lookupIndex, at);
            const delta: number = this.infos.length - before;
            if (delta !== 0) {
                for (let index: number = record.sequenceIndex + 1; index < positions.length; index++) {
                    positions[index] += delta;
                }
                end += delta;
            }
        }
        return Math.min(Math.max(end, start + 1), this.infos.length);
    }
}
