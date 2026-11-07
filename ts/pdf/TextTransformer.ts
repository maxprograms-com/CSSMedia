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
import { FULL_SIZE_KANA, FULL_WIDTH, MATH_ITALIC, TITLECASE } from "./generated/TextTransforms.js";

const LOWERCASE: RegExp = /^\p{Lowercase}/u;

export class TextTransformer {

    private readonly titles: Map<number, string> = new Map<number, string>();
    private readonly fullWidth: Map<number, number> = new Map<number, number>(FULL_WIDTH);
    private readonly fullSizeKana: Map<number, number> = new Map<number, number>(FULL_SIZE_KANA);
    private readonly italic: Map<number, number> = new Map<number, number>(MATH_ITALIC);
    private readonly segmenters: Map<string, Intl.Segmenter> = new Map<string, Intl.Segmenter>();
    private narrowed?: Map<number, number>;

    constructor() {
        for (const [code, title] of TITLECASE) {
            this.titles.set(code, String.fromCodePoint(...title));
        }
    }

    narrow(code: number): number {
        // CSS Writing Modes 4 §9.1.3.1: the non-full-width equivalent, "by reversing the algorithm defined for
        // text-transform: full-width".
        if (this.narrowed === undefined) {
            this.narrowed = new Map<number, number>();
            for (const [narrow, wide] of FULL_WIDTH) {
                if (!this.narrowed.has(wide)) {
                    this.narrowed.set(wide, narrow);
                }
            }
        }
        return this.narrowed.get(code) ?? code;
    }

    apply(text: string, before: string, value?: CssValue, language?: string): string {
        // CSS Text 4 §2.3: the case transformation comes first, then full-width, then full-size-kana. The text before this one
        // in its inline formatting context is given because "inline box boundaries must not introduce a text-transform word boundary".
        const keywords: Array<string> | undefined = this.keywords(value);
        if (keywords === undefined || keywords.length === 0 || keywords.includes("none")) {
            return text;
        }
        if (keywords.includes("math-auto")) {
            return this.mathAuto(text);
        }
        // §2.1.1: language-specific rules apply "If (and only if) the content language of the element is ... known".
        const locale: string | undefined = this.locale(language);
        let result: string = text;
        if (keywords.includes("uppercase")) {
            result = locale === undefined ? result.toUpperCase() : result.toLocaleUpperCase(locale);
        } else if (keywords.includes("lowercase")) {
            result = locale === undefined ? result.toLowerCase() : result.toLocaleLowerCase(locale);
        } else if (keywords.includes("capitalize")) {
            result = this.capitalize(result, before, locale);
        }
        if (keywords.includes("full-width")) {
            result = this.mapped(result, this.fullWidth);
        }
        if (keywords.includes("full-size-kana")) {
            result = this.mapped(result, this.fullSizeKana);
        }
        return result;
    }

    private keywords(value?: CssValue): Array<string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }

    private locale(language?: string): string | undefined {
        if (language === undefined || language.length === 0) {
            return undefined;
        }
        try {
            return Intl.getCanonicalLocales(language)[0];
        } catch {
            return undefined;
        }
    }

    private capitalize(text: string, before: string, locale?: string): string {
        // CSS Text 4 §2.1: "Puts the first typographic letter unit of each word, if lowercase, in titlecase"; §2.1.1 suggests
        // the word boundaries of UAX #29.
        const key: string = locale ?? "";
        let segmenter: Intl.Segmenter | undefined = this.segmenters.get(key);
        if (segmenter === undefined) {
            segmenter = new Intl.Segmenter(locale, { granularity: "word" });
            this.segmenters.set(key, segmenter);
        }
        let result: string = "";
        let copied: number = before.length;
        for (const part of segmenter.segment(before + text)) {
            if (part.isWordLike !== true || part.index < before.length) {
                continue;
            }
            const first: string = String.fromCodePoint(part.segment.codePointAt(0) as number);
            if (!LOWERCASE.test(first)) {
                continue;
            }
            const title: string = this.titles.get(first.codePointAt(0) as number) ?? (locale === undefined ? first.toUpperCase() : first.toLocaleUpperCase(locale));
            result += (before + text).substring(copied, part.index) + title;
            copied = part.index + first.length;
        }
        return result + (before + text).substring(copied);
    }

    private mapped(text: string, mapping: ReadonlyMap<number, number>): string {
        let result: string = "";
        for (const character of text) {
            const target: number | undefined = mapping.get(character.codePointAt(0) as number);
            result += target === undefined ? character : String.fromCodePoint(target);
        }
        return result;
    }

    private mathAuto(text: string): string {
        // MathML Core §4.2: only "On text nodes containing a single character" that the italic table lists.
        const characters: Array<string> = Array.from(text);
        const target: number | undefined = characters.length === 1 ? this.italic.get(characters[0].codePointAt(0) as number) : undefined;
        return target === undefined ? text : String.fromCodePoint(target);
    }
}
