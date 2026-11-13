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
import type { ElementBox, InlineItem, InlineSequence, InlineText, TextRun } from "../pdf/BoxTree.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { InlineTextBuilder } from "../pdf/InlineTextBuilder.js";
import { LineBreaker } from "../pdf/LineBreaker.js";
import { TextAutospace } from "../pdf/TextAutospace.js";
import { TextSpacingTrim } from "../pdf/TextSpacingTrim.js";
import type { BlockLayout, Snapshot } from "./BlockLayout.js";
import type { UsedSizes } from "./BoxSizes.js";
import { BoxSizes } from "./BoxSizes.js";
import type { BoxFragment, LineFragment, Margins, TextPiece } from "./Fragment.js";

export type TextEdges = readonly [string, string];

type Values = Readonly<Record<string, CssValue>>;

interface Measured {
    sequence: InlineSequence;
    text: InlineText;
    advances: Float64Array;
    opens: Float64Array;
    closes: Float64Array;
    flags: Uint8Array;
    bidi: boolean;
    tabs?: Map<number, readonly [number, number]>;
    atomics?: Map<number, readonly [BoxFragment, number]>;
    minimums?: Map<number, number>;
    gaps?: Float64Array;
    padding?: Float64Array;
    punctuation?: Map<number, readonly [number, number]>;
    sizes?: Map<ElementBox, UsedSizes>;
    floats?: Array<number>;
    absolutes?: Array<number>;
    places?: Array<number>;
}

interface Group {
    over: number;
    under: number;
    shift: string;
    baseline: number;
}

interface Mark {
    kind: "open" | "close";
    fragment: BoxFragment;
    margin: number;
    edge: number;
}

interface LineBox {
    box?: ElementBox;
    values: Values;
    sizes?: UsedSizes;
    group: Group;
    baseline: number;
    dominant: string;
    normal: boolean;
    fit?: readonly [string, string];
    shift?: readonly [number, number];
    inflate: Margins;
    carried: Margins;
    reversed: boolean;
    lead: number;
    trail: number;
    starts: boolean;
    ends: boolean;
    opened: number;
    marks?: Array<Mark>;
}

interface Unit {
    kind: "text" | "atomic" | "space";
    from: number;
    to: number;
    level: number;
    chain?: ReadonlyArray<ElementBox>;
    group: Group;
    block: number;
    width: number;
    origin: number;
    left: number;
    expands: boolean;
    leader?: boolean;
    piece?: TextPiece | BoxFragment;
}

interface LineState {
    measured: Measured;
    inlineSize: number;
    from: number;
    to: number;
    levels?: Uint8Array;
    level: number;
    reversed: boolean;
    lineReversed: boolean;
    justify: boolean;
    tabLimit: number;
    root: LineBox;
    boxes?: Map<ElementBox, LineBox>;
    groups: Array<Group>;
    units: Array<Unit>;
    place: number;
    run: number;
}

interface Part {
    line: LineFragment;
    measured: Measured;
    start: number;
    end: number;
    natural: number;
    offset: number;
    width: number;
    indent: number;
    fresh: boolean;
    first: boolean;
}

const SPACE: number = 0x20;
const TAB: number = 0x09;
const OGHAM_SPACE: number = 0x1680;
const COLLAPSIBLE: number = 1;
const HANGING: number = 2;
const ANYWHERE: number = 4;
const MINIMUM_ANYWHERE: number = 8;
const SPARE_TIER: number = 256;
const BALANCED_LINES: number = 10;
const START_ALWAYS: number = 1;
const START_UNLESS_FRESH: number = 2;
const END_ALWAYS: number = 4;
const END_IF_NEEDED: number = 8;
const PAIRED_START: number = 16;
const PAIRED_END: number = 32;
const HANG_FIRST: number = 64;
const HANG_LAST: number = 128;
const HANG_FORCE: number = 256;
const HANG_ALLOW: number = 512;
const CUT_AFTER: number = 1024;
const IDEOGRAPHIC_SPACE: number = 0x3000;
const OPENING_MARK: RegExp = /^\p{Ps}$/u;
const CLOSING_MARK: RegExp = /^\p{Pe}$/u;
const HANGS_FIRST: RegExp = /^[\p{Ps}\p{Pf}\p{Pi}'"\u3000]$/u;
const HANGS_LAST: RegExp = /^[\p{Pe}\p{Pf}\p{Pi}'"]$/u;
const STOPS: ReadonlySet<number> = new Set<number>([0x2C, 0x2E, 0x60C, 0x6D4, 0x3001, 0x3002, 0xFF0C, 0xFF0E, 0xFE50, 0xFE51, 0xFE52, 0xFF61, 0xFF64]);
const DEFAULT_TAB_SIZE: number = 8;
const TOLERANCE: number = 0.001;
const NO_MARGIN: Margins = [0, 0];
const LINE_RELATIVE: ReadonlySet<string> = new Set<string>(["top", "center", "bottom"]);
const WORD_SEPARATORS: ReadonlySet<number> = new Set<number>([0x20, 0xA0, 0x1361, 0x10100, 0x10101, 0x1039F, 0x1091F]);
const SPACED_SCRIPTS: ReadonlySet<number> = new Set<number>(
    ["Bopo", "Hani", "Hang", "Hira", "Kana", "Yiii", "Khmr", "Laoo", "Mymr", "Talu", "Tale", "Lana", "Tavt", "Thai"].map((code: string) => ScriptTags.indexOf(code))
);
const BOPOMOFO: number = ScriptTags.indexOf("Bopo");

export class InlineLayout {

    private readonly metrics: FontMetrics;
    private readonly sizes: BoxSizes;
    private readonly text: InlineTextBuilder;
    private readonly host: BlockLayout;
    private readonly scripts: ScriptTags = new ScriptTags();

    constructor(metrics: FontMetrics, sizes: BoxSizes, text: InlineTextBuilder, host: BlockLayout) {
        this.metrics = metrics;
        this.sizes = sizes;
        this.text = text;
        this.host = host;
    }

    layout(sequence: InlineSequence, inlineSize: number, inlineStart: number, origin: number, top: number, out: Array<BoxFragment | LineFragment>,
        blockBasis?: number, resume?: number, marks?: Array<Snapshot>, cut?: readonly [number, number]): Array<LineFragment> | undefined {
        // CSS Pseudo-Elements 4 §2.1: the first formatted line has the styles of ::first-line, so it is made from the text
        // prepared with them, and the lines after it from the text of the block; lines resumed after a break are not first.
        const lined: InlineSequence = resume === undefined ? sequence.firstLine ?? sequence : sequence;
        if (lined.text === undefined || sequence.text === undefined) {
            return undefined;
        }
        let measured: Measured = this.measure(lined, lined.text, inlineSize, false, blockBasis);
        if (!this.hasLines(measured)) {
            if (measured.floats !== undefined) {
                for (const index of measured.floats) {
                    this.host.place(lined.items[index].node as ElementBox, inlineStart, inlineSize, origin, top, -1, out, blockBasis);
                }
            }
            if (measured.absolutes !== undefined) {
                for (const index of measured.absolutes) {
                    const placeholder: BoxFragment = this.host.placeholder(lined.items[index].node as ElementBox);
                    placeholder.block = top;
                    out.push(placeholder);
                }
            }
            for (const index of measured.places ?? []) {
                out.push(this.host.emptyPlace(lined.items[index].node as ElementBox, top));
            }
            return undefined;
        }
        const values: Values = sequence.style.values;
        const indent: readonly [number, boolean, boolean] = this.indent(values, inlineSize);
        // CSS Text 4 §6.3.5: hyphenate-limit-lines is "the maximum number of successive hyphenated lines in an element".
        const lineLimit: CssValue | undefined = values["hyphenate-limit-lines"];
        const limit: number = lineLimit !== undefined && lineLimit.kind === "number" ? lineLimit.value : Number.POSITIVE_INFINITY;
        const limitLast: string = this.keyword("none", values["hyphenate-limit-last"]);
        const keepsLast: boolean = limitLast === "always";
        const later: number = indent[1] ? indent[0] : 0;
        const balances: boolean = this.keyword("auto", values["text-wrap-style"]) === "balance";
        const lines: Array<LineFragment> = [];
        let main: Measured | undefined = lined === sequence ? measured : undefined;
        const mainText: () => Measured = (): Measured => {
            main = main ?? this.measure(sequence, sequence.text as InlineText, inlineSize, false, blockBasis);
            return main;
        };
        let wrap: number = inlineSize;
        let start: number = resume ?? 0;
        let block: number = 0;
        let forced: boolean = resume === undefined || sequence.text.breaks[resume] === LineBreaker.MANDATORY;
        let hyphenated: number = 0;
        let floated: number = 0;
        if (resume !== undefined && measured.floats !== undefined) {
            // The floats of the lines laid out before the break were placed with them.
            while (floated < measured.floats.length && measured.text.starts[measured.floats[floated]] < resume) {
                floated++;
            }
        }
        const strut: number = this.metrics.lineHeight(values);
        for (; ;) {
            const snapshot: Snapshot | undefined = marks === undefined ? undefined : this.host.snapshot(out);
            // CSS Text 4 §7.2.1: the indent is on the first line, with each-line also on "each line after a forced line
            // break", and hanging "Inverts which lines are affected".
            const first: boolean = lines.length === 0 && resume === undefined;
            const fresh: boolean = first || forced;
            const offset: number = indent[1] !== (first || (indent[2] && forced)) ? indent[0] : 0;
            if (fresh && balances) {
                // §5.4: "Groups of lines separated by a forced line break are processed separately."
                wrap = this.balanced(measured, mainText(), start, offset, later, inlineSize, first, hyphenated, limit);
            }
            const beside: boolean = measured.floats !== undefined || this.host.hasExclusions();
            let lineTop: number = block;
            let guess: number = strut;
            let segments: ReadonlyArray<readonly [number, number]> = [[0, inlineSize]];
            let deferred: Array<ElementBox> | undefined;
            let parts: Array<Part>;
            for (; ;) {
                if (beside) {
                    // CSS 2 §9.5: "The current and subsequent line boxes created next to the float are shortened as
                    // necessary to make room for the margin box of the float."
                    segments = this.host.segments(inlineStart, inlineSize, origin + top + lineTop, guess);
                }
                parts = this.parts(measured, start, offset, wrap, segments, values, fresh, first, hyphenated, limit, mainText, cut);
                const probe: ReadonlyArray<Part> = parts.length > 0 ? parts
                    : [this.part(measured, start, offset, wrap, segments[0] ?? [0, inlineSize], values, fresh, first, hyphenated < limit, cut)];
                const anchored: readonly [Part, number] | undefined = this.floatIn(probe, floated);
                if (anchored !== undefined) {
                    // §9.5.1: a float goes beside the line it is in when there is room after what comes before it, and
                    // otherwise below that line.
                    const [part, index]: readonly [Part, number] = anchored;
                    const position: number = part.measured.text.starts[index];
                    const box: ElementBox = part.measured.sequence.items[index].node as ElementBox;
                    const before: number = position <= this.contentStart(part.measured, part.start, part.end) ? 0
                        : this.line(part.measured, part.start, position, part.indent, part.width, values, part.fresh, part.first)[1];
                    floated++;
                    if (!this.host.place(box, inlineStart, inlineSize, origin, top + lineTop, part.offset - probe[0].offset + part.indent + before, out, blockBasis)) {
                        deferred = deferred ?? [];
                        deferred.push(box);
                    }
                    continue;
                }
                const height: number = this.bandHeight(probe);
                if (beside && height > guess + TOLERANCE && !this.sameSegments(segments, this.host.segments(inlineStart, inlineSize, origin + top + lineTop, height))) {
                    guess = height;
                    continue;
                }
                if (parts.length > 0) {
                    break;
                }
                // §9.5: "If a shortened line box is too small to contain any content, then the line box is shifted downward".
                const narrowed: boolean = segments.length !== 1 || segments[0][1] < inlineSize - TOLERANCE;
                const lower: number | undefined = beside && narrowed ? this.host.below(origin + top + lineTop) : undefined;
                if (lower === undefined) {
                    parts = segments.length === 0 ? [] : [probe[0]];
                    break;
                }
                lineTop = lower - origin - top;
                guess = strut;
            }
            if (parts.length === 0) {
                // CSS Shapes 2 §9.2: the wrapping area has no room left for the rest of the content.
                break;
            }
            let last: Part = parts[parts.length - 1];
            const count: number = last.measured.text.codepoints.length;
            const next: Measured = last.end < count ? mainText() : last.measured;
            let after: number = next === last.measured ? last.end : this.text.position(sequence, last.end);
            const fitted: number = Math.min(wrap, last.width);
            if (keepsLast && this.isHyphenated(last.measured, last.end)
                && this.lineEnd(next, after, later, fitted - later, next.text.codepoints.length + 1, false, false, true) >= next.text.codepoints.length) {
                // CSS Text 4 §6.3.5: with always "The last full line of the element" should not be hyphenated.
                const built: readonly [LineFragment, number, number] = this.broken(last.measured, last.start, last.indent, fitted, last.width, values, last.fresh, last.first, false,
                    cut);
                last = { ...last, line: built[0], end: built[1], natural: built[2] };
                parts[parts.length - 1] = last;
                after = next === last.measured ? last.end : this.text.position(sequence, last.end);
            }
            if (limitLast !== "none" && this.isHyphenated(last.measured, last.end)) {
                // §6.3.5: "The last line before any column, page, or spread break inside the element should not be hyphenated", and
                // only the fragmentation knows where a page ends, so the line without its hyphen is kept for it to use.
                const plain: readonly [LineFragment, number, number] = this.broken(last.measured, last.start, last.indent, fitted, last.width, values, last.fresh, last.first, false,
                    cut);
                if (plain[1] > last.start) {
                    last.line.plain = { line: plain[0], next: next === last.measured ? plain[1] : this.text.position(sequence, plain[1]) };
                }
            }
            this.equalize(parts);
            for (const part of parts) {
                part.line.block = lineTop;
                if (part.offset !== 0) {
                    part.line.inline = part.offset;
                }
                lines.push(part.line);
                if (marks !== undefined && snapshot !== undefined) {
                    marks.push(snapshot);
                }
                hyphenated = this.isHyphenated(part.measured, part.end) ? hyphenated + 1 : 0;
            }
            block = lineTop + last.line.blockSize;
            if (deferred !== undefined) {
                for (const box of deferred) {
                    this.host.place(box, inlineStart, inlineSize, origin, top + block, -1, out, blockBasis);
                }
            }
            forced = last.end >= count || last.measured.text.breaks[last.end] === LineBreaker.MANDATORY;
            if (last.end >= count || after >= next.text.codepoints.length) {
                break;
            }
            start = after;
            measured = next;
        }
        return lines;
    }

    private parts(measured: Measured, start: number, offset: number, wrap: number, segments: ReadonlyArray<readonly [number, number]>, values: Values, fresh: boolean,
        first: boolean, hyphenated: number, limit: number, main: () => Measured, cut?: readonly [number, number]): Array<Part> {
        // SVG 2 §11.7.1.2: when the wrapping area breaks a line of text into parts "a line box for each part is created";
        // they are filled in turn, and one too narrow for the content that comes next is left empty.
        const parts: Array<Part> = [];
        let current: Measured = measured;
        let position: number = start;
        let run: number = hyphenated;
        for (const segment of segments) {
            const lead: boolean = parts.length === 0;
            const part: Part = this.part(current, position, lead ? offset : 0, wrap, segment, values, lead && fresh, lead && first, run < limit, cut);
            if (part.natural > part.width - part.indent + TOLERANCE) {
                continue;
            }
            parts.push(part);
            if (part.end >= current.text.codepoints.length || current.text.breaks[part.end] === LineBreaker.MANDATORY) {
                break;
            }
            run = this.isHyphenated(current, part.end) ? run + 1 : 0;
            const next: Measured = main();
            position = next === current ? part.end : this.text.position(next.sequence, part.end);
            current = next;
        }
        return parts;
    }

    private part(measured: Measured, start: number, indent: number, wrap: number, segment: readonly [number, number], values: Values, fresh: boolean, first: boolean,
        hyphens: boolean, cut?: readonly [number, number]): Part {
        const built: readonly [LineFragment, number, number] = this.broken(measured, start, indent, Math.min(wrap, segment[1]), segment[1], values, fresh, first, hyphens, cut);
        return { line: built[0], measured, start, end: built[1], natural: built[2], offset: segment[0], width: segment[1], indent, fresh, first };
    }

    private floatIn(parts: ReadonlyArray<Part>, floated: number): readonly [Part, number] | undefined {
        for (const part of parts) {
            const index: number | undefined = part.measured.floats?.[floated];
            if (index !== undefined && (part.measured.text.starts[index] < part.end || part.end >= part.measured.text.codepoints.length)) {
                return [part, index];
            }
        }
        return undefined;
    }

    private bandHeight(parts: ReadonlyArray<Part>): number {
        let over: number = 0;
        let under: number = 0;
        for (const part of parts) {
            over = Math.max(over, part.line.baseline);
            under = Math.max(under, part.line.blockSize - part.line.baseline);
        }
        return over + under;
    }

    private equalize(parts: ReadonlyArray<Part>): void {
        // SVG 2 §11.7.1.2: "The height of all line boxes in a single line of text must be the same (ensuring all parts have
        // the same baseline)."
        if (parts.length < 2) {
            return;
        }
        const height: number = this.bandHeight(parts);
        const over: number = Math.max(...parts.map((part: Part) => part.line.baseline));
        for (const part of parts) {
            const shift: number = over - part.line.baseline;
            for (const piece of part.line.pieces) {
                if (piece.kind === "text") {
                    piece.baseline += shift;
                } else {
                    piece.block += shift;
                }
            }
            part.line.baseline = over;
            part.line.blockSize = height;
        }
    }

    private sameSegments(first: ReadonlyArray<readonly [number, number]>, second: ReadonlyArray<readonly [number, number]>): boolean {
        return first.length === second.length && first.every((segment: readonly [number, number], index: number) =>
            Math.abs(segment[0] - second[index][0]) <= TOLERANCE && Math.abs(segment[1] - second[index][1]) <= TOLERANCE);
    }

    private balanced(measured: Measured, main: Measured, start: number, offset: number, later: number, inlineSize: number, first: boolean, hyphenated: number,
        limit: number): number {
        // CSS Text 4 §5.4: balance must not change the number of line boxes "in the case of 5 or fewer lines", and "UAs may
        // treat this value as auto if there are more than ten lines to balance"; the narrowest width with as many lines is used.
        const lines: number = this.groupLines(measured, main, start, offset, later, inlineSize, first, hyphenated, limit);
        if (lines < 2 || lines > BALANCED_LINES) {
            return inlineSize;
        }
        let low: number = 0;
        let high: number = inlineSize;
        // The narrowest width is found to the precision of doubles, where no width lies between the two ends.
        for (let middle: number = (low + high) / 2; middle !== low && middle !== high; middle = (low + high) / 2) {
            if (this.groupLines(measured, main, start, offset, later, middle, first, hyphenated, limit) <= lines) {
                high = middle;
            } else {
                low = middle;
            }
        }
        return high;
    }

    private groupLines(measured: Measured, main: Measured, start: number, offset: number, later: number, width: number, first: boolean, hyphenated: number,
        limit: number): number {
        let current: Measured = measured;
        let position: number = start;
        let indent: number = offset;
        let run: number = hyphenated;
        for (let lines: number = 1; ; lines++) {
            const count: number = current.text.codepoints.length;
            const end: number = this.lineEnd(current, position, indent, width - indent, count + 1, lines === 1, first && lines === 1, run < limit);
            if (end >= count || end <= position || current.text.breaks[end] === LineBreaker.MANDATORY) {
                return lines;
            }
            run = this.isHyphenated(current, end) ? run + 1 : 0;
            position = current === main ? end : this.text.position(main.sequence, end);
            current = main;
            indent = later;
            if (position >= main.text.codepoints.length) {
                return lines;
            }
        }
    }

    private broken(measured: Measured, start: number, offset: number, wrap: number, inlineSize: number, values: Values, fresh: boolean, first: boolean,
        hyphens: boolean, cut?: readonly [number, number]): readonly [LineFragment, number, number] {
        const available: number = wrap - offset;
        const count: number = measured.text.codepoints.length;
        let end: number = this.lineEnd(measured, start, offset, available, count + 1, fresh, first, hyphens);
        const stop: number = cut === undefined ? count : Math.min(measured.text.starts[cut[0]] + cut[1], measured.text.starts[cut[0] + 1] ?? count);
        if (end > stop) {
            const shorter: number = this.lineEnd(measured, start, offset, available, stop + 1, fresh, first, hyphens);
            end = shorter > start ? shorter : end;
        }
        let built: readonly [LineFragment, number] = this.line(measured, start, end, offset, inlineSize, values, fresh, first);
        while (built[1] > available + TOLERANCE) {
            // What is left out at the edges of a line is known once its content is in visual order, so a line that
            // turns out too long ends at an earlier break.
            const earlier: number = this.lineEnd(measured, start, offset, available, end, fresh, first, hyphens);
            if (earlier <= start) {
                break;
            }
            end = earlier;
            built = this.line(measured, start, end, offset, inlineSize, values, fresh, first);
        }
        return [built[0], end, built[1]];
    }

    private isHyphenated(measured: Measured, end: number): boolean {
        const kind: number = end < measured.text.codepoints.length ? measured.text.breaks[end] : LineBreaker.NONE;
        return kind === LineBreaker.HYPHENATION || kind === LineBreaker.SPARE_HYPHENATION;
    }

    trimEdges(values: Values): TextEdges {
        return this.fitEdges(values["text-box-edge"]) ?? this.fitEdges(values["line-fit-edge"]) ?? ["text-top", "text-bottom"];
    }

    trimLine(lines: Array<LineFragment>, last: boolean, edges: TextEdges): number {
        // CSS Inline 3 §6.2: the side of the line is trimmed "to the specified metric of its root inline box"; the line boxes
        // of the parts of one line of text are trimmed together.
        const line: LineFragment = lines[last ? lines.length - 1 : 0];
        const band: Array<LineFragment> = lines.filter((other: LineFragment) => other.block === line.block);
        const values: Values = line.sequence.style.values;
        // CSS Writing Modes 4 §6.3: in vertical-lr the line-over side is the block-end side.
        const flipped: boolean = this.overAtEnd(values);
        if (last) {
            const under: number = flipped ? line.blockSize - line.baseline - this.metrics.baseline(values, edges[0])
                : line.blockSize - line.baseline + this.metrics.baseline(values, edges[1]);
            for (const part of band) {
                part.blockSize -= under;
            }
            return under;
        }
        const over: number = flipped ? line.baseline + this.metrics.baseline(values, edges[1]) : line.baseline - this.metrics.baseline(values, edges[0]);
        for (const part of band) {
            part.baseline -= over;
            part.blockSize -= over;
            for (const piece of part.pieces) {
                if (piece.kind === "text") {
                    piece.baseline -= over;
                } else {
                    piece.block -= over;
                }
            }
        }
        for (const other of lines) {
            if (!band.includes(other)) {
                other.block -= over;
            }
        }
        return over;
    }

    intrinsic(sequence: InlineSequence, blockBasis?: number): readonly [number, number] {
        // CSS Sizing 3 §4.1: the min-content size is the size with every soft wrap opportunity taken, and the max-content
        // size the one with none; §5.2.1: percentages count as zero in these contributions.
        const text: InlineText | undefined = sequence.text;
        if (text === undefined) {
            return [0, 0];
        }
        const measured: Measured = this.measure(sequence, text, 0, true, blockBasis);
        const count: number = text.codepoints.length;
        const indent: readonly [number, boolean, boolean] = this.indent(sequence.style.values, 0);
        const first: number = measured.opens[0] + (indent[1] ? 0 : indent[0]);
        let minimum: number = 0;
        let maximum: number = 0;
        let piece: number = first;
        let line: number = first;
        let pieceStart: number = 0;
        let lineStart: number = 0;
        for (let boundary: number = 1; boundary <= count; boundary++) {
            const advance: number = this.advance(measured, boundary - 1, line);
            piece += measured.minimums?.get(boundary - 1) ?? advance;
            line += advance;
            const kind: number = boundary === count ? LineBreaker.MANDATORY : text.breaks[boundary];
            const gap: number = boundary < count && measured.gaps !== undefined ? measured.gaps[boundary] : 0;
            const edges: number = boundary < count ? measured.opens[boundary] : 0;
            // CSS Text 4 §6.6: with overflow-wrap: anywhere the soft wrap opportunities it adds count for the min-content
            // size, and with break-word they do not.
            const loose: boolean = (measured.flags[boundary - 1] & MINIMUM_ANYWHERE) !== 0 && this.isUnitStart(measured, boundary);
            if (kind !== LineBreaker.NONE || loose) {
                const hyphen: number = kind === LineBreaker.HYPHENATION || kind === LineBreaker.SPARE_HYPHENATION ? this.hyphenAdvance(measured, boundary) : 0;
                const padded: number = measured.padding === undefined ? 0 : measured.padding[pieceStart] + measured.padding[boundary - 1];
                minimum = Math.max(minimum, piece + hyphen + padded + measured.closes[boundary] - this.hang(measured, pieceStart, boundary));
                piece = edges;
                pieceStart = boundary;
            } else {
                piece += measured.closes[boundary] + edges + gap;
            }
            if (kind === LineBreaker.MANDATORY) {
                const padded: number = measured.padding === undefined ? 0 : measured.padding[lineStart] + measured.padding[boundary - 1];
                maximum = Math.max(maximum, line + padded + measured.closes[boundary] - this.hang(measured, lineStart, boundary));
                line = edges + (indent[2] && !indent[1] ? indent[0] : 0);
                lineStart = boundary;
            } else {
                line += measured.closes[boundary] + edges + gap;
            }
        }
        // CSS 2 §10.3.5: the preferred widths count the floats: each one alone for the minimum, and side by side with the
        // longest line for the preferred width.
        let floats: number = 0;
        if (measured.floats !== undefined) {
            for (const index of measured.floats) {
                const sizes: readonly [number, number] = this.host.intrinsic(sequence.items[index].node as ElementBox, blockBasis);
                minimum = Math.max(minimum, sizes[0]);
                floats += sizes[1];
            }
        }
        return [Math.max(minimum, piece), Math.max(maximum, line) + floats];
    }

    private measure(sequence: InlineSequence, text: InlineText, inlineSize: number, intrinsic: boolean, blockBasis?: number): Measured {
        // The inline size each character, atomic inline and inline box edge takes, by its place in the text.
        const count: number = text.codepoints.length;
        const measured: Measured = {
            sequence, text, advances: new Float64Array(count), opens: new Float64Array(count + 1), closes: new Float64Array(count + 1), flags: new Uint8Array(count),
            bidi: false
        };
        for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
            measured.advances[text.clusters[glyph]] += text.advances[glyph];
        }
        for (let position: number = 0; position < count; position++) {
            measured.advances[position] += text.spacingBefore[position] + text.spacingAfter[position];
            measured.bidi = measured.bidi || text.levels[position] !== 0;
        }
        const directions: Array<boolean> = [this.isRtl(sequence.style.values)];
        const open: Array<ElementBox> = [];
        let shared: number = 0;
        let textEnd: number = -1;
        for (const [index, item] of sequence.items.entries()) {
            const position: number = text.starts[index];
            if (item.kind === "open") {
                // CSS 2 §9.2.1.1 and §10.3.1: an inline box has its inline margin, border and padding at its two ends, and
                // a part that an inner block split off has neither.
                const box: ElementBox = item.node as ElementBox;
                const rtl: boolean = this.isRtl(box.style.values);
                const sizes: UsedSizes = this.sizes.of(box.style, inlineSize);
                measured.sizes = measured.sizes ?? new Map<ElementBox, UsedSizes>();
                measured.sizes.set(box, sizes);
                if (box.hasStartEdge) {
                    measured.opens[position] += this.edge(sizes, this.leadSide(rtl, directions[directions.length - 1]));
                }
                directions.push(rtl);
                open.push(box);
            } else if (item.kind === "close") {
                const box: ElementBox = item.node as ElementBox;
                const rtl: boolean = directions.pop() as boolean;
                const sizes: UsedSizes | undefined = measured.sizes?.get(box);
                if (box.hasEndEdge && sizes !== undefined) {
                    measured.closes[position] += this.edge(sizes, this.trailSide(rtl, directions[directions.length - 1]));
                }
                open.pop();
                shared = Math.min(shared, open.length);
            } else if (item.kind === "out-of-flow" && item.node.kind === "box" && item.node.placement === "float") {
                measured.floats = measured.floats ?? [];
                measured.floats.push(index);
            } else if (item.kind === "out-of-flow" && item.node.kind === "box" && (item.node.placement === "absolute" || item.node.placement === "fixed")) {
                measured.absolutes = measured.absolutes ?? [];
                measured.absolutes.push(index);
            } else if (item.kind === "out-of-flow" && item.node.kind === "box" && (item.node.placement === "running" || item.node.placement === "footnote")) {
                measured.places = measured.places ?? [];
                measured.places.push(index);
            } else if (item.kind === "object" && item.node.kind === "deferred") {
                const value: CssValue = item.node.value;
                throw new Error("The content value " + (value.kind === "function" ? value.name + "()" : value.kind === "url" ? "url()" : "image") + " is not implemented");
            } else if (item.kind === "object") {
                textEnd = -1;
                this.measurePadding(measured, open.length > 0 ? open[open.length - 1].style.values : sequence.style.values, position, text.starts[index + 1]);
            }
            if (item.kind === "object" && item.node.kind === "box") {
                if (intrinsic) {
                    const sizes: readonly [number, number] = this.host.intrinsic(item.node, blockBasis);
                    measured.minimums = measured.minimums ?? new Map<number, number>();
                    measured.minimums.set(position, sizes[0] + measured.advances[position]);
                    measured.advances[position] += sizes[1];
                } else {
                    const placed: readonly [BoxFragment, number] = this.host.atomic(item.node, inlineSize, blockBasis);
                    measured.atomics = measured.atomics ?? new Map<number, readonly [BoxFragment, number]>();
                    measured.atomics.set(position, [placed[0], placed[0].inline]);
                    measured.advances[position] += placed[1];
                }
            } else if (item.kind === "text" && text.starts[index + 1] > position) {
                const end: number = text.starts[index + 1];
                const values: Values = item.node.style.values;
                this.measureText(measured, values, position, end);
                this.measurePadding(measured, values, position, end);
                // CSS Text 4 §8.4: at element boundaries the spacing "is determined by and rendered within the innermost
                // element that contains the boundary", the lowest box left open since the text before.
                const ancestor: Values = shared > 0 ? open[shared - 1].style.values : sequence.style.values;
                this.measureGaps(measured, values, position, end, textEnd === position ? ancestor : undefined);
                shared = open.length;
                textEnd = end;
            }
        }
        return measured;
    }

    private measurePadding(measured: Measured, values: Values, start: number, end: number): void {
        // CSS Text 4 §8.3: line-padding "is applied only by the innermost inline box at the start/end of the line box", so
        // each character keeps the padding of the box that holds it.
        const value: CssValue | undefined = values["line-padding"];
        const padding: number = value === undefined ? 0 : this.sizes.pixels(value, 0);
        if (padding !== 0 && end > start) {
            measured.padding = measured.padding ?? new Float64Array(measured.text.codepoints.length);
            measured.padding.fill(padding, start, end);
        }
    }

    private linePadding(state: LineState, tokens: Array<Unit | Mark>): void {
        // §8.3: the space "is inserted between that inline box's content edge and the adjacent inline-level content", and
        // "is not a justification opportunity".
        const padding: Float64Array | undefined = state.measured.padding;
        let first: number = -1;
        let last: number = -1;
        for (const [index, token] of tokens.entries()) {
            if (!("fragment" in token) && token.to > token.from) {
                first = first < 0 ? index : first;
                last = index;
            }
        }
        if (padding === undefined || first < 0) {
            return;
        }
        const head: Unit = tokens[first] as Unit;
        const tail: Unit = tokens[last] as Unit;
        const before: number = padding[(head.level & 1) === 0 ? head.from : head.to - 1];
        const after: number = padding[(tail.level & 1) === 0 ? tail.to - 1 : tail.from];
        tokens.splice(last + 1, 0, this.chained({ kind: "space", from: tail.to, to: tail.to, level: tail.level, group: tail.group, block: 0, width: after, origin: 0, left: 0, expands: false }, tail.chain));
        tokens.splice(first, 0, this.chained({ kind: "space", from: head.from, to: head.from, level: head.level, group: head.group, block: 0, width: before, origin: 0, left: 0, expands: false }, head.chain));
    }

    private measureGaps(measured: Measured, values: Values, start: number, end: number, ancestor?: Values): void {
        // CSS Text 4 §8.4.1: the space is put between characters "directly adjoining on a line, i.e. without any intervening
        // non-zero margin, border, or padding or intervening characters"; a break between them leaves it out.
        const text: InlineText = measured.text;
        const count: number = text.codepoints.length;
        const replaces: boolean = this.keywords(values["text-autospace"])?.includes("replace") === true;
        for (let position: number = start; position < end; position++) {
            const outer: boolean = position === start;
            const adjoining: boolean = position > 0 && (!outer || (ancestor !== undefined && measured.opens[position] === 0 && measured.closes[position] === 0));
            const gap: number = adjoining ? this.interScript(outer ? ancestor as Values : values, text.autospace[position - 1], text.autospace[position]) : 0;
            if (gap > 0) {
                measured.gaps = measured.gaps ?? new Float64Array(count + 1);
                measured.gaps[position] = gap;
            }
            // §8.4: with replace the spacing is inserted "even if there is already a space (U+0020) at that point;
            // additionally, the space (U+0020) is removed".
            if (replaces && text.codepoints[position] === SPACE && position > 0 && position + 1 < count && measured.advances[position] !== 0) {
                const replaced: number = this.interScript(values, text.autospace[position - 1], text.autospace[position + 1]);
                if (replaced > 0) {
                    measured.advances[position] = replaced;
                    measured.punctuation = measured.punctuation ?? new Map<number, readonly [number, number]>();
                    measured.punctuation.set(position, [CUT_AFTER, 0]);
                }
            }
        }
    }

    private interScript(values: Values, first: number, second: number): number {
        // CSS Text 4 §8.4.1: ideograph-alpha and ideograph-numeric put "1/8 of the CJK advance measure" between ideographs
        // and non-ideographic letters or numerals; normal is both, and auto leaves the choice to the user agent.
        if (first === second || (first !== TextAutospace.IDEOGRAPH && second !== TextAutospace.IDEOGRAPH)) {
            return 0;
        }
        const other: number = first === TextAutospace.IDEOGRAPH ? second : first;
        const keywords: ReadonlyArray<string> | undefined = this.keywords(values["text-autospace"]);
        const usual: boolean = keywords === undefined || keywords.includes("normal") || keywords.includes("auto");
        const wanted: boolean = other === TextAutospace.LETTER ? usual || keywords?.includes("ideograph-alpha") === true
            : (other === TextAutospace.NUMERAL && (usual || keywords?.includes("ideograph-numeric") === true));
        return wanted ? this.metrics.ideographicAdvance(values) / 8 : 0;
    }

    private keywords(value?: CssValue): ReadonlyArray<string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        let names: Array<string> | undefined;
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind === "ident") {
                names = names ?? [];
                names.push(item.lower);
            }
        }
        return names;
    }

    private measureText(measured: Measured, values: Values, start: number, end: number): void {
        // CSS Text 4 §4.3.2: collapsible spaces at the edges of a line are removed; with white-space-collapse: preserve and
        // wrapping text, white space at the end of a line hangs; with break-spaces it takes room as other characters do.
        const mode: string = this.keyword("collapse", values["white-space-collapse"]);
        const wraps: boolean = this.keyword("wrap", values["text-wrap-mode"]) === "wrap";
        const collapsible: boolean = mode === "collapse" || mode === "preserve-breaks";
        const flag: number = collapsible ? COLLAPSIBLE : ((mode === "preserve" || mode === "preserve-spaces") && wraps ? HANGING : 0);
        // §6.6: with anywhere and break-word "an otherwise unbreakable sequence of characters may be broken at an arbitrary
        // point if there are no otherwise-acceptable break points in the line".
        const overflow: string = this.keyword("normal", values["overflow-wrap"]);
        const loose: number = !wraps || overflow === "normal" ? 0 : (overflow === "anywhere" ? ANYWHERE | MINIMUM_ANYWHERE : ANYWHERE);
        const codepoints: ReadonlyArray<number> = measured.text.codepoints;
        // §8.5: which fullwidth punctuation is set half-width at the start and at the end of a line; trim-all was applied
        // to the glyphs, and space-all trims nothing.
        const trim: string = this.keyword("normal", values["text-spacing-trim"]);
        const trims: boolean = trim !== "space-all" && trim !== "trim-all";
        const startRule: number = trim === "trim-start" || trim === "trim-both" ? START_ALWAYS : (trim === "space-first" ? START_UNLESS_FRESH : 0);
        const endRule: number = trim === "trim-both" ? END_ALWAYS : END_IF_NEEDED;
        const hanging: ReadonlyArray<string> | undefined = this.keywords(values["hanging-punctuation"]);
        const stops: number = hanging === undefined ? 0 : (hanging.includes("force-end") ? HANG_FORCE : (hanging.includes("allow-end") ? HANG_ALLOW : 0));
        for (let position: number = start; position < end; position++) {
            const code: number = codepoints[position];
            const half: number = trims ? measured.text.punctuationTrim[position] : 0;
            let rules: number = 0;
            if (half > 0 && measured.text.punctuation[position] === TextSpacingTrim.OPENING) {
                rules = startRule | (this.pairsBefore(measured, position) ? PAIRED_START : 0);
            } else if (half > 0 && measured.text.punctuation[position] === TextSpacingTrim.CLOSING) {
                rules = endRule | (this.pairsAfter(measured, position) ? PAIRED_END : 0);
            }
            if ((rules & (PAIRED_START | PAIRED_END)) !== 0) {
                measured.advances[position] -= half;
            }
            if (hanging !== undefined && code !== SPACE) {
                // CSS Text 3 §8.2.1: the opening and closing marks that hang on the first and on the last line, and the
                // stops and commas that hang at the end of any line.
                const character: string = String.fromCodePoint(code);
                rules |= (hanging.includes("first") && HANGS_FIRST.test(character) ? HANG_FIRST : 0) | (hanging.includes("last") && HANGS_LAST.test(character) ? HANG_LAST : 0)
                    | (STOPS.has(code) ? stops : 0);
            }
            if (rules !== 0) {
                measured.punctuation = measured.punctuation ?? new Map<number, readonly [number, number]>();
                measured.punctuation.set(position, [rules, half]);
            }
            measured.flags[position] = loose;
            if (code === SPACE || (code === OGHAM_SPACE && collapsible)) {
                measured.flags[position] |= flag;
            } else if (code === TAB) {
                // §4.4.1: tab-size is a number of spaces, or a length.
                const size: CssValue | undefined = values["tab-size"];
                const space: number = this.metrics.spaceAdvance(values);
                const width: number = size === undefined ? DEFAULT_TAB_SIZE * space : (size.kind === "number" ? size.value * space : this.sizes.pixels(size, 0));
                measured.tabs = measured.tabs ?? new Map<number, readonly [number, number]>();
                measured.tabs.set(position, [width, this.metrics.zeroAdvance(values) / 2]);
                measured.flags[position] |= flag === HANGING ? HANGING : 0;
            }
        }
    }

    private pairsBefore(measured: Measured, position: number): boolean {
        // CSS Text 4 §8.5.1: fullwidth opening punctuation is set half-width after an opening mark, a middle dot, an
        // ideographic space, a closing mark "of an equivalent or larger font-size", or a character of the category Ps.
        const text: InlineText = measured.text;
        if (position === 0) {
            return false;
        }
        const code: number = text.codepoints[position - 1];
        const type: number = text.punctuation[position - 1];
        if (type === TextSpacingTrim.OPENING || type === TextSpacingTrim.MIDDLE_DOT || code === IDEOGRAPHIC_SPACE) {
            return true;
        }
        return type === TextSpacingTrim.CLOSING ? this.sizeAt(text, position - 1) >= this.sizeAt(text, position) : OPENING_MARK.test(String.fromCodePoint(code));
    }

    private pairsAfter(measured: Measured, position: number): boolean {
        // CSS Text 4 §8.5.1: fullwidth closing punctuation is set half-width before a closing mark, a middle dot, an
        // ideographic space, an opening mark "of a larger font-size", or a character of the category Pe.
        const text: InlineText = measured.text;
        if (position + 1 >= text.codepoints.length) {
            return false;
        }
        const code: number = text.codepoints[position + 1];
        const type: number = text.punctuation[position + 1];
        if (type === TextSpacingTrim.CLOSING || type === TextSpacingTrim.MIDDLE_DOT || code === IDEOGRAPHIC_SPACE) {
            return true;
        }
        return type === TextSpacingTrim.OPENING ? this.sizeAt(text, position + 1) > this.sizeAt(text, position) : CLOSING_MARK.test(String.fromCodePoint(code));
    }

    private sizeAt(text: InlineText, position: number): number {
        const run: TextRun | undefined = text.runs[this.firstRun(text.runs, position)];
        return run !== undefined && run.start <= position ? run.size : 0;
    }

    private startAdjustment(measured: Measured, position: number, fresh: boolean, first: boolean): number {
        // A character set half-width for the one before it gets that half back when a line starts at it.
        const entry: readonly [number, number] | undefined = measured.punctuation?.get(position);
        if (entry === undefined) {
            return 0;
        }
        if (first && (entry[0] & HANG_FIRST) !== 0) {
            return measured.text.spacingBefore[position] - measured.advances[position];
        }
        const trimmed: boolean = (entry[0] & START_ALWAYS) !== 0 || (!fresh && (entry[0] & START_UNLESS_FRESH) !== 0);
        const paired: boolean = (entry[0] & PAIRED_START) !== 0;
        return trimmed ? (paired ? 0 : -entry[1]) : (paired ? entry[1] : 0);
    }

    private hangsAtEnd(rules: number, needed: boolean, last: boolean): boolean {
        // CSS Text 3 §8.2.1: with force-end a stop or comma at the end of a line hangs, and with allow-end it
        // "conditionally hangs", which is when it does not fit.
        return (last && (rules & HANG_LAST) !== 0) || (rules & HANG_FORCE) !== 0 || (needed && (rules & HANG_ALLOW) !== 0);
    }

    private endAdjustment(measured: Measured, position: number, needed: boolean, last: boolean): number {
        // CSS Text 4 §8.5: normal sets closing punctuation half-width at the end of a line "if it does not otherwise fit
        // prior to justification", and trim-both always.
        const entry: readonly [number, number] | undefined = measured.punctuation?.get(position);
        if (entry === undefined) {
            return 0;
        }
        if (this.hangsAtEnd(entry[0], needed, last)) {
            return measured.text.spacingAfter[position] - measured.advances[position];
        }
        const trimmed: boolean = (entry[0] & END_ALWAYS) !== 0 || (needed && (entry[0] & END_IF_NEEDED) !== 0);
        const paired: boolean = (entry[0] & PAIRED_END) !== 0;
        return trimmed ? (paired ? 0 : -entry[1]) : (paired ? entry[1] : 0);
    }

    private hasLines(measured: Measured): boolean {
        // CSS Inline 3 §2.3: "Line boxes that contain no text, no preserved white space, no inline boxes with non-zero
        // inline-axis margins, padding, or borders, and no other in-flow content" are phantom line boxes.
        if (measured.atomics !== undefined) {
            return true;
        }
        const count: number = measured.text.codepoints.length;
        for (let position: number = 0; position <= count; position++) {
            if (measured.opens[position] !== 0 || measured.closes[position] !== 0 || (position < count && (measured.flags[position] & COLLAPSIBLE) === 0)) {
                return true;
            }
        }
        return false;
    }

    private lineEnd(measured: Measured, start: number, offset: number, available: number, limit: number, fresh: boolean, first: boolean, hyphens: boolean): number {
        // CSS Text 4 §5: a line ends at a forced break, or at the last soft wrap opportunity before the content overflows;
        // content with no opportunity overflows up to the first one. Only the breaks before the limit are looked at.
        const text: InlineText = measured.text;
        const count: number = text.codepoints.length;
        const last: number = Math.min(count, limit - 1);
        const from: number = this.contentStart(measured, start, count);
        const marked: boolean = measured.punctuation !== undefined;
        let width: number = measured.opens[start] - (from < count ? text.spacingBefore[from] : 0) + (marked && from < count ? this.startAdjustment(measured, from, fresh, first) : 0)
            + (measured.padding !== undefined && from < count ? measured.padding[from] : 0);
        // §6.3.3: hyphenate-limit-zone is "the maximum amount of unfilled space (before justification) that may be left in
        // the line box before hyphenation is triggered"; its percentages refer to the length of the line box.
        const zoneValue: CssValue | undefined = measured.sequence.style.values["hyphenate-limit-zone"];
        const zone: number = zoneValue === undefined ? 0 : this.sizes.pixels(zoneValue, available);
        let unfilled: number = Number.POSITIVE_INFINITY;
        let best: number = -1;
        let bestTier: number = Number.MAX_SAFE_INTEGER;
        let emergency: number = -1;
        for (let boundary: number = start + 1; boundary <= last; boundary++) {
            if (boundary > from) {
                width += this.advance(measured, boundary - 1, offset + width);
                const kind: number = boundary === count ? LineBreaker.MANDATORY : text.breaks[boundary];
                const closing: number = marked || measured.padding !== undefined ? this.contentEnd(measured, from, boundary) - 1 : -1;
                const whole: number = width + measured.closes[boundary] - this.hang(measured, from, boundary)
                    + (measured.padding !== undefined && closing >= from ? measured.padding[closing] : 0);
                let content: number = whole + (closing >= from ? this.endAdjustment(measured, closing, false, boundary === count) : 0);
                if (closing >= from && content > available + TOLERANCE) {
                    content = whole + this.endAdjustment(measured, closing, true, boundary === count);
                }
                const fits: boolean = content <= available + TOLERANCE;
                if (!fits && (best >= 0 || emergency >= 0)) {
                    return best >= 0 ? best : emergency;
                }
                const loose: boolean = boundary < count && (measured.flags[boundary - 1] & ANYWHERE) !== 0 && this.isUnitStart(measured, boundary);
                if (kind !== LineBreaker.NONE) {
                    if (!fits || kind === LineBreaker.MANDATORY) {
                        return boundary;
                    }
                    // §6.3.1: the automatic opportunities of a word with a conditional hyphen are used only when nothing
                    // else fits; §5.2 and §5.3: neither is an avoided break, and an outer one comes before an inner one.
                    const spare: boolean = kind === LineBreaker.SPARE_HYPHENATION;
                    const hyphenates: boolean = spare || kind === LineBreaker.HYPHENATION;
                    const hyphen: number = hyphenates ? this.hyphenAdvance(measured, boundary) : 0;
                    // §6.3.5: "In some cases, user agents may not be able to honor the specified value", so a hyphenation
                    // that a limit rules out is still used when the line has no other break.
                    const limited: boolean = hyphenates && (!hyphens || unfilled <= zone);
                    const tier: number = text.avoidance[boundary] + (spare ? SPARE_TIER : 0) + (limited ? 2 * SPARE_TIER : 0);
                    if (content + hyphen <= available + TOLERANCE && tier <= bestTier) {
                        best = boundary;
                        bestTier = tier;
                        unfilled = hyphenates ? unfilled : available - content;
                    }
                } else if (!fits && loose) {
                    return boundary;
                }
                emergency = fits && loose ? boundary : emergency;
            }
            width += measured.closes[boundary] + (boundary < count ? measured.opens[boundary] + (measured.gaps !== undefined && boundary > from ? measured.gaps[boundary] : 0) : 0);
        }
        return limit > count ? count : (best >= 0 ? best : emergency);
    }

    private hyphenAdvance(measured: Measured, boundary: number): number {
        const runs: ReadonlyArray<TextRun> = measured.text.runs;
        const run: TextRun | undefined = runs[this.firstRun(runs, boundary - 1)];
        return run !== undefined && run.start < boundary && run.hyphen !== undefined ? run.hyphen.advance : 0;
    }

    private isUnitStart(measured: Measured, position: number): boolean {
        // A typographic character unit is not split, so text is cut only where a glyph cluster starts.
        const runs: ReadonlyArray<TextRun> = measured.text.runs;
        const run: TextRun | undefined = runs[this.firstRun(runs, position)];
        return run === undefined || run.start >= position || this.startsGlyph(measured.text, run, position);
    }

    private contentStart(measured: Measured, start: number, end: number): number {
        // CSS Text 4 §4.3.2: "A sequence of collapsible spaces at the beginning of a line is removed."
        let from: number = start;
        while (from < end && (measured.flags[from] & COLLAPSIBLE) !== 0) {
            from++;
        }
        return from;
    }

    private contentEnd(measured: Measured, from: number, end: number): number {
        // CSS Text 4 §4.3.2: at the end of a line collapsible spaces are removed, and preserved white space hangs.
        let to: number = end;
        while (to > from && (measured.flags[to - 1] & (COLLAPSIBLE | HANGING)) !== 0) {
            to--;
        }
        return to;
    }

    private hang(measured: Measured, from: number, end: number): number {
        const to: number = this.contentEnd(measured, from, end);
        let width: number = to > from ? measured.text.spacingAfter[to - 1] : 0;
        for (let position: number = to; position < end; position++) {
            width += measured.advances[position];
        }
        return width;
    }

    private advance(measured: Measured, position: number, place: number): number {
        // CSS Text 4 §4.3.2: a preserved tab moves to the next tab stop, and "If this distance is less than 0.5ch, then the
        // subsequent tab stop is used instead"; "If the tab size is zero, preserved tabs are not rendered."
        const tab: readonly [number, number] | undefined = measured.tabs?.get(position);
        if (tab === undefined) {
            return measured.advances[position];
        }
        if (tab[0] <= 0) {
            return 0;
        }
        const stop: number = (Math.floor(place / tab[0] + TOLERANCE) + 1) * tab[0];
        return stop - place < tab[1] ? stop + tab[0] - place : stop - place;
    }

    private line(measured: Measured, start: number, end: number, offset: number, inlineSize: number, values: Values, fresh: boolean, first: boolean): readonly [LineFragment, number] {
        const sequence: InlineSequence = measured.sequence;
        const text: InlineText = measured.text;
        const count: number = text.codepoints.length;
        const from: number = this.contentStart(measured, start, end);
        const to: number = this.contentEnd(measured, from, end);
        const forced: boolean = end >= count || text.breaks[end] === LineBreaker.MANDATORY;
        let level: number = 0;
        for (const paragraph of text.paragraphs) {
            level = paragraph.start <= from && from < paragraph.end ? paragraph.level : level;
        }
        // CSS Text 4 §9.3: the start edge of a line follows the direction of the containing block, and with unicode-bidi:
        // plaintext the direction of the paragraph that the line belongs to.
        const reversed: boolean = this.isRtl(values);
        const lineReversed: boolean = this.keyword("normal", values["unicode-bidi"]) === "plaintext" ? (level & 1) === 1 : reversed;
        let align: string = this.alignment(values, forced, lineReversed);
        let tabLimit: number = from;
        if (align === "justify" && measured.tabs !== undefined) {
            for (const position of measured.tabs.keys()) {
                // §7.1: justification "must ensure that tab stops continue to line up", so only what follows the last tab expands.
                tabLimit = position < to ? Math.max(tabLimit, position + 1) : tabLimit;
            }
        }
        const state: LineState = {
            measured, inlineSize, from, to, level, reversed, lineReversed, justify: align === "justify", tabLimit, root: this.rootBox(sequence.style.values), groups: [], units: [],
            place: offset - (from < count ? text.spacingBefore[from] : 0), run: this.firstRun(text.runs, from)
        };
        if (measured.bidi && to > from) {
            state.levels = this.text.lineLevels(text, from, to);
        }
        this.fill(state, start, end);
        const hyphened: Unit | undefined = this.hyphenate(state, end);
        const closing: Unit | undefined = this.punctuate(state, fresh, first, end >= count);
        const order: Array<Unit> = this.visualOrder(state.units);
        const marks: Array<Unit | Mark> = this.tokens(state, order);
        this.edges(state);
        const tokens: Array<Unit | Mark> = this.autospaced(state, marks);
        this.trim(text, order, hyphened);
        this.linePadding(state, tokens);
        const available: number = inlineSize - offset;
        let natural: number = this.place(tokens, 0);
        if (closing !== undefined && natural > available + TOLERANCE) {
            this.closePunctuation(state, closing, true, end >= count, this.endAdjustment(measured, to - 1, false, end >= count));
            natural = this.place(tokens, 0);
        }
        let used: number = natural;
        const leaders: Array<Unit> = order.filter((unit: Unit) => unit.leader === true);
        if (leaders.length > 0 && used < available) {
            // CSS Content 3 §2.5.2: "The leader should be as long as possible", between the content before it and after it.
            for (const unit of leaders) {
                unit.width += (available - used) / leaders.length;
            }
            used = available;
        }
        if (state.justify) {
            let expanding: number = 0;
            for (const unit of order) {
                expanding += unit.expands ? 1 : 0;
            }
            if (expanding > 0 && used < available) {
                // CSS Text 4 §7.5.1: the remaining space is distributed "so that the contents exactly fill the line box".
                const extra: number = (available - used) / expanding;
                for (const unit of order) {
                    if (unit.expands) {
                        unit.width += extra;
                        unit.origin += (unit.level & 1) === 1 ? extra : 0;
                    }
                }
                used = available;
            } else {
                align = this.unstretched(values, lineReversed);
            }
        }
        // §7.1: content that does not fill the line is aligned, and content that is too long "overflows the line box's
        // end edge". The indent is at the start edge.
        const free: number = available - used;
        let shift: number = lineReversed ? free : 0;
        if (free > 0) {
            shift = align === "right" ? free : (align === "center" ? free / 2 : 0);
        }
        this.place(tokens, (lineReversed ? 0 : offset) + shift);
        const pieces: Array<TextPiece | BoxFragment> = [];
        for (const token of tokens) {
            if ("fragment" in token) {
                if (token.kind === "open") {
                    pieces.push(token.fragment);
                }
            } else if (token.piece !== undefined) {
                token.piece.inline = token.left + token.origin;
                if (token.leader === true) {
                    token.piece.inlineSize = token.width;
                }
                pieces.push(token.piece);
            }
        }
        const extent: readonly [number, number] = this.alignBlocks(state);
        for (const unit of order) {
            if (unit.piece !== undefined && unit.piece.kind === "text") {
                unit.piece.baseline = extent[0] + unit.group.baseline + unit.block;
            } else if (unit.piece !== undefined) {
                // CSS 2 §10.3.7: the static position of an absolutely positioned box is where it would be in the flow.
                unit.piece.block = unit.kind === "space" ? 0 : extent[0] + unit.group.baseline + unit.block;
            }
        }
        const lineSize: number = extent[0] + extent[1];
        const flipped: boolean = this.overAtEnd(values);
        if (flipped) {
            // CSS Writing Modes 4 §6.3: "in vertical-lr writing modes, the line-relative “top” corresponds to the block-end
            // side", so the line built from its over side is turned around in the block axis.
            for (const piece of pieces) {
                if (piece.kind === "text") {
                    piece.baseline = lineSize - piece.baseline;
                } else {
                    piece.block = lineSize - piece.block - piece.blockSize;
                }
            }
        }
        if (reversed) {
            for (const piece of pieces) {
                // The places were counted from the line-left edge; the inline axis of a right-to-left block starts at the right.
                piece.inline = inlineSize - piece.inline - piece.inlineSize;
            }
        }
        if (state.boxes !== undefined) {
            for (const record of state.boxes.values()) {
                if (record.shift === undefined || record.marks === undefined) {
                    continue;
                }
                for (const mark of record.marks) {
                    if (mark.kind === "open") {
                        mark.fragment.inline += record.shift[0];
                        mark.fragment.block += record.shift[1];
                    }
                }
            }
        }
        for (const unit of order) {
            const piece: TextPiece | BoxFragment | undefined = unit.piece;
            const outer: readonly [number, number] | undefined = unit.chain === undefined ? undefined : state.boxes?.get(unit.chain[unit.chain.length - 1])?.shift;
            const own: readonly [number, number] | undefined = unit.kind === "atomic" && piece !== undefined && piece.kind === "box"
                ? this.sizes.relativeShift(piece.box.style, inlineSize, undefined, this.sizes.frame(sequence.style)) : undefined;
            if (piece !== undefined && (outer !== undefined || own !== undefined)) {
                piece.inline += (outer === undefined ? 0 : outer[0]) + (own === undefined ? 0 : own[0]);
                const down: number = (outer === undefined ? 0 : outer[1]) + (own === undefined ? 0 : own[1]);
                if (piece.kind === "text") {
                    piece.baseline += down;
                } else {
                    piece.block += down;
                }
            }
        }
        return [{ kind: "line", sequence, start, end, block: 0, blockSize: lineSize, baseline: flipped ? extent[1] : extent[0], pieces }, natural];
    }

    private overAtEnd(values: Values): boolean {
        return this.keyword("horizontal-tb", values["writing-mode"]) === "vertical-lr";
    }

    private punctuate(state: LineState, fresh: boolean, first: boolean, last: boolean): Unit | undefined {
        const measured: Measured = state.measured;
        if (measured.punctuation === undefined || state.to <= state.from) {
            return undefined;
        }
        const head: Unit | undefined = state.units[0];
        const rules: Map<number, readonly [number, number]> = measured.punctuation;
        const opening: readonly [number, number] | undefined = rules.get(state.from);
        if (head !== undefined && head.kind === "text" && head.from === state.from && opening !== undefined) {
            // A mark that hangs at the right of a right-to-left line is already past the line where its piece puts it.
            const adjustment: number = this.startAdjustment(measured, state.from, fresh, first);
            const hangs: boolean = first && (opening[0] & HANG_FIRST) !== 0;
            head.width += adjustment;
            head.origin += hangs && state.lineReversed ? 0 : adjustment;
        }
        const tail: Unit | undefined = state.units[state.units.length - 1];
        if (tail === undefined || tail.kind !== "text" || tail.to !== state.to || !rules.has(state.to - 1)) {
            return undefined;
        }
        this.closePunctuation(state, tail, false, last, 0);
        return tail;
    }

    private closePunctuation(state: LineState, tail: Unit, needed: boolean, last: boolean, applied: number): void {
        const entry: readonly [number, number] = state.measured.punctuation?.get(state.to - 1) as readonly [number, number];
        const adjustment: number = this.endAdjustment(state.measured, state.to - 1, needed, last);
        tail.width += adjustment - applied;
        tail.origin += adjustment !== applied && state.lineReversed && this.hangsAtEnd(entry[0], needed, last) ? adjustment : 0;
    }

    private autospaced(state: LineState, tokens: Array<Unit | Mark>): Array<Unit | Mark> {
        // CSS Text 4 §8.4.2: "Spacing introduced by text-autospace is inserted after bidi reordering".
        const text: InlineText = state.measured.text;
        if (state.measured.gaps === undefined && !state.measured.bidi) {
            return tokens;
        }
        const result: Array<Unit | Mark> = [];
        let previous: Unit | undefined;
        let blocked: boolean = false;
        let insert: number = -1;
        for (const token of tokens) {
            if ("fragment" in token) {
                blocked = blocked || token.margin !== 0 || token.edge !== 0;
                insert = token.kind === "open" && insert < 0 ? result.length : insert;
            } else {
                if (previous !== undefined && !blocked && previous.kind === "text" && token.kind === "text") {
                    const before: number = (previous.level & 1) === 0 ? previous.to - 1 : previous.from;
                    const after: number = (token.level & 1) === 0 ? token.from : token.to - 1;
                    let shared: number = 0;
                    while (previous.chain !== undefined && token.chain !== undefined && shared < previous.chain.length && shared < token.chain.length
                        && previous.chain[shared] === token.chain[shared]) {
                        shared++;
                    }
                    const values: Values = shared > 0 && previous.chain !== undefined ? previous.chain[shared - 1].style.values : state.root.values;
                    const gap: number = this.interScript(values, text.autospace[before], text.autospace[after]);
                    if (gap > 0) {
                        result.splice(insert < 0 ? result.length : insert, 0,
                            this.chained({ kind: "space", from: token.from, to: token.from, level: previous.level, group: previous.group, block: 0, width: gap, origin: 0, left: 0, expands: false },
                                previous.chain));
                    }
                }
                previous = token;
                blocked = false;
                insert = -1;
            }
            result.push(token);
        }
        return result;
    }

    private fill(state: LineState, start: number, end: number): void {
        const measured: Measured = state.measured;
        const text: InlineText = measured.text;
        const starts: ReadonlyArray<number> = text.starts;
        const items: ReadonlyArray<InlineItem> = measured.sequence.items;
        const count: number = text.codepoints.length;
        let chain: ReadonlyArray<ElementBox> | undefined;
        let index: number = 0;
        for (; index < items.length; index++) {
            const item: InlineItem = items[index];
            const boundary: boolean = item.kind === "open" || item.kind === "close";
            // An out-of-flow box has no length: one where the line starts belongs to this line, as the line before leaves it out.
            if (boundary ? !(starts[index] < start || (starts[index] === start && item.kind === "close" && start > 0))
                : starts[index + 1] > start || (item.kind === "out-of-flow" && starts[index] === start)) {
                break;
            }
            if (item.kind === "open") {
                chain = chain === undefined ? [item.node as ElementBox] : [...chain, item.node as ElementBox];
            } else if (item.kind === "close") {
                chain = chain === undefined || chain.length < 2 ? undefined : chain.slice(0, -1);
            }
        }
        for (; index < items.length; index++) {
            const item: InlineItem = items[index];
            const position: number = starts[index];
            if (position > end || (position === end && item.kind !== "close" && end < count)) {
                // What starts at the end of the line belongs to the next one.
                break;
            }
            if (item.kind === "open") {
                chain = chain === undefined ? [item.node as ElementBox] : [...chain, item.node as ElementBox];
                const record: LineBox = this.lineBox(state, chain.length - 1, chain);
                record.starts = true;
                record.opened = state.units.length;
                state.place += (item.node as ElementBox).hasStartEdge ? this.edge(record.sizes as UsedSizes, record.lead) : 0;
            } else if (item.kind === "close") {
                const record: LineBox = this.lineBox(state, (chain?.length ?? 0) - 1, chain);
                if (record.opened === state.units.length) {
                    // CSS Inline 3 §2.2: "Empty inline boxes still have margins, padding, borders, and a line-height".
                    state.units.push(this.chained({ kind: "space", from: position, to: position, level: state.level, group: record.group, block: 0, width: 0, origin: 0, left: 0, expands: false }, chain));
                }
                record.ends = true;
                state.place += (item.node as ElementBox).hasEndEdge ? this.edge(record.sizes as UsedSizes, record.trail) : 0;
                chain = chain === undefined || chain.length < 2 ? undefined : chain.slice(0, -1);
            } else if (item.kind === "object" && position >= state.from && position < state.to) {
                this.atomicUnit(state, item, position, chain);
            } else if (item.kind === "out-of-flow" && item.node.kind === "box" && (item.node.placement === "absolute" || item.node.placement === "fixed")) {
                state.units.push(this.chained({
                    kind: "space", from: position, to: position, level: state.level, group: state.root.group, block: 0, width: 0, origin: 0, left: 0, expands: false,
                    piece: this.host.placeholder(item.node)
                }, chain));
            } else if (item.kind === "out-of-flow" && item.node.kind === "box" && (item.node.placement === "running" || item.node.placement === "footnote")) {
                state.units.push(this.chained({
                    kind: "space", from: position, to: position, level: state.level, group: state.root.group, block: 0, width: 0, origin: 0, left: 0, expands: false,
                    piece: this.host.emptyPlace(item.node, 0)
                }, chain));
            } else if (item.kind === "text") {
                this.textUnits(state, position, starts[index + 1], item.node.kind === "text" && item.node.leader === true, chain);
            }
        }
    }

    private chained(unit: Unit, chain?: ReadonlyArray<ElementBox>): Unit {
        if (chain !== undefined) {
            unit.chain = chain;
        }
        return unit;
    }

    private textUnits(state: LineState, start: number, end: number, leader: boolean, chain?: ReadonlyArray<ElementBox>): void {
        const measured: Measured = state.measured;
        const text: InlineText = measured.text;
        const runs: ReadonlyArray<TextRun> = text.runs;
        const stop: number = Math.min(end, state.to);
        let cursor: number = Math.max(start, state.from);
        if (cursor >= stop) {
            return;
        }
        const record: LineBox = this.lineBox(state, (chain?.length ?? 0) - 1, chain);
        while (cursor < stop) {
            while (state.run < runs.length && runs[state.run].end <= cursor) {
                state.run++;
            }
            const run: TextRun | undefined = runs[state.run];
            const level: number = state.levels === undefined ? 0 : state.levels[cursor - state.from];
            if (run === undefined || run.start > cursor) {
                // A tab, a forced break or a collapsed space has no glyph.
                const width: number = this.advance(measured, cursor, state.place);
                if (width !== 0) {
                    state.units.push(this.chained({ kind: "space", from: cursor, to: cursor + 1, level, group: record.group, block: 0, width, origin: 0, left: 0, expands: false }, chain));
                    state.place += width;
                }
                cursor++;
                continue;
            }
            // A unit is text of one run and one level; in a justified line it also ends where the line can be expanded.
            let until: number = Math.min(stop, run.end);
            for (let position: number = cursor + 1; position < until && state.levels !== undefined; position++) {
                until = state.levels[position - state.from] === level ? until : position;
            }
            const rules: Map<number, readonly [number, number]> | undefined = measured.punctuation;
            for (let position: number = cursor; position < until && (rules !== undefined || measured.gaps !== undefined); position++) {
                const rule: number = rules?.get(position)?.[0] ?? 0;
                if (position > cursor && ((rule & PAIRED_START) !== 0 || (measured.gaps !== undefined && measured.gaps[position] !== 0))) {
                    until = position;
                } else if ((rule & (PAIRED_END | CUT_AFTER)) !== 0) {
                    until = position + 1;
                }
            }
            const leading: readonly [number, number] | undefined = rules?.get(cursor);
            const kerned: number = leading !== undefined && (leading[0] & PAIRED_START) !== 0 ? leading[1] : 0;
            let expands: boolean = false;
            // CSS Content 3 §2.5.3: a leader is a row of copies of its string, so it is one unit that only the leader rule widens.
            for (let position: number = Math.max(cursor, state.tabLimit); !leader && state.justify && position < until && position + 1 < state.to; position++) {
                if (this.expandsAfter(measured, record.values, run, position)) {
                    until = position + 1;
                    expands = true;
                }
            }
            let width: number = 0;
            for (let position: number = cursor; position < until; position++) {
                width += measured.advances[position];
            }
            // CSS Inline 3 §4: "For a glyph, the alignment baseline is always determined by the parent's dominant baseline."
            const block: number = record.dominant === "alphabetic" ? record.baseline
                : record.baseline - this.metrics.baseline(record.values, record.dominant)
                + this.metrics.fontBaseline(run.font, run.size, record.dominant, this.metrics.vertical(record.values), run.upright);
            if (record.normal) {
                // §5.3: "When its computed line-height is normal, the layout bounds of an inline box encloses all its glyphs".
                const extent: readonly [number, number] = record.fit === undefined ? this.metrics.fontExtent(run.font, run.size, run.upright)
                    : [this.metrics.fontBaseline(run.font, run.size, record.fit[0], this.metrics.vertical(record.values), run.upright),
                        -this.metrics.fontBaseline(run.font, run.size, record.fit[1], this.metrics.vertical(record.values), run.upright)];
                this.bound(record.group, block - extent[0] - record.inflate[0], block + extent[1] + record.inflate[1]);
            }
            const first: number = this.glyphAt(text, run, cursor);
            const last: number = this.glyphAt(text, run, until);
            const unit: Unit = this.chained({ kind: "text", from: cursor, to: until, level, group: record.group, block, width, origin: -kerned, left: 0, expands }, chain);
            if (leader) {
                unit.leader = true;
            }
            if (last > first) {
                unit.piece = { kind: "text", run, from: first, to: last, inline: 0, inlineSize: width, baseline: 0 };
                if (leader) {
                    unit.piece.leader = true;
                }
                if (rules !== undefined) {
                    // Punctuation set half-width and spaces that text-autospace replaced have advances that their glyphs do
                    // not give, so the piece keeps those of its characters for painting.
                    unit.piece.advances = measured.advances.slice(cursor, until);
                }
            }
            state.units.push(unit);
            state.place += width;
            cursor = until;
        }
    }

    private expandsAfter(measured: Measured, values: Values, run: TextRun, position: number): boolean {
        // CSS Text 4 §7.5: none has no justification opportunities, inter-word has them at word separators, and
        // inter-character between each pair of typographic character units; ruby is auto without the word separators.
        const text: InlineText = measured.text;
        const next: number = position + 1;
        let mode: string = "auto";
        const value: CssValue | undefined = values["text-justify"];
        if (value !== undefined) {
            for (const item of value.kind === "list" ? value.items : [value]) {
                mode = item.kind === "ident" && item.lower !== "no-compress" ? item.lower : mode;
            }
        }
        if (mode === "none" || (next < run.end && !this.startsGlyph(text, run, next))) {
            return false;
        }
        const code: number = text.codepoints[position];
        if (WORD_SEPARATORS.has(code)) {
            // §7.5.1: the space goes to a word separator "under the same rules as for word-spacing", so not to one that has
            // no advance.
            return mode !== "ruby" && measured.advances[position] !== 0;
        }
        const script: number = text.scripts[position];
        const other: number = text.scripts[next];
        // §7.5.4: "no justification opportunity exists between any pair of typographic letter units in cursive script".
        if (mode === "inter-word" || (this.scripts.isJoining(script) && this.scripts.isJoining(other))) {
            return false;
        }
        if (mode === "inter-character" || mode === "distribute") {
            return true;
        }
        if (mode === "ruby" && (script === BOPOMOFO || other === BOPOMOFO)) {
            return false;
        }
        // §7.5.5: with auto, the boundary between a unit of a block script or of a clustered script and any other unit.
        return SPACED_SCRIPTS.has(script) || SPACED_SCRIPTS.has(other) || this.text.isWide(code) || this.text.isWide(text.codepoints[next]);
    }

    private atomicUnit(state: LineState, item: InlineItem, position: number, chain?: ReadonlyArray<ElementBox>): void {
        const measured: Measured = state.measured;
        const text: InlineText = measured.text;
        const record: LineBox = this.lineBox(state, (chain?.length ?? 0) - 1, chain);
        const level: number = state.levels === undefined ? 0 : state.levels[position - state.from];
        const width: number = measured.advances[position];
        const placed: readonly [BoxFragment, number] | undefined = measured.atomics?.get(position);
        if (placed === undefined || item.node.kind !== "box") {
            state.units.push(this.chained({ kind: "space", from: position, to: position + 1, level, group: record.group, block: 0, width, origin: 0, left: 0, expands: false }, chain));
            state.place += width;
            return;
        }
        const fragment: BoxFragment = placed[0];
        const values: Values = item.node.style.values;
        // The line is built from its over side, which is the block-end side in vertical-lr (CSS Writing Modes 4 §6.3).
        const flipped: boolean = this.overAtEnd(record.values);
        const overMargin: Margins | undefined = flipped ? fragment.marginAfter : fragment.marginBefore;
        const underMargin: Margins | undefined = flipped ? fragment.marginBefore : fragment.marginAfter;
        const before: number = overMargin === undefined ? 0 : overMargin[0] + overMargin[1];
        const height: number = before + fragment.blockSize + (underMargin === undefined ? 0 : underMargin[0] + underMargin[1]);
        // CSS Inline 3 §4.2.1: auto "Specifies last-baseline alignment for inline-block, first-baseline alignment for
        // everything else."
        const source: string = this.keyword("auto", values["baseline-source"]);
        const lastLine: boolean = source === "last" || (source === "auto" && item.node.display.inner === "flow-root");
        const baseline: number | undefined = lastLine ? fragment.baseline : fragment.firstBaseline;
        const own: number | undefined = baseline === undefined || !flipped ? baseline : fragment.blockSize - baseline;
        const type: string = this.alignmentType(values, record);
        // §3.3: an atomic inline without a baseline of that type has it "synthesized from its margin box".
        let above: number = height;
        if (type === "alphabetic" && own !== undefined) {
            above = before + own;
        } else if (type === "text-top" || type === "hanging") {
            above = 0;
        } else if (type === "middle" || type === "central" || type === "mathematical") {
            above = height / 2;
        }
        const shift: CssValue | undefined = values["baseline-shift"];
        const keyword: string = this.keyword("", shift);
        let group: Group = record.group;
        let top: number = 0;
        if (LINE_RELATIVE.has(keyword)) {
            group = { over: 0, under: height, shift: keyword, baseline: 0 };
            state.groups.push(group);
        } else {
            top = record.baseline - this.metrics.baseline(record.values, type) - above - this.raise(values, record.values, shift);
            this.bound(group, top, top + height);
        }
        // The fragment was placed after its own start margin; in a right-to-left block that margin is at the right.
        const spacing: number = (level & 1) === 1 ? text.spacingAfter[position] : text.spacingBefore[position];
        const margin: number = state.reversed ? width - text.spacingBefore[position] - text.spacingAfter[position] - placed[1] - fragment.inlineSize : placed[1];
        state.units.push(this.chained({ kind: "atomic", from: position, to: position + 1, level, group, block: top + before, width, origin: spacing + margin, left: 0, expands: false, piece: fragment }, chain));
        state.place += width;
    }

    private rootBox(values: Values): LineBox {
        // CSS Inline 3 §2: the block container "generates a root inline box"; §5.1: its line-height "effectively
        // establishes the minimum height of the block's line boxes".
        const group: Group = { over: Number.NEGATIVE_INFINITY, under: Number.NEGATIVE_INFINITY, shift: "baseline", baseline: 0 };
        const root: LineBox = {
            values, group, baseline: 0, dominant: this.dominant(values), normal: this.keyword("normal", values["line-height"]) === "normal",
            inflate: NO_MARGIN, carried: NO_MARGIN, reversed: false, lead: BoxSizes.INLINE_START, trail: BoxSizes.INLINE_END, starts: false, ends: false, opened: -1
        };
        this.strut(root);
        return root;
    }

    private lineBox(state: LineState, depth: number, chain?: ReadonlyArray<ElementBox>): LineBox {
        if (depth < 0 || chain === undefined) {
            return state.root;
        }
        const box: ElementBox = chain[depth];
        let record: LineBox | undefined = state.boxes?.get(box);
        if (record !== undefined) {
            return record;
        }
        const parent: LineBox = this.lineBox(state, depth - 1, chain);
        const values: Values = box.style.values;
        const shift: CssValue | undefined = values["baseline-shift"];
        const keyword: string = this.keyword("", shift);
        let group: Group = parent.group;
        let baseline: number = 0;
        if (LINE_RELATIVE.has(keyword)) {
            // CSS Inline 3 §4.2.3: top, center and bottom "shift the inline box and its contents relative to the bounds of
            // its line box", so the box and what is aligned to it are placed once the line has its height.
            group = { over: Number.NEGATIVE_INFINITY, under: Number.NEGATIVE_INFINITY, shift: keyword, baseline: 0 };
            state.groups.push(group);
        } else {
            // §4: the alignment baseline of the box is put on "the corresponding baseline of its parent", and the box "is
            // potentially shifted from that position".
            const type: string = this.alignmentType(values, parent);
            baseline = parent.baseline - this.metrics.baseline(parent.values, type) + this.metrics.baseline(values, type) - this.raise(values, parent.values, shift);
        }
        const rtl: boolean = this.isRtl(values);
        const reversed: boolean = this.isRtl(parent.values);
        const sizes: UsedSizes = state.measured.sizes?.get(box) ?? this.sizes.of(box.style, state.inlineSize);
        // CSS Inline 3 §5.3: "when line-fit-edge is not leading, the layout bounds are inflated by the sum of the margin,
        // border, and padding on each side", and the negative margins also count for the inline boxes inside.
        const fit: readonly [string, string] | undefined = this.fitEdges(values["line-fit-edge"]);
        // The over and under sides are the block-start and block-end sides, except in vertical-lr (CSS Writing Modes 4 §6.3).
        const overSide: number = this.overAtEnd(values) ? BoxSizes.BLOCK_END : BoxSizes.BLOCK_START;
        const underSide: number = this.overAtEnd(values) ? BoxSizes.BLOCK_START : BoxSizes.BLOCK_END;
        const before: number = fit === undefined ? 0 : this.sizes.margin(sizes, overSide) ?? 0;
        const after: number = fit === undefined ? 0 : this.sizes.margin(sizes, underSide) ?? 0;
        const carries: boolean = before < 0 || after < 0;
        record = {
            box, values, sizes, group, baseline, dominant: this.dominant(values), normal: this.keyword("normal", values["line-height"]) === "normal",
            inflate: fit === undefined ? parent.carried : [
                parent.carried[0] + before + this.sizes.edges(sizes, overSide), parent.carried[1] + after + this.sizes.edges(sizes, underSide)
            ],
            carried: carries ? [parent.carried[0] + Math.min(0, before), parent.carried[1] + Math.min(0, after)] : parent.carried, reversed,
            lead: this.leadSide(rtl, reversed), trail: this.trailSide(rtl, reversed), starts: false, ends: false, opened: -1
        };
        if (fit !== undefined) {
            record.fit = fit;
        }
        const moved: readonly [number, number] | undefined = this.sizes.relativeShift(box.style, state.inlineSize, undefined, this.sizes.frame(state.measured.sequence.style));
        if (moved !== undefined || parent.shift !== undefined) {
            record.shift = [(moved === undefined ? 0 : moved[0]) + (parent.shift === undefined ? 0 : parent.shift[0]),
            (moved === undefined ? 0 : moved[1]) + (parent.shift === undefined ? 0 : parent.shift[1])];
        }
        state.boxes = state.boxes ?? new Map<ElementBox, LineBox>();
        state.boxes.set(box, record);
        this.strut(record);
        return record;
    }

    private strut(record: LineBox): void {
        // CSS Inline 3 §5.3: the leading is the line-height less the ascent and descent, half of it "is added above A of
        // the first available font, and the other half below D"; a box without glyphs holds a strut with those metrics.
        const fit: readonly [string, string] | undefined = record.fit;
        const ascent: number = fit === undefined ? this.metrics.ascent(record.values) : this.metrics.baseline(record.values, fit[0]);
        const descent: number = fit === undefined ? this.metrics.descent(record.values) : -this.metrics.baseline(record.values, fit[1]);
        let half: number = (this.metrics.lineHeight(record.values) - ascent - descent) / 2;
        if (fit !== undefined) {
            // §5.2: "Although only leading applies positive half-leading", "all values apply negative half-leading"; the
            // line gap that normal adds is for leading and for the root inline box.
            half = record.normal ? 0 : Math.min(0, half);
        }
        this.bound(record.group, record.baseline - ascent - half - record.inflate[0], record.baseline + descent + half + record.inflate[1]);
    }

    private fitEdges(value?: CssValue): readonly [string, string] | undefined {
        // CSS Inline 3 §5.2: the first keyword is the over edge and the second the under edge; with one keyword "both
        // edges are assigned that same keyword if possible; else text is assumed as the missing value".
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const over: string = items.length > 0 && items[0].kind === "ident" ? items[0].lower : "leading";
        if (over === "leading") {
            return undefined;
        }
        const second: CssValue | undefined = items[1];
        const under: string = second !== undefined && second.kind === "ident" ? second.lower : (over === "cap" || over === "ex" ? "text" : over);
        return [over === "text" ? "text-top" : (over === "ideographic" ? "ideographic-over" : (over === "ideographic-ink" ? "ideographic-ink-over" : over)),
        under === "text" ? "text-bottom" : (under === "ideographic-ink" ? "ideographic-ink-under" : under)];
    }

    private bound(group: Group, top: number, bottom: number): void {
        group.over = Math.max(group.over, -top);
        group.under = Math.max(group.under, bottom);
    }

    private dominant(values: Values): string {
        // CSS Inline 3 §4.1: auto is alphabetic in horizontal writing modes and with sideways text, and central "in
        // vertical writing modes when text-orientation is mixed or upright".
        const keyword: string = this.keyword("auto", values["dominant-baseline"]);
        if (keyword !== "auto") {
            return keyword;
        }
        const mode: string = this.keyword("horizontal-tb", values["writing-mode"]);
        const upright: boolean = (mode === "vertical-rl" || mode === "vertical-lr") && this.keyword("mixed", values["text-orientation"]) !== "sideways";
        return upright ? "central" : "alphabetic";
    }

    private alignmentType(values: Values, parent: LineBox): string {
        // CSS Inline 3 §4.2.2: baseline is "the dominant baseline choice of the parent".
        const keyword: string = this.keyword("baseline", values["alignment-baseline"]);
        return keyword === "baseline" ? parent.dominant : keyword;
    }

    private raise(values: Values, parent: Values, shift?: CssValue): number {
        // CSS Inline 3 §4.2.3: sub drops "by one fifth of the parent's used font-size" and super raises by one third of
        // it; percentages "refer to the used value of line-height".
        if (shift === undefined) {
            return 0;
        }
        if (shift.kind === "ident") {
            return shift.lower === "sub" ? -this.metrics.fontSize(parent) / 5 : (shift.lower === "super" ? this.metrics.fontSize(parent) / 3 : 0);
        }
        return this.sizes.pixels(shift, this.metrics.lineHeight(values));
    }

    private hyphenate(state: LineState, end: number): Unit | undefined {
        // CSS Text 4 §6.3.2: a line that ends at a hyphenation opportunity shows the hyphenation string after its last
        // character, in the font and with the direction of that text.
        const text: InlineText = state.measured.text;
        const kind: number = end < text.codepoints.length ? text.breaks[end] : LineBreaker.NONE;
        const unit: Unit | undefined = state.units[state.units.length - 1];
        if ((kind !== LineBreaker.HYPHENATION && kind !== LineBreaker.SPARE_HYPHENATION) || unit === undefined || unit.to !== end) {
            return undefined;
        }
        const piece: TextPiece | BoxFragment | undefined = unit.piece;
        if (piece === undefined || piece.kind !== "text" || piece.run.hyphen === undefined) {
            return undefined;
        }
        piece.hyphenated = true;
        unit.width += piece.run.hyphen.advance;
        unit.origin += (unit.level & 1) === 1 ? piece.run.hyphen.advance : 0;
        return unit;
    }

    private visualOrder(units: ReadonlyArray<Unit>): Array<Unit> {
        // UAX #9 rule L2: "From the highest level found in the text to the lowest odd level on each line", "reverse any
        // contiguous sequence of characters that are at that level or higher."
        const order: Array<Unit> = [...units];
        let highest: number = 0;
        let lowestOdd: number = Number.MAX_SAFE_INTEGER;
        for (const unit of order) {
            highest = Math.max(highest, unit.level);
            lowestOdd = (unit.level & 1) === 1 ? Math.min(lowestOdd, unit.level) : lowestOdd;
        }
        for (let level: number = highest; level >= lowestOdd; level--) {
            for (let index: number = 0; index < order.length; index++) {
                let last: number = index;
                while (last < order.length && order[last].level >= level) {
                    last++;
                }
                for (let low: number = index, high: number = last - 1; low < high; low++, high--) {
                    const moved: Unit = order[low];
                    order[low] = order[high];
                    order[high] = moved;
                }
                index = Math.max(index, last - 1);
            }
        }
        return order;
    }

    private tokens(state: LineState, order: ReadonlyArray<Unit>): Array<Unit | Mark> {
        // CSS Writing Modes 4 §2.4.5: reordering can split an inline box into several fragments in one line, so a box has
        // a fragment for each stretch of its content that is contiguous in visual order.
        const tokens: Array<Unit | Mark> = [];
        const open: Array<LineBox> = [];
        let chain: ReadonlyArray<ElementBox> | undefined;
        for (const unit of order) {
            if (unit.chain !== chain) {
                let shared: number = 0;
                while (chain !== undefined && unit.chain !== undefined && shared < chain.length && shared < unit.chain.length && chain[shared] === unit.chain[shared]) {
                    shared++;
                }
                while (open.length > shared) {
                    tokens.push(this.closeMark(open.pop() as LineBox));
                }
                if (unit.chain !== undefined) {
                    for (let depth: number = shared; depth < unit.chain.length; depth++) {
                        const record: LineBox = this.lineBox(state, depth, unit.chain);
                        open.push(record);
                        tokens.push(this.openMark(record));
                    }
                }
                chain = unit.chain;
            }
            tokens.push(unit);
        }
        while (open.length > 0) {
            tokens.push(this.closeMark(open.pop() as LineBox));
        }
        return tokens;
    }

    private openMark(record: LineBox): Mark {
        // CSS 2 §10.6.1: the content area of an inline box follows from its font, and its block-axis padding, border and
        // margin do not enter into the height of the line; the block position is counted from the baseline of its group.
        const box: ElementBox = record.box as ElementBox;
        const sizes: UsedSizes = record.sizes as UsedSizes;
        // CSS Inline 3 §6.2: on an inline box text-box-trim "trims the block-start side of the box to match its content edge
        // to the metric specified by text-box-edge", and the block-end side likewise.
        const trim: string = this.keyword("none", record.values["text-box-trim"]);
        const edges: TextEdges = this.trimEdges(record.values);
        const ascent: number = trim === "trim-start" || trim === "trim-both" ? this.metrics.baseline(record.values, edges[0]) : this.metrics.ascent(record.values);
        const descent: number = trim === "trim-end" || trim === "trim-both" ? -this.metrics.baseline(record.values, edges[1]) : this.metrics.descent(record.values);
        const before: number = this.sizes.edges(sizes, BoxSizes.BLOCK_START);
        const after: number = this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const fragment: BoxFragment = { kind: "box", box, inline: 0, block: record.baseline - ascent - before, inlineSize: 0, blockSize: before + ascent + descent + after };
        if (sizes.border !== undefined && (sizes.border[BoxSizes.BLOCK_START] !== 0 || sizes.border[BoxSizes.BLOCK_END] !== 0)) {
            fragment.border = [sizes.border[BoxSizes.BLOCK_START], 0, sizes.border[BoxSizes.BLOCK_END], 0];
        }
        if (sizes.padding !== undefined && (sizes.padding[BoxSizes.BLOCK_START] !== 0 || sizes.padding[BoxSizes.BLOCK_END] !== 0)) {
            fragment.padding = [sizes.padding[BoxSizes.BLOCK_START], 0, sizes.padding[BoxSizes.BLOCK_END], 0];
        }
        const mark: Mark = { kind: "open", fragment, margin: 0, edge: 0 };
        if (record.marks === undefined) {
            record.marks = [mark];
        } else {
            record.marks.push(mark);
        }
        return mark;
    }

    private closeMark(record: LineBox): Mark {
        // A box is closed on a line only after it was opened or continued on it, so it has marks.
        const marks: Array<Mark> = record.marks as Array<Mark>;
        const mark: Mark = { kind: "close", fragment: marks[marks.length - 1].fragment, margin: 0, edge: 0 };
        marks.push(mark);
        return mark;
    }

    private edges(state: LineState): void {
        // CSS Writing Modes 4 §2.4.5.2: the margins, borders and padding go to the fragments "in visual order (not logical
        // order)": the first edge to the start-most fragment by the direction of the parent, the last edge to the end-most.
        if (state.boxes === undefined) {
            return;
        }
        for (const record of state.boxes.values()) {
            if (record.marks === undefined) {
                continue;
            }
            const box: ElementBox = record.box as ElementBox;
            const sizes: UsedSizes = record.sizes as UsedSizes;
            const first: boolean = record.starts && box.hasStartEdge;
            const last: boolean = record.ends && box.hasEndEdge;
            if (record.reversed ? last : first) {
                this.setEdge(record.marks[0], sizes, record.reversed ? record.trail : record.lead);
            }
            if (record.reversed ? first : last) {
                this.setEdge(record.marks[record.marks.length - 1], sizes, record.reversed ? record.lead : record.trail);
            }
        }
    }

    private setEdge(mark: Mark, sizes: UsedSizes, side: number): void {
        const fragment: BoxFragment = mark.fragment;
        if (sizes.border !== undefined && sizes.border[side] !== 0) {
            const border: [number, number, number, number] = fragment.border === undefined ? [0, 0, 0, 0] : [fragment.border[0], fragment.border[1], fragment.border[2], fragment.border[3]];
            border[side] = sizes.border[side];
            fragment.border = border;
        }
        if (sizes.padding !== undefined && sizes.padding[side] !== 0) {
            const padding: [number, number, number, number] = fragment.padding === undefined ? [0, 0, 0, 0] : [fragment.padding[0], fragment.padding[1], fragment.padding[2], fragment.padding[3]];
            padding[side] = sizes.padding[side];
            fragment.padding = padding;
        }
        mark.margin = this.sizes.margin(sizes, side) ?? 0;
        mark.edge = this.sizes.edges(sizes, side);
    }

    private trim(text: InlineText, order: ReadonlyArray<Unit>, hyphened?: Unit): void {
        // CSS Text 4 §8.2: letter-spacing "is not applied at the beginning or at the end of a line"; the piece keeps its
        // glyphs where its own spacing puts them, so the part left out at the left moves its origin.
        const first: Unit | undefined = order[0];
        if (first !== undefined && first.kind !== "space" && !(first === hyphened && (first.level & 1) === 1)) {
            const space: number = (first.level & 1) === 0 ? text.spacingBefore[first.from] : text.spacingAfter[first.to - 1];
            first.width -= space;
            first.origin -= space;
        }
        const last: Unit | undefined = order[order.length - 1];
        if (last !== undefined && last.kind !== "space" && !(last === hyphened && (last.level & 1) === 0)) {
            last.width -= (last.level & 1) === 0 ? text.spacingAfter[last.to - 1] : text.spacingBefore[last.from];
        }
    }

    private place(tokens: ReadonlyArray<Unit | Mark>, start: number): number {
        let left: number = start;
        for (const token of tokens) {
            if (!("fragment" in token)) {
                token.left = left;
                left += token.width;
            } else if (token.kind === "open") {
                left += token.margin;
                token.fragment.inline = left;
                left += token.edge;
            } else {
                left += token.edge;
                token.fragment.inlineSize = left - token.fragment.inline;
                left += token.margin;
            }
        }
        return left - start;
    }

    private alignBlocks(state: LineState): readonly [number, number] {
        // CSS Inline 3 §2.2: the line is "sized to exactly include the aligned layout bounds of all its inline-level
        // boxes", and those with line-relative shifts "are assumed to be aligned so as to minimize the line box height".
        let over: number = state.root.group.over;
        let under: number = state.root.group.under;
        for (const group of state.groups) {
            const height: number = group.over + group.under;
            if (group.shift === "top") {
                under = Math.max(under, height - over);
            } else if (group.shift === "bottom") {
                over = Math.max(over, height - under);
            } else if (height > over + under) {
                const grown: number = (height - over - under) / 2;
                over += grown;
                under += grown;
            }
        }
        for (const group of state.groups) {
            // §4.2.3: the over edge, the center or the under edge of the aligned subtree goes on that of the line box.
            if (group.shift === "top") {
                group.baseline = group.over - over;
            } else if (group.shift === "bottom") {
                group.baseline = under - group.under;
            } else {
                group.baseline = (under - over + group.over - group.under) / 2;
            }
        }
        if (state.boxes === undefined) {
            return [over, under];
        }
        for (const record of state.boxes.values()) {
            // §6.4: with inline-sizing: stretch the "over/under margin edges coincide with the corresponding line box's edges".
            const stretches: boolean = this.keyword("normal", record.values["inline-sizing"]) === "stretch";
            const sizes: UsedSizes = record.sizes as UsedSizes;
            if (record.marks === undefined) {
                continue;
            }
            for (const mark of record.marks) {
                if (mark.kind === "open" && stretches) {
                    const flipped: boolean = this.overAtEnd(record.values);
                    mark.fragment.block = this.sizes.margin(sizes, flipped ? BoxSizes.BLOCK_END : BoxSizes.BLOCK_START) ?? 0;
                    mark.fragment.blockSize = over + under - mark.fragment.block - (this.sizes.margin(sizes, flipped ? BoxSizes.BLOCK_START : BoxSizes.BLOCK_END) ?? 0);
                } else if (mark.kind === "open") {
                    mark.fragment.block += over + record.group.baseline;
                }
            }
        }
        return [over, under];
    }

    private alignment(values: Values, forced: boolean, reversed: boolean): string {
        // CSS Text 4 §7.4: text-align-last is for "the last line of a block or a line right before a forced line break"; with
        // auto it follows text-align-all, except that justify makes it start-aligned.
        const all: string = this.alignKeyword("start", values["text-align-all"]);
        const last: string = this.alignKeyword("auto", values["text-align-last"]);
        const align: string = !forced ? all : (last !== "auto" ? last : (all === "justify" ? "start" : all));
        return this.physical(align, reversed);
    }

    private unstretched(values: Values, reversed: boolean): string {
        // CSS Text 4 §7.5.3: contents that cannot be stretched "must be aligned as specified by the text-align-last
        // property. (If text-align-last is justify, then they must be aligned as for center.)"
        const last: string = this.alignKeyword("auto", values["text-align-last"]);
        return last === "justify" ? "center" : this.physical(last === "auto" ? "start" : last, reversed);
    }

    private physical(align: string, reversed: boolean): string {
        if (align === "start") {
            return reversed ? "right" : "left";
        }
        return align === "end" ? (reversed ? "left" : "right") : align;
    }

    private alignKeyword(initial: string, value?: CssValue): string {
        // CSS Text 4 §7.2: outside a table cell, and in text that wraps, an alignment character leaves the keyword given
        // with it, and "if it is not given, it defaults to right".
        if (value === undefined) {
            return initial;
        }
        if (value.kind === "ident") {
            return value.lower;
        }
        if (value.kind === "list") {
            for (const item of value.items) {
                if (item.kind === "ident") {
                    return item.lower;
                }
            }
        }
        return value.kind === "string" || value.kind === "list" ? "right" : initial;
    }

    private indent(values: Values, inlineSize: number): readonly [number, boolean, boolean] {
        // CSS Text 4 §7.2.1: a length or a percentage of the block's inline size, with hanging and each-line.
        const value: CssValue | undefined = values["text-indent"];
        let length: number = 0;
        let hanging: boolean = false;
        let eachLine: boolean = false;
        if (value !== undefined) {
            for (const item of value.kind === "list" ? value.items : [value]) {
                if (item.kind === "ident") {
                    hanging = hanging || item.lower === "hanging";
                    eachLine = eachLine || item.lower === "each-line";
                } else {
                    length = this.sizes.pixels(item, inlineSize);
                }
            }
        }
        return [length, hanging, eachLine];
    }

    private edge(sizes: UsedSizes, side: number): number {
        return (this.sizes.margin(sizes, side) ?? 0) + this.sizes.edges(sizes, side);
    }

    private leadSide(rtl: boolean, parentRtl: boolean): number {
        // The edge that comes first along the parent's direction is the start edge of a box with that direction, and the
        // end edge of a box with the other one.
        return rtl === parentRtl ? BoxSizes.INLINE_START : BoxSizes.INLINE_END;
    }

    private trailSide(rtl: boolean, parentRtl: boolean): number {
        return rtl === parentRtl ? BoxSizes.INLINE_END : BoxSizes.INLINE_START;
    }

    private isRtl(values: Values): boolean {
        // CSS Writing Modes 4 §6.4: in vertical modes "a text-orientation value of upright forces the used direction to ltr".
        const mode: string = this.keyword("horizontal-tb", values["writing-mode"]);
        const upright: boolean = (mode === "vertical-rl" || mode === "vertical-lr") && this.keyword("mixed", values["text-orientation"]) === "upright";
        return !upright && this.keyword("ltr", values["direction"]) === "rtl";
    }

    private firstRun(runs: ReadonlyArray<TextRun>, position: number): number {
        let low: number = 0;
        let high: number = runs.length;
        while (low < high) {
            const middle: number = (low + high) >> 1;
            if (runs[middle].end <= position) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    private glyphAt(text: InlineText, run: TextRun, position: number): number {
        // The glyphs of a run are in the order of the text, so the first one of a character is found by halving.
        let low: number = run.glyphStart;
        let high: number = run.glyphEnd;
        while (low < high) {
            const middle: number = (low + high) >> 1;
            if (text.clusters[middle] < position) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    private startsGlyph(text: InlineText, run: TextRun, position: number): boolean {
        const glyph: number = this.glyphAt(text, run, position);
        return glyph < run.glyphEnd && text.clusters[glyph] === position;
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }
}
