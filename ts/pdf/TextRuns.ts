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
import type { FontInstance } from "../fonts/Typeface.js";
import type { Combination, ElementBox, InlineItem, TextRun, TextSequence } from "./BoxTree.js";
import { DisplayTypes } from "./DisplayTypes.js";
import type { FamilyReference, FontMatcher, FontRequest } from "./FontMatcher.js";
import type { FontMetrics } from "./FontMetrics.js";
import type { FontSynthesis } from "./FontSynthesis.js";
import type { TextOrientation } from "./VerticalOrientation.js";
import { VerticalOrientation } from "./VerticalOrientation.js";

type Values = Readonly<Record<string, CssValue>>;

const TAB: number = 0x09;
const LINE_FEED: number = 0x0A;
const LINE_SEPARATOR: number = 0x2028;
const PARAGRAPH_SEPARATOR: number = 0x2029;
const ISOLATING: ReadonlySet<string> = new Set<string>(["isolate", "isolate-override", "plaintext"]);
const GLYPH_PROPERTIES: ReadonlyArray<string> = [
    "font-size", "font-size-adjust", "font-kerning", "font-optical-sizing", "font-palette", "font-variant-ligatures", "font-variant-caps", "font-variant-numeric",
    "font-variant-east-asian", "font-variant-position", "font-variant-alternates", "font-variant-emoji", "font-feature-settings", "font-variation-settings",
    "font-language-override", "font-synthesis-small-caps", "font-synthesis-position", "hyphenate-character", "letter-spacing", "word-spacing", "writing-mode", "text-orientation"
];

const MATH_LETTERS_START: number = 0x1D400;
const MATH_LETTERS_END: number = 0x1D7FF;
const MATH_FAMILY: string = "math";
const LETTERLIKE_START: number = 0x2100;
const LETTERLIKE_END: number = 0x214F;
const BOLD: number = 700;
const MATH_FORMS: ReadonlyArray<readonly [number, number, boolean, boolean, string?]> = [
    [0x210E, 0x210E, false, true], [0x1D400, 0x1D433, true, false], [0x1D434, 0x1D467, false, true], [0x1D468, 0x1D49B, true, true], [0x1D4D0, 0x1D503, true, false],
    [0x1D56C, 0x1D59F, true, false], [0x1D5A0, 0x1D5D3, false, false, "sans-serif"], [0x1D5D4, 0x1D607, true, false, "sans-serif"], [0x1D608, 0x1D63B, false, true, "sans-serif"],
    [0x1D63C, 0x1D66F, true, true, "sans-serif"], [0x1D670, 0x1D6A3, false, false, "monospace"], [0x1D6A4, 0x1D6A5, false, true], [0x1D6A8, 0x1D6E1, true, false],
    [0x1D6E2, 0x1D71B, false, true], [0x1D71C, 0x1D755, true, true], [0x1D756, 0x1D78F, true, false, "sans-serif"], [0x1D790, 0x1D7C9, true, true, "sans-serif"],
    [0x1D7CA, 0x1D7CB, true, false], [0x1D7CE, 0x1D7D7, true, false], [0x1D7E2, 0x1D7EB, false, false, "sans-serif"], [0x1D7EC, 0x1D7F5, true, false, "sans-serif"],
    [0x1D7F6, 0x1D7FF, false, false, "monospace"]
];

export class TextRuns {

    private readonly metrics: FontMetrics;
    private readonly matcher: FontMatcher;
    private readonly synthesis: FontSynthesis;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly vertical: VerticalOrientation = new VerticalOrientation();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly fonts: Map<string, Map<number, FontInstance>> = new Map<string, Map<number, FontInstance>>();
    private readonly keys: WeakMap<Values, string> = new WeakMap<Values, string>();
    private readonly interned: Map<string, string> = new Map<string, string>();

    constructor(metrics: FontMetrics, matcher: FontMatcher, synthesis: FontSynthesis) {
        this.metrics = metrics;
        this.matcher = matcher;
        this.synthesis = synthesis;
    }

    cut(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: Array<number>, collapsedSpaces: ReadonlyArray<number>, scripts: Uint16Array,
        levels: Uint8Array, combinations: ReadonlyArray<Combination>): Array<TextRun> {
        // A run is text that a font shapes in one piece: one script, one bidi level and one font, with no shaping break in
        // it. The characters that have no glyph of their own are outside the runs: forced breaks, tabs and collapsed spaces.
        const runs: Array<TextRun> = [];
        let collapsed: number = 0;
        let combination: number = 0;
        let isolated: boolean = false;
        let broken: boolean = true;
        let previous: TextSequence | undefined;
        for (const [index, item] of items.entries()) {
            if (item.kind === "out-of-flow") {
                continue;
            }
            if (item.kind !== "text") {
                broken = broken || item.kind === "object" || this.breaksShaping(item.node as ElementBox, item.kind === "open");
                continue;
            }
            const node: TextSequence = item.node as TextSequence;
            const known: Map<number, FontInstance> = this.known(node.style.values);
            // CSS Text 4 §8.7: shaping "must not be broken across inline box boundaries when there is no effective change in
            // formatting, or if the only formatting changes do not affect the glyphs".
            const same: boolean = !broken && previous !== undefined && previous.language === node.language && this.keyOf(previous.style.values) === this.keyOf(node.style.values);
            let request: FontRequest | undefined;
            let start: number = starts[index];
            const end: number = starts[index + 1];
            for (let position: number = start; position <= end; position++) {
                while (collapsed < collapsedSpaces.length && collapsedSpaces[collapsed] < position) {
                    collapsed++;
                }
                const code: number = position < end ? codepoints[position] : LINE_FEED;
                if (position < end && collapsedSpaces[collapsed] !== position && code !== TAB && code !== LINE_FEED && code !== LINE_SEPARATOR && code !== PARAGRAPH_SEPARATOR) {
                    continue;
                }
                // CSS Writing Modes 4 §9.1.2: combined text is composed by itself, so its runs stop at its edges and take no
                // shaping context from the text around it.
                for (let from: number = start; from < position;) {
                    while (combination < combinations.length && combinations[combination].end <= from) {
                        combination++;
                    }
                    const next: Combination | undefined = combinations[combination];
                    const combined: boolean = next !== undefined && next.start <= from;
                    const to: number = next === undefined ? position : Math.min(position, combined ? next.end : next.start);
                    request = request ?? this.metrics.request(node.style.values);
                    const first: boolean = from === starts[index];
                    const apart: boolean = combined || isolated;
                    this.shaped(codepoints, from, to, scripts, levels, request, known, runs, !apart && (first ? !broken : true), !apart && (first ? same : true), node, combined);
                    isolated = combined;
                    from = to;
                }
                start = position + 1;
            }
            if (end > starts[index]) {
                broken = false;
                previous = node;
            }
        }
        return runs;
    }

    private breaksShaping(box: ElementBox, start: boolean): boolean {
        // CSS Text 4 §8.7: shaping breaks at a box boundary with a margin, border or padding that is not zero, with a
        // vertical-align that is not the initial value, or that is a bidi isolation boundary.
        const values: Values = box.style.values;
        const side: string = start ? "start" : "end";
        if (this.isNonZero(values["margin-inline-" + side]) || this.isNonZero(values["border-inline-" + side + "-width"]) || this.isNonZero(values["padding-inline-" + side])) {
            return true;
        }
        if (this.keyword("baseline", values["alignment-baseline"]) !== "baseline" || this.isNonZero(values["baseline-shift"]) || this.keyword("auto", values["baseline-source"]) !== "auto") {
            return true;
        }
        // CSS Ruby 1 §3.5: "Bidi isolation is forced on all internal ruby boxes and the ruby container".
        return ISOLATING.has(this.keyword("normal", values["unicode-bidi"])) || this.displays.isRubyBox(box.display);
    }

    private isNonZero(value?: CssValue): boolean {
        if (value === undefined) {
            return false;
        }
        switch (value.kind) {
            case "length":
                return value.px !== 0;
            case "number":
            case "percentage":
                return value.value !== 0;
            case "ident":
                return value.lower !== "auto" && value.lower !== "normal";
            default:
                return true;
        }
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }

    private keyOf(values: Values): string {
        // The computed values that decide which glyphs a font gives and where it puts them.
        let key: string | undefined = this.keys.get(values);
        if (key === undefined) {
            key = JSON.stringify(GLYPH_PROPERTIES.map((property: string) => values[property] ?? null));
            // Many styles have the same key, and each of them would keep its own copy of the text.
            const shared: string | undefined = this.interned.get(key);
            if (shared === undefined) {
                this.interned.set(key, key);
            } else {
                key = shared;
            }
            this.keys.set(values, key);
        }
        return key;
    }

    private known(values: Values): Map<number, FontInstance> {
        // The font of a character depends only on the font properties, so text that has the same ones shares what was found.
        const key: string = this.metrics.fontKey(values);
        let known: Map<number, FontInstance> | undefined = this.fonts.get(key);
        if (known === undefined) {
            known = new Map<number, FontInstance>();
            this.fonts.set(key, known);
        }
        return known;
    }

    private shaped(codepoints: Array<number>, start: number, end: number, scripts: Uint16Array, levels: Uint8Array, request: FontRequest,
        known: Map<number, FontInstance>, runs: Array<TextRun>, context: boolean, same: boolean, node: TextSequence, combined: boolean): void {
        const values: Values = node.style.values;
        const orientation: TextOrientation = this.vertical.of(values);
        const capitalizes: boolean = this.synthesis.capitalizes(values);
        // CSS Fonts 4 §5.3: the font is chosen for each grapheme cluster, so that a base character and its marks come from
        // the same font where one has them all.
        let text: string = "";
        for (let position: number = start; position < end; position++) {
            text += String.fromCodePoint(codepoints[position]);
        }
        let position: number = start;
        // The text before continues this one when no character was left out between them and shaping does not break there.
        const last: TextRun | undefined = runs[runs.length - 1];
        const adjacent: boolean = context && last !== undefined && last.end === start;
        let run: TextRun | undefined = adjacent && same ? last : undefined;
        let contextBefore: boolean = adjacent;
        for (const cluster of this.graphemes.segment(text)) {
            let length: number = 0;
            for (let offset: number = 0; offset < cluster.segment.length; offset++) {
                length++;
                offset += (cluster.segment.codePointAt(offset) as number) > 0xFFFF ? 1 : 0;
            }
            // CSS Fonts 4 §5.2: a character that no font has takes glyph 0, the missing character glyph, of the default font.
            const letter: FontInstance | undefined = length === 1 ? this.mathLetter(codepoints, position, request) : undefined;
            const fonts: ReadonlyArray<FontInstance> | undefined = letter === undefined ? this.clusterFonts(codepoints, position, length, request, known) : [letter];
            if (fonts === undefined) {
                throw new Error("No font is available for the text \"" + text + "\"");
            }
            // CSS Writing Modes 4 §5.1.2: with mixed, "the UA must determine the orientation of each typographic character
            // unit by its Vertical_Orientation property".
            const upright: boolean = !combined && (orientation === "upright" || (orientation === "mixed" && this.vertical.isUpright(codepoints[position])));
            for (let offset: number = 0; offset < length; offset++) {
                const font: FontInstance = fonts[offset];
                // UAX #24 §5.2: a cluster is not split between scripts, and it has the level of its first character.
                const script: number = scripts[position];
                const level: number = levels[position];
                // CSS Fonts 4 §6.6: simulated small capitals are the uppercase glyphs at a smaller size, so the letters that
                // take them make runs of their own.
                const capitals: boolean = capitalizes && this.synthesis.reduces(this.synthesis.capitals(values, font), cluster.segment, node.language);
                if (run !== undefined && run.font === font && run.script === script && run.level === level && run.upright === upright && run.capitals === capitals) {
                    run.end = position + offset + 1;
                } else {
                    // CSS Fonts 5 §3.4: font-size-adjust gives each font its own used size.
                    const size: number = this.metrics.usedSize(values, font) * (capitals ? this.synthesis.capitalScale(font) : 1);
                    run = {
                        start: position + offset, end: position + offset + 1, script, level, font, upright, capitals, combined, contextBefore, size, glyphStart: 0,
                        glyphEnd: 0
                    };
                    runs.push(run);
                }
                contextBefore = true;
            }
            position += length;
        }
    }

    private mathLetter(codepoints: Array<number>, position: number, request: FontRequest): FontInstance | undefined {
        // CSS Fonts 4 §2.1.5: a generic family "may be a composite face"; where no installed font serves math, its mathematical letters
        // are the plain letters of their compatibility decompositions, in their style. Any other family has the missing glyph of §5.2.
        const code: number = codepoints[position];
        if ((code < LETTERLIKE_START || code > LETTERLIKE_END) && (code < MATH_LETTERS_START || code > MATH_LETTERS_END)) {
            return undefined;
        }
        if (!request.families.some((family: FamilyReference) => family.generic && family.name === MATH_FAMILY)) {
            return undefined;
        }
        const decomposed: ReadonlyArray<string> = Array.from(String.fromCodePoint(code).normalize("NFKC"));
        if (decomposed.length !== 1 || this.matcher.fontFor(request, code) !== undefined) {
            return undefined;
        }
        const plain: number = decomposed[0].codePointAt(0) as number;
        const form: readonly [number, number, boolean, boolean, string?] | undefined = MATH_FORMS.find((entry: readonly [number, number, boolean, boolean, string?]) => code >= entry[0] && code <= entry[1]);
        const styled: FontRequest = { ...request };
        if (form?.[2] === true) {
            styled.weight = BOLD;
        }
        if (form?.[3] === true) {
            styled.style = "italic";
        }
        if (form?.[4] !== undefined) {
            styled.families = [{ name: form[4], generic: true }, ...request.families];
        }
        const font: FontInstance | undefined = this.matcher.fontFor(styled, plain);
        if (font !== undefined) {
            codepoints[position] = plain;
        }
        return font;
    }

    private clusterFonts(codepoints: ReadonlyArray<number>, position: number, length: number, request: FontRequest,
        known: Map<number, FontInstance>): ReadonlyArray<FontInstance> | undefined {
        if (length > 1) {
            return this.matcher.clusterFonts(request, codepoints.slice(position, position + length));
        }
        const code: number = codepoints[position];
        let font: FontInstance | undefined = known.get(code);
        if (font === undefined) {
            font = this.matcher.clusterFonts(request, [code])?.[0];
            if (font === undefined) {
                return undefined;
            }
            known.set(code, font);
        }
        return [font];
    }
}
