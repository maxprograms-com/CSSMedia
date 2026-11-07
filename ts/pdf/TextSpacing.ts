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

import type { CssValue } from "../css/values/CssValue.js";
import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type { Combination, ElementBox, InlineItem, InlineSequence, ShapedRun } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { FontMetrics } from "./FontMetrics.js";
import type { RelativeUnits } from "./LengthResolver.js";
import { LengthResolver } from "./LengthResolver.js";

type Values = Readonly<Record<string, CssValue>>;

const NO_UNITS: RelativeUnits = { size: (): number | undefined => undefined };
const WORD_SEPARATORS: ReadonlySet<number> = new Set<number>([0x20, 0xA0, 0x1361, 0x10100, 0x10101, 0x1039F, 0x1091F]);
const FORMAT_ONLY: RegExp = /^\p{Cf}+$/u;
const LETTER: RegExp = /^[\p{L}\p{N}]/u;
const NOWHERE: number = -1;

export class TextSpacing {

    private readonly metrics: FontMetrics;
    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private letterEnd: number = NOWHERE;
    private letterLast: number = NOWHERE;

    constructor(metrics: FontMetrics) {
        this.metrics = metrics;
    }

    apply(sequence: InlineSequence, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, runs: ReadonlyArray<ShapedRun>,
        combinations: ReadonlyArray<Combination>, before: Float64Array, after: Float64Array): void {
        // CSS Text 4 §8.2: letter-spacing puts "half of the additional spacing on each side" of a typographic character unit,
        // "except it is not applied at the beginning or end of a line", so the halves are kept apart for the lines to use.
        const items: ReadonlyArray<InlineItem> = sequence.items;
        const open: Array<ElementBox> = [];
        let run: number = 0;
        let combination: number = 0;
        let objectEnd: number = NOWHERE;
        this.letterEnd = NOWHERE;
        for (const [index, item] of items.entries()) {
            if (item.kind === "open") {
                open.push(item.node as ElementBox);
            } else if (item.kind === "close") {
                open.pop();
            } else if (item.kind === "object") {
                // "each consecutive run of atomic inlines (such as images and inline blocks) is treated as a single
                // typographic character unit"; the property applies to inline boxes, so the box that holds them gives it.
                const style: ComputedStyle = open.length > 0 ? open[open.length - 1].style : sequence.style;
                const half: number = this.length(this.metrics.fontSize(style.values), style.values["letter-spacing"]) / 2;
                const position: number = starts[index];
                if (objectEnd === position) {
                    after[position - 1] = 0;
                } else {
                    before[position] = half;
                }
                after[position] = half;
                objectEnd = position + 1;
            } else if (item.kind === "text") {
                const values: Values = item.node.style.values;
                for (; run < runs.length && runs[run].start < starts[index + 1]; run++) {
                    while (combination < combinations.length && combinations[combination].end <= runs[run].start) {
                        combination++;
                    }
                    if (runs[run].combined) {
                        // CSS Writing Modes 4 §9.1.2: for spacing "the resulting composition is treated as a single glyph
                        // representing the Object Replacement Character U+FFFC", and inside it letter-spacing is ignored.
                        const half: number = this.length(this.metrics.fontSize(values), values["letter-spacing"]) / 2;
                        before[combinations[combination].start] = half;
                        after[combinations[combination].end - 1] = half;
                        this.letterEnd = NOWHERE;
                        continue;
                    }
                    const size: number = runs[run].size;
                    this.wordSpacing(runs[run], codepoints, this.length(size, values["word-spacing"]));
                    this.letterSpacing(runs[run], codepoints, this.length(size, values["letter-spacing"]) / 2, before, after);
                }
            }
        }
    }

    private length(size: number, value?: CssValue): number {
        // CSS Text 4 §8.1 and §8.2: normal "Computes to zero", and percentages are "relative to used font-size".
        return value === undefined || value.kind === "ident" ? 0 : this.lengths.pixelsOf(value, NO_UNITS, size) ?? 0;
    }

    private wordSpacing(run: ShapedRun, codepoints: ReadonlyArray<number>, spacing: number): void {
        if (spacing === 0) {
            return;
        }
        for (let glyph: number = 0; glyph < run.glyphs.length; glyph++) {
            // CSS Text 4 §8.1: "if a word-separating character has a zero advance width (such as U+200B ZERO WIDTH SPACE) then
            // the user agent must not create an additional spacing between words".
            if (!WORD_SEPARATORS.has(codepoints[run.clusters[glyph]]) || run.advances[glyph] === 0) {
                continue;
            }
            // The spacing "should be applied half on each side of the character"; an upright glyph advances downwards.
            run.advances[glyph] += spacing;
            if (run.upright) {
                run.yOffsets[glyph] -= spacing / 2;
            } else {
                run.xOffsets[glyph] += spacing / 2;
            }
        }
    }

    private letterSpacing(run: ShapedRun, codepoints: ReadonlyArray<number>, half: number, before: Float64Array, after: Float64Array): void {
        // CSS Text 4 §8.2.1: a UA that cannot elongate a cursive script "must not apply spacing between any pair of that
        // script's typographic letter units at all". An upright cursive letter has its isolated form and joins nothing.
        const cursive: boolean = !run.upright && this.scripts.isJoining(run.script);
        if (half === 0 && !cursive) {
            return;
        }
        let text: string = "";
        for (let position: number = run.start; position < run.end; position++) {
            text += String.fromCodePoint(codepoints[position]);
        }
        let start: number = run.start;
        for (const unit of this.graphemes.segment(text)) {
            const end: number = start + Array.from(unit.segment).length;
            if (FORMAT_ONLY.test(unit.segment)) {
                // "Letter spacing ignores invisible zero-width formatting characters (such as those from the Unicode Cf
                // category). Spacing must be added as if those characters did not exist in the document."
                this.letterEnd = this.letterEnd === start ? end : this.letterEnd;
            } else {
                const letter: boolean = cursive && LETTER.test(unit.segment);
                if (letter && this.letterEnd === start) {
                    after[this.letterLast] = 0;
                } else {
                    before[start] = half;
                }
                after[end - 1] = half;
                this.letterEnd = letter ? end : NOWHERE;
                this.letterLast = end - 1;
            }
            start = end;
        }
    }
}
