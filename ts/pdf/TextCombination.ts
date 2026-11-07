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
import type { Combination, InlineItem } from "./BoxTree.js";
import { VerticalOrientation } from "./VerticalOrientation.js";

type Values = Readonly<Record<string, CssValue>>;

const SPACE: number = 0x20;
const ALL: number = 0;
const DEFAULT_DIGITS: number = 2;

export class TextCombination {

    private readonly vertical: VerticalOrientation = new VerticalOrientation();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

    find(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, trimmed: Array<number>): Array<Combination> {
        // CSS Writing Modes 4 §9.1: the property "only has an effect in vertical writing modes", and §9.1.1: it "can only
        // combine plain text: consecutive typographic character units that are not interrupted by a box boundary".
        const combinations: Array<Combination> = [];
        for (const [index, item] of items.entries()) {
            const start: number = starts[index];
            const end: number = starts[index + 1];
            if (item.kind !== "text" || end === start) {
                continue;
            }
            const values: Values = item.node.style.values;
            const digits: number | undefined = this.digitsOf(values);
            if (digits === undefined) {
                continue;
            }
            if (digits === ALL) {
                this.addAll(items, starts, codepoints, index, values, trimmed, combinations);
                continue;
            }
            const wide: boolean = this.isFullWidth(values);
            for (let position: number = start; position < end; position++) {
                if (!this.isDigit(codepoints[position], wide)) {
                    continue;
                }
                let last: number = position;
                while (last + 1 < end && this.isDigit(codepoints[last + 1], wide)) {
                    last++;
                }
                // "each maximal sequence of consecutive ASCII digits (U+0030-U+0039) that has as many or fewer digits than
                // the specified integer"
                const continued: boolean = (position === start && this.continues(items, starts, codepoints, index, -1)) || (last + 1 === end && this.continues(items, starts, codepoints, index, 1));
                if (last - position < digits && !continued) {
                    combinations.push({ start: position, end: last + 1, level: 0, scale: 1 });
                }
                position = last;
            }
        }
        return combinations;
    }

    private addAll(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, index: number, values: Values, trimmed: Array<number>,
        combinations: Array<Combination>): void {
        // §9.1: all combines "all consecutive typographic character units within the box"; §9.1.2: white space at the start
        // and at the end of the combined text "is processed as at the start/end of such an inline block".
        if (this.continues(items, starts, codepoints, index, -1) || this.continues(items, starts, codepoints, index, 1)) {
            return;
        }
        let start: number = starts[index];
        let end: number = starts[index + 1];
        const collapses: boolean = this.collapses(values);
        while (collapses && start < end && codepoints[start] === SPACE) {
            start++;
        }
        while (collapses && end > start && codepoints[end - 1] === SPACE) {
            end--;
        }
        if (end === start) {
            return;
        }
        for (let position: number = starts[index]; position < starts[index + 1]; position++) {
            if (position < start || position >= end) {
                trimmed.push(position);
            }
        }
        combinations.push({ start: starts[index], end: starts[index + 1], level: 0, scale: 1 });
    }

    private continues(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, index: number, step: number): boolean {
        // §9.1.1: when the run ends "due only to one or more inline box boundaries" and the character on the other side
        // would combine with it under a shared text-combine-upright, "the candidate run does not combine".
        const value: CssValue | undefined = items[index].node.style.values["text-combine-upright"];
        for (let other: number = index + step; other >= 0 && other < items.length; other += step) {
            const item: InlineItem = items[other];
            if (item.kind === "object") {
                return false;
            }
            if (item.kind !== "text" || starts[other + 1] === starts[other]) {
                continue;
            }
            const values: Values = item.node.style.values;
            const digits: number | undefined = this.digitsOf(values);
            if (digits === undefined || !this.same(values["text-combine-upright"], value)) {
                return false;
            }
            const code: number = codepoints[step < 0 ? starts[other + 1] - 1 : starts[other]];
            return digits === ALL || this.isDigit(code, this.isFullWidth(values));
        }
        return false;
    }

    units(codepoints: ReadonlyArray<number>, combination: Combination): number {
        // §9.1.3: "the number of typographic character units ≠ number of Unicode codepoints".
        let text: string = "";
        for (let position: number = combination.start; position < combination.end; position++) {
            text += codepoints[position] === SPACE ? "" : String.fromCodePoint(codepoints[position]);
        }
        let count: number = 0;
        for (const cluster of this.graphemes.segment(text)) {
            count += cluster.segment.length > 0 ? 1 : 0;
        }
        return count;
    }

    private digitsOf(values: Values): number | undefined {
        // §9.1: none, all, or digits with an integer from 2 to 4, which is 2 when it is omitted.
        if (this.vertical.of(values) === "horizontal") {
            return undefined;
        }
        const value: CssValue | undefined = values["text-combine-upright"];
        const items: ReadonlyArray<CssValue> | undefined = value === undefined ? undefined : (value.kind === "list" ? value.items : [value]);
        const keyword: CssValue | undefined = items?.[0];
        if (keyword === undefined || keyword.kind !== "ident" || (keyword.lower !== "all" && keyword.lower !== "digits")) {
            return undefined;
        }
        if (keyword.lower === "all") {
            return ALL;
        }
        const count: CssValue | undefined = items?.[1];
        return count !== undefined && count.kind === "number" ? count.value : DEFAULT_DIGITS;
    }

    private same(first?: CssValue, second?: CssValue): boolean {
        return JSON.stringify(first) === JSON.stringify(second);
    }

    private isDigit(code: number, fullWidth: boolean): boolean {
        // §9.1.3.1: with text-transform: full-width the digits arrive as U+FF10 to U+FF19, and are narrowed again when they
        // are combined.
        return (code >= 0x30 && code <= 0x39) || (fullWidth && code >= 0xFF10 && code <= 0xFF19);
    }

    private isFullWidth(values: Values): boolean {
        const value: CssValue | undefined = values["text-transform"];
        if (value === undefined) {
            return false;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.some((item: CssValue) => item.kind === "ident" && item.lower === "full-width");
    }

    private collapses(values: Values): boolean {
        const value: CssValue | undefined = values["white-space-collapse"];
        const keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "collapse";
        return keyword === "collapse" || keyword === "preserve-breaks";
    }
}
