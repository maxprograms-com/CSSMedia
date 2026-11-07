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
import type { HyphenationLimits } from "./Hyphenator.js";
import { Hyphenator } from "./Hyphenator.js";
import { LineBreaker } from "./LineBreaker.js";

export interface WrapStyle {
    lineBreak: string;
    wordBreak: string;
    chineseOrJapanese: boolean;
    language?: string;
    wrap: boolean;
    whiteSpaceCollapse: string;
    hyphens: string;
    hyphenLimits: HyphenationLimits;
}

const TAB: number = 0x09;
const SPACE: number = 0x20;
const NO_BREAK_SPACE: number = 0xA0;
const SOFT_HYPHEN: number = 0xAD;
const ANALYZED_SCRIPTS: ReadonlyArray<string> = ["Thai", "Laoo", "Khmr", "Mymr"];
const CJK_HYPHENS: ReadonlySet<number> = new Set<number>([0x301C, 0x30A0]);
const HYPHENS: ReadonlySet<number> = new Set<number>([0x2010, 0x2013]);
const ITERATION_MARKS: ReadonlySet<number> = new Set<number>([0x3005, 0x303B, 0x309D, 0x309E, 0x30FD, 0x30FE]);
const CENTERED_PUNCTUATION: ReadonlySet<number> = new Set<number>([0x30FB, 0xFF1A, 0xFF1B, 0xFF65, 0x203C, 0x2047, 0x2048, 0x2049, 0xFF01, 0xFF1F]);

export class LineBreakTailoring {

    private readonly breaker: LineBreaker;
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly words: Map<string, Intl.Segmenter> = new Map<string, Intl.Segmenter>();
    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly hyphenator: Hyphenator = new Hyphenator();
    private readonly analyzed: Set<number>;
    private readonly cm: number;
    private readonly ai: number;
    private readonly al: number;
    private readonly cb: number;
    private readonly cj: number;
    private readonly gl: number;
    private readonly hl: number;
    private readonly id: number;
    private readonly inseparable: number;
    private readonly ns: number;
    private readonly nu: number;
    private readonly po: number;
    private readonly pr: number;
    private readonly sa: number;
    private readonly sp: number;
    private readonly wj: number;
    private readonly xx: number;
    private readonly zwj: number;

    constructor(breaker: LineBreaker) {
        this.breaker = breaker;
        // The word segmentation of the runtime finds the words of these scripts, which are written without spaces.
        this.analyzed = new Set<number>(ANALYZED_SCRIPTS.map((code: string) => ScriptTags.indexOf(code)));
        this.ai = breaker.classNamed("AI");
        this.al = breaker.classNamed("AL");
        this.cj = breaker.classNamed("CJ");
        this.hl = breaker.classNamed("HL");
        this.id = breaker.classNamed("ID");
        this.inseparable = breaker.classNamed("IN");
        this.ns = breaker.classNamed("NS");
        this.nu = breaker.classNamed("NU");
        this.po = breaker.classNamed("PO");
        this.pr = breaker.classNamed("PR");
        this.sa = breaker.classNamed("SA");
        this.sp = breaker.classNamed("SP");
        this.wj = breaker.classNamed("WJ");
        this.xx = breaker.classNamed("XX");
        this.zwj = breaker.classNamed("ZWJ");
        this.cb = breaker.classNamed("CB");
        this.gl = breaker.classNamed("GL");
        this.cm = breaker.classNamed("CM");
    }

    private hyphenates(style: WrapStyle): boolean {
        // CSS Text 4 §6.1 and §6.2: with break-all and with anywhere "Hyphenation is not applied", and with auto-phrase
        // "hyphenation opportunities are suppressed as if hyphens: none had been specified".
        return style.hyphens !== "none" && style.wordBreak !== "break-all" && style.wordBreak !== "auto-phrase" && style.lineBreak !== "anywhere";
    }

    apply(codepoints: ReadonlyArray<number>, classes: Uint8Array, start: number, end: number, style: WrapStyle): void {
        // UAX #14 §8: a tailoring changes the class of some characters before the rules run. The characters from start to end
        // have one style; runs are given in text order, since a rule can look at the character before.
        const hyphenates: boolean = this.hyphenates(style);
        for (let index: number = start; index < end; index++) {
            const code: number = codepoints[index];
            if (code === SOFT_HYPHEN && !hyphenates) {
                // CSS Text 4 §6.3.1: with none "Words are not hyphenated, even if characters inside the word explicitly define
                // hyphenation opportunities", so the soft hyphen joins the character before it and offers no break.
                classes[index] = this.cm;
                continue;
            }
            const before: number = index > 0 ? this.breaker.classOf(codepoints[index - 1]) : -1;
            const type: number = this.strictness(code, classes[index], before, index > 0 ? classes[index - 1] : -1, style);
            if (type !== this.sa) {
                classes[index] = this.letters(code, type, style.wordBreak);
            } else if (!this.breaker.isMark(code) && style.wordBreak !== "manual" && (style.wordBreak === "break-all" || !this.isAnalyzed(code))) {
                // CSS Text 4 §6.1.1.3: for a writing system whose words cannot be found, "it must assume a soft wrap opportunity
                // between pairs of typographic letter units"; otherwise the class SA is treated as AL, as with manual.
                classes[index] = this.id;
            }
        }
    }

    refine(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number, style: WrapStyle, wrapsBefore: boolean): void {
        // The breaks of the characters from start to end, which have one style, after the rules have run. The last argument
        // tells whether the nearest common ancestor of this run and of the text before it wraps.
        if (style.lineBreak === "anywhere") {
            this.anywhere(codepoints, breaks, start, end);
        } else {
            if (style.wordBreak !== "manual" && style.wordBreak !== "break-all") {
                this.analyze(codepoints, breaks, start, end, style.language);
            }
            this.atomicInlines(codepoints, breaks, start, end);
            this.preservedSpaces(codepoints, breaks, start, end, style.whiteSpaceCollapse);
        }
        if (this.hyphenates(style)) {
            this.hyphenate(codepoints, breaks, start, end, style);
        }
        // CSS Text 4 §5.1: with nowrap "Lines only break at forced line breaks". §6.5: the box of a space controls the break
        // after it, and the nearest common ancestor of two characters the break between them.
        const spaceBefore: boolean = start > 0 && this.breaker.classOf(codepoints[start - 1]) === this.sp;
        const spaceAtEnd: boolean = end > start && this.breaker.classOf(codepoints[end - 1]) === this.sp;
        if (!wrapsBefore && !spaceBefore && breaks[start] !== LineBreaker.MANDATORY) {
            breaks[start] = LineBreaker.NONE;
        }
        for (let position: number = start + 1; position <= end && !style.wrap; position++) {
            if (breaks[position] !== LineBreaker.MANDATORY && (position < end || spaceAtEnd)) {
                breaks[position] = LineBreaker.NONE;
            }
        }
    }

    private hyphenate(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number, style: WrapStyle): void {
        // CSS Text 4 §6.3.1: a break after a conditional hyphen is a hyphenation opportunity; a break belongs to the run of
        // the character before it, which is the one the hyphen is shown after.
        for (let index: number = start; index < end; index++) {
            if (codepoints[index] === SOFT_HYPHEN && breaks[index + 1] === LineBreaker.ALLOWED) {
                breaks[index + 1] = LineBreaker.HYPHENATION;
            }
        }
        // "The UA must therefore only automatically hyphenate text for which the content language is known and for which it
        // has an appropriate hyphenation resource."
        const language: string | undefined = style.language;
        if (style.hyphens !== "auto" || language === undefined || !this.hyphenator.hasPatterns(language)) {
            return;
        }
        const inWord: (index: number) => boolean = (index: number): boolean =>
            codepoints[index] === SOFT_HYPHEN || this.hyphenator.isWordCharacter(String.fromCodePoint(codepoints[index]), language);
        // "inline element boundaries and out-of-flow elements must be ignored when determining word boundaries".
        let index: number = start;
        while (index > 0 && inWord(index - 1)) {
            index--;
        }
        while (index < end) {
            const first: number = index;
            let letters: string = "";
            const places: Array<number> = [];
            let conditional: boolean = false;
            while (index < codepoints.length && inWord(index)) {
                if (codepoints[index] === SOFT_HYPHEN) {
                    conditional = true;
                } else {
                    letters += String.fromCodePoint(codepoints[index]);
                    places.push(index);
                }
                index++;
            }
            // "Automatic hyphenation opportunities elsewhere within a word must be ignored if the word contains a conditional
            // hyphen", unless a part of the word is still too long for a line, which is known when the line is filled.
            if (index > first) {
                for (const count of this.hyphenator.breakPositionsOf(letters, language, style.hyphenLimits)) {
                    const position: number = places[count];
                    if (position > start && position <= end && breaks[position] === LineBreaker.NONE) {
                        breaks[position] = conditional ? LineBreaker.SPARE_HYPHENATION : LineBreaker.HYPHENATION;
                    }
                }
            }
            index = Math.max(index, first + 1);
        }
    }

    private preservedSpaces(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number, collapse: string): void {
        const breakSpaces: boolean = collapse === "break-spaces";
        if (!breakSpaces && collapse !== "preserve" && collapse !== "preserve-spaces") {
            return;
        }
        for (let index: number = start; index < end; index++) {
            const code: number = codepoints[index];
            const next: number | undefined = codepoints[index + 1];
            const white: boolean = code === SPACE || code === TAB;
            if (next === undefined || breaks[index + 1] === LineBreaker.MANDATORY || !(white || (breakSpaces && this.isOtherSpaceSeparator(code)))) {
                continue;
            }
            // CSS Text 4 §4.1: break-spaces has a soft wrap opportunity after each of them; §4.3.1: preserve and preserve-spaces
            // have one only "at the end of each maximal sequence of spaces and/or tabs".
            breaks[index + 1] = breakSpaces || (next !== SPACE && next !== TAB) ? LineBreaker.ALLOWED : LineBreaker.NONE;
        }
    }

    private isOtherSpaceSeparator(code: number): boolean {
        // CSS Text 4 §4.3: the characters of the general category Zs other than U+0020 and U+00A0.
        return code === 0x1680 || (code >= 0x2000 && code <= 0x200A) || code === 0x202F || code === 0x205F || code === 0x3000;
    }

    private atomicInlines(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number): void {
        // CSS Text 4 §6.5: "there is a soft wrap opportunity before and after each replaced element or other atomic inline,
        // even when adjacent to a character that would normally suppress them", except next to GL, WJ or ZWJ other than U+00A0.
        const glues: (code: number) => boolean = (code: number): boolean => {
            const type: number = this.breaker.classOf(code);
            return code !== NO_BREAK_SPACE && (type === this.gl || type === this.wj || type === this.zwj);
        };
        for (let index: number = start; index < end; index++) {
            if (this.breaker.classOf(codepoints[index]) !== this.cb) {
                continue;
            }
            if (index > 0 && breaks[index] === LineBreaker.NONE && !glues(codepoints[index - 1])) {
                breaks[index] = LineBreaker.ALLOWED;
            }
            const next: number | undefined = codepoints[index + 1];
            if (next !== undefined && breaks[index + 1] === LineBreaker.NONE && !glues(next) && !this.breaker.isMark(next)) {
                breaks[index + 1] = LineBreaker.ALLOWED;
            }
        }
    }

    private analyze(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number, language?: string): void {
        // CSS Text 4 §6.1.1.1: the UA "must additionally analyze the content of a run of such characters to detect word
        // boundaries and treat each boundary as a soft wrap opportunities"; manual turns that analysis off.
        let index: number = start;
        while (index < end) {
            let stop: number = index;
            let text: string = "";
            while (stop < end && this.isAnalyzed(codepoints[stop])) {
                text += String.fromCodePoint(codepoints[stop]);
                stop++;
            }
            let position: number = index;
            if (stop > index) {
                for (const word of this.segmenter(language).segment(text)) {
                    if (position > index && breaks[position] === LineBreaker.NONE) {
                        breaks[position] = LineBreaker.ALLOWED;
                    }
                    position += Array.from(word.segment).length;
                }
            }
            index = Math.max(stop, index + 1);
        }
    }

    private isAnalyzed(code: number): boolean {
        return this.breaker.classOf(code) === this.sa && this.analyzed.has(this.scripts.scriptOf(code));
    }

    private segmenter(language?: string): Intl.Segmenter {
        // "if the content language is known, the user agent should use this information to tailor its analysis".
        const key: string = language ?? "";
        let segmenter: Intl.Segmenter | undefined = this.words.get(key);
        if (segmenter === undefined) {
            try {
                segmenter = new Intl.Segmenter(language, { granularity: "word" });
            } catch {
                segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
            }
            this.words.set(key, segmenter);
        }
        return segmenter;
    }

    private strictness(code: number, type: number, before: number, tailoredBefore: number, style: WrapStyle): number {
        // CSS Text 4 §6.2: the breaks that strict, normal and loose must allow or forbid; auto leaves the choice to the UA.
        const loose: boolean = style.lineBreak === "loose";
        if (type === this.cj) {
            return loose ? this.id : this.ns;
        }
        if (CJK_HYPHENS.has(code)) {
            return style.chineseOrJapanese && style.lineBreak !== "strict" ? this.id : type;
        }
        if (!loose) {
            return type;
        }
        if (ITERATION_MARKS.has(code) || (type === this.inseparable && before === this.inseparable) || (HYPHENS.has(code) && tailoredBefore === this.id)) {
            return this.id;
        }
        const wide: boolean = (type === this.po || type === this.pr) && this.breaker.isWide(code);
        return style.chineseOrJapanese && (CENTERED_PUNCTUATION.has(code) || wide) ? this.id : type;
    }

    private letters(code: number, type: number, wordBreak: string): number {
        // CSS Text 4 §6.1: break-all treats letters and the characters of the classes NU and AL as ID; keep-all forbids
        // breaks between letters and characters of the classes NU, AL, AI and ID, which is how AL behaves.
        const alphabetic: boolean = type === this.al || type === this.ai || type === this.xx;
        if (wordBreak === "break-all") {
            return alphabetic || type === this.hl || type === this.nu ? this.id : type;
        }
        if (wordBreak === "keep-all" && type !== this.nu && type !== this.hl) {
            return alphabetic || type === this.id || this.breaker.isLetter(code) ? this.al : type;
        }
        return type;
    }

    private anywhere(codepoints: ReadonlyArray<number>, breaks: Uint8Array, start: number, end: number): void {
        // CSS Text 4 §6.2: with line-break: anywhere "There is a soft wrap opportunity around every typographic character
        // unit", and none inside one; the forced breaks stay.
        let text: string = "";
        for (let position: number = start; position < end; position++) {
            text += String.fromCodePoint(codepoints[position]);
        }
        let index: number = start;
        for (const cluster of this.graphemes.segment(text)) {
            const length: number = Array.from(cluster.segment).length;
            if (breaks[index] !== LineBreaker.MANDATORY && index > 0) {
                breaks[index] = LineBreaker.ALLOWED;
            }
            for (let inside: number = index + 1; inside < index + length; inside++) {
                breaks[inside] = LineBreaker.NONE;
            }
            index += length;
        }
        if (breaks[end] !== LineBreaker.MANDATORY) {
            breaks[end] = LineBreaker.ALLOWED;
        }
    }
}
