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

const EDGE: number = -1;
const SPACE: number = 0x20;
const NO_BREAK_SPACE: number = 0xA0;
const NARROW_NO_BREAK_SPACE: number = 0x202F;
const OPENING_GUILLEMET: number = 0xAB;
const CLOSING_GUILLEMET: number = 0xBB;
const COLON: number = 0x3A;
const HIGH_MARKS: ReadonlySet<number> = new Set<number>([0x3B, 0x21, 0x3F]);
const SEPARATOR: RegExp = /^\p{Z}$/u;
const AFTER_MARK: RegExp = /^[\p{Z}\s\p{Pe}\p{Pf}"';!?:]$/u;

export class PunctuationSpacing {

    isFrench(language?: string): boolean {
        // CSS Text 4 §8.4: "In this level, if the element's content language is French, narrow no-break space (U+202F) and
        // no-break space (U+00A0) is inserted where required by French typographic guidelines. Otherwise this value has no effect."
        return language !== undefined && language.toLowerCase().split("-")[0] === "fr";
    }

    apply(codepoints: Array<number>, from: number, collapsedSpaces: Array<number>, replace: boolean, after: number): void {
        // French typography: U+202F before ; ! ? and inside the guillemets, U+00A0 before the colon. A mark is punctuation
        // when a space, a closing mark or the end of the text follows it, which leaves out 12:30 or a URL.
        const tail: Array<number> = codepoints.splice(from);
        let mark: number = collapsedSpaces.length;
        while (mark > 0 && collapsedSpaces[mark - 1] >= from) {
            mark--;
        }
        for (const [index, code] of tail.entries()) {
            const previous: number = codepoints.length > 0 ? codepoints[codepoints.length - 1] : EDGE;
            const next: number = index + 1 < tail.length ? tail[index + 1] : after;
            const space: number | undefined = this.spaceBefore(code, previous, next);
            // CSS Text 4 §8.4: with insert the spacing goes in "if there are no space characters of any kind (Unicode general
            // category Z) already there"; with replace it goes in where a U+0020 is, and "the space (U+0020) is removed".
            if (space !== undefined && !this.isSeparator(previous)) {
                codepoints.push(space);
            } else if (space !== undefined && replace && previous === SPACE) {
                codepoints[codepoints.length - 1] = space;
            }
            if (collapsedSpaces[mark] === from + index) {
                collapsedSpaces[mark] = codepoints.length;
                mark++;
            }
            codepoints.push(code);
            if (code === OPENING_GUILLEMET && next !== EDGE) {
                if (replace && next === SPACE && index + 1 < tail.length) {
                    tail[index + 1] = NARROW_NO_BREAK_SPACE;
                } else if (!this.isSeparator(next)) {
                    codepoints.push(NARROW_NO_BREAK_SPACE);
                }
            }
        }
    }

    private spaceBefore(code: number, previous: number, next: number): number | undefined {
        // Marks that follow one another, as in "?!", stay together, and nothing goes at the start of the text.
        if (previous === EDGE || previous === OPENING_GUILLEMET || previous === COLON || HIGH_MARKS.has(previous)) {
            return undefined;
        }
        if (code === CLOSING_GUILLEMET) {
            return NARROW_NO_BREAK_SPACE;
        }
        if ((code !== COLON && !HIGH_MARKS.has(code)) || !(next === EDGE || AFTER_MARK.test(String.fromCodePoint(next)))) {
            return undefined;
        }
        return code === COLON ? NO_BREAK_SPACE : NARROW_NO_BREAK_SPACE;
    }

    private isSeparator(code: number): boolean {
        return code !== EDGE && SEPARATOR.test(String.fromCodePoint(code));
    }
}
