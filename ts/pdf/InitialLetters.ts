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
import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type { BidiRange, ElementBox, InitialLetter, InlineItem, InlineSequence } from "./BoxTree.js";
import type { FontMetrics } from "./FontMetrics.js";

type Values = Readonly<Record<string, CssValue>>;

const IDEOGRAPHIC_SCRIPTS: ReadonlySet<number> = new Set<number>(["Hani", "Hang", "Hira", "Kana", "Yiii"].map((code: string) => ScriptTags.indexOf(code)));
const HANGING_SCRIPTS: ReadonlySet<number> = new Set<number>(["Deva", "Beng", "Guru", "Tibt"].map((code: string) => ScriptTags.indexOf(code)));
const NORMAL: string = "normal";
const EM_OVER: string = "em-over";
const EM_UNDER: string = "em-under";

export class InitialLetters {

    static readonly BORDER_BOX: string = "border-box";
    static readonly CONTENT_BOX: string = "content-box";
    static readonly LEADING: string = "leading";

    private readonly metrics: FontMetrics;

    constructor(metrics: FontMetrics) {
        this.metrics = metrics;
    }

    find(sequence: InlineSequence, starts: ReadonlyArray<number>, collapsedSpaces: ReadonlyArray<number>, scripts: Uint16Array, levels: Uint8Array,
        paragraphs: ReadonlyArray<BidiRange>): InitialLetter | undefined {
        // CSS Inline 3 §7.3.1: initial-letter applies to an inline-level box that is the first child of its parent box, whose ancestors
        // in the containing block are all first-child inline boxes with initial-letter normal; collapsed white space makes no child.
        const items: ReadonlyArray<InlineItem> = sequence.items;
        for (let index: number = 0; index < items.length; index++) {
            const item: InlineItem = items[index];
            if (item.kind === "out-of-flow") {
                continue;
            }
            if (item.kind === "text") {
                if (this.collapsedAway(starts[index], starts[index + 1], collapsedSpaces)) {
                    continue;
                }
                return undefined;
            }
            if (item.kind === "close" || item.node.kind !== "box") {
                return undefined;
            }
            const box: ElementBox = item.node;
            // "The effect of the initial-letter property is undefined on children of ruby base container boxes and on ruby container boxes."
            if (box.display.inner === "ruby" || (box.display.internal !== undefined && box.display.internal.startsWith("ruby"))) {
                return undefined;
            }
            const value: CssValue | undefined = box.style.values["initial-letter"];
            if (value === undefined || (value.kind === "ident" && value.lower === NORMAL)) {
                if (item.kind === "object") {
                    return undefined;
                }
                continue;
            }
            const close: number = item.kind === "object" ? index : this.closing(items, index, box);
            const letter: InitialLetter | undefined = this.letter(sequence, box, value, index, close, starts, scripts, item.kind === "object");
            // "If initial-letter is applied to an inline-level box that is not positioned at the start of the line due to bidi
            // reordering", "its used value is normal": a box at another level than its paragraph is reordered away from the start.
            return letter === undefined || !this.atLineStart(letter, levels, paragraphs) ? undefined : letter;
        }
        return undefined;
    }

    private collapsedAway(start: number, end: number, collapsedSpaces: ReadonlyArray<number>): boolean {
        for (let position: number = start; position < end; position++) {
            if (!collapsedSpaces.includes(position)) {
                return false;
            }
        }
        return true;
    }

    private closing(items: ReadonlyArray<InlineItem>, open: number, box: ElementBox): number {
        for (let index: number = open + 1; index < items.length; index++) {
            if (items[index].kind === "close" && items[index].node === box) {
                return index;
            }
        }
        return items.length - 1;
    }

    private atLineStart(letter: InitialLetter, levels: Uint8Array, paragraphs: ReadonlyArray<BidiRange>): boolean {
        const paragraph: BidiRange | undefined = paragraphs.find((range: BidiRange) => range.start <= letter.start && letter.start < range.end);
        for (let position: number = letter.start; position < letter.end; position++) {
            if (paragraph !== undefined && levels[position] !== paragraph.level) {
                return false;
            }
        }
        return true;
    }

    private letter(sequence: InlineSequence, box: ElementBox, value: CssValue, open: number, close: number, starts: ReadonlyArray<number>, scripts: Uint16Array,
        atomic: boolean): InitialLetter | undefined {
        // §7.3: <number [1,∞]> <integer [1,∞]>, or a number with drop or raise; raise is a sink of 1 and drop, the default, "the
        // initial letter size floored to the nearest positive whole number".
        let size: number | undefined;
        let sink: number | undefined;
        let raise: boolean = false;
        for (const part of value.kind === "list" ? value.items : [value]) {
            if (part.kind === "number" && size === undefined) {
                size = part.value;
            } else if (part.kind === "number") {
                sink = part.value;
            } else if (part.kind === "ident") {
                raise = part.lower === "raise";
            }
        }
        if (size === undefined || size < 1) {
            return undefined;
        }
        const used: number = sink ?? (raise ? 1 : Math.max(1, Math.floor(size)));
        const start: number = starts[open];
        const end: number = starts[close + (atomic ? 1 : 0)];
        const align: ReadonlyArray<string> = this.keywords(box.style.values["initial-letter-align"]);
        // CSS Writing Modes 4 §5.1: upright glyphs are set in their em box on the central baseline, and cap-height and the alphabetic
        // baseline run along a vertical line, not across it; the edges of the em box (CSS Inline 3 A.1) are the points across it.
        const upright: boolean = this.isUpright(sequence.style.values);
        const text: string = align.find((keyword: string) => keyword !== InitialLetters.BORDER_BOX) ?? "alphabetic";
        const textPoints: readonly [string, string] = upright && text !== InitialLetters.LEADING ? [EM_OVER, EM_UNDER] : this.textPoints(text);
        const letterPoints: readonly [string, string] = align.includes(InitialLetters.BORDER_BOX) ? [InitialLetters.BORDER_BOX, InitialLetters.BORDER_BOX]
            : (atomic ? [InitialLetters.CONTENT_BOX, InitialLetters.CONTENT_BOX] : (upright ? [EM_OVER, EM_UNDER] : this.letterPoints(scripts, start, end)));
        const letter: InitialLetter = {
            box, open, close, start, end, atomic, size, sink: used, textOver: textPoints[0], textUnder: textPoints[1], letterOver: letterPoints[0],
            letterUnder: letterPoints[1], scale: 1, wrap: box.style.values["initial-letter-wrap"] ?? { kind: "ident", name: "none", lower: "none" }
        };
        if (!atomic) {
            letter.scale = this.scale(letter, sequence.style.values, box.style.values);
        }
        return letter;
    }

    private textPoints(keyword: string): readonly [string, string] {
        // §7.4: the over and under alignment points of the surrounding text.
        switch (keyword) {
            case "ideographic":
                return ["ideographic-ink-over", "ideographic-ink-under"];
            case "hanging":
                return ["hanging", "alphabetic"];
            case InitialLetters.LEADING:
                return [InitialLetters.LEADING, InitialLetters.LEADING];
            default:
                return ["cap", "alphabetic"];
        }
    }

    private letterPoints(scripts: Uint16Array, start: number, end: number): readonly [string, string] {
        // §7.4: "the alignment points of the initial letter are automatically determined from its contents": the ideographic ink
        // baselines for Han, Hangul, Kana or Yi, the hanging baseline for the scripts written from it (§7.1.1, §7.4.1), else cap-height.
        let hanging: boolean = false;
        for (let position: number = start; position < end; position++) {
            if (IDEOGRAPHIC_SCRIPTS.has(scripts[position])) {
                return ["ideographic-ink-over", "ideographic-ink-under"];
            }
            hanging = hanging || HANGING_SCRIPTS.has(scripts[position]);
        }
        return hanging ? ["hanging", "alphabetic"] : ["cap", "alphabetic"];
    }

    textSpan(letter: InitialLetter, container: Values): number {
        // §7.4: leading uses "the over/under half-leading edges", which are a line height apart.
        if (letter.textOver === InitialLetters.LEADING) {
            return this.metrics.lineHeight(container);
        }
        return this.point(container, letter.textOver) - this.point(container, letter.textUnder);
    }

    private point(values: Values, type: string): number {
        // A baseline, or an edge of the em box of the first available font, over the alphabetic baseline.
        if (type === EM_OVER || type === EM_UNDER) {
            const box: readonly [number, number] = this.metrics.fontEmBox(this.metrics.firstFont(values), this.metrics.fontSize(values), true, true);
            return type === EM_OVER ? box[0] : -box[1];
        }
        return this.metrics.baseline(values, type);
    }

    textOver(letter: InitialLetter, container: Values): number {
        // The distance of the text's over alignment point above its alphabetic baseline.
        if (letter.textOver === InitialLetters.LEADING) {
            const ascent: number = this.metrics.ascent(container);
            return ascent + (this.metrics.lineHeight(container) - ascent - this.metrics.descent(container)) / 2;
        }
        return this.point(container, letter.textOver);
    }

    textUnder(letter: InitialLetter, container: Values): number {
        if (letter.textUnder === InitialLetters.LEADING) {
            const descent: number = this.metrics.descent(container);
            return -descent - (this.metrics.lineHeight(container) - this.metrics.ascent(container) - descent) / 2;
        }
        return this.point(container, letter.textUnder);
    }

    lineHeight(container: Values): number {
        return this.metrics.lineHeight(container);
    }

    letterOver(letter: InitialLetter, values: Values): number {
        // The distance of the letter's over alignment point above its alphabetic baseline, at its used size.
        return this.letterPoint(letter.letterOver, values, true) * letter.scale;
    }

    letterUnder(letter: InitialLetter, values: Values): number {
        return this.letterPoint(letter.letterUnder, values, false) * letter.scale;
    }

    private letterPoint(type: string, values: Values, over: boolean): number {
        // The letter's own content area stands for the alignment points of a box that has no glyph metrics of its own.
        if (type === InitialLetters.BORDER_BOX || type === InitialLetters.CONTENT_BOX) {
            return over ? this.metrics.ascent(values) : -this.metrics.descent(values);
        }
        return this.point(values, type);
    }

    span(letter: InitialLetter, container: Values): number {
        // The distance between the letter's over and under alignment points that its size asks for.
        return (letter.size - 1) * this.metrics.lineHeight(container) + this.textSpan(letter, container);
    }

    private scale(letter: InitialLetter, container: Values, values: Values): number {
        // §7.5.3: the font size is the one that makes the letter's alignment points span (size - 1) line heights of the containing
        // block plus the span of the surrounding text's points; "no layout is required in this calculation".
        // With border-box the border edges are the points, so the content inside them is what the font fills.
        const edges: number = letter.letterOver === InitialLetters.BORDER_BOX ? this.blockEdges(values, container) : 0;
        const target: number = this.span(letter, container) - edges;
        const span: number = this.letterPoint(letter.letterOver, values, true) - this.letterPoint(letter.letterUnder, values, false);
        return span > 0 && target > 0 ? target / span : 1;
    }

    private blockEdges(values: Values, container: Values): number {
        // The block axis of the line is that of the containing block's writing mode.
        const mode: CssValue | undefined = container["writing-mode"];
        const horizontal: boolean = mode === undefined || mode.kind !== "ident" || mode.lower === "horizontal-tb";
        const sides: ReadonlyArray<string> = horizontal ? ["top", "bottom"] : ["left", "right"];
        let total: number = 0;
        for (const side of sides) {
            for (const property of ["padding-" + side, "border-" + side + "-width"]) {
                const value: CssValue | undefined = values[property];
                total += value !== undefined && value.kind === "length" ? value.px : 0;
            }
        }
        return total;
    }

    private isUpright(values: Values): boolean {
        const mode: CssValue | undefined = values["writing-mode"];
        const orientation: CssValue | undefined = values["text-orientation"];
        const vertical: boolean = mode !== undefined && mode.kind === "ident" && (mode.lower === "vertical-rl" || mode.lower === "vertical-lr");
        return vertical && orientation !== undefined && orientation.kind === "ident" && orientation.lower === "upright";
    }

    private keywords(value?: CssValue): ReadonlyArray<string> {
        if (value === undefined) {
            return [];
        }
        return (value.kind === "list" ? value.items : [value]).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }
}
