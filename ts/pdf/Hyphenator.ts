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

import { createRequire } from "node:module";
import { LanguageUtils } from "typesbcp47";
import { HYPHENATION_SETS } from "./generated/HyphenationSets.js";
import type { HyphenationPatternModule } from "./HyphenationPatterns.js";
import { HyphenationPatterns } from "./HyphenationPatterns.js";

export interface HyphenationLimits {
    minWord?: number;
    minBefore?: number;
    minAfter?: number;
}

const SUGGESTED_WORD_MINIMUM: number = 5;
const LETTER: RegExp = /[\p{L}\p{M}]/u;
const REGION: RegExp = /^(?:[a-z]{2}|[0-9]{3})$/;

export class Hyphenator {

    private readonly load: NodeJS.Require = createRequire(import.meta.url);
    private readonly sets: Map<string, HyphenationPatterns> = new Map<string, HyphenationPatterns>();
    private readonly positions: Map<string, ReadonlyArray<number>> = new Map<string, ReadonlyArray<number>>();
    private readonly found: Map<string, string | null> = new Map<string, string | null>();

    hasPatterns(language: string): boolean {
        return this.setOf(language) !== undefined;
    }

    isWordCharacter(character: string, language: string): boolean {
        if (LETTER.test(character)) {
            return true;
        }
        const patterns: HyphenationPatterns | undefined = this.patternsFor(language);
        return patterns !== undefined && patterns.isExtraLetter(character);
    }

    breakPositionsOf(word: string, language: string, limits: HyphenationLimits): ReadonlyArray<number> {
        // CSS Text 4 §6.3.4: auto lets the UA choose, the suggestion being "2 for before and after, and 5 for the word total";
        // the minimums before and after are those of the pattern set, which its authors chose for the language.
        const patterns: HyphenationPatterns | undefined = this.patternsFor(language);
        if (patterns === undefined) {
            return [];
        }
        const minWord: number = limits.minWord ?? SUGGESTED_WORD_MINIMUM;
        const leftMin: number = limits.minBefore ?? patterns.leftMin;
        const rightMin: number = limits.minAfter ?? patterns.rightMin;
        const key: string = this.setOf(language) + "\u0000" + minWord + "\u0000" + leftMin + "\u0000" + rightMin + "\u0000" + word;
        let positions: ReadonlyArray<number> | undefined = this.positions.get(key);
        if (positions === undefined) {
            positions = patterns.breakPositionsOf(word, minWord, leftMin, rightMin);
            this.positions.set(key, positions);
        }
        return positions;
    }

    private setOf(language: string): string | undefined {
        let set: string | null | undefined = this.found.get(language);
        if (set === undefined) {
            set = this.nearest(language) ?? null;
            this.found.set(language, set);
        }
        return set ?? undefined;
    }

    private nearest(language: string): string | undefined {
        // A tag that LanguageUtils rejects, such as one with the script that the language is always written in (en-Latn-US, which
        // RFC 5646 §4.1 allows but says SHOULD NOT be used), is ignored. The table has a row for each tag of the TypesBCP47 list, and for the tags of the scripts and spellings that need
        // their own set (sr, sr-latn, de-ch). For any other tag the nearest row is that of the tag without its region, because a
        // script or a variant subtag names another writing or spelling, whose patterns are not those of the language.
        if (!LanguageUtils.isValidLanguageTag(language)) {
            return undefined;
        }
        const subtags: Array<string> = language.toLowerCase().split("-");
        const singleton: number = subtags.findIndex((subtag: string, index: number) => index > 0 && subtag.length === 1);
        if (singleton > 0) {
            subtags.length = singleton;
        }
        while (subtags.length > 0) {
            const set: string | undefined = HYPHENATION_SETS[subtags.join("-")];
            if (set !== undefined) {
                return set;
            }
            if (subtags.length < 2 || !REGION.test(subtags[subtags.length - 1])) {
                return undefined;
            }
            subtags.pop();
        }
        return undefined;
    }

    private patternsFor(language: string): HyphenationPatterns | undefined {
        // A pattern set is a module of its own, loaded when the first word in one of its languages is hyphenated.
        const set: string | undefined = this.setOf(language);
        if (set === undefined) {
            return undefined;
        }
        let patterns: HyphenationPatterns | undefined = this.sets.get(set);
        if (patterns === undefined) {
            patterns = new HyphenationPatterns(this.load("./generated/hyphenation/" + set + ".js") as HyphenationPatternModule);
            this.sets.set(set, patterns);
        }
        return patterns;
    }
}
