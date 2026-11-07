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
import { CharacterMapLookup } from "../fonts/CharacterMapLookup.js";
import type { FontInstance } from "../fonts/Typeface.js";
import { VerticalMetrics } from "../fonts/VerticalMetrics.js";
import type { InlineItem, ShapedRun, TextSequence } from "./BoxTree.js";
import type { LineBreaker } from "./LineBreaker.js";

const OPENING_MARK: RegExp = /^\p{Ps}$/u;
const CLOSING_MARK: RegExp = /^\p{Pe}$/u;
const OPENING_QUOTES: ReadonlySet<number> = new Set<number>([0x2018, 0x201C]);
const CLOSING_QUOTES: ReadonlySet<number> = new Set<number>([0x2019, 0x201D]);
const MIDDLE_DOTS: ReadonlySet<number> = new Set<number>([0xB7, 0x2027, 0x30FB]);
const COLONS: ReadonlySet<number> = new Set<number>([0xFF1A, 0xFF1B]);
const DOTS: ReadonlySet<number> = new Set<number>([0x3001, 0x3002, 0xFF0C, 0xFF0E]);
const SAMPLE_IDEOGRAPHS: ReadonlyArray<number> = [0x6C34, 0x535C, 0x4E00];
const TRADITIONAL_REGIONS: ReadonlySet<string> = new Set<string>(["tw", "hk", "mo"]);

export class TextSpacingTrim {

    static readonly NONE: number = 0;
    static readonly OPENING: number = 1;
    static readonly CLOSING: number = 2;
    static readonly MIDDLE_DOT: number = 3;

    private readonly breaker: LineBreaker;
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly verticalMetrics: VerticalMetrics = new VerticalMetrics();
    private readonly widths: Map<FontInstance, number | null> = new Map<FontInstance, number | null>();
    private readonly heights: Map<FontInstance, number | null> = new Map<FontInstance, number | null>();

    constructor(breaker: LineBreaker) {
        this.breaker = breaker;
    }

    prepare(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, runs: ReadonlyArray<ShapedRun>, classes: Uint8Array,
        amounts: Float64Array): void {
        // CSS Text 4 §8.5: the trimming depends on the place of the punctuation in its line and on its neighbours there, so
        // the lines decide it; here each character gets its class (§8.5.2) and the space that can be taken from its glyph.
        let item: number = 0;
        for (const run of runs) {
            if (run.combined) {
                continue;
            }
            const full: number | undefined = this.fullAdvance(run.font, run.upright);
            for (let glyph: number = 0; glyph < run.glyphs.length; glyph++) {
                const position: number = run.clusters[glyph];
                while (starts[item + 1] <= position) {
                    item++;
                }
                const node: TextSequence = items[item].node as TextSequence;
                const type: number = this.classOf(codepoints[position], node.language);
                classes[position] = type;
                // §8.5.1: a glyph that is not as wide as a standard Han character is proportional, and "the UA must not add
                // or remove space to these glyphs".
                const advance: number = run.advances[glyph];
                if (type === TextSpacingTrim.NONE || full === undefined || Math.abs(advance - full * run.size / run.font.metrics.unitsPerEm) > advance / 1000) {
                    continue;
                }
                // §8.5.2 names the half that is kerned for left to right text; §8.5.1: the UA "may choose not to trim" when
                // that "may cause glyph cut-offs", which is the case of a mark that right to left text mirrors.
                if ((run.level & 1) === 1) {
                    continue;
                }
                if (this.keyword(node.style.values["text-spacing-trim"]) === "trim-all") {
                    this.trim(run, glyph, type, advance / 2);
                } else {
                    amounts[position] = advance / 2;
                }
            }
        }
    }

    private trim(run: ShapedRun, glyph: number, type: number, half: number): void {
        // §8.5: trim-all sets the three classes "with half-width glyphs, without regards for the position within the line
        // nor for adjacent characters". §8.5.2: the start half of an opening mark is kerned, and the end half of a closing one.
        const before: number = type === TextSpacingTrim.OPENING ? half : (type === TextSpacingTrim.MIDDLE_DOT ? half / 2 : 0);
        run.advances[glyph] -= half;
        if (run.upright) {
            run.yOffsets[glyph] += before;
        } else {
            run.xOffsets[glyph] -= before;
        }
    }

    private classOf(code: number, language?: string): number {
        const character: string = String.fromCodePoint(code);
        const fullwidth: boolean = (code >= 0x3000 && code <= 0x303F) || this.breaker.isFullwidth(code);
        if (OPENING_QUOTES.has(code) || (fullwidth && OPENING_MARK.test(character))) {
            return TextSpacingTrim.OPENING;
        }
        if (CLOSING_QUOTES.has(code) || (fullwidth && CLOSING_MARK.test(character))) {
            return TextSpacingTrim.CLOSING;
        }
        if (MIDDLE_DOTS.has(code)) {
            return TextSpacingTrim.MIDDLE_DOT;
        }
        if (!COLONS.has(code) && !DOTS.has(code)) {
            return TextSpacingTrim.NONE;
        }
        // §8.5.2: the colons and the dots are closing or middle dot punctuation by "language conventions": closing in
        // Simplified Chinese, middle dots in Traditional Chinese, and in Japanese and Korean only the dots are closing.
        const subtags: Array<string> = (language ?? "").toLowerCase().split("-");
        const chinese: boolean = subtags[0] === "zh" || subtags[0] === "yue";
        const traditional: boolean = chinese && !subtags.includes("hans") && (subtags.includes("hant") || subtags[0] === "yue" || subtags.some((subtag: string) => TRADITIONAL_REGIONS.has(subtag)));
        if (traditional) {
            return TextSpacingTrim.MIDDLE_DOT;
        }
        return chinese || DOTS.has(code) ? TextSpacingTrim.CLOSING : TextSpacingTrim.MIDDLE_DOT;
    }

    private fullAdvance(font: FontInstance, upright: boolean): number | undefined {
        // §8.5.1: the advance of a standard Han character such as U+6C34; when U+6C34, U+535C and U+4E00 do not all have
        // the same advance, "the font has proportional ideographs" and no full width can be told.
        const known: Map<FontInstance, number | null> = upright ? this.heights : this.widths;
        let full: number | null | undefined = known.get(font);
        if (full === undefined) {
            full = null;
            const advances: Array<number> = [];
            for (const code of SAMPLE_IDEOGRAPHS) {
                const glyph: number = this.lookup.glyphOf(font.typeface.characters, code);
                if (glyph !== 0) {
                    advances.push(upright ? this.verticalMetrics.advance(font, glyph) : font.advances[glyph]);
                }
            }
            if (advances.length === SAMPLE_IDEOGRAPHS.length && advances[0] > 0 && advances.every((advance: number) => advance === advances[0])) {
                full = advances[0];
            }
            known.set(font, full);
        }
        return full ?? undefined;
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "normal";
    }
}
