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
import { CharacterMapLookup } from "../fonts/CharacterMapLookup.js";
import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import { FeatureShaper } from "../fonts/layout/FeatureShaper.js";
import { FontLayout } from "../fonts/layout/FontLayout.js";
import type { GlyphInfo } from "../fonts/layout/GlyphInfo.js";
import type { FaceMetrics, FontInstance, Typeface } from "../fonts/Typeface.js";
import type { BlockLayout } from "../layout/BlockLayout.js";
import type { UsedSizes } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment, LineFragment, Margins } from "../layout/Fragment.js";
import type { BoxNode, ElementBox, InlineText } from "../pdf/BoxTree.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import { LineBreaker } from "../pdf/LineBreaker.js";
import { UnicodeBidi } from "../pdf/UnicodeBidi.js";
import type { MathElement } from "./MathMarkup.js";
import type { DictionaryEntry } from "./MathOperators.js";
import { MathOperators } from "./MathOperators.js";
import type { GlyphAssembly, GlyphConstruction, GlyphPart, MathConstants } from "./MathTable.js";
import { MathTable } from "./MathTable.js";

interface MathGlyph {
    font: FontInstance;
    size: number;
    glyph: number;
    text: string;
    inline: number;
    baseline: number;
    advance: number;
}

interface MathRule {
    inline: number;
    block: number;
    inlineSize: number;
    blockSize: number;
}

export type MathPathCommand = readonly ["M", number, number] | readonly ["L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

export interface MathPath {
    lineWidth: number;
    filled: boolean;
    commands: ReadonlyArray<MathPathCommand>;
}

export interface MathGraphics {
    glyphs?: Array<MathGlyph>;
    rules?: Array<MathRule>;
    paths?: Array<MathPath>;
}

interface Metrics {
    width: number;
    ascent: number;
    descent: number;
    inkAscent: number;
    inkDescent: number;
    italic?: number;
    accent?: number;
}

interface MathContent extends Metrics {
    children: Array<BoxFragment | LineFragment>;
    glyphs?: Array<MathGlyph>;
    rules?: Array<MathRule>;
    paths?: Array<MathPath>;
    bar?: readonly [number, number];
    centered?: boolean;
}

interface Laid extends Metrics {
    box: ElementBox;
    fragment: BoxFragment;
    start: number;
    top: number;
    operator?: Operator;
}

interface StackRow {
    kind: "digits" | "line" | "carries";
    box: ElementBox;
    position: number;
    cells: Array<readonly [Laid, number]>;
    ascent: number;
    descent: number;
    baseline: number;
}

interface TableCell {
    box: ElementBox;
    row: number;
    column: number;
    rows: number;
    columns: number;
    sizes: UsedSizes;
    content?: Laid;
}

interface TableRow {
    height: number;
    baseline: number;
    axis: number;
}

interface Stretch {
    inline?: number;
    ascent?: number;
    descent?: number;
}

interface Operator {
    stretchy: boolean;
    symmetric: boolean;
    largeop: boolean;
    movablelimits: boolean;
    lspace: number;
    rspace: number;
    minsize: CssValue;
    maxsize?: CssValue;
    inline: boolean;
}

interface Shaped {
    width: number;
    ascent: number;
    descent: number;
    italic: number;
    glyphs: Array<MathGlyph>;
}

const GROUPING: ReadonlySet<string> = new Set<string>(["a", "maction", "math", "merror", "mphantom", "mprescripts", "mrow", "mstyle", "semantics"]);
const SCRIPTED: ReadonlySet<string> = new Set<string>(["mmultiscripts", "mover", "msub", "msubsup", "msup", "munder", "munderover"]);
const TOKENS: ReadonlySet<string> = new Set<string>(["mi", "mn", "mtext", "ms", "annotation", "annotation-xml"]);
const SPACE_LIKE: ReadonlySet<string> = new Set<string>(["mtext", "mspace"]);
const FORMS: ReadonlyArray<string> = ["infix", "postfix", "prefix"];
const HUNDRED_PERCENT: CssValue = { kind: "percentage", value: 100 };
const RADICAL: number = 0x221A;
const RADICAL_TEXT: string = "√";
const MATH_SCRIPT: ReadonlyArray<string> = ["math"];
const MIRRORED_FORMS: ReadonlyMap<string, number> = new Map<string, number>([["rtlm", 1]]);
const COLLAPSIBLE_EDGES: RegExp = /^ +| +$/g;
const COLLAPSING: ReadonlySet<string> = new Set<string>(["collapse", "preserve-breaks"]);
const SUBSCRIPT: number = 1;
const SUPERSCRIPT: number = 2;
const BOTH_SCRIPTS: number = 3;
const TOLERANCE: number = 0.001;
const INVISIBLE_TIMES: string = String.fromCodePoint(0x2062);
const ENCLOSURE_INLINE_PADDING: number = 0.4;
const ENCLOSURE_BLOCK_PADDING: number = 0.5;
const ARROW_LENGTH: number = 6;
const ARROW_HALF_WIDTH: number = 2.5;
const KAPPA: number = 4 * (Math.SQRT2 - 1) / 3;
const LEFT: number = 0;
const RIGHT: number = 1;
const TOP: number = 2;
const BOTTOM: number = 3;
const ARROWS: ReadonlyMap<string, readonly [number, number, number, number, boolean]> = new Map<string, readonly [number, number, number, number, boolean]>([
    ["uparrow", [0.5, 1, 0.5, 0, false]], ["downarrow", [0.5, 0, 0.5, 1, false]], ["rightarrow", [0, 0.5, 1, 0.5, false]], ["leftarrow", [1, 0.5, 0, 0.5, false]],
    ["northeastarrow", [0, 1, 1, 0, false]], ["northwestarrow", [1, 1, 0, 0, false]], ["southeastarrow", [0, 0, 1, 1, false]], ["southwestarrow", [1, 0, 0, 1, false]],
    ["updownarrow", [0.5, 1, 0.5, 0, true]], ["leftrightarrow", [0, 0.5, 1, 0.5, true]], ["northwestsoutheastarrow", [0, 0, 1, 1, true]],
    ["northeastsouthwestarrow", [0, 1, 1, 0, true]]
]);
const NO_METRICS: FaceMetrics = {
    unitsPerEm: 1, bounds: [0, 0, 0, 0], horizontal: { ascender: 0, descender: 0, lineGap: 0 }, useTypographic: false, italicAngle: 0, fixedPitch: false, weightClass: 400,
    widthClass: 5, selection: 0, macStyle: 0
};

export class MathLayout {

    private readonly host: BlockLayout;
    private readonly sizes: BoxSizes;
    private readonly metrics: FontMetrics;
    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private readonly dictionary: MathOperators = new MathOperators();
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly bidi: UnicodeBidi = new UnicodeBidi();
    private readonly noTable: MathTable = new MathTable();
    private readonly operators: WeakMap<ElementBox, Operator> = new WeakMap<ElementBox, Operator>();
    private readonly cores: WeakMap<ElementBox, ElementBox | null> = new WeakMap<ElementBox, ElementBox | null>();
    private readonly shapers: WeakMap<Typeface, FeatureShaper> = new WeakMap<Typeface, FeatureShaper>();
    readonly graphics: WeakMap<BoxFragment, MathGraphics> = new WeakMap<BoxFragment, MathGraphics>();
    private readonly elements: WeakMap<ElementBox, MathElement>;
    private readonly tables: WeakMap<Typeface, MathTable> = new WeakMap<Typeface, MathTable>();
    private target: number = 0;

    constructor(host: BlockLayout, sizes: BoxSizes, metrics: FontMetrics, elements: WeakMap<ElementBox, MathElement>) {
        this.host = host;
        this.sizes = sizes;
        this.metrics = metrics;
        this.elements = elements;
    }

    private mathTable(instance: FontInstance): MathTable {
        // OpenType MATH: the table of the typeface, read once.
        let table: MathTable | undefined = this.tables.get(instance.typeface);
        if (table === undefined) {
            table = new MathTable(instance.typeface.tables["MATH"]);
            this.tables.set(instance.typeface, table);
        }
        return table;
    }

    private data(box?: ElementBox): MathElement | undefined {
        // The MathML element of each box of the formula, read by the box builder of the formula.
        return box === undefined ? undefined : this.elements.get(box);
    }

    private isMath(box: ElementBox): boolean {
        // MathML Core §4.1: MathML elements with display block math or inline math "control box generation and layout
        // according to their tag name".
        return this.data(box) !== undefined && box.display.inner === "math" && box.display.box === undefined && !box.replaced;
    }

    formula(box: ElementBox, sizes: UsedSizes, available?: number): BoxFragment {
        // §2.1.1: block <math> "is rendered horizontally centered within the content box", the space available to it; inline
        // math takes its own width, and lines broken in either take the available width (MathML 4 §3.1.7).
        this.target = available ?? 0;
        this.assign(box, undefined, []);
        let content: MathContent = this.content(box);
        const lines: MathContent | undefined = this.broken(box, content, available ?? Number.POSITIVE_INFINITY);
        const block: boolean = box.display.outer === "block";
        if (lines !== undefined) {
            content = lines;
        } else if (block) {
            content.centered = true;
        }
        return this.wrap(box, content, sizes, block || lines !== undefined ? Math.max(available ?? 0, content.width) : undefined, 0);
    }

    private wrap(box: ElementBox, content: MathContent, sizes: UsedSizes, inlineSize: number | undefined, inlineOffset: number): BoxFragment {
        // §3.1.2: the content box takes the metrics of the math content box unless width, height or the related properties
        // give it another size, and then their inline-start and block-start edges are aligned.
        const contentInline: number = inlineSize ?? this.clamped(sizes.inlineSize ?? content.width, sizes.minInlineSize, sizes.maxInlineSize);
        const contentBlock: number = this.clamped(sizes.blockSize ?? content.ascent + content.descent, sizes.minBlockSize, sizes.maxBlockSize);
        const shift: number = content.centered === true ? (contentInline - content.width) / 2 : 0;
        const frame: number = this.sizes.frame(box.style);
        for (const child of content.children) {
            if (child.kind !== "box") {
                child.inline = (child.inline ?? 0) + shift;
                continue;
            }
            // CSS Position 3 §3.5.1: a relatively positioned child is moved from where the math layout put it.
            const moved: readonly [number, number] | undefined = this.sizes.relativeShift(child.box.style, contentInline, contentBlock, frame);
            child.inline += shift + (moved === undefined ? 0 : moved[0]);
            child.block += moved === undefined ? 0 : moved[1];
        }
        const glyphs: Array<MathGlyph> = (content.glyphs ?? []).map((glyph: MathGlyph): MathGlyph => ({ ...glyph, inline: glyph.inline + shift }));
        const rules: Array<MathRule> = (content.rules ?? []).map((rule: MathRule): MathRule => ({ ...rule, inline: rule.inline + shift }));
        const paths: Array<MathPath> = (content.paths ?? []).map((path: MathPath): MathPath => this.movedPath(path, shift, 0));
        if (content.bar !== undefined) {
            // §3.3.2.1: "The inline size of the fraction bar is the inline size of the content box".
            rules.push({ inline: 0, block: content.bar[0] - content.bar[1] / 2, inlineSize: contentInline, blockSize: content.bar[1] });
        }
        const blockStart: number = this.sizes.edges(sizes, BoxSizes.BLOCK_START);
        const fragment: BoxFragment = {
            kind: "box", box, inline: inlineOffset, block: 0, inlineSize: contentInline + this.sizes.edges(sizes, BoxSizes.INLINE_START) + this.sizes.edges(sizes, BoxSizes.INLINE_END),
            blockSize: contentBlock + blockStart + this.sizes.edges(sizes, BoxSizes.BLOCK_END), firstBaseline: blockStart + content.ascent, baseline: blockStart + content.ascent
        };
        if (sizes.border !== undefined) {
            fragment.border = sizes.border;
        }
        if (sizes.padding !== undefined) {
            fragment.padding = sizes.padding;
        }
        if (content.children.length > 0) {
            fragment.children = content.children;
        }
        // The glyphs, bars and strokes of the fragment are painted by the formula's painter, which finds them here.
        const graphics: MathGraphics = {};
        if (glyphs.length > 0) {
            graphics.glyphs = glyphs;
        }
        if (rules.length > 0) {
            graphics.rules = rules;
        }
        if (paths.length > 0) {
            graphics.paths = paths;
        }
        if (graphics.glyphs !== undefined || graphics.rules !== undefined || graphics.paths !== undefined) {
            this.graphics.set(fragment, graphics);
        }
        return fragment;
    }

    private broken(box: ElementBox, whole: MathContent, inlineSize: number): MathContent | undefined {
        // MathML 4 §3.1.7.1: breaks at mo and mspace, forced or when too wide with overflow linebreak; §2.2.1 breaks math
        // "as if it were a sequence of words in normal text", so each line takes what fits, as CSS Text 3 fills lines.
        const math: MathElement = this.data(box) as MathElement;
        // Without a width to fit, only forced breaks break, and the lines are as wide as the widest of them.
        const width: number = math.maxWidth ?? (Number.isFinite(inlineSize) ? inlineSize : whole.width);
        const items: Array<ElementBox> = this.breakItems(this.inFlow(box));
        const forced: boolean = items.some((item: ElementBox) => this.breakMode(item) === "newline");
        if (!forced && (math.overflow !== "linebreak" || whole.width <= width + TOLERANCE)) {
            return undefined;
        }
        const laid: Array<Laid> = items.map((item: ElementBox): Laid => this.laid(item));
        const advance: (index: number) => number = (index: number): number => {
            const operator: Operator | undefined = laid[index].operator;
            return laid[index].width + (operator === undefined ? 0 : operator.lspace + operator.rspace);
        };
        // Each line runs from a start to an end item; a break at an operator puts it first on the next line (before), last on
        // this one (after) or on both (duplicate), by linebreakstyle of §3.2.6.2.2.
        const ranges: Array<readonly [number, number, number]> = [];
        let start: number = 0;
        let opener: number = -1;
        while (start < items.length) {
            let used: number = 0;
            let fit: number = start;
            let best: number = -1;
            let rank: number = 0;
            let cut: number = -1;
            for (let index: number = start; index < items.length; index++) {
                const mode: string | undefined = this.breakMode(items[index]);
                if (index > start && mode === "newline") {
                    cut = index;
                    break;
                }
                if (index > start && mode !== undefined && mode !== "nobreak") {
                    const value: number = mode === "goodbreak" ? 3 : (mode === "badbreak" ? 1 : 2);
                    if (value >= rank) {
                        best = index;
                        rank = value;
                    }
                }
                used += advance(index);
                if (used > width + TOLERANCE && index > start) {
                    cut = best >= 0 ? best : -1;
                    break;
                }
                fit = index;
            }
            if (cut < 0 && fit === items.length - 1) {
                ranges.push([start, items.length, opener]);
                break;
            }
            if (cut < 0) {
                // No break point fits: the line goes on to the next one there is, or to the end.
                cut = items.findIndex((item: ElementBox, index: number) => index > fit && this.breakMode(item) !== undefined && this.breakMode(item) !== "nobreak");
                if (cut < 0) {
                    ranges.push([start, items.length, opener]);
                    break;
                }
            }
            const style: string = this.data(items[cut])?.lineBreakStyle ?? "before";
            ranges.push([start, style === "before" ? cut : cut + 1, opener]);
            start = style === "after" ? cut + 1 : cut;
            opener = cut;
        }
        return this.lineContent(box, items, laid, ranges, width);
    }

    private breakItems(boxes: ReadonlyArray<ElementBox>): Array<ElementBox> {
        // §3.1.7.1: the breaks are within mrow, inferred ones included, so the children of the rows are the items of the lines.
        const items: Array<ElementBox> = [];
        for (const child of boxes) {
            if (this.isMath(child) && child.element !== undefined && (this.data(child)?.name === "mrow" || this.data(child)?.name === "mstyle") && this.core(child) === undefined) {
                items.push(...this.breakItems(this.inFlow(child)));
            } else {
                items.push(child);
            }
        }
        return items;
    }

    private breakMode(item: ElementBox): string | undefined {
        const name: string | undefined = this.isMath(item) ? this.data(item)?.name : undefined;
        if (name === "mspace") {
            return this.data(item)?.lineBreak ?? "auto";
        }
        const core: ElementBox | undefined = this.core(item);
        return core === undefined || core !== item ? undefined : this.data(core)?.lineBreak ?? "auto";
    }

    private lineContent(box: ElementBox, items: ReadonlyArray<ElementBox>, laid: ReadonlyArray<Laid>, ranges: ReadonlyArray<readonly [number, number, number]>,
        width: number): MathContent {
        // §3.2.6.2.3: auto indents as CSS does by default, by nothing; §3.2.6.2.2: lineleading is the space after a break,
        // 100% being the font's normal line height.
        const math: MathElement = this.data(box) as MathElement;
        const content: MathContent = { width, ascent: 0, descent: 0, inkAscent: 0, inkDescent: 0, children: [] };
        const normal: number = this.metrics.lineHeight(box.style.values);
        const placed: Array<readonly [ElementBox, number]> = [];
        let baseline: number = 0;
        let previousDescent: number = 0;
        ranges.forEach(([from, to, opener]: readonly [number, number, number], line: number) => {
            const pieces: Array<Laid> = [];
            const shown: Array<Shaped | undefined> = [];
            for (let index: number = from; index < to; index++) {
                // A duplicated operator is laid out again for the next line; §3.2.6.2.2: linebreakmultchar shows an invisible
                // times where a line breaks at it.
                const atBreak: boolean = (index === opener && line > 0) || (index === to - 1 && ranges[line + 1]?.[2] === index);
                pieces.push(index === opener && line > 0 && ranges[line - 1][1] > opener ? this.laid(items[index]) : laid[index]);
                shown.push(atBreak && this.operatorText(items[index]) === INVISIBLE_TIMES
                    ? this.separator(items[index], this.data(items[index])?.lineBreakMultchar ?? INVISIBLE_TIMES) : undefined);
            }
            let offset: number = 0;
            let ascent: number = 0;
            let descent: number = 0;
            const offsets: Array<number> = [];
            pieces.forEach((piece: Laid, index: number) => {
                const glyph: Shaped | undefined = shown[index];
                offset += piece.operator?.lspace ?? 0;
                offsets.push(offset);
                offset += (glyph?.width ?? piece.width) + (piece.operator?.rspace ?? 0);
                ascent = Math.max(ascent, glyph?.ascent ?? piece.ascent);
                descent = Math.max(descent, glyph?.descent ?? piece.descent);
            });
            const source: MathElement | undefined = line === 0 ? math : this.data(items[opener]);
            const last: boolean = line > 0 && line === ranges.length - 1;
            const align: string = line === 0 ? source?.indentAlignFirst ?? "auto" : (last ? source?.indentAlignLast : source?.indentAlign) ?? "auto";
            const shiftValue: CssValue | undefined = line === 0 ? source?.indentShiftFirst : (last ? source?.indentShiftLast : source?.indentShift);
            const shift: number = shiftValue === undefined ? 0 : this.sizes.pixels(shiftValue, width);
            let x: number = shift;
            if (align === "center") {
                x = (width - offset) / 2 + shift;
            } else if (align === "right") {
                x = width - offset + shift;
            } else if (align === "id") {
                // "Align the left side of the next line to the left side of the element", its first element's box, as the
                // figure of §3.1.7.2 puts = under =.
                const target: readonly [ElementBox, number] | undefined = placed.find((entry: readonly [ElementBox, number]) =>
                    entry[0].element?.getAttributeValue("id") === source?.indentTarget || entry[0].element?.getAttributeValue("xml:id") === source?.indentTarget);
                x = (target === undefined ? 0 : target[1] - offsets[0] - (pieces[0]?.start ?? 0)) + shift;
            }
            if (line === 0) {
                baseline = ascent;
                content.ascent = ascent;
            } else {
                const leading: CssValue | undefined = source?.lineLeading;
                const spacing: number = leading === undefined ? normal : this.sizes.pixels(leading, normal);
                baseline += Math.max(previousDescent + ascent, spacing);
            }
            pieces.forEach((piece: Laid, index: number) => {
                const glyph: Shaped | undefined = shown[index];
                if (glyph === undefined) {
                    this.place(content.children, piece, x + offsets[index], baseline);
                    placed.push([piece.box, x + offsets[index] + piece.start]);
                    return;
                }
                content.glyphs = [...(content.glyphs ?? []), ...glyph.glyphs.map((one: MathGlyph): MathGlyph => ({ ...one, inline: one.inline + x + offsets[index],
                    baseline: one.baseline + baseline }))];
            });
            previousDescent = descent;
            content.width = Math.max(content.width, x + offset);
        });
        content.descent = baseline + previousDescent - content.ascent;
        content.inkAscent = content.ascent;
        content.inkDescent = content.descent;
        return content;
    }

    private cellAlignment(box: ElementBox): number {
        // CSS Text 3 §6.1: start and end follow the direction, left and right do not; justify has no effect on one math box.
        const rtl: boolean = this.keyword(box, "direction") === "rtl";
        switch (this.keyword(box, "text-align-all")) {
            case "center":
                return 0.5;
            case "end":
                return 1;
            case "left":
                return rtl ? 1 : 0;
            case "right":
                return rtl ? 0 : 1;
            default:
                return 0;
        }
    }

    private laid(box: ElementBox, stretch?: Stretch): Laid {
        // §3.1.2: the metrics of the padding, border and margin boxes follow from those of the content box; a line-over or
        // line-under border moves the ink baseline of its side to the edge of the border box.
        if (!this.isMath(box)) {
            return this.css(box);
        }
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        const content: MathContent = this.content(box, stretch);
        const fragment: BoxFragment = this.wrap(box, content, sizes, undefined, 0);
        this.host.contain(fragment);
        const contentInline: number = fragment.inlineSize - this.sizes.edges(sizes, BoxSizes.INLINE_START) - this.sizes.edges(sizes, BoxSizes.INLINE_END);
        const contentBlock: number = fragment.blockSize - this.sizes.edges(sizes, BoxSizes.BLOCK_START) - this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const top: number = this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0;
        const bottom: number = this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0;
        const start: number = this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0;
        const end: number = this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0;
        const over: number = this.sizes.edges(sizes, BoxSizes.BLOCK_START);
        const under: number = contentBlock - content.ascent + this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const laid: Laid = {
            box, fragment, start, top, width: start + fragment.inlineSize + end, ascent: content.ascent + over + top, descent: under + bottom,
            inkAscent: this.side(BoxSizes.BLOCK_START, sizes.border) > 0 ? content.ascent + over : content.inkAscent,
            inkDescent: this.side(BoxSizes.BLOCK_END, sizes.border) > 0 ? under : content.inkDescent
        };
        if (content.italic !== undefined) {
            laid.italic = content.italic + this.sizes.edges(sizes, BoxSizes.INLINE_END) + end;
        }
        if (content.accent !== undefined) {
            const shift: number = content.centered === true ? (contentInline - content.width) / 2 : 0;
            laid.accent = content.accent + shift + this.sizes.edges(sizes, BoxSizes.INLINE_START) + start;
        }
        const operator: Operator | undefined = this.operatorFor(box);
        if (operator !== undefined) {
            laid.operator = operator;
        }
        return laid;
    }

    private css(box: ElementBox): Laid {
        // A child that is not laid out as math is a CSS box at its max-content size; without a baseline its line-under margin
        // edge is one (CSS Inline 3 §4.1).
        if (this.data(box)?.name === "mtable") {
            return this.table(box);
        }
        const placed: readonly [BoxFragment, number] = this.host.atomic(box, this.host.intrinsic(box)[1]);
        const fragment: BoxFragment = placed[0];
        const top: number = this.marginOf(fragment.marginBefore);
        const height: number = top + fragment.blockSize + this.marginOf(fragment.marginAfter);
        const ascent: number = fragment.firstBaseline === undefined ? height : top + fragment.firstBaseline;
        return { box, fragment, start: fragment.inline, top, width: placed[1], ascent, descent: height - ascent, inkAscent: ascent, inkDescent: height - ascent };
    }

    private table(box: ElementBox): Laid {
        // MathML Core §3.5.1 lays an mtable out as a CSS table of its mtr rows and mtd cells; MathML 4 §3.5.1.2 adds attributes
        // that the cells carry as CSS (alignments, spacings, lines) and the table as data (align, equal rows and columns, fit).
        const math: MathElement = this.data(box) as MathElement;
        // MathML 4 §3.5.1.2: a percentage width is "relative to the horizontal space that a MathML renderer has available".
        const sizes: UsedSizes = this.sizes.of(box.style, this.target, undefined, 0);
        const inlineEdges: number = this.sizes.edges(sizes, BoxSizes.INLINE_START) + this.sizes.edges(sizes, BoxSizes.INLINE_END);
        const cells: Array<TableCell> = this.tableCells(box, sizes.inlineSize);
        const rowCount: number = cells.reduce((count: number, cell: TableCell) => Math.max(count, cell.row + cell.rows), 0);
        const columnCount: number = cells.reduce((count: number, cell: TableCell) => Math.max(count, cell.column + cell.columns), 0);
        const columns: Float64Array = this.columnWidths(math, sizes.inlineSize ?? this.target - inlineEdges, sizes.inlineSize !== undefined, cells, columnCount);
        const rows: Array<TableRow> = this.rowHeights(math, cells, rowCount);
        const starts: Float64Array = new Float64Array(columnCount + 1);
        for (let column: number = 0; column < columnCount; column++) {
            starts[column + 1] = starts[column] + columns[column];
        }
        const tops: Float64Array = new Float64Array(rowCount + 1);
        for (let row: number = 0; row < rowCount; row++) {
            tops[row + 1] = tops[row] + rows[row].height;
        }
        // Not mirrored for rtl: the frame of the direction already reverses the inline axis when the formula is painted.
        const children: Array<BoxFragment | LineFragment> = cells.map((cell: TableCell): BoxFragment =>
            this.cellFragment(cell, starts[cell.column], tops[cell.row], starts[cell.column + cell.columns] - starts[cell.column], tops[cell.row + cell.rows] - tops[cell.row], rows[cell.row]));
        const blockStart: number = this.sizes.edges(sizes, BoxSizes.BLOCK_START);
        const height: number = blockStart + tops[rowCount] + this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const fragment: BoxFragment = { kind: "box", box, inline: 0, block: 0, inlineSize: starts[columnCount] + inlineEdges, blockSize: height, children };
        if (sizes.border !== undefined) {
            fragment.border = sizes.border;
        }
        if (sizes.padding !== undefined) {
            fragment.padding = sizes.padding;
        }
        const top: number = this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0;
        const start: number = this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0;
        const whole: number = top + height + (this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0);
        const ascent: number = this.tableAscent(box, math, top, blockStart, tops, rows, height);
        return {
            box, fragment, start, top, width: start + fragment.inlineSize + (this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0), ascent, descent: whole - ascent,
            inkAscent: ascent, inkDescent: whole - ascent
        };
    }

    private tableCells(box: ElementBox, tableWidth: number | undefined): Array<TableCell> {
        // The row, column and spans of each cell, the slots that row spans of rows above take skipped, as HTML's algorithm for
        // processing rows does; MathML Core §3.5.3: a row span of zero spans to the end of the table.
        const rows: Array<ElementBox> = this.inFlow(box).filter((child: ElementBox) => this.data(child)?.name === "mtr");
        const covered: Array<number> = [];
        const cells: Array<TableCell> = [];
        rows.forEach((row: ElementBox, index: number) => {
            let column: number = 0;
            for (const cell of this.inFlow(row).filter((child: ElementBox) => this.data(child)?.name === "mtd")) {
                while ((covered[column] ?? 0) > 0) {
                    column++;
                }
                const spans: readonly [number, number] = cell.spans ?? [1, 1];
                const rowSpan: number = spans[1] === 0 ? rows.length - index : spans[1];
                // §3.5.1.2: a percentage columnwidth "is relative to the width of the table".
                const sizes: UsedSizes = this.sizes.of(cell.style, tableWidth, undefined, 0);
                const content: ElementBox | undefined = this.inFlow(cell)[0];
                const entry: TableCell = { box: cell, row: index, column, rows: rowSpan, columns: spans[0], sizes };
                if (content !== undefined) {
                    entry.content = this.laid(content);
                }
                cells.push(entry);
                for (let next: number = column; next < column + spans[0]; next++) {
                    covered[next] = rowSpan;
                }
                column += spans[0];
            }
            for (let next: number = 0; next < covered.length; next++) {
                covered[next] = Math.max(0, (covered[next] ?? 0) - 1);
            }
        });
        return cells;
    }

    private cellWidth(cell: TableCell): number {
        // §3.5.1.2: "an explicit length means that the column is exactly that wide and the contents of that column are made to
        // fit by linewrapping or clipping"; auto columns are as wide as needed.
        const edges: number = this.sizes.edges(cell.sizes, BoxSizes.INLINE_START) + this.sizes.edges(cell.sizes, BoxSizes.INLINE_END);
        return (cell.sizes.inlineSize ?? cell.content?.width ?? 0) + edges;
    }

    private columnWidths(math: MathElement, width: number, given: boolean, cells: ReadonlyArray<TableCell>, count: number): Float64Array {
        // CSS 2 §17.5.2.2: each column as wide as its widest cell, the cells spanning columns widening them equally; MathML 4
        // §3.5.1.2: equalcolumns makes them all as wide as the widest.
        const widths: Float64Array = new Float64Array(count);
        for (const cell of cells.filter((entry: TableCell) => entry.columns === 1)) {
            widths[cell.column] = Math.max(widths[cell.column], this.cellWidth(cell));
        }
        for (const cell of cells.filter((entry: TableCell) => entry.columns > 1)) {
            let spanned: number = 0;
            for (let column: number = cell.column; column < cell.column + cell.columns; column++) {
                spanned += widths[column];
            }
            const extra: number = (this.cellWidth(cell) - spanned) / cell.columns;
            for (let column: number = cell.column; extra > 0 && column < cell.column + cell.columns; column++) {
                widths[column] += extra;
            }
        }
        if (math.equalColumns === true && count > 0) {
            widths.fill(Math.max(...widths));
        }
        const fits: ReadonlyArray<string> | undefined = math.columnWidths;
        const total: number = widths.reduce((sum: number, size: number) => sum + size, 0);
        const room: number = width - total;
        if (room <= 0 || count === 0) {
            return widths;
        }
        const fitting: Array<number> = Array.from(widths.keys()).filter((column: number) => fits !== undefined && fits[Math.min(column, fits.length - 1)] === "fit");
        if (fitting.length > 0) {
            // §3.5.1.2: "the page width remaining after subtracting the auto or fixed width columns is divided equally among the
            // fit columns", so each ends up with the same width whatever it holds.
            const share: number = (room + fitting.reduce((sum: number, column: number) => sum + widths[column], 0)) / fitting.length;
            for (const column of fitting) {
                widths[column] = share;
            }
            return widths;
        }
        const constrained: Uint8Array = new Uint8Array(count);
        for (const cell of cells) {
            if (cell.columns === 1 && cell.sizes.inlineSize !== undefined) {
                constrained[cell.column] = 1;
            }
        }
        // CSS Tables 3 §3.9.3.2, "Distributing excess width to columns": the first rule whose columns exist decides, by width or equally.
        const rules: ReadonlyArray<readonly [(column: number) => boolean, boolean]> = [
            [(column: number): boolean => given && constrained[column] === 0 && widths[column] > 0, true],
            [(column: number): boolean => given && constrained[column] === 0, false], [(column: number): boolean => given && widths[column] > 0, true],
            [(): boolean => given, false]
        ];
        for (const [applies, proportional] of rules) {
            const chosen: Array<number> = Array.from(widths.keys()).filter(applies);
            if (chosen.length === 0) {
                continue;
            }
            const sum: number = chosen.reduce((current: number, column: number) => current + widths[column], 0);
            for (const column of chosen) {
                widths[column] += proportional ? room * widths[column] / sum : room / chosen.length;
            }
            break;
        }
        return widths;
    }

    private rowHeights(math: MathElement, cells: ReadonlyArray<TableCell>, count: number): Array<TableRow> {
        // CSS 2 §17.5.3: the cells aligned on the baseline share the row's baseline, the others fit the row's height; MathML 4
        // §3.5.1.2: rowalign axis "aligns the axis of each cells", on the highest axis of the row's cells above its baseline.
        const rows: Array<TableRow> = [];
        for (let row: number = 0; row < count; row++) {
            const starting: Array<TableCell> = cells.filter((cell: TableCell) => cell.row === row);
            const axis: number = Math.max(0, ...starting.map((cell: TableCell) => this.cellAxis(cell) ?? 0));
            let above: number = 0;
            let below: number = 0;
            let height: number = 0;
            for (const cell of starting) {
                const [ascent, descent]: readonly [number, number] = this.cellExtent(cell);
                const raise: number = this.cellAxis(cell) === undefined ? 0 : axis - (this.cellAxis(cell) as number);
                if (this.verticalAlign(cell) === "baseline") {
                    above = Math.max(above, ascent + raise);
                    below = cell.rows === 1 ? Math.max(below, descent - raise) : below;
                } else if (cell.rows === 1) {
                    height = Math.max(height, ascent + descent);
                }
            }
            rows.push({ height: Math.max(height, above + below), baseline: above, axis });
        }
        // CSS 2 §17.5.3: "the sum of the row heights involved must be great enough to encompass the cell spanning the rows",
        // the missing height shared by those rows as a cell spanning columns shares its width.
        for (const cell of cells.filter((entry: TableCell) => entry.rows > 1)) {
            const [ascent, descent]: readonly [number, number] = this.cellExtent(cell);
            const first: TableRow = rows[cell.row];
            const raise: number = this.cellAxis(cell) === undefined ? 0 : first.axis - (this.cellAxis(cell) as number);
            const needed: number = this.verticalAlign(cell) === "baseline" ? first.baseline - raise + descent : ascent + descent;
            let spanned: number = 0;
            for (let row: number = cell.row; row < cell.row + cell.rows; row++) {
                spanned += rows[row].height;
            }
            for (let row: number = cell.row; needed > spanned && row < cell.row + cell.rows; row++) {
                rows[row].height += (needed - spanned) / cell.rows;
            }
        }
        if (math.equalRows === true && count > 0) {
            // §3.5.1.2: equalrows forces "all rows to have the same total height"; a row keeps its baseline from its top.
            const tallest: number = Math.max(...rows.map((row: TableRow) => row.height));
            for (const row of rows) {
                row.height = tallest;
            }
        }
        return rows;
    }

    private cellExtent(cell: TableCell): readonly [number, number] {
        const ascent: number = this.sizes.edges(cell.sizes, BoxSizes.BLOCK_START) + (cell.content?.ascent ?? 0);
        const descent: number = (cell.content?.descent ?? 0) + this.sizes.edges(cell.sizes, BoxSizes.BLOCK_END);
        return [ascent, Math.max(descent, (cell.sizes.blockSize ?? 0) - (cell.content?.ascent ?? 0))];
    }

    private cellAxis(cell: TableCell): number | undefined {
        return this.data(cell.box)?.axisAligned === true && cell.content !== undefined ? this.constants(cell.content.box).axisHeight : undefined;
    }

    private verticalAlign(cell: TableCell): string {
        // CSS Inline 3 §4.2: on table cells top and bottom come from baseline-shift, and middle from alignment-baseline.
        const shift: string = this.keyword(cell.box, "baseline-shift");
        if (shift === "top" || shift === "bottom") {
            return shift;
        }
        return this.keyword(cell.box, "alignment-baseline") === "middle" ? "middle" : "baseline";
    }

    private cellFragment(cell: TableCell, inline: number, block: number, width: number, height: number, row: TableRow): BoxFragment {
        // The cell fills its slots, and its content takes the cell's text-align across and its vertical-align down.
        const fragment: BoxFragment = { kind: "box", box: cell.box, inline, block, inlineSize: width, blockSize: height, children: [] };
        if (cell.sizes.border !== undefined) {
            fragment.border = cell.sizes.border;
        }
        if (cell.sizes.padding !== undefined) {
            fragment.padding = cell.sizes.padding;
        }
        const content: Laid | undefined = cell.content;
        if (content === undefined) {
            return fragment;
        }
        const startEdge: number = this.sizes.edges(cell.sizes, BoxSizes.INLINE_START);
        const topEdge: number = this.sizes.edges(cell.sizes, BoxSizes.BLOCK_START);
        const innerWidth: number = width - startEdge - this.sizes.edges(cell.sizes, BoxSizes.INLINE_END);
        const innerHeight: number = height - topEdge - this.sizes.edges(cell.sizes, BoxSizes.BLOCK_END);
        const across: number = (innerWidth - content.width) * this.cellAlignment(content.box);
        const align: string = this.verticalAlign(cell);
        const raise: number = this.cellAxis(cell) === undefined ? 0 : row.axis - (this.cellAxis(cell) as number);
        let down: number = row.baseline - raise - topEdge - content.ascent;
        if (align === "top") {
            down = 0;
        } else if (align === "bottom") {
            down = innerHeight - content.ascent - content.descent;
        } else if (align === "middle") {
            down = (innerHeight - content.ascent - content.descent) / 2;
        }
        this.place(fragment.children as Array<BoxFragment | LineFragment>, content, across, down + content.ascent);
        return fragment;
    }

    private tableAscent(box: ElementBox, math: MathElement, top: number, blockStart: number, tops: Float64Array, rows: ReadonlyArray<TableRow>, height: number): number {
        // MathML 4 §3.5.1.2: axis centers the table on the math axis, center and baseline center it on the baseline, top and
        // bottom put those edges there; with a row number that row is aligned, by "the row's baseline or axis" for those two.
        const align: string = math.tableAlign ?? "axis";
        let start: number = top;
        let size: number = height;
        let baseline: number | undefined;
        let axisLine: number | undefined;
        const axis: number = this.constants(box).axisHeight;
        const row: number | undefined = math.alignRow === undefined ? undefined : math.alignRow - 1;
        if (row !== undefined && row >= 0 && row < rows.length) {
            start = top + blockStart + tops[row];
            size = rows[row].height;
            baseline = start + rows[row].baseline;
            axisLine = baseline - (rows[row].axis > 0 ? rows[row].axis : axis);
        }
        switch (align) {
            case "top":
                return start;
            case "bottom":
                return start + size;
            case "center":
                return start + size / 2;
            case "baseline":
                return baseline ?? start + size / 2;
            default:
                return (axisLine ?? start + size / 2) + axis;
        }
    }

    private content(box: ElementBox, stretch?: Stretch): MathContent {
        // §3.2.4.2: the form of an embellished operator depends on its place among its siblings, and the operators on the
        // embellished path of the box keep the properties that the outermost embellished operator gave them.
        const children: Array<ElementBox> = this.inFlow(box);
        const path: ElementBox | undefined = this.pathChild(box, children);
        for (const child of children) {
            if (child !== path) {
                this.assign(child, box, children);
            }
        }
        const content: MathContent = this.layoutOf(box, children, stretch);
        for (const node of box.children) {
            if (node.kind === "box" && node.placement !== "in-flow") {
                content.children.push(this.outOfFlow(node));
            }
        }
        return content;
    }

    private outOfFlow(box: ElementBox): BoxFragment {
        // §3.1.2: absolutely and fixed positioned boxes are laid out "as described by" CSS Position 3, from where the math
        // content box starts.
        return box.placement === "running" ? this.host.emptyPlace(box, 0) : this.host.placeholder(box);
    }

    private layoutOf(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        const name: string = (this.data(box) as MathElement).name;
        if (TOKENS.has(name)) {
            return this.token(box);
        }
        switch (name) {
            case "mo":
                return this.operator(box, stretch);
            case "mspace":
                return this.space(box);
            case "mfrac":
                return this.fraction(box, children, stretch);
            case "msqrt":
                return this.squareRoot(box, children);
            case "mroot":
                return children.length === 2 ? this.root(box, children) : this.rowOf(box, children, stretch);
            case "mpadded":
                return this.padded(box, children, stretch);
            case "menclose":
                return this.enclosed(box, children, stretch);
            case "mstack":
                return this.stack(box, children);
            case "mlongdiv":
                return children.length < 2 ? this.rowOf(box, children, stretch) : this.longDivision(box, children);
            case "msub":
                return this.scripts(box, children, stretch, SUBSCRIPT);
            case "msup":
                return this.scripts(box, children, stretch, SUPERSCRIPT);
            case "msubsup":
                return this.scripts(box, children, stretch, BOTH_SCRIPTS);
            case "munder":
            case "mover":
            case "munderover":
                return this.limits(box, children, stretch);
            case "mmultiscripts":
                return this.multiscripts(box, children, stretch);
            default:
                return this.rowOf(box, children, stretch);
        }
    }

    private token(box: ElementBox): MathContent {
        // §3.2.1.1: text "without forced line break or soft wrap opportunity" is measured by its ink, with the italic correction
        // and the top accent attachment of a single glyph; other content is laid out as a block box.
        const inlineSize: number = this.host.blockContentSizes(box)[1];
        const laid: BoxFragment = this.host.blockContent(box, inlineSize);
        const children: Array<BoxFragment | LineFragment> = laid.children ?? [];
        const line: BoxFragment | LineFragment | undefined = children.length === 1 ? children[0] : undefined;
        if (line === undefined || line.kind !== "line" || !this.isPlainText(box)) {
            const ascent: number = laid.firstBaseline ?? laid.blockSize;
            return { width: inlineSize, ascent, descent: laid.blockSize - ascent, inkAscent: ascent, inkDescent: laid.blockSize - ascent, children };
        }
        const text: InlineText = line.sequence.text as InlineText;
        const baseline: number = line.block + line.baseline;
        let top: number = Number.POSITIVE_INFINITY;
        let bottom: number = Number.NEGATIVE_INFINITY;
        let count: number = 0;
        let single: readonly [FontInstance, number, number] | undefined;
        for (const piece of line.pieces) {
            if (piece.kind !== "text") {
                continue;
            }
            const scale: number = piece.run.size / piece.run.font.metrics.unitsPerEm;
            for (let glyph: number = piece.from; glyph < piece.to; glyph++) {
                count++;
                single = [piece.run.font, text.glyphs[glyph], scale];
                const bounds: OutlineBounds | undefined = this.outlines.bounds(piece.run.font, text.glyphs[glyph]);
                if (bounds !== undefined) {
                    const y: number = line.block + piece.baseline - (text.yOffsets?.[glyph] ?? 0);
                    top = Math.min(top, y - bounds.yMax * scale);
                    bottom = Math.max(bottom, y - bounds.yMin * scale);
                }
            }
        }
        const inkAscent: number = top === Number.POSITIVE_INFINITY ? 0 : baseline - top;
        const inkDescent: number = bottom === Number.NEGATIVE_INFINITY ? 0 : bottom - baseline;
        this.lower(children, inkAscent - baseline);
        const content: MathContent = { width: inlineSize, ascent: inkAscent, descent: inkDescent, inkAscent, inkDescent, children };
        if (count === 1 && single !== undefined) {
            const table: MathTable = this.mathTable(single[0]);
            const italic: number | undefined = table.italicsCorrection(single[1]);
            const accent: number | undefined = table.topAccentAttachment(single[1]);
            if (italic !== undefined) {
                content.italic = italic * single[2];
            }
            if (accent !== undefined) {
                content.accent = accent * single[2];
            }
        }
        return content;
    }

    private isPlainText(box: ElementBox): boolean {
        if (!box.children.every((node: BoxNode) => node.kind === "text") || box.inline === undefined || box.inline.length !== 1) {
            return false;
        }
        const text: InlineText | undefined = box.inline[0].text;
        if (text === undefined) {
            return false;
        }
        for (let position: number = 1; position < text.codepoints.length; position++) {
            if (text.breaks[position] !== LineBreaker.NONE) {
                return false;
            }
        }
        return true;
    }

    private lower(children: ReadonlyArray<BoxFragment | LineFragment>, distance: number): void {
        for (const child of children) {
            child.block += distance;
        }
    }

    private operator(box: ElementBox, stretch?: Stretch): MathContent {
        // §3.2.4.3 of the Editor's Draft: a single character that the first available font has a glyph for stretches along
        // its axis, or is drawn large; everything else is laid out as text.
        const text: string | undefined = this.operatorText(box);
        const code: number | undefined = text !== undefined && [...text].length === 1 ? text.codePointAt(0) : undefined;
        const found: readonly [FontInstance, number] | undefined = code === undefined ? undefined : this.glyphFor(code, box);
        if (found === undefined || text === undefined) {
            return this.token(box);
        }
        const operator: Operator = this.operatorOf(box);
        const instance: FontInstance = found[0];
        const glyph: number = found[1];
        const size: number = this.metrics.usedSize(box.style.values, instance);
        if (operator.stretchy && operator.inline) {
            const shaped: Shaped | undefined = stretch?.inline === undefined ? undefined : this.stretchy(instance, size, glyph, true, stretch.inline);
            return shaped === undefined ? this.token(box) : this.shapedContent(shaped, 0, text);
        }
        if (operator.stretchy) {
            if (stretch?.ascent === undefined || stretch.descent === undefined) {
                return this.token(box);
            }
            const target: readonly [number, number] = this.targetSizes(box, operator, stretch.ascent, stretch.descent, this.glyphHeight(instance, size, glyph));
            const shaped: Shaped | undefined = this.stretchy(instance, size, glyph, false, target[0] + target[1]);
            // "Δ = [(ascent of stretchy glyph − descent of stretchy glyph) − (Tascent − Tdescent)] / 2."
            return shaped === undefined ? this.token(box) : this.shapedContent(shaped, (shaped.ascent - shaped.descent - (target[0] - target[1])) / 2, text);
        }
        if (operator.largeop && this.keyword(box, "math-style") === "normal") {
            const constants: MathConstants = this.constants(box);
            const shaped: Shaped | undefined = this.stretchy(instance, size, glyph, false, constants.displayOperatorMinHeight);
            if (shaped === undefined) {
                return this.token(box);
            }
            return this.shapedContent(shaped, operator.symmetric ? (shaped.ascent - shaped.descent - 2 * constants.axisHeight) / 2 : 0, text);
        }
        return this.token(box);
    }

    private targetSizes(box: ElementBox, operator: Operator, ascent: number, descent: number, height: number): readonly [number, number] {
        // §3.2.4.3: symmetric stretching takes the smallest sizes that are centered on the math axis, and minsize and maxsize,
        // percentages of the height of the glyph, bound the target size T keeping that symmetry.
        const axis: number = this.constants(box).axisHeight;
        let over: number = ascent;
        let under: number = descent;
        if (operator.symmetric) {
            const half: number = Math.max(ascent - axis, descent + axis);
            over = half + axis;
            under = half - axis;
        }
        const minimum: number = Math.max(0, this.sizes.pixels(operator.minsize, height));
        const maximum: number = operator.maxsize === undefined ? Number.POSITIVE_INFINITY : Math.max(minimum, this.sizes.pixels(operator.maxsize, height));
        const target: number = over + under;
        if (target <= 0) {
            over = minimum / 2 + axis;
            under = minimum - over;
        } else if (target < minimum) {
            over = Math.max(0, (over - axis) * minimum / target + axis);
            under = minimum - over;
        } else if (maximum < target) {
            over = Math.max(0, (over - axis) * maximum / target + axis);
            under = maximum - over;
        }
        return [over, under];
    }

    private shapedContent(shaped: Shaped, delta: number, text: string): MathContent {
        // The glyph moves by delta towards the line-under, so that its ink fills the box from the line-over edge down.
        const ascent: number = shaped.ascent - delta;
        const descent: number = shaped.descent + delta;
        const glyphs: Array<MathGlyph> = shaped.glyphs.map((glyph: MathGlyph, index: number): MathGlyph => ({
            ...glyph, baseline: glyph.baseline + shaped.ascent, text: index === 0 ? text : ""
        }));
        return { width: shaped.width, ascent, descent, inkAscent: ascent, inkDescent: descent, italic: shaped.italic, children: [], glyphs };
    }

    private operatorText(box: ElementBox): string | undefined {
        // §3.2.4.2: the category is found from "only text content", which is the text that white space processing leaves,
        // without the spaces that collapse away at the ends of the line it is on.
        let text: string = "";
        for (const node of box.children) {
            if (node.kind !== "text") {
                return undefined;
            }
            text += node.text;
        }
        return COLLAPSING.has(this.keyword(box, "white-space-collapse") || "collapse") ? text.replace(COLLAPSIBLE_EDGES, "") : text;
    }

    private glyphFor(code: number, box: ElementBox): readonly [FontInstance, number] | undefined {
        // The Editor's Draft §5.3.2, "get a glyph corresponding to a character c given a directionality dir": in rtl, the rtlm
        // variant of the glyph, or else the glyph of the mirrored character of a Bidi_Mirrored one, which fails without one.
        const instance: FontInstance | undefined = this.metrics.firstFont(box.style.values);
        const glyph: number = instance === undefined ? 0 : this.lookup.glyphOf(instance.typeface.characters, code);
        if (instance === undefined || glyph === 0) {
            return undefined;
        }
        if (this.keyword(box, "direction") !== "rtl") {
            return [instance, glyph];
        }
        const variant: number = this.mirroredForm(instance, code);
        if (variant !== 0 && variant !== glyph) {
            return [instance, variant];
        }
        if (!this.bidi.isMirrored(code)) {
            return [instance, glyph];
        }
        const mirror: number | undefined = this.bidi.mirrorOf(code);
        const mirrored: number = mirror === undefined ? 0 : this.lookup.glyphOf(instance.typeface.characters, mirror);
        return mirrored === 0 ? undefined : [instance, mirrored];
    }

    private mirroredForm(instance: FontInstance, code: number): number {
        let shaper: FeatureShaper | undefined = this.shapers.get(instance.typeface);
        if (shaper === undefined) {
            shaper = new FeatureShaper(FontLayout.of(instance.typeface));
            this.shapers.set(instance.typeface, shaper);
        }
        const infos: Array<GlyphInfo> = shaper.shape([code], { rtl: true, scriptTags: MATH_SCRIPT, features: MIRRORED_FORMS, joining: false, vertical: false }, instance);
        return infos.length === 1 ? infos[0].glyph : 0;
    }

    private stretchy(instance: FontInstance, size: number, glyph: number, inline: boolean, target: number): Shaped | undefined {
        // §5.3.2, "shape a stretchy glyph": the glyph itself, the first size variant that covers the target, the glyph
        // assembly, or else the last option tried.
        const table: MathTable = this.mathTable(instance);
        const construction: GlyphConstruction | undefined = table.construction(glyph, inline);
        if (construction === undefined) {
            return undefined;
        }
        const scale: number = size / instance.metrics.unitsPerEm;
        if (this.extent(instance, glyph, inline) * scale >= target) {
            return this.single(instance, size, glyph, table);
        }
        let tried: number = glyph;
        for (const [variant, measurement] of construction.variants) {
            tried = variant;
            if (measurement * scale >= target) {
                return this.single(instance, size, variant, table);
            }
        }
        const assembly: GlyphAssembly | undefined = construction.assembly;
        const overlap: number = table.minConnectorOverlap();
        if (assembly !== undefined && this.isValid(assembly, overlap)) {
            return this.assembled(instance, size, assembly, overlap, inline, target / scale);
        }
        return this.single(instance, size, tried, table);
    }

    private extent(instance: FontInstance, glyph: number, inline: boolean): number {
        if (inline) {
            return instance.advances[glyph] ?? 0;
        }
        const bounds: OutlineBounds | undefined = this.outlines.bounds(instance, glyph);
        return bounds === undefined ? 0 : bounds.yMax - bounds.yMin;
    }

    private glyphHeight(instance: FontInstance, size: number, glyph: number): number {
        return this.extent(instance, glyph, false) * size / instance.metrics.unitsPerEm;
    }

    private single(instance: FontInstance, size: number, glyph: number, table: MathTable): Shaped {
        // "use normal shaping and bounding box for that glyph, the MathItalicsCorrectionInfo for that glyph as italic correction".
        const scale: number = size / instance.metrics.unitsPerEm;
        const bounds: OutlineBounds | undefined = this.outlines.bounds(instance, glyph);
        const advance: number = (instance.advances[glyph] ?? 0) * scale;
        return {
            width: advance, ascent: bounds === undefined ? 0 : bounds.yMax * scale, descent: bounds === undefined ? 0 : -bounds.yMin * scale,
            italic: (table.italicsCorrection(glyph) ?? 0) * scale, glyphs: [{ font: instance, size, glyph, text: "", inline: 0, baseline: 0, advance }]
        };
    }

    private isValid(assembly: GlyphAssembly, overlap: number): boolean {
        // §5.3.1: an assembly needs extenders, which grow it when joined, and connectors long enough "to satisfy the condition
        // of MathVariant.minConnectorOverlap", which OpenType MATH sets on the connectors that link neighboring parts.
        let extenders: number = 0;
        let extended: number = 0;
        for (const [index, part] of assembly.parts.entries()) {
            if (part.extender) {
                extenders++;
                extended += part.advance;
            }
            if ((this.joins(assembly.parts, index, true) && part.start < overlap) || (this.joins(assembly.parts, index, false) && part.end < overlap)) {
                return false;
            }
        }
        return extenders > 0 && extended - overlap * extenders > 0;
    }

    private joins(parts: ReadonlyArray<GlyphPart>, index: number, start: boolean): boolean {
        // OpenType MATH: the start connector is at the bottom or left end of a part, and "If the part does not have a connector
        // on one of its ends, the corresponding connector length should be set to zero"; an extender may be repeated.
        return parts[index].extender || (start ? index > 0 : index < parts.length - 1);
    }

    private assembled(instance: FontInstance, size: number, assembly: GlyphAssembly, minimum: number, inline: boolean, target: number): Shaped {
        // §5.3.1: each extender is repeated rmin times, the least that reaches the target with the minimum overlap, and the
        // glyphs overlap by omax, the most that the connectors allow while the assembly still reaches the target.
        const parts: ReadonlyArray<GlyphPart> = assembly.parts;
        let extenders: number = 0;
        let extended: number = 0;
        let fixed: number = 0;
        for (const part of parts) {
            if (part.extender) {
                extenders++;
                extended += part.advance;
            } else {
                fixed += part.advance;
            }
        }
        const others: number = parts.length - extenders;
        const repeats: number = Math.max(0, Math.ceil((target - fixed + minimum * (others - 1)) / (extended - minimum * extenders)));
        const count: number = others + repeats * extenders;
        let overlap: number = 0;
        if (count > 1) {
            overlap = (fixed + repeats * extended - target) / (count - 1);
            // The connector lengths that bound omax are those of the connectors that join two parts.
            for (const [index, part] of parts.entries()) {
                if (this.joins(parts, index, true)) {
                    overlap = Math.min(overlap, part.start);
                }
                if (this.joins(parts, index, false)) {
                    overlap = Math.min(overlap, part.end);
                }
            }
        }
        const scale: number = size / instance.metrics.unitsPerEm;
        const glyphs: Array<MathGlyph> = [];
        let pen: number = 0;
        let width: number = 0;
        let ascent: number = 0;
        let descent: number = 0;
        for (const part of parts) {
            const bounds: OutlineBounds | undefined = this.outlines.bounds(instance, part.glyph);
            const advance: number = (instance.advances[part.glyph] ?? 0) * scale;
            const bottom: number = bounds === undefined ? 0 : bounds.yMin * scale;
            width = Math.max(width, advance);
            ascent = Math.max(ascent, bounds === undefined ? 0 : bounds.yMax * scale);
            descent = Math.max(descent, bounds === undefined ? 0 : -bounds.yMin * scale);
            for (let repeat: number = 0; repeat < (part.extender ? repeats : 1); repeat++) {
                // A horizontal assembly puts the (left, baseline) point of each part at the pen, a vertical one the (left, bottom)
                // point, and the pen goes the full advance less the overlap to the right or up.
                glyphs.push({ font: instance, size, glyph: part.glyph, text: "", inline: inline ? pen * scale : 0, baseline: inline ? 0 : bottom - pen * scale, advance });
                pen += part.advance - overlap;
            }
        }
        const stretched: number = (fixed + repeats * extended - overlap * (count - 1)) * scale;
        const italic: number = assembly.italicsCorrection * scale;
        return inline ? { width: stretched, ascent, descent, italic, glyphs } : { width, ascent: stretched, descent: 0, italic, glyphs };
    }

    private preferredWidth(instance: FontInstance, size: number, glyph: number): number {
        // §5.3.2, "the preferred inline size of a glyph stretched along the block axis": the widest of the glyph, its vertical
        // size variants and its glyph assembly.
        const table: MathTable = this.mathTable(instance);
        let width: number = instance.advances[glyph] ?? 0;
        const construction: GlyphConstruction | undefined = table.construction(glyph, false);
        for (const [variant] of construction?.variants ?? []) {
            width = Math.max(width, instance.advances[variant] ?? 0);
        }
        const assembly: GlyphAssembly | undefined = construction?.assembly;
        if (assembly !== undefined && this.isValid(assembly, table.minConnectorOverlap())) {
            for (const part of assembly.parts) {
                width = Math.max(width, instance.advances[part.glyph] ?? 0);
            }
        }
        return width * size / instance.metrics.unitsPerEm;
    }

    private space(box: ElementBox): MathContent {
        // §3.2.5: the inline size is the width, the block size the height, and the line-ascent the requested one.
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        const height: number = sizes.blockSize ?? 0;
        const ascent: number = (this.data(box) as MathElement).height ?? 0;
        return { width: sizes.inlineSize ?? 0, ascent, descent: height - ascent, inkAscent: ascent, inkDescent: height - ascent, children: [] };
    }

    private rowOf(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.3.1.2: "add-space" is true for a <math> element and for a box that is not an embellished operator.
        return this.row(children, stretch, (this.data(box) as MathElement).name === "math" || this.core(box) === undefined);
    }

    private anonymousRow(children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.1.3: an anonymous <mrow> box is a grouping element, and so an embellished operator as the others are.
        return this.row(children, stretch, this.groupCore(children) === undefined);
    }

    private row(children: ReadonlyArray<ElementBox>, stretch: Stretch | undefined, addSpace: boolean): MathContent {
        // §3.3.1.2: the children in a row on their alphabetic baselines, spaced by the lspace and rspace of the embellished
        // operators, with the italic correction of a slanted child before one that is not.
        const laid: Array<Laid> = this.blockStretched(children, stretch);
        const offsets: Array<number> = [];
        let offset: number = 0;
        let previous: number = 0;
        let ascent: number = 0;
        let descent: number = 0;
        for (const child of laid) {
            const slanted: boolean = child.operator === undefined && (child.italic ?? 0) !== 0;
            if (!slanted) {
                offset += previous;
            }
            if (child.operator !== undefined && addSpace) {
                offset += child.operator.lspace;
            }
            offsets.push(offset);
            offset += child.width;
            previous = slanted ? child.italic ?? 0 : 0;
            if (child.operator !== undefined && addSpace) {
                offset += child.operator.rspace;
            }
            ascent = Math.max(ascent, child.ascent);
            descent = Math.max(descent, child.descent);
        }
        // §3.1.2: the ink-over and ink-under baselines of a box other than a token element "just match normal ascent and descent".
        const content: MathContent = { width: offset + previous, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        if (laid.length > 0) {
            content.italic = previous;
        }
        laid.forEach((child: Laid, index: number) => this.place(content.children, child, offsets[index], ascent));
        return content;
    }

    private blockStretched(children: ReadonlyArray<ElementBox>, stretch?: Stretch): Array<Laid> {
        // §3.3.1.1: the embellished operators that stretch along the block axis cover the ink of the other children, or a
        // target of zero when there are no others; a box being stretched passes its constraint to its embellished child.
        const laid: Array<Laid | undefined> = new Array<Laid | undefined>(children.length).fill(undefined);
        if (stretch !== undefined) {
            return children.map((child: ElementBox): Laid => this.laid(child, this.core(child) !== undefined ? stretch : undefined));
        }
        const stretching: Array<number> = [];
        for (const [index, child] of children.entries()) {
            const operator: Operator | undefined = this.operatorFor(child);
            if (operator !== undefined && operator.stretchy && !operator.inline) {
                stretching.push(index);
            } else {
                laid[index] = this.laid(child);
            }
        }
        if (stretching.length > 0) {
            let measured: Array<Laid> = laid.filter((child: Laid | undefined): child is Laid => child !== undefined);
            if (measured.length === 0) {
                measured = stretching.map((index: number): Laid => this.laid(children[index], { ascent: 0, descent: 0 }));
            }
            const ascent: number = Math.max(...measured.map((child: Laid) => child.inkAscent));
            const descent: number = Math.max(...measured.map((child: Laid) => child.inkDescent));
            for (const index of stretching) {
                laid[index] = this.laid(children[index], { ascent, descent });
            }
        }
        return laid as Array<Laid>;
    }

    private place(out: Array<BoxFragment | LineFragment>, child: Laid, inline: number, baseline: number): void {
        // The inline offset is that of the child's margin box, and the baseline is counted from the line-over edge.
        child.fragment.inline = inline + child.start;
        child.fragment.block = baseline - child.ascent + child.top;
        out.push(child.fragment);
    }

    private fraction(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.3.2: a numerator and a denominator centered on each other, shifted from the alphabetic baseline by the MATH
        // constants of the math style, with a bar on the math axis when the line thickness is not zero.
        if (children.length !== 2) {
            return this.rowOf(box, children, stretch);
        }
        const constants: MathConstants = this.constants(box);
        const thickness: CssValue | undefined = (this.data(box) as MathElement).linethickness;
        const rule: number = thickness === undefined ? this.lineThickness(box, constants) : Math.max(0, this.sizes.pixels(thickness, constants.fractionRuleThickness));
        const numerator: Laid = this.laid(children[0], stretch);
        const denominator: Laid = this.laid(children[1]);
        const math: MathElement = this.data(box) as MathElement;
        if (math.bevelled === true) {
            return this.bevelled(numerator, denominator, rule, constants);
        }
        const compact: boolean = this.keyword(box, "math-style") === "compact";
        const width: number = Math.max(numerator.width, denominator.width);
        const axis: number = constants.axisHeight;
        let up: number;
        let down: number;
        let ascent: number;
        let descent: number;
        if (rule !== 0) {
            up = Math.max(compact ? constants.fractionNumeratorShiftUp : constants.fractionNumeratorDisplayStyleShiftUp,
                axis + rule / 2 + (compact ? constants.fractionNumeratorGapMin : constants.fractionNumDisplayStyleGapMin) + numerator.inkDescent);
            down = Math.max(compact ? constants.fractionDenominatorShiftDown : constants.fractionDenominatorDisplayStyleShiftDown,
                rule / 2 + (compact ? constants.fractionDenominatorGapMin : constants.fractionDenomDisplayStyleGapMin) + denominator.inkAscent - axis);
            ascent = Math.max(up + numerator.ascent, -down + denominator.ascent, axis + rule / 2);
            descent = Math.max(-up + numerator.descent, down + denominator.descent, -axis + rule / 2, 0);
        } else {
            // §3.3.2.2: "If Δ = GapMin − Gap is positive then TopShift and BottomShift are respectively increased by Δ/2 and Δ − Δ/2."
            up = compact ? constants.stackTopShiftUp : constants.stackTopDisplayStyleShiftUp;
            down = compact ? constants.stackBottomShiftDown : constants.stackBottomDisplayStyleShiftDown;
            const gap: number = (down - denominator.inkAscent) + (up - numerator.inkDescent);
            const delta: number = (compact ? constants.stackGapMin : constants.stackDisplayStyleGapMin) - gap;
            if (delta > 0) {
                up += delta / 2;
                down += delta - delta / 2;
            }
            ascent = Math.max(up + numerator.ascent, -down + denominator.ascent);
            descent = Math.max(-up + numerator.descent, down + denominator.descent, 0);
        }
        // MathML 4 §3.3.2.2: numalign and denomalign place each part over or under the fraction.
        const content: MathContent = { width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [], centered: true };
        this.place(content.children, numerator, (width - numerator.width) * this.alignFactor(box, math.numAlign), ascent - up);
        this.place(content.children, denominator, (width - denominator.width) * this.alignFactor(box, math.denomAlign), ascent + down);
        if (rule !== 0) {
            content.bar = [ascent - axis, rule];
        }
        return content;
    }

    private bevelled(numerator: Laid, denominator: Laid, rule: number, constants: MathConstants): MathContent {
        // MathML 4 §3.3.2.2: "the numerator slightly raised, the denominator slightly lowered and both separated by a slash",
        // apart by the skewed fraction gaps of OpenType MATH; the slash, of the line thickness, crosses the horizontal gap.
        const axis: number = constants.axisHeight;
        const gap: number = constants.skewedFractionHorizontalGap;
        const up: number = axis + constants.skewedFractionVerticalGap / 2 + numerator.inkDescent;
        const down: number = denominator.inkAscent - axis + constants.skewedFractionVerticalGap / 2;
        const ascent: number = Math.max(up + numerator.ascent, denominator.ascent - down);
        const descent: number = Math.max(numerator.descent - up, down + denominator.descent, 0);
        const content: MathContent = { width: numerator.width + gap + denominator.width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [], centered: true };
        this.place(content.children, numerator, 0, ascent - up);
        this.place(content.children, denominator, numerator.width + gap, ascent + down);
        if (rule > 0) {
            content.paths = [{ lineWidth: rule, filled: false, commands: [["M", numerator.width, ascent + down + denominator.inkDescent],
                ["L", numerator.width + gap, ascent - up - numerator.inkAscent]] }];
        }
        return content;
    }

    private alignFactor(box: ElementBox, align: string | undefined): number {
        // MathML 4 §3.1.5.1: "The terms left and right may otherwise be safely assumed to mean left and right", in any direction.
        const rtl: boolean = this.keyword(box, "direction") === "rtl";
        return align === "left" ? (rtl ? 1 : 0) : (align === "right" ? (rtl ? 0 : 1) : 0.5);
    }

    private radicalSign(box: ElementBox, target: number): Shaped | undefined {
        // §3.3.3.1: the radical glyph, U+221A in the direction of the element, stretched to the target in the block dimension;
        // a font without a construction for it gives the glyph as it is.
        const found: readonly [FontInstance, number] | undefined = this.glyphFor(RADICAL, box);
        if (found === undefined) {
            return undefined;
        }
        const size: number = this.metrics.usedSize(box.style.values, found[0]);
        const shaped: Shaped = this.stretchy(found[0], size, found[1], false, target) ?? this.single(found[0], size, found[1], this.mathTable(found[0]));
        return { ...shaped, glyphs: shaped.glyphs.map((glyph: MathGlyph, index: number): MathGlyph => ({ ...glyph, text: index === 0 ? RADICAL_TEXT : "" })) };
    }

    private radicalWidth(box: ElementBox): number {
        const found: readonly [FontInstance, number] | undefined = this.glyphFor(RADICAL, box);
        return found === undefined ? 0 : this.preferredWidth(found[0], this.metrics.usedSize(box.style.values, found[0]), found[1]);
    }

    private squareRoot(box: ElementBox, children: ReadonlyArray<ElementBox>): MathContent {
        // §3.3.3.2: the msqrt base is an anonymous <mrow> box.
        return this.radical(box, this.anonymousRow(children));
    }

    private radical(box: ElementBox, base: MathContent): MathContent {
        // §3.3.3.2: the radical glyph before the base, an overbar over it, and room above for the extra ascender.
        const constants: MathConstants = this.constants(box);
        const gap: number = this.keyword(box, "math-style") === "compact" ? constants.radicalVerticalGap : constants.radicalDisplayStyleVerticalGap;
        const thickness: number = constants.radicalRuleThickness;
        const extra: number = constants.radicalExtraAscender;
        const sign: Shaped | undefined = this.radicalSign(box, thickness + gap + base.inkAscent + base.inkDescent);
        const signWidth: number = sign?.width ?? 0;
        const ascent: number = Math.max(base.ascent, base.inkAscent + gap + thickness + extra);
        const descent: number = Math.max(base.descent, (sign === undefined ? 0 : sign.ascent + sign.descent) + extra - ascent);
        const content: MathContent = {
            width: signWidth + base.width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [],
            rules: [{ inline: signWidth, block: extra, inlineSize: base.width, blockSize: thickness }]
        };
        this.include(content, base, signWidth, ascent - base.ascent);
        if (sign !== undefined) {
            // "shifted away from the line-over edge of the overbar towards the line-under by ... the ascent" of the radical glyph.
            content.glyphs = sign.glyphs.map((glyph: MathGlyph): MathGlyph => ({ ...glyph, baseline: glyph.baseline + extra + sign.ascent }));
        }
        return content;
    }

    private include(content: MathContent, part: MathContent, inline: number, block: number): void {
        // A part laid out without a box of its own, such as an anonymous <mrow> box, moves into the content that holds it.
        for (const child of part.children) {
            if (child.kind === "box") {
                child.inline += inline;
            } else {
                child.inline = (child.inline ?? 0) + inline;
            }
            child.block += block;
            content.children.push(child);
        }
        for (const glyph of part.glyphs ?? []) {
            content.glyphs = content.glyphs ?? [];
            content.glyphs.push({ ...glyph, inline: glyph.inline + inline, baseline: glyph.baseline + block });
        }
        for (const rule of part.rules ?? []) {
            content.rules = content.rules ?? [];
            content.rules.push({ ...rule, inline: rule.inline + inline, block: rule.block + block });
        }
        for (const path of part.paths ?? []) {
            content.paths = content.paths ?? [];
            content.paths.push(this.movedPath(path, inline, block));
        }
    }

    private movedPath(path: MathPath, inline: number, block: number): MathPath {
        const commands: Array<MathPathCommand> = path.commands.map((command: MathPathCommand): MathPathCommand => {
            switch (command[0]) {
                case "M":
                case "L":
                    return [command[0], command[1] + inline, command[2] + block];
                case "C":
                    return ["C", command[1] + inline, command[2] + block, command[3] + inline, command[4] + block, command[5] + inline, command[6] + block];
                default:
                    return command;
            }
        });
        return { lineWidth: path.lineWidth, filled: path.filled, commands };
    }

    private enclosed(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // MathML 4 §3.3.9.2: each notation is "rendered as if the others were not present" around the inferred mrow, whose
        // baseline is that of the element; the deprecated radical is the msqrt layout, around the same mrow as the others.
        const notations: ReadonlySet<string> = new Set<string>((this.data(box) as MathElement).notations ?? []);
        const inner: MathContent = this.anonymousRow(children, stretch);
        const height: number = inner.ascent + inner.descent;
        const own: readonly [number, number, number, number] = this.enclosure(box, notations, inner.width, height);
        const sign: MathContent | undefined = notations.has("radical") ? this.radical(box, { width: inner.width, ascent: inner.ascent, descent: inner.descent,
            inkAscent: inner.inkAscent, inkDescent: inner.inkDescent, children: [] }) : undefined;
        const signWidth: number = sign === undefined ? 0 : sign.width - inner.width;
        const rtl: boolean = this.keyword(box, "direction") === "rtl";
        const room: [number, number, number, number] = [own[LEFT], own[RIGHT], Math.max(own[TOP], sign === undefined ? 0 : sign.ascent - inner.ascent),
            Math.max(own[BOTTOM], sign === undefined ? 0 : sign.descent - inner.descent)];
        room[rtl ? RIGHT : LEFT] = Math.max(room[rtl ? RIGHT : LEFT], signWidth);
        const width: number = room[LEFT] + inner.width + room[RIGHT];
        const ascent: number = inner.ascent + room[TOP];
        const descent: number = inner.descent + room[BOTTOM];
        // The rooms and strokes are physical, since "only phasorangle is affected by the directionality"; the painter mirrors the
        // inline axis of rtl content, so the strokes are mirrored here and the content starts after the room on the right.
        const start: number = rtl ? room[RIGHT] : room[LEFT];
        const content: MathContent = { width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        this.include(content, inner, start, room[TOP]);
        if (sign !== undefined) {
            this.include(content, sign, start - signWidth, room[TOP] + inner.ascent - sign.ascent);
        }
        const ownWidth: number = own[LEFT] + inner.width + own[RIGHT];
        const paths: Array<MathPath> = this.notationPaths(box, notations, ownWidth, own[TOP] + height + own[BOTTOM], [own[LEFT], own[TOP], inner.width, height], own);
        if (paths.length > 0) {
            content.paths = [...(content.paths ?? []), ...paths.map((path: MathPath): MathPath =>
                this.movedPath(rtl ? this.mirroredPath(path, ownWidth) : path, start - own[rtl ? RIGHT : LEFT], room[TOP] - own[TOP]))];
        }
        return content;
    }

    private mirroredPath(path: MathPath, width: number): MathPath {
        const commands: Array<MathPathCommand> = path.commands.map((command: MathPathCommand): MathPathCommand => {
            switch (command[0]) {
                case "M":
                case "L":
                    return [command[0], width - command[1], command[2]];
                case "C":
                    return ["C", width - command[1], command[2], width - command[3], command[4], width - command[5], command[6]];
                default:
                    return command;
            }
        });
        return { lineWidth: path.lineWidth, filled: path.filled, commands };
    }

    private stack(box: ElementBox, children: ReadonlyArray<ElementBox>, result?: ElementBox, rows: Array<StackRow> = []): MathContent {
        // MathML 4 §3.6.2.1: a long division whose result is "treated as part of the dividend's mstack" puts the result and a line
        // over the dividend first.
        const math: MathElement = this.data(box) as MathElement;
        if (result !== undefined) {
            rows.push({ kind: "digits", box: result, position: 0, cells: [], ascent: 0, descent: 0, baseline: 0 });
            rows.push({ kind: "line", box, position: 0, cells: [], ascent: 0, descent: 0, baseline: 0 });
        }
        this.stackItems(children, 0, 0, rows);
        for (const [index, row] of rows.entries()) {
            if (row.kind === "digits") {
                const cells: Array<ElementBox> = this.rowCells(row.box);
                const anchor: number = this.anchor(cells, math);
                row.cells = cells.map((cell: ElementBox, position: number): readonly [Laid, number] => [this.laid(cell), position - anchor - row.position]);
            } else if (row.kind === "carries") {
                // The figures of §3.6.8.1 and §3.6.8.2: the last carry is over the last column of the following row.
                const below: StackRow | undefined = rows.slice(index + 1).find((next: StackRow) => next.kind === "digits");
                const following: Array<ElementBox> = below === undefined ? [] : this.rowCells(below.box);
                const last: number = below === undefined ? -1 : following.length - 1 - this.anchor(following, math) - below.position;
                const carries: Array<ElementBox> = this.inFlow(row.box);
                row.cells = carries.map((carry: ElementBox, position: number): readonly [Laid, number] => [this.laid(carry), last - (carries.length - 1 - position) - row.position]);
            }
        }
        const lineColumns: (row: StackRow) => readonly [number, number] | undefined = (row: StackRow): readonly [number, number] | undefined => {
            // §3.6.7.2: a line of length n "is positioned and drawn as if it were a number with the given number of digits".
            const length: number = this.data(row.box)?.lineLength ?? 0;
            if (length === 0) {
                return undefined;
            }
            const anchor: number = math.stackAlign === "left" ? 0 : (math.stackAlign === "center" ? Math.floor(length / 2) : length);
            return [-anchor - row.position, length - 1 - anchor - row.position];
        };
        let low: number = Number.POSITIVE_INFINITY;
        let high: number = Number.NEGATIVE_INFINITY;
        for (const row of rows) {
            const columns: Array<number> = row.kind === "digits" ? row.cells.map((cell: readonly [Laid, number]) => cell[1]) : [...(lineColumns(row) ?? [])];
            for (const column of columns) {
                low = Math.min(low, column);
                high = Math.max(high, column);
            }
        }
        if (low > high) {
            low = 0;
            high = -1;
        }
        // §3.6.1.1: "The width of a column is the maximum of the widths of each 'digit' in that column", carries counting as zero,
        // and an empty column has "the width of a 0".
        const count: number = high - low + 1;
        const widths: Float64Array = new Float64Array(count).fill(Number.NaN);
        for (const row of rows) {
            if (row.kind === "digits") {
                for (const [laid, column] of row.cells) {
                    widths[column - low] = Number.isNaN(widths[column - low]) ? laid.width : Math.max(widths[column - low], laid.width);
                }
            }
        }
        const zero: number = this.metrics.zeroAdvance(box.style.values);
        for (let column: number = 0; column < count; column++) {
            widths[column] = Number.isNaN(widths[column]) ? zero : widths[column];
        }
        const spacing: number = math.charSpacing ?? this.carrySpacing(rows, widths, low);
        const starts: Float64Array = new Float64Array(count + 1);
        for (let column: number = 0; column < count; column++) {
            starts[column + 1] = starts[column] + widths[column] + (column < count - 1 ? spacing : 0);
        }
        const width: number = starts[count];
        // The figures of §3.6.8 space the rows of digits as lines of text, so a row is at least as tall as the font's line;
        // §3.6.7.2: a line has "height=0, and depth=mslinethickness".
        const constants: MathConstants = this.constants(box);
        const fontAscent: number = this.metrics.ascent(box.style.values);
        const fontDescent: number = this.metrics.descent(box.style.values);
        let top: number = 0;
        for (const row of rows) {
            if (row.kind === "line") {
                row.ascent = 0;
                row.descent = this.lineThickness(row.box, constants);
            } else {
                row.ascent = Math.max(row.kind === "digits" ? fontAscent : 0, ...row.cells.map((cell: readonly [Laid, number]) => cell[0].ascent));
                row.descent = Math.max(row.kind === "digits" ? fontDescent : 0, ...row.cells.map((cell: readonly [Laid, number]) => cell[0].descent));
            }
            row.baseline = top + row.ascent;
            top = row.baseline + row.descent;
        }
        const ascent: number = this.stackAscent(math, rows, top, constants.axisHeight);
        const content: MathContent = { width, ascent, descent: top - ascent, inkAscent: ascent, inkDescent: top - ascent, children: [] };
        const charAlign: string = math.charAlign ?? "right";
        for (const [index, row] of rows.entries()) {
            if (row.kind === "line") {
                const columns: readonly [number, number] | undefined = lineColumns(row);
                const left: number = columns === undefined ? 0 : starts[Math.max(0, columns[0] - low)] - (this.data(row.box)?.leftOverhang ?? 0);
                const right: number = columns === undefined ? width : starts[Math.min(count, columns[1] - low + 1)] - (columns[1] - low + 1 < count ? spacing : 0)
                    + (this.data(row.box)?.rightOverhang ?? 0);
                content.rules = content.rules ?? [];
                content.rules.push({ inline: left, block: row.baseline, inlineSize: Math.max(0, right - left), blockSize: row.descent });
                continue;
            }
            if (row.kind === "digits") {
                for (const [laid, column] of row.cells) {
                    const slack: number = widths[column - low] - laid.width;
                    const offset: number = charAlign === "left" ? 0 : (charAlign === "center" ? slack / 2 : slack);
                    this.place(content.children, laid, starts[column - low] + offset, row.baseline);
                }
                continue;
            }
            const below: StackRow | undefined = rows.slice(index + 1).find((next: StackRow) => next.kind === "digits");
            this.placeCarries(content, row, below, starts, widths, low, constants);
        }
        return content;
    }

    private longDivision(box: ElementBox, children: ReadonlyArray<ElementBox>): MathContent {
        // MathML 4 §3.6.2: the divisor, the result, then the stack; §3.6.8.3 draws each longdivstyle, and "Conforming renderers may
        // ignore any value they do not handle", which keeps the default lefttop.
        const style: string = (this.data(box) as MathElement).longdivStyle ?? "lefttop";
        const items: ReadonlyArray<ElementBox> = children.slice(2);
        switch (style) {
            case "righttop":
            case "stackedleftlinetop":
                return this.divisionOnTop(box, style, children[0], children[1], items);
            case "stackedrightright":
            case "mediumstackedrightright":
            case "shortstackedrightright":
            case "stackedleftleft":
                return this.divisionBeside(box, style, children[0], children[1], items);
            case "left/\\right":
            case "left)(right":
            case ":right=right":
                return this.divisionInline(box, style, children[0], children[1], items);
            default:
                return this.divisionOnTop(box, "lefttop", children[0], children[1], items);
        }
    }

    private divisionOnTop(box: ElementBox, style: string, divisorBox: ElementBox, resultBox: ElementBox, items: ReadonlyArray<ElementBox>): MathContent {
        // §3.6.8.3: lefttop puts the divisor and a ")" before the dividend, righttop the divisor after it with lines at its left
        // and under it, stackedleftlinetop the divisor before it with a line under it and one between them; the result is above.
        const rows: Array<StackRow> = [];
        const stacked: MathContent = this.stack(box, items, resultBox, rows);
        const divisor: Laid = this.laid(divisorBox);
        const rule: number = this.constants(box).fractionRuleThickness;
        const gap: number = this.metrics.zeroAdvance(box.style.values) / 2;
        const line: StackRow = rows[1];
        const dividend: StackRow = rows[2] ?? rows[0];
        const bottom: number = Math.max(dividend.baseline + dividend.descent, line.baseline + rule + divisor.ascent + divisor.descent);
        const content: MathContent = { width: 0, ascent: stacked.ascent, descent: stacked.descent, inkAscent: stacked.ascent, inkDescent: stacked.descent, children: [] };
        const rules: Array<MathRule> = [];
        let stackStart: number = 0;
        if (style === "lefttop") {
            const paren: Shaped | undefined = this.separator(box, ")", bottom - line.baseline);
            stackStart = divisor.width + gap + (paren?.width ?? 0);
            this.place(content.children, divisor, 0, dividend.baseline);
            if (paren !== undefined) {
                content.glyphs = paren.glyphs.map((glyph: MathGlyph): MathGlyph => ({ ...glyph, inline: glyph.inline + divisor.width + gap, baseline: glyph.baseline + line.baseline + paren.ascent }));
            }
        } else if (style === "stackedleftlinetop") {
            stackStart = divisor.width + 2 * gap + rule;
            this.place(content.children, divisor, gap, dividend.baseline);
            rules.push({ inline: divisor.width + 2 * gap, block: line.baseline, inlineSize: rule, blockSize: bottom - line.baseline });
            rules.push({ inline: 0, block: bottom - rule, inlineSize: divisor.width + 2 * gap + rule, blockSize: rule });
        }
        this.include(content, stacked, stackStart, 0);
        let width: number = stackStart + stacked.width;
        if (style === "righttop") {
            const left: number = width + gap;
            this.place(content.children, divisor, left + rule + gap, dividend.baseline);
            width = left + rule + 2 * gap + divisor.width;
            rules.push({ inline: stacked.width, block: line.baseline, inlineSize: width - stacked.width, blockSize: rule });
            rules.push({ inline: left, block: line.baseline, inlineSize: rule, blockSize: bottom - line.baseline });
            rules.push({ inline: left, block: bottom - rule, inlineSize: width - left, blockSize: rule });
        }
        content.width = width;
        content.rules = [...(content.rules ?? []), ...rules];
        return this.grown(content, bottom);
    }

    private divisionBeside(box: ElementBox, style: string, divisorBox: ElementBox, resultBox: ElementBox, items: ReadonlyArray<ElementBox>): MathContent {
        // §3.6.8.3: the divisor over a line and the result beside the dividend, after a vertical line across the whole stack, two
        // rows or only the divisor's; stackedleftleft has them before the stack, aligned on its side of the line.
        const rows: Array<StackRow> = [];
        const stacked: MathContent = this.stack(box, items, undefined, rows);
        const divisor: Laid = this.laid(divisorBox);
        const result: Laid = this.laid(resultBox);
        const rule: number = this.constants(box).fractionRuleThickness;
        const gap: number = this.metrics.zeroAdvance(box.style.values) / 2;
        const first: StackRow | undefined = rows[0];
        const second: StackRow | undefined = rows[1];
        const divisorBaseline: number = first?.baseline ?? divisor.ascent;
        const divisorBottom: number = Math.max(divisorBaseline + divisor.descent, (first === undefined ? 0 : first.baseline + first.descent));
        const resultBaseline: number = Math.max(second?.baseline ?? 0, divisorBottom + rule + result.ascent);
        const resultBottom: number = resultBaseline + result.descent;
        const column: number = Math.max(divisor.width, result.width) + 2 * gap;
        const height: number = Math.max(stacked.ascent + stacked.descent, resultBottom);
        const lineEnd: number = style === "shortstackedrightright" ? divisorBottom : (style === "mediumstackedrightright" ? resultBottom : height);
        const content: MathContent = { width: stacked.width + 2 * gap + rule + column, ascent: stacked.ascent, descent: stacked.descent, inkAscent: stacked.ascent,
            inkDescent: stacked.descent, children: [] };
        const mirrored: boolean = style === "stackedleftleft";
        const stackStart: number = mirrored ? column + gap + rule + gap : 0;
        const lineAt: number = mirrored ? column + gap : stacked.width + gap;
        const columnStart: number = mirrored ? 0 : lineAt + rule;
        this.include(content, stacked, stackStart, 0);
        const inColumn: (laid: Laid) => number = (laid: Laid): number => mirrored ? columnStart + column - gap - laid.width : columnStart + gap;
        this.place(content.children, divisor, inColumn(divisor), divisorBaseline);
        this.place(content.children, result, inColumn(result), resultBaseline);
        content.rules = [...(content.rules ?? []), { inline: lineAt, block: 0, inlineSize: rule, blockSize: lineEnd },
            { inline: columnStart, block: divisorBottom, inlineSize: column + (mirrored ? gap : 0), blockSize: rule }];
        return this.grown(content, height);
    }

    private divisionInline(box: ElementBox, style: string, divisorBox: ElementBox, resultBox: ElementBox, items: ReadonlyArray<ElementBox>): MathContent {
        // §3.6.8.3: divisor, "/", dividend, "\", result for left/\right, the same with ")" and "(" for left)(right, and dividend,
        // ":", divisor, "=", result for :right=right, on the dividend's row, the rest of the stack under the dividend.
        const rows: Array<StackRow> = [];
        const stacked: MathContent = this.stack(box, items, undefined, rows);
        const divisor: Laid = this.laid(divisorBox);
        const result: Laid = this.laid(resultBox);
        const dividend: StackRow | undefined = rows.find((row: StackRow) => row.kind === "digits");
        const baseline: number = dividend?.baseline ?? stacked.ascent;
        const dividendEnd: number = dividend === undefined ? stacked.width : Math.max(...dividend.cells.map((cell: readonly [Laid, number]) => cell[0].fragment.inline + cell[0].width));
        const marks: readonly [string, string] = style === "left/\\right" ? ["/", "\\"] : (style === "left)(right" ? [")", "("] : [":", "="]);
        const before: Shaped | undefined = this.separator(box, marks[0]);
        const after: Shaped | undefined = this.separator(box, marks[1]);
        const content: MathContent = { width: 0, ascent: stacked.ascent, descent: stacked.descent, inkAscent: stacked.ascent, inkDescent: stacked.descent, children: [] };
        const glyphs: Array<MathGlyph> = [];
        const mark: (shaped: Shaped | undefined, inline: number) => number = (shaped: Shaped | undefined, inline: number): number => {
            if (shaped === undefined) {
                return inline;
            }
            const spaces: readonly [number, number] = this.operatorSpaces(box, shaped.glyphs[0]?.text ?? "");
            glyphs.push(...shaped.glyphs.map((glyph: MathGlyph): MathGlyph => ({ ...glyph, inline: glyph.inline + inline + spaces[0], baseline: glyph.baseline + baseline })));
            return inline + spaces[0] + shaped.width + spaces[1];
        };
        let stackStart: number = 0;
        let pen: number;
        if (style === ":right=right") {
            pen = mark(before, dividendEnd);
            this.place(content.children, divisor, pen, baseline);
            pen = mark(after, pen + divisor.width);
        } else {
            this.place(content.children, divisor, 0, baseline);
            stackStart = mark(before, divisor.width);
            pen = mark(after, stackStart + dividendEnd);
        }
        this.include(content, stacked, stackStart, 0);
        this.place(content.children, result, pen, baseline);
        content.width = Math.max(stackStart + stacked.width, pen + result.width);
        content.glyphs = [...(content.glyphs ?? []), ...glyphs];
        return this.grown(content, Math.max(content.ascent + content.descent, baseline + Math.max(divisor.descent, result.descent)));
    }

    private separator(box: ElementBox, text: string, height?: number): Shaped | undefined {
        // The separators of §3.6.8.3 are characters of the element's font; the ")" of lefttop stretches over the dividend's row as
        // a fence does (§3.2.4.3), the others keep their size.
        const found: readonly [FontInstance, number] | undefined = this.glyphFor(text.codePointAt(0) as number, box);
        if (found === undefined) {
            return undefined;
        }
        const size: number = this.metrics.usedSize(box.style.values, found[0]);
        const shaped: Shaped = (height === undefined ? undefined : this.stretchy(found[0], size, found[1], false, height)) ?? this.single(found[0], size, found[1], this.mathTable(found[0]));
        return { ...shaped, glyphs: shaped.glyphs.map((glyph: MathGlyph, index: number): MathGlyph => ({ ...glyph, text: index === 0 ? text : "" })) };
    }

    private operatorSpaces(box: ElementBox, text: string): readonly [number, number] {
        // A separator is spaced as an infix mo with that character is, by the operator dictionary.
        const entry: DictionaryEntry = this.dictionary.entry(this.dictionary.category(text, "infix"));
        const em: number = this.metrics.fontSize(box.style.values);
        return [entry.lspace * em, entry.rspace * em];
    }

    private grown(content: MathContent, height: number): MathContent {
        // The content keeps its baseline and holds what was drawn below its descent.
        const descent: number = Math.max(content.descent, height - content.ascent);
        content.descent = descent;
        content.inkDescent = descent;
        return content;
    }

    private stackItems(boxes: ReadonlyArray<ElementBox>, position: number, shift: number, rows: Array<StackRow>): void {
        // §3.6.3.2: the position of a group's rows is relative to that of the group, and "shift ... specifies the position of each
        // child (except the first) with respect to the previous child in the group".
        boxes.forEach((child: ElementBox, index: number) => {
            const math: MathElement | undefined = this.isMath(child) ? this.data(child) : undefined;
            const base: number = position + index * shift + (math?.position ?? 0);
            if (math?.name === "msgroup") {
                this.stackItems(this.inFlow(child), base, math.shift ?? 0, rows);
                return;
            }
            const kind: "digits" | "line" | "carries" = math?.name === "msline" ? "line" : (math?.name === "mscarries" ? "carries" : "digits");
            rows.push({ kind, box: child, position: base, cells: [], ascent: 0, descent: 0, baseline: 0 });
        });
    }

    private rowCells(row: ElementBox): Array<ElementBox> {
        // §3.6.4.1: each child of the row is a digit, the digits of a number having been split into mn elements, and "An mstyle
        // is treated as if its children were directly the children of the msrow".
        if (this.data(row)?.name !== "msrow") {
            return [row];
        }
        const cells: Array<ElementBox> = [];
        const visit: (box: ElementBox) => void = (box: ElementBox): void => {
            for (const child of this.inFlow(box)) {
                if (this.isMath(child) && this.data(child)?.name === "mstyle") {
                    visit(child);
                } else {
                    cells.push(child);
                }
            }
        };
        visit(row);
        return cells;
    }

    private anchor(cells: ReadonlyArray<ElementBox>, math: MathElement): number {
        // §3.6.1.2: the index of the cell on the alignment column; for decimalpoint "the left-most column in each row that contains
        // the decimalpoint character", or else "an implied decimalpoint character ... on the right of the first number in the row".
        switch (math.stackAlign) {
            case "left":
                return 0;
            case "right":
                return cells.length;
            case "center":
                return Math.floor(cells.length / 2);
            default:
                break;
        }
        const point: number = cells.findIndex((cell: ElementBox) => this.operatorText(cell) === (math.decimalCharacter ?? "."));
        if (point >= 0) {
            return point;
        }
        const first: number = cells.findIndex((cell: ElementBox) => this.data(cell)?.name === "mn");
        if (first < 0) {
            return cells.length;
        }
        const group: number | undefined = this.data(cells[first])?.digitGroup;
        let end: number = first + 1;
        while (group !== undefined && end < cells.length && this.data(cells[end])?.digitGroup === group) {
            end++;
        }
        return end;
    }

    private carrySpacing(rows: ReadonlyArray<StackRow>, widths: Float64Array, low: number): number {
        // §3.6.1.2: the charspacing keywords "automatically adjust spacing to when carries or other entries in a column are wide",
        // so the columns are apart by what two neighbouring carries need not to overlap where their locations put them.
        const lefts: Float64Array = new Float64Array(widths.length + 1);
        for (let column: number = 0; column < widths.length; column++) {
            lefts[column + 1] = lefts[column] + widths[column];
        }
        let spacing: number = 0;
        for (const row of rows) {
            if (row.kind !== "carries") {
                continue;
            }
            const carries: Array<ElementBox> = this.inFlow(row.box);
            let previous: readonly [number, number] | undefined;
            for (const [index, [laid, column]] of row.cells.entries()) {
                if (column - low < 0 || column - low >= widths.length) {
                    continue;
                }
                const location: string = (this.data(carries[index])?.name === "mscarry" ? this.data(carries[index])?.location : undefined) ?? this.data(row.box)?.location ?? "n";
                const left: number = lefts[column - low];
                const right: number = lefts[column - low + 1];
                const start: number = location.endsWith("w") ? left - laid.width : (location.endsWith("e") ? right : left + (right - left - laid.width) / 2);
                if (previous !== undefined && laid.width > 0) {
                    // With a spacing s between columns, this carry moves s further from the previous one for each column between them.
                    const columns: number = column - previous[1];
                    spacing = Math.max(spacing, columns > 0 ? (previous[0] - start) / columns : 0);
                }
                if (laid.width > 0) {
                    previous = [start + laid.width, column];
                }
            }
        }
        return spacing;
    }

    private lineThickness(line: ElementBox, constants: MathConstants): number {
        // §3.6.7.2 and §3.3.2.2: medium is fractionRuleThickness; thin and thick scale it as the keywords next to medium do in
        // CSS Fonts 4 §2.5.1, by 8/9 and 6/5.
        const math: MathElement | undefined = this.data(line);
        if (math?.lineWidth !== undefined) {
            return math.lineWidth;
        }
        const factor: number = math?.lineThickness === "thin" ? 8 / 9 : (math?.lineThickness === "thick" ? 6 / 5 : 1);
        return constants.fractionRuleThickness * factor;
    }

    private stackAscent(math: MathElement, rows: ReadonlyArray<StackRow>, height: number, axis: number): number {
        // §3.6.1.2: align has the values of mtable's: center and baseline center the stack on the baseline, axis on the math axis,
        // top and bottom put those edges there; a row number, negative from the bottom, aligns that row.
        const number: number | undefined = math.alignRow;
        const row: StackRow | undefined = number === undefined ? undefined : rows[number > 0 ? number - 1 : rows.length + number];
        const start: number = row === undefined ? 0 : row.baseline - row.ascent;
        const size: number = row === undefined ? height : row.ascent + row.descent;
        switch (math.tableAlign) {
            case "top":
                return start;
            case "bottom":
                return start + size;
            case "center":
                return start + size / 2;
            case "axis":
                return row !== undefined ? row.baseline : start + size / 2 + axis;
            default:
                return row !== undefined ? row.baseline : start + size / 2;
        }
    }

    private placeCarries(content: MathContent, row: StackRow, below: StackRow | undefined, starts: Float64Array, widths: Float64Array, low: number,
        constants: MathConstants): void {
        // §3.6.5.2: each carry at its compass location around the digit below it, with zero width, and the crossouts of the
        // carries drawn over that digit.
        const mscarries: MathElement | undefined = this.data(row.box);
        const carries: Array<ElementBox> = this.inFlow(row.box);
        row.cells.forEach(([laid, column]: readonly [Laid, number], index: number) => {
            if (column - low < 0 || column - low >= widths.length) {
                return;
            }
            const carry: ElementBox = carries[index];
            const explicit: MathElement | undefined = this.data(carry)?.name === "mscarry" ? this.data(carry) : undefined;
            const isCarry: boolean = explicit !== undefined || !(this.data(carry)?.name === "mrow" && this.inFlow(carry).length === 0);
            const location: string = explicit?.location ?? mscarries?.location ?? "n";
            const left: number = starts[column - low];
            const right: number = left + widths[column - low];
            const digit: readonly [Laid, number] | undefined = below?.cells.find((cell: readonly [Laid, number]) => cell[1] === column);
            let x: number = left + (right - left - laid.width) / 2;
            if (location.endsWith("w")) {
                x = left - laid.width;
            } else if (location.endsWith("e")) {
                x = right;
            }
            let baseline: number = row.baseline;
            if (below !== undefined && (location === "w" || location === "e")) {
                baseline = below.baseline;
            } else if (below !== undefined && location.startsWith("s")) {
                baseline = below.baseline + below.descent + laid.ascent;
            }
            this.place(content.children, laid, x, baseline);
            const crossout: ReadonlyArray<string> = explicit?.crossout ?? mscarries?.crossout ?? [];
            if (!isCarry || digit === undefined || crossout.length === 0) {
                return;
            }
            const top: number = below === undefined ? 0 : below.baseline - digit[0].ascent;
            const bottom: number = below === undefined ? 0 : below.baseline + digit[0].descent;
            const strokes: Array<MathPath> = [];
            const line: (x0: number, y0: number, x1: number, y1: number) => void = (x0: number, y0: number, x1: number, y1: number): void => {
                strokes.push({ lineWidth: constants.overbarRuleThickness, filled: false, commands: [["M", x0, y0], ["L", x1, y1]] });
            };
            for (const value of crossout) {
                if (value === "updiagonalstrike") {
                    line(left, bottom, right, top);
                } else if (value === "downdiagonalstrike") {
                    line(left, top, right, bottom);
                } else if (value === "verticalstrike") {
                    line((left + right) / 2, top, (left + right) / 2, bottom);
                } else if (value === "horizontalstrike") {
                    line(left, (top + bottom) / 2, right, (top + bottom) / 2);
                }
            }
            content.paths = [...(content.paths ?? []), ...strokes];
        });
    }

    private enclosureMetrics(box: ElementBox): readonly [number, number, number] {
        // §3.3.9.2 leaves the distances to the renderer and finds "paddings on each side of 0.4em in the horizontal direction
        // and .5ex in the vertical direction" work well; the lines are as thick as the font's overbar.
        return [ENCLOSURE_INLINE_PADDING * this.metrics.fontSize(box.style.values), ENCLOSURE_BLOCK_PADDING * this.metrics.xHeight(box.style.values),
            this.constants(box).overbarRuleThickness];
    }

    private enclosure(box: ElementBox, notations: ReadonlySet<string>, width: number, height: number): readonly [number, number, number, number] {
        // The room on each side of the inferred mrow that the notations given need, the largest that any of them asks for.
        const [across, down, thickness]: readonly [number, number, number] = this.enclosureMetrics(box);
        const room: [number, number, number, number] = [0, 0, 0, 0];
        const widen: (side: number, value: number) => void = (side: number, value: number): void => {
            room[side] = Math.max(room[side], value);
        };
        if (notations.has("box") || notations.has("roundedbox")) {
            widen(LEFT, across + thickness);
            widen(RIGHT, across + thickness);
            widen(TOP, down + thickness);
            widen(BOTTOM, down + thickness);
        }
        if (notations.has("circle")) {
            // The ellipse passes through the corners of the padded content, with radii √2 times its half sizes.
            const horizontal: number = (width / 2 + across) * Math.SQRT2 - width / 2 + thickness / 2;
            const vertical: number = (height / 2 + down) * Math.SQRT2 - height / 2 + thickness / 2;
            widen(LEFT, horizontal);
            widen(RIGHT, horizontal);
            widen(TOP, vertical);
            widen(BOTTOM, vertical);
        }
        if (notations.has("left") || notations.has("longdiv")) {
            widen(LEFT, across + thickness);
        }
        if (notations.has("right") || notations.has("actuarial") || notations.has("madruwb")) {
            widen(RIGHT, across + thickness);
        }
        if (notations.has("top") || notations.has("actuarial") || notations.has("longdiv")) {
            widen(TOP, down + thickness);
        }
        if (notations.has("bottom") || notations.has("madruwb") || notations.has("phasorangle")) {
            widen(BOTTOM, down + thickness);
        }
        if (notations.has("phasorangle")) {
            // §3.3.9.2: phasorangle alone follows the directionality, so its slanted stroke is on the inline-start side.
            widen(this.keyword(box, "direction") === "rtl" ? RIGHT : LEFT, (height + down + thickness) / 2 + thickness);
        }
        return room;
    }

    private notationPaths(box: ElementBox, notations: ReadonlySet<string>, width: number, height: number, inner: readonly [number, number, number, number],
        room: readonly [number, number, number, number]): Array<MathPath> {
        // The strokes are centered half their thickness inside the edges they stand for; a box, rounded box and circle go around
        // the padded content, the side lines and the strikes over the whole element.
        const [across, down, thickness]: readonly [number, number, number] = this.enclosureMetrics(box);
        const half: number = thickness / 2;
        const paths: Array<MathPath> = [];
        const stroke: (commands: ReadonlyArray<MathPathCommand>) => void = (commands: ReadonlyArray<MathPathCommand>): void => {
            paths.push({ lineWidth: thickness, filled: false, commands });
        };
        const line: (x0: number, y0: number, x1: number, y1: number) => void = (x0: number, y0: number, x1: number, y1: number): void => stroke([["M", x0, y0], ["L", x1, y1]]);
        const left: number = inner[0] - across - half;
        const top: number = inner[1] - down - half;
        const right: number = inner[0] + inner[2] + across + half;
        const bottom: number = inner[1] + inner[3] + down + half;
        if (notations.has("box")) {
            stroke([["M", left, top], ["L", right, top], ["L", right, bottom], ["L", left, bottom], ["Z"]]);
        }
        if (notations.has("roundedbox")) {
            stroke(this.roundedRectangle(left, top, right, bottom, Math.min(down, (right - left) / 2, (bottom - top) / 2)));
        }
        if (notations.has("circle")) {
            stroke(this.ellipse(inner[0] + inner[2] / 2, inner[1] + inner[3] / 2, (inner[2] / 2 + across) * Math.SQRT2, (inner[3] / 2 + down) * Math.SQRT2));
        }
        if (notations.has("left")) {
            line(half, 0, half, height);
        }
        if (notations.has("right") || notations.has("actuarial")) {
            line(width - half, 0, width - half, height);
        }
        if (notations.has("top") || notations.has("actuarial")) {
            line(0, half, width, half);
        }
        if (notations.has("bottom")) {
            line(0, height - half, width, height - half);
        }
        if (notations.has("madruwb")) {
            // The Arabic factorial of §3.3.9.3: a stroke down the right side that turns into one along the bottom.
            const radius: number = Math.min(down, width / 2, height / 2);
            stroke([["M", width - half, 0], ["L", width - half, height - half - radius],
                ["C", width - half, height - half - radius + radius * KAPPA, width - half - radius + radius * KAPPA, height - half, width - half - radius, height - half],
                ["L", 0, height - half]]);
        }
        if (notations.has("longdiv")) {
            // The deprecated longdiv: a closing parenthesis before the content under a line, as mlongdiv draws it.
            const bulge: number = room[LEFT] - half;
            stroke([["M", 0, half], ["L", width, half]]);
            stroke([["M", half, half], ["C", bulge, height / 4, bulge, height * 3 / 4, half, height - half]]);
        }
        if (notations.has("phasorangle")) {
            const rtl: boolean = this.keyword(box, "direction") === "rtl";
            const x: (value: number) => number = (value: number): number => rtl ? width - value : value;
            const slant: number = room[rtl ? RIGHT : LEFT] - thickness;
            line(x(half), height - half, x(slant + half), half);
            line(x(half), height - half, x(width), height - half);
        }
        if (notations.has("updiagonalstrike")) {
            line(0, height, width, 0);
        }
        if (notations.has("downdiagonalstrike")) {
            line(0, 0, width, height);
        }
        if (notations.has("verticalstrike")) {
            line(width / 2, 0, width / 2, height);
        }
        if (notations.has("horizontalstrike")) {
            line(0, height / 2, width, height / 2);
        }
        for (const [name, [x0, y0, x1, y1, both]] of ARROWS) {
            if (notations.has(name)) {
                paths.push(...this.arrow(x0 * width, y0 * height, x1 * width, y1 * height, both, thickness));
            }
        }
        return paths;
    }

    private arrow(x0: number, y0: number, x1: number, y1: number, both: boolean, thickness: number): Array<MathPath> {
        // A shaft between the two points and a filled head at the end, and at the start too for a double arrow.
        const length: number = Math.hypot(x1 - x0, y1 - y0);
        if (length === 0) {
            return [];
        }
        const dx: number = (x1 - x0) / length;
        const dy: number = (y1 - y0) / length;
        const head: number = Math.min(ARROW_LENGTH * thickness, both ? length / 2 : length);
        const wing: number = ARROW_HALF_WIDTH * thickness;
        const tip: (x: number, y: number, sign: number) => MathPath = (x: number, y: number, sign: number): MathPath => {
            const baseX: number = x - sign * dx * head;
            const baseY: number = y - sign * dy * head;
            return { lineWidth: 0, filled: true, commands: [["M", x, y], ["L", baseX - dy * wing, baseY + dx * wing], ["L", baseX + dy * wing, baseY - dx * wing], ["Z"]] };
        };
        const start: number = both ? head : 0;
        const paths: Array<MathPath> = [{ lineWidth: thickness, filled: false, commands: [["M", x0 + dx * start, y0 + dy * start], ["L", x1 - dx * head, y1 - dy * head]] }];
        paths.push(tip(x1, y1, 1));
        if (both) {
            paths.push(tip(x0, y0, -1));
        }
        return paths;
    }

    private roundedRectangle(left: number, top: number, right: number, bottom: number, radius: number): Array<MathPathCommand> {
        const k: number = radius * (1 - KAPPA);
        return [
            ["M", left + radius, top], ["L", right - radius, top], ["C", right - k, top, right, top + k, right, top + radius],
            ["L", right, bottom - radius], ["C", right, bottom - k, right - k, bottom, right - radius, bottom],
            ["L", left + radius, bottom], ["C", left + k, bottom, left, bottom - k, left, bottom - radius],
            ["L", left, top + radius], ["C", left, top + k, left + k, top, left + radius, top], ["Z"]
        ];
    }

    private ellipse(x: number, y: number, rx: number, ry: number): Array<MathPathCommand> {
        // Four cubic curves, one for each quadrant.
        const kx: number = rx * KAPPA;
        const ky: number = ry * KAPPA;
        return [
            ["M", x + rx, y], ["C", x + rx, y + ky, x + kx, y + ry, x, y + ry], ["C", x - kx, y + ry, x - rx, y + ky, x - rx, y],
            ["C", x - rx, y - ky, x - kx, y - ry, x, y - ry], ["C", x + kx, y - ry, x + rx, y - ky, x + rx, y], ["Z"]
        ];
    }

    private enclosedSizes(box: ElementBox, children: ReadonlyArray<ElementBox>): readonly [number, number] {
        // The room the notations take depends on the height of the content, which math layout knows without an available width.
        const notations: ReadonlySet<string> = new Set<string>((this.data(box) as MathElement).notations ?? []);
        const inner: MathContent = this.anonymousRow(children);
        const signWidth: number = notations.has("radical") ? this.radicalWidth(box) : 0;
        const rtl: boolean = this.keyword(box, "direction") === "rtl";
        const result: Array<number> = this.rowSizes(undefined, children).map((size: number): number => {
            const room: readonly [number, number, number, number] = this.enclosure(box, notations, size, inner.ascent + inner.descent);
            return Math.max(room[rtl ? RIGHT : LEFT], signWidth) + size + room[rtl ? LEFT : RIGHT];
        });
        return [result[0], result[1]];
    }

    private root(box: ElementBox, children: ReadonlyArray<ElementBox>): MathContent {
        // §3.3.3.3: the base and the radical sign make a box B as in msqrt, and the index goes before it, kerned, raised from
        // the line-under edge of B by RadicalDegreeBottomRaisePercent of its block size.
        const constants: MathConstants = this.constants(box);
        const base: Laid = this.laid(children[0]);
        const inner: MathContent = { width: base.width, ascent: base.ascent, descent: base.descent, inkAscent: base.inkAscent, inkDescent: base.inkDescent, children: [] };
        this.place(inner.children, base, 0, base.ascent);
        const radical: MathContent = this.radical(box, inner);
        const index: Laid = this.laid(children[1]);
        const before: number = Math.max(0, constants.radicalKernBeforeDegree);
        const after: number = Math.max(-index.width, constants.radicalKernAfterDegree);
        // The index's margin box ends RadicalDegreeBottomRaisePercent of B above B's line-under edge, and Figure 15 encloses it.
        const raise: number = constants.radicalDegreeBottomRaisePercent * (radical.ascent + radical.descent);
        const ascent: number = Math.max(-radical.descent + raise + index.descent + index.ascent, radical.ascent);
        const descent: number = Math.max(radical.descent - raise, radical.descent);
        const content: MathContent = { width: before + index.width + after + radical.width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        this.include(content, radical, before + index.width + after, ascent - radical.ascent);
        this.place(content.children, index, before, ascent + radical.descent - raise - index.descent);
        return content;
    }

    private padded(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.3.6: the mpadded inner box, an anonymous <mrow> box, in a box of the requested width, height and depth, moved by
        // lspace and voffset; the requested depth is the line-descent, so without a depth attribute it is the inner one (Figure 16).
        const math: MathElement = this.data(box) as MathElement;
        const inner: MathContent = this.anonymousRow(children, stretch);
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        const ascent: number = math.height ?? inner.ascent;
        const descent: number = math.depth ?? inner.descent;
        const content: MathContent = { width: sizes.inlineSize ?? inner.width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        this.include(content, inner, math.paddedSpace ?? 0, ascent - (math.voffset ?? 0) - inner.ascent);
        return content;
    }

    private scripts(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch: Stretch | undefined, kind: number): MathContent {
        // §3.4.1: the scripts after the base, shifted from its alphabetic baseline by SubShift and SuperShift, the superscript
        // after the italic correction of a base that is not a large operator, the subscript before that of one that is.
        if (children.length !== (kind === BOTH_SCRIPTS ? 3 : 2)) {
            return this.rowOf(box, children, stretch);
        }
        const base: Laid = this.laid(children[0], stretch);
        const sub: Laid | undefined = kind === SUPERSCRIPT ? undefined : this.laid(children[1]);
        const sup: Laid | undefined = kind === SUBSCRIPT ? undefined : this.laid(children[kind === SUPERSCRIPT ? 1 : 2]);
        const constants: MathConstants = this.constants(box);
        const largeop: boolean = base.operator?.largeop === true;
        const lowered: number = largeop ? base.italic ?? 0 : 0;
        const raised: number = largeop ? 0 : base.italic ?? 0;
        const shifts: readonly [number, number] = this.shifts(box, constants, base, sub, sup);
        const space: number = constants.spaceAfterScript;
        let width: number = base.width;
        let ascent: number = base.ascent;
        let descent: number = base.descent;
        if (sub !== undefined) {
            width = Math.max(width, base.width - lowered + sub.width + space);
            ascent = Math.max(ascent, sub.ascent - shifts[0]);
            descent = Math.max(descent, sub.descent + shifts[0]);
        }
        if (sup !== undefined) {
            width = Math.max(width, base.width + raised + sup.width + space);
            ascent = Math.max(ascent, sup.ascent + shifts[1]);
            descent = Math.max(descent, sup.descent - shifts[1]);
        }
        const content: MathContent = { width, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        this.place(content.children, base, 0, ascent);
        if (sub !== undefined) {
            this.place(content.children, sub, base.width - lowered, ascent + shifts[0]);
        }
        if (sup !== undefined) {
            this.place(content.children, sup, base.width + raised, ascent - shifts[1]);
        }
        return content;
    }

    private shifts(box: ElementBox, constants: MathConstants, base: Metrics, sub?: Metrics, sup?: Metrics): readonly [number, number] {
        // §3.4.1.2 to §3.4.1.4: the gap between two scripts widens to SubSuperscriptGapMin by raising the superscript up to
        // SuperscriptBottomMaxWithSubscript, then by lowering the subscript; MathML 4 §3.4.1.2: the shift attributes are minimums.
        let subShift: number = sub === undefined ? 0 : Math.max(constants.subscriptShiftDown, sub.inkAscent - constants.subscriptTopMax,
            constants.subscriptBaselineDropMin + base.inkDescent, this.data(box)?.subscriptShift ?? Number.NEGATIVE_INFINITY);
        let superShift: number = sup === undefined ? 0 : Math.max(this.keyword(box, "math-shift") === "compact" ? constants.superscriptShiftUpCramped : constants.superscriptShiftUp,
            constants.superscriptBottomMin + sup.inkDescent, base.inkAscent - constants.superscriptBaselineDropMax, this.data(box)?.superscriptShift ?? Number.NEGATIVE_INFINITY);
        if (sub !== undefined && sup !== undefined) {
            let gap: number = (subShift - sub.inkAscent) + (superShift - sup.inkDescent);
            if (gap < constants.subSuperscriptGapMin) {
                let delta: number = constants.superscriptBottomMaxWithSubscript - (superShift - sup.inkDescent);
                if (delta > 0) {
                    delta = Math.min(delta, constants.subSuperscriptGapMin - gap);
                    superShift += delta;
                    gap += delta;
                }
                delta = constants.subSuperscriptGapMin - gap;
                if (delta > 0) {
                    subShift += delta;
                }
            }
        }
        return [subShift, superShift];
    }

    private limits(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.4.2: under and over scripts centered on the base, or laid out as scripts in the compact math style when the
        // base is an embellished operator with movablelimits.
        const math: MathElement = this.data(box) as MathElement;
        if (children.length !== (math.name === "munderover" ? 3 : 2)) {
            return this.rowOf(box, children, stretch);
        }
        if (this.keyword(box, "math-style") === "compact" && this.operatorFor(children[0])?.movablelimits === true) {
            return this.scripts(box, children, stretch, math.name === "munder" ? SUBSCRIPT : (math.name === "mover" ? SUPERSCRIPT : BOTH_SCRIPTS));
        }
        const laid: Array<Laid> = this.inlineStretched(children, stretch);
        const base: Laid = laid[0];
        const under: Laid | undefined = math.name === "mover" ? undefined : laid[1];
        const over: Laid | undefined = math.name === "munder" ? undefined : laid[math.name === "mover" ? 1 : 2];
        const constants: MathConstants = this.constants(box);
        const largeop: boolean = base.operator?.largeop === true;
        const stretchedBase: boolean = base.operator !== undefined && base.operator.stretchy && base.operator.inline;
        const correction: number = largeop ? base.italic ?? 0 : 0;
        // MathML 4 §3.4.4.2: align puts the scripts left, center or right under and over the base, the base spanning
        // −width/2 to width/2 here.
        const centered: boolean = (math.scriptAlign ?? "center") === "center";
        const factor: number = this.alignFactor(box, math.scriptAlign);
        const aligned: (width: number) => number = (width: number): number => -base.width / 2 + factor * (base.width - width);
        let high: number = base.width / 2;
        let low: number = -base.width / 2;
        let ascent: number = base.ascent;
        let descent: number = base.descent;
        let underShift: number = 0;
        let overShift: number = 0;
        let underStart: number = 0;
        if (under !== undefined) {
            underStart = (centered ? -under.width / 2 : aligned(under.width)) - correction / 2;
            high = Math.max(high, underStart + under.width);
            low = Math.min(low, underStart);
            let extra: number = 0;
            if (largeop) {
                underShift = Math.max(constants.lowerLimitBaselineDropMin, constants.lowerLimitGapMin + under.ascent);
            } else if (stretchedBase) {
                underShift = Math.max(constants.stretchStackBottomShiftDown, constants.stretchStackGapAboveMin + under.ascent);
            } else {
                // Figure 20 measures UnderShift to the underscript's baseline and the gap to its top, as the first two cases do.
                underShift = (math.accentunder === true ? 0 : constants.underbarVerticalGap) + under.ascent;
                extra = constants.underbarExtraDescender;
            }
            // The underscript's baseline is the base's ink line-descent + UnderShift below the baseline, and the box holds it.
            ascent = Math.max(ascent, under.ascent - base.inkDescent - underShift);
            descent = Math.max(descent, base.inkDescent + underShift + under.descent + extra);
        }
        let overStart: number = 0;
        if (over !== undefined) {
            overStart = (centered ? -(over.accent ?? over.width / 2) : aligned(over.width)) + correction / 2;
            high = Math.max(high, overStart + over.width);
            low = Math.min(low, overStart);
            let extra: number = 0;
            if (largeop) {
                overShift = Math.max(constants.upperLimitBaselineRiseMin, constants.upperLimitGapMin + over.descent);
            } else if (stretchedBase) {
                overShift = Math.max(constants.stretchStackTopShiftUp, constants.stretchStackGapBelowMin + over.descent);
            } else {
                // Figure 21 and the note: the gap is to "the bottom of overscript", and OverShift to its baseline.
                overShift = (math.accent !== true ? constants.overbarVerticalGap : Math.max(0, constants.accentBaseHeight - base.ascent)) + over.descent;
                extra = constants.overbarExtraAscender;
            }
            ascent = Math.max(ascent, base.inkAscent + overShift + over.ascent + extra);
            descent = Math.max(descent, over.descent - base.inkAscent - overShift);
        }
        const content: MathContent = { width: high - low, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [], centered: true };
        this.place(content.children, base, -low - base.width / 2, ascent);
        if (under !== undefined) {
            this.place(content.children, under, -low + underStart, ascent + base.inkDescent + underShift);
        }
        if (over !== undefined) {
            // Centered, the overscript's top accent attachment is on the middle of the base, moved by the correction.
            this.place(content.children, over, -low + overStart, ascent - base.inkAscent - overShift);
        }
        return content;
    }

    private inlineStretched(children: ReadonlyArray<ElementBox>, stretch?: Stretch): Array<Laid> {
        // §3.4.2.2: the embellished operators that stretch along the inline axis cover the widest of the other scripts, or
        // zero when there are no others; the base of a box being stretched takes its constraint.
        const laid: Array<Laid | undefined> = new Array<Laid | undefined>(children.length).fill(undefined);
        const stretching: Array<number> = [];
        const measured: Array<Laid> = [];
        for (const [index, child] of children.entries()) {
            if (index === 0 && stretch !== undefined) {
                laid[index] = this.laid(child, stretch);
                continue;
            }
            const operator: Operator | undefined = this.operatorFor(child);
            if (operator !== undefined && operator.stretchy && operator.inline) {
                stretching.push(index);
            } else {
                const other: Laid = this.laid(child);
                laid[index] = other;
                measured.push(other);
            }
        }
        if (stretching.length > 0) {
            const first: Array<Laid> = measured.length > 0 ? measured : stretching.map((index: number): Laid => this.laid(children[index], { inline: 0 }));
            const target: number = Math.max(...first.map((child: Laid) => child.width));
            for (const index of stretching) {
                laid[index] = this.laid(children[index], { inline: target });
            }
        }
        return laid as Array<Laid>;
    }

    private multiscripts(box: ElementBox, children: ReadonlyArray<ElementBox>, stretch?: Stretch): MathContent {
        // §3.4.3: the prescripts before the base and the postscripts after it, in subscript/superscript pairs, each pair shifted
        // by the largest SubShift and SuperShift of all the pairs.
        const split: readonly [ReadonlyArray<ElementBox>, ReadonlyArray<ElementBox>, ElementBox | undefined] | undefined = this.scriptLists(children);
        if (split === undefined) {
            return this.rowOf(box, children, stretch);
        }
        const base: Laid = this.laid(children[0], stretch);
        const post: Array<Laid> = split[0].map((child: ElementBox): Laid => this.laid(child));
        const pre: Array<Laid> = split[1].map((child: ElementBox): Laid => this.laid(child));
        const separator: Laid | undefined = split[2] === undefined ? undefined : this.laid(split[2]);
        const constants: MathConstants = this.constants(box);
        const largeop: boolean = base.operator?.largeop === true;
        const lowered: number = largeop ? base.italic ?? 0 : 0;
        const raised: number = largeop ? 0 : base.italic ?? 0;
        const space: number = constants.spaceAfterScript;
        let subShift: number = 0;
        let superShift: number = 0;
        const pairs: Array<Laid> = [...post, ...pre];
        for (let index: number = 0; index < pairs.length; index += 2) {
            const shifts: readonly [number, number] = this.shifts(box, constants, base, pairs[index], pairs[index + 1]);
            subShift = Math.max(subShift, shifts[0]);
            superShift = Math.max(superShift, shifts[1]);
        }
        let ascent: number = Math.max(base.ascent, separator?.ascent ?? 0);
        let descent: number = Math.max(base.descent, separator?.descent ?? 0);
        for (let index: number = 0; index < pairs.length; index += 2) {
            ascent = Math.max(ascent, pairs[index].ascent - subShift, pairs[index + 1].ascent + superShift);
            descent = Math.max(descent, pairs[index].descent + subShift, pairs[index + 1].descent - superShift);
        }
        const content: MathContent = { width: 0, ascent, descent, inkAscent: ascent, inkDescent: descent, children: [] };
        let offset: number = 0;
        for (let index: number = 0; index < pre.length; index += 2) {
            offset += space;
            const pair: number = Math.max(pre[index].width, pre[index + 1].width);
            this.place(content.children, pre[index], offset + pair - pre[index].width, ascent + subShift);
            this.place(content.children, pre[index + 1], offset + pair - pre[index + 1].width, ascent - superShift);
            offset += pair;
        }
        this.place(content.children, base, offset, ascent);
        if (separator !== undefined) {
            this.place(content.children, separator, offset, ascent);
        }
        // The note of §3.4.3.1 lays one pair of postscripts out as <msubsup>, after the base, as the inline size counts it.
        offset += base.width;
        let width: number = offset;
        for (let index: number = 0; index < post.length; index += 2) {
            const pair: number = Math.max(post[index].width, post[index + 1].width);
            this.place(content.children, post[index], offset - lowered, ascent + subShift);
            this.place(content.children, post[index + 1], offset + raised, ascent - superShift);
            width = Math.max(width, offset - lowered + post[index].width + space, offset + raised + post[index + 1].width + space);
            offset += pair + space;
        }
        content.width = width;
        return content;
    }

    private scriptLists(children: ReadonlyArray<ElementBox>): readonly [ReadonlyArray<ElementBox>, ReadonlyArray<ElementBox>, ElementBox | undefined] | undefined {
        // §3.4.3: a base that is not <mprescripts>, an even number of postscripts, then optionally <mprescripts> and an even
        // number of prescripts.
        if (children.length === 0 || this.isPrescripts(children[0])) {
            return undefined;
        }
        const separator: number = children.findIndex((child: ElementBox, index: number) => index > 0 && this.isPrescripts(child));
        const post: ReadonlyArray<ElementBox> = children.slice(1, separator < 0 ? children.length : separator);
        const pre: ReadonlyArray<ElementBox> = separator < 0 ? [] : children.slice(separator + 1);
        if (post.length % 2 !== 0 || pre.length % 2 !== 0 || pre.some((child: ElementBox) => this.isPrescripts(child))) {
            return undefined;
        }
        return [post, pre, separator < 0 ? undefined : children[separator]];
    }

    private isPrescripts(box: ElementBox): boolean {
        return this.isMath(box) && this.data(box)?.name === "mprescripts";
    }

    private intrinsic(box: ElementBox): readonly [number, number] {
        // §3.1.2 and each layout of §3: the min-content and max-content inline sizes of the math content, from those of the
        // margin boxes of the children; an italic correction or accent attachment that is not known counts as its fallback.
        const children: Array<ElementBox> = this.inFlow(box);
        const path: ElementBox | undefined = this.pathChild(box, children);
        for (const child of children) {
            if (child !== path) {
                this.assign(child, box, children);
            }
        }
        const name: string = (this.data(box) as MathElement).name;
        if (TOKENS.has(name)) {
            return this.host.blockContentSizes(box);
        }
        switch (name) {
            case "mo":
                return this.operatorSizes(box);
            case "mspace": {
                const width: number = this.sizes.of(box.style, undefined, undefined, 0).inlineSize ?? 0;
                return [width, width];
            }
            case "mfrac": {
                if (children.length !== 2) {
                    return this.rowSizes(box, children);
                }
                const numerator: readonly [number, number] = this.childSizes(children[0]);
                const denominator: readonly [number, number] = this.childSizes(children[1]);
                const gap: number = this.constants(box).skewedFractionHorizontalGap;
                return (this.data(box) as MathElement).bevelled === true ? [numerator[0] + gap + denominator[0], numerator[1] + gap + denominator[1]] : this.widest(numerator, denominator);
            }
            case "msqrt":
                return this.added(this.radicalWidth(box), this.rowSizes(undefined, children));
            case "mroot":
                return children.length === 2 ? this.rootSizes(box, children) : this.rowSizes(box, children);
            case "mpadded":
                return this.rowSizes(undefined, children);
            case "menclose":
                return this.enclosedSizes(box, children);
            case "mstack":
            case "mlongdiv": {
                // The layout of a stack does not depend on the available width.
                const width: number = (name === "mstack" || children.length < 2 ? this.stack(box, children) : this.longDivision(box, children)).width;
                return [width, width];
            }
            case "msub":
            case "msup":
            case "msubsup":
                return this.scriptSizes(box, children, name === "msub" ? SUBSCRIPT : (name === "msup" ? SUPERSCRIPT : BOTH_SCRIPTS));
            case "munder":
            case "mover":
            case "munderover":
                return this.limitSizes(box, children);
            case "mmultiscripts":
                return this.multiscriptSizes(box, children);
            default:
                return this.rowSizes(box, children);
        }
    }

    private childSizes(box: ElementBox): readonly [number, number] {
        // The contributions of a child's margin box, with a width that the child gives itself; a table's columns do not depend
        // on the width available to it.
        if (this.data(box)?.name === "mtable") {
            const width: number = this.table(box).width;
            return [width, width];
        }
        if (!this.isMath(box)) {
            return this.host.intrinsic(box);
        }
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        const content: readonly [number, number] = sizes.inlineSize === undefined ? this.intrinsic(box) : [sizes.inlineSize, sizes.inlineSize];
        const edges: number = this.sizes.edges(sizes, BoxSizes.INLINE_START) + this.sizes.edges(sizes, BoxSizes.INLINE_END) + (this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0)
            + (this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0);
        return [this.clamped(content[0], sizes.minInlineSize, sizes.maxInlineSize) + edges, this.clamped(content[1], sizes.minInlineSize, sizes.maxInlineSize) + edges];
    }

    private operatorSizes(box: ElementBox): readonly [number, number] {
        // §3.2.4.3: an operator that stretches along the block axis, or is drawn large, measures as the preferred inline size of
        // its glyph stretched along the block axis.
        const text: string | undefined = this.operatorText(box);
        const code: number | undefined = text !== undefined && [...text].length === 1 ? text.codePointAt(0) : undefined;
        const found: readonly [FontInstance, number] | undefined = code === undefined ? undefined : this.glyphFor(code, box);
        const operator: Operator = this.operatorOf(box);
        if (found !== undefined && ((operator.stretchy && !operator.inline) || (!operator.stretchy && operator.largeop && this.keyword(box, "math-style") === "normal"))
            && this.mathTable(found[0]).construction(found[1], false) !== undefined) {
            const width: number = this.preferredWidth(found[0], this.metrics.usedSize(box.style.values, found[0]), found[1]);
            return [width, width];
        }
        return this.host.blockContentSizes(box);
    }

    private rowSizes(box: ElementBox | undefined, children: ReadonlyArray<ElementBox>): readonly [number, number] {
        // §3.3.1.2: an anonymous row adds the spaces of operators unless it is itself an embellished operator.
        const addSpace: boolean = box === undefined ? this.groupCore(children) === undefined : (this.data(box) as MathElement).name === "math" || this.core(box) === undefined;
        let low: number = 0;
        let high: number = 0;
        let previous: number = 0;
        for (const child of children) {
            const sizes: readonly [number, number] = this.childSizes(child);
            const operator: Operator | undefined = this.operatorFor(child);
            const italic: number = operator === undefined ? this.italicOf(child) : 0;
            const before: number = (italic !== 0 ? 0 : previous) + (operator !== undefined && addSpace ? operator.lspace : 0);
            const after: number = operator !== undefined && addSpace ? operator.rspace : 0;
            low += before + sizes[0] + after;
            high += before + sizes[1] + after;
            previous = italic;
        }
        return [low + previous, high + previous];
    }

    private italicOf(box: ElementBox): number {
        // The italic correction of a child's margin box where it is known without layout: a single glyph of a token, or the last
        // child of a row; 0 is the fallback.
        if (!this.isMath(box)) {
            return 0;
        }
        const name: string = (this.data(box) as MathElement).name;
        let italic: number | undefined;
        if (TOKENS.has(name) || name === "mo") {
            const text: InlineText | undefined = box.inline?.[0]?.text;
            const font: FontInstance | undefined = text?.runs[0]?.font;
            if (text !== undefined && font !== undefined && text.glyphs.length === 1) {
                const value: number | undefined = this.mathTable(font).italicsCorrection(text.glyphs[0]);
                italic = value === undefined ? undefined : value * text.runs[0].size / font.metrics.unitsPerEm;
            }
        } else if (GROUPING.has(name)) {
            const children: Array<ElementBox> = this.inFlow(box);
            const last: ElementBox | undefined = children[children.length - 1];
            italic = last === undefined || this.operatorFor(last) !== undefined ? undefined : this.italicOf(last);
        }
        if (italic === undefined) {
            return 0;
        }
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        return italic + this.sizes.edges(sizes, BoxSizes.INLINE_END) + (this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0);
    }

    private accentOf(box: ElementBox): number | undefined {
        // §3.2.1.1: a token element of a single glyph has the top accent attachment of that glyph, which the margin box moves
        // by its inline-start edges, as the layout does; other boxes have none.
        if (!this.isMath(box) || !(TOKENS.has((this.data(box) as MathElement).name) || (this.data(box) as MathElement).name === "mo")) {
            return undefined;
        }
        const text: InlineText | undefined = box.inline?.[0]?.text;
        const font: FontInstance | undefined = text?.runs[0]?.font;
        const value: number | undefined = text === undefined || font === undefined || text.glyphs.length !== 1 ? undefined
            : this.mathTable(font).topAccentAttachment(text.glyphs[0]);
        if (text === undefined || font === undefined || value === undefined) {
            return undefined;
        }
        const sizes: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        return value * text.runs[0].size / font.metrics.unitsPerEm + this.sizes.edges(sizes, BoxSizes.INLINE_START) + (this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0);
    }

    private rootSizes(box: ElementBox, children: ReadonlyArray<ElementBox>): readonly [number, number] {
        // §3.3.3.3: "the sum of max(0, RadicalKernBeforeDegree), the mroot index's min-content inline size", "max(−min-content
        // inline size, RadicalKernAfterDegree)" and the size of B.
        const constants: MathConstants = this.constants(box);
        const index: readonly [number, number] = this.childSizes(children[1]);
        const inner: readonly [number, number] = this.added(this.radicalWidth(box), this.childSizes(children[0]));
        const before: number = Math.max(0, constants.radicalKernBeforeDegree);
        return [before + index[0] + Math.max(-index[0], constants.radicalKernAfterDegree) + inner[0],
            before + index[1] + Math.max(-index[1], constants.radicalKernAfterDegree) + inner[1]];
    }

    private scriptSizes(box: ElementBox, children: ReadonlyArray<ElementBox>, kind: number): readonly [number, number] {
        if (children.length !== (kind === BOTH_SCRIPTS ? 3 : 2)) {
            return this.rowSizes(box, children);
        }
        const constants: MathConstants = this.constants(box);
        const base: readonly [number, number] = this.childSizes(children[0]);
        const largeop: boolean = this.operatorFor(children[0])?.largeop === true;
        const italic: number = this.italicOf(children[0]);
        const result: [number, number] = [base[0], base[1]];
        if (kind !== SUPERSCRIPT) {
            const sub: readonly [number, number] = this.childSizes(children[1]);
            const lowered: number = largeop ? italic : 0;
            result[0] = Math.max(result[0], base[0] - lowered + sub[0] + constants.spaceAfterScript);
            result[1] = Math.max(result[1], base[1] - lowered + sub[1] + constants.spaceAfterScript);
        }
        if (kind !== SUBSCRIPT) {
            const sup: readonly [number, number] = this.childSizes(children[kind === SUPERSCRIPT ? 1 : 2]);
            const raised: number = largeop ? 0 : italic;
            result[0] = Math.max(result[0], base[0] + raised + sup[0] + constants.spaceAfterScript);
            result[1] = Math.max(result[1], base[1] + raised + sup[1] + constants.spaceAfterScript);
        }
        return result;
    }

    private limitSizes(box: ElementBox, children: ReadonlyArray<ElementBox>): readonly [number, number] {
        // §3.4.2.3 to §3.4.2.5: the inline size computed with the min-content or the max-content sizes of the children, and
        // the overscript's top accent attachment, or half of its size when it has none.
        const name: string = (this.data(box) as MathElement).name;
        if (children.length !== (name === "munderover" ? 3 : 2)) {
            return this.rowSizes(box, children);
        }
        if (this.keyword(box, "math-style") === "compact" && this.operatorFor(children[0])?.movablelimits === true) {
            return this.scriptSizes(box, children, name === "munder" ? SUBSCRIPT : (name === "mover" ? SUPERSCRIPT : BOTH_SCRIPTS));
        }
        const correction: number = this.operatorFor(children[0])?.largeop === true ? this.italicOf(children[0]) : 0;
        const base: readonly [number, number] = this.childSizes(children[0]);
        const under: readonly [number, number] | undefined = name === "mover" ? undefined : this.childSizes(children[1]);
        const over: readonly [number, number] | undefined = name === "munder" ? undefined : this.childSizes(children[name === "mover" ? 1 : 2]);
        const accent: number | undefined = name === "munder" ? undefined : this.accentOf(children[name === "mover" ? 1 : 2]);
        const align: string | undefined = (this.data(box) as MathElement).scriptAlign;
        const centered: boolean = (align ?? "center") === "center";
        const factor: number = this.alignFactor(box, align);
        const result: Array<number> = [];
        for (let which: number = 0; which < 2; which++) {
            let high: number = base[which] / 2;
            let low: number = -base[which] / 2;
            if (under !== undefined) {
                const start: number = (centered ? -under[which] / 2 : -base[which] / 2 + factor * (base[which] - under[which])) - correction / 2;
                high = Math.max(high, start + under[which]);
                low = Math.min(low, start);
            }
            if (over !== undefined) {
                const start: number = (centered ? -(accent ?? over[which] / 2) : -base[which] / 2 + factor * (base[which] - over[which])) + correction / 2;
                high = Math.max(high, start + over[which]);
                low = Math.min(low, start);
            }
            result.push(high - low);
        }
        return [result[0], result[1]];
    }

    private multiscriptSizes(box: ElementBox, children: ReadonlyArray<ElementBox>): readonly [number, number] {
        const split: readonly [ReadonlyArray<ElementBox>, ReadonlyArray<ElementBox>, ElementBox | undefined] | undefined = this.scriptLists(children);
        if (split === undefined) {
            return this.rowSizes(box, children);
        }
        const space: number = this.constants(box).spaceAfterScript;
        const largeop: boolean = this.operatorFor(children[0])?.largeop === true;
        const italic: number = this.italicOf(children[0]);
        const lowered: number = largeop ? italic : 0;
        const raised: number = largeop ? 0 : italic;
        const base: readonly [number, number] = this.childSizes(children[0]);
        const result: Array<number> = [];
        for (let which: number = 0; which < 2; which++) {
            let offset: number = 0;
            for (let index: number = 0; index < split[1].length; index += 2) {
                offset += space + Math.max(this.childSizes(split[1][index])[which], this.childSizes(split[1][index + 1])[which]);
            }
            offset += base[which];
            let width: number = offset;
            for (let index: number = 0; index < split[0].length; index += 2) {
                const sub: number = this.childSizes(split[0][index])[which];
                const sup: number = this.childSizes(split[0][index + 1])[which];
                width = Math.max(width, offset - lowered + sub + space, offset + raised + sup + space);
                offset += Math.max(sub, sup) + space;
            }
            result.push(width);
        }
        return [result[0], result[1]];
    }

    private widest(first: readonly [number, number], second: readonly [number, number]): readonly [number, number] {
        return [Math.max(first[0], second[0]), Math.max(first[1], second[1])];
    }

    private added(width: number, sizes: readonly [number, number]): readonly [number, number] {
        return [width + sizes[0], width + sizes[1]];
    }

    private inFlow(box: ElementBox): Array<ElementBox> {
        return box.children.filter((node: BoxNode): node is ElementBox => node.kind === "box" && node.placement === "in-flow");
    }

    private core(box: ElementBox): ElementBox | undefined {
        // §3.2.4.1: the core operator of an embellished operator, the <mo> element at the end of its embellished path.
        const known: ElementBox | null | undefined = this.cores.get(box);
        if (known !== undefined) {
            return known ?? undefined;
        }
        let core: ElementBox | undefined;
        const name: string | undefined = this.isMath(box) ? this.data(box)?.name : undefined;
        if (name === "mo") {
            core = box;
        } else if (name !== undefined && (SCRIPTED.has(name) || name === "mfrac")) {
            const first: ElementBox | undefined = this.inFlow(box)[0];
            core = first === undefined ? undefined : this.core(first);
        } else if (name !== undefined && (GROUPING.has(name) || name === "mpadded")) {
            core = this.groupCore(this.inFlow(box));
        }
        this.cores.set(box, core ?? null);
        return core;
    }

    private groupCore(children: ReadonlyArray<ElementBox>): ElementBox | undefined {
        // "whose in-flow children consist (in any order) of one embellished operator and zero or more space-like elements".
        let core: ElementBox | undefined;
        for (const child of children) {
            const own: ElementBox | undefined = this.core(child);
            if (own !== undefined && core === undefined) {
                core = own;
            } else if (own !== undefined || !this.isSpaceLike(child)) {
                return undefined;
            }
        }
        return core;
    }

    private isSpaceLike(box: ElementBox): boolean {
        // §3.2.5.1: mtext, mspace, and a grouping element or mpadded "all of whose in-flow children are space-like".
        const name: string | undefined = this.isMath(box) ? this.data(box)?.name : undefined;
        if (name === undefined) {
            return false;
        }
        if (SPACE_LIKE.has(name)) {
            return true;
        }
        return (GROUPING.has(name) || name === "mpadded") && this.inFlow(box).every((child: ElementBox) => this.isSpaceLike(child));
    }

    private pathChild(box: ElementBox, children: ReadonlyArray<ElementBox>): ElementBox | undefined {
        // The child through which an embellished operator reaches its core operator.
        if (this.core(box) === undefined) {
            return undefined;
        }
        const name: string = (this.data(box) as MathElement).name;
        if (SCRIPTED.has(name) || name === "mfrac") {
            return children[0];
        }
        return children.find((child: ElementBox) => this.core(child) !== undefined);
    }

    private assign(box: ElementBox, parent: ElementBox | undefined, siblings: ReadonlyArray<ElementBox>): void {
        const core: ElementBox | undefined = this.core(box);
        if (core !== undefined) {
            this.operators.set(core, this.properties(core, this.form(box, core, parent, siblings)));
        }
    }

    private form(embellished: ElementBox, core: ElementBox, parent: ElementBox | undefined, siblings: ReadonlyArray<ElementBox>): readonly [string, boolean] {
        // §3.2.4.2, "the algorithm for determining the form of an embellished operator".
        const explicit: string | undefined = this.data(core)?.form;
        if (explicit !== undefined) {
            return [explicit, true];
        }
        const name: string | undefined = this.data(parent)?.name;
        if (name !== undefined && (GROUPING.has(name) || name === "mpadded" || name === "msqrt")) {
            const counted: Array<ElementBox> = siblings.filter((sibling: ElementBox) => !this.isSpaceLike(sibling));
            if (counted.length > 1 && counted[0] === embellished) {
                return ["prefix", false];
            }
            if (counted.length > 1 && counted[counted.length - 1] === embellished) {
                return ["postfix", false];
            }
        }
        if (name !== undefined && SCRIPTED.has(name) && siblings[0] !== embellished) {
            return ["postfix", false];
        }
        return ["infix", false];
    }

    private properties(core: ElementBox, form: readonly [string, boolean]): Operator {
        // §3.2.4.2, "the algorithm for determining the properties of an embellished operator": the attributes of the core
        // operator, or else the dictionary entry of its category, trying the other forms for a form that was not given.
        const math: MathElement = this.data(core) as MathElement;
        const text: string | undefined = this.operatorText(core);
        let category: string = text === undefined ? MathOperators.DEFAULT : this.dictionary.category(text, form[0]);
        for (let index: number = 0; text !== undefined && !form[1] && category === MathOperators.DEFAULT && index < FORMS.length; index++) {
            category = this.dictionary.category(text, FORMS[index]);
        }
        const entry: DictionaryEntry = this.dictionary.entry(category);
        // "Percentage values for lspace, rspace are interpreted relative to the value read from the dictionary"; the em is
        // that of the core operator.
        const em: number = this.metrics.fontSize(core.style.values);
        const operator: Operator = {
            stretchy: math.stretchy ?? entry.stretchy, symmetric: math.symmetric ?? entry.symmetric, largeop: math.largeop ?? entry.largeop,
            movablelimits: math.movablelimits ?? entry.movablelimits, lspace: math.lspace === undefined ? entry.lspace * em : this.sizes.pixels(math.lspace, entry.lspace * em),
            rspace: math.rspace === undefined ? entry.rspace * em : this.sizes.pixels(math.rspace, entry.rspace * em), minsize: math.minsize ?? HUNDRED_PERCENT,
            inline: text !== undefined && [...text].length === 1 && this.dictionary.hasInlineAxis(text.codePointAt(0) as number)
        };
        if (math.maxsize !== undefined) {
            operator.maxsize = math.maxsize;
        }
        return operator;
    }

    private operatorOf(core: ElementBox): Operator {
        let operator: Operator | undefined = this.operators.get(core);
        if (operator === undefined) {
            operator = this.properties(core, this.form(core, core, undefined, []));
            this.operators.set(core, operator);
        }
        return operator;
    }

    private operatorFor(box: ElementBox): Operator | undefined {
        const core: ElementBox | undefined = this.core(box);
        return core === undefined ? undefined : this.operatorOf(core);
    }

    private constants(box: ElementBox): MathConstants {
        // §5.1: "global layout constants for the first available font", at the size of the element's font.
        const instance: FontInstance | undefined = this.metrics.firstFont(box.style.values);
        return instance === undefined ? this.noTable.constants(NO_METRICS, this.metrics.fontSize(box.style.values))
            : this.mathTable(instance).constants(instance.metrics, this.metrics.usedSize(box.style.values, instance));
    }

    private keyword(box: ElementBox, property: string): string {
        const value: CssValue | undefined = box.style.values[property];
        return value !== undefined && value.kind === "ident" ? value.lower : "";
    }

    private side(side: number, sides?: readonly [number, number, number, number]): number {
        return sides === undefined ? 0 : sides[side];
    }

    private marginOf(margins?: Margins): number {
        return margins === undefined ? 0 : margins[0] + margins[1];
    }

    private clamped(size: number, minimum?: number, maximum?: number): number {
        // CSS 2 §10.4 and §10.7: the maximum is applied first, so the minimum wins when they conflict.
        return Math.max(minimum ?? 0, maximum === undefined ? size : Math.min(size, maximum));
    }
}
