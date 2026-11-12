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

import type { CalcAnchor, CalcNode, CssValue } from "../css/values/CssValue.js";
import type { ImageFormats, ImageSize } from "../images/ImageFormats.js";
import type { BoxNode, ElementBox, InlineSequence, InlineText } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { InlineTextBuilder } from "../pdf/InlineTextBuilder.js";
import type { NaturalSizes, Transform, UsedSizes } from "./BoxSizes.js";
import { BoxSizes } from "./BoxSizes.js";
import type { BoxFragment, BreakToken, LineFragment, Margins, ObjectArea, Sides } from "./Fragment.js";
import type { TextEdges } from "./InlineLayout.js";
import { InlineLayout } from "./InlineLayout.js";
import { TableLayout } from "./TableLayout.js";

const NO_MARGIN: Margins = [0, 0];
const DEFAULT_INLINE_SIZE: number = 300;
const DEFAULT_BLOCK_SIZE: number = 150;
const VISIBLE_OVERFLOW: ReadonlyArray<string> = ["visible", "clip"];
const TOLERANCE: number = 0.001;
const FLOAT_FIELDS: number = 4;
const INLINE_FLOATS: ReadonlySet<string> = new Set<string>(["left", "right", "inline-start", "inline-end"]);
const KEYWORD_ORDER: ReadonlyArray<number> = [BoxSizes.MINIMUM_INLINE, BoxSizes.MAXIMUM_INLINE, BoxSizes.MINIMUM_BLOCK, BoxSizes.MAXIMUM_BLOCK, BoxSizes.PREFERRED_INLINE,
    BoxSizes.PREFERRED_BLOCK];
const CONTENT_SIZES: ReadonlySet<string> = new Set<string>(["min-content", "max-content", "fit-content", BoxSizes.FIT_FUNCTION]);
const AUTOMATIC_MINIMUM: string = "auto";
const NO_NATURAL_SIZES: NaturalSizes = [undefined, undefined, undefined];
const HORIZONTAL_SIDES: ReadonlySet<string> = new Set<string>(["left", "right", "x-start", "x-end"]);
const FAR_SIDES: ReadonlySet<string> = new Set<string>(["right", "bottom", "x-end", "y-end", "block-end", "inline-end", "end"]);
const PHYSICAL_SIDES: ReadonlySet<string> = new Set<string>(["left", "right", "top", "bottom"]);
const BLOCK_SIDES: ReadonlySet<string> = new Set<string>(["block-start", "block-end"]);
const INLINE_SIDES: ReadonlySet<string> = new Set<string>(["inline-start", "inline-end"]);
const VERTICAL_SIDES: ReadonlySet<string> = new Set<string>(["top", "bottom", "y-start", "y-end"]);
const CONTAINING_BLOCK: number = DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT;
const OWN_CONTEXT: number = DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT | DisplayTypes.SIZE_QUERIES;
const SIZED_AS_EMPTY: number = DisplayTypes.SIZE_CONTAINMENT | DisplayTypes.INLINE_SIZE_CONTAINMENT;

type ContainerContents = (box: ElementBox, inlineSize: number, blockSize?: number) => boolean;

export type Snapshot = readonly [number, number, number, number];

export interface WrappingArea {
    edges: ReadonlyArray<number>;
    rules: ReadonlyArray<boolean>;
    crossing: boolean;
    area: readonly [number, number, number, number];
}

const UNLIMITED: readonly [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
const BLOCK_ORIENTATION: number = BoxSizes.VERTICAL | BoxSizes.BLOCK_REVERSED;

interface Floats {
    starts: Array<number>;
    ends: Array<number>;
    used: boolean;
}

interface Wrapping {
    area: WrappingArea;
    critical: Float64Array;
    top: number;
    bottom: number;
}

export interface Candidate {
    appeal: number;
    path: ReadonlyArray<readonly [ElementBox, number]>;
    line?: readonly [number, number];
}

interface Fragmentation {
    kinds: ReadonlyArray<string>;
    extent: number;
    breadth: number;
    path: Array<[ElementBox, number]>;
    avoid: number;
    filled: boolean;
    resumed: boolean;
    forced: boolean;
    best?: Candidate;
    prior?: Candidate;
    early?: Candidate;
    restart: boolean;
    worst?: number;
}

const APPEAL_OVERFLOW: number = 0;
const APPEAL_AVOID: number = 1;
const APPEAL_ORPHANS: number = 2;
const APPEAL_PERFECT: number = 3;
const PAGE_BREAKS: ReadonlySet<string> = new Set<string>(["page", "left", "right", "recto", "verso"]);
const MINIMUM_FRAGMENTAINER: number = 1;
const PAGE_CONTEXT: ReadonlyArray<string> = ["page"];
const NO_CALLS: ReadonlySet<ElementBox> = new Set<ElementBox>();

export class BlockLayout {

    static readonly EDGE_FIELDS: number = 5;

    pageBreak?: Candidate;
    pageEarlier?: Candidate;
    private bandOffset: number = 0;
    private readonly sizes: BoxSizes = new BoxSizes((anchor: CalcAnchor, block: boolean): number | undefined => this.anchorLength(anchor, block));
    private readonly inline: InlineLayout;
    private readonly trimmed: WeakSet<LineFragment> = new WeakSet<LineFragment>();
    private readonly images: ImageFormats;
    readonly tables: TableLayout = new TableLayout(this, this.sizes);
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly contents?: ContainerContents;
    private floats?: Floats;
    private wrapping?: Wrapping;
    private pending?: Set<BoxFragment>;
    private initialInline: number = 0;
    private initial: readonly [number, number] = UNLIMITED;
    private frame: number = 0;
    private sign: number = 1;
    private limit: number = Number.POSITIVE_INFINITY;
    private port: readonly [number, number] = UNLIMITED;
    private fragmenting?: Fragmentation;
    private pageState?: Fragmentation;
    private flowAppeal: number = APPEAL_PERFECT;
    private end: number = Number.POSITIVE_INFINITY;
    private floatTokens: Array<BreakToken> = [];
    private pushedFloat: boolean = false;
    private rootBox?: ElementBox;
    private anchorNames?: Map<string, Array<ReadonlyArray<ElementBox>>>;
    private readonly anchoring: Array<readonly [number, ElementBox, BoxFragment]> = [];
    private pushed: ReadonlySet<ElementBox> = NO_CALLS;

    constructor(metrics: FontMetrics, text: InlineTextBuilder, images: ImageFormats, contents?: ContainerContents) {
        this.images = images;
        this.inline = new InlineLayout(metrics, this.sizes, text, this);
        if (contents !== undefined) {
            this.contents = contents;
        }
    }

    cell(box: ElementBox, inlineSize: number, border?: [number, number, number, number], space?: number, incoming?: BreakToken): BoxFragment {
        // CSS 2 §17.5.2 and §17.5.3: the table gives a cell its width and its height, and in the collapsing border model
        // its borders too.
        const sizes: UsedSizes = this.sizes.of(box.style, inlineSize);
        delete sizes.margin;
        delete sizes.blockSize;
        delete sizes.minBlockSize;
        delete sizes.maxBlockSize;
        // CSS Sizing 4 §4.1: aspect-ratio applies to "all elements except inline boxes and internal ruby or table boxes".
        delete sizes.keywords;
        delete sizes.ratio;
        delete sizes.calculations;
        if (border !== undefined) {
            sizes.border = border;
        }
        return this.flow(box, sizes, Math.max(0, inlineSize - this.inlineEdges(sizes)), 0, true, 0, 0, undefined, space, incoming);
    }

    page(box: ElementBox, inlineSize: number, blockSize: number, token?: BreakToken, end?: Candidate): BoxFragment {
        // CSS Paged Media 3 §3: the page area of the first page is the initial containing block, the containing block of the
        // root element (CSS 2 §10.1); CSS Writing Modes 4 §8.1: it takes the writing mode of the root element.
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        if (token === undefined) {
            this.initialInline = inlineSize;
            this.rootBox = box;
            this.initial = (this.frame & BoxSizes.VERTICAL) === 0 ? [inlineSize, blockSize] : [blockSize, inlineSize];
        }
        const initialBlock: number = (this.frame & BoxSizes.VERTICAL) === 0 ? this.initial[1] : this.initial[0];
        // CSS Fragmentation 4 §5.1: "Layout is performed per-fragmentainer, with each fragmentainer continuing progress from the
        // breakpoint on the previous"; §4: "fragmentainers are assumed to have a minimum block size of 1px".
        const space: number = Math.max(MINIMUM_FRAGMENTAINER, blockSize);
        const fragment: BoxFragment = this.fragmented(PAGE_CONTEXT, space, inlineSize, token,
            (): BoxFragment => this.block(box, inlineSize, true, 0, 0, initialBlock, undefined, 0, space, token, false), end);
        // CSS 2 §8.3.1: "Margins of the root element's box do not collapse."
        fragment.block = fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1];
        this.positioned(fragment, true);
        const path: Array<readonly [ElementBox, number]> = [];
        let line: readonly [number, number] | undefined;
        for (let level: BreakToken | undefined = fragment.token; level !== undefined; level = level.inner) {
            path.push([level.box, level.child]);
            const text: InlineText | undefined = level.line === undefined ? undefined : level.box.inline?.[level.sequence]?.text;
            line = text === undefined || level.line === undefined ? undefined : this.spot(text, level.line);
        }
        const taken: Candidate | undefined = path.length === 0 ? undefined : (line === undefined ? { appeal: APPEAL_PERFECT, path } : { appeal: APPEAL_PERFECT, path, line });
        const state: Fragmentation = this.pageState as Fragmentation;
        const earlier: Candidate | undefined = taken !== undefined && state.best !== undefined && this.sameCandidate(state.best, taken) ? state.prior : state.best;
        if (taken === undefined) {
            delete this.pageBreak;
        } else {
            this.pageBreak = taken;
        }
        if (earlier === undefined) {
            delete this.pageEarlier;
        } else {
            this.pageEarlier = earlier;
        }
        return fragment;
    }

    earlierOf(first: Candidate | undefined, second: Candidate | undefined, end: Candidate | undefined): Candidate | undefined {
        // CSS Fragmentation 3 §4.5 leaves the choice among the allowed breaks to the UA, so of two layouts that repeat each
        // other the content ends at the earlier break, when that one comes before the end already given.
        const earlier: Candidate | undefined = first === undefined || (second !== undefined && this.order(second.path, second.line, first) < 0) ? second : first;
        return earlier !== undefined && (end === undefined || this.order(earlier.path, earlier.line, end) < 0) ? earlier : undefined;
    }

    private spot(text: InlineText, offset: number): readonly [number, number] {
        // A place in a text is kept as its item and the offset in it, which stay when the generated text of another item changes.
        const starts: ReadonlyArray<number> = text.starts;
        let low: number = 0;
        let high: number = starts.length - 1;
        while (low < high) {
            const middle: number = (low + high) >> 1;
            if (starts[middle + 1] > offset) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        return [low, offset - starts[low]];
    }

    marginBox(box: ElementBox, sizes: UsedSizes, inlineSize: number): BoxFragment {
        // A page-margin box inherits from the page context, not from the content, so it starts its own writing mode.
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        return this.flow(box, sizes, inlineSize, 0, true, 0, 0);
    }

    marginContent(box: ElementBox): readonly [number, number] {
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        return this.contentSizes(box);
    }

    pushCalls(calls: ReadonlySet<ElementBox>): void {
        this.pushed = calls;
    }

    footnoteArea(area: ElementBox, inlineSize: number, blockSize: number, space: number, token?: BreakToken): BoxFragment {
        // GCPM 3 §2.4: the footnote area is a page area of its own below the content, and XSL 1.1 §6.12.3 lets a footnote body
        // break across pages; it is laid out without changing what the layout of the content left for the page driver.
        const state: Fragmentation | undefined = this.pageState;
        const appeal: number = this.flowAppeal;
        this.frame = this.sizes.frame(area.style);
        this.sign = 1;
        // The space is the margin box of the area, whose block-start margin comes before the fragmentainer that it breaks in.
        const before: number = this.sizes.margin(this.sizes.of(area.style, inlineSize, blockSize), BoxSizes.BLOCK_START) ?? 0;
        const room: number = Math.max(MINIMUM_FRAGMENTAINER, space - before);
        const fragment: BoxFragment = this.fragmented(PAGE_CONTEXT, room, inlineSize, token,
            (): BoxFragment => this.block(area, inlineSize, true, 0, 0, blockSize, undefined, 0, room, token, false));
        this.positioned(fragment, true);
        if (state === undefined) {
            delete this.pageState;
        } else {
            this.pageState = state;
        }
        this.flowAppeal = appeal;
        return fragment;
    }

    footnoteLimit(style: ComputedStyle, inlineSize: number, blockSize: number): number {
        // GCPM 3 §2.4.2: "The max-height property on the footnote area limits the size of this area", whose margin box is
        // what the page gives it.
        const sizes: UsedSizes = this.sizes.of(style, inlineSize, blockSize);
        if (sizes.maxBlockSize === undefined) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(sizes.maxBlockSize, sizes.minBlockSize ?? 0) + this.sizes.edges(sizes, BoxSizes.BLOCK_START) + this.sizes.edges(sizes, BoxSizes.BLOCK_END)
            + (this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0) + (this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0);
    }

    lineSize(style: ComputedStyle, inlineSize: number): number {
        // CSS 2 §10.3.3: the content width of a block-level box in normal flow, with auto margins as zero.
        const sizes: UsedSizes = this.sizes.of(style, inlineSize);
        const margins: number = (this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0) + (this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0);
        return this.clamped(sizes.inlineSize ?? Math.max(0, inlineSize - margins - this.inlineEdges(sizes)), sizes.minInlineSize, sizes.maxInlineSize);
    }

    firstSide(box: ElementBox, recto: "left" | "right"): "left" | "right" {
        // CSS Paged Media 3 §3.3: a page break that propagates to the root decides the side of the first printed page, the
        // empty pages before it being suppressed; CSS Fragmentation 4 §4.3: of the side values, the latest in the flow wins.
        const verso: "left" | "right" = recto === "left" ? "right" : "left";
        let named: "left" | "right" | undefined;
        let breaks: boolean = false;
        for (const value of this.breakValues(box, "break-before", true)) {
            const type: string | undefined = this.forcedType(value, PAGE_CONTEXT);
            breaks = breaks || type !== undefined;
            if (type === "left" || type === "right") {
                named = type;
            } else if (type === "recto" || type === "verso") {
                named = type === "recto" ? recto : verso;
            }
        }
        return named ?? (breaks ? verso : recto);
    }

    intrinsic(box: ElementBox, blockBasis?: number): readonly [number, number] {
        // CSS Sizing 3 §5.1: the min-content and max-content contributions of a box are those sizes of its margin box,
        // with percentages counted as zero.
        const frame: number = this.sizes.frame(box.style);
        if (this.sizes.isOrthogonal(this.frame, frame)) {
            // CSS Writing Modes 4 §7.3: the content-based block size of a child in an orthogonal flow "is used as input to the
            // inline-axis min-content size and max-content size of the parent".
            const given: UsedSizes = this.sizes.of(box.style, blockBasis, undefined, 0);
            const parentFrame: number = this.frame;
            const laid: BoxFragment = this.crossed(box, given, frame, blockBasis, undefined, true);
            const extent: number = laid.blockSize + (this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)) ?? 0)
                + (this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)) ?? 0);
            return [extent, extent];
        }
        if (this.tables.isGrid(box)) {
            return this.tables.intrinsic(box);
        }
        const sizes: UsedSizes = this.resolved(box, this.sizes.of(box.style, undefined, blockBasis), undefined, blockBasis);
        const edges: number = (this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0) + (this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0) + this.inlineEdges(sizes);
        if (box.replaced) {
            // §5.2.1: for a replaced box a cyclic percentage in a preferred or maximum size "is resolved against zero when
            // calculating the min-content contribution", and that size is the initial value for the max-content one.
            const most: number = sizes.inlineSize as number;
            const least: number = this.resolved(box, this.sizes.of(box.style, 0, blockBasis), 0, blockBasis).inlineSize as number;
            return [Math.min(least, most) + edges, most + edges];
        }
        if (sizes.inlineSize !== undefined) {
            const size: number = this.clamped(sizes.inlineSize, sizes.minInlineSize, sizes.maxInlineSize);
            return [size + edges, size + edges];
        }
        const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
        return [
            this.clamped(content[0], sizes.minInlineSize, sizes.maxInlineSize) + edges,
            this.clamped(content[1], sizes.minInlineSize, sizes.maxInlineSize) + edges
        ];
    }

    contentSizes(box: ElementBox, blockBasis?: number): readonly [number, number] {
        // CSS Containment 2 §3.1 and CSS Containment 3 §3.1: with size or inline-size containment the inline-axis intrinsic
        // sizes are those of the box without content; CSS Sizing 4 §5.2: contain-intrinsic-* gives that content a size.
        if ((this.containment(box) & SIZED_AS_EMPTY) !== 0) {
            const explicit: number = this.explicitSize(box, false) ?? 0;
            return [explicit, explicit];
        }
        return this.flowSizes(box, blockBasis);
    }

    contain(fragment: BoxFragment): void {
        // CSS Position 3 §2.1 and CSS Containment 2 §3.2: a positioned box, or one with layout or paint containment, that
        // another layout mode lays out is the containing block of the absolutely positioned boxes inside it.
        const box: ElementBox = fragment.box;
        const containing: boolean = (this.containment(box) & CONTAINING_BLOCK) !== 0;
        if (containing || (this.keyword(box.style.values["position"]) !== "none" && this.keyword(box.style.values["position"]) !== "static")) {
            this.positioned(fragment, containing);
        }
    }

    blockContentSizes(box: ElementBox): readonly [number, number] {
        // The content of a box laid out as a block box, for a layout that places the box itself and gives it its edges.
        return this.flowSizes(box);
    }

    blockContent(box: ElementBox, inlineSize: number): BoxFragment {
        return this.blockFlow(box, {}, inlineSize, 0, true, 0, 0);
    }

    private flowSizes(box: ElementBox, blockBasis?: number): readonly [number, number] {
        let minimum: number = 0;
        let maximum: number = 0;
        let sequence: number = 0;
        const nodes: ReadonlyArray<BoxNode> = box.children;
        const outer: number = this.frame;
        this.frame = this.sizes.frame(box.style);
        for (let index: number = 0; index < nodes.length;) {
            const node: BoxNode = nodes[index];
            let sizes: readonly [number, number];
            if (this.isBlockLevel(node)) {
                sizes = this.intrinsic(node, blockBasis);
                index++;
            } else {
                while (index < nodes.length && !this.isBlockLevel(nodes[index])) {
                    index++;
                }
                const run: InlineSequence | undefined = box.inline?.[sequence++];
                sizes = run === undefined ? NO_MARGIN : this.inline.intrinsic(run, blockBasis);
            }
            minimum = Math.max(minimum, sizes[0]);
            maximum = Math.max(maximum, sizes[1]);
        }
        this.frame = outer;
        return [minimum, maximum];
    }

    hasExclusions(): boolean {
        return this.floats !== undefined || this.wrapping !== undefined;
    }

    wrapIn(area?: WrappingArea): void {
        // CSS Exclusions 1 §2: a box wraps its inline content in "the subtraction of its wrapping context from its own
        // content area"; the edges of that area keep their order across a line except at their ends and where they cross.
        if (area === undefined) {
            delete this.wrapping;
            return;
        }
        const edges: ReadonlyArray<number> = area.edges;
        const levels: Array<number> = [];
        for (let first: number = 0; first < edges.length; first += BlockLayout.EDGE_FIELDS) {
            levels.push(edges[first + 1], edges[first + 3]);
            for (let second: number = first + BlockLayout.EDGE_FIELDS; area.crossing && second < edges.length; second += BlockLayout.EDGE_FIELDS) {
                const level: number | undefined = this.crossing(edges, first, second);
                if (level !== undefined) {
                    levels.push(level);
                }
            }
        }
        levels.sort((a: number, b: number) => a - b);
        const critical: Array<number> = [];
        for (const level of levels) {
            if (critical.length === 0 || level - critical[critical.length - 1] > TOLERANCE) {
                critical.push(level);
            }
        }
        this.wrapping = { area, critical: Float64Array.from(critical), top: critical[0] ?? 0, bottom: critical[critical.length - 1] ?? 0 };
    }

    private crossing(edges: ReadonlyArray<number>, first: number, second: number): number | undefined {
        const ax: number = edges[first];
        const ay: number = edges[first + 1];
        const bx: number = edges[second];
        const by: number = edges[second + 1];
        const rx: number = edges[first + 2] - ax;
        const ry: number = edges[first + 3] - ay;
        const sx: number = edges[second + 2] - bx;
        const sy: number = edges[second + 3] - by;
        if (Math.max(ay, ay + ry) <= Math.min(by, by + sy) || Math.max(by, by + sy) <= Math.min(ay, ay + ry)
            || Math.max(ax, ax + rx) <= Math.min(bx, bx + sx) || Math.max(bx, bx + sx) <= Math.min(ax, ax + rx)) {
            return undefined;
        }
        const denominator: number = rx * sy - ry * sx;
        if (denominator === 0) {
            return undefined;
        }
        const t: number = ((bx - ax) * sy - (by - ay) * sx) / denominator;
        const u: number = ((bx - ax) * ry - (by - ay) * rx) / denominator;
        return t > 0 && t < 1 && u > 0 && u < 1 ? ay + t * ry : undefined;
    }

    segments(inlineStart: number, inlineSize: number, top: number, size: number): Array<readonly [number, number]> {
        // CSS 2 §9.5 and CSS Exclusions 1 §2: the room beside the floats that the wrapping area leaves, as stretches given by
        // their offset from the inline start of the box that asks and their size, in its inline direction.
        const width: number = this.band(inlineStart, inlineSize, top, size);
        const offset: number = this.bandOffset;
        const free: ReadonlyArray<readonly [number, number]> | undefined = this.free(top, top + Math.max(size, TOLERANCE));
        if (free === undefined) {
            return [[offset, width]];
        }
        const low: number = this.sign > 0 ? inlineStart : inlineStart - inlineSize;
        const start: number = this.sign > 0 ? low + offset : low + inlineSize - offset - width;
        const result: Array<readonly [number, number]> = [];
        for (const [from, to] of free) {
            const left: number = Math.max(from, start);
            const right: number = Math.min(to, start + width);
            if (right > left + TOLERANCE) {
                result.push(this.sign > 0 ? [left - low, right - left] : [low + inlineSize - right, right - left]);
            }
        }
        return this.sign > 0 ? result : result.reverse();
    }

    private free(top: number, bottom: number): Array<readonly [number, number]> | undefined {
        // CSS Shapes 2 §9.2: the area outside the shape is excluded only inside the content area, and a line has the room
        // that is free across its whole block size.
        const wrapping: Wrapping | undefined = this.wrapping;
        if (wrapping === undefined) {
            return undefined;
        }
        const area: readonly [number, number, number, number] = wrapping.area.area;
        const from: number = Math.max(top, area[1]);
        const to: number = Math.min(bottom, area[3]);
        if (to < from) {
            return undefined;
        }
        return this.joined(this.inside(wrapping, from, to), [[Number.NEGATIVE_INFINITY, area[0]], [area[2], Number.POSITIVE_INFINITY]]);
    }

    private inside(wrapping: Wrapping, from: number, to: number): Array<readonly [number, number]> {
        const critical: Float64Array = wrapping.critical;
        let low: number = 0;
        let high: number = critical.length;
        while (low < high) {
            const middle: number = (low + high) >> 1;
            if (critical[middle] <= from) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        let result: Array<readonly [number, number]> = [[Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]];
        let level: number = from;
        for (let index: number = low; result.length > 0; index++) {
            const next: number = index < critical.length && critical[index] < to ? critical[index] : to;
            result = this.common(result, this.slab(wrapping, level, next));
            if (next >= to) {
                break;
            }
            level = next;
        }
        return result;
    }

    private slab(wrapping: Wrapping, top: number, bottom: number): Array<readonly [number, number]> {
        // Between two critical levels each stretch inside the shape lies between the same two straight edges, so the part
        // of it that stays inside from top to bottom is bounded by their ends; the fill rule of each group decides inside.
        const edges: ReadonlyArray<number> = wrapping.area.edges;
        const rules: ReadonlyArray<boolean> = wrapping.area.rules;
        const middle: number = (top + bottom) / 2;
        const crossings: Array<readonly [number, number, number, number, number]> = [];
        for (let index: number = 0; index < edges.length; index += BlockLayout.EDGE_FIELDS) {
            const y0: number = edges[index + 1];
            const y1: number = edges[index + 3];
            if ((y0 <= middle) === (y1 <= middle)) {
                continue;
            }
            const x0: number = edges[index];
            const slope: number = (edges[index + 2] - x0) / (y1 - y0);
            crossings.push([x0 + (middle - y0) * slope, x0 + (top - y0) * slope, x0 + (bottom - y0) * slope, y1 > y0 ? 1 : -1, edges[index + 4]]);
        }
        crossings.sort((a: readonly [number, number, number, number, number], b: readonly [number, number, number, number, number]) => a[0] - b[0]);
        const windings: Array<number> = new Array<number>(rules.length).fill(0);
        const result: Array<readonly [number, number]> = [];
        let start: number | undefined;
        for (const crossing of crossings) {
            windings[crossing[4]] += crossing[3];
            const inside: boolean = windings.some((winding: number, group: number) => rules[group] ? (winding & 1) !== 0 : winding !== 0);
            if (inside && start === undefined) {
                start = Math.max(crossing[1], crossing[2]);
            } else if (!inside && start !== undefined) {
                const end: number = Math.min(crossing[1], crossing[2]);
                if (end > start) {
                    result.push([start, end]);
                }
                start = undefined;
            }
        }
        return result;
    }

    private common(first: ReadonlyArray<readonly [number, number]>, second: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
        const result: Array<readonly [number, number]> = [];
        for (let a: number = 0, b: number = 0; a < first.length && b < second.length;) {
            const left: number = Math.max(first[a][0], second[b][0]);
            const right: number = Math.min(first[a][1], second[b][1]);
            if (right > left) {
                result.push([left, right]);
            }
            if (first[a][1] < second[b][1]) {
                a++;
            } else {
                b++;
            }
        }
        return result;
    }

    private joined(first: ReadonlyArray<readonly [number, number]>, second: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
        const all: Array<readonly [number, number]> = [...first, ...second].filter((stretch: readonly [number, number]) => stretch[1] > stretch[0]);
        all.sort((a: readonly [number, number], b: readonly [number, number]) => a[0] - b[0]);
        const result: Array<[number, number]> = [];
        for (const stretch of all) {
            const last: [number, number] | undefined = result[result.length - 1];
            if (last !== undefined && stretch[0] <= last[1]) {
                last[1] = Math.max(last[1], stretch[1]);
            } else {
                result.push([stretch[0], stretch[1]]);
            }
        }
        return result;
    }

    private band(inlineStart: number, inlineSize: number, top: number, size: number): number {
        // CSS 2 §9.5: the room between the floats at one block position, kept in the block formatting context's inline axis,
        // which runs against that of a box asking with the other direction.
        const floats: Floats | undefined = this.floats;
        const low: number = this.sign > 0 ? inlineStart : inlineStart - inlineSize;
        let start: number = low;
        let end: number = low + inlineSize;
        const bottom: number = top + Math.max(size, TOLERANCE);
        for (let index: number = 0; floats !== undefined && index < floats.starts.length; index += FLOAT_FIELDS) {
            if (floats.starts[index + 1] < bottom && floats.starts[index + 1] + floats.starts[index + 3] > top) {
                start = Math.max(start, floats.starts[index] + floats.starts[index + 2]);
            }
        }
        for (let index: number = 0; floats !== undefined && index < floats.ends.length; index += FLOAT_FIELDS) {
            if (floats.ends[index + 1] < bottom && floats.ends[index + 1] + floats.ends[index + 3] > top) {
                end = Math.min(end, floats.ends[index]);
            }
        }
        if (floats !== undefined) {
            floats.used = true;
        }
        this.bandOffset = this.sign > 0 ? start - low : low + inlineSize - end;
        return Math.max(0, end - start);
    }

    below(top: number): number | undefined {
        let next: number | undefined;
        for (const side of this.floats === undefined ? [] : [this.floats.starts, this.floats.ends]) {
            for (let index: number = 0; index < side.length; index += FLOAT_FIELDS) {
                const bottom: number = side[index + 1] + side[index + 3];
                next = bottom > top + TOLERANCE && (next === undefined || bottom < next) ? bottom : next;
            }
        }
        const wrapping: Wrapping | undefined = this.wrapping;
        if (wrapping !== undefined) {
            // SVG 2 §11.7.1.1: "In CSS, the edge of a shape is treated as a series of 1 pixel × 1 pixel floats", so a line
            // goes down a pixel at a time across the shape, and past it to where the content area ends, if it does.
            const area: readonly [number, number, number, number] = wrapping.area.area;
            let step: number | undefined;
            if (top + TOLERANCE < area[1]) {
                step = area[1];
            } else if (top + TOLERANCE < wrapping.top) {
                step = wrapping.top;
            } else if (top + TOLERANCE < wrapping.bottom) {
                step = Math.min(top + 1, wrapping.bottom);
            } else if (top + TOLERANCE < area[3] && area[3] < Number.POSITIVE_INFINITY) {
                step = area[3];
            }
            next = step === undefined || (next !== undefined && next <= step) ? next : step;
        }
        return next;
    }

    place(box: ElementBox, inlineStart: number, inlineSize: number, origin: number, top: number, required: number, out: Array<BoxFragment | LineFragment>,
        blockBasis?: number, incoming?: BreakToken): boolean {
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const side: string = this.keyword(values["float"]);
        if (!INLINE_FLOATS.has(side)) {
            return true;
        }
        // CSS Fragmentation 4 §2.1: a float is a parallel flow; one that starts after the end of the fragmentainer goes whole to
        // the next one, and so does every later float, since CSS 2 §9.5.1 rules 5 and 6 keep their order.
        const fragmenting: Fragmentation | undefined = this.end < Number.POSITIVE_INFINITY ? this.fragmenting : undefined;
        if (fragmenting !== undefined && incoming === undefined && (this.pushedFloat || Math.max(origin + top, this.clearEdge(box)) >= this.end - TOLERANCE)) {
            this.pushFloat(box, inlineStart, inlineSize);
            return true;
        }
        let placed: readonly [BoxFragment, number] = incoming === undefined ? this.atomic(box, inlineSize, blockBasis)
            : this.parallel((): readonly [BoxFragment, number] => this.atomic(box, inlineSize, blockBasis, this.end - origin - top, incoming), incoming);
        let fragment: BoxFragment = placed[0];
        const before: number = fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1];
        let height: number = before + fragment.blockSize + (fragment.marginAfter === undefined ? 0 : fragment.marginAfter[0] + fragment.marginAfter[1]);
        // CSS 2 §9.5.1 rule 5: "The outer top of a floating box may not be higher than the outer top of any block or floated
        // box generated by an element earlier in the source document."
        let block: number = Math.max(origin + top, this.clearEdge(box));
        if (this.floats !== undefined) {
            for (const earlier of [this.floats.starts, this.floats.ends]) {
                for (let index: number = 0; index < earlier.length; index += FLOAT_FIELDS) {
                    block = Math.max(block, earlier[index + 1]);
                }
            }
        }
        if (required >= 0 && block > origin + top + TOLERANCE) {
            return false;
        }
        // Rule 8: "A floating box must be placed as high as possible", so it goes down only while it does not fit.
        let available: number = this.band(inlineStart, inlineSize, block, height);
        while (placed[1] > available + TOLERANCE) {
            const next: number | undefined = required >= 0 ? undefined : this.below(block);
            if (next === undefined) {
                break;
            }
            block = next;
            available = this.band(inlineStart, inlineSize, block, height);
        }
        if (required >= 0 && available - placed[1] < required - TOLERANCE) {
            return false;
        }
        if (fragmenting !== undefined && incoming === undefined && block + height > this.end + TOLERANCE) {
            // A float that does not fit breaks in its own flow, and a monolithic one goes to the next fragmentainer unless
            // nothing comes before it in this one.
            if (this.isMonolithic(box)) {
                if (fragmenting.filled) {
                    this.pushFloat(box, inlineStart, inlineSize);
                    return true;
                }
            } else {
                placed = this.parallel((): readonly [BoxFragment, number] => this.atomic(box, inlineSize, blockBasis, this.end - block - before));
                fragment = placed[0];
                height = before + fragment.blockSize + (fragment.marginAfter === undefined ? 0 : fragment.marginAfter[0] + fragment.marginAfter[1]);
            }
        }
        if (fragment.token !== undefined) {
            fragment.token.area = [inlineStart, inlineSize, this.frame, this.sign];
            this.floatTokens.push(fragment.token);
        }
        // CSS Writing Modes 4 §7.5: left and right are the line-left and line-right of the containing block, which are its
        // inline-start and inline-end sides when its direction is ltr.
        const reversed: boolean = (this.frame & BoxSizes.RIGHT_TO_LEFT) !== 0;
        const atEnd: boolean = side === "inline-end" || (side === "right" && !reversed) || (side === "left" && reversed);
        const offset: number = this.bandOffset + (atEnd ? available - placed[1] : 0);
        const inline: number = this.sign > 0 ? inlineStart + offset : inlineStart - offset - placed[1];
        const floats: Floats = this.floats ?? { starts: [], ends: [], used: true };
        this.floats = floats;
        floats.used = true;
        (atEnd === this.sign > 0 ? floats.ends : floats.starts).push(inline, block, placed[1], height);
        fragment.inline += offset;
        fragment.block = block - origin + before;
        out.push(fragment);
        return true;
    }

    private pushFloat(box: ElementBox, inlineStart: number, inlineSize: number): void {
        this.pushedFloat = true;
        this.floatTokens.push({ box, consumed: 0, child: 0, sequence: 0, area: [inlineStart, inlineSize, this.frame, this.sign], pushed: true });
    }

    private resumeFloats(tokens: ReadonlyArray<BreakToken>, out: Array<BoxFragment | LineFragment>, blockBasis?: number): void {
        // The floats that continue, or that were pushed, from the previous fragmentainer come first at its top, in the
        // writing mode and direction of the block that placed them.
        const frame: number = this.frame;
        const sign: number = this.sign;
        for (const token of tokens) {
            const area: readonly [number, number, number, number] | undefined = token.area;
            if (area === undefined) {
                continue;
            }
            this.frame = area[2];
            this.sign = area[3];
            this.place(token.box, area[0], area[1], 0, 0, -1, out, blockBasis, token.pushed === true ? undefined : token);
        }
        this.frame = frame;
        this.sign = sign;
    }

    private clearEdge(box: ElementBox): number {
        // CSS 2 §9.5.2: the top border edge of a box with clear goes below the bottom outer edge of the floats on the sides
        // that it names.
        const clear: string = this.keyword(box.style.values["clear"]);
        const floats: Floats | undefined = this.floats;
        if (clear === "none" || floats === undefined) {
            return Number.NEGATIVE_INFINITY;
        }
        // CSS Writing Modes 4 §7.5: the sides are the line-left and line-right of the containing block.
        const reversed: boolean = (this.frame & BoxSizes.RIGHT_TO_LEFT) !== 0;
        const ownStart: boolean = clear === "inline-start" || (clear === "left" && !reversed) || (clear === "right" && reversed);
        const ownEnd: boolean = clear === "inline-end" || (clear === "right" && !reversed) || (clear === "left" && reversed);
        const atStart: boolean = this.sign > 0 ? ownStart : ownEnd;
        const atEnd: boolean = this.sign > 0 ? ownEnd : ownStart;
        let edge: number = Number.NEGATIVE_INFINITY;
        for (const side of [atEnd ? undefined : floats.starts, atStart ? undefined : floats.ends]) {
            for (let index: number = 0; side !== undefined && index < side.length; index += FLOAT_FIELDS) {
                edge = Math.max(edge, side[index + 1] + side[index + 3]);
            }
        }
        return edge;
    }

    atomic(box: ElementBox, inlineSize: number, blockBasis?: number, space?: number, incoming?: BreakToken): readonly [BoxFragment, number] {
        // CSS 2 §10.3.9: an inline-block with an auto width takes the shrink-to-fit width of §10.3.5, "min(max(preferred
        // minimum width, available width), preferred width)", and its auto margins are zero; §10.3.2 for a replaced box.
        const parentFrame: number = this.frame;
        const frame: number = this.sizes.frame(box.style);
        if (this.sizes.isOrthogonal(parentFrame, frame)) {
            const crossing: UsedSizes = this.sizes.of(box.style, blockBasis, inlineSize, inlineSize);
            const before: number = this.sizes.margin(crossing, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)) ?? 0;
            const after: number = this.sizes.margin(crossing, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)) ?? 0;
            const turned: BoxFragment = this.turned(this.crossed(box, crossing, frame, blockBasis, inlineSize, false), before, crossing, parentFrame, frame);
            return [turned, before + turned.inlineSize + after];
        }
        const given: UsedSizes = this.sizes.of(box.style, inlineSize, blockBasis);
        const start: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)) ?? 0;
        const end: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)) ?? 0;
        const stretch: number = Math.max(0, inlineSize - start - end - this.inlineEdges(given));
        const sizes: UsedSizes = this.resolved(box, given, stretch, blockBasis);
        let size: number | undefined = sizes.inlineSize;
        if (size === undefined) {
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            size = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(content[0], stretch), content[1]));
        }
        const fragment: BoxFragment = this.flow(box, sizes, this.clamped(size, sizes.minInlineSize, sizes.maxInlineSize), start, true, 0, 0, undefined, space, incoming);
        if (!this.hasVisibleOverflow(box) || (this.containment(box) & DisplayTypes.LAYOUT_CONTAINMENT) !== 0) {
            // CSS 2 §10.8.1: with an overflow other than visible "the baseline is the bottom margin edge"; CSS Containment 2
            // §3.2: for vertical-align "the containment box is treated as having no baseline".
            delete fragment.firstBaseline;
            delete fragment.baseline;
        }
        this.reoriented(fragment, parentFrame, frame);
        return [fragment, start + fragment.inlineSize + end];
    }

    private crossed(box: ElementBox, given: UsedSizes, frame: number, available: number | undefined, blockBasis: number | undefined, probe: boolean): BoxFragment {
        // CSS Writing Modes 4 §7.3: in the sizing phase of an orthogonal flow the box and its containing block are measured
        // "using the writing mode of the box establishing the orthogonal flow"; the fragment comes back in that mode.
        const space: number = available ?? this.fallback(frame);
        const margins: number = (this.sizes.margin(given, BoxSizes.INLINE_START) ?? 0) + (this.sizes.margin(given, BoxSizes.INLINE_END) ?? 0);
        const stretch: number = Math.max(0, space - margins - this.inlineEdges(given));
        const sizes: UsedSizes = this.resolved(box, given, stretch, blockBasis);
        let size: number | undefined = sizes.inlineSize;
        if (size === undefined) {
            // §7.3.2: an auto inline size is "min(max-content, max(min-content, constraint))", and the content then flows into
            // columns of that width.
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            size = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(content[0], stretch), content[1]));
        }
        size = this.clamped(size, sizes.minInlineSize, sizes.maxInlineSize);
        return probe ? this.probe(box, sizes, size, 0, true, 0, 0) : this.flow(box, sizes, size, 0, true, 0, 0);
    }

    private fallback(frame: number): number {
        // CSS Writing Modes 4 §7.3.1: without a definite available inline space, the smallest of the containing block's inner
        // max size floored by its min size, the nearest scrollport's inner size, and the initial containing block's size.
        const axis: number = (frame & BoxSizes.VERTICAL) === 0 ? 0 : 1;
        return Math.min(this.limit, this.port[axis], this.initial[axis]);
    }

    private orthogonal(box: ElementBox, containerInline: number, parentFrame: number, frame: number, containerBlock?: number): BoxFragment {
        // CSS Writing Modes 4 §7.3: once sized, the box is positioned with the margins of the containing block's writing
        // mode, where "auto margins are resolved", as CSS 2 §10.3.3 does with a width that is given.
        const given: UsedSizes = this.sizes.of(box.style, containerBlock, containerInline, containerInline);
        const laid: BoxFragment = this.crossed(box, given, frame, containerBlock, containerInline, false);
        const start: number | undefined = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START));
        const end: number | undefined = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END));
        const free: number = containerInline - laid.blockSize;
        let offset: number = start ?? 0;
        if (start === undefined) {
            offset = Math.max(0, end === undefined ? free / 2 : free - end);
        }
        return this.turned(laid, offset, given, parentFrame, frame);
    }

    private turned(laid: BoxFragment, offset: number, given: UsedSizes, parentFrame: number, frame: number): BoxFragment {
        // The fragment of an orthogonal flow root is measured in the axes of its parent; CSS Writing Modes 4 §4.3: a box
        // without a baseline in the parent's axis has one synthesized from its margin edges.
        const inlineSize: number = laid.blockSize;
        laid.blockSize = laid.inlineSize;
        laid.inlineSize = inlineSize;
        laid.inline = offset;
        const before: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_START)) ?? 0;
        const after: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_END)) ?? 0;
        if (before === 0) {
            delete laid.marginBefore;
        } else {
            laid.marginBefore = this.margin(before);
        }
        if (after === 0) {
            delete laid.marginAfter;
        } else {
            laid.marginAfter = this.margin(after);
        }
        delete laid.firstBaseline;
        delete laid.baseline;
        return laid;
    }

    private reoriented(fragment: BoxFragment, parentFrame: number, frame: number): void {
        // A box whose block flow runs against its parent's has its block-start margin and its first line at the parent's
        // block-end side.
        if (((parentFrame ^ frame) & BoxSizes.BLOCK_REVERSED) === 0) {
            return;
        }
        const before: Margins | undefined = fragment.marginBefore;
        const after: Margins | undefined = fragment.marginAfter;
        delete fragment.marginBefore;
        delete fragment.marginAfter;
        if (after !== undefined) {
            fragment.marginBefore = after;
        }
        if (before !== undefined) {
            fragment.marginAfter = before;
        }
        const first: number | undefined = fragment.firstBaseline;
        const last: number | undefined = fragment.baseline;
        delete fragment.firstBaseline;
        delete fragment.baseline;
        if (last !== undefined) {
            fragment.firstBaseline = fragment.blockSize - last;
        }
        if (first !== undefined) {
            fragment.baseline = fragment.blockSize - first;
        }
    }

    private probe(box: ElementBox, sizes: UsedSizes, inlineSize: number, inlineOffset: number, independent: boolean, originInline: number, originBlock: number,
        trim?: TextEdges): BoxFragment {
        // A layout that only measures: the floats and the absolutely positioned boxes it placed are taken back.
        const floats: Floats | undefined = this.floats;
        const starts: number = floats === undefined ? 0 : floats.starts.length;
        const ends: number = floats === undefined ? 0 : floats.ends.length;
        const held: number = this.pending === undefined ? 0 : this.pending.size;
        const measured: BoxFragment = this.flow(box, sizes, inlineSize, inlineOffset, independent, originInline, originBlock, trim);
        if (floats === undefined) {
            delete this.floats;
        } else {
            floats.starts.length = starts;
            floats.ends.length = ends;
        }
        this.dropPlaceholders(held);
        return measured;
    }

    private dropPlaceholders(held: number): void {
        if (this.pending !== undefined && this.pending.size > held) {
            let kept: number = 0;
            for (const placeholder of this.pending) {
                if (kept++ >= held) {
                    this.pending.delete(placeholder);
                }
            }
        }
    }

    private block(box: ElementBox, containerInline: number, independent: boolean, originInline: number, top: number, containerBlock?: number,
        trim?: TextEdges, through: number = 0, space?: number, incoming?: BreakToken, truncate: boolean = false): BoxFragment {
        // CSS 2 §10.3.3: the margins, borders, padding and width of a block-level box in normal flow add up to the width of
        // its containing block. §10.4: a width that min-width or max-width changes is then used as if it had been given.
        const parentFrame: number = this.frame;
        const frame: number = this.sizes.frame(box.style);
        if (this.sizes.isOrthogonal(parentFrame, frame) || this.tables.isGrid(box)) {
            const whole: BoxFragment = this.sizes.isOrthogonal(parentFrame, frame) ? this.orthogonal(box, containerInline, parentFrame, frame, containerBlock)
                : this.tables.layout(box, containerInline, containerBlock, space, incoming);
            if (truncate) {
                delete whole.marginBefore;
            }
            return whole;
        }
        // CSS Display 3 §2.2: "The inner display of a replaced element is outside the scope of CSS."
        if (!box.replaced) {
            this.supported(box.display);
        }
        const given: UsedSizes = this.sizes.of(box.style, containerInline, containerBlock);
        if (truncate && given.margin !== undefined) {
            // CSS Fragmentation 4 §5.2: a margin adjoining the break is truncated.
            given.margin[this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_START)] = 0;
        }
        const edges: number = this.inlineEdges(given);
        // CSS Writing Modes 4 §7.4: the margins take the sides of the containing block's writing mode.
        const startSide: number = this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START);
        const start: number | undefined = this.sizes.margin(given, startSide);
        const end: number | undefined = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END));
        const before: number = this.sizes.edges(given, this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_START));
        const stretch: number = Math.max(0, containerInline - (start ?? 0) - (end ?? 0) - edges);
        const sizes: UsedSizes = this.resolved(box, given, stretch, containerBlock, through);
        let size: number | undefined = sizes.inlineSize;
        if (size === undefined && this.tables.isWrapper(box)) {
            size = this.tables.wrapperSize(box, stretch);
        }
        if (size === undefined) {
            // "If 'width' is set to 'auto', any other 'auto' values become '0' and 'width' follows from the resulting equality."
            // A calc-size() on the automatic size changes the size, and the box is still sized as auto.
            const automatic: number = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, stretch);
            if (automatic !== stretch || this.clamped(stretch, sizes.minInlineSize, sizes.maxInlineSize) === stretch) {
                const width: number = this.clamped(automatic, sizes.minInlineSize, sizes.maxInlineSize);
                const automaticFragment: BoxFragment = this.flow(box, sizes, width, start ?? 0, independent, this.origin(originInline, start ?? 0, width, sizes, startSide),
                    top + before, trim, space, incoming);
                this.reoriented(automaticFragment, parentFrame, frame);
                return automaticFragment;
            }
            size = stretch;
        }
        size = this.clamped(size, sizes.minInlineSize, sizes.maxInlineSize);
        // Auto margins share the free space, or are zero when there is none; without one, the end margin gives way.
        const free: number = containerInline - size - edges;
        let offset: number = start ?? 0;
        if (start === undefined) {
            offset = Math.max(0, end === undefined ? free / 2 : free - end);
        }
        const fragment: BoxFragment = this.flow(box, sizes, size, offset, independent, this.origin(originInline, offset, size, sizes, startSide), top + before, trim,
            space, incoming);
        this.reoriented(fragment, parentFrame, frame);
        return fragment;
    }

    private origin(originInline: number, offset: number, size: number, sizes: UsedSizes, startSide: number): number {
        // Where the inline-start edge of the box's content is in the block formatting context: a box whose direction is not
        // its parent's starts at the parent's end side.
        const near: number = startSide === BoxSizes.INLINE_START ? offset + this.sizes.edges(sizes, BoxSizes.INLINE_START)
            : offset + size + this.inlineEdges(sizes) - this.sizes.edges(sizes, BoxSizes.INLINE_START);
        return originInline + this.sign * near;
    }

    private child(node: ElementBox, inlineSize: number, shiftInline: number, shiftBlock: number, offset: number, pending: Margins, adjoining: boolean,
        blockBasis?: number, trim?: TextEdges, through: number = 0, limit?: number, incoming?: BreakToken, truncate: boolean = false): BoxFragment {
        // The place of a box follows from its collapsed margins, which are known once it is laid out, and its floats and
        // lines depend on that place; so it is laid out where it is expected, and again only if floats were met elsewhere.
        const separate: boolean = this.isIndependent(node);
        const cleared: number = this.clearEdge(node) - shiftBlock;
        let floor: number = Number.NEGATIVE_INFINITY;
        let estimate: number = offset + (adjoining ? 0 : pending[0] + pending[1]);
        const tried: Array<number> = [];
        for (;;) {
            const floats: Floats | undefined = this.floats;
            const starts: number = floats === undefined ? 0 : floats.starts.length;
            const ends: number = floats === undefined ? 0 : floats.ends.length;
            const used: boolean = floats !== undefined && floats.used;
            const held: number = this.pending === undefined ? 0 : this.pending.size;
            if (floats !== undefined) {
                floats.used = false;
            }
            // CSS 2 §9.5: the border box of a box that establishes a new block formatting context "must not overlap the
            // margin box of any floats in the same block formatting context as the element itself".
            const avoids: boolean = separate && floats !== undefined;
            const width: number = avoids ? this.band(shiftInline, inlineSize, shiftBlock + estimate, 0) : inlineSize;
            const shift: number = avoids ? this.bandOffset : 0;
            const child: BoxFragment = this.block(node, width, separate, shiftInline + this.sign * shift, shiftBlock + estimate, blockBasis, trim, through,
                limit === undefined ? undefined : limit - estimate, incoming, truncate);
            child.inline += shift;
            const margins: Margins = this.beforeBorder(node, child, pending);
            let top: number = Math.max(offset + (adjoining ? 0 : margins[0] + margins[1]), cleared, floor);
            const touched: boolean = this.floats !== undefined && this.floats.used;
            if (this.floats !== undefined) {
                this.floats.used = used || touched;
            }
            if (avoids && Math.abs(top - estimate) <= TOLERANCE && this.band(shiftInline, inlineSize, shiftBlock + top, child.blockSize) < width - TOLERANCE) {
                const next: number | undefined = this.below(shiftBlock + top);
                floor = next === undefined ? floor : next - shiftBlock;
                top = Math.max(top, floor);
            }
            child.block = top;
            // In a fragmentation context the room left for the box depends on where it ends up, so a box placed elsewhere than
            // expected is laid out again there.
            const moved: boolean = Math.abs(top - estimate) > TOLERANCE;
            tried.push(estimate);
            // The layout depends only on where the box is tried, so a place tried before means that the places cycle, which
            // CSS 2 §9.5 does not resolve: the box keeps the layout it has.
            if ((!touched && (limit === undefined || this.fragmenting?.restart === true)) || !moved
                || tried.some((place: number) => Math.abs(place - top) <= TOLERANCE)) {
                return child;
            }
            if (floats === undefined) {
                delete this.floats;
            } else {
                floats.starts.length = starts;
                floats.ends.length = ends;
            }
            this.dropPlaceholders(held);
            estimate = top;
        }
    }

    private beforeBorder(node: ElementBox, child: BoxFragment, pending: Margins): Margins {
        // CSS 2 §9.5.2: clearance depends on the place of the top border edge without clear, and §8.3.1: in a box that margins
        // collapse through, that place is "the same as it would have been if the element had a non-zero bottom border".
        if (child.marginAbove !== undefined && this.clearEdge(node) !== Number.NEGATIVE_INFINITY) {
            return this.merged(pending, child.marginAbove);
        }
        return this.merged(pending, child.marginBefore ?? NO_MARGIN);
    }

    private blockSized(box: ElementBox, given: UsedSizes, inlineSize: number, inlineOffset: number, independent: boolean, originInline: number, originBlock: number,
        trim?: TextEdges): UsedSizes {
        // CSS Sizing 4 §4.2: with a preferred aspect ratio and an automatic block size, the block size follows from the
        // inline size; §4.2.1: such a box "is not considered to have a computed block-size of auto".
        const keywords: ReadonlyArray<string> | undefined = given.keywords;
        const low: string = keywords === undefined ? "" : keywords[BoxSizes.MINIMUM_BLOCK];
        const high: string = keywords === undefined ? "" : keywords[BoxSizes.MAXIMUM_BLOCK];
        const dependent: boolean = given.ratio !== undefined && given.blockSize === undefined && !box.replaced;
        const preferred: number | undefined = dependent ? this.sizes.adjusted(given, BoxSizes.PREFERRED_BLOCK, this.sizes.transferred(given, inlineSize, false)) : given.blockSize;
        const measures: boolean = preferred !== undefined && !box.replaced
            && (CONTENT_SIZES.has(low) || CONTENT_SIZES.has(high) || (dependent && low === AUTOMATIC_MINIMUM));
        if (preferred === undefined || (!dependent && !measures)) {
            return given;
        }
        const sizes: UsedSizes = { ...given, blockSize: preferred };
        delete sizes.keywords;
        if (!measures) {
            return sizes;
        }
        // CSS Sizing 3 §3.2: in the block axis min-content, max-content and fit-content are the automatic size, the one
        // the content has when the box is laid out without a block size; what that layout placed is taken back.
        const unsized: UsedSizes = { ...given };
        delete unsized.blockSize;
        delete unsized.minBlockSize;
        delete unsized.maxBlockSize;
        delete unsized.keywords;
        delete unsized.ratio;
        delete unsized.calculations;
        const measured: BoxFragment = this.probe(box, unsized, inlineSize, inlineOffset, independent, originInline, originBlock, trim);
        const content: number = measured.blockSize - this.sizes.edges(given, BoxSizes.BLOCK_START) - this.sizes.edges(given, BoxSizes.BLOCK_END);
        let minimum: number | undefined = given.minBlockSize;
        let maximum: number | undefined = given.maxBlockSize;
        if (CONTENT_SIZES.has(high)) {
            maximum = this.sizes.adjusted(given, BoxSizes.MAXIMUM_BLOCK, content);
        }
        if (CONTENT_SIZES.has(low)) {
            minimum = this.sizes.adjusted(given, BoxSizes.MINIMUM_BLOCK, content);
        } else if (dependent && low === AUTOMATIC_MINIMUM) {
            // CSS Sizing 4 §4.3: "the automatic minimum size in the ratio-dependent axis" "is its min-content size capped
            // by its maximum size."
            const least: number = Math.min(content, maximum ?? Number.POSITIVE_INFINITY);
            minimum = given.calculations !== undefined && given.calculations[BoxSizes.MINIMUM_BLOCK] !== undefined
                ? this.sizes.adjusted(given, BoxSizes.MINIMUM_BLOCK, least) : Math.max(minimum ?? 0, least);
        }
        sizes.blockSize = this.clamped(preferred, minimum, maximum);
        delete sizes.minBlockSize;
        delete sizes.maxBlockSize;
        return sizes;
    }

    private flow(box: ElementBox, given: UsedSizes, inlineSize: number, inlineOffset: number, independent: boolean, originInline: number, originBlock: number,
        trim?: TextEdges, space?: number, incoming?: BreakToken): BoxFragment {
        return this.blockFlow(box, given, inlineSize, inlineOffset, independent, originInline, originBlock, trim, space, incoming);
    }

    private blockFlow(box: ElementBox, given: UsedSizes, inlineSize: number, inlineOffset: number, independent: boolean, originInline: number, originBlock: number,
        trim?: TextEdges, space?: number, incoming?: BreakToken): BoxFragment {
        const fragmenting: Fragmentation | undefined = space === undefined ? undefined : this.fragmenting;
        const sizes: UsedSizes = this.remaining(this.blockSized(box, given, inlineSize, inlineOffset, independent, originInline, originBlock, trim), incoming);
        // The contents are laid out in the box's own writing mode; in a block formatting context that it shares, a box whose
        // direction is not its parent's runs its inline axis against the context's.
        const outerFrame: number = this.frame;
        const outerSign: number = this.sign;
        const outerLimit: number = this.limit;
        const outerPort: readonly [number, number] = this.port;
        const frame: number = this.sizes.frame(box.style);
        this.sign = independent ? 1 : outerSign * (((outerFrame ^ frame) & BoxSizes.INLINE_REVERSED) !== 0 ? -1 : 1);
        this.frame = frame;
        this.limit = sizes.maxBlockSize === undefined ? Number.POSITIVE_INFINITY : Math.max(sizes.maxBlockSize, sizes.minBlockSize ?? 0);
        if (!this.hasVisibleOverflow(box)) {
            // CSS Writing Modes 4 §7.3.1: a scroll container's inner size, or else its inner max size, bounds an orthogonal flow.
            const across: number = sizes.blockSize ?? (sizes.maxBlockSize === undefined ? Number.POSITIVE_INFINITY : Math.max(sizes.maxBlockSize, sizes.minBlockSize ?? 0));
            this.port = (frame & BoxSizes.VERTICAL) === 0 ? [inlineSize, across] : [across, inlineSize];
        }
        const outer: Floats | undefined = this.floats;
        const shiftInline: number = independent ? 0 : originInline;
        const shiftBlock: number = independent ? 0 : originBlock;
        if (independent) {
            delete this.floats;
        }
        // CSS Fragmentation 4 §5.4: with box-decoration-break: slice "no border and no padding are inserted at a break",
        // and with clone each fragment has them; §5.2: "Cloned margins are always truncated to zero".
        const clone: boolean = this.keyword(box.style.values["box-decoration-break"]) === "clone";
        // A token of another box only resumes the children, as in the footnote area of a new page, which starts there itself.
        const resumed: boolean = incoming !== undefined && incoming.box === box;
        // CSS 2 §8.3.1: margins adjoin when no line box, clearance, padding or border separates them and the box is no block
        // formatting context root; adjoining margins are kept as their largest positive and their most negative member.
        const startEdge: number = resumed && !clone ? 0 : this.sizes.edges(sizes, BoxSizes.BLOCK_START);
        let endEdge: number = this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const adjoinsStart: boolean = !independent && startEdge === 0;
        const adjoinsEnd: boolean = !independent && endEdge === 0 && (sizes.minBlockSize ?? 0) === 0;
        // CSS Sizing 3 §4.2: a child that stretches in the block axis leaves out the margins that would collapse with these.
        const through: number = independent ? 0 : (startEdge === 0 ? 1 : 0) + (endEdge === 0 ? 2 : 0);
        const children: Array<BoxFragment | LineFragment> = [];
        let before: Margins = resumed ? NO_MARGIN : this.margin(this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0);
        let after: Margins = this.margin(this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0);
        let pending: Margins = NO_MARGIN;
        let keepsMargin: boolean = false;
        let offset: number = 0;
        let empty: boolean = true;
        let firstBaseline: number | undefined;
        let baseline: number | undefined;
        let sequence: number = incoming?.sequence ?? 0;
        // §5.3: the content of a box that breaks extends to the end of the fragmentainer, less a cloned block-end edge.
        const room: number = space === undefined ? Number.POSITIVE_INFINITY : space - startEdge - (clone ? endEdge : 0);
        let token: BreakToken | undefined;
        const avoiding: boolean = fragmenting !== undefined && this.avoids(box.style.values["break-inside"], fragmenting);
        if (fragmenting !== undefined) {
            fragmenting.path.push([box, 0]);
            fragmenting.avoid += avoiding ? 1 : 0;
        }
        // The floats of a block formatting context that go on in the next fragmentainer are kept by its root.
        const outerEnd: number = this.end;
        const outerTokens: Array<BreakToken> = this.floatTokens;
        const outerPushed: boolean = this.pushedFloat;
        if (independent) {
            this.floatTokens = [];
            this.pushedFloat = false;
        }
        this.end = fragmenting === undefined ? Number.POSITIVE_INFINITY : (independent ? room : shiftBlock + room);
        // CSS Inline 3 §6.2: text-box-trim trims the first formatted line unless "there is intervening non-zero padding or
        // borders", it does not go through flex, grid or table contexts, and the innermost block that asks gives the metric.
        const container: boolean = !box.replaced && box.display.internal === undefined && (box.display.inner === "flow" || box.display.inner === "flow-root");
        const trimming: string = container ? this.keyword(box.style.values["text-box-trim"]) : "none";
        const own: TextEdges | undefined = trimming === "none" ? undefined : this.inline.trimEdges(box.style.values);
        let startTrim: TextEdges | undefined = trimming === "trim-start" || trimming === "trim-both" ? own : (container && startEdge === 0 ? trim : undefined);
        let tail: BoxFragment | LineFragment | undefined;
        // CSS Containment 2 §3.1: a size containment box is sized "as if performing a normal layout of the box, except that
        // it is treated as having no content"; its content is then laid out in it, and a query container's is built for it.
        const containment: number = this.containment(box);
        const emptyContent: number | undefined = (containment & DisplayTypes.SIZE_CONTAINMENT) !== 0 ? this.explicitSize(box, true) ?? 0 : undefined;
        const containedBlock: number | undefined = emptyContent === undefined ? undefined
            : this.clamped(sizes.blockSize ?? this.sizes.adjusted(sizes, BoxSizes.PREFERRED_BLOCK, emptyContent), sizes.minBlockSize, sizes.maxBlockSize);
        if (box.queryContainer === true && this.contents !== undefined && this.contents(box, inlineSize, containedBlock)) {
            delete this.anchorNames;
            this.tables.forget();
        }
        const nodes: ReadonlyArray<BoxNode> | undefined = box.replaced ? undefined : box.children;
        if (resumed) {
            startTrim = undefined;
        }
        if (independent && incoming?.parallel !== undefined) {
            this.resumeFloats(incoming.parallel, children, sizes.blockSize);
        }
        for (let index: number = incoming?.child ?? 0; nodes !== undefined && index < nodes.length;) {
            if (fragmenting !== undefined && fragmenting.restart) {
                break;
            }
            const node: BoxNode = nodes[index];
            if (this.isBlockLevel(node)) {
                const resuming: BreakToken | undefined = incoming !== undefined && incoming.child === index ? incoming.inner : undefined;
                const filled: boolean = fragmenting !== undefined && fragmenting.filled;
                let local: Candidate | undefined;
                if (fragmenting !== undefined) {
                    fragmenting.path[fragmenting.path.length - 1][1] = index;
                    const previous: ElementBox | undefined = resuming === undefined && (incoming === undefined || index > incoming.child) ? this.previousSibling(nodes, index) : undefined;
                    if (previous !== undefined) {
                        // CSS Fragmentation 4 §4.3: a forced break puts what follows into the next fragmentainer, and at the top of
                        // one it is already there; §4.4: an unforced break here is a class A break point.
                        const point: readonly [number, string | undefined] = this.betweenBoxes(previous, node, fragmenting);
                        if ((point[1] !== undefined && filled) || this.reachesEarly(fragmenting, undefined)) {
                            token = this.token(box, index, sequence, undefined, undefined, point[1]);
                            break;
                        }
                        local = filled ? this.record(fragmenting, point[0], undefined) : undefined;
                    }
                }
                index++;
                const mark: Snapshot = this.snapshot(children);
                const child: BoxFragment = this.child(node, inlineSize, shiftInline, shiftBlock, offset, pending, empty && adjoinsStart, sizes.blockSize, startTrim, through,
                    fragmenting === undefined || this.isMonolithic(node) ? undefined : room, resuming, fragmenting !== undefined && !filled && this.truncates(node, fragmenting));
                if (fragmenting !== undefined && fragmenting.restart) {
                    break;
                }
                if (fragmenting !== undefined && child.token === undefined && child.block + child.blockSize > room + TOLERANCE && filled) {
                    // §4.4: the child does not fit and cannot break, so the best break point found so far takes the break.
                    if (local !== undefined && fragmenting.best === local) {
                        this.restore(children, mark);
                        token = this.token(box, index - 1, sequence, undefined, undefined, undefined);
                        break;
                    }
                    if (this.restartAt(fragmenting)) {
                        break;
                    }
                }
                if (fragmenting !== undefined) {
                    if (child.token === undefined && child.block + child.blockSize > room + TOLERANCE && !filled) {
                        this.contentOverflows();
                    }
                    fragmenting.filled = true;
                }
                children.push(child);
                const above: Margins = this.beforeBorder(node, child, pending);
                pending = this.merged(pending, child.marginBefore ?? NO_MARGIN);
                const collapsed: number = offset + (empty && adjoinsStart ? 0 : pending[0] + pending[1]);
                const cleared: boolean = child.block > offset + (empty && adjoinsStart ? 0 : above[0] + above[1]) + TOLERANCE;
                if (child.collapsesThrough === true && !cleared) {
                    child.block = collapsed;
                    continue;
                }
                if (cleared) {
                    // CSS 2 §9.5.2: "Clearance inhibits margin collapsing and acts as spacing above the margin-top".
                    offset = child.block;
                } else if (empty && adjoinsStart) {
                    before = this.merged(before, pending);
                } else {
                    offset += pending[0] + pending[1];
                }
                child.block = offset;
                offset += child.collapsesThrough === true ? 0 : child.blockSize;
                firstBaseline = firstBaseline ?? (child.firstBaseline === undefined ? undefined : child.block + child.firstBaseline);
                baseline = child.baseline === undefined ? baseline : child.block + child.baseline;
                pending = child.marginAfter ?? NO_MARGIN;
                keepsMargin = child.collapsesThrough === true;
                if (keepsMargin) {
                    // CSS 2 §8.3.1: the margins of a cleared box that collapses through go on with its following siblings, "but that
                    // resulting margin does not collapse with the bottom margin of the parent"; §9.5.2: they start under the clearance.
                    pending = child.marginBefore ?? NO_MARGIN;
                    const margin: Margins = child.marginAbove ?? NO_MARGIN;
                    offset -= margin[0] + margin[1];
                }
                empty = false;
                startTrim = undefined;
                tail = child;
                if (child.token !== undefined) {
                    token = this.token(box, index - 1, sequence, undefined, child.token, undefined);
                    break;
                }
                continue;
            }
            const outside: BoxNode = nodes[index];
            if (outside.kind === "box" && this.isPlacedAlone(nodes, index)) {
                // CSS Fragmentation 4 §4.1: "a float and an immediately-adjacent in-flow or floated box" meet at a class A
                // break point, so the out-of-flow boxes that make no line box are placed one at a time.
                const floated: boolean = outside.placement === "float";
                const previous: ElementBox | undefined = fragmenting !== undefined && floated && (incoming === undefined || index > incoming.child)
                    ? this.previousSibling(nodes, index) : undefined;
                if (fragmenting !== undefined && previous !== undefined) {
                    fragmenting.path[fragmenting.path.length - 1][1] = index;
                    const point: readonly [number, string | undefined] = this.betweenBoxes(previous, outside, fragmenting);
                    if ((point[1] !== undefined && fragmenting.filled) || this.reachesEarly(fragmenting, undefined)) {
                        token = this.token(box, index, sequence, undefined, undefined, point[1]);
                        break;
                    }
                    if (fragmenting.filled) {
                        this.record(fragmenting, point[0], undefined);
                    }
                }
                if (fragmenting !== undefined && fragmenting.filled && this.pushed.has(outside)) {
                    // GCPM 3 §2.8: a footnote whose body does not fit with its call goes to the next page with the call.
                    token = this.token(box, index, sequence, undefined, undefined, undefined);
                    break;
                }
                // The run is one inline sequence, counted where it starts.
                sequence += index === 0 || this.isBlockLevel(nodes[index - 1]) ? 1 : 0;
                const top: number = offset + (empty && adjoinsStart ? 0 : pending[0] + pending[1]);
                const placed: number = children.length;
                if (floated) {
                    this.place(outside, shiftInline, inlineSize, shiftBlock, top, -1, children, sizes.blockSize);
                } else if (outside.placement === "absolute" || outside.placement === "fixed") {
                    const placeholder: BoxFragment = this.placeholder(outside);
                    placeholder.block = top;
                    children.push(placeholder);
                } else if (outside.placement === "running" || outside.placement === "footnote") {
                    children.push(this.emptyPlace(outside, top));
                }
                if (fragmenting !== undefined && floated && children.length > placed) {
                    fragmenting.filled = true;
                }
                index++;
                continue;
            }
            const start: number = index;
            while (index < nodes.length && !this.isBlockLevel(nodes[index])) {
                index++;
            }
            const run: InlineSequence | undefined = box.inline?.[sequence++];
            const resume: number | undefined = incoming !== undefined && incoming.child === start ? incoming.line : undefined;
            const marks: Array<Snapshot> | undefined = fragmenting === undefined ? undefined : [];
            const early: Candidate | undefined = fragmenting?.early;
            let cut: readonly [number, number] | undefined;
            if (fragmenting !== undefined && early?.line !== undefined) {
                // CSS Text 4 §6.1.1: which soft wrap opportunity a line ends at is UA-defined, so a page that has to end inside
                // a line ends that line at the last opportunity before it.
                fragmenting.path[fragmenting.path.length - 1][1] = start;
                cut = this.order(fragmenting.path, early.line, early) === 0 ? early.line : undefined;
            }
            const lines: Array<LineFragment> | undefined = run === undefined ? undefined
                : this.inline.layout(run, inlineSize, shiftInline, shiftBlock, offset + (empty && adjoinsStart ? 0 : pending[0] + pending[1]), children, sizes.blockSize, resume, marks,
                    cut);
            if (lines === undefined) {
                continue;
            }
            if (startTrim !== undefined) {
                this.inline.trimLine(lines, false, startTrim);
                startTrim = undefined;
            }
            if (empty && adjoinsStart) {
                before = this.merged(before, pending);
            } else {
                offset += pending[0] + pending[1];
            }
            if (fragmenting !== undefined && marks !== undefined) {
                fragmenting.path[fragmenting.path.length - 1][1] = start;
                const kept: number = this.linesKept(box, lines, offset, room, fragmenting);
                if (fragmenting.restart) {
                    break;
                }
                if (kept < lines.length) {
                    this.restore(children, marks[kept]);
                    token = this.token(box, start, sequence - 1, lines[kept].start, undefined, undefined);
                    lines.length = kept;
                }
            }
            tail = lines[lines.length - 1];
            for (const line of lines) {
                line.block += offset;
                children.push(line);
            }
            const last: LineFragment = lines[lines.length - 1];
            firstBaseline = firstBaseline ?? lines[0].block + lines[0].baseline;
            baseline = last.block + last.baseline;
            offset = last.block + last.blockSize;
            pending = NO_MARGIN;
            empty = false;
            if (token !== undefined) {
                break;
            }
        }
        let markerSize: number = 0;
        for (let index: number = 0; !resumed && nodes !== undefined && index < nodes.length; index++) {
            const node: BoxNode = nodes[index];
            if (node.kind === "box" && node.placement === "marker") {
                // CSS Lists 3 §3.5: "CSS does not specify the precise location of the marker box", "but does require that it
                // be placed on the inline-start side of the box"; its first line sits on the first line of the list item.
                const placed: readonly [BoxFragment, number] = this.atomic(node, inlineSize, sizes.blockSize);
                const marker: BoxFragment = placed[0];
                marker.inline -= this.sizes.edges(sizes, BoxSizes.INLINE_START) + placed[1];
                marker.block = firstBaseline !== undefined && marker.firstBaseline !== undefined ? firstBaseline - marker.firstBaseline : 0;
                children.push(marker);
                markerSize = firstBaseline === undefined ? Math.max(markerSize, marker.blockSize) : markerSize;
            }
        }
        if (markerSize > 0) {
            // §3.5: the marker "in some cases may cause the creation of a new line box", so a list item without lines is
            // as tall as its marker.
            if (empty) {
                before = adjoinsStart ? this.merged(before, pending) : before;
                offset += adjoinsStart ? 0 : pending[0] + pending[1];
                pending = NO_MARGIN;
                empty = false;
            }
            offset = Math.max(offset, markerSize);
        }
        if (token === undefined && tail !== undefined && own !== undefined && (trimming === "trim-end" || trimming === "trim-both")) {
            offset -= this.trimLast(tail, own);
        }
        // CSS 2 §10.6.3: the margins after the last child are inside an auto height only when they collapse neither through
        // the box nor with its end; CSS Fragmentation 4 §5.2 decides what a break does to the ones outside it.
        const auto: boolean = sizes.blockSize === undefined;
        const inside: boolean = !(empty && adjoinsStart) && !(adjoinsEnd && auto && !keepsMargin);
        if (fragmenting !== undefined && token === undefined && !fragmenting.restart && sizes.blockSize !== undefined && sizes.blockSize > room + TOLERANCE) {
            // CSS Fragmentation 4 §4.1 class C: the box is taller than what is left, so it breaks after its content, which
            // the rest of its block size follows in the next fragmentainer.
            fragmenting.path[fragmenting.path.length - 1][1] = nodes === undefined ? 0 : nodes.length;
            const early: boolean = this.reachesEarly(fragmenting, undefined);
            const local: Candidate | undefined = early ? undefined : this.record(fragmenting, fragmenting.avoid > 0 ? APPEAL_AVOID : APPEAL_PERFECT, undefined);
            if (early || fragmenting.best === local || !this.restartAt(fragmenting)) {
                token = this.token(box, nodes === undefined ? 0 : nodes.length, sequence, undefined, undefined, undefined);
            }
        } else if (fragmenting !== undefined && token === undefined && !fragmenting.restart && space !== undefined
            && startEdge + (sizes.blockSize ?? offset + (inside ? pending[0] + pending[1] : 0)) + endEdge > space + TOLERANCE) {
            // §4.4: the block-end edge that does not fit is pushed with what comes before it, to the best break point found.
            this.restartAt(fragmenting);
        }
        if (independent && fragmenting !== undefined && !fragmenting.restart && this.floatTokens.length > 0) {
            token = token ?? this.token(box, nodes === undefined ? 0 : nodes.length, sequence, undefined, undefined, undefined);
            token.parallel = this.floatTokens;
        }
        if (token !== undefined) {
            // §5.3: "its content box extends to fill any remaining fragmentainer extent", and §5.2: the margins adjoining an
            // unforced break are truncated; with slice the block-end border and padding come on the last fragment only.
            token.consumed = (incoming?.consumed ?? 0) + room;
            offset = room;
            pending = NO_MARGIN;
            after = NO_MARGIN;
            endEdge = clone ? endEdge : 0;
        }
        let marginAbove: Margins | undefined;
        let content: number = offset;
        if (empty && adjoinsStart && adjoinsEnd && (auto || sizes.blockSize === 0) && !box.replaced && token === undefined) {
            // A bottom border would leave out this box's own bottom margin alone: what its children hold still adjoins the top.
            marginAbove = this.merged(before, pending);
            before = this.merged(marginAbove, after);
            after = NO_MARGIN;
        } else if (empty && adjoinsStart) {
            before = this.merged(before, pending);
        } else if (adjoinsEnd && auto && !keepsMargin) {
            after = this.merged(after, pending);
        } else {
            content += pending[0] + pending[1];
        }
        const grouping: string = container ? this.keyword(box.style.values["text-group-align"]) : "none";
        if (grouping !== "none") {
            this.groupAlign(children, inlineSize, grouping, (frame & BoxSizes.RIGHT_TO_LEFT) !== 0, frame);
        }
        if (independent) {
            // CSS 2 §10.6.7: the auto height of a block formatting context root reaches the bottom margin edge of its floats.
            if (this.floats !== undefined) {
                for (const side of [this.floats.starts, this.floats.ends]) {
                    for (let index: number = 0; index < side.length; index += FLOAT_FIELDS) {
                        content = Math.max(content, side[index + 1] + side[index + 3]);
                    }
                }
            }
            if (outer === undefined) {
                delete this.floats;
            } else {
                this.floats = outer;
            }
        }
        const blockSize: number = token !== undefined ? Math.max(0, room)
            : containedBlock ?? this.clamped(sizes.blockSize ?? this.sizes.adjusted(sizes, BoxSizes.PREFERRED_BLOCK, content), sizes.minBlockSize, sizes.maxBlockSize);
        const fragment: BoxFragment = {
            kind: "box", box, inline: inlineOffset, block: 0, inlineSize: inlineSize + this.inlineEdges(sizes), blockSize: startEdge + blockSize + endEdge
        };
        // A fragment is kept for every box of the document, so it holds only what its box has; a sliced fragment has no
        // border or padding on the sides where the box breaks.
        const opens: boolean = resumed && !clone;
        const closes: boolean = token !== undefined && !clone;
        if (sizes.border !== undefined) {
            fragment.border = opens || closes ? this.sliced(sizes.border, opens, closes) : sizes.border;
        }
        if (sizes.padding !== undefined) {
            fragment.padding = opens || closes ? this.sliced(sizes.padding, opens, closes) : sizes.padding;
        }
        if (resumed) {
            fragment.resumed = true;
        }
        if (token !== undefined) {
            fragment.token = token;
        }
        if (before !== NO_MARGIN) {
            fragment.marginBefore = before;
        }
        if (after !== NO_MARGIN) {
            fragment.marginAfter = after;
        }
        if (marginAbove !== undefined) {
            fragment.collapsesThrough = true;
            fragment.marginAbove = marginAbove;
        }
        if (firstBaseline !== undefined) {
            fragment.firstBaseline = startEdge + firstBaseline;
        }
        if (baseline !== undefined) {
            fragment.baseline = startEdge + baseline;
        }
        const area: ObjectArea | undefined = box.replaced && sizes.natural !== undefined ? this.objectArea(box, sizes.natural, inlineSize, blockSize) : undefined;
        if (area !== undefined) {
            fragment.object = area;
        }
        if (box.replaced && sizes.natural?.[0] !== undefined && sizes.natural[1] !== undefined) {
            fragment.natural = [sizes.natural[0], sizes.natural[1]];
        }
        const imageBaseline: number | undefined = box.replaced && sizes.natural !== undefined ? this.imageBaseline(box, area ?? [0, 0, inlineSize, blockSize]) : undefined;
        if (imageBaseline !== undefined) {
            fragment.firstBaseline = startEdge + imageBaseline;
            fragment.baseline = startEdge + imageBaseline;
        }
        for (const child of children) {
            const moved: readonly [number, number] | undefined = child.kind === "box" ? this.sizes.relativeShift(child.box.style, inlineSize, sizes.blockSize, frame) : undefined;
            if (child.kind === "box" && moved !== undefined) {
                child.inline += moved[0];
                child.block += moved[1];
            }
        }
        if (children.length > 0) {
            fragment.children = children;
        }
        // CSS Containment 2 §3.2 and §3.4: a layout or paint containment box "establishes an absolute positioning containing
        // block and a fixed positioning containing block".
        const containing: boolean = (containment & CONTAINING_BLOCK) !== 0;
        if (containing || (this.keyword(box.style.values["position"]) !== "none" && this.keyword(box.style.values["position"]) !== "static")) {
            this.positioned(fragment, containing);
        }
        if (fragmenting !== undefined) {
            fragmenting.path.pop();
            fragmenting.avoid -= avoiding ? 1 : 0;
        }
        this.end = outerEnd;
        this.floatTokens = outerTokens;
        this.pushedFloat = outerPushed;
        this.frame = outerFrame;
        this.sign = outerSign;
        this.limit = outerLimit;
        this.port = outerPort;
        return fragment;
    }

    parallel<T>(run: () => T, token?: BreakToken): T {
        // CSS Fragmentation 4 §2.1: "When multiple formatting contexts are laid out parallel to each other, fragmentation is
        // performed independently in each formatting context", such as floats and the cells of a row.
        const outer: Fragmentation | undefined = this.fragmenting;
        return outer === undefined ? run() : this.fragmented(outer.kinds, outer.extent, outer.breadth, token, run);
    }

    private fragmented<T>(kinds: ReadonlyArray<string>, extent: number, breadth: number, token: BreakToken | undefined, run: () => T, end?: Candidate): T {
        let forced: boolean = false;
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            forced = forced || level.forced !== undefined;
        }
        let early: Candidate | undefined = end;
        const tried: Array<Candidate> = [];
        for (;;) {
            const state: Fragmentation = { kinds, extent, breadth, path: [], avoid: 0, filled: false, resumed: token !== undefined, forced, restart: false };
            if (early !== undefined) {
                state.early = early;
            }
            const outer: Fragmentation | undefined = this.fragmenting;
            const held: number = this.pending === undefined ? 0 : this.pending.size;
            this.fragmenting = state;
            const result: T = run();
            if (outer === undefined) {
                delete this.fragmenting;
            } else {
                this.fragmenting = outer;
            }
            // §4.4: a better break point than the one where the content overflowed lies earlier, so the fragmentainer is
            // laid out again with the break there; a break point tried before means that the attempts cycle, and the last stays.
            const next: Candidate | undefined = state.early;
            if (!state.restart || next === undefined || tried.some((candidate: Candidate) => this.sameCandidate(candidate, next))) {
                this.flowAppeal = state.worst ?? next?.appeal ?? state.best?.appeal ?? APPEAL_PERFECT;
                if (outer === undefined) {
                    this.pageState = state;
                }
                return result;
            }
            tried.push(next);
            early = next;
            this.dropPlaceholders(held);
        }
    }

    snapshot(out: ReadonlyArray<BoxFragment | LineFragment>): Snapshot {
        return [out.length, this.floats === undefined ? 0 : this.floats.starts.length, this.floats === undefined ? 0 : this.floats.ends.length, this.floatTokens.length];
    }

    private restore(out: Array<BoxFragment | LineFragment>, mark: Snapshot): void {
        // What was placed after the mark goes to the next fragmentainer: the fragments, their floats and their placeholders.
        for (let index: number = mark[0]; index < out.length; index++) {
            const node: BoxFragment | LineFragment = out[index];
            if (node.kind === "box") {
                this.pending?.delete(node);
            }
        }
        out.length = mark[0];
        if (this.floats !== undefined) {
            this.floats.starts.length = Math.min(this.floats.starts.length, mark[1]);
            this.floats.ends.length = Math.min(this.floats.ends.length, mark[2]);
        }
        this.floatTokens.length = Math.min(this.floatTokens.length, mark[3]);
        this.pushedFloat = this.floatTokens.some((token: BreakToken) => token.pushed === true);
    }

    private remaining(sizes: UsedSizes, incoming?: BreakToken): UsedSizes {
        // CSS Fragmentation 4 §5.3: "The extra block size contributed by fragmenting the box" "contributes progress towards
        // any specified limits on the box's block size", so a continuation has what the earlier fragments left.
        if (incoming === undefined || incoming.consumed === 0) {
            return sizes;
        }
        const used: UsedSizes = { ...sizes };
        if (sizes.blockSize !== undefined) {
            used.blockSize = Math.max(0, sizes.blockSize - incoming.consumed);
        }
        if (sizes.minBlockSize !== undefined) {
            used.minBlockSize = Math.max(0, sizes.minBlockSize - incoming.consumed);
        }
        if (sizes.maxBlockSize !== undefined) {
            used.maxBlockSize = Math.max(0, sizes.maxBlockSize - incoming.consumed);
        }
        return used;
    }

    private token(box: ElementBox, child: number, sequence: number, line: number | undefined, inner: BreakToken | undefined, forced: string | undefined): BreakToken {
        const token: BreakToken = { box, consumed: 0, child, sequence };
        if (line !== undefined) {
            token.line = line;
        }
        if (inner !== undefined) {
            token.inner = inner;
        }
        if (forced !== undefined) {
            token.forced = forced;
        }
        return token;
    }

    private record(fragmenting: Fragmentation, appeal: number, line: readonly [number, number] | undefined): Candidate {
        // CSS Fragmentation 4 §4.5: among the break points that the rules allow equally, the latest one leaves the fewest
        // breaks and the fullest fragmentainers.
        const candidate: Candidate = { appeal, path: fragmenting.path.map((step: [ElementBox, number]): readonly [ElementBox, number] => [step[0], step[1]]) };
        if (line !== undefined) {
            candidate.line = line;
        }
        if (fragmenting.best === undefined || appeal >= fragmenting.best.appeal) {
            if (fragmenting.best !== undefined) {
                fragmenting.prior = fragmenting.best;
            }
            fragmenting.best = candidate;
        }
        return candidate;
    }

    private reachesEarly(fragmenting: Fragmentation, line: readonly [number, number] | undefined): boolean {
        const early: Candidate | undefined = fragmenting.early;
        const order: number = early === undefined ? -1 : this.order(fragmenting.path, line, early);
        if (order > 0) {
            // Text that changed since the break point was recorded can leave no break point there.
            this.restartAt(fragmenting);
        }
        return order >= 0;
    }

    order(path: ReadonlyArray<readonly [ElementBox, number]>, line: readonly [number, number] | undefined, other: Candidate): number {
        const depth: number = Math.min(path.length, other.path.length);
        for (let index: number = 0; index < depth; index++) {
            if (path[index][1] !== other.path[index][1]) {
                return path[index][1] < other.path[index][1] ? -1 : 1;
            }
        }
        if (path.length !== other.path.length) {
            return path.length < other.path.length ? -1 : 1;
        }
        if (line === undefined || other.line === undefined) {
            return line === other.line ? 0 : (line === undefined ? -1 : 1);
        }
        if (line[0] !== other.line[0]) {
            return line[0] < other.line[0] ? -1 : 1;
        }
        return line[1] === other.line[1] ? 0 : (line[1] < other.line[1] ? -1 : 1);
    }

    private sameCandidate(first: Candidate, second: Candidate): boolean {
        return first.line?.[0] === second.line?.[0] && first.line?.[1] === second.line?.[1] && first.path.length === second.path.length
            && first.path.every((step: readonly [ElementBox, number], depth: number) => step[0] === second.path[depth][0] && step[1] === second.path[depth][1]);
    }

    private restartAt(fragmenting: Fragmentation): boolean {
        if (fragmenting.best === undefined) {
            return false;
        }
        fragmenting.early = fragmenting.best;
        fragmenting.restart = true;
        return true;
    }

    isFragmenting(): boolean {
        return this.fragmenting !== undefined;
    }

    fragmentainer(): readonly [number, number, boolean] {
        // The block size and the inline size of the fragmentainers, and whether they are pages.
        const fragmenting: Fragmentation = this.fragmenting as Fragmentation;
        return [fragmenting.extent, fragmenting.breadth, fragmenting.kinds[fragmenting.kinds.length - 1] === "page"];
    }

    fill(): void {
        if (this.fragmenting !== undefined) {
            this.fragmenting.filled = true;
        }
    }

    enterBreaks(box: ElementBox): boolean {
        // A layout mode other than block flow takes part in the break points of its fragmentation context.
        const fragmenting: Fragmentation = this.fragmenting as Fragmentation;
        const avoiding: boolean = this.avoids(box.style.values["break-inside"], fragmenting);
        fragmenting.path.push([box, 0]);
        fragmenting.avoid += avoiding ? 1 : 0;
        return avoiding;
    }

    leaveBreaks(avoiding: boolean): void {
        const fragmenting: Fragmentation = this.fragmenting as Fragmentation;
        fragmenting.path.pop();
        fragmenting.avoid -= avoiding ? 1 : 0;
    }

    breakPoint(index: number, values: ReadonlyArray<string>): readonly [string | undefined, boolean, boolean] {
        // A class A break point before the item at the index: the forced break type, whether the break is taken here, and
        // whether this is the best break point found so far.
        const fragmenting: Fragmentation = this.fragmenting as Fragmentation;
        fragmenting.path[fragmenting.path.length - 1][1] = index;
        const point: readonly [number, string | undefined] = this.classify(values, fragmenting);
        if (point[1] !== undefined && fragmenting.filled) {
            return [point[1], true, false];
        }
        if (this.reachesEarly(fragmenting, undefined)) {
            return [undefined, true, false];
        }
        if (!fragmenting.filled) {
            return [undefined, false, false];
        }
        const local: Candidate = this.record(fragmenting, point[0], undefined);
        return [undefined, false, fragmenting.best === local];
    }

    avoidsBreak(value: string): boolean {
        return this.fragmenting !== undefined && this.avoids(value, this.fragmenting);
    }

    restartBreak(): boolean {
        return this.fragmenting !== undefined && this.restartAt(this.fragmenting);
    }

    breakAppeal(token?: BreakToken): number {
        // How well the parallel flow that just ended keeps the rules of §4.4; a forced break overrides them.
        if (this.flowAppeal === APPEAL_OVERFLOW) {
            return APPEAL_OVERFLOW;
        }
        if (token === undefined) {
            return APPEAL_PERFECT;
        }
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            if (level.forced !== undefined) {
                return APPEAL_PERFECT;
            }
        }
        return this.flowAppeal;
    }

    contentOverflows(): void {
        // §4.4: the UA "must place at least some content on each fragmentainer", so the first content of a flow stays even when
        // it overflows; the flow around a parallel flow may still have a break point before it.
        if (this.fragmenting !== undefined) {
            this.fragmenting.worst = APPEAL_OVERFLOW;
        }
    }

    betterBreak(token: BreakToken): boolean {
        // §4.4: the rules are dropped only "if the above doesn't provide enough break points", and a parallel flow does not see
        // the break points of the flow around it, so that flow checks whether one of them keeps more of the rules.
        const best: Candidate | undefined = this.fragmenting?.best;
        return best !== undefined && best.appeal > (token.appeal ?? APPEAL_PERFECT);
    }

    keepRowBreak(token: BreakToken): void {
        if (this.fragmenting !== undefined) {
            this.fragmenting.worst = Math.min(this.fragmenting.worst ?? APPEAL_PERFECT, token.appeal ?? APPEAL_PERFECT);
        }
    }

    private betweenBoxes(previous: ElementBox, next: ElementBox, fragmenting: Fragmentation): readonly [number, string | undefined] {
        const values: Array<string> = [...this.breakValues(previous, "break-after", false), ...this.breakValues(next, "break-before", true)];
        // CSS Paged Media 3 §8.1: when "the end page value of the box preceding the break and start page value of the box
        // succeeding the break do not match, then a page break is forced between the two boxes".
        if (previous.endPage !== next.startPage) {
            values.push("page");
        }
        return this.classify(values, fragmenting);
    }

    resumedPage(token: BreakToken): string {
        // CSS Paged Media 3 §8.1: content after a break "resumes on a page box of the named type", the start page value of the
        // box after the break point, or the used value of the box whose lines, rows or block size go on.
        const resumed: readonly [ElementBox, BoxNode | undefined] = this.resumedAt(token);
        const next: BoxNode | undefined = resumed[1];
        return next !== undefined && this.displays.takesPage(next) ? next.startPage : resumed[0].usedPage;
    }

    resumedAt(token: BreakToken): readonly [ElementBox, BoxNode | undefined] {
        let level: BreakToken = token;
        while (level.inner !== undefined) {
            level = level.inner;
        }
        const box: ElementBox = level.box;
        if (level.line !== undefined) {
            return [box, undefined];
        }
        return [box, this.tables.isGrid(box) ? this.tables.rowBox(box, level.child) : box.children[level.child]];
    }

    private classify(values: ReadonlyArray<string>, fragmenting: Fragmentation): readonly [number, string | undefined] {
        // CSS Fragmentation 4 §4.3: a forced value among the break-after values of the earlier box and the break-before values
        // of the later one forces the break, with all its types honored and the latest page side winning.
        let forced: string | undefined;
        let avoided: boolean = false;
        for (const value of values) {
            const type: string | undefined = this.forcedType(value, fragmenting.kinds);
            if (type !== undefined && PAGE_BREAKS.has(type)) {
                forced = forced !== undefined && PAGE_BREAKS.has(forced) && type === "page" ? forced : type;
            } else if (type !== undefined && forced === undefined) {
                forced = type;
            }
            avoided = avoided || this.avoids(value, fragmenting);
        }
        // §4.4 rules 1 and 2: an avoid value here, or a common ancestor whose break-inside avoids the break, forbids it.
        return [forced === undefined && (avoided || fragmenting.avoid > 0) ? APPEAL_AVOID : APPEAL_PERFECT, forced];
    }

    private breakValues(box: ElementBox, property: string, first: boolean): Array<string> {
        // CSS Fragmentation 4 §3.1.1: "a break-before value on a first in-flow child box is propagated to its container", and
        // a break-after value on a last one, in the order the boxes start or end in the flow.
        const values: Array<string> = [];
        let current: ElementBox | undefined = box;
        while (current !== undefined) {
            const keyword: string = this.keyword(current.style.values[property]);
            if (keyword !== "none" && keyword !== "auto") {
                values.push(keyword);
            }
            current = this.propagates(current) ? this.edgeChild(current, first) : undefined;
        }
        return first ? values : values.reverse();
    }

    private propagates(box: ElementBox): boolean {
        // "This propagation stops before it breaks through the nearest matching fragmentation context", which a multi-column
        // container is; flex and grid layout have their own rules, and a table row holds parallel flows.
        if (this.tables.isGrid(box) || this.tables.isRowGroup(box)) {
            return true;
        }
        const count: string = this.keyword(box.style.values["column-count"]);
        const width: string = this.keyword(box.style.values["column-width"]);
        return !box.replaced && this.displays.isBlockContainer(box.display) && box.display.internal === undefined && (count === "none" || count === "auto")
            && (width === "none" || width === "auto");
    }

    private edgeChild(box: ElementBox, first: boolean): ElementBox | undefined {
        if (this.tables.isGrid(box) || this.tables.isRowGroup(box)) {
            return this.tables.edgeItem(box, first);
        }
        const nodes: ReadonlyArray<BoxNode> = box.children;
        for (let step: number = 0; step < nodes.length; step++) {
            const node: BoxNode = nodes[first ? step : nodes.length - 1 - step];
            if (node.kind === "box" && node.placement !== "in-flow") {
                continue;
            }
            return this.isBlockLevel(node) ? node : undefined;
        }
        return undefined;
    }

    private forcedType(value: string, kinds: ReadonlyArray<string>): string | undefined {
        // CSS Fragmentation 4 §3.1: always is a break of the immediately containing fragmentation context, all breaks through
        // all of them; "If the forced break is not contained within a matching type of fragmentation context", it does nothing.
        switch (value) {
            case "always":
                return kinds[kinds.length - 1];
            case "all":
                return kinds[0];
            case "column":
                return kinds.includes("column") ? value : undefined;
            default:
                return PAGE_BREAKS.has(value) && kinds.includes("page") ? value : undefined;
        }
    }

    private avoids(value: CssValue | string | undefined, fragmenting: Fragmentation): boolean {
        const keyword: string = typeof value === "string" ? value : this.keyword(value);
        return keyword === "avoid" || keyword === "avoid-" + fragmenting.kinds[fragmenting.kinds.length - 1];
    }

    private previousSibling(nodes: ReadonlyArray<BoxNode>, index: number): ElementBox | undefined {
        for (let before: number = index - 1; before >= 0; before--) {
            const node: BoxNode = nodes[before];
            if (node.kind !== "box") {
                return undefined;
            }
            if (node.placement === "float") {
                return node;
            }
            if (node.placement === "in-flow") {
                return this.isBlockLevel(node) ? node : undefined;
            }
        }
        return undefined;
    }

    private isPlacedAlone(nodes: ReadonlyArray<BoxNode>, index: number): boolean {
        let first: number = index;
        while (first > 0 && !this.isBlockLevel(nodes[first - 1])) {
            first--;
        }
        for (let at: number = first; at < nodes.length && !this.isBlockLevel(nodes[at]); at++) {
            const node: BoxNode = nodes[at];
            if (node.kind !== "box" || node.placement === "in-flow") {
                return false;
            }
        }
        return true;
    }

    private isMonolithic(box: ElementBox): boolean {
        // CSS Fragmentation 4 §4.1: replaced, scrollable and clipped fixed-size boxes have no break points, nor "Size containment
        // boxes" (CSS Containment 2 §3.1) or an orthogonal flow, whose lines cross the fragmentation direction.
        if (box.replaced || this.sizes.isOrthogonal(this.frame, this.sizes.frame(box.style))
            || (this.containment(box) & DisplayTypes.SIZE_CONTAINMENT) !== 0) {
            return true;
        }
        const overflow: string = this.keyword(box.style.values["overflow-y"]);
        const inline: string = this.keyword(box.style.values["overflow-x"]);
        if (overflow === "auto" || overflow === "scroll" || inline === "auto" || inline === "scroll") {
            return true;
        }
        const size: CssValue | undefined = box.style.values["block-size"];
        const maximum: CssValue | undefined = box.style.values["max-block-size"];
        return (overflow === "hidden" || inline === "hidden") && size !== undefined && size.kind !== "ident" && (maximum === undefined || maximum.kind === "ident");
    }

    private truncates(node: ElementBox, fragmenting: Fragmentation): boolean {
        // CSS Fragmentation 4 §5.2: with auto the margins after an unforced break are truncated to zero and those after a
        // forced one are kept; discard truncates them at every break and at the start of the context, keep never.
        const keyword: string = this.keyword(node.style.values["margin-break"]);
        if (keyword === "keep") {
            return false;
        }
        return keyword === "discard" || (fragmenting.resumed && !fragmenting.forced);
    }

    private linesKept(box: ElementBox, lines: ReadonlyArray<LineFragment>, offset: number, room: number, fragmenting: Fragmentation): number {
        // CSS Fragmentation 4 §4.4 rule 3: a break between lines is allowed when at least orphans lines come before it and
        // widows lines after it; rule 4: and when no ancestor avoids a break inside it.
        const orphans: number = this.count(box.style.values["orphans"]);
        const widows: number = this.count(box.style.values["widows"]);
        const total: number = lines.length;
        for (let index: number = 0; index < total; index++) {
            const line: LineFragment = lines[index];
            const call: ElementBox | undefined = this.pushed.size > 0 && fragmenting.filled ? this.pushedCall(line) : undefined;
            if (call !== undefined) {
                return this.callBreak(lines, index, orphans, widows, this.keyword(call.style.values["footnote-policy"]) === "block", fragmenting);
            }
            let local: Candidate | undefined;
            // The line boxes of the parts of one line of text are side by side, so no break falls between them.
            if (index > 0 && line.block !== lines[index - 1].block) {
                const place: readonly [number, number] = this.spot(line.sequence.text as InlineText, line.start);
                if (this.reachesEarly(fragmenting, place)) {
                    return index;
                }
                const appeal: number = index >= orphans && total - index >= widows ? APPEAL_PERFECT : APPEAL_ORPHANS;
                local = this.record(fragmenting, fragmenting.avoid > 0 ? Math.min(appeal, APPEAL_AVOID) : appeal, place);
            }
            if (offset + line.block + line.blockSize > room + TOLERANCE && fragmenting.filled) {
                if (local !== undefined && fragmenting.best === local) {
                    return index;
                }
                if (this.restartAt(fragmenting)) {
                    return total;
                }
            }
            if (offset + line.block + line.blockSize > room + TOLERANCE && !fragmenting.filled) {
                this.contentOverflows();
            }
            fragmenting.filled = true;
        }
        return total;
    }

    private pushedCall(line: LineFragment): ElementBox | undefined {
        for (const piece of line.pieces) {
            if (piece.kind === "box" && piece.box.placement === "footnote" && this.pushed.has(piece.box)) {
                return piece.box;
            }
        }
        return undefined;
    }

    private callBreak(lines: ReadonlyArray<LineFragment>, index: number, orphans: number, widows: number, paragraph: boolean, fragmenting: Fragmentation): number {
        // GCPM 3 §2.8: line puts "a forced page break at the start of the line containing the footnote reference", where "the
        // user agent must honor widow and orphan settings" "and so may need to insert the page break on an earlier line"; block
        // puts it "before the paragraph that contains the footnote".
        const total: number = lines.length;
        let kept: number = paragraph ? 0 : index;
        while (kept > 0 && (kept < orphans || total - kept < widows || lines[kept].block === lines[kept - 1].block)) {
            kept--;
        }
        if (kept > 0) {
            return kept;
        }
        // The paragraph goes whole to the next page from the latest break point between boxes that comes before it.
        const path: Array<readonly [ElementBox, number]> = fragmenting.path.slice(0, -1).map((step: [ElementBox, number]): readonly [ElementBox, number] => [step[0], step[1]]);
        while (path.length > 0) {
            const last: readonly [ElementBox, number] = path[path.length - 1];
            if (this.previousSibling(last[0].children, last[1]) !== undefined) {
                fragmenting.early = { appeal: APPEAL_PERFECT, path };
                fragmenting.restart = true;
                return total;
            }
            path.pop();
        }
        return total;
    }

    private count(value?: CssValue): number {
        // CSS Fragmentation 4 §3.3: orphans and widows are positive integers, 2 initially.
        return value !== undefined && value.kind === "number" ? Math.max(1, value.value) : 2;
    }

    private sliced(sides: Sides, opens: boolean, closes: boolean): Sides {
        return [opens ? 0 : sides[BoxSizes.BLOCK_START], sides[BoxSizes.INLINE_END], closes ? 0 : sides[BoxSizes.BLOCK_END], sides[BoxSizes.INLINE_START]];
    }

    emptyPlace(box: ElementBox, block: number): BoxFragment {
        // GCPM 3 §1.2.1 and §2.2: running and footnote elements are out of the flow, and element() and the footnote area take
        // them from the page where they would have been, so they leave an empty fragment there.
        return { kind: "box", box, inline: 0, block, inlineSize: 0, blockSize: 0 };
    }

    placeholder(box: ElementBox): BoxFragment {
        const fragment: BoxFragment = { kind: "box", box, inline: 0, block: 0, inlineSize: 0, blockSize: 0 };
        this.pending = this.pending ?? new Set<BoxFragment>();
        this.pending.add(fragment);
        return fragment;
    }

    private positioned(container: BoxFragment, all: boolean): void {
        // CSS 2 §10.1: the containing block of an absolutely positioned box is "formed by the padding edge of the ancestor"
        // that is positioned, and the initial containing block when there is none, as for a fixed one.
        if (this.pending === undefined || this.pending.size === 0 || container.children === undefined) {
            return;
        }
        const inlineSize: number = container.inlineSize - this.side(BoxSizes.INLINE_START, container.border) - this.side(BoxSizes.INLINE_END, container.border);
        const blockSize: number = container.blockSize - this.side(BoxSizes.BLOCK_START, container.border) - this.side(BoxSizes.BLOCK_END, container.border);
        this.absolutes(container.children, [1, 0, 0, 1, this.side(BoxSizes.INLINE_START, container.padding), this.side(BoxSizes.BLOCK_START, container.padding)],
            this.sizes.frame(container.box.style), inlineSize, blockSize, all, container);
    }

    private absolutes(children: ReadonlyArray<BoxFragment | LineFragment>, transform: Transform, frame: number, inlineSize: number, blockSize: number, all: boolean,
        container: BoxFragment): void {
        // The transform takes a point of these children's container to the containing block, across the writing modes between.
        for (const child of children) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                const local: Transform = child.kind === "line" ? this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]) : transform;
                if (this.pending !== undefined && this.pending.has(piece)) {
                    if (all || piece.box.placement === "absolute") {
                        this.pending.delete(piece);
                        this.absolute(piece, local, inlineSize, blockSize, container);
                    }
                } else if (piece.children !== undefined) {
                    this.absolutes(piece.children, this.sizes.compose(local, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style), inlineSize, blockSize, all,
                        container);
                }
            }
        }
    }

    private absolute(target: BoxFragment, local: Transform, containerInline: number, containerBlock: number, container: BoxFragment): void {
        const box: ElementBox = target.box;
        // CSS Anchor Positioning 1 §5.1: the anchor functions in the computed values of this box resolve with the anchors
        // laid out before it, for the box and for the descendants that inherit those values, while it is laid out.
        const owner: number | undefined = box.style.anchorOwner;
        if (owner !== undefined) {
            this.anchoring.push([owner, box, container]);
        }
        // CSS Writing Modes 4 §7.3 and §7.4: the box is sized in its own writing mode against the containing block's size in
        // those axes, and placed with the insets and margins of the containing block's writing mode.
        const containing: number = this.sizes.frame(container.box.style);
        const frame: number = this.sizes.frame(box.style);
        const orthogonal: boolean = this.sizes.isOrthogonal(containing, frame);
        const ownInline: number = orthogonal ? containerBlock : containerInline;
        const ownBlock: number = orthogonal ? containerInline : containerBlock;
        const given: UsedSizes = this.sizes.of(box.style, ownInline, ownBlock, containerInline);
        const inset: (side: number) => number | undefined = (side: number): number | undefined => {
            const outer: number = this.sizes.side(frame, containing, side);
            return this.sizes.inset(box.style, outer, outer % 2 === 0 ? containerBlock : containerInline, containing);
        };
        const edges: number = this.inlineEdges(given);
        const blockEdges: number = this.sizes.edges(given, BoxSizes.BLOCK_START) + this.sizes.edges(given, BoxSizes.BLOCK_END);
        const start: number | undefined = inset(BoxSizes.INLINE_START);
        const end: number | undefined = inset(BoxSizes.INLINE_END);
        const before: number | undefined = inset(BoxSizes.BLOCK_START);
        const after: number | undefined = inset(BoxSizes.BLOCK_END);
        const margins: number = (this.sizes.margin(given, BoxSizes.INLINE_START) ?? 0) + (this.sizes.margin(given, BoxSizes.INLINE_END) ?? 0);
        const width: number = (containing & BoxSizes.VERTICAL) === 0 ? containerInline : containerBlock;
        const height: number = (containing & BoxSizes.VERTICAL) === 0 ? containerBlock : containerInline;
        const placed: readonly [number, number] = this.sizes.apply(local, target.inline, target.block);
        const staticInline: number = this.sizes.reframed(containing, frame, placed[0], placed[1], width, height)[0];
        // CSS Sizing 3 §4.2: a box that stretches fills its containing block, which the insets make smaller here.
        const sizes: UsedSizes = this.resolved(box, given, Math.max(0, ownInline - (start ?? 0) - (end ?? 0) - margins - edges), ownBlock - (before ?? 0) - (after ?? 0));
        // CSS 2 §10.3.7: with an auto width and both insets given the box fills what is left, and otherwise the width is
        // shrink-to-fit; an inset that is auto follows from the others, and from the static position when both are auto.
        let size: number;
        if (sizes.inlineSize !== undefined) {
            size = sizes.inlineSize;
        } else if (start !== undefined && end !== undefined) {
            size = Math.max(0, ownInline - start - end - margins - edges);
        } else {
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            const available: number = ownInline - (start ?? (end === undefined ? staticInline : 0)) - (end ?? 0) - margins - edges;
            size = Math.min(Math.max(content[0], available), content[1]);
        }
        size = this.clamped(sizes.inlineSize ?? this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, size), sizes.minInlineSize, sizes.maxInlineSize);
        // §10.6.4: the same for the block axis, where an auto height is the height of the content; CSS Sizing 4 §4.2: with
        // a preferred aspect ratio the automatic block size follows from the inline size.
        const stretched: number | undefined = sizes.blockSize === undefined && sizes.ratio === undefined && before !== undefined && after !== undefined
            ? Math.max(0, ownBlock - before - after - (this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0) - (this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0) - blockEdges)
            : undefined;
        const laid: BoxFragment = this.flow(box, stretched === undefined ? sizes : { ...sizes, blockSize: this.sizes.adjusted(sizes, BoxSizes.PREFERRED_BLOCK, stretched) },
            size, 0, true, 0, 0);
        const across: number = orthogonal ? laid.blockSize : laid.inlineSize;
        const down: number = orthogonal ? laid.inlineSize : laid.blockSize;
        const margin: (side: number) => number | undefined = (side: number): number | undefined => this.sizes.margin(given, this.sizes.side(containing, frame, side));
        const inline: number = this.offset(inset(this.sizes.side(containing, frame, BoxSizes.INLINE_START)), inset(this.sizes.side(containing, frame, BoxSizes.INLINE_END)),
            margin(BoxSizes.INLINE_START), margin(BoxSizes.INLINE_END), across, containerInline, placed[0]);
        const block: number = this.offset(inset(this.sizes.side(containing, frame, BoxSizes.BLOCK_START)), inset(this.sizes.side(containing, frame, BoxSizes.BLOCK_END)),
            margin(BoxSizes.BLOCK_START), margin(BoxSizes.BLOCK_END), down, containerBlock, placed[1]);
        const rectangle: readonly [number, number, number, number] = this.sizes.mapped(this.sizes.inverse(local), inline, block, across, down);
        Object.assign(target, laid);
        target.inline = rectangle[0];
        target.block = rectangle[1];
        target.inlineSize = rectangle[2];
        target.blockSize = rectangle[3];
        if (owner !== undefined) {
            this.anchoring.pop();
        }
    }

    private offset(start: number | undefined, end: number | undefined, marginStart: number | undefined, marginEnd: number | undefined, extent: number, containing: number,
        position: number): number {
        // CSS 2 §10.3.7 and §10.6.4: an auto inset follows from the others or from the static position, two auto margins
        // "get equal values", and an over-constrained box ignores its end inset.
        if (start !== undefined && end !== undefined && marginStart === undefined) {
            const free: number = containing - start - end - extent;
            return start + Math.max(0, marginEnd === undefined ? free / 2 : free - marginEnd);
        }
        if (start !== undefined) {
            return start + (marginStart ?? 0);
        }
        if (end !== undefined) {
            return containing - end - extent - (marginEnd ?? 0);
        }
        return position + (marginStart ?? 0);
    }

    private anchorLength(anchor: CalcAnchor, block: boolean): number | undefined {
        // An anchor function belongs to the box whose computed value made it, which is being laid out when it is met.
        for (let index: number = this.anchoring.length - 1; index >= 0; index--) {
            const entry: readonly [number, ElementBox, BoxFragment] = this.anchoring[index];
            if (entry[0] === anchor.owner) {
                return this.anchorSize(entry[2], entry[1], anchor, block);
            }
        }
        return undefined;
    }

    private anchorSize(container: BoxFragment, box: ElementBox, anchor: CalcAnchor, block: boolean): number | undefined {
        // CSS Anchor Positioning 1 §5.1: the function takes an anchor name and a size keyword, both optional, and gives "the
        // <length> separating the relevant edges" "of the target anchor element's anchor box."
        const name: string | undefined = anchor.anchor;
        const keyword: string = anchor.keyword ?? "";
        if (this.anchorNames === undefined) {
            this.anchorNames = new Map<string, Array<ReadonlyArray<ElementBox>>>();
            if (this.rootBox !== undefined) {
                this.indexAnchors(this.rootBox, []);
            }
        }
        const path: ReadonlyArray<ElementBox> = (this.rootBox === undefined ? undefined : this.pathTo(this.rootBox, box, [])) ?? [];
        const wanted: Set<ElementBox> = new Set<ElementBox>(path);
        for (const anchors of this.anchorNames.values()) {
            for (const anchor of anchors) {
                wanted.add(anchor[anchor.length - 1]);
            }
        }
        // §2.3: an anchor is acceptable when it "is laid out strictly before" the positioned box, which here is to have
        // a fragment inside the containing block when the positioned box is laid out.
        const bounds: Map<ElementBox, [number, number, number, number]> = new Map<ElementBox, [number, number, number, number]>();
        if (container.children !== undefined) {
            this.anchorBounds(container.children, BoxSizes.IDENTITY, this.sizes.frame(container.box.style), wanted, bounds);
        }
        const target: ElementBox | undefined = name === undefined ? this.defaultAnchor(path, bounds) : this.namedAnchor(path, box, name, bounds);
        const extent: [number, number, number, number] | undefined = target === undefined ? undefined : bounds.get(target);
        if (extent === undefined) {
            return undefined;
        }
        // §5.1: block and inline follow "the writing mode of the box's containing block", self-block and self-inline that
        // of the box, and a missing keyword is "whatever keyword matches the axis of the property".
        const flowing: boolean = this.isHorizontal(container.box);
        const own: boolean = this.isHorizontal(box);
        let alongBlock: boolean = own === flowing ? block : !block;
        if (keyword === "width" || keyword === "height") {
            alongBlock = (keyword === "height") === flowing;
        } else if (keyword === "inline" || keyword === "block") {
            alongBlock = keyword === "block";
        } else if (keyword === "self-inline" || keyword === "self-block") {
            alongBlock = (keyword === "self-block") === (own === flowing);
        }
        return alongBlock ? extent[3] - extent[1] : extent[2] - extent[0];
    }

    private indexAnchors(box: ElementBox, path: Array<ElementBox>): void {
        // §2.1: anchor-name makes the element an anchor element "with a list of anchor names as specified"; each anchor is
        // kept with its ancestors, in tree order.
        path.push(box);
        const names: CssValue | undefined = box.style.values["anchor-name"];
        if (names !== undefined && this.anchorNames !== undefined) {
            for (const item of names.kind === "list" ? names.items : [names]) {
                if (item.kind === "ident" && item.name.startsWith("--")) {
                    const anchors: Array<ReadonlyArray<ElementBox>> = this.anchorNames.get(item.name) ?? [];
                    anchors.push([...path]);
                    this.anchorNames.set(item.name, anchors);
                }
            }
        }
        for (const child of box.children) {
            if (child.kind === "box") {
                this.indexAnchors(child, path);
            }
        }
        path.pop();
    }

    private pathTo(current: ElementBox, target: ElementBox, path: Array<ElementBox>): Array<ElementBox> | undefined {
        path.push(current);
        if (current === target) {
            return path;
        }
        for (const child of current.children) {
            if (child.kind === "box" && this.pathTo(child, target, path) !== undefined) {
                return path;
            }
        }
        path.pop();
        return undefined;
    }

    private anchorBounds(children: ReadonlyArray<BoxFragment | LineFragment>, transform: Transform, frame: number, wanted: ReadonlySet<ElementBox>,
        bounds: Map<ElementBox, [number, number, number, number]>): void {
        // A box in several fragments has the rectangle that holds them all, in the containing block's writing mode; a box
        // that waits to be positioned has none.
        for (const child of children) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box" || (this.pending !== undefined && this.pending.has(piece))) {
                    continue;
                }
                const local: Transform = child.kind === "line" ? this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]) : transform;
                if (wanted.has(piece.box)) {
                    const area: readonly [number, number, number, number] = this.sizes.mapped(local, piece.inline, piece.block, piece.inlineSize, piece.blockSize);
                    const known: [number, number, number, number] | undefined = bounds.get(piece.box);
                    bounds.set(piece.box, known === undefined ? [area[0], area[1], area[0] + area[2], area[1] + area[3]]
                        : [Math.min(known[0], area[0]), Math.min(known[1], area[1]), Math.max(known[2], area[0] + area[2]), Math.max(known[3], area[1] + area[3])]);
                }
                if (piece.children !== undefined) {
                    this.anchorBounds(piece.children, this.sizes.compose(local, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style), wanted, bounds);
                }
            }
        }
    }

    private namedAnchor(path: ReadonlyArray<ElementBox>, box: ElementBox, name: string, bounds: ReadonlyMap<ElementBox, [number, number, number, number]>): ElementBox | undefined {
        // CSS Anchor Positioning 1 §2.3: "If an ancestor of query el satisfies the following conditions, return the nearest
        // such element to query el. Otherwise, return the last element el in tree order that satisfies the conditions."
        const anchors: ReadonlyArray<ReadonlyArray<ElementBox>> | undefined = this.anchorNames?.get(name);
        const limit: ElementBox | undefined = this.anchorScope(path, name, path.length - 2);
        let found: ElementBox | undefined;
        let depth: number = -1;
        for (const anchor of anchors ?? []) {
            const candidate: ElementBox = anchor[anchor.length - 1];
            // §2.2: anchor-scope keeps a name "in scope only for this element's descendants", and limits the descendants
            // "to only match these anchor names to anchor elements within this subtree."
            const scope: ElementBox | undefined = this.anchorScope(anchor, name, anchor.length - 1);
            const visible: boolean = scope === undefined || (scope !== box && path.includes(scope));
            if (candidate === box || !bounds.has(candidate) || !visible || (limit !== undefined && !anchor.includes(limit))) {
                continue;
            }
            const level: number = path.indexOf(candidate);
            if (level > depth) {
                depth = level;
                found = candidate;
            } else if (depth < 0) {
                found = candidate;
            }
        }
        return found;
    }

    private anchorScope(path: ReadonlyArray<ElementBox>, name: string, last: number): ElementBox | undefined {
        for (let index: number = last; index >= 0; index--) {
            const scope: CssValue | undefined = path[index].style.values["anchor-scope"];
            if (scope === undefined) {
                continue;
            }
            for (const item of scope.kind === "list" ? scope.items : [scope]) {
                if (item.kind === "ident" && (item.lower === "all" || item.name === name)) {
                    return path[index];
                }
            }
        }
        return undefined;
    }

    private defaultAnchor(path: ReadonlyArray<ElementBox>, bounds: ReadonlyMap<ElementBox, [number, number, number, number]>): ElementBox | undefined {
        // CSS Anchor Positioning 1 §2.4: position-anchor gives the default anchor element; normal "behaves as none" when
        // position-area is none and as auto otherwise, and auto uses the implicit anchor element.
        const box: ElementBox | undefined = path[path.length - 1];
        const value: CssValue | undefined = box === undefined ? undefined : box.style.values["position-anchor"];
        if (box === undefined) {
            return undefined;
        }
        if (value !== undefined && value.kind === "ident" && value.name.startsWith("--")) {
            return this.namedAnchor(path, box, value.name, bounds);
        }
        let keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "normal";
        if (keyword === "normal") {
            keyword = this.keyword(box.style.values["position-area"]) === "none" ? "none" : "auto";
        }
        let anchor: ElementBox | undefined;
        if (keyword === "auto" && box.pseudoElement !== undefined) {
            // §2.4.1: "The implicit anchor element of a pseudo-element is its originating element".
            anchor = path[path.length - 2];
        } else if (keyword === "match-parent" && path.length > 1) {
            anchor = this.defaultAnchor(path.slice(0, -1), bounds);
        }
        return anchor !== undefined && bounds.has(anchor) ? anchor : undefined;
    }

    private isHorizontal(box: ElementBox): boolean {
        const mode: CssValue | undefined = box.style.values["writing-mode"];
        return mode === undefined || (mode.kind === "ident" && mode.lower === "horizontal-tb");
    }

    private resolved(box: ElementBox, sizes: UsedSizes, inlineStretch?: number, blockBasis?: number, through: number = 0): UsedSizes {
        if (sizes.keywords === undefined && sizes.ratio === undefined && sizes.calculations === undefined && !box.replaced) {
            return sizes;
        }
        const used: UsedSizes = { ...sizes };
        if (sizes.calculations !== undefined) {
            used.calculations = [...sizes.calculations];
        }
        if (box.replaced) {
            // CSS Sizing 4 §4.1: with auto, "Replaced elements with a natural aspect ratio use that aspect ratio", and
            // "Size calculations involving the aspect ratio work with the content box dimensions always."
            const natural: NaturalSizes = this.naturalSizes(box, sizes.inlineSize ?? inlineStretch);
            used.natural = natural;
            if (natural[2] !== undefined && (used.ratio === undefined || used.ratioAuto === true)) {
                used.ratio = natural[2];
                delete used.ratioBoxed;
            }
        }
        const keywords: ReadonlyArray<string> | undefined = sizes.keywords;
        if (keywords !== undefined) {
            // CSS Sizing 3 §4.2: stretch sizes "the margin box to fill the containing block exactly, treating auto margins
            // as zero", and behaves as auto, 0 or none where the containing block has no definite size.
            const before: number = (through & 1) !== 0 ? 0 : this.sizes.margin(used, BoxSizes.BLOCK_START) ?? 0;
            const after: number = (through & 2) !== 0 ? 0 : this.sizes.margin(used, BoxSizes.BLOCK_END) ?? 0;
            const blockStretch: number | undefined = blockBasis === undefined ? undefined
                : Math.max(0, blockBasis - before - after - this.sizes.edges(used, BoxSizes.BLOCK_START) - this.sizes.edges(used, BoxSizes.BLOCK_END));
            let content: NaturalSizes | undefined;
            for (const slot of KEYWORD_ORDER) {
                const keyword: string = keywords[slot];
                const block: boolean = slot === BoxSizes.PREFERRED_BLOCK || slot >= BoxSizes.MINIMUM_BLOCK;
                let size: number | undefined;
                if (keyword === "stretch" || (keyword === "contain" && used.ratio === undefined)) {
                    size = block ? blockStretch : inlineStretch;
                } else if (keyword === "contain") {
                    size = this.contained(used, block, inlineStretch, blockStretch);
                } else if (CONTENT_SIZES.has(keyword) && !(box.replaced && slot <= BoxSizes.PREFERRED_BLOCK)) {
                    // §3.2: a content-based size of a replaced box is its automatic size, and so is one in the block axis.
                    content = content ?? this.ownSizes(box, used, inlineStretch);
                    size = block ? content[2] : this.fitted(keyword, content[0] as number, content[1] as number, inlineStretch, sizes.fits?.[slot]);
                }
                if (size !== undefined) {
                    used[BoxSizes.FIELDS[slot]] = this.settled(used, slot, size);
                }
            }
        }
        // CSS Values 5 §10.2: a calc-size() is treated "as if it were its calc-size basis", and an automatic minimum is zero
        // where no layout mode gives it another size.
        const pending: ReadonlyArray<CalcNode | undefined> | undefined = used.calculations;
        if (pending !== undefined && pending[BoxSizes.MINIMUM_INLINE] !== undefined && used.minInlineSize === undefined) {
            used.minInlineSize = this.sizes.adjusted(used, BoxSizes.MINIMUM_INLINE, 0);
        }
        if (pending !== undefined && pending[BoxSizes.MINIMUM_BLOCK] !== undefined && used.minBlockSize === undefined) {
            used.minBlockSize = this.sizes.adjusted(used, BoxSizes.MINIMUM_BLOCK, 0);
        }
        if (used.ratio !== undefined) {
            this.transfer(used);
        }
        if (used.ratio !== undefined && !box.replaced) {
            const visible: boolean = this.hasVisibleOverflow(box);
            const dependent: string = keywords === undefined ? "" : keywords[BoxSizes.PREFERRED_INLINE];
            if (used.inlineSize === undefined && used.blockSize !== undefined && !CONTENT_SIZES.has(dependent)) {
                // CSS Sizing 4 §4.2 and §4.3: the automatic inline size follows from a definite block size, and its automatic
                // minimum "is its min-content size capped by its maximum size", unless the box is a scroll container.
                used.inlineSize = this.settled(used, BoxSizes.PREFERRED_INLINE, this.sizes.transferred(used, used.blockSize, true));
                if (visible && sizes.minInlineSize === undefined && (keywords === undefined || keywords[BoxSizes.MINIMUM_INLINE] === "")) {
                    const least: number = Math.min(this.contentSizes(box, used.blockSize)[0], used.maxInlineSize ?? Number.POSITIVE_INFINITY);
                    used.minInlineSize = pending !== undefined && pending[BoxSizes.MINIMUM_INLINE] !== undefined
                        ? this.sizes.adjusted(used, BoxSizes.MINIMUM_INLINE, least) : Math.max(used.minInlineSize ?? 0, least);
                }
            }
            if (visible && sizes.minBlockSize === undefined && (keywords === undefined || keywords[BoxSizes.MINIMUM_BLOCK] === "")) {
                used.keywords = keywords === undefined ? ["", "", "", "", "", ""] : [...keywords];
                used.keywords[BoxSizes.MINIMUM_BLOCK] = AUTOMATIC_MINIMUM;
            }
        }
        if (box.replaced) {
            const final: readonly [number, number] = this.replacedSizes(used, inlineStretch);
            used.inlineSize = this.settled(used, BoxSizes.PREFERRED_INLINE, final[0]);
            used.blockSize = this.settled(used, BoxSizes.PREFERRED_BLOCK, final[1]);
        }
        return used;
    }

    private settled(sizes: UsedSizes, slot: number, size: number): number {
        // The calculation of a calc-size() is applied once, to the size that its basis stands for.
        const result: number = this.sizes.adjusted(sizes, slot, size);
        if (sizes.calculations !== undefined) {
            sizes.calculations[slot] = undefined;
        }
        return result;
    }

    private fitted(keyword: string, least: number, most: number, stretch?: number, limit?: number): number | undefined {
        // CSS Sizing 3 §3.2: fit-content is "min(max-content, max(min-content, stretch))", and CSS Sizing 4 §3.2 puts the
        // argument of fit-content() in the place of the stretch size.
        if (keyword === "min-content" || keyword === "max-content") {
            return keyword === "min-content" ? least : most;
        }
        const middle: number | undefined = keyword === BoxSizes.FIT_FUNCTION ? limit : stretch;
        return middle === undefined ? undefined : Math.min(Math.max(least, middle), most);
    }

    private ownSizes(box: ElementBox, sizes: UsedSizes, stretch?: number): NaturalSizes {
        // The min-content and max-content inline sizes of the box and, for a replaced box, its automatic block size.
        if (!box.replaced) {
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            return [content[0], content[1], undefined];
        }
        const bare: UsedSizes = { ...sizes };
        for (const field of BoxSizes.FIELDS) {
            delete bare[field];
        }
        const own: readonly [number, number] = this.replacedSizes(bare, stretch);
        return [this.replacedSizes(bare, 0)[0], own[0], own[1]];
    }

    private contained(sizes: UsedSizes, block: boolean, inlineStretch?: number, blockStretch?: number): number | undefined {
        // CSS Sizing 4 §6.1: the target rectangle is the containing block, "with any indefinite size assumed as infinity",
        // clamped by the maximum sizes and then "reduced in one dimension" to the preferred aspect ratio.
        let across: number = inlineStretch ?? Number.POSITIVE_INFINITY;
        let down: number = blockStretch ?? Number.POSITIVE_INFINITY;
        if (across === Number.POSITIVE_INFINITY && down === Number.POSITIVE_INFINITY) {
            return undefined;
        }
        if (sizes.maxInlineSize !== undefined) {
            across = Math.min(across, Math.max(sizes.maxInlineSize, sizes.minInlineSize ?? 0));
        }
        if (sizes.maxBlockSize !== undefined) {
            down = Math.min(down, Math.max(sizes.maxBlockSize, sizes.minBlockSize ?? 0));
        }
        const wide: number = down === Number.POSITIVE_INFINITY ? down : this.sizes.transferred(sizes, down, true);
        if (wide > across) {
            down = this.sizes.transferred(sizes, across, false);
        } else {
            across = wide;
        }
        return block ? down : across;
    }

    private transfer(sizes: UsedSizes): void {
        // CSS Sizing 4 §4.4: a definite minimum is transferred to the other axis and "capped by any definite preferred or
        // maximum size" there; a definite maximum is "floored by any definite preferred or minimum size" and that minimum.
        const preferred: readonly [number | undefined, number | undefined] = [sizes.inlineSize, sizes.blockSize];
        const minimums: readonly [number | undefined, number | undefined] = [sizes.minInlineSize, sizes.minBlockSize];
        const maximums: readonly [number | undefined, number | undefined] = [sizes.maxInlineSize, sizes.maxBlockSize];
        for (let axis: number = 0; axis < 2; axis++) {
            const least: number | undefined = minimums[1 - axis];
            const most: number | undefined = maximums[1 - axis];
            let low: number | undefined;
            if (least !== undefined) {
                low = Math.min(this.sizes.transferred(sizes, least, axis === 0), preferred[axis] ?? Number.POSITIVE_INFINITY, maximums[axis] ?? Number.POSITIVE_INFINITY);
            }
            if (low !== undefined && minimums[axis] === undefined) {
                sizes[axis === 0 ? "minInlineSize" : "minBlockSize"] = low;
            }
            if (most !== undefined && maximums[axis] === undefined) {
                sizes[axis === 0 ? "maxInlineSize" : "maxBlockSize"] = Math.max(this.sizes.transferred(sizes, most, axis === 0), preferred[axis] ?? 0, minimums[axis] ?? 0, low ?? 0);
            }
        }
    }

    private replacedSizes(sizes: UsedSizes, available?: number): readonly [number, number] {
        // The sizes are counted on the box that the preferred aspect ratio works with, and given back for the content box.
        const natural: NaturalSizes = sizes.natural ?? NO_NATURAL_SIZES;
        const ratio: number | undefined = sizes.ratio;
        const inlineExtra: number = sizes.ratioBoxed === true ? this.inlineEdges(sizes) : 0;
        const blockExtra: number = sizes.ratioBoxed === true ? this.sizes.edges(sizes, BoxSizes.BLOCK_START) + this.sizes.edges(sizes, BoxSizes.BLOCK_END) : 0;
        const minimum: readonly [number, number] = [(sizes.minInlineSize ?? 0) + inlineExtra, (sizes.minBlockSize ?? 0) + blockExtra];
        const maximum: readonly [number, number] = [
            Math.max(minimum[0], sizes.maxInlineSize === undefined ? Number.POSITIVE_INFINITY : sizes.maxInlineSize + inlineExtra),
            Math.max(minimum[1], sizes.maxBlockSize === undefined ? Number.POSITIVE_INFINITY : sizes.maxBlockSize + blockExtra)
        ];
        // CSS Sizing 4 §4.2: the automatic sizes are those of "a replaced element with a natural aspect ratio and no natural
        // size in that axis", so a ratio that is not the natural one leaves the natural block size out.
        const across: number | undefined = natural[0] === undefined ? undefined : natural[0] + inlineExtra;
        const down: number | undefined = natural[1] === undefined || (across !== undefined && ratio !== natural[2]) ? undefined : natural[1] + blockExtra;
        let pair: readonly [number, number];
        if (sizes.inlineSize !== undefined) {
            // CSS 2 §10.3.2 and §10.6.2: a size that is given is used, and an auto one follows from it by the ratio.
            const inline: number = this.clamped(sizes.inlineSize + inlineExtra, minimum[0], maximum[0]);
            const block: number = sizes.blockSize !== undefined ? sizes.blockSize + blockExtra : (ratio !== undefined ? inline / ratio : down ?? DEFAULT_BLOCK_SIZE + blockExtra);
            pair = [inline, this.clamped(block, minimum[1], maximum[1])];
        } else if (sizes.blockSize !== undefined) {
            const block: number = this.clamped(sizes.blockSize + blockExtra, minimum[1], maximum[1]);
            pair = [this.clamped(ratio !== undefined ? block * ratio : across ?? DEFAULT_INLINE_SIZE + inlineExtra, minimum[0], maximum[0]), block];
        } else {
            pair = this.automaticSizes(sizes, minimum, maximum, across, down, inlineExtra, blockExtra, available);
        }
        return [Math.max(0, pair[0] - inlineExtra), Math.max(0, pair[1] - blockExtra)];
    }

    private automaticSizes(sizes: UsedSizes, minimum: readonly [number, number], maximum: readonly [number, number], across: number | undefined, down: number | undefined,
        inlineExtra: number, blockExtra: number, available?: number): readonly [number, number] {
        const ratio: number | undefined = sizes.ratio;
        const lowInline: number = sizes.minInlineSize ?? 0;
        const lowBlock: number = sizes.minBlockSize ?? 0;
        let width: number;
        if (across !== undefined) {
            width = across;
        } else if (down !== undefined && ratio !== undefined) {
            width = down * ratio;
        } else if (ratio !== undefined && available !== undefined) {
            // CSS Sizing 3 §5.1: without natural sizes and with a ratio, "If the available space is definite in the inline
            // axis, use the stretch fit into that size for the inline size".
            width = Math.max(0, available) + inlineExtra;
        } else if (ratio !== undefined && (lowInline > 0 || lowBlock > 0)) {
            // "if the box has a <length> as its computed value for min-width or min-height, use that size", and with both
            // "choose the one that results in the larger overall size."
            width = Math.max(lowInline > 0 ? lowInline + inlineExtra : 0, lowBlock > 0 ? (lowBlock + blockExtra) * ratio : 0);
        } else if (ratio !== undefined) {
            // "Otherwise use an inline size matching the corresponding dimension of the initial containing block".
            width = this.initialInline;
        } else if (lowInline > 0) {
            width = lowInline + inlineExtra;
        } else {
            // CSS 2 §10.3.2: 300px, or the widest rectangle with a 2:1 ratio that fits.
            width = (available !== undefined && available > 0 ? Math.min(DEFAULT_INLINE_SIZE, available) : DEFAULT_INLINE_SIZE) + inlineExtra;
        }
        let height: number;
        if (down !== undefined) {
            height = down;
        } else if (ratio !== undefined) {
            height = width / ratio;
        } else if (lowBlock > 0) {
            height = lowBlock + blockExtra;
        } else {
            // CSS Sizing 3 §5.1: without a ratio the block size is 150px, which stays half of a default width that was reduced.
            height = (across !== undefined || lowInline > 0 ? DEFAULT_BLOCK_SIZE : (width - inlineExtra) * DEFAULT_BLOCK_SIZE / DEFAULT_INLINE_SIZE) + blockExtra;
        }
        if (ratio === undefined || width <= 0 || height <= 0) {
            return [this.clamped(width, minimum[0], maximum[0]), this.clamped(height, minimum[1], maximum[1])];
        }
        // CSS 2 §10.4: the table of constraint violations, which keeps the ratio where the minimum and maximum sizes allow it.
        const wide: boolean = width > maximum[0];
        const narrow: boolean = width < minimum[0];
        const tall: boolean = height > maximum[1];
        const short: boolean = height < minimum[1];
        if ((wide && short) || (narrow && tall)) {
            return [wide ? maximum[0] : minimum[0], tall ? maximum[1] : minimum[1]];
        }
        if (wide && (!tall || maximum[0] / width <= maximum[1] / height)) {
            return [maximum[0], Math.max(minimum[1], maximum[0] * height / width)];
        }
        if (tall) {
            return [Math.max(minimum[0], maximum[1] * width / height), maximum[1]];
        }
        if (narrow && (!short || minimum[0] / width > minimum[1] / height)) {
            return [minimum[0], Math.min(maximum[1], minimum[0] * height / width)];
        }
        return short ? [Math.min(maximum[0], minimum[1] * width / height), minimum[1]] : [width, height];
    }

    private objectArea(box: ElementBox, natural: NaturalSizes, inlineSize: number, blockSize: number): ObjectArea | undefined {
        // CSS Images 4 §5.1: object-fit gives the concrete object size of the content inside the content box, and
        // "scale-down" alone is "Equivalent to contain scale-down."
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const fit: CssValue | undefined = values["object-fit"];
        let mode: string = "fill";
        let scales: boolean = false;
        if (fit !== undefined) {
            for (const item of fit.kind === "list" ? fit.items : [fit]) {
                scales = scales || (item.kind === "ident" && item.lower === "scale-down");
                mode = item.kind === "ident" && item.lower !== "scale-down" ? item.lower : mode;
            }
        }
        mode = scales && mode === "fill" ? "contain" : mode;
        const ratio: number | undefined = natural[2];
        let size: readonly [number, number] = mode === "contain" || mode === "cover" ? this.constrained(ratio, inlineSize, blockSize, mode === "cover") : [inlineSize, blockSize];
        if (mode === "none" || scales) {
            // CSS Images 3 §4.3.1: the default sizing algorithm with no specified size, "and a default object size equal to
            // the replaced element's used width and height".
            let plain: readonly [number, number];
            if (natural[0] !== undefined) {
                plain = [natural[0], natural[1] ?? (ratio !== undefined ? natural[0] / ratio : blockSize)];
            } else if (natural[1] !== undefined) {
                plain = [ratio !== undefined ? natural[1] * ratio : inlineSize, natural[1]];
            } else {
                plain = this.constrained(ratio, inlineSize, blockSize, false);
            }
            if (mode === "none" || plain[0] < size[0] || (plain[0] === size[0] && plain[1] < size[1])) {
                size = plain;
            }
        }
        const place: readonly [number, number] = this.objectPosition(values, inlineSize - size[0], blockSize - size[1]);
        return place[0] === 0 && place[1] === 0 && size[0] === inlineSize && size[1] === blockSize ? undefined : [place[0], place[1], size[0], size[1]];
    }

    private constrained(ratio: number | undefined, inlineSize: number, blockSize: number, cover: boolean): readonly [number, number] {
        // CSS Images 3 §4.3.2: the largest rectangle with the natural aspect ratio that fits in the constraint rectangle, or
        // the smallest that covers it; without a ratio "the concrete object size is the specified constraint rectangle."
        if (ratio === undefined) {
            return [inlineSize, blockSize];
        }
        return (inlineSize > blockSize * ratio) === cover ? [inlineSize, inlineSize / ratio] : [blockSize * ratio, blockSize];
    }

    private objectPosition(values: Readonly<Record<string, CssValue>>, freeInline: number, freeBlock: number): readonly [number, number] {
        // CSS Values 5 §4.2: a <position> is a pair of offsets between edges, "defaulting to the left and top"; here each
        // offset is counted from the start edge of its flow-relative axis, the inline one first.
        const position: CssValue | undefined = values["object-position"];
        const mode: string = this.keyword(values["writing-mode"]);
        const rightToLeft: boolean = this.keyword(values["direction"]) === "rtl";
        const across: number = mode === "none" || mode === "horizontal-tb" ? 0 : 1;
        const reversed: readonly [boolean, boolean] = [(mode === "sideways-lr") !== rightToLeft, mode === "vertical-rl" || mode === "sideways-rl"];
        const free: readonly [number, number] = [freeInline, freeBlock];
        // "A <percentage> for the horizontal offset is relative to (width of alignment container - width of alignment
        // subject)", and the initial value is 50% 50%.
        const offsets: [number, number] = [freeInline / 2, freeBlock / 2];
        const items: ReadonlyArray<CssValue> = position === undefined ? [] : (position.kind === "list" ? position.items : [position]);
        let component: number = 0;
        for (let index: number = 0; index < items.length; index++, component++) {
            const item: CssValue = items[index];
            let axis: number = component === 0 ? across : 1 - across;
            let far: boolean = reversed[axis];
            let offset: CssValue | undefined = item;
            if (item.kind === "ident") {
                const name: string = item.lower;
                if (name === "center") {
                    continue;
                }
                if (HORIZONTAL_SIDES.has(name) || VERTICAL_SIDES.has(name)) {
                    axis = HORIZONTAL_SIDES.has(name) ? across : 1 - across;
                } else if (INLINE_SIDES.has(name) || BLOCK_SIDES.has(name)) {
                    axis = INLINE_SIDES.has(name) ? 0 : 1;
                } else {
                    // "If both keywords are one of start or end, the first one represents the block axis and the second
                    // the inline axis."
                    axis = component === 0 ? 1 : 0;
                }
                far = FAR_SIDES.has(name) !== (PHYSICAL_SIDES.has(name) && reversed[axis]);
                // "If four values are given", "each <length-percentage> represents an offset between the edges specified
                // by the preceding keyword."
                offset = items.length === 4 ? items[++index] : undefined;
            }
            const distance: number = offset === undefined ? 0 : this.sizes.pixels(offset, free[axis]);
            offsets[axis] = far ? free[axis] - distance : distance;
        }
        return offsets;
    }

    private naturalSizes(box: ElementBox, available?: number): NaturalSizes {
        // CSS Containment 2 §3.1: with size containment "Replaced elements must be treated as having an natural width and
        // height of 0 and no natural aspect ratio", or the explicit intrinsic inner size; inline-size containment in its axis.
        const containment: number = this.containment(box);
        const inlineEmpty: number | undefined = (containment & SIZED_AS_EMPTY) !== 0 ? this.explicitSize(box, false) ?? 0 : undefined;
        if ((containment & DisplayTypes.SIZE_CONTAINMENT) !== 0) {
            return [inlineEmpty, this.explicitSize(box, true) ?? 0, undefined];
        }
        if (inlineEmpty !== undefined) {
            const own: NaturalSizes = this.imageSizes(box, available);
            return [inlineEmpty, own[1], undefined];
        }
        return this.imageSizes(box, available);
    }

    private imageOf(box: ElementBox, available?: number): ImageSize | undefined {
        // The available inline size reaches an image whose size depends on it, such as a formula broken into lines.
        const content: BoxNode | undefined = box.children.find((node: BoxNode) => node.kind === "deferred");
        return content !== undefined && content.kind === "deferred" && content.value.kind === "url" ? this.images.size(content.value.href, available) : undefined;
    }

    private imageBaseline(box: ElementBox, area: ObjectArea): number | undefined {
        // An image that has a baseline, such as a formula, is aligned by it in a line rather than by its bottom edge; the
        // baseline moves with the image in its content box, and scales with it when the image has a ratio to keep.
        const image: ImageSize | undefined = this.imageOf(box);
        if (image?.baseline === undefined || image.height === undefined || image.height <= 0) {
            return undefined;
        }
        return area[1] + (image.ratio === undefined ? image.baseline : image.baseline * area[3] / image.height);
    }

    private imageSizes(box: ElementBox, available?: number): NaturalSizes {
        const content: BoxNode | undefined = box.children.find((node: BoxNode) => node.kind === "deferred");
        if (content === undefined || content.kind !== "deferred" || content.value.kind !== "url") {
            return NO_NATURAL_SIZES;
        }
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const natural: readonly [number | undefined, number | undefined, number | undefined] | undefined = this.images.natural(content.value.href, values,
            box.style.zoom ?? 1, false, available);
        if (natural === undefined) {
            return NO_NATURAL_SIZES;
        }
        const [width, height, ratio] = natural;
        // CSS Writing Modes 4 §6.1: the width is the inline size in a horizontal writing mode only.
        const mode: CssValue | undefined = values["writing-mode"];
        if (mode === undefined || (mode.kind === "ident" && mode.lower === "horizontal-tb")) {
            return [width, height, ratio];
        }
        return [height, width, ratio === undefined ? undefined : 1 / ratio];
    }

    private groupAlign(children: ReadonlyArray<BoxFragment | LineFragment>, inlineSize: number, align: string, reversed: boolean, frame: number): void {
        const lines: Array<LineFragment> = [];
        const sizes: Array<number> = [];
        const flips: Array<boolean> = [];
        this.groupLines(children, inlineSize, lines, sizes, flips, frame, false);
        let least: number = Number.POSITIVE_INFINITY;
        for (const [index, line] of lines.entries()) {
            const gaps: readonly [number, number] = this.lineGaps(line, sizes[index], flips[index]);
            least = Math.min(least, gaps[0] + gaps[1]);
        }
        if (lines.length === 0 || least <= 0) {
            return;
        }
        const side: string = align === "left" ? (reversed ? "end" : "start") : (align === "right" ? (reversed ? "start" : "end") : align);
        const padding: number = side === "start" ? 0 : (side === "end" ? least : least / 2);
        for (const [index, line] of lines.entries()) {
            const gaps: readonly [number, number] = this.lineGaps(line, sizes[index], flips[index]);
            const shift: number = padding - least * gaps[0] / (gaps[0] + gaps[1]);
            for (const piece of line.pieces) {
                piece.inline += flips[index] ? -shift : shift;
            }
        }
    }

    private groupLines(children: ReadonlyArray<BoxFragment | LineFragment>, inlineSize: number, lines: Array<LineFragment>, sizes: Array<number>, flips: Array<boolean>,
        frame: number, flipped: boolean): void {
        // CSS Text 4 §7.6: "the contents of descendants that establish independent formatting contexts are skipped"; the lines
        // of a descendant whose direction is not the aligning box's run the other way.
        for (const child of children) {
            if (child.kind === "line") {
                lines.push(child);
                sizes.push(inlineSize);
                flips.push(flipped);
            } else if (child.children !== undefined && child.box.placement === "in-flow" && !this.isIndependent(child.box)) {
                const edges: number = this.side(BoxSizes.INLINE_START, child.border) + this.side(BoxSizes.INLINE_START, child.padding)
                    + this.side(BoxSizes.INLINE_END, child.padding) + this.side(BoxSizes.INLINE_END, child.border);
                const own: number = this.sizes.frame(child.box.style);
                this.groupLines(child.children, child.inlineSize - edges, lines, sizes, flips, own, flipped !== (((own ^ frame) & BoxSizes.INLINE_REVERSED) !== 0));
            }
        }
    }

    private lineGaps(line: LineFragment, inlineSize: number, flipped: boolean): readonly [number, number] {
        let start: number = inlineSize;
        let end: number = 0;
        for (const piece of line.pieces) {
            start = Math.min(start, piece.inline);
            end = Math.max(end, piece.inline + piece.inlineSize);
        }
        const gaps: readonly [number, number] = line.pieces.length === 0 ? [0, inlineSize] : [Math.max(0, start), Math.max(0, inlineSize - end)];
        return flipped ? [gaps[1], gaps[0]] : gaps;
    }

    private side(side: number, sides?: Sides): number {
        return sides === undefined ? 0 : sides[side];
    }

    private trimLast(fragment: BoxFragment | LineFragment, edges: TextEdges): number {
        // CSS Inline 3 §6.2: the last formatted line is trimmed, with no effect "if there is intervening non-zero padding
        // or borders"; a line that an inner block has trimmed keeps the metric of that block.
        if (fragment.kind === "line") {
            if (this.trimmed.has(fragment)) {
                return 0;
            }
            this.trimmed.add(fragment);
            return this.inline.trimLine([fragment], true, edges);
        }
        const display: DisplayType = fragment.box.display;
        const last: BoxFragment | LineFragment | undefined = fragment.children === undefined ? undefined : fragment.children[fragment.children.length - 1];
        const size: CssValue | undefined = fragment.box.style.values["block-size"];
        if (last === undefined || fragment.box.replaced || display.internal !== undefined || (display.inner !== "flow" && display.inner !== "flow-root")
            || this.side(BoxSizes.BLOCK_END, fragment.border) + this.side(BoxSizes.BLOCK_END, fragment.padding) !== 0 || (size !== undefined && size.kind !== "ident")
            || (last.kind === "box" && (last.collapsesThrough === true || last.box.placement !== "in-flow"
                || ((this.sizes.frame(last.box.style) ^ this.sizes.frame(fragment.box.style)) & BLOCK_ORIENTATION) !== 0))) {
            return 0;
        }
        const amount: number = this.trimLast(last, edges);
        fragment.blockSize -= amount;
        return amount;
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }

    private isBlockLevel(node: BoxNode): node is ElementBox {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "block";
    }

    private isIndependent(box: ElementBox): boolean {
        // CSS Display 3 §2.2, CSS Overflow 3 §3, CSS Containment 2 §3.2 and §3.4 and CSS Conditional 5 §5.1: flow-root, the other
        // inner display types, a replaced box, overflow other than visible or clip, layout or paint containment and size queries.
        return box.replaced || box.display.inner !== "flow" || box.display.internal !== undefined || !this.hasVisibleOverflow(box)
            || (this.containment(box) & OWN_CONTEXT) !== 0;
    }

    private containment(box: ElementBox): number {
        return this.displays.containment(box.style.values, box.display, box.replaced);
    }

    private explicitSize(box: ElementBox, block: boolean): number | undefined {
        // CSS Sizing 4 §5.2: auto? [ none | <length> ], where auto uses a last remembered size only for an element that is
        // skipping its contents, which a printed element never is.
        const value: CssValue | undefined = box.style.values[block ? "contain-intrinsic-block-size" : "contain-intrinsic-inline-size"];
        for (const item of value === undefined ? [] : (value.kind === "list" ? value.items : [value])) {
            if (item.kind === "length") {
                return item.px;
            }
        }
        return undefined;
    }

    private hasVisibleOverflow(box: ElementBox): boolean {
        const overflow: CssValue | undefined = box.style.values["overflow-x"];
        return overflow === undefined || (overflow.kind === "ident" && VISIBLE_OVERFLOW.includes(overflow.lower));
    }

    private supported(display: DisplayType): void {
        // A formatting context whose layout is not written stops the run, instead of laying its boxes out as blocks.
        const kind: string = display.internal ?? display.inner;
        if (kind !== "flow" && kind !== "flow-root" && kind !== "table-caption") {
            throw new Error("The layout of display: " + kind + " is not implemented");
        }
    }

    private inlineEdges(sizes: UsedSizes): number {
        return this.sizes.edges(sizes, BoxSizes.INLINE_START) + this.sizes.edges(sizes, BoxSizes.INLINE_END);
    }

    private clamped(size: number, minimum?: number, maximum?: number): number {
        // CSS 2 §10.4 and §10.7: the maximum is applied first, so the minimum wins when they conflict.
        return Math.max(minimum ?? 0, maximum === undefined ? size : Math.min(size, maximum));
    }

    private margin(value: number): Margins {
        return value === 0 ? NO_MARGIN : (value > 0 ? [value, 0] : [0, value]);
    }

    private merged(first: Margins, second: Margins): Margins {
        // CSS 2 §8.3.1: "the resulting margin width is the maximum of the collapsing margins' widths", and with negative
        // margins "the maximum of the absolute values of the negative adjoining margins is deducted" from the largest positive.
        if (first === NO_MARGIN || second === NO_MARGIN) {
            return first === NO_MARGIN ? second : first;
        }
        return [Math.max(first[0], second[0]), Math.min(first[1], second[1])];
    }
}
