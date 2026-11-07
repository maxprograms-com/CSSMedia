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

import { CONTENT_SYMBOLS, INLINE_STRETCH_AXIS, OPERATOR_CATEGORIES, OPERATOR_DIRECT_ENTRIES, OPERATOR_ENTRIES, OPERATORS_2_ASCII_CHARS } from "./generated/MathOperators.js";

export interface DictionaryEntry {
    lspace: number;
    rspace: number;
    stretchy: boolean;
    symmetric: boolean;
    largeop: boolean;
    movablelimits: boolean;
}

const DEFAULT: string = "Default";
const FORCE_DEFAULT: string = "ForceDefault";
const FORMS: ReadonlyArray<string> = ["infix", "prefix", "postfix"];
const STRETCHY: number = 1;
const SYMMETRIC: number = 2;
const LARGEOP: number = 4;
const MOVABLE_LIMITS: number = 8;
const KEY_SPACE: number = 0x4000;
const ENCODING_UNIT: number = 0x1000;
const ASCII_BASE: number = 0x0320;
const ASCII_END: number = 0x03FF;
const SHIFTED_START: number = 0x2000;
const SHIFTED_END: number = 0x2BFF;
const SHIFT: number = 0x1C00;
const VERTICAL_LINE: number = 0x007C;
const TILDE_OPERATOR: number = 0x223C;
const LONG_SOLIDUS_OVERLAY: number = 0x0338;
const LONG_VERTICAL_LINE_OVERLAY: number = 0x20D2;
const ARABIC_OPERATORS: ReadonlyArray<number> = [0x1EEF0, 0x1EEF1];

export class MathOperators {

    static readonly DEFAULT: string = DEFAULT;

    private readonly entries: Map<string, DictionaryEntry> = new Map<string, DictionaryEntry>();
    private readonly encodings: Map<number, string> = new Map<number, string>();
    private readonly inline: ReadonlySet<number> = new Set<number>(INLINE_STRETCH_AXIS);
    private symbols?: Map<string, string>;

    constructor() {
        for (const [name, , encoding, lspace, rspace, flags] of OPERATOR_CATEGORIES) {
            this.entries.set(name, {
                lspace, rspace, stretchy: (flags & STRETCHY) !== 0, symmetric: (flags & SYMMETRIC) !== 0, largeop: (flags & LARGEOP) !== 0,
                movablelimits: (flags & MOVABLE_LIMITS) !== 0
            });
            if (encoding >= 0) {
                this.encodings.set(encoding, name);
            }
        }
    }

    category(content: string, form: string): string {
        // MathML Core B.1, "the algorithm to determine the category of an operator (Content, Form)".
        if (content.length !== 1 && content.length !== 2) {
            return DEFAULT;
        }
        let code: number = content.charCodeAt(0);
        if (content.length === 1 && code >= ASCII_BASE && code <= ASCII_END) {
            return DEFAULT;
        }
        if (content.length === 2) {
            if (ARABIC_OPERATORS.includes(content.codePointAt(0) as number) && form === "postfix") {
                return "I";
            }
            const second: number = content.charCodeAt(1);
            if (second !== LONG_SOLIDUS_OVERLAY && second !== LONG_VERTICAL_LINE_OVERLAY) {
                const index: number = OPERATORS_2_ASCII_CHARS.indexOf(content);
                if (index < 0) {
                    return DEFAULT;
                }
                code = ASCII_BASE + index;
            }
        }
        if (form === "infix" && (code === VERTICAL_LINE || code === TILDE_OPERATOR)) {
            return FORCE_DEFAULT;
        }
        const formCode: number = FORMS.indexOf(form);
        for (const [first, last, entryForm, category] of OPERATOR_DIRECT_ENTRIES) {
            if (code >= first && code <= last && entryForm === formCode) {
                return category;
            }
        }
        let key: number;
        if (code <= ASCII_END) {
            key = code;
        } else if (code >= SHIFTED_START && code <= SHIFTED_END) {
            key = code - SHIFT;
        } else {
            return DEFAULT;
        }
        key += formCode * ENCODING_UNIT;
        // Figure 27 is "sorted by key", each range of entries sharing one encoding.
        let low: number = 0;
        let high: number = OPERATOR_ENTRIES.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const [first, last]: readonly [number, number] = OPERATOR_ENTRIES[middle];
            if (key < first % KEY_SPACE) {
                high = middle - 1;
            } else if (key > last % KEY_SPACE) {
                low = middle + 1;
            } else {
                return this.encodings.get(Math.floor(first / ENCODING_UNIT)) ?? DEFAULT;
            }
        }
        return DEFAULT;
    }

    entry(category: string): DictionaryEntry {
        return (this.entries.get(category) ?? this.entries.get(DEFAULT)) as DictionaryEntry;
    }

    contentElement(cd: string, name: string): string | undefined {
        // MathML 4 Appendix E.3: the operator element that an OpenMath symbol of a content dictionary encodes.
        if (this.symbols === undefined) {
            // The table also lists interval_cc for list; the content dictionary interval1 defines it as the closed interval.
            this.symbols = new Map<string, string>();
            for (const [dictionary, symbol, element] of CONTENT_SYMBOLS) {
                const key: string = dictionary + "#" + symbol;
                if (!this.symbols.has(key)) {
                    this.symbols.set(key, element);
                }
            }
        }
        return this.symbols.get(cd + "#" + name);
    }

    hasInlineAxis(codepoint: number): boolean {
        // B.1: "The intrinsic stretch axis a Unicode character c is inline if it belongs to the list below."
        return this.inline.has(codepoint);
    }
}
