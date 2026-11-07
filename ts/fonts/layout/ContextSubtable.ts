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

import type { ClassDefinition } from "./ClassDefinition.js";
import type { Coverage } from "./Coverage.js";
import type { LayoutTable } from "./LayoutTable.js";

export type GlyphTest = (glyph: number) => boolean;

export interface SequenceRecord {
    sequenceIndex: number;
    lookupIndex: number;
}

export interface ContextRule {
    backtrack: Array<GlyphTest>;
    input: Array<GlyphTest>;
    lookahead: Array<GlyphTest>;
    records: Array<SequenceRecord>;
}

export class ContextSubtable {

    private readonly table: LayoutTable;
    private readonly chained: boolean;
    private readonly format: number;
    private readonly coverage: Coverage;
    private readonly inputClasses?: ClassDefinition;
    private readonly ruleSets: Map<number, Array<ContextRule>> = new Map<number, Array<ContextRule>>();

    constructor(table: LayoutTable, offset: number, chained: boolean) {
        // OpenType common formats, "Sequence context" and "Chained sequence context": by glyphs, by classes or by coverages.
        this.table = table;
        this.chained = chained;
        const buffer: Buffer = table.buffer;
        this.format = buffer.readUInt16BE(offset);
        if (this.format === 3) {
            const parsed: { rule: ContextRule; first: Coverage } = this.readCoverageRule(offset);
            this.coverage = parsed.first;
            this.ruleSets.set(0, [parsed.rule]);
            return;
        }
        this.coverage = table.coverageAt(offset + buffer.readUInt16BE(offset + 2));
        if (this.format === 1) {
            const count: number = buffer.readUInt16BE(offset + 4);
            for (let index: number = 0; index < count; index++) {
                const ruleSet: number = buffer.readUInt16BE(offset + 6 + index * 2);
                if (ruleSet !== 0) {
                    this.ruleSets.set(index, this.readRuleSet(offset + ruleSet));
                }
            }
        } else {
            const classes: number = chained ? 6 : 4;
            const backtrackClasses: ClassDefinition | undefined = chained ? table.classDefinitionAt(offset + buffer.readUInt16BE(offset + 4)) : undefined;
            this.inputClasses = table.classDefinitionAt(offset + buffer.readUInt16BE(offset + classes));
            const lookaheadClasses: ClassDefinition | undefined = chained ? table.classDefinitionAt(offset + buffer.readUInt16BE(offset + 8)) : undefined;
            const countAt: number = chained ? 10 : 6;
            const count: number = buffer.readUInt16BE(offset + countAt);
            for (let index: number = 0; index < count; index++) {
                const ruleSet: number = buffer.readUInt16BE(offset + countAt + 2 + index * 2);
                if (ruleSet !== 0) {
                    this.ruleSets.set(index, this.readRuleSet(offset + ruleSet, backtrackClasses, this.inputClasses, lookaheadClasses));
                }
            }
        }
    }

    rulesFor(glyph: number): ReadonlyArray<ContextRule> | undefined {
        const index: number = this.coverage.indexOf(glyph);
        if (index < 0) {
            return undefined;
        }
        if (this.format === 1) {
            return this.ruleSets.get(index);
        }
        if (this.format === 2) {
            return this.ruleSets.get((this.inputClasses as ClassDefinition).classOf(glyph));
        }
        return this.ruleSets.get(0);
    }

    private readRuleSet(offset: number, backtrackClasses?: ClassDefinition, inputClasses?: ClassDefinition, lookaheadClasses?: ClassDefinition): Array<ContextRule> {
        const buffer: Buffer = this.table.buffer;
        const count: number = buffer.readUInt16BE(offset);
        const rules: Array<ContextRule> = [];
        for (let index: number = 0; index < count; index++) {
            const rule: number = offset + buffer.readUInt16BE(offset + 2 + index * 2);
            rules.push(this.chained ? this.readChainedRule(rule, backtrackClasses, inputClasses, lookaheadClasses) : this.readRule(rule, inputClasses));
        }
        return rules;
    }

    private readRule(offset: number, inputClasses?: ClassDefinition): ContextRule {
        const buffer: Buffer = this.table.buffer;
        const glyphCount: number = buffer.readUInt16BE(offset);
        const recordCount: number = buffer.readUInt16BE(offset + 2);
        const input: Array<GlyphTest> = [];
        for (let index: number = 0; index < glyphCount - 1; index++) {
            input.push(this.testOf(buffer.readUInt16BE(offset + 4 + index * 2), inputClasses));
        }
        return { backtrack: [], input, lookahead: [], records: this.readRecords(offset + 4 + (glyphCount - 1) * 2, recordCount) };
    }

    private readChainedRule(offset: number, backtrackClasses?: ClassDefinition, inputClasses?: ClassDefinition, lookaheadClasses?: ClassDefinition): ContextRule {
        const buffer: Buffer = this.table.buffer;
        let position: number = offset;
        const backtrackCount: number = buffer.readUInt16BE(position);
        const backtrack: Array<GlyphTest> = [];
        for (let index: number = 0; index < backtrackCount; index++) {
            backtrack.push(this.testOf(buffer.readUInt16BE(position + 2 + index * 2), backtrackClasses));
        }
        position += 2 + backtrackCount * 2;
        const inputCount: number = buffer.readUInt16BE(position);
        const input: Array<GlyphTest> = [];
        for (let index: number = 0; index < inputCount - 1; index++) {
            input.push(this.testOf(buffer.readUInt16BE(position + 2 + index * 2), inputClasses));
        }
        position += 2 + Math.max(0, inputCount - 1) * 2;
        const lookaheadCount: number = buffer.readUInt16BE(position);
        const lookahead: Array<GlyphTest> = [];
        for (let index: number = 0; index < lookaheadCount; index++) {
            lookahead.push(this.testOf(buffer.readUInt16BE(position + 2 + index * 2), lookaheadClasses));
        }
        position += 2 + lookaheadCount * 2;
        const recordCount: number = buffer.readUInt16BE(position);
        return { backtrack, input, lookahead, records: this.readRecords(position + 2, recordCount) };
    }

    private readCoverageRule(offset: number): { rule: ContextRule; first: Coverage } {
        const buffer: Buffer = this.table.buffer;
        const readCoverages: (position: number) => { tests: Array<Coverage>; next: number } = (position: number): { tests: Array<Coverage>; next: number } => {
            const count: number = buffer.readUInt16BE(position);
            const tests: Array<Coverage> = [];
            for (let index: number = 0; index < count; index++) {
                tests.push(this.table.coverageAt(offset + buffer.readUInt16BE(position + 2 + index * 2)));
            }
            return { tests, next: position + 2 + count * 2 };
        };
        let backtrack: Array<Coverage> = [];
        let input: Array<Coverage>;
        let lookahead: Array<Coverage> = [];
        let recordsAt: number;
        let recordCount: number;
        if (this.chained) {
            const first: { tests: Array<Coverage>; next: number } = readCoverages(offset + 2);
            backtrack = first.tests;
            const second: { tests: Array<Coverage>; next: number } = readCoverages(first.next);
            input = second.tests;
            const third: { tests: Array<Coverage>; next: number } = readCoverages(second.next);
            lookahead = third.tests;
            recordCount = buffer.readUInt16BE(third.next);
            recordsAt = third.next + 2;
        } else {
            const glyphCount: number = buffer.readUInt16BE(offset + 2);
            recordCount = buffer.readUInt16BE(offset + 4);
            input = [];
            for (let index: number = 0; index < glyphCount; index++) {
                input.push(this.table.coverageAt(offset + buffer.readUInt16BE(offset + 6 + index * 2)));
            }
            recordsAt = offset + 6 + glyphCount * 2;
        }
        const toTest: (coverage: Coverage) => GlyphTest = (coverage: Coverage): GlyphTest => (glyph: number): boolean => coverage.contains(glyph);
        const rule: ContextRule = { backtrack: backtrack.map(toTest), input: input.slice(1).map(toTest), lookahead: lookahead.map(toTest), records: this.readRecords(recordsAt, recordCount) };
        return { rule, first: input[0] };
    }

    private readRecords(offset: number, count: number): Array<SequenceRecord> {
        const records: Array<SequenceRecord> = [];
        for (let index: number = 0; index < count; index++) {
            records.push({ sequenceIndex: this.table.buffer.readUInt16BE(offset + index * 4), lookupIndex: this.table.buffer.readUInt16BE(offset + index * 4 + 2) });
        }
        return records;
    }

    private testOf(value: number, classes?: ClassDefinition): GlyphTest {
        if (classes === undefined) {
            return (glyph: number): boolean => glyph === value;
        }
        return (glyph: number): boolean => classes.classOf(glyph) === value;
    }
}
