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

import type { Coverage } from "./Coverage.js";
import type { GlyphTest } from "./ContextSubtable.js";
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import type { LayoutTable } from "./LayoutTable.js";
import { LookupApplier } from "./LookupApplier.js";

const SINGLE: number = 1;
const MULTIPLE: number = 2;
const ALTERNATE: number = 3;
const LIGATURE: number = 4;
const CONTEXT: number = 5;
const CHAINED_CONTEXT: number = 6;
const REVERSE_CHAINED: number = 8;

interface ReverseChain {
    coverage: Coverage;
    backtrack: Array<GlyphTest>;
    lookahead: Array<GlyphTest>;
    substitutes: Array<number>;
}

export class SubstitutionApplier extends LookupApplier {

    private ligatureCounter: number = 0;
    private readonly components: Array<number> = [];

    constructor(layout: FontLayout, table: LayoutTable) {
        super(layout, table);
    }

    private refreshClass(info: GlyphInfo): void {
        info.substituted = true;
        const gdef: GlyphDefinition | undefined = this.layout.gdef;
        if (gdef !== undefined && gdef.hasGlyphClasses()) {
            info.glyphClass = gdef.glyphClassOf(info.glyph);
        } else if (info.ligatureComponents > 1) {
            info.glyphClass = GlyphDefinition.LIGATURE;
        }
    }

    protected override readonly backwardLookupType: number = REVERSE_CHAINED;

    protected applySubtable(type: number, offset: number, position: number): number {
        switch (type) {
            case SINGLE:
                return this.applySingle(offset, position);
            case MULTIPLE:
                return this.applyMultiple(offset, position);
            case ALTERNATE:
                return this.applyAlternate(offset, position);
            case LIGATURE:
                return this.applyLigature(offset, position);
            case CONTEXT:
                return this.applyContext(offset, false, position);
            case CHAINED_CONTEXT:
                return this.applyContext(offset, true, position);
            case REVERSE_CHAINED:
                return this.applyReverse(offset, position);
            default:
                return -1;
        }
    }

    private applySingle(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const info: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(info.glyph);
        if (index < 0) {
            return -1;
        }
        if (buffer.readUInt16BE(offset) === 1) {
            info.glyph = (info.glyph + buffer.readInt16BE(offset + 4)) & 0xFFFF;
        } else {
            info.glyph = buffer.readUInt16BE(offset + 6 + index * 2);
        }
        this.refreshClass(info);
        return position + 1;
    }

    private applyMultiple(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const info: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(info.glyph);
        if (index < 0) {
            return -1;
        }
        const sequence: number = offset + buffer.readUInt16BE(offset + 6 + index * 2);
        const count: number = buffer.readUInt16BE(sequence);
        const replacements: Array<GlyphInfo> = [];
        for (let component: number = 0; component < count; component++) {
            const replacement: GlyphInfo = { ...info, glyph: buffer.readUInt16BE(sequence + 2 + component * 2) };
            this.refreshClass(replacement);
            replacements.push(replacement);
        }
        this.infos.splice(position, 1, ...replacements);
        return position + count;
    }

    private applyAlternate(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const info: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(info.glyph);
        if (index < 0) {
            return -1;
        }
        const set: number = offset + buffer.readUInt16BE(offset + 6 + index * 2);
        const count: number = buffer.readUInt16BE(set);
        if (this.alternate < 1 || this.alternate > count) {
            return -1;
        }
        info.glyph = buffer.readUInt16BE(set + 2 + (this.alternate - 1) * 2);
        this.refreshClass(info);
        return position + 1;
    }

    private applyLigature(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const info: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(info.glyph);
        if (index < 0) {
            return -1;
        }
        const set: number = offset + buffer.readUInt16BE(offset + 6 + index * 2);
        const ligatureCount: number = buffer.readUInt16BE(set);
        for (let candidate: number = 0; candidate < ligatureCount; candidate++) {
            const ligature: number = set + buffer.readUInt16BE(set + 2 + candidate * 2);
            if (!this.matchComponents(position, ligature, buffer.readUInt16BE(ligature + 2))) {
                continue;
            }
            this.formLigature(this.components, buffer.readUInt16BE(ligature));
            return position + 1;
        }
        return -1;
    }

    private matchComponents(position: number, ligature: number, componentCount: number): boolean {
        // The walk of matchSequence with the glyphs read from the ligature table. It runs for every candidate ligature
        // at every glyph the lookup covers, so the positions go to a list that is reused.
        const buffer: Buffer = this.table.buffer;
        const positions: Array<number> = this.components;
        positions.length = 0;
        positions.push(position);
        let current: number = position;
        for (let component: number = 1; component < componentCount; component++) {
            const expected: number = buffer.readUInt16BE(ligature + 2 + component * 2);
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
                if ((info.mask & this.mask) === 0) {
                    return false;
                }
                if (info.glyph === expected) {
                    break;
                }
                if (info.ignorable) {
                    next++;
                    continue;
                }
                return false;
            }
            positions.push(next);
            current = next;
        }
        return true;
    }

    private formLigature(positions: ReadonlyArray<number>, glyph: number): void {
        const first: GlyphInfo = this.infos[positions[0]];
        this.ligatureCounter++;
        const id: number = this.ligatureCounter;
        let components: number = 0;
        for (let part: number = 0; part < positions.length; part++) {
            // A part can be a ligature: a mark inside it keeps its component, and a mark after a part is on its last component.
            // After the last part, only the marks of that part are in the new ligature.
            const info: GlyphInfo = this.infos[positions[part]];
            const last: boolean = part + 1 === positions.length;
            const end: number = last ? this.infos.length : positions[part + 1];
            for (let between: number = positions[part] + 1; between < end; between++) {
                const skipped: GlyphInfo = this.infos[between];
                const inside: boolean = info.ligatureId !== 0 && skipped.ligatureId === info.ligatureId;
                if (last && !inside) {
                    break;
                }
                skipped.ligatureComponent = components + (inside ? Math.min(skipped.ligatureComponent, info.ligatureComponents) : info.ligatureComponents);
                skipped.ligatureId = id;
                skipped.cluster = first.cluster;
            }
            components += info.ligatureComponents;
        }
        first.glyph = glyph;
        first.ligatureId = id;
        first.ligatureComponents = components;
        this.refreshClass(first);
        for (let component: number = positions.length - 1; component >= 1; component--) {
            this.infos.splice(positions[component], 1);
        }
    }

    private applyReverse(offset: number, position: number): number {
        const subtable: ReverseChain = this.table.subtableAt(offset, (at: number): ReverseChain => this.readReverse(at));
        const info: GlyphInfo = this.infos[position];
        const index: number = subtable.coverage.indexOf(info.glyph);
        if (index < 0 || index >= subtable.substitutes.length) {
            return -1;
        }
        if (!this.matchBacktrack(position, subtable.backtrack) || !this.matchLookahead(position, subtable.lookahead)) {
            return -1;
        }
        info.glyph = subtable.substitutes[index];
        this.refreshClass(info);
        return position + 1;
    }

    private readReverse(offset: number): ReverseChain {
        const buffer: Buffer = this.table.buffer;
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const readCoverages: (position: number) => { tests: Array<GlyphTest>; next: number } = (position: number): { tests: Array<GlyphTest>; next: number } => {
            const count: number = buffer.readUInt16BE(position);
            const tests: Array<GlyphTest> = [];
            for (let index: number = 0; index < count; index++) {
                const test: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(position + 2 + index * 2));
                tests.push((glyph: number): boolean => test.contains(glyph));
            }
            return { tests, next: position + 2 + count * 2 };
        };
        const backtrack: { tests: Array<GlyphTest>; next: number } = readCoverages(offset + 4);
        const lookahead: { tests: Array<GlyphTest>; next: number } = readCoverages(backtrack.next);
        const count: number = buffer.readUInt16BE(lookahead.next);
        const substitutes: Array<number> = [];
        for (let index: number = 0; index < count; index++) {
            substitutes.push(buffer.readUInt16BE(lookahead.next + 2 + index * 2));
        }
        return { coverage, backtrack: backtrack.tests, lookahead: lookahead.tests, substitutes };
    }
}
