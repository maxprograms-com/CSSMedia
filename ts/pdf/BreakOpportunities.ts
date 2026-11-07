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
import type { Combination, ElementBox, InlineItem, InlineSequence, TextSequence } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { HyphenationLimits } from "./Hyphenator.js";
import { LineBreaker } from "./LineBreaker.js";
import type { WrapStyle } from "./LineBreakTailoring.js";
import { LineBreakTailoring } from "./LineBreakTailoring.js";

const DEEPEST: number = 255;

export class BreakOpportunities {

    private readonly breaker: LineBreaker;
    private readonly tailoring: LineBreakTailoring;

    constructor(breaker: LineBreaker) {
        this.breaker = breaker;
        this.tailoring = new LineBreakTailoring(breaker);
    }

    resolve(sequence: InlineSequence, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, combinations: ReadonlyArray<Combination>): Uint8Array {
        const items: ReadonlyArray<InlineItem> = sequence.items;
        const classes: Uint8Array = this.breaker.classes(codepoints);
        const styles: Map<number, WrapStyle> = new Map<number, WrapStyle>();
        const open: Array<ElementBox> = [];
        for (const [index, item] of items.entries()) {
            if (item.kind === "open") {
                open.push(item.node as ElementBox);
            } else if (item.kind === "close") {
                open.pop();
            } else if (starts[index] < starts[index + 1]) {
                // CSS Text 4 §6.5: the break at "the boundary between two characters or atomic inlines" is controlled by an
                // ancestor of the two, so the box that holds an atomic inline gives its wrapping, never the atomic inline.
                const style: WrapStyle = item.kind === "text" ? this.wrapStyle(item.node.style, (item.node as TextSequence).language)
                    : this.wrapStyle(open.length > 0 ? open[open.length - 1].style : sequence.style);
                styles.set(index, style);
                this.tailoring.apply(codepoints, classes, starts[index], starts[index + 1], style);
            }
        }
        const breaks: Uint8Array = this.breaker.breaks(codepoints, classes);
        // CSS Text 4 §6.5: the nearest common ancestor of two characters controls the break between them; it is the lowest
        // box left open since the character before.
        let shared: number = 0;
        for (const [index, item] of items.entries()) {
            if (item.kind === "open") {
                open.push(item.node as ElementBox);
                continue;
            }
            if (item.kind === "close") {
                open.pop();
                shared = Math.min(shared, open.length);
                continue;
            }
            const style: WrapStyle | undefined = styles.get(index);
            if (style !== undefined) {
                const ancestor: ComputedStyle = shared > 0 ? open[shared - 1].style : sequence.style;
                this.tailoring.refine(codepoints, breaks, starts[index], starts[index + 1], style, this.wraps(ancestor));
                shared = open.length;
            }
        }
        // CSS Writing Modes 4 §9.1.2: combined text ignores "any forced line breaks", and "For line breaking before and after
        // the composition, it is treated as a regular inline with its actual contents"; it is one unit, so nothing breaks inside.
        for (const combination of combinations) {
            breaks.fill(LineBreaker.NONE, combination.start + 1, combination.end);
        }
        return breaks;
    }

    avoidance(sequence: InlineSequence, starts: ReadonlyArray<number>, breaks: Uint8Array): Uint8Array {
        // CSS Text 4 §5.2 and §5.3: with avoid the UA "may only break there if there are no other valid break points in the
        // line", and a break in an outer box comes before one in an inner box, so each break keeps how deep it is avoided.
        const depths: Uint8Array = new Uint8Array(breaks.length);
        const opened: Array<number> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "text" || item.kind === "out-of-flow" || item.node.kind !== "box") {
                continue;
            }
            const values: Readonly<Record<string, CssValue>> = item.node.style.values;
            const start: number = starts[index];
            if (item.kind === "open") {
                this.edge(start, breaks, depths, values["wrap-before"]);
                opened.push(start);
                continue;
            }
            if (item.kind === "object") {
                this.edge(start, breaks, depths, values["wrap-before"]);
                this.edge(starts[index + 1], breaks, depths, values["wrap-after"]);
                continue;
            }
            const first: number = opened.pop() as number;
            if (this.keyword("auto", values["wrap-inside"]) === "avoid") {
                for (let position: number = first + 1; position < start; position++) {
                    depths[position] = Math.min(DEEPEST, depths[position] + 1);
                }
            }
            this.edge(start, breaks, depths, values["wrap-after"]);
        }
        return depths;
    }

    private edge(position: number, breaks: Uint8Array, depths: Uint8Array, value?: CssValue): void {
        // CSS Text 4 §5.3: avoid-flex and flex act on flex lines only. UAX #14 rule LB2: "Never break at the start of text".
        const keyword: string = this.keyword("auto", value);
        if (keyword === "line" && position > 0) {
            breaks[position] = LineBreaker.MANDATORY;
        } else if (keyword === "avoid" || keyword === "avoid-line") {
            depths[position] = Math.min(DEEPEST, depths[position] + 1);
        }
    }

    private wraps(style: ComputedStyle): boolean {
        return this.keyword("wrap", style.values["text-wrap-mode"]) === "wrap";
    }

    private wrapStyle(style: ComputedStyle, language?: string): WrapStyle {
        const values: Readonly<Record<string, CssValue>> = style.values;
        const known: string | undefined = language !== undefined && language.length > 0 ? language : undefined;
        const primary: string = known === undefined ? "" : known.toLowerCase().split("-")[0];
        const wrap: WrapStyle = {
            lineBreak: this.keyword("auto", values["line-break"]),
            wordBreak: this.keyword("normal", values["word-break"]),
            chineseOrJapanese: primary === "zh" || primary === "yue" || primary === "ja",
            wrap: this.wraps(style),
            whiteSpaceCollapse: this.keyword("collapse", values["white-space-collapse"]),
            hyphens: this.keyword("manual", values["hyphens"]),
            hyphenLimits: this.limits(values["hyphenate-limit-chars"])
        };
        if (known !== undefined) {
            wrap.language = known;
        }
        return wrap;
    }

    private limits(value?: CssValue): HyphenationLimits {
        const items: ReadonlyArray<CssValue> | undefined = value === undefined ? undefined : (value.kind === "list" ? value.items : [value]);
        const count: (index: number) => number | undefined = (index: number): number | undefined => {
            const item: CssValue | undefined = items?.[index];
            return item !== undefined && item.kind === "number" ? item.value : undefined;
        };
        // CSS Text 4 §6.3.4: "If the third value is missing, it is the same as the second. If the second value is missing,
        // then it is auto."
        const limits: HyphenationLimits = {};
        const word: number | undefined = count(0);
        const before: number | undefined = count(1);
        const after: number | undefined = count(items !== undefined && items.length > 2 ? 2 : 1);
        if (word !== undefined) {
            limits.minWord = word;
        }
        if (before !== undefined) {
            limits.minBefore = before;
        }
        if (after !== undefined) {
            limits.minAfter = after;
        }
        return limits;
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }
}
