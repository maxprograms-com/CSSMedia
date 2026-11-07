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

import { EMOJI_VARIATION_RANGES } from "./generated/EmojiVariationData.js";

const TEXT_SELECTOR: number = 0xFE0E;
const EMOJI_SELECTOR: number = 0xFE0F;
const EMOJI_DEFAULT: RegExp = /^\p{Emoji_Presentation}$/u;

export class EmojiPresentation {

    apply(codepoints: Array<number>, from: number, collapsedSpaces: Array<number>, variant: string, after: number): void {
        // CSS Fonts 4 §9.3: the code points are rendered "as if" a variation selector "was appended to every Emoji
        // Presentation Participating Code Point", so the selector is put in the text for font matching and shaping to find.
        const tail: Array<number> = codepoints.splice(from);
        let mark: number = collapsedSpaces.length;
        while (mark > 0 && collapsedSpaces[mark - 1] >= from) {
            mark--;
        }
        for (const [index, code] of tail.entries()) {
            if (collapsedSpaces[mark] === from + index) {
                collapsedSpaces[mark] = codepoints.length;
                mark++;
            }
            codepoints.push(code);
            // "the presence of Variation Selector 15 (U+FE0E) or Variation Selector 16 (U+FE0F) in the contents of an
            // element override the rendering specified in font-variant-emoji".
            const next: number = index + 1 < tail.length ? tail[index + 1] : after;
            if (next !== TEXT_SELECTOR && next !== EMOJI_SELECTOR && this.isParticipating(code)) {
                codepoints.push(this.selector(code, variant));
            }
        }
    }

    private selector(code: number, variant: string): number {
        // With unicode, the code points follow UTS #51 "as either emoji-default, text-default, or text-only, depending on
        // the values of the Emoji and Emoji_Presentation properties".
        if (variant === "unicode") {
            return EMOJI_DEFAULT.test(String.fromCodePoint(code)) ? EMOJI_SELECTOR : TEXT_SELECTOR;
        }
        return variant === "emoji" ? EMOJI_SELECTOR : TEXT_SELECTOR;
    }

    private isParticipating(codepoint: number): boolean {
        let low: number = 0;
        let high: number = EMOJI_VARIATION_RANGES.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < EMOJI_VARIATION_RANGES[middle][0]) {
                high = middle - 1;
            } else if (codepoint > EMOJI_VARIATION_RANGES[middle][1]) {
                low = middle + 1;
            } else {
                return true;
            }
        }
        return false;
    }
}
