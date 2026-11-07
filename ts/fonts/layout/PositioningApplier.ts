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

import { InstanceBuilder } from "../InstanceBuilder.js";
import type { ItemVariationStore } from "../Typeface.js";
import type { ClassDefinition } from "./ClassDefinition.js";
import type { Coverage } from "./Coverage.js";
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { ATTACH_CURSIVE, ATTACH_MARK } from "./GlyphInfo.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import type { LayoutTable } from "./LayoutTable.js";
import { LookupApplier } from "./LookupApplier.js";

const SINGLE: number = 1;
const PAIR: number = 2;
const CURSIVE: number = 3;
const MARK_TO_BASE: number = 4;
const MARK_TO_LIGATURE: number = 5;
const MARK_TO_MARK: number = 6;
const CONTEXT: number = 7;
const CHAINED_CONTEXT: number = 8;
const VARIATION_INDEX: number = 0x8000;
const ZERO_WIDTH_JOINER: number = 0x200D;

interface Anchor {
    x: number;
    y: number;
}

export class PositioningApplier extends LookupApplier {

    private readonly instances: InstanceBuilder = new InstanceBuilder();
    private readonly store?: ItemVariationStore;
    private readonly scalars?: Float64Array;
    private readonly vertical: boolean;

    constructor(layout: FontLayout, table: LayoutTable, coordinates: Float64Array, vertical: boolean) {
        super(layout, table);
        this.vertical = vertical;
        // OpenType GPOS: in a variable font the values that vary refer to the item variation store of GDEF.
        const store: ItemVariationStore | undefined = layout.gdef?.variationStore;
        if (store !== undefined && coordinates.some((value: number) => value !== 0)) {
            this.store = store;
            this.scalars = this.instances.scalars(store, coordinates);
        }
    }

    protected applySubtable(type: number, offset: number, position: number): number {
        switch (type) {
            case SINGLE:
                return this.applySingle(offset, position);
            case PAIR:
                return this.applyPair(offset, position);
            case CURSIVE:
                return this.applyCursive(offset, position);
            case MARK_TO_BASE:
                return this.applyMarkToBase(offset, position);
            case MARK_TO_LIGATURE:
                return this.applyMarkToLigature(offset, position);
            case MARK_TO_MARK:
                return this.applyMarkToMark(offset, position);
            case CONTEXT:
                return this.applyContext(offset, false, position);
            case CHAINED_CONTEXT:
                return this.applyContext(offset, true, position);
            default:
                return -1;
        }
    }

    private valueSize(format: number): number {
        let count: number = 0;
        for (let bit: number = 0; bit < 8; bit++) {
            if ((format & (1 << bit)) !== 0) {
                count++;
            }
        }
        return count * 2;
    }

    private applyValueAt(info: GlyphInfo, offset: number, format: number, parent: number): void {
        // OpenType GPOS, "Value record": the fields present come in the order of the format bits; the device offsets count
        // from the parent table. The record is applied as it is read, since this runs for every pair of glyphs.
        const buffer: Buffer = this.table.buffer;
        let position: number = offset;
        let xPlacement: number = 0;
        let yPlacement: number = 0;
        let xAdvance: number = 0;
        let yAdvance: number = 0;
        if ((format & 0x01) !== 0) {
            xPlacement = buffer.readInt16BE(position);
            position += 2;
        }
        if ((format & 0x02) !== 0) {
            yPlacement = buffer.readInt16BE(position);
            position += 2;
        }
        if ((format & 0x04) !== 0) {
            xAdvance = buffer.readInt16BE(position);
            position += 2;
        }
        if ((format & 0x08) !== 0) {
            yAdvance = buffer.readInt16BE(position);
            position += 2;
        }
        if ((format & 0x10) !== 0) {
            xPlacement += this.deviceVariation(buffer.readUInt16BE(position), parent);
            position += 2;
        }
        if ((format & 0x20) !== 0) {
            yPlacement += this.deviceVariation(buffer.readUInt16BE(position), parent);
            position += 2;
        }
        if ((format & 0x40) !== 0) {
            xAdvance += this.deviceVariation(buffer.readUInt16BE(position), parent);
            position += 2;
        }
        if ((format & 0x80) !== 0) {
            yAdvance += this.deviceVariation(buffer.readUInt16BE(position), parent);
        }
        info.xOffset += xPlacement;
        info.yOffset += yPlacement;
        // OpenType GPOS: "For a top-to-bottom feature, to increase the advance height of a glyph by 100, the YAdvance = 100".
        info.xAdvance += this.vertical ? yAdvance : xAdvance;
    }

    private deviceVariation(device: number, parent: number): number {
        return device === 0 ? 0 : this.variation(parent + device);
    }

    private variation(offset: number): number {
        // OpenType common formats, "Device and VariationIndex tables": the format 0x8000 marks a delta-set index pair; a
        // Device table corrects pixel rounding at a ppem size, which a PDF does not have.
        if (offset === 0 || this.store === undefined || this.scalars === undefined || this.table.buffer.readUInt16BE(offset + 4) !== VARIATION_INDEX) {
            return 0;
        }
        return this.instances.delta(this.store, this.scalars, this.table.buffer.readUInt16BE(offset), this.table.buffer.readUInt16BE(offset + 2));
    }

    private readAnchor(offset: number): Anchor {
        // OpenType GPOS, "Anchor table": format 3 adds the offsets, from the anchor, of the tables that vary each coordinate.
        const buffer: Buffer = this.table.buffer;
        const anchor: Anchor = { x: buffer.readInt16BE(offset + 2), y: buffer.readInt16BE(offset + 4) };
        if (buffer.readUInt16BE(offset) === 3) {
            const xDevice: number = buffer.readUInt16BE(offset + 6);
            const yDevice: number = buffer.readUInt16BE(offset + 8);
            anchor.x += this.variation(xDevice === 0 ? 0 : offset + xDevice);
            anchor.y += this.variation(yDevice === 0 ? 0 : offset + yDevice);
        }
        return anchor;
    }

    private applySingle(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const info: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(info.glyph);
        if (index < 0) {
            return -1;
        }
        const format: number = buffer.readUInt16BE(offset + 4);
        if (buffer.readUInt16BE(offset) === 1) {
            this.applyValueAt(info, offset + 6, format, offset);
        } else {
            this.applyValueAt(info, offset + 8 + index * this.valueSize(format), format, offset);
        }
        return position + 1;
    }

    private applyPair(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const first: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const index: number = coverage.indexOf(first.glyph);
        if (index < 0) {
            return -1;
        }
        const nextIndex: number = this.nextMatchable(position);
        if (nextIndex < 0 || (this.infos[nextIndex].mask & this.mask) === 0) {
            return -1;
        }
        const second: GlyphInfo = this.infos[nextIndex];
        const format1: number = buffer.readUInt16BE(offset + 4);
        const format2: number = buffer.readUInt16BE(offset + 6);
        const size1: number = this.valueSize(format1);
        const size2: number = this.valueSize(format2);
        let found: number = -1;
        let parent: number = offset;
        if (buffer.readUInt16BE(offset) === 1) {
            const set: number = offset + buffer.readUInt16BE(offset + 10 + index * 2);
            const count: number = buffer.readUInt16BE(set);
            const record: number = 2 + size1 + size2;
            let low: number = 0;
            let high: number = count - 1;
            while (low <= high) {
                const middle: number = (low + high) >> 1;
                const at: number = set + 2 + middle * record;
                const glyph: number = buffer.readUInt16BE(at);
                if (glyph === second.glyph) {
                    found = at + 2;
                    parent = set;
                    break;
                }
                if (glyph < second.glyph) {
                    low = middle + 1;
                } else {
                    high = middle - 1;
                }
            }
        } else {
            const classes1: ClassDefinition = this.table.classDefinitionAt(offset + buffer.readUInt16BE(offset + 8));
            const classes2: ClassDefinition = this.table.classDefinitionAt(offset + buffer.readUInt16BE(offset + 10));
            const class1Count: number = buffer.readUInt16BE(offset + 12);
            const class2Count: number = buffer.readUInt16BE(offset + 14);
            const class1: number = classes1.classOf(first.glyph);
            const class2: number = classes2.classOf(second.glyph);
            if (class1 < class1Count && class2 < class2Count) {
                found = offset + 16 + (class1 * class2Count + class2) * (size1 + size2);
            }
        }
        if (found < 0) {
            return -1;
        }
        this.applyValueAt(first, found, format1, parent);
        this.applyValueAt(second, found + size1, format2, parent);
        return format2 !== 0 ? nextIndex + 1 : position + 1;
    }

    private applyCursive(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const current: GlyphInfo = this.infos[position];
        const coverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const currentIndex: number = coverage.indexOf(current.glyph);
        if (currentIndex < 0) {
            return -1;
        }
        const entryOffset: number = buffer.readUInt16BE(offset + 6 + currentIndex * 4);
        if (entryOffset === 0) {
            return -1;
        }
        const previousPosition: number = this.previousMatchable(position);
        if (previousPosition < 0) {
            return -1;
        }
        const previous: GlyphInfo = this.infos[previousPosition];
        const previousIndex: number = coverage.indexOf(previous.glyph);
        if (previousIndex < 0) {
            return -1;
        }
        const exitOffset: number = buffer.readUInt16BE(offset + 6 + previousIndex * 4 + 2);
        if (exitOffset === 0) {
            return -1;
        }
        const exit: Anchor = this.readAnchor(offset + exitOffset);
        const entry: Anchor = this.readAnchor(offset + entryOffset);
        let child: number = previousPosition;
        let parent: number = position;
        if ((this.header.flag & 0x0001) === 0) {
            child = position;
            parent = previousPosition;
        }
        const sign: number = child === position ? -1 : 1;
        this.infos[child].attachmentKind = ATTACH_CURSIVE;
        this.infos[child].attachment = parent - child;
        if (this.vertical) {
            // The line runs down: the advance of the first glyph ends at its exit point, the second glyph moves so that
            // its entry point is at the pen, and the x coordinates of the two points meet across the line.
            previous.xAdvance = -(exit.y + previous.yOffset);
            const delta: number = entry.y + current.yOffset;
            current.xAdvance += delta;
            current.yOffset -= delta;
            this.infos[child].xOffset = sign * (entry.x - exit.x);
            return position + 1;
        }
        if (!this.rtl) {
            previous.xAdvance = exit.x + previous.xOffset;
            const delta: number = entry.x + current.xOffset;
            current.xAdvance -= delta;
            current.xOffset -= delta;
        } else {
            const delta: number = exit.x + previous.xOffset;
            previous.xAdvance -= delta;
            previous.xOffset -= delta;
            current.xAdvance = entry.x + current.xOffset;
        }
        this.infos[child].yOffset = sign * (entry.y - exit.y);
        return position + 1;
    }

    private markBase(position: number): number {
        // The base of a mark is the closest glyph before it that is not a mark. Arabic: a ZWJ "between the space and a mark" makes
        // "a standalone sign", so the search stops there, and no other glyph is the base.
        let index: number = position - 1;
        while (index >= 0 && (this.infos[index].glyphClass === GlyphDefinition.MARK || this.isPassedOver(this.infos[index]))) {
            index--;
        }
        return index;
    }

    private isPassedOver(info: GlyphInfo): boolean {
        return info.ignorable && info.codepoint !== ZERO_WIDTH_JOINER;
    }

    private attachMark(mark: GlyphInfo, markPosition: number, basePosition: number, markAnchor: Anchor, baseAnchor: Anchor): void {
        mark.xOffset = baseAnchor.x - markAnchor.x;
        mark.yOffset = baseAnchor.y - markAnchor.y;
        mark.attachmentKind = ATTACH_MARK;
        mark.attachment = basePosition - markPosition;
    }

    private applyMarkToBase(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const mark: GlyphInfo = this.infos[position];
        const markCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const markIndex: number = markCoverage.indexOf(mark.glyph);
        if (markIndex < 0) {
            return -1;
        }
        const basePosition: number = this.markBase(position);
        if (basePosition < 0) {
            return -1;
        }
        const baseCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 4));
        const baseIndex: number = baseCoverage.indexOf(this.infos[basePosition].glyph);
        if (baseIndex < 0) {
            return -1;
        }
        const classCount: number = buffer.readUInt16BE(offset + 6);
        const markArray: number = offset + buffer.readUInt16BE(offset + 8);
        const baseArray: number = offset + buffer.readUInt16BE(offset + 10);
        const markClass: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4);
        const markAnchorOffset: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4 + 2);
        const baseAnchorOffset: number = buffer.readUInt16BE(baseArray + 2 + baseIndex * classCount * 2 + markClass * 2);
        if (markAnchorOffset === 0 || baseAnchorOffset === 0) {
            return -1;
        }
        this.attachMark(mark, position, basePosition, this.readAnchor(markArray + markAnchorOffset), this.readAnchor(baseArray + baseAnchorOffset));
        return position + 1;
    }

    private applyMarkToLigature(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const mark: GlyphInfo = this.infos[position];
        const markCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const markIndex: number = markCoverage.indexOf(mark.glyph);
        if (markIndex < 0) {
            return -1;
        }
        const basePosition: number = this.markBase(position);
        if (basePosition < 0) {
            return -1;
        }
        const ligatureCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 4));
        const ligatureIndex: number = ligatureCoverage.indexOf(this.infos[basePosition].glyph);
        if (ligatureIndex < 0) {
            return -1;
        }
        const classCount: number = buffer.readUInt16BE(offset + 6);
        const markArray: number = offset + buffer.readUInt16BE(offset + 8);
        const ligatureArray: number = offset + buffer.readUInt16BE(offset + 10);
        const attach: number = ligatureArray + buffer.readUInt16BE(ligatureArray + 2 + ligatureIndex * 2);
        const componentCount: number = buffer.readUInt16BE(attach);
        if (componentCount === 0) {
            return -1;
        }
        const component: number = mark.ligatureComponent > 0 ? Math.min(mark.ligatureComponent, componentCount) - 1 : componentCount - 1;
        const markClass: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4);
        const markAnchorOffset: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4 + 2);
        const ligatureAnchorOffset: number = buffer.readUInt16BE(attach + 2 + (component * classCount + markClass) * 2);
        if (markAnchorOffset === 0 || ligatureAnchorOffset === 0) {
            return -1;
        }
        this.attachMark(mark, position, basePosition, this.readAnchor(markArray + markAnchorOffset), this.readAnchor(attach + ligatureAnchorOffset));
        return position + 1;
    }

    private applyMarkToMark(offset: number, position: number): number {
        const buffer: Buffer = this.table.buffer;
        const mark: GlyphInfo = this.infos[position];
        const markCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        const markIndex: number = markCoverage.indexOf(mark.glyph);
        if (markIndex < 0) {
            return -1;
        }
        let previousPosition: number = position - 1;
        while (previousPosition >= 0 && this.isPassedOver(this.infos[previousPosition])) {
            previousPosition--;
        }
        if (previousPosition < 0 || this.infos[previousPosition].glyphClass !== GlyphDefinition.MARK) {
            return -1;
        }
        const previous: GlyphInfo = this.infos[previousPosition];
        // Two marks go together on the same component of the same ligature; a mark that is itself a ligature, such as a Khmer
        // COENG and its consonant, has its own id and no component, and the mark after it stacks on it all the same.
        const sameBase: boolean = previous.ligatureId === mark.ligatureId && previous.ligatureComponent === mark.ligatureComponent;
        const ligatureMark: boolean = (previous.ligatureId !== 0 && previous.ligatureComponent === 0) || (mark.ligatureId !== 0 && mark.ligatureComponent === 0);
        if (!sameBase && !ligatureMark) {
            return -1;
        }
        const baseCoverage: Coverage = this.table.coverageAt(offset + buffer.readUInt16BE(offset + 4));
        const baseIndex: number = baseCoverage.indexOf(previous.glyph);
        if (baseIndex < 0) {
            return -1;
        }
        const classCount: number = buffer.readUInt16BE(offset + 6);
        const markArray: number = offset + buffer.readUInt16BE(offset + 8);
        const baseArray: number = offset + buffer.readUInt16BE(offset + 10);
        const markClass: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4);
        const markAnchorOffset: number = buffer.readUInt16BE(markArray + 2 + markIndex * 4 + 2);
        const baseAnchorOffset: number = buffer.readUInt16BE(baseArray + 2 + baseIndex * classCount * 2 + markClass * 2);
        if (markAnchorOffset === 0 || baseAnchorOffset === 0) {
            return -1;
        }
        this.attachMark(mark, position, previousPosition, this.readAnchor(markArray + markAnchorOffset), this.readAnchor(baseArray + baseAnchorOffset));
        return position + 1;
    }
}
