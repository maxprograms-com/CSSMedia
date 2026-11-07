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
import type { BidiRange, BoxNode, Combination, ElementBox, InlineItem, InlineSequence, InlineText, ShapedRun, TextRun, TextSequence } from "./BoxTree.js";
import { BreakOpportunities } from "./BreakOpportunities.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { EmojiPresentation } from "./EmojiPresentation.js";
import type { FontFeatures } from "./FontFeatures.js";
import type { FontMatcher } from "./FontMatcher.js";
import type { FontMetrics } from "./FontMetrics.js";
import { FontSynthesis } from "./FontSynthesis.js";
import { LineBreaker } from "./LineBreaker.js";
import { PunctuationSpacing } from "./PunctuationSpacing.js";
import { ScriptRuns } from "./ScriptRuns.js";
import { TextAutospace } from "./TextAutospace.js";
import { TextCombination } from "./TextCombination.js";
import { TextRuns } from "./TextRuns.js";
import { TextShaper } from "./TextShaper.js";
import { TextSpacing } from "./TextSpacing.js";
import { TextSpacingTrim } from "./TextSpacingTrim.js";
import { TextTransformer } from "./TextTransformer.js";
import type { BidiParagraph } from "./UnicodeBidi.js";
import { UnicodeBidi } from "./UnicodeBidi.js";
import { VerticalOrientation } from "./VerticalOrientation.js";

interface Controls {
    start: ReadonlyArray<number>;
    end: ReadonlyArray<number>;
}

const SPACE: number = 0x20;
const OBJECT: number = 0xFFFC;
const LEFT_TO_RIGHT_MARK: number = 0x200E;
const RIGHT_TO_LEFT_MARK: number = 0x200F;
const LRE: number = 0x202A;
const RLE: number = 0x202B;
const PDF: number = 0x202C;
const LRO: number = 0x202D;
const RLO: number = 0x202E;
const LRI: number = 0x2066;
const RLI: number = 0x2067;
const FSI: number = 0x2068;
const PDI: number = 0x2069;
const NO_CONTROLS: Controls = { start: [], end: [] };
const ZERO_WIDTH_SPACE: string = "\u200B";
const IDEOGRAPHIC_SPACE: string = "\u3000";
const EDGE: number = -1;
const FORCED_BREAKS: ReadonlySet<number> = new Set<number>([EDGE, 0x0A, 0x2028, 0x2029]);
const WORD_CONTEXT: number = 64;

export class InlineTextBuilder {

    private readonly transformer: TextTransformer = new TextTransformer();
    private readonly bidi: UnicodeBidi = new UnicodeBidi();
    private readonly scripts: ScriptRuns = new ScriptRuns(this.bidi);
    private readonly vertical: VerticalOrientation = new VerticalOrientation();
    private readonly breaker: LineBreaker = new LineBreaker();
    private readonly opportunities: BreakOpportunities = new BreakOpportunities(this.breaker);
    private readonly autospace: TextAutospace = new TextAutospace(this.breaker);
    private readonly punctuation: PunctuationSpacing = new PunctuationSpacing();
    private readonly spacingTrim: TextSpacingTrim = new TextSpacingTrim(this.breaker);
    private readonly combination: TextCombination = new TextCombination();
    private readonly emoji: EmojiPresentation = new EmojiPresentation();
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly runs: TextRuns;
    private readonly shaper: TextShaper;
    private readonly spacing: TextSpacing;

    constructor(metrics: FontMetrics, matcher: FontMatcher, features: FontFeatures) {
        const synthesis: FontSynthesis = new FontSynthesis();
        this.runs = new TextRuns(metrics, matcher, synthesis);
        this.spacing = new TextSpacing(metrics);
        this.shaper = new TextShaper(matcher, metrics, features, this.bidi, synthesis, this.combination);
    }

    prepare(sequences: ReadonlyArray<InlineSequence>): void {
        // CSS Pseudo-Elements 4 §2.1: the first formatted line has the styles of ::first-line, so its text is prepared with
        // them too, and the lines choose between the two.
        for (const sequence of sequences) {
            sequence.text = this.build(sequence);
            if (sequence.firstLine !== undefined) {
                sequence.firstLine.text = this.build(sequence.firstLine);
            }
        }
    }

    position(sequence: InlineSequence, end: number): number {
        // The place in the text of the sequence that matches a place in the text of its first line; the two differ where a
        // property of ::first-line, such as text-transform, changes how many characters a piece of text gives.
        const first: InlineSequence = sequence.firstLine as InlineSequence;
        const lined: InlineText = first.text as InlineText;
        const text: InlineText = sequence.text as InlineText;
        if (end >= lined.codepoints.length) {
            return text.codepoints.length;
        }
        let item: number = 0;
        while (lined.starts[item + 1] <= end) {
            item++;
        }
        const offset: number = end - lined.starts[item];
        const node: BoxNode = sequence.items[item].node;
        if (node.kind !== "text" || lined.starts[item + 1] - lined.starts[item] === text.starts[item + 1] - text.starts[item]) {
            return text.starts[item] + offset;
        }
        // The shortest start of the source text that gives that many characters on the first line gives the place.
        let low: number = 0;
        let high: number = node.text.length;
        while (low < high) {
            const middle: number = (low + high) >> 1;
            if (this.produced(first.items, item, middle) >= offset) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        return text.starts[item] + this.produced(sequence.items, item, low);
    }

    lineLevels(text: InlineText, start: number, end: number): Uint8Array {
        // UAX #9 rule L1 gives the white space at the end of a line the paragraph level; the levels of the text stay as
        // they are, since the same text is broken into lines again at another width.
        const kept: Uint8Array = text.levels.slice(start, end);
        let level: number = 0;
        for (const paragraph of text.paragraphs) {
            if (paragraph.start <= start && start < paragraph.end) {
                level = paragraph.level;
            }
        }
        this.bidi.resetLineEnd(text.codepoints, text.levels, start, end, level);
        const levels: Uint8Array = text.levels.slice(start, end);
        text.levels.set(kept, start);
        return levels;
    }

    isWide(code: number): boolean {
        return this.breaker.isWideOrFullwidth(code);
    }

    private produced(items: ReadonlyArray<InlineItem>, item: number, cut: number): number {
        const codepoints: Array<number> = [];
        const starts: Array<number> = [];
        this.characters(items, item + 1, codepoints, starts, [], cut);
        return codepoints.length - starts[item];
    }

    private characters(items: ReadonlyArray<InlineItem>, count: number, codepoints: Array<number>, starts: Array<number>, collapsedSpaces: Array<number>,
        cut?: number): void {
        // CSS Text 4 Appendix A: text transformation comes after the first phase of white space processing and before the
        // text is wrapped and reordered. An atomic inline stands in the text as U+FFFC.
        let word: string = "";
        for (let index: number = 0; index < count; index++) {
            const item: InlineItem = items[index];
            starts.push(codepoints.length);
            if (item.kind === "text") {
                // CSS Text 4 §2.3: word-space-transform comes first, then the case, full-width and full-size-kana ones.
                const whole: TextSequence = item.node as TextSequence;
                const partial: boolean = cut !== undefined && index === count - 1 && cut < whole.text.length;
                const node: TextSequence = partial ? this.startOf(whole, cut as number) : whole;
                const after: number = partial ? whole.text.charCodeAt(cut as number) : this.characterAfter(items, index);
                const source: string = this.separated(node, codepoints, after);
                const from: number = codepoints.length;
                this.addText(node, source, codepoints, collapsedSpaces, word);
                const emoji: string = this.keyword("normal", node.style.values["font-variant-emoji"]);
                if (emoji !== "normal") {
                    this.emoji.apply(codepoints, from, collapsedSpaces, emoji, after);
                }
                const autospace: ReadonlyArray<string> | undefined = this.keywords(node.style.values["text-autospace"]);
                if (autospace !== undefined && autospace.includes("punctuation") && this.punctuation.isFrench(node.language)) {
                    this.punctuation.apply(codepoints, from, collapsedSpaces, autospace.includes("replace"), after);
                }
                word = this.wordAfter(word, source);
            } else if (item.kind === "object") {
                codepoints.push(OBJECT);
                word = "";
            }
        }
    }

    private startOf(node: TextSequence, cut: number): TextSequence {
        const marks: ReadonlyArray<number> | undefined = node.collapsedSpaces?.filter((offset: number) => offset < cut);
        const start: TextSequence = { kind: "text", text: node.text.substring(0, cut), style: node.style };
        if (node.language !== undefined) {
            start.language = node.language;
        }
        if (marks !== undefined && marks.length > 0) {
            start.collapsedSpaces = marks;
        }
        return start;
    }

    private build(sequence: InlineSequence): InlineText {
        const items: ReadonlyArray<InlineItem> = sequence.items;
        const codepoints: Array<number> = [];
        const starts: Array<number> = [];
        const collapsedSpaces: Array<number> = [];
        this.characters(items, items.length, codepoints, starts, collapsedSpaces);
        starts.push(codepoints.length);
        const trimmed: Array<number> = [];
        const combinations: Array<Combination> = this.combination.find(items, starts, codepoints, trimmed);
        if (trimmed.length > 0) {
            // CSS Writing Modes 4 §9.1.2: the white space at the edges of combined text goes away as at the edges of an
            // inline block, so it joins the spaces that have no advance.
            const spaces: Array<number> = [...new Set<number>([...collapsedSpaces, ...trimmed])].sort((first: number, second: number) => first - second);
            collapsedSpaces.length = 0;
            collapsedSpaces.push(...spaces);
        }
        const levels: Uint8Array = new Uint8Array(codepoints.length);
        const paragraphs: Array<BidiRange> = this.resolveLevels(sequence, codepoints, starts, levels, combinations);
        this.combinedLevels(items, starts, codepoints, levels, combinations);
        const scripts: Uint16Array = this.scripts.resolve(codepoints);
        const runs: Array<ShapedRun> = this.shaper.shape(items, starts, codepoints, this.runs.cut(items, starts, codepoints, collapsedSpaces, scripts, levels, combinations),
            combinations);
        const spacingBefore: Float64Array = new Float64Array(codepoints.length);
        const spacingAfter: Float64Array = new Float64Array(codepoints.length);
        this.spacing.apply(sequence, starts, codepoints, runs, combinations, spacingBefore, spacingAfter);
        const breaks: Uint8Array = this.opportunities.resolve(sequence, starts, codepoints, combinations);
        const avoidance: Uint8Array = this.opportunities.avoidance(sequence, starts, breaks);
        this.shaper.hyphenate(items, starts, runs, breaks);
        const autospace: Uint8Array = this.autospace.classes(codepoints, runs);
        const punctuation: Uint8Array = new Uint8Array(codepoints.length);
        const punctuationTrim: Float64Array = new Float64Array(codepoints.length);
        this.spacingTrim.prepare(items, starts, codepoints, runs, punctuation, punctuationTrim);
        // A sequence has many short runs, so the glyphs of all of them are kept together and each run keeps its range.
        let count: number = 0;
        for (const run of runs) {
            count += run.glyphs.length;
        }
        const text: InlineText = {
            codepoints, starts, collapsedSpaces, combinations, scripts, levels, paragraphs, runs: [], glyphs: new Uint16Array(count), clusters: new Uint32Array(count),
            advances: new Float64Array(count), spacingBefore, spacingAfter, autospace, punctuation, punctuationTrim, breaks, avoidance
        };
        let at: number = 0;
        for (const run of runs) {
            const end: number = at + run.glyphs.length;
            text.glyphs.set(run.glyphs, at);
            text.clusters.set(run.clusters, at);
            text.advances.set(run.advances, at);
            if (this.hasOffset(run.xOffsets)) {
                text.xOffsets = text.xOffsets ?? new Float64Array(count);
                text.xOffsets.set(run.xOffsets, at);
            }
            if (this.hasOffset(run.yOffsets)) {
                text.yOffsets = text.yOffsets ?? new Float64Array(count);
                text.yOffsets.set(run.yOffsets, at);
            }
            const kept: TextRun = {
                start: run.start, end: run.end, script: run.script, level: run.level, font: run.font, upright: run.upright, capitals: run.capitals, combined: run.combined,
                contextBefore: run.contextBefore, size: run.size, glyphStart: at, glyphEnd: end
            };
            if (run.hyphen !== undefined) {
                kept.hyphen = run.hyphen;
            }
            text.runs.push(kept);
            at = end;
        }
        return text;
    }

    private hasOffset(offsets: Float64Array): boolean {
        for (let index: number = 0; index < offsets.length; index++) {
            if (offsets[index] !== 0) {
                return true;
            }
        }
        return false;
    }

    private combinedLevels(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, levels: Uint8Array,
        combinations: ReadonlyArray<Combination>): void {
        // CSS Writing Modes 4 §9.1.2: "the glyphs of the combined text are bidi-isolated and composed horizontally", so the
        // composition keeps its level in the line and its characters take levels of their own.
        let item: number = 0;
        for (const combination of combinations) {
            while (starts[item + 1] <= combination.start) {
                item++;
            }
            combination.level = levels[combination.start];
            const resolved: BidiParagraph = this.bidi.resolve(codepoints.slice(combination.start, combination.end), this.isRightToLeft(items[item].node.style) ? 1 : 0);
            levels.set(resolved.levels, combination.start);
        }
    }

    private separated(node: TextSequence, codepoints: ReadonlyArray<number>, next: number): string {
        // CSS Text 4 §2.2: the expandable separators, here the U+200B characters, become the space that the value names. No
        // phrase boundaries are detected, so with auto-phrase "there are no virtual expandable separator".
        const text: string = node.text;
        const value: CssValue | undefined = node.style.values["word-space-transform"];
        if (value === undefined) {
            return text;
        }
        const keywords: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const ideographic: boolean = keywords.some((item: CssValue) => item.kind === "ident" && item.lower === "ideographic-space");
        if ((!ideographic && !keywords.some((item: CssValue) => item.kind === "ident" && item.lower === "space")) || !text.includes(ZERO_WIDTH_SPACE)) {
            return text;
        }
        let result: string = "";
        let copied: number = 0;
        for (let offset: number = text.indexOf(ZERO_WIDTH_SPACE); offset >= 0; offset = text.indexOf(ZERO_WIDTH_SPACE, offset + 1)) {
            // "must not replace expandable separators immediately preceding or following a forced line break (ignoring any intervening
            // inline box boundaries, and associated margin/border/padding)"; §5: the start and the end of a block are forced line breaks.
            const before: number = offset > 0 ? text.charCodeAt(offset - 1) : (codepoints.length > 0 ? codepoints[codepoints.length - 1] : EDGE);
            const after: number = offset + 1 < text.length ? text.charCodeAt(offset + 1) : next;
            if (!FORCED_BREAKS.has(before) && !FORCED_BREAKS.has(after)) {
                result += text.substring(copied, offset) + (ideographic ? IDEOGRAPHIC_SPACE : " ");
                copied = offset + 1;
            }
        }
        return copied === 0 ? text : result + text.substring(copied);
    }

    private characterAfter(items: ReadonlyArray<InlineItem>, index: number): number {
        for (let next: number = index + 1; next < items.length; next++) {
            const node: BoxNode = items[next].node;
            if (items[next].kind === "object") {
                return OBJECT;
            }
            if (node.kind === "text" && node.text.length > 0) {
                return node.text.charCodeAt(0);
            }
        }
        return EDGE;
    }

    private addText(node: TextSequence, source: string, codepoints: Array<number>, collapsedSpaces: Array<number>, word: string): void {
        const transform: CssValue | undefined = node.style.values["text-transform"];
        const keyword: string | undefined = transform !== undefined && transform.kind === "ident" ? transform.lower : undefined;
        const marks: ReadonlyArray<number> | undefined = node.collapsedSpaces;
        if (transform === undefined || keyword === "none") {
            this.append(source, codepoints, collapsedSpaces, marks);
            return;
        }
        if (marks === undefined || keyword === "math-auto") {
            const text: string = this.transformer.apply(source, word, transform, node.language);
            this.append(text, codepoints, collapsedSpaces, text === source ? marks : undefined);
            return;
        }
        // CSS Text 4 §2.3: the transformations work on preserved white space, which §4.1 defines as the white space "that
        // was not removed or collapsed"; a space collapsed to zero advance stays a space.
        let start: number = 0;
        let before: string = word;
        for (const mark of marks) {
            if (mark > start) {
                this.append(this.transformer.apply(source.substring(start, mark), before, transform, node.language), codepoints, collapsedSpaces);
            }
            collapsedSpaces.push(codepoints.length);
            codepoints.push(SPACE);
            before = "";
            start = mark + 1;
        }
        if (start < source.length) {
            this.append(this.transformer.apply(source.substring(start), before, transform, node.language), codepoints, collapsedSpaces);
        }
    }

    private append(text: string, codepoints: Array<number>, collapsedSpaces: Array<number>, marks?: ReadonlyArray<number>): void {
        let marked: number = 0;
        for (let offset: number = 0; offset < text.length; offset++) {
            const code: number = text.codePointAt(offset) as number;
            if (marks !== undefined && marks[marked] === offset) {
                collapsedSpaces.push(codepoints.length);
                marked++;
            }
            codepoints.push(code);
            offset += code > 0xFFFF ? 1 : 0;
        }
    }

    private wordAfter(word: string, text: string): string {
        // CSS Text 4 §2.1: "inline box boundaries must not introduce a text-transform word boundary", so the word that this
        // text leaves open is given to the next one; a few characters are enough to find where a word starts.
        const last: number = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\t"), text.lastIndexOf("\n"));
        const open: string = last < 0 ? word + text : text.substring(last + 1);
        return open.length > WORD_CONTEXT ? open.substring(open.length - WORD_CONTEXT) : open;
    }

    private keywords(value?: CssValue): ReadonlyArray<string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }

    private resolveLevels(sequence: InlineSequence, codepoints: ReadonlyArray<number>, starts: ReadonlyArray<number>, levels: Uint8Array,
        combinations: ReadonlyArray<Combination>): Array<BidiRange> {
        // CSS Writing Modes 4 §2.4: the bidirectional algorithm runs on "every sequence of inline-level boxes uninterrupted by
        // any block boundary or bidi type B forced paragraph break", with the control codes that §2.2 gives the inline boxes.
        const paragraphs: Array<BidiRange> = [];
        const root: Controls = this.rootControls(sequence.style);
        // §2.4.1: the paragraph level comes from the direction of the containing block, or from rules P2 and P3 when its
        // unicode-bidi is plaintext.
        const plaintext: boolean = this.keyword("normal", sequence.style.values["unicode-bidi"]) === "plaintext";
        const base: number | undefined = plaintext ? undefined : (this.isRightToLeft(sequence.style) && this.vertical.of(sequence.style.values) !== "upright" ? 1 : 0);
        const open: Array<Controls> = [];
        let text: Array<number> = [];
        let positions: Array<number> = [];
        let paragraphStart: number = 0;
        const begin: () => void = (): void => {
            // §2.4.4: the levels, isolates and overrides that a box started "are closed at the paragraph break and reopened on
            // the other side of it".
            text = [...root.start];
            for (const controls of open) {
                text.push(...controls.start);
            }
            positions = new Array<number>(text.length).fill(-1);
        };
        const finish: (end: number) => void = (end: number): void => {
            for (let index: number = open.length - 1; index >= 0; index--) {
                text.push(...open[index].end);
            }
            text.push(...root.end);
            const resolved: BidiParagraph = this.bidi.resolve(text, base);
            for (let index: number = 0; index < positions.length; index++) {
                if (positions[index] >= 0) {
                    levels[positions[index]] = resolved.levels[index];
                }
            }
            paragraphs.push({ start: paragraphStart, end, level: resolved.level });
            paragraphStart = end;
        };
        begin();
        let combined: number = 0;
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "open") {
                const controls: Controls = this.boxControls(item.node as ElementBox);
                open.push(controls);
                text.push(...controls.start);
                positions.length = text.length;
                positions.fill(-1, positions.length - controls.start.length);
                continue;
            }
            if (item.kind === "close") {
                const controls: Controls = open.pop() as Controls;
                text.push(...controls.end);
                positions.length = text.length;
                positions.fill(-1, positions.length - controls.end.length);
                continue;
            }
            // CSS Writing Modes 4 §5.1: text-orientation: upright "for the purposes of bidi reordering, causes all characters to
            // be treated as strong LTR".
            const upright: boolean = item.kind === "text" && this.vertical.of(item.node.style.values) === "upright";
            for (let position: number = starts[index]; position < starts[index + 1]; position++) {
                while (combined < combinations.length && combinations[combined].end <= position) {
                    combined++;
                }
                // CSS Writing Modes 4 §9.1.2: "For bidi reordering, the composition is treated the same as a typographic
                // character unit with text-orientation: upright", and it ignores "any forced line breaks".
                const inside: boolean = combined < combinations.length && combinations[combined].start <= position;
                const separator: boolean = item.kind === "text" && !inside && this.bidi.isParagraphSeparator(codepoints[position]);
                text.push(item.kind === "object" ? this.objectCharacter(item) : ((upright || inside) && !separator ? LEFT_TO_RIGHT_MARK : codepoints[position]));
                positions.push(position);
                if (separator) {
                    finish(position + 1);
                    begin();
                }
            }
        }
        if (paragraphStart < codepoints.length) {
            finish(codepoints.length);
        }
        return paragraphs;
    }

    private objectCharacter(item: InlineItem): number {
        // CSS Writing Modes 4 §2.4.3: replaced elements with display: inline "are treated as neutral characters, unless their
        // unicode-bidi property is either embed or bidi-override, in which case they are treated as strong characters".
        const node: BoxNode = item.node;
        if (node.kind !== "box" || !node.replaced || node.display.outer !== "inline" || node.display.inner !== "flow") {
            return OBJECT;
        }
        const bidi: string = this.keyword("normal", node.style.values["unicode-bidi"]);
        if (bidi !== "embed" && bidi !== "bidi-override") {
            return OBJECT;
        }
        return this.isRightToLeft(node.style) ? RIGHT_TO_LEFT_MARK : LEFT_TO_RIGHT_MARK;
    }

    private boxControls(box: ElementBox): Controls {
        // CSS Writing Modes 4 §2.2, the table of "Bidi control codes injected by unicode-bidi at the start/end of display:
        // inline boxes"; CSS Ruby 1 §3.5: on ruby boxes normal and embed are isolate, and bidi-override is isolate-override.
        let bidi: string = this.keyword("normal", box.style.values["unicode-bidi"]);
        if (this.displays.isRubyBox(box.display)) {
            bidi = bidi === "normal" || bidi === "embed" ? "isolate" : (bidi === "bidi-override" ? "isolate-override" : bidi);
        }
        const rightToLeft: boolean = this.isRightToLeft(box.style);
        switch (bidi) {
            case "embed":
                return { start: [rightToLeft ? RLE : LRE], end: [PDF] };
            case "isolate":
                return { start: [rightToLeft ? RLI : LRI], end: [PDI] };
            case "bidi-override":
                return { start: [rightToLeft ? RLO : LRO], end: [PDF] };
            case "isolate-override":
                return { start: [FSI, rightToLeft ? RLO : LRO], end: [PDF, PDI] };
            case "plaintext":
                return { start: [FSI], end: [PDI] };
            default:
                return NO_CONTROLS;
        }
    }

    private rootControls(style: ComputedStyle): Controls {
        // CSS Writing Modes 4 §2.2: "The LRO/RLO+PDF pairs are also applied to the root inline box of a block container if
        // these values of unicode-bidi were specified on the block container."
        const bidi: string = this.keyword("normal", style.values["unicode-bidi"]);
        if (bidi !== "bidi-override" && bidi !== "isolate-override") {
            return NO_CONTROLS;
        }
        return { start: [this.isRightToLeft(style) ? RLO : LRO], end: [PDF] };
    }

    private isRightToLeft(style: ComputedStyle): boolean {
        return this.keyword("ltr", style.values["direction"]) === "rtl";
    }
}
