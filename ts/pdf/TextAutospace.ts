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

import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type { TextRun } from "./BoxTree.js";
import type { LineBreaker } from "./LineBreaker.js";

const PUNCTUATION: RegExp = /^\p{P}/u;
const LETTER: RegExp = /^\p{L}/u;
const COMBINING_MARK: RegExp = /^\p{M}/u;
const DECIMAL_DIGIT: RegExp = /^\p{Nd}/u;
const MARK: number = 4;

export class TextAutospace {

    static readonly OTHER: number = 0;
    static readonly IDEOGRAPH: number = 1;
    static readonly LETTER: number = 2;
    static readonly NUMERAL: number = 3;

    private readonly breaker: LineBreaker;
    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly han: number;
    private readonly known: Map<number, number> = new Map<number, number>();

    constructor(breaker: LineBreaker) {
        this.breaker = breaker;
        this.han = ScriptTags.indexOf("Hani");
    }

    classes(codepoints: ReadonlyArray<number>, runs: ReadonlyArray<TextRun>): Uint8Array {
        // CSS Text 4 §8.4: the spacing goes between characters that are adjacent "on the same line" and "is inserted after
        // bidi reordering" (§8.4.2), so the lines add it; here each character gets the class that §8.4.1 gives its unit.
        const classes: Uint8Array = new Uint8Array(codepoints.length);
        for (const run of runs) {
            // Letters and numerals are not counted when they are "upright in vertical text flow using the text-orientation
            // property or the text-combine-upright property".
            const upright: boolean = run.upright || run.combined;
            for (let position: number = run.start; position < run.end; position++) {
                const code: number = codepoints[position];
                let type: number | undefined = this.known.get(code);
                if (type === undefined) {
                    type = this.classOf(code);
                    this.known.set(code, type);
                }
                // A typographic character unit has the class of its base character, so a mark takes the one before it.
                if (type === MARK) {
                    classes[position] = position > run.start ? classes[position - 1] : (upright ? TextAutospace.OTHER : TextAutospace.LETTER);
                } else {
                    classes[position] = upright && type !== TextAutospace.IDEOGRAPH ? TextAutospace.OTHER : type;
                }
            }
        }
        return classes;
    }

    private classOf(code: number): number {
        // §8.4.1: ideographs are U+3041 to U+30FF except punctuation, the CJK strokes, the Katakana phonetic extensions and
        // "All characters that have the Han extended script property".
        const character: string = String.fromCodePoint(code);
        if ((code >= 0x3041 && code <= 0x30FF && !PUNCTUATION.test(character)) || (code >= 0x31C0 && code <= 0x31FF) || this.isHan(code)) {
            return TextAutospace.IDEOGRAPH;
        }
        if (COMBINING_MARK.test(character)) {
            return MARK;
        }
        // Letters are not counted when they are East Asian Wide or Fullwidth, and numerals when they are Fullwidth.
        if (LETTER.test(character)) {
            return this.breaker.isWideOrFullwidth(code) ? TextAutospace.OTHER : TextAutospace.LETTER;
        }
        return DECIMAL_DIGIT.test(character) && !this.breaker.isFullwidth(code) ? TextAutospace.NUMERAL : TextAutospace.OTHER;
    }

    private isHan(code: number): boolean {
        return this.scripts.scriptOf(code) === this.han || this.scripts.extensionsOf(code)?.includes(this.han) === true;
    }
}
