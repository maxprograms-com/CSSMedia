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
import type { Box, Homography } from "../geometry/PathGeometry.js";
import type { Matrix4 } from "../svg/SvgGeometry.js";
import type { ImageAlpha, ImageFormats, ImageSize } from "../images/ImageFormats.js";
import type { BoxNode, ElementBox, InlineSequence, InlineText } from "../pdf/BoxTree.js";
import type { ComputedStyle, PositionOption } from "../pdf/ComputedStyle.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { InlineTextBuilder } from "../pdf/InlineTextBuilder.js";
import type { NaturalSizes, Transform, UsedSizes } from "./BoxSizes.js";
import type { Alignment, Area } from "./AnchorPositioning.js";
import { AnchorPositioning } from "./AnchorPositioning.js";
import { BoxSizes } from "./BoxSizes.js";
import { BoxTransforms } from "./BoxTransforms.js";
import { ContentAlignment } from "./ContentAlignment.js";
import type { FloatArea, StackedFloat } from "./FloatStack.js";
import { FloatStack } from "./FloatStack.js";
import type { AnchorLink, BoxFragment, BreakToken, LineFragment, Margins, ObjectArea, PlainLine, PositionedCarry, Sides, TextPiece } from "./Fragment.js";
import type { TextEdges } from "./InlineLayout.js";
import { InlineLayout } from "./InlineLayout.js";
import { LetterGeometry } from "./LetterGeometry.js";
import { TableLayout } from "./TableLayout.js";

const NO_MARGIN: Margins = [0, 0];
const DEFAULT_WIDTH: number = 300;
const DEFAULT_HEIGHT: number = 150;
const VISIBLE_OVERFLOW: ReadonlyArray<string> = ["visible", "clip"];
const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set<string>(["hidden", "scroll", "auto"]);
const PHYSICAL_EDGES: ReadonlyArray<string> = ["top", "right", "bottom", "left"];
const EDGE_TOLERANCE: number = 0.01;
const TOLERANCE: number = 0.001;
const FLOAT_FIELDS: number = 4;
const START_FLOATS: ReadonlySet<string> = new Set<string>(["inline-start", "block-start", "top"]);
const END_FLOATS: ReadonlySet<string> = new Set<string>(["inline-end", "block-end", "bottom"]);
const FULL_SIZE: CssValue = { kind: "percentage", value: 100 };
const NO_SIDES: readonly [boolean, boolean] = [false, false];
const START_SIDE: readonly [boolean, boolean] = [true, false];
const END_SIDE: readonly [boolean, boolean] = [false, true];
const BOTH_SIDES: readonly [boolean, boolean] = [true, true];
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
const COLUMN_EXTENT: number = 1000000000;
const BALANCING_STEPS: number = 16;
const BLOCK_DISPLAY: DisplayType = { outer: "block", inner: "flow", listItem: false };

interface Columns {
    count: number;
    width: number;
    gap: number;
    lead: number;
    spread: number;
    fill: string;
}

interface ColumnPart {
    box: ElementBox;
    spanner: boolean;
}

interface ColumnSet {
    fragments: Array<BoxFragment>;
    floats: Array<BoxFragment>;
    token?: BreakToken;
    extent: number;
    height: number;
}

interface ColumnResult {
    children: Array<BoxFragment>;
    extent: number;
    natural: number;
    columns: number;
    subject: number;
    rules: Array<readonly [number, number, number]>;
    token?: BreakToken;
    firstBaseline: number | undefined;
    baseline: number | undefined;
}

interface ForcedColumns {
    box: ElementBox;
    columns: Columns;
    length: number;
}
const BLOCK_ORIENTATION: number = BoxSizes.VERTICAL | BoxSizes.BLOCK_REVERSED;

interface Floats {
    starts: Array<number>;
    ends: Array<number>;
    used: boolean;
    letters: Array<Letter>;
    contours: Array<Contour>;
}

type Letter = readonly [boolean, number, number, number];

interface Contour {
    inStarts: boolean;
    index: number;
    low: number;
    width: number;
    top: number;
    bottom: number;
    margin: number;
    edges: ReadonlyArray<number>;
    shaped?: boolean;
}

interface Holder {
    fragment?: BoxFragment;
    transform: Transform;
    frame: number;
    depth: number;
}

interface AnchorFound {
    path?: ReadonlyArray<ElementBox>;
    bounds?: Map<ElementBox, [number, number, number, number]>;
}

interface AnchorContext {
    owners: ReadonlyArray<number>;
    box: ElementBox;
    style: ComputedStyle;
    container: BoxFragment;
    base: Transform;
    frame: number;
    region: [number, number, number, number];
    found: AnchorFound;
    usesDefault: boolean;
    missing: boolean;
}

interface AbsoluteSetting {
    box: ElementBox;
    container: BoxFragment;
    base: Transform;
    containing: number;
    inlineSize: number;
    blockSize: number;
    statics: readonly [number, number, number, number];
    staticFrame: number;
    parent: ElementBox | undefined;
    initial: boolean;
    found: AnchorFound;
}

interface OptionArea {
    area?: Area;
    anchor?: readonly [number, number, number, number];
    justify: Alignment;
    align: Alignment;
}

interface AbsolutePlace {
    fragment: BoxFragment;
    inline: number;
    block: number;
    across: number;
    down: number;
    overflows: boolean;
    corrected: boolean;
    context: AnchorContext;
    sizes: UsedSizes;
    size: number;
    monolithic: boolean;
}

interface ChainPart {
    fragment: BoxFragment;
    content: BoxFragment;
    base: Transform;
    room: number;
}

interface Waiting {
    box: ElementBox;
    placeholder: BoxFragment;
    local: Transform;
    frame: number;
    part: number;
    path: ReadonlyArray<ElementBox>;
    replace: (piece?: BoxFragment) => () => void;
}

interface Chain {
    parts: Array<ChainPart>;
    waiting: Array<Waiting>;
    placed: Array<() => void>;
    initial: boolean;
    done: boolean;
    area?: InlineArea;
}

interface InlineArea {
    rectangle: readonly [number, number, number, number];
    box: ElementBox;
}

interface InlineHolder {
    box: ElementBox;
    pieces: Array<readonly [readonly [number, number, number, number], number, number]>;
    chain: Chain;
}

interface InlineChain {
    parts: Array<ChainPart>;
    holders: Map<SourceElement, InlineHolder>;
}

interface Overflow {
    box: ElementBox;
    token?: BreakToken;
    whole?: BoxFragment;
    part?: ChainPart;
    area: readonly [number, number, number, number];
    offset: number;
    sizes: UsedSizes;
    size: number;
    context?: AnchorContext;
    margin?: Sides;
    hidden?: boolean;
    anchoredTo?: AnchorLink;
}

interface Spread {
    pieces: Array<readonly [BoxFragment, number, number]>;
    rest?: BreakToken;
    beyond: boolean;
    start: number;
}

interface Wrapping {
    area: WrappingArea;
    critical: Float64Array;
    top: number;
    bottom: number;
}

export interface SnapPlace {
    box: ElementBox;
    inlineStart: number;
    inlineEnd: number;
    blockStart: number;
    blockEnd: number;
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
const COLUMN_BREAKS: ReadonlySet<string> = new Set<string>(["column", "always", "avoid-column"]);
const MINIMUM_FRAGMENTAINER: number = 1;
const PAGE_CONTEXT: ReadonlyArray<string> = ["page"];
const NO_CALLS: ReadonlySet<ElementBox> = new Set<ElementBox>();

export class BlockLayout {

    static readonly EDGE_FIELDS: number = 5;

    pageBreak?: Candidate;
    pageEarlier?: Candidate;
    endsSpread: boolean = false;
    private bandOffset: number = 0;
    private readonly sizes: BoxSizes = new BoxSizes((anchor: CalcAnchor, block: boolean, side?: number): number | undefined => this.anchorLength(anchor, block, side));
    private readonly letters: LetterGeometry = new LetterGeometry();
    private readonly transforms: BoxTransforms = new BoxTransforms(this.sizes);
    private readonly inline: InlineLayout;
    private readonly trimmed: WeakSet<LineFragment> = new WeakSet<LineFragment>();
    private readonly columnBoxes: WeakMap<ElementBox, Array<ColumnPart>> = new WeakMap<ElementBox, Array<ColumnPart>>();
    private readonly images: ImageFormats;
    readonly tables: TableLayout = new TableLayout(this, this.sizes);
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly alignment: ContentAlignment = new ContentAlignment();
    private readonly shifts: WeakMap<BoxFragment, number> = new WeakMap<BoxFragment, number>();
    private readonly contents?: ContainerContents;
    private floats?: Floats;
    private forcedColumns?: ForcedColumns;
    private unboundedTable: readonly [ElementBox, number] | undefined = undefined;
    private wrapping?: Wrapping;
    private pending?: Set<BoxFragment>;
    private initialInline: number = 0;
    private initial: readonly [number, number] = UNLIMITED;
    private frame: number = 0;
    private parentItems: CssValue | undefined = undefined;
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
    private anchorOwners?: Map<ElementBox, ElementBox>;
    private elementOwners?: Map<SourceElement, Map<string, ElementBox>>;
    private readonly indexedTrees: Set<ElementBox> = new Set<ElementBox>();
    private readonly anchoring: Array<AnchorContext> = [];
    private readonly anchorRules: AnchorPositioning = new AnchorPositioning(this.sizes);
    private pushed: ReadonlySet<ElementBox> = NO_CALLS;
    readonly floatStack: FloatStack = new FloatStack(this.sizes);
    shapeImages?: (value: CssValue, style: ComputedStyle, width: number, height: number) => ImageAlpha | undefined;
    innerLayout?: (box: ElementBox, sizes: UsedSizes, inlineSize?: number) => BoxFragment | undefined;
    private readonly floatCopies: WeakMap<ElementBox, ElementBox> = new WeakMap<ElementBox, ElementBox>();
    private readonly pageCopies: WeakMap<ElementBox, ElementBox> = new WeakMap<ElementBox, ElementBox>();
    private pageFlow: boolean = false;
    private skipTables: boolean = false;
    private columnDepth: number = 0;
    private readonly snapped: Map<ElementBox, number> = new Map<ElementBox, number>();
    private readonly snapMarkers: WeakMap<ElementBox, ElementBox> = new WeakMap<ElementBox, ElementBox>();
    private readonly snapOrigins: WeakMap<ElementBox, ElementBox> = new WeakMap<ElementBox, ElementBox>();
    private readonly snapBoxes: WeakMap<ElementBox, ReadonlyArray<ElementBox>> = new WeakMap<ElementBox, ReadonlyArray<ElementBox>>();
    private readonly fixedStatic: Map<ElementBox, readonly [number, number, number, number, number]> = new Map<ElementBox, readonly [number, number, number, number, number]>();
    private readonly fixedKnown: Map<ElementBox, readonly [number, number, number, number, number]> = new Map<ElementBox, readonly [number, number, number, number, number]>();
    private fixedRoot?: ElementBox;
    private fixedList: ReadonlyArray<ElementBox> = [];
    private readonly fixedPaths: Map<ElementBox, ReadonlyArray<ElementBox>> = new Map<ElementBox, ReadonlyArray<ElementBox>>();
    private readonly boxOrder: Map<ElementBox, number> = new Map<ElementBox, number>();
    private readonly copyOrigins: WeakMap<ElementBox, ElementBox> = new WeakMap<ElementBox, ElementBox>();
    private readonly chains: Map<ElementBox, Chain> = new Map<ElementBox, Chain>();
    private readonly inlineChains: Map<ElementBox, InlineChain> = new Map<ElementBox, InlineChain>();
    private overflows: Array<Overflow> = [];
    private placements: number = 0;
    private readonly carriedContexts: WeakMap<PositionedCarry, AnchorContext> = new WeakMap<PositionedCarry, AnchorContext>();
    private pageArea: readonly [number, number] = UNLIMITED;

    constructor(metrics: FontMetrics, text: InlineTextBuilder, images: ImageFormats, contents?: ContainerContents) {
        this.images = images;
        this.inline = new InlineLayout(metrics, this.sizes, text, this);
        if (contents !== undefined) {
            this.contents = contents;
        }
    }

    cell(box: ElementBox, tableFrame: number, inlineSize: number, border?: [number, number, number, number], space?: number, incoming?: BreakToken): BoxFragment {
        // CSS 2 §17.5.2 and §17.5.3: the table gives a cell its width and its height, and in the collapsing border model
        // its borders too, given on the sides of the table's writing mode.
        const frame: number = this.sizes.frame(box.style);
        const orthogonal: boolean = this.sizes.isOrthogonal(tableFrame, frame);
        const sizes: UsedSizes = orthogonal ? this.sizes.of(box.style, undefined, inlineSize, inlineSize) : this.sizes.of(box.style, inlineSize);
        delete sizes.margin;
        delete sizes.inlineSize;
        delete sizes.minInlineSize;
        delete sizes.maxInlineSize;
        delete sizes.blockSize;
        delete sizes.minBlockSize;
        delete sizes.maxBlockSize;
        // CSS Sizing 4 §4.1: aspect-ratio applies to "all elements except inline boxes and internal ruby or table boxes".
        delete sizes.keywords;
        delete sizes.ratio;
        delete sizes.calculations;
        if (border !== undefined) {
            sizes.border = [0, 1, 2, 3].map((side: number) => border[this.sizes.side(frame, tableFrame, side)]) as [number, number, number, number];
        }
        const outerFrame: number = this.frame;
        const outerSkip: boolean = this.skipTables;
        this.frame = tableFrame;
        this.skipTables = false;
        try {
            if (orthogonal) {
                // CSS Writing Modes 4 §7.3: a cell in an orthogonal flow is sized in its own writing mode, the column width being its block
                // size, and is monolithic; its inline size comes from its content in the available space of §7.3.1.
                sizes.blockSize = Math.max(0, inlineSize - this.sizes.edges(sizes, BoxSizes.BLOCK_START) - this.sizes.edges(sizes, BoxSizes.BLOCK_END));
                return this.turned(this.crossed(box, sizes, frame, undefined, inlineSize, false), 0, sizes, tableFrame, frame);
            }
            const fragment: BoxFragment = this.flow(box, sizes, Math.max(0, inlineSize - this.inlineEdges(sizes)), 0, true, 0, 0, undefined, space, incoming);
            this.reoriented(fragment, tableFrame, frame);
            return fragment;
        } finally {
            this.frame = outerFrame;
            this.skipTables = outerSkip;
        }
    }

    page(box: ElementBox, inlineSize: number, blockSize: number, token?: BreakToken, end?: Candidate, whole?: readonly [number, number],
        origin?: readonly [number, number]): BoxFragment {
        // CSS Paged Media 3 §3: the page area of the first page is the initial containing block, the containing block of the
        // root element (CSS 2 §10.1); CSS Writing Modes 4 §8.1: it takes the writing mode of the root element. The page floats
        // take part of the page area, which stays the initial containing block.
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        this.pageFlow = true;
        this.pageArea = whole ?? [inlineSize, blockSize];
        if (token === undefined) {
            const area: readonly [number, number] = this.pageArea;
            this.initialInline = area[0];
            this.rootBox = box;
            this.chains.clear();
            this.inlineChains.clear();
            this.initial = (this.frame & BoxSizes.VERTICAL) === 0 ? [area[0], area[1]] : [area[1], area[0]];
        }
        const initialBlock: number = (this.frame & BoxSizes.VERTICAL) === 0 ? this.initial[1] : this.initial[0];
        // CSS Fragmentation 4 §5.1: "Layout is performed per-fragmentainer, with each fragmentainer continuing progress from the
        // breakpoint on the previous"; §4: "fragmentainers are assumed to have a minimum block size of 1px".
        const space: number = Math.max(MINIMUM_FRAGMENTAINER, blockSize);
        this.overflows = [];
        const fragment: BoxFragment = this.fragmented(PAGE_CONTEXT, space, inlineSize, token,
            (): BoxFragment => this.block(box, inlineSize, true, 0, 0, initialBlock, undefined, 0, space, token, false), end);
        const state: Fragmentation = this.pageState as Fragmentation;
        // CSS 2 §8.3.1: "Margins of the root element's box do not collapse."
        fragment.block = fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1];
        const taken: Candidate | undefined = this.tokenCandidate([], fragment.token, APPEAL_PERFECT);
        this.carryIn(fragment, token, PAGE_CONTEXT, space);
        // CSS 2 §10.1 and CSS Paged Media 3 §3.2: an absolutely positioned box that no box contains takes the page area, on its own page as
        // CSS Position 3 §3.5.3 allows; the fixed boxes take the page area of each page, which fixedPage() gives them.
        this.pageAbsolutes(fragment, origin ?? [0, 0]);
        this.carryOut(fragment);
        this.overflows = [];
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
        // A page-margin box inherits from the page context, not from the content, so it starts its own writing mode; CSS Page Floats 3
        // §3.1: it is outside the page area that the pages of the document fragment, so a page float in it has its line box as reference.
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        this.pageFlow = false;
        const fragment: BoxFragment = this.flow(box, sizes, inlineSize, 0, true, 0, 0);
        this.usedMargins(fragment, sizes, this.frame, this.frame, this.sizes.margin(sizes, BoxSizes.INLINE_START) ?? 0, this.sizes.margin(sizes, BoxSizes.INLINE_END) ?? 0);
        // CSS Position 3 §3.1: a fixed box of a running element takes the page area, where fixedPage() places its copies.
        if (fragment.children !== undefined && this.fixedList.length > 0) {
            this.staticPlaces(fragment.children, undefined, this.frame);
        }
        return fragment;
    }

    marginContent(box: ElementBox): readonly [number, number] {
        this.frame = this.sizes.frame(box.style);
        this.sign = 1;
        this.pageFlow = false;
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
        this.pageFlow = true;
        // The space is the margin box of the area, whose block-start margin comes before the fragmentainer that it breaks in.
        const before: number = this.sizes.margin(this.sizes.of(area.style, inlineSize, blockSize), BoxSizes.BLOCK_START) ?? 0;
        const room: number = Math.max(MINIMUM_FRAGMENTAINER, space - before);
        const outer: Array<Overflow> = this.overflows;
        const lay: (extent: number) => BoxFragment = (extent: number): BoxFragment => {
            this.overflows = [];
            const laid: BoxFragment = this.fragmented(PAGE_CONTEXT, extent, inlineSize, token,
                (): BoxFragment => this.block(area, inlineSize, true, 0, 0, blockSize, undefined, 0, extent, token, false));
            this.carryIn(laid, token, PAGE_CONTEXT, extent);
            // The area of each page is a box of its own, so the boxes it contains are placed at once, and what goes past its end goes on in the next one.
            this.placeAlone({ fragment: laid, content: laid, base: this.paddingBase(laid), room: extent }, false, false);
            return laid;
        };
        const placements: number = this.placements;
        let fragment: BoxFragment = lay(room);
        // GCPM 3 §2.4.1: the area touches the bottom of the page area, which ends its fragmentainer there, so positioned boxes placed against the
        // room it was given are placed again in the room it takes.
        const taken: number = fragment.blockSize + (fragment.marginAfter === undefined ? 0 : fragment.marginAfter[0] + fragment.marginAfter[1]);
        if (this.placements !== placements && fragment.token === undefined && taken < room - TOLERANCE) {
            fragment = lay(Math.max(MINIMUM_FRAGMENTAINER, taken));
        }
        this.carryOut(fragment);
        this.overflows = outer;
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
        this.containerOf(fragment, false, undefined, undefined);
    }

    private containerOf(fragment: BoxFragment, fragmenting: boolean, incoming: BreakToken | undefined, space: number | undefined): void {
        // CSS Fragmentation 4 §5.5: in a fragmentation context the boxes of a containing block "will fragment across fragmentainers in the same
        // fragmentation flow as the containing block", so they wait for all its fragments; outside one they are placed in the box at once.
        const containing: boolean = this.fixedContainer(fragment.box);
        if (!containing && !this.absoluteContainer(fragment.box)) {
            return;
        }
        if (fragmenting || incoming !== undefined) {
            this.chained(fragment, containing, incoming, space ?? Number.POSITIVE_INFINITY);
        } else {
            this.positioned(fragment, containing);
        }
    }

    private fixedContainer(box: ElementBox): boolean {
        // CSS Transforms 1 §3: a transform "establish[es] a containing block for all descendants", and CSS Containment 2 §3.2 and §3.4: so
        // does layout or paint containment, "an absolute positioning containing block and a fixed positioning containing block".
        const root: boolean = box.element !== undefined && box.pseudoElement === undefined && box.element.getParent() === undefined;
        return (this.containment(box) & CONTAINING_BLOCK) !== 0 || (this.displays.isTransformable(box.display, box.replaced) && this.displays.isTransforming(box.style.values, root))
            || (!root && this.displays.isFiltering(box.style.values)) || this.displays.changesContaining(box.style.values, box.display, box.replaced, true, root);
    }

    private absoluteContainer(box: ElementBox): boolean {
        // CSS Position 3 §2.1: a positioned box is the containing block of the absolutely positioned boxes inside it, and CSS Will Change 1 §2
        // makes position named in will-change do the same.
        const position: string = this.keyword(box.style.values["position"]);
        return (position !== "none" && position !== "static") || this.displays.changesContaining(box.style.values, box.display, box.replaced, false);
    }

    crossedContent(box: ElementBox): readonly [number, number] {
        // CSS Writing Modes 4 §7.3: the content-based block size of a box in an orthogonal flow "is used as input to the inline-axis
        // min-content size and max-content size" of its container, laid out in the available space of §7.3.1.
        const given: UsedSizes = this.sizes.of(box.style, undefined, undefined, 0);
        delete given.margin;
        const laid: BoxFragment = this.crossed(box, given, this.sizes.frame(box.style), undefined, undefined, true);
        const content: number = Math.max(0, laid.blockSize - this.sizes.edges(given, BoxSizes.BLOCK_START) - this.sizes.edges(given, BoxSizes.BLOCK_END));
        return [content, content];
    }

    cellLimit(table: ElementBox): number | undefined {
        // CSS Writing Modes 4 §7.3.3: the cells of a table laid out in infinite inline space are block containers that get that
        // space, and so size by §7.3.2 against its constraint.
        const entry: readonly [ElementBox, number] | undefined = this.unboundedTable;
        return entry !== undefined && entry[0].children.includes(table) ? entry[1] : undefined;
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

    apart<T>(run: () => T): T {
        // A layout that stands outside the block formatting context, such as a level of ruby annotations, meets none of its floats.
        const floats: Floats | undefined = this.floats;
        const wrapping: Wrapping | undefined = this.wrapping;
        delete this.floats;
        delete this.wrapping;
        try {
            return run();
        } finally {
            if (floats !== undefined) {
                this.floats = floats;
            }
            if (wrapping !== undefined) {
                this.wrapping = wrapping;
            }
        }
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
        const width: number = this.band(inlineStart, inlineSize, top, size, true);
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
        // CSS Shapes 2 §9.2: the exclusion is the content area minus the shape, and "Any part of the shape outside the element's
        // content area has no effect"; a line box needs the room that is free across its whole block size (CSS 2 §9.5).
        const wrapping: Wrapping | undefined = this.wrapping;
        if (wrapping === undefined) {
            return undefined;
        }
        const area: readonly [number, number, number, number] = wrapping.area.area;
        if (area[3] === Number.POSITIVE_INFINITY && wrapping.critical.length > 0 && top + TOLERANCE >= wrapping.bottom) {
            // SVG 2 §11.7.1.1 treats the edge of a shape as floats, and CSS 2 §9.5 shifts a line down "until either some content
            // fits or there are no more floats present"; below the last edge nothing is left to exclude, so the content overflows.
            return undefined;
        }
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

    private band(inlineStart: number, inlineSize: number, top: number, size: number, lines: boolean = false): number {
        // CSS 2 §9.5: the room between the floats at one block position, kept in the block formatting context's inline axis,
        // which runs against that of a box asking with the other direction.
        const floats: Floats | undefined = this.floats;
        const low: number = this.sign > 0 ? inlineStart : inlineStart - inlineSize;
        let start: number = low;
        let end: number = low + inlineSize;
        const bottom: number = top + Math.max(size, TOLERANCE);
        for (let index: number = 0; floats !== undefined && index < floats.starts.length; index += FLOAT_FIELDS) {
            if (floats.starts[index + 1] < bottom && floats.starts[index + 1] + floats.starts[index + 3] > top && !(lines && this.isShaped(floats, true, index))) {
                start = Math.max(start, floats.starts[index] + floats.starts[index + 2]);
            }
        }
        for (let index: number = 0; floats !== undefined && index < floats.ends.length; index += FLOAT_FIELDS) {
            if (floats.ends[index + 1] < bottom && floats.ends[index + 1] + floats.ends[index + 3] > top && !(lines && this.isShaped(floats, false, index))) {
                end = Math.min(end, floats.ends[index]);
            }
        }
        for (const contour of floats === undefined ? [] : floats.contours) {
            // CSS Inline 3 §7.7: with initial-letter-wrap: all a line starts "at the start-most point that does not overlap the initial
            // letter's glyph outline", grown by shape-margin and "clipped by the initial letter's margin edges"; CSS Shapes 1 §2: the
            // float area of a shape-outside is for the lines only.
            if (contour.top >= bottom || contour.bottom <= top || (contour.shaped === true && !lines)) {
                continue;
            }
            const reach: number = Math.min(contour.width, this.letters.reach(contour.edges, contour.margin, Math.max(top, contour.top), Math.min(bottom, contour.bottom)));
            if (reach > 0 && contour.inStarts) {
                start = Math.max(start, contour.low + reach);
            } else if (reach > 0) {
                end = Math.min(end, contour.low + contour.width - reach);
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
        for (const contour of this.floats === undefined ? [] : this.floats.contours) {
            next = contour.bottom > top + TOLERANCE && (next === undefined || contour.bottom < next) ? contour.bottom : next;
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
        const floated: CssValue | undefined = values["float"];
        const side: string = this.keyword(floated);
        // CSS Page Floats 3 §3.2: when the float reference is a line box, block-start "behaves like inline-start" and block-end like inline-end,
        // and top and bottom behave like block-start or inline-start and like block-end or inline-end.
        if (side !== "left" && side !== "right" && !START_FLOATS.has(side) && !END_FLOATS.has(side)) {
            throw new Error("The layout of float: " + (floated !== undefined && floated.kind === "function" ? floated.name + "()" : side) + " is not implemented");
        }
        const laid: ElementBox = this.floatBox(box);
        // CSS Fragmentation 4 §2.1: a float is a parallel flow; one that starts after the end of the fragmentainer goes whole to
        // the next one, and so does every later float, since CSS 2 §9.5.1 rules 5 and 6 keep their order.
        const fragmenting: Fragmentation | undefined = this.end < Number.POSITIVE_INFINITY ? this.fragmenting : undefined;
        if (fragmenting !== undefined && incoming === undefined && (this.pushedFloat || Math.max(origin + top, this.clearEdge(box)) >= this.end - TOLERANCE)) {
            this.pushFloat(box, inlineStart, inlineSize);
            return true;
        }
        let placed: readonly [BoxFragment, number] = incoming === undefined ? this.atomic(laid, inlineSize, blockBasis)
            : this.parallel((): readonly [BoxFragment, number] => this.atomic(laid, inlineSize, blockBasis, this.end - origin - top, incoming), incoming);
        let fragment: BoxFragment = placed[0];
        const before: number = fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1];
        let height: number = before + fragment.blockSize + (fragment.marginAfter === undefined ? 0 : fragment.marginAfter[0] + fragment.marginAfter[1]);
        // CSS 2 §9.5.1 rule 5: "The outer top of a floating box may not be higher than the outer top of any block or floated
        // box generated by an element earlier in the source document."
        let block: number = Math.max(origin + top, this.clearEdge(box));
        const reversed: boolean = (this.frame & BoxSizes.RIGHT_TO_LEFT) !== 0;
        const atEnd: boolean = END_FLOATS.has(side) || (side === "right" && !reversed) || (side === "left" && reversed);
        if (this.floats !== undefined) {
            for (const earlier of [this.floats.starts, this.floats.ends]) {
                for (let index: number = 0; index < earlier.length; index += FLOAT_FIELDS) {
                    block = this.isLetter(earlier, index) ? block : Math.max(block, earlier[index + 1]);
                }
            }
            // CSS Inline 3 §7.9.3: an inline-start float that "originates in subsequent lines of content adjacent to a (sunk) initial
            // letter" "must clear the initial letter"; one in the letter's own first line goes past it like other inline content.
            for (const letter of atEnd ? [] : this.floats.letters) {
                if (block >= letter[2] - TOLERANCE) {
                    block = Math.max(block, letter[3]);
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
                placed = this.parallel((): readonly [BoxFragment, number] => this.atomic(laid, inlineSize, blockBasis, this.end - block - before));
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
        const offset: number = this.bandOffset + (atEnd ? available - placed[1] : 0);
        const inline: number = this.sign > 0 ? inlineStart + offset : inlineStart - offset - placed[1];
        const floats: Floats = this.floats ?? { starts: [], ends: [], used: true, letters: [], contours: [] };
        this.floats = floats;
        floats.used = true;
        const sideList: Array<number> = atEnd === this.sign > 0 ? floats.ends : floats.starts;
        const index: number = sideList.length;
        sideList.push(inline, block, placed[1], height);
        this.shapeFloat(laid, floats, sideList === floats.starts, index, inline, block, placed[1], height, inlineSize);
        fragment.inline += offset;
        fragment.block = block - origin + before;
        out.push(fragment);
        return true;
    }

    private shapeFloat(box: ElementBox, floats: Floats, inStarts: boolean, index: number, low: number, block: number, width: number, height: number, basis: number): void {
        // CSS Shapes 1 §2: shape-outside makes the float area that inline content wraps around, "clipped to the float's margin box"; "float
        // positioning and stacking are not affected", so the margin box stays among the floats for them, and content wraps on one side only.
        const value: CssValue | undefined = box.style.values["shape-outside"];
        if (value === undefined || (value.kind === "ident" && value.lower === "none")) {
            return;
        }
        const edges: Array<number> | undefined = this.inline.marginShape(value, box.style, this.sizes.of(box.style, basis), this.frame, width, height);
        if (edges === undefined) {
            return;
        }
        // The outline goes to the block formatting context as distances from the float's outer edge, the one away from the content.
        const outline: Array<number> = [];
        for (let point: number = 0; point < edges.length; point += 2) {
            const fromLow: number = this.sign > 0 ? edges[point] : width - edges[point];
            outline.push(inStarts ? fromLow : width - fromLow, block + edges[point + 1]);
        }
        // §6.3: the percentages of shape-margin refer to "the inline size of the containing block".
        const margin: CssValue | undefined = box.style.values["shape-margin"];
        floats.contours.push({ inStarts, index, low, width, top: block, bottom: block + height, margin: margin === undefined ? 0 : this.sizes.pixels(margin, basis), edges: outline,
            shaped: true });
    }

    frameOf(style: ComputedStyle): number {
        return this.sizes.frame(style);
    }

    isSnap(box: ElementBox): boolean {
        const value: CssValue | undefined = box.style.values["float"];
        const name: string = value === undefined ? "" : (value.kind === "function" ? value.name : this.keyword(value));
        return name === "snap-block" || name === "snap-inline";
    }

    snapOrigin(box: ElementBox): ElementBox {
        return this.snapOrigins.get(box) ?? box;
    }

    snapState(): Map<ElementBox, number> {
        return new Map<ElementBox, number>(this.snapped);
    }

    restoreSnaps(saved: ReadonlyMap<ElementBox, number>): void {
        this.snapped.clear();
        for (const [box, side] of saved) {
            this.snapped.set(box, side);
        }
    }

    snap(box: ElementBox, side: number): void {
        this.snapped.set(box, side);
    }

    snapPlaces(fragment: BoxFragment, column: boolean, found: Array<SnapPlace>, inline: number, block: number): Array<SnapPlace> {
        // The boxes with a snap value that are still in the flow, and where they stand in the coordinates the fragment is placed in; the
        // boxes in the columns of a multi-column container inside are that container's, and a flow of another writing mode is not entered.
        const frame: number = this.sizes.frame(fragment.box.style);
        const startInline: number = inline + fragment.inline + this.side(BoxSizes.INLINE_START, fragment.border) + this.side(BoxSizes.INLINE_START, fragment.padding);
        const startBlock: number = block + fragment.block + this.side(BoxSizes.BLOCK_START, fragment.border) + this.side(BoxSizes.BLOCK_START, fragment.padding);
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                const lineInline: number = child.kind === "line" ? startInline + (child.inline ?? 0) : startInline;
                const lineBlock: number = child.kind === "line" ? startBlock + child.block : startBlock;
                const box: ElementBox = piece.box;
                if (box.placement === "in-flow" && this.isSnap(box) && !this.snapped.has(box) && piece.resumed !== true
                    && this.keyword(box.style.values["float-reference"]) === (column ? "column" : "page")) {
                    found.push({ box, inlineStart: lineInline + piece.inline, inlineEnd: lineInline + piece.inline + piece.inlineSize, blockStart: lineBlock + piece.block,
                        blockEnd: lineBlock + piece.block + piece.blockSize });
                }
                if ((!column || this.columnsOf(box, piece.inlineSize) === undefined) && !this.sizes.isOrthogonal(frame, this.sizes.frame(box.style))) {
                    this.snapPlaces(piece, column, found, lineInline, lineBlock);
                }
            }
        }
        return found;
    }

    snapSide(place: SnapPlace, inlineSize: number, blockSize: number, frame: number): number | undefined {
        // CSS Page Floats 3 §3.2: snap-block() floats the element "to the start or the end of the block if it naturally appears within a
        // certain distance from either one", one length for both and two for the start and the end; the keyword says where, the nearest
        // with near, where "If near is in effect and the element is within the specified distance both from the start and the end, end
        // wins"; snap-block is snap-block(2em, near), and snap-inline does the same along the line, with left and right.
        const values: Readonly<Record<string, CssValue>> = place.box.style.values;
        const value: CssValue | undefined = values["float"];
        const along: boolean = (value?.kind === "function" ? value.name : this.keyword(value)) === "snap-inline";
        const args: ReadonlyArray<CssValue> = value !== undefined && value.kind === "function" ? value.args : [];
        const lengths: Array<number> = [];
        let keyword: string = "near";
        for (const item of args.flatMap((arg: CssValue) => arg.kind === "list" ? arg.items : [arg])) {
            if (item.kind === "ident") {
                keyword = item.lower;
            } else {
                lengths.push(this.sizes.pixels(item, 0));
            }
        }
        const size: CssValue | undefined = values["font-size"];
        const startReach: number = lengths[0] ?? 2 * (size === undefined ? 16 : this.sizes.pixels(size, 0));
        const endReach: number = lengths[1] ?? startReach;
        const toStart: number = along ? place.inlineStart : place.blockStart;
        const toEnd: number = along ? inlineSize - place.inlineEnd : blockSize - place.blockEnd;
        const nearStart: boolean = toStart <= startReach + TOLERANCE;
        const nearEnd: boolean = toEnd <= endReach + TOLERANCE;
        if (!nearStart && !nearEnd) {
            return undefined;
        }
        const start: number = along ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START;
        const end: number = along ? BoxSizes.INLINE_END : BoxSizes.BLOCK_END;
        // CSS Writing Modes 4 §7.5: left and right are the line-left and line-right sides.
        const lineLeft: number = (frame & BoxSizes.RIGHT_TO_LEFT) !== 0 ? BoxSizes.INLINE_END : BoxSizes.INLINE_START;
        switch (keyword) {
            case "start":
                return start;
            case "end":
                return end;
            case "left":
                return lineLeft;
            case "right":
                return lineLeft === BoxSizes.INLINE_START ? BoxSizes.INLINE_END : BoxSizes.INLINE_START;
            default:
                return nearEnd ? end : start;
        }
    }

    private snapMarker(box: ElementBox): ElementBox {
        // The place of a snapped box in the flow is a float anchor, which the page or the column reads as that of a page float.
        let marker: ElementBox | undefined = this.snapMarkers.get(box);
        if (marker === undefined) {
            marker = { ...box, placement: "page-float" };
            this.snapMarkers.set(box, marker);
            this.snapOrigins.set(marker, box);
            this.copyOrigins.set(marker, box);
        }
        return marker;
    }

    private snapsIn(content: ElementBox): ReadonlyArray<ElementBox> {
        let boxes: ReadonlyArray<ElementBox> | undefined = this.snapBoxes.get(content);
        if (boxes === undefined) {
            const found: Array<ElementBox> = [];
            const walk: (box: ElementBox) => void = (box: ElementBox): void => {
                for (const child of box.children) {
                    if (child.kind === "box") {
                        if (this.isSnap(child)) {
                            found.push(child);
                        }
                        walk(child);
                    }
                }
            };
            walk(content);
            boxes = found;
            this.snapBoxes.set(content, boxes);
        }
        return boxes;
    }

    isInlineFloat(box: ElementBox): boolean {
        return box.placement === "float" || (box.placement === "page-float" && !this.floatsApart(box));
    }

    floatsApart(box: ElementBox): boolean {
        // CSS Page Floats 3 §3.1: the float reference is the column or the page the float anchor is in, and "If the float anchor is not
        // inside a column, the float reference is the line box of the float anchor", and likewise outside a page.
        if (box.placement !== "page-float") {
            return false;
        }
        return this.keyword(box.style.values["float-reference"]) === "column" ? this.columnDepth > 0 : this.pageFlow;
    }

    private snapApart(box: ElementBox): boolean {
        // CSS Page Floats 3 §3.1: with an inline or a region reference, or outside a column or a page, the float reference is the line box,
        // where a snap value has no effect (Page Floats 3, Editor's Draft, §3.2: "Has no effect if the element is an inline float").
        const reference: string = this.keyword(box.style.values["float-reference"]);
        return reference === "column" ? this.columnDepth > 0 : reference === "page" && this.pageFlow;
    }

    private floatBox(box: ElementBox): ElementBox {
        // A page float whose float reference is its line box is laid out and painted as the other floats are.
        if (box.placement !== "page-float") {
            return box;
        }
        let copy: ElementBox | undefined = this.floatCopies.get(box);
        if (copy === undefined) {
            copy = { ...box, placement: "float" };
            this.floatCopies.set(box, copy);
            this.copyOrigins.set(copy, box);
        }
        return copy;
    }

    pageFloat(box: ElementBox, inlineSize: number, blockSize: number, frame: number): StackedFloat {
        // CSS Page Floats 3 §3.1: "The float containing block formatting context is a new block formatting context with the same dimensions
        // and placement as the float reference"; §3.2: for a block-start or block-end float "The initial value of the max-width or max-height
        // property that refers to the inline size of the float is '100%'".
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const side: number | undefined = this.floatStack.side(values["float"], frame) ?? this.snapped.get(this.snapOrigin(box));
        if (side === undefined) {
            const floated: CssValue | undefined = values["float"];
            throw new Error("The layout of float: " + (floated !== undefined && floated.kind === "function" ? floated.name + "()" : this.keyword(floated)) + " is not implemented");
        }
        let copy: ElementBox | undefined = this.pageCopies.get(box);
        if (copy === undefined) {
            const limited: boolean = (side === BoxSizes.BLOCK_START || side === BoxSizes.BLOCK_END) && this.keyword(values["max-inline-size"]) === "none";
            const style: ComputedStyle = limited ? { ...box.style, values: Object.assign(Object.create(values) as Record<string, CssValue>, { "max-inline-size": FULL_SIZE }) }
                : box.style;
            copy = { ...box, style, placement: "float" };
            this.pageCopies.set(box, copy);
            this.copyOrigins.set(copy, this.snapOrigin(box));
        }
        const laid: ElementBox = copy;
        const outerFrame: number = this.frame;
        const outerSign: number = this.sign;
        this.frame = frame;
        this.sign = 1;
        try {
            const placed: readonly [BoxFragment, number] = this.apart((): readonly [BoxFragment, number] => this.atomic(laid, inlineSize, blockSize));
            const fragment: BoxFragment = placed[0];
            this.positioned(fragment, false);
            const before: number = fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1];
            const after: number = fragment.marginAfter === undefined ? 0 : fragment.marginAfter[0] + fragment.marginAfter[1];
            const stacked: StackedFloat = {
                box, fragment, side, inlineSize: placed[1], blockSize: before + fragment.blockSize + after, start: fragment.inline, before,
                closes: this.floatStack.closes(values["clear"], frame)
            };
            const offset: CssValue | undefined = values["float-offset"];
            if (offset !== undefined) {
                stacked.offset = offset;
            }
            return stacked;
        } finally {
            this.frame = outerFrame;
            this.sign = outerSign;
        }
    }

    excludeLetter(inlineStart: number, offset: number, block: number, width: number, height: number, firstLine: number, edges?: ReadonlyArray<number>,
        margin?: number): void {
        // CSS Inline 3 §7.7: the lines after the one an initial letter starts in are shortened to keep clear of its exclusion area, on
        // the inline-start side of the line, as the margin box of a float on that side shortens them (CSS 2 §9.5); a glyph outline
        // excludes only what it reaches at each line, so its entry among the floats excludes nothing and only keeps its place.
        const inline: number = this.sign > 0 ? inlineStart + offset : inlineStart - offset - width;
        const floats: Floats = this.floats ?? { starts: [], ends: [], used: true, letters: [], contours: [] };
        this.floats = floats;
        floats.used = true;
        const side: Array<number> = this.sign > 0 ? floats.starts : floats.ends;
        floats.letters.push([this.sign > 0, side.length, firstLine, block + height]);
        if (edges !== undefined) {
            floats.contours.push({ inStarts: this.sign > 0, index: side.length, low: inline, width, top: block, bottom: block + height, margin: margin ?? 0, edges });
            side.push(inline, Number.NEGATIVE_INFINITY, 0, 0);
        } else {
            side.push(inline, block, width, height);
        }
    }

    shapeAlpha(value: CssValue, style: ComputedStyle, width: number, height: number): ImageAlpha | undefined {
        // CSS Shapes 1 §6.1: the shape of an <image> is the part of it whose alpha is above the threshold, a gradient or a cross-fade as
        // much as a file; the pages give the painter that computes it, and a layout without one reads the files alone.
        if (this.shapeImages !== undefined) {
            return this.shapeImages(value, style, width, height);
        }
        return value.kind === "url" ? this.images.alpha(value.href) : undefined;
    }

    private isShaped(floats: Floats, inStarts: boolean, index: number): boolean {
        return floats.contours.some((contour: Contour) => contour.shaped === true && contour.inStarts === inStarts && contour.index === index);
    }

    private isLetter(side: ReadonlyArray<number>, index: number): boolean {
        const floats: Floats | undefined = this.floats;
        return floats !== undefined && floats.letters.some((letter: Letter) => letter[1] === index && (letter[0] ? floats.starts : floats.ends) === side);
    }

    private truncate(floats: Floats, starts: number, ends: number): void {
        floats.starts.length = Math.min(floats.starts.length, starts);
        floats.ends.length = Math.min(floats.ends.length, ends);
        floats.letters = floats.letters.filter((letter: Letter) => letter[1] < (letter[0] ? floats.starts : floats.ends).length);
        floats.contours = floats.contours.filter((contour: Contour) => contour.index < (contour.inStarts ? floats.starts : floats.ends).length);
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
        const floats: Floats | undefined = this.floats;
        if (floats === undefined) {
            return Number.NEGATIVE_INFINITY;
        }
        const [ownStart, ownEnd]: readonly [boolean, boolean] = this.clearedSides(this.keyword(box.style.values["clear"]));
        const atStart: boolean = this.sign > 0 ? ownStart : ownEnd;
        const atEnd: boolean = this.sign > 0 ? ownEnd : ownStart;
        let edge: number = Number.NEGATIVE_INFINITY;
        for (const side of [atStart ? floats.starts : undefined, atEnd ? floats.ends : undefined]) {
            for (let index: number = 0; side !== undefined && index < side.length; index += FLOAT_FIELDS) {
                edge = this.isLetter(side, index) ? edge : Math.max(edge, side[index + 1] + side[index + 3]);
            }
        }
        // CSS Inline 3 §7.9.2: a block that "starts with an initial letter, establishes an independent formatting context, or specifies
        // clear in the initial letter's containing block's start direction" clears it; §7.9.3: the clear of a float never does.
        const clears: boolean = box.placement !== "float" && (ownStart || this.isIndependent(box) || box.inline?.[0]?.initial !== undefined);
        for (const letter of clears ? floats.letters : []) {
            edge = Math.max(edge, letter[3]);
        }
        return edge;
    }

    private clearedSides(clear: string): readonly [boolean, boolean] {
        switch (clear) {
            case "both":
                return BOTH_SIDES;
            case "inline-start":
            case "block-start":
            case "top":
                // CSS Page Floats 3 §4: on a block-level box or an inline float, block-start behaves "like inline-start" and top
                // "like block-start or inline-start"; block-end and bottom likewise behave like inline-end.
                return START_SIDE;
            case "inline-end":
            case "block-end":
            case "bottom":
                return END_SIDE;
            case "left":
            case "right":
                // CSS Writing Modes 4 §7.5: left and right are the line-left and line-right of the containing block.
                return (clear === "left") !== ((this.frame & BoxSizes.RIGHT_TO_LEFT) !== 0) ? START_SIDE : END_SIDE;
            default:
                return NO_SIDES;
        }
    }

    atomic(box: ElementBox, inlineSize: number, blockBasis?: number, space?: number, incoming?: BreakToken, letterBlock?: number): readonly [BoxFragment, number] {
        // CSS 2 §10.3.9: an inline-block with an auto width takes the shrink-to-fit width of §10.3.5, "min(max(preferred
        // minimum width, available width), preferred width)", and its auto margins are zero; §10.3.2 for a replaced box.
        const parentFrame: number = this.frame;
        const frame: number = this.sizes.frame(box.style);
        if (this.sizes.isOrthogonal(parentFrame, frame)) {
            const crossing: UsedSizes = this.sizes.of(box.style, blockBasis, inlineSize, inlineSize);
            const before: number = this.sizes.margin(crossing, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)) ?? 0;
            const after: number = this.sizes.margin(crossing, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)) ?? 0;
            const turned: BoxFragment = this.turned(this.crossed(box, crossing, frame, blockBasis, inlineSize, false), before, crossing, parentFrame, frame);
            this.usedMargins(turned, crossing, parentFrame, frame, before, after);
            return [turned, before + turned.inlineSize + after];
        }
        let given: UsedSizes = this.sizes.of(box.style, inlineSize, blockBasis);
        if (letterBlock !== undefined && given.blockSize === undefined) {
            // CSS Inline 3 §7.5.5: an atomic initial letter with an auto block size has the border-box block size that its size and
            // alignment give, "and is definite".
            given = { ...given, blockSize: Math.max(0, letterBlock - this.sizes.edges(given, BoxSizes.BLOCK_START) - this.sizes.edges(given, BoxSizes.BLOCK_END)) };
        }
        const start: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)) ?? 0;
        const end: number = this.sizes.margin(given, this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)) ?? 0;
        const stretch: number = Math.max(0, inlineSize - start - end - this.inlineEdges(given));
        const sizes: UsedSizes = this.resolved(box, given, stretch, blockBasis);
        let size: number | undefined = sizes.inlineSize;
        if (size === undefined) {
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            size = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(content[0], stretch), content[1]));
        }
        // CSS Align 3 §9.1: "When finding the first/last baseline set of an inline-block, any baselines contributed by table boxes must be
        // skipped", in the blocks inside it too.
        const outerSkip: boolean = this.skipTables;
        this.skipTables = box.display.outer === "inline" && box.display.inner === "flow-root" && !box.replaced && !this.tables.isWrapper(box);
        const fragment: BoxFragment = this.flow(box, sizes, this.clamped(size, sizes.minInlineSize, sizes.maxInlineSize), start, true, 0, 0, undefined, space, incoming);
        this.skipTables = outerSkip;
        if (this.tables.isWrapper(box)) {
            this.rootBaselines(fragment);
        }
        if ((this.containment(box) & DisplayTypes.LAYOUT_CONTAINMENT) !== 0) {
            // CSS Containment 2 §3.2: for vertical-align "the containment box is treated as having no baseline". The baselines of a scroll
            // container are those of CSS Align 3 §9.1, which flow() gives it.
            delete fragment.firstBaseline;
            delete fragment.baseline;
        }
        this.usedMargins(fragment, sizes, parentFrame, frame, start, end);
        this.reoriented(fragment, parentFrame, frame);
        return [fragment, start + fragment.inlineSize + end];
    }

    private rootBaselines(wrapper: BoxFragment): void {
        // CSS Tables 3 §2.2.1: "The table-root box (not the table-wrapper box) is used when doing baseline vertical alignment for an
        // inline-table", whatever captions come before it.
        const root: BoxFragment | LineFragment | undefined = wrapper.children?.find((child: BoxFragment | LineFragment) => child.kind === "box" && this.tables.isGrid(child.box));
        delete wrapper.firstBaseline;
        delete wrapper.baseline;
        if (root === undefined || root.kind !== "box") {
            return;
        }
        const start: number = this.side(BoxSizes.BLOCK_START, wrapper.border) + this.side(BoxSizes.BLOCK_START, wrapper.padding);
        if (root.firstBaseline !== undefined) {
            wrapper.firstBaseline = start + root.block + root.firstBaseline;
        }
        if (root.baseline !== undefined) {
            wrapper.baseline = start + root.block + root.baseline;
        }
    }

    private crossed(box: ElementBox, given: UsedSizes, frame: number, available: number | undefined, blockBasis: number | undefined, probe: boolean): BoxFragment {
        // CSS Fragmentation 4 §4.1: an orthogonal flow is monolithic, and "Any forced breaks within such boxes therefore cannot split
        // the box, and must therefore also be ignored by the box's own fragmentation context", so it is laid out outside that context.
        const outer: Fragmentation | undefined = this.fragmenting;
        delete this.fragmenting;
        try {
            return this.crossedLayout(box, given, frame, available, blockBasis, probe);
        } finally {
            if (outer !== undefined) {
                this.fragmenting = outer;
            }
        }
    }

    private crossedLayout(box: ElementBox, given: UsedSizes, frame: number, available: number | undefined, blockBasis: number | undefined, probe: boolean): BoxFragment {
        // CSS Writing Modes 4 §7.3: in the sizing phase of an orthogonal flow the box and its containing block are measured
        // "using the writing mode of the box establishing the orthogonal flow"; the fragment comes back in that mode.
        const space: number = available ?? this.fallback(frame);
        const margins: number = (this.sizes.margin(given, BoxSizes.INLINE_START) ?? 0) + (this.sizes.margin(given, BoxSizes.INLINE_END) ?? 0);
        const stretch: number = Math.max(0, space - margins - this.inlineEdges(given));
        const sizes: UsedSizes = this.resolved(box, given, stretch, blockBasis);
        const lay: (inlineSize: number) => BoxFragment = (inlineSize: number): BoxFragment => probe ? this.probe(box, sizes, inlineSize, 0, true, 0, 0)
            : this.flow(box, sizes, inlineSize, 0, true, 0, 0);
        if (sizes.inlineSize !== undefined) {
            return lay(this.clamped(sizes.inlineSize, sizes.minInlineSize, sizes.maxInlineSize));
        }
        if (this.tables.isWrapper(box)) {
            // §7.3.3: a table "is laid out into its given available space", and with an infinite one "at its max-content size",
            // while its cells get that infinite space and size as §7.3.2 says against the constraint of §7.3.1.
            const outer: readonly [ElementBox, number] | undefined = this.unboundedTable;
            this.unboundedTable = available === undefined ? [box, space] : undefined;
            try {
                const own: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
                const room: number = available === undefined ? Number.POSITIVE_INFINITY : stretch;
                return lay(this.clamped(this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(own[0], room), own[1])), sizes.minInlineSize,
                    sizes.maxInlineSize));
            } finally {
                this.unboundedTable = outer;
            }
        }
        const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
        const fit: (constraint: number) => number = (constraint: number): number => this.clamped(this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE,
            Math.min(Math.max(content[0], constraint), content[1])), sizes.minInlineSize, sizes.maxInlineSize);
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const countValue: CssValue | undefined = values["column-count"];
        const widthValue: CssValue | undefined = values["column-width"];
        const count: number | undefined = countValue !== undefined && countValue.kind === "number" ? Math.max(1, Math.floor(countValue.value)) : undefined;
        const width: number | undefined = widthValue !== undefined && widthValue.kind !== "ident" ? this.sizes.pixels(widthValue, 0) : undefined;
        const container: boolean = !box.replaced && box.display.internal === undefined && this.displays.isBlockContainer(box.display) && !this.tables.isWrapper(box);
        // §7.3.2: a block container that establishes an orthogonal flow with an auto inline size is a multi-column container, its
        // column length the block size, else the stretch-fit block size, else the max-content block size (one column).
        const blockEdges: number = (this.sizes.margin(sizes, BoxSizes.BLOCK_START) ?? 0) + (this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0)
            + this.sizes.edges(sizes, BoxSizes.BLOCK_START) + this.sizes.edges(sizes, BoxSizes.BLOCK_END);
        const length: number | undefined = sizes.blockSize ?? (blockBasis === undefined ? undefined : Math.max(0, blockBasis - blockEdges));
        if (!container || length === undefined || (count !== undefined && width !== undefined)) {
            return lay(fit(stretch));
        }
        const gap: number = this.columnGap(values, space);
        // "If column-count and column-width are both auto", the shrink-to-fit formula; with a count, the constraint less the gaps.
        const columnWidth: number = width ?? fit(count === undefined ? stretch : stretch - (count - 1) * gap);
        if (content[1] <= columnWidth + TOLERANCE) {
            // "If the content neither line-wraps nor fragments", the box is as wide as its max-content inline size.
            const single: BoxFragment = lay(fit(stretch));
            if (single.blockSize - this.sizes.edges(sizes, BoxSizes.BLOCK_START) - this.sizes.edges(sizes, BoxSizes.BLOCK_END) <= length + TOLERANCE) {
                return single;
            }
        }
        const columns: Columns = { count: count ?? 1, width: columnWidth, gap, lead: 0, spread: 0, fill: "auto" };
        this.forcedColumns = { box, columns, length };
        try {
            // The used column-count "follows from filling the resulting multi-column layout with the box's content".
            const filled: BoxFragment = this.probe(box, sizes, columnWidth, 0, true, 0, 0);
            const used: number = count ?? Math.max(1, (filled.children ?? []).filter((child: BoxFragment | LineFragment) => child.kind === "box").length);
            columns.count = used;
            // Filling in order only counts the columns; the box is a multi-column container, so CSS Multicol 1 §7.1 column-fill
            // decides how its content is spread over them.
            columns.fill = this.keyword(values["column-fill"]) === "auto" ? "auto" : "balance";
            return lay(used * columnWidth + (used - 1) * gap);
        } finally {
            delete this.forcedColumns;
        }
    }

    private columnGap(values: Readonly<Record<string, CssValue>>, basis: number): number {
        // CSS Multicol 1 §5.1 and CSS Align 3 §8.1: normal is 1em in multi-column containers, a percentage of the content box.
        const gap: CssValue | undefined = values["column-gap"];
        const size: CssValue | undefined = values["font-size"];
        return gap === undefined || gap.kind === "ident" ? (size === undefined ? 0 : this.sizes.pixels(size, 0)) : this.sizes.pixels(gap, basis);
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
        const justify: Alignment | undefined = this.blockJustify(box, parentFrame, frame);
        let offset: number = start ?? 0;
        if (start === undefined) {
            offset = Math.max(0, end === undefined ? free / 2 : free - end);
        } else if (end !== undefined && justify !== undefined) {
            // CSS Box Alignment 3 §6.1.1: justify-self aligns the margin box in the containing block's inline axis, the box's block axis here.
            offset = start + this.justified(justify, free - start - end);
        }
        const turned: BoxFragment = this.turned(laid, offset, given, parentFrame, frame);
        this.usedMargins(turned, given, parentFrame, frame, offset, free - offset);
        return turned;
    }

    private blockJustify(box: ElementBox, parentFrame: number, frame: number): Alignment | undefined {
        // CSS Box Alignment 3 §6.1.1: justify-self does not apply to floats and "Anonymous block boxes always behave as normal"; CSS Anchor
        // Positioning 1 §4.2: anchor-center "behaves as center" on a box that is not absolutely positioned.
        if (box.placement !== "in-flow" || (box.element === undefined && box.pseudoElement === undefined)) {
            return undefined;
        }
        const alignment: Alignment = this.anchorRules.alignment(this.selfValue(box.style.values["justify-self"], this.parentItems), true, parentFrame, frame);
        if (alignment.kind === "normal" || alignment.kind === "stretch") {
            return undefined;
        }
        return alignment.kind === "anchor-center" ? { ...alignment, kind: "center" } : alignment;
    }

    private selfValue(value: CssValue | undefined, items: CssValue | undefined): CssValue | undefined {
        // CSS Box Alignment 3 §6.1 and §6.2: auto "behaves as the computed justify-items value of the parent box (minus any legacy keywords)",
        // and align-self as the parent's align-items.
        if (value !== undefined && !(value.kind === "ident" && value.lower === "auto")) {
            return value;
        }
        const kept: Array<CssValue> = (items === undefined ? [] : (items.kind === "list" ? [...items.items] : [items]))
            .filter((item: CssValue) => !(item.kind === "ident" && item.lower === "legacy"));
        return kept.length === 0 ? undefined : (kept.length === 1 ? kept[0] : { kind: "list", separator: "space", items: kept });
    }

    private justified(alignment: Alignment, free: number): number {
        // CSS Box Alignment 3 §4.4: safe aligns a box that overflows as start; §4.4.1.3: without the scroll-container bias of its rule 2 a UA "must
        // behave as safe for align-content on block containers and unsafe otherwise".
        if (alignment.overflow === "safe" && free < 0) {
            return 0;
        }
        return alignment.kind === "end" ? free : (alignment.kind === "center" ? free / 2 : 0);
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
            this.truncate(floats, starts, ends);
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
            if (!this.sizes.isOrthogonal(parentFrame, frame)) {
                // CSS Tables 3 §3.6.1: the properties that are not the wrapper's, transform and contain among them, are the table grid box's, which another
                // layout mode lays out; the box laid out as an orthogonal flow is a block container, which flow() handles.
                this.containerOf(whole, space !== undefined && this.fragmenting !== undefined, incoming !== undefined && incoming.box === box ? incoming : undefined, space);
            }
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
        // CSS Box Alignment 3 §6.1.1: with a justify-self other than normal and stretch "The automatic size of a block-level box" "is equivalent
        // to fit-content", and the margin box is aligned in the containing block instead of the over-constrained rules of CSS 2 §10.3.3.
        const justify: Alignment | undefined = this.blockJustify(box, parentFrame, frame);
        let size: number | undefined = sizes.inlineSize;
        if (size === undefined && this.tables.isWrapper(box)) {
            size = this.tables.wrapperSize(box, stretch);
        }
        if (size === undefined && justify !== undefined) {
            const content: readonly [number, number] = this.contentSizes(box, sizes.blockSize);
            size = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(content[0], stretch), content[1]));
        }
        if (size === undefined) {
            // "If 'width' is set to 'auto', any other 'auto' values become '0' and 'width' follows from the resulting equality."
            // A calc-size() on the automatic size changes the size, and the box is still sized as auto.
            const automatic: number = this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, stretch);
            if (automatic !== stretch || this.clamped(stretch, sizes.minInlineSize, sizes.maxInlineSize) === stretch) {
                const width: number = this.clamped(automatic, sizes.minInlineSize, sizes.maxInlineSize);
                const automaticFragment: BoxFragment = this.flow(box, sizes, width, start ?? 0, independent, this.origin(originInline, start ?? 0, width, sizes, startSide),
                    top + before, trim, space, incoming);
                this.usedMargins(automaticFragment, sizes, parentFrame, frame, start ?? 0, containerInline - (start ?? 0) - width - edges);
                this.reoriented(automaticFragment, parentFrame, frame);
                return automaticFragment;
            }
            size = stretch;
        }
        size = this.clamped(size, sizes.minInlineSize, sizes.maxInlineSize);
        // Auto margins share the free space, or are zero when there is none; without one, the end margin gives way, unless justify-self aligns
        // the box, whose auto margins "take precedence over justify-self".
        const free: number = containerInline - size - edges;
        let offset: number = start ?? 0;
        if (start === undefined) {
            offset = Math.max(0, end === undefined ? free / 2 : free - end);
        } else if (end !== undefined && justify !== undefined) {
            offset = start + this.justified(justify, free - start - end);
        }
        const fragment: BoxFragment = this.flow(box, sizes, size, offset, independent, this.origin(originInline, offset, size, sizes, startSide), top + before, trim,
            space, incoming);
        this.usedMargins(fragment, sizes, parentFrame, frame, offset, free - offset);
        this.reoriented(fragment, parentFrame, frame);
        return fragment;
    }

    private usedMargins(fragment: BoxFragment, sizes: UsedSizes, parentFrame: number, frame: number, start: number, end: number): void {
        // The used margins on the box's own sides, which painting needs for a margin box (CSS Shapes 1 §5): the inline ones that placed the box
        // in its containing block, an auto block margin zero (CSS 2 §10.6.3), and none at a break (CSS Fragmentation 4 §5.2).
        const margin: Array<number> = [0, 1, 2, 3].map((side: number) => this.sizes.margin(sizes, side) ?? 0);
        margin[this.sizes.side(parentFrame, frame, BoxSizes.INLINE_START)] = start;
        margin[this.sizes.side(parentFrame, frame, BoxSizes.INLINE_END)] = end;
        if (fragment.resumed === true) {
            margin[this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_START)] = 0;
        }
        if (fragment.token !== undefined) {
            margin[this.sizes.side(parentFrame, frame, BoxSizes.BLOCK_END)] = 0;
        }
        if (margin.some((value: number) => value !== 0)) {
            fragment.margin = [margin[0], margin[1], margin[2], margin[3]];
        }
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
                this.truncate(floats, starts, ends);
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
        if (incoming !== undefined && incoming.box === box && incoming.ended === true) {
            // CSS Fragmentation 4 §5.5: after its end a box goes on only as what overflows it, "an empty box with zero margins/borders/padding at the start
            // of the fragmentainer", which holds the positioned boxes that go on there.
            return { kind: "box", box, inline: inlineOffset, block: 0, inlineSize: 0, blockSize: 0, resumed: true };
        }
        const fragmenting: Fragmentation | undefined = space === undefined ? undefined : this.fragmenting;
        const sizes: UsedSizes = this.remaining(this.blockSized(box, given, inlineSize, inlineOffset, independent, originInline, originBlock, trim), incoming);
        // The contents are laid out in the box's own writing mode; in a block formatting context that it shares, a box whose
        // direction is not its parent's runs its inline axis against the context's.
        const outerFrame: number = this.frame;
        const outerItems: CssValue | undefined = this.parentItems;
        const outerSign: number = this.sign;
        const outerLimit: number = this.limit;
        const outerPort: readonly [number, number] = this.port;
        const frame: number = this.sizes.frame(box.style);
        this.sign = independent ? 1 : outerSign * (((outerFrame ^ frame) & BoxSizes.INLINE_REVERSED) !== 0 ? -1 : 1);
        this.frame = frame;
        this.parentItems = box.style.values["justify-items"];
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
        // CSS Align 3 §5.1.1: a box that breaks has its content aligned as it is when unbroken, and the gap before the content goes on
        // across the breaks as progress (CSS Fragmentation 4 §5.3), so the offset comes from a layout without breaks and is kept in the token.
        const aligning: boolean = this.alignsContent(box);
        let aligned: number = 0;
        if (aligning && fragmenting !== undefined && resumed) {
            aligned = incoming?.lead ?? 0;
        } else if (aligning && fragmenting !== undefined && this.hasFreeSpace(box, sizes)) {
            aligned = this.shifts.get(this.probe(box, given, inlineSize, inlineOffset, independent, originInline, originBlock, trim)) ?? 0;
        }
        // §5.3: the progress of the earlier fragments is what they filled, never less than nothing; only a gap before the content goes on.
        const lead: number = !resumed ? aligned : (aligned > 0 ? Math.max(0, aligned - Math.max(0, incoming?.consumed ?? 0)) : 0);
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
        let offset: number = lead;
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
            delete this.anchorOwners;
            delete this.elementOwners;
            this.tables.forget();
        }
        const nodes: ReadonlyArray<BoxNode> | undefined = box.replaced ? undefined : box.children;
        // CSS Multicol 1: the content of a multi-column container is laid out in columns, which are fragmentainers of their own.
        const forced: ForcedColumns | undefined = this.forcedColumns !== undefined && this.forcedColumns.box === box ? this.forcedColumns : undefined;
        const columns: Columns | undefined = nodes === undefined ? undefined : (forced?.columns ?? this.columnsOf(box, inlineSize));
        let rules: Array<readonly [number, number, number]> | undefined;
        let subject: number | undefined;
        if (resumed) {
            startTrim = undefined;
        }
        if (independent && incoming?.parallel !== undefined) {
            this.resumeFloats(incoming.parallel, children, sizes.blockSize);
        }
        if (columns !== undefined) {
            const flowed: ColumnResult = this.columnFlow(box, columns, forced?.length ?? sizes.blockSize, inlineSize, room, fragmenting !== undefined, lead, incoming);
            children.push(...flowed.children);
            // CSS Writing Modes 4 §7.3.2: "The used block size of the box is either the used column length (if multiple columns were used)
            // or the max-content block size of the content (if only one column was used)."
            offset = forced !== undefined && flowed.columns < 2 ? flowed.natural : flowed.extent;
            subject = flowed.subject;
            empty = flowed.children.length === 0;
            firstBaseline = flowed.firstBaseline;
            baseline = flowed.baseline;
            token = flowed.token;
            rules = flowed.rules.length > 0 ? flowed.rules : undefined;
        }
        for (let index: number = incoming?.child ?? 0; columns === undefined && nodes !== undefined && index < nodes.length;) {
            if (fragmenting !== undefined && fragmenting.restart) {
                break;
            }
            const node: BoxNode = nodes[index];
            if (this.isBlockLevel(node) && this.snapped.has(node) && this.snapApart(node) && (incoming === undefined || incoming.child !== index)) {
                // CSS Page Floats 3 §3.2: a box that snaps to an edge floats there, and leaves its float anchor where it stood in the flow.
                children.push(this.emptyPlace(this.snapMarker(node), offset + (empty && adjoinsStart ? 0 : pending[0] + pending[1])));
                index++;
                continue;
            }
            if (this.isBlockLevel(node)) {
                const resuming: BreakToken | undefined = incoming !== undefined && incoming.child === index ? incoming.inner : undefined;
                let filled: boolean = fragmenting !== undefined && fragmenting.filled;
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
                    if (empty && lead > TOLERANCE && room > TOLERANCE && resuming === undefined) {
                        if (this.reachesEarly(fragmenting, undefined)) {
                            token = this.token(box, index, sequence, undefined, undefined, undefined);
                            break;
                        }
                        local = this.alignmentBreak(fragmenting);
                        filled = true;
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
                if (!this.skipTables || !(this.tables.isWrapper(node) || this.tables.isGrid(node))) {
                    firstBaseline = firstBaseline ?? (child.firstBaseline === undefined ? undefined : child.block + child.firstBaseline);
                    baseline = child.baseline === undefined ? baseline : child.block + child.baseline;
                }
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
                const floated: boolean = this.isInlineFloat(outside);
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
                    // CSS Position 3 §3.5.2: the static-position rectangle of a block-level box spans "the inline-axis sides of the box's
                    // static-position containing block".
                    placeholder.inlineSize = inlineSize;
                    children.push(placeholder);
                } else if (outside.placement === "running" || outside.placement === "footnote" || this.floatsApart(outside)) {
                    children.push(this.emptyPlace(outside, top));
                }
                if (fragmenting !== undefined && floated && children.length > placed) {
                    fragmenting.filled = true;
                }
                index++;
                continue;
            }
            const start: number = index;
            const resume: number | undefined = incoming !== undefined && incoming.child === start ? incoming.line : undefined;
            if (fragmenting !== undefined && empty && lead > TOLERANCE && room > TOLERANCE && resume === undefined) {
                fragmenting.path[fragmenting.path.length - 1][1] = start;
                if (this.reachesEarly(fragmenting, undefined)) {
                    token = this.token(box, start, sequence, undefined, undefined, undefined);
                    break;
                }
                this.alignmentBreak(fragmenting);
            }
            while (index < nodes.length && !this.isBlockLevel(nodes[index])) {
                index++;
            }
            const run: InlineSequence | undefined = box.inline?.[sequence++];
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
                    let resumeAt: number = lines[kept].start;
                    const plain: PlainLine | undefined = kept > 0 && this.keepsBreak(box) ? lines[kept - 1].plain : undefined;
                    if (plain !== undefined) {
                        // CSS Text 4 §6.3.5: the last line before a page break is laid out without its hyphen, and the next page
                        // starts with the word that the hyphen cut.
                        const replaced: LineFragment = lines[kept - 1];
                        plain.line.block = replaced.block;
                        if (replaced.inline !== undefined) {
                            plain.line.inline = replaced.inline;
                        }
                        lines[kept - 1] = plain.line;
                        resumeAt = plain.next;
                    }
                    token = this.token(box, start, sequence - 1, resumeAt, undefined, undefined);
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
        if (fragmenting !== undefined && token === undefined && !fragmenting.restart && sizes.blockSize !== undefined && sizes.blockSize > room + TOLERANCE
            && room > TOLERANCE) {
            // CSS Fragmentation 4 §4.1 class C: the box is taller than what is left, so it breaks after its content, which the rest of its block
            // size follows in the next fragmentainer; §4.4: a box whose content edge is past the end of the fragmentainer goes after a break.
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
            if (aligned !== 0) {
                token.lead = aligned;
            }
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
        // CSS Align 3 §5.1.1 and §5.1.2: the content as a unit, or the lines of columns and the spanners, are aligned in the content box;
        // in a fragmentation context the content was laid out after the gap that the alignment leaves.
        const shift: number = aligning && fragmenting === undefined && token === undefined
            ? this.alignment.blockShift(box.style.values["align-content"], this.hasVisibleOverflow(box), blockSize - (subject ?? content)) : 0;
        if (shift !== 0) {
            for (const child of children) {
                child.block += shift;
            }
            rules = rules?.map((rule: readonly [number, number, number]): readonly [number, number, number] => [rule[0], rule[1] + shift, rule[2]]);
            firstBaseline = firstBaseline === undefined ? undefined : firstBaseline + shift;
            baseline = baseline === undefined ? undefined : baseline + shift;
        }
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
        if (!box.replaced && !this.hasVisibleOverflow(box) && this.displays.isBlockContainer(box.display)) {
            // CSS Align 3 §9.1: "if the position of a scroll container's first/last baseline is outside its border edge, that baseline's
            // position is clamped to the border edge".
            if (fragment.firstBaseline !== undefined) {
                fragment.firstBaseline = Math.min(Math.max(fragment.firstBaseline, 0), fragment.blockSize);
            }
            const source: string = this.keyword(box.style.values["baseline-source"]);
            if (source !== "first" && source !== "last") {
                // "for legacy reasons if its baseline-source is auto" a scroll container "always has a last baseline set, whose baselines all
                // correspond to its block-end margin edge".
                fragment.baseline = fragment.blockSize + (this.sizes.margin(sizes, BoxSizes.BLOCK_END) ?? 0);
            } else if (fragment.baseline !== undefined) {
                fragment.baseline = Math.min(Math.max(fragment.baseline, 0), fragment.blockSize);
            }
        }
        if (shift !== 0) {
            this.shifts.set(fragment, shift);
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
        if (rules !== undefined) {
            fragment.rules = rules;
        }
        this.inlineContainers(fragment, fragmenting !== undefined, resumed ? incoming : undefined, space);
        this.containerOf(fragment, fragmenting !== undefined, resumed ? incoming : undefined, space);
        if (fragmenting !== undefined) {
            fragmenting.path.pop();
            fragmenting.avoid -= avoiding ? 1 : 0;
        }
        this.end = outerEnd;
        this.floatTokens = outerTokens;
        this.pushedFloat = outerPushed;
        this.frame = outerFrame;
        this.parentItems = outerItems;
        this.sign = outerSign;
        this.limit = outerLimit;
        this.port = outerPort;
        return fragment;
    }

    private columnsOf(box: ElementBox, inlineSize: number): Columns | undefined {
        // CSS Multicol 1 §3.4: the used column count and width follow from the available width, the gap and the two properties; with
        // only a width, the count is the largest number of columns of at least that width that fit.
        if (box.replaced || box.display.internal !== undefined || !this.displays.isBlockContainer(box.display)) {
            return undefined;
        }
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const count: CssValue | undefined = values["column-count"];
        const width: CssValue | undefined = values["column-width"];
        const wanted: number | undefined = count !== undefined && count.kind === "number" ? Math.max(1, Math.floor(count.value)) : undefined;
        const least: number | undefined = width !== undefined && width.kind !== "ident" ? this.sizes.pixels(width, 0) : undefined;
        if (wanted === undefined && least === undefined) {
            return undefined;
        }
        const spacing: number = this.columnGap(values, inlineSize);
        const fits: number = least === undefined ? 1 : Math.max(1, Math.floor((inlineSize + spacing) / (least + spacing)));
        const used: number = wanted === undefined ? fits : (least === undefined ? wanted : Math.min(wanted, fits));
        const stretched: number = Math.max(0, (inlineSize - (used - 1) * spacing) / used);
        // CSS Align 3 §5.1.2: justify-content can keep the column-width instead of stretching the columns, and CSS Multicol 1 §3.1 still
        // makes them narrower "if the available space is smaller than the specified column width".
        const justify: CssValue | undefined = values["justify-content"];
        const columnWidth: number = least !== undefined && this.alignment.keepsColumnWidth(justify) ? Math.min(least, stretched) : stretched;
        const placement: readonly [number, number] = this.alignment.columnPlacement(justify, (this.sizes.frame(box.style) & BoxSizes.RIGHT_TO_LEFT) !== 0, used,
            inlineSize - used * columnWidth - (used - 1) * spacing);
        return {
            count: used, width: columnWidth, gap: spacing, lead: placement[0], spread: placement[1], fill: this.keyword(values["column-fill"]) === "auto" ? "auto" : "balance"
        };
    }

    private columnParts(box: ElementBox): Array<ColumnPart> {
        // CSS Multicol 1 §6.1: a block with column-span: all spans all the columns, so what comes before it and what comes after it
        // are columns of their own. The inline sequences go with the children that they are of.
        const known: Array<ColumnPart> | undefined = this.columnBoxes.get(box);
        if (known !== undefined) {
            return known;
        }
        const parts: Array<ColumnPart> = [];
        const nodes: ReadonlyArray<BoxNode> = box.children;
        let from: number = 0;
        let sequence: number = 0;
        let counted: number = 0;
        const flush: (to: number) => void = (to: number): void => {
            if (to > from) {
                parts.push({ box: this.columnContent(box, from, to, counted), spanner: false });
            }
        };
        for (let index: number = 0; index < nodes.length; index++) {
            const node: BoxNode = nodes[index];
            if (node.kind === "box" && node.placement === "in-flow" && this.isBlockLevel(node) && this.keyword(node.style.values["column-span"]) === "all") {
                flush(index);
                parts.push({ box: node, spanner: true });
                from = index + 1;
                counted = sequence;
            } else if (!this.isBlockLevel(node) && (index === 0 || this.isBlockLevel(nodes[index - 1]))) {
                sequence++;
            }
        }
        flush(nodes.length);
        this.columnBoxes.set(box, parts);
        return parts;
    }

    private columnContent(box: ElementBox, from: number, to: number, first: number): ElementBox {
        // The content of a run of columns is a block of its own with no edges, which has the style that an anonymous box has.
        const nodes: Array<BoxNode> = box.children.slice(from, to);
        let runs: number = 0;
        for (let index: number = 0; index < nodes.length; index++) {
            runs += !this.isBlockLevel(nodes[index]) && (index === 0 || this.isBlockLevel(nodes[index - 1])) ? 1 : 0;
        }
        const content: ElementBox = {
            kind: "box", style: { values: box.style.inherited, inherited: box.style.inherited, custom: box.style.custom }, display: BLOCK_DISPLAY, placement: "in-flow", replaced: false,
            hasStartEdge: true, hasEndEdge: true, usedPage: box.usedPage, startPage: box.startPage, endPage: box.endPage, children: nodes
        };
        if (box.inline !== undefined) {
            content.inline = box.inline.slice(first, first + runs);
        }
        return content;
    }

    private columnFlow(box: ElementBox, columns: Columns, blockSize: number | undefined, inlineSize: number, room: number, fragmenting: boolean, lead: number,
        incoming?: BreakToken): ColumnResult {
        const parts: Array<ColumnPart> = this.columnParts(box);
        const result: ColumnResult = { children: [], extent: lead, natural: lead, columns: 0, subject: 0, rules: [], firstBaseline: undefined, baseline: undefined };
        const first: number = incoming?.child ?? 0;
        const state: Fragmentation | undefined = fragmenting ? this.fragmenting : undefined;
        if (state !== undefined && lead > TOLERANCE && room > TOLERANCE && first < parts.length) {
            // The gap before the lines of columns is a class C break point, taken as the break point between two children is when the
            // content after it does not fit: here, when the gap reaches the end of the fragmentainer.
            state.path[state.path.length - 1][1] = first;
            if (this.reachesEarly(state, undefined)) {
                result.token = this.token(box, first, 0, undefined, undefined, undefined);
                return result;
            }
            const local: Candidate = this.alignmentBreak(state);
            if (lead >= room - TOLERANCE && (state.best === local || !this.restartAt(state))) {
                result.token = this.token(box, first, 0, undefined, undefined, undefined);
                return result;
            }
            if (state.restart) {
                return result;
            }
        }
        let offset: number = lead;
        let subject: number = 0;
        let natural: number = lead;
        for (let index: number = first; index < parts.length; index++) {
            const part: ColumnPart = parts[index];
            const inner: BreakToken | undefined = incoming !== undefined && incoming.child === index ? incoming.inner : undefined;
            if (state !== undefined && inner === undefined && room - offset <= TOLERANCE && (index > first || state.filled)) {
                // CSS Fragmentation 4 §4.4: an unforced break keeps content from overflowing the fragmentainer, so a line of columns or a spanner
                // that starts at its end follows a break: the class A break point before it, or the best one before the multi-column container.
                state.path[state.path.length - 1][1] = index;
                if (index > first && this.reachesEarly(state, undefined)) {
                    result.token = this.token(box, index, 0, undefined, undefined, undefined);
                    break;
                }
                const local: Candidate | undefined = index > first ? this.record(state, state.avoid > 0 ? APPEAL_AVOID : APPEAL_PERFECT, undefined) : undefined;
                if (local !== undefined && state.best === local) {
                    result.token = this.token(box, index, 0, undefined, undefined, undefined);
                    break;
                }
                if (this.restartAt(state)) {
                    break;
                }
            }
            const left: number = Math.max(MINIMUM_FRAGMENTAINER, room - offset);
            let token: BreakToken | undefined;
            if (part.spanner) {
                // The spanning block is laid out as a block of the container, across all the columns.
                const fragment: BoxFragment = this.block(part.box, inlineSize, true, 0, offset, undefined, undefined, 0, fragmenting ? left : undefined, inner, false);
                fragment.block = offset + (fragment.marginBefore === undefined ? 0 : fragment.marginBefore[0] + fragment.marginBefore[1]);
                result.children.push(fragment);
                const end: number = fragment.block + fragment.blockSize + (fragment.token !== undefined || fragment.marginAfter === undefined ? 0
                    : fragment.marginAfter[0] + fragment.marginAfter[1]);
                subject += end - offset;
                natural += end - offset;
                offset = end;
                token = fragment.token;
                result.firstBaseline = result.firstBaseline ?? (fragment.firstBaseline === undefined ? undefined : fragment.block + fragment.firstBaseline);
                result.baseline = fragment.baseline === undefined ? result.baseline : fragment.block + fragment.baseline;
            } else {
                // CSS Multicol 1 §2: "the columns before the spanning element are balanced and shortened to fit their content", whatever
                // column-fill says (§7.1), and the columns after the last spanner take what is left of a definite block size.
                const balanced: boolean = parts[index + 1]?.spanner === true;
                const definite: number | undefined = balanced || blockSize === undefined ? undefined : Math.max(0, blockSize - subject);
                const set: ColumnSet = this.columnSet(part.box, columns, definite, left, fragmenting, balanced, inner);
                for (const float of set.floats) {
                    float.block += offset;
                    result.children.push(float);
                }
                for (const [position, fragment] of set.fragments.entries()) {
                    fragment.block += offset;
                    result.children.push(fragment);
                    if (position > 0) {
                        // §4: a rule is drawn "in the middle of each column gap" between two columns that both have content, as long as the column
                        // height; CSS Align 3 §5.1.2 adds the space that justify-content puts between the columns to the gaps.
                        result.rules.push([columns.lead + position * (columns.width + columns.gap + columns.spread) - (columns.gap + columns.spread) / 2, offset,
                            set.height]);
                    }
                }
                // CSS Align 3 §9.1: the first baseline set is that of the column with the highest baseline, nearest the block start, and the
                // last one that of the column with the lowest baseline, nearest the block end.
                let highest: number | undefined;
                let lowest: number | undefined;
                for (const fragment of set.fragments) {
                    if (fragment.firstBaseline !== undefined) {
                        highest = Math.min(highest ?? Number.POSITIVE_INFINITY, fragment.block + fragment.firstBaseline);
                    }
                    if (fragment.baseline !== undefined) {
                        lowest = Math.max(lowest ?? Number.NEGATIVE_INFINITY, fragment.block + fragment.baseline);
                    }
                }
                result.firstBaseline = result.firstBaseline ?? highest;
                result.baseline = lowest ?? result.baseline;
                // CSS Multicol 1 §2: a line of columns "acts as a block-level box" as tall as its columns, which a constrained height gives.
                offset += set.height;
                subject += set.height;
                natural += set.extent;
                result.columns = Math.max(result.columns, set.fragments.length);
                token = set.token;
                if (state !== undefined && token !== undefined && !this.forcedIn(token)) {
                    // CSS Fragmentation 4 §4.4 rules 1 and 4: an unforced break inside the line is a break point, avoided when an ancestor avoids
                    // breaks inside, and taken only if no break point before it keeps more of the rules; it is named as the page names its break.
                    state.path[state.path.length - 1][1] = index;
                    const prefix: Array<readonly [ElementBox, number]> = state.path.map((step: [ElementBox, number]): readonly [ElementBox, number] => [step[0], step[1]]);
                    const inside: Candidate = this.tokenCandidate(prefix, token, Math.min(this.breakAppeal(token), state.avoid > 0 ? APPEAL_AVOID : APPEAL_PERFECT)) as Candidate;
                    const early: boolean = state.early !== undefined && this.sameCandidate(inside, state.early);
                    if (!early && this.keep(state, inside) !== state.best && this.restartAt(state)) {
                        break;
                    }
                }
            }
            if (token !== undefined) {
                result.token = this.token(box, index, 0, undefined, token, undefined);
                break;
            }
        }
        result.extent = offset;
        result.natural = natural;
        result.subject = subject;
        return result;
    }

    private columnSet(content: ElementBox, columns: Columns, definite: number | undefined, limit: number, fragmenting: boolean, balanced: boolean,
        incoming?: BreakToken): ColumnSet {
        // CSS Multicol 1 §7: the columns have the definite height, or with an automatic one the least in which the content fits them
        // (balance, found by trying), or what the fragmentainer around has left (column-fill: auto).
        const kinds: ReadonlyArray<string> = [...(this.fragmenting?.kinds ?? []), "column"];
        const lay: (height: number, endless: boolean) => ColumnSet = (height: number, endless: boolean): ColumnSet => {
            // A column float whose float-defer puts it in an earlier column than its anchor is found as the columns are laid out, so they are
            // laid out again with it placed first.
            const earlier: Map<ElementBox, number> = new Map<ElementBox, number>();
            const set: ColumnSet = this.columnRun(content, columns, height, endless, kinds, earlier, incoming);
            return earlier.size === 0 ? set : this.columnRun(content, columns, height, endless, kinds, earlier, incoming, true);
        };
        // §2: a line of columns that the block size constrains is as tall as the room it gets, whatever its content fills, as "the height of
        // each column will be equivalent to the used height of the multi-column container's content box" with one line.
        const constrained: number | undefined = definite === undefined ? undefined : Math.min(definite, limit);
        const room: number = constrained ?? limit;
        let height: number;
        if (columns.fill === "auto" && !balanced && (fragmenting || constrained !== undefined)) {
            height = room;
        } else if (constrained !== undefined && lay(Math.max(MINIMUM_FRAGMENTAINER, constrained), false).token !== undefined) {
            // §7.1: balance has no effect "when there are overflow columns", and "In fragmented contexts, only the last fragment is balanced".
            height = constrained;
        } else {
            // The balanced height follows from the content, and the room left decides only when that height does not fit; so the search runs
            // over what the columns hold in that room, and the room limits the result.
            const total: number = lay(Math.min(room * columns.count, COLUMN_EXTENT), false).extent;
            if (columns.fill === "auto" && !balanced) {
                height = total;
            } else {
                let low: number = total / columns.count;
                let high: number = total;
                for (let step: number = 0; step < BALANCING_STEPS && high - low > 0.25; step++) {
                    const middle: number = (low + high) / 2;
                    if (lay(middle, false).token === undefined) {
                        high = middle;
                    } else {
                        low = middle;
                    }
                }
                height = Math.min(high, room);
            }
        }
        const set: ColumnSet = lay(Math.max(MINIMUM_FRAGMENTAINER, height), !fragmenting);
        if (constrained !== undefined) {
            set.height = constrained;
        }
        return set;
    }

    private columnRun(content: ElementBox, columns: Columns, height: number, endless: boolean, kinds: ReadonlyArray<string>, earlier: Map<ElementBox, number>,
        incoming: BreakToken | undefined, settled: boolean = false): ColumnSet {
        // CSS Page Floats 3 §8: the page floats of the columns are placed one at a time, in document order, in the column of their anchor or
        // the one float-defer gives, and in the next one when they do not fit; one whose anchor the float would push out of the column goes
        // to the next column, as its anchor would.
        const frame: number = this.sizes.frame(content.style);
        const fragments: Array<BoxFragment> = [];
        const floats: Array<BoxFragment> = [];
        let waiting: Array<readonly [ElementBox, number]> = [...(incoming?.floats ?? [])];
        const done: Set<ElementBox> = new Set<ElementBox>(waiting.map((entry: readonly [ElementBox, number]) => entry[0]));
        let current: BreakToken | undefined = incoming;
        this.columnDepth++;
        // Each layout of the columns finds again which boxes snap, since where they naturally appear depends on the column height.
        for (const box of this.snapsIn(content)) {
            if (this.keyword(box.style.values["float-reference"]) === "column") {
                this.snapped.delete(box);
            }
        }
        try {
            for (let index: number = 0; endless || index < columns.count; index++) {
                const begin: BreakToken | undefined = current;
                const last: number = Math.max(index, columns.count - 1);
                const due: Array<readonly [ElementBox, number]> = [...waiting];
                for (const [box, column] of settled ? [...earlier] : []) {
                    if (column === index && !done.has(box)) {
                        due.push([box, column]);
                        done.add(box);
                    }
                }
                let placed: Array<StackedFloat> = [];
                waiting = [];
                for (const [box, column] of due) {
                    const candidate: StackedFloat | undefined = column > index ? undefined : this.pageFloat(box, columns.width, height, frame);
                    // §10: content is displayed even when no container has room for it, so a float goes into an empty column whatever its size.
                    if (candidate !== undefined && (placed.length === 0 || this.floatStack.arrange([...placed, candidate], columns.width, height).fits)) {
                        placed.push(candidate);
                    } else {
                        waiting.push([box, Math.max(column, index + 1)]);
                    }
                }
                let fragment: BoxFragment = this.columnPiece(content, columns, height, kinds, begin, placed);
                const own: Array<ElementBox> = [];
                const looked: Set<ElementBox> = new Set<ElementBox>();
                for (;;) {
                    const place: SnapPlace | undefined = this.snapPlaces(fragment, true, [], 0, 0).find((entry: SnapPlace) => !looked.has(entry.box));
                    if (place !== undefined) {
                        looked.add(place.box);
                        const snapped: number | undefined = this.snapSide(place, columns.width, height, frame);
                        if (snapped !== undefined) {
                            this.snapped.set(place.box, snapped);
                            fragment = this.columnPiece(content, columns, height, kinds, begin, placed);
                        }
                        continue;
                    }
                    const anchor: ElementBox | undefined = this.anchorsIn(fragment, true, []).find((box: ElementBox) => !done.has(box));
                    if (anchor === undefined) {
                        break;
                    }
                    done.add(anchor);
                    const target: number = this.floatStack.target(anchor.style.values["float-defer"], index + 1, last + 1) - 1;
                    if (target > index) {
                        waiting.push([anchor, target]);
                        continue;
                    }
                    if (target < index && !settled) {
                        earlier.set(anchor, target);
                    }
                    const candidate: StackedFloat = this.pageFloat(anchor, columns.width, height, frame);
                    const trial: Array<StackedFloat> = [...placed, candidate];
                    if (placed.length > 0 && !this.floatStack.arrange(trial, columns.width, height).fits) {
                        waiting.push([anchor, index + 1]);
                        continue;
                    }
                    const again: BoxFragment = this.columnPiece(content, columns, height, kinds, begin, trial);
                    const held: Array<ElementBox> = this.anchorsIn(again, true, []);
                    if ([...own, anchor].every((box: ElementBox) => held.includes(box))) {
                        placed = trial;
                        fragment = again;
                        own.push(anchor);
                    } else {
                        waiting.push([anchor, index + 1]);
                    }
                }
                const columnStart: number = columns.lead + index * (columns.width + columns.gap + columns.spread);
                fragment.inline += columnStart;
                fragments.push(fragment);
                for (const float of placed) {
                    float.fragment.inline += columnStart;
                    floats.push(float.fragment);
                }
                current = fragment.token;
                if (current !== undefined && current.forced !== undefined && current.forced !== "column") {
                    break;
                }
                if (current === undefined) {
                    if (waiting.length === 0) {
                        break;
                    }
                    // §8: "If the fragmentation context allows for the addition of another fragmentation container", the floats left when the
                    // content ends get it: the next column, or the next fragmentainer, which the content goes on to with nothing left of it.
                    current = this.token(content, content.children.length, content.inline?.length ?? 0, undefined, undefined, undefined);
                }
            }
        } finally {
            this.columnDepth--;
        }
        let extent: number = 0;
        for (const fragment of fragments) {
            extent = Math.max(extent, fragment.block + this.contentEnd(fragment));
        }
        for (const float of floats) {
            extent = Math.max(extent, float.block + float.blockSize + (float.marginAfter === undefined ? 0 : float.marginAfter[0] + float.marginAfter[1]));
        }
        const set: ColumnSet = { fragments, floats, extent, height: extent };
        if (current !== undefined) {
            if (waiting.length > 0) {
                current.floats = waiting.map((entry: readonly [ElementBox, number]): readonly [ElementBox, number] => [entry[0], Math.max(0, entry[1] - columns.count)]);
            }
            set.token = current;
        }
        return set;
    }

    private contentEnd(fragment: BoxFragment): number {
        // CSS Fragmentation 4 §5.3: a box that breaks "extends to fill any remaining fragmentainer extent", and CSS Multicol 1 §2 shortens
        // balanced columns "to fit their content", so a column that breaks ends where its content does, and one whose content ended where it is.
        if (fragment.token === undefined || fragment.token.ended === true) {
            return fragment.blockSize;
        }
        let end: number = 0;
        for (const child of fragment.children ?? []) {
            end = Math.max(end, child.block + child.blockSize);
        }
        return this.side(BoxSizes.BLOCK_START, fragment.border) + this.side(BoxSizes.BLOCK_START, fragment.padding) + end;
    }

    private columnPiece(content: ElementBox, columns: Columns, height: number, kinds: ReadonlyArray<string>, begin: BreakToken | undefined,
        placed: ReadonlyArray<StackedFloat>): BoxFragment {
        // CSS Page Floats 3 §3.2: the content of a column flows on the block-end side of a block-start float, on the line-end side of an
        // inline-start one, and so on.
        const area: FloatArea = this.floatStack.arrange(placed, columns.width, height);
        const extent: number = Math.max(MINIMUM_FRAGMENTAINER, area.blockSize);
        const outer: Array<Overflow> = this.overflows;
        this.overflows = [];
        const fragment: BoxFragment = this.fragmented(kinds, extent, area.inlineSize, begin,
            (): BoxFragment => this.block(content, area.inlineSize, true, 0, 0, extent, undefined, 0, extent, begin, false));
        fragment.inline = area.inlineStart;
        fragment.block = area.blockStart;
        this.carryIn(fragment, begin, kinds, extent);
        this.carryOut(fragment);
        this.overflows = outer;
        return fragment;
    }

    anchorsIn(fragment: BoxFragment, column: boolean, found: Array<ElementBox>): Array<ElementBox> {
        // The page floats whose anchors the fragment holds, column floats or page floats, in the order of their places; the anchors in the
        // columns of a multi-column container inside are the columns of that container.
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                if (piece.box.placement === "page-float") {
                    if ((this.keyword(piece.box.style.values["float-reference"]) === "column") === column && !found.includes(piece.box)) {
                        found.push(piece.box);
                    }
                } else if (!column || this.columnsOf(piece.box, piece.inlineSize) === undefined) {
                    this.anchorsIn(piece, column, found);
                }
            }
        }
        return found;
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
            this.truncate(this.floats, mark[1], mark[2]);
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
        const candidate: Candidate = { appeal, path: fragmenting.path.map((step: [ElementBox, number]): readonly [ElementBox, number] => [step[0], step[1]]) };
        if (line !== undefined) {
            candidate.line = line;
        }
        return this.keep(fragmenting, candidate);
    }

    private tokenCandidate(path: Array<readonly [ElementBox, number]>, token: BreakToken | undefined, appeal: number): Candidate | undefined {
        // The break that a token stands for, as a break point: the child of each box where it falls, and its place in the text of the last one.
        let line: readonly [number, number] | undefined;
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            path.push([level.box, level.child]);
            const text: InlineText | undefined = level.line === undefined ? undefined : level.box.inline?.[level.sequence]?.text;
            line = text === undefined || level.line === undefined ? undefined : this.spot(text, level.line);
        }
        if (path.length === 0) {
            return undefined;
        }
        return line === undefined ? { appeal, path } : { appeal, path, line };
    }

    private keep(fragmenting: Fragmentation, candidate: Candidate): Candidate {
        // CSS Fragmentation 4 §4.5: among the break points that the rules allow equally, the latest one leaves the fewest
        // breaks and the fullest fragmentainers.
        if (fragmenting.best === undefined || candidate.appeal >= fragmenting.best.appeal) {
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
        if (token === undefined || this.forcedIn(token)) {
            return APPEAL_PERFECT;
        }
        return this.flowAppeal;
    }

    private forcedIn(token: BreakToken): boolean {
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            if (level.forced !== undefined) {
                return true;
            }
        }
        return false;
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
        let columns: boolean = false;
        while (current !== undefined) {
            // "This propagation stops before it breaks through the nearest matching fragmentation context": a column break stays in the
            // multi-column container it is in, and always is a break of that container's columns (§3.1); a page break goes on.
            const keyword: string = this.keyword(current.style.values[property]);
            if (keyword !== "none" && keyword !== "auto" && !(columns && COLUMN_BREAKS.has(keyword))) {
                values.push(keyword);
            }
            columns = columns || this.isMulticol(current);
            current = this.propagates(current) ? this.edgeChild(current, first) : undefined;
        }
        return first ? values : values.reverse();
    }

    private propagates(box: ElementBox): boolean {
        // Flex and grid layout have their own rules, and a table row holds parallel flows.
        if (this.tables.isGrid(box) || this.tables.isRowGroup(box)) {
            return true;
        }
        return !box.replaced && this.displays.isBlockContainer(box.display) && box.display.internal === undefined;
    }

    private isMulticol(box: ElementBox): boolean {
        // CSS Multicol 1 §2: "An element whose column-width or column-count property is not auto establishes a multi-column container",
        // and column-width and column-count apply to "block containers except table wrapper boxes" (§3.1, §3.2).
        const count: CssValue | undefined = box.style.values["column-count"];
        const width: CssValue | undefined = box.style.values["column-width"];
        return !box.replaced && box.display.internal === undefined && this.displays.isBlockContainer(box.display) && !this.tables.isWrapper(box)
            && ((count !== undefined && count.kind !== "ident") || (width !== undefined && width.kind !== "ident"));
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
            if (this.isInlineFloat(node)) {
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
                // CSS Inline 3 §7.9.4: an initial letter is monolithic and "breaks between the in-flow lines alongside an initial letter
                // box are avoided, much as breaks between line boxes affected be widows and orphans are avoided".
                let letterEnd: number = Number.NEGATIVE_INFINITY;
                for (let earlier: number = 0; earlier < index; earlier++) {
                    const letter: ObjectArea | undefined = lines[earlier].initial;
                    letterEnd = letter === undefined ? letterEnd : Math.max(letterEnd, lines[earlier].block + letter[1] + letter[3]);
                }
                const alongside: boolean = line.block < letterEnd - TOLERANCE;
                local = this.record(fragmenting, fragmenting.avoid > 0 || alongside ? Math.min(appeal, APPEAL_AVOID) : appeal, place);
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
        // GCPM 3 §2.8: line puts "a forced page break at the start of the line containing the footnote reference", where the user agent
        // "must honor widow and orphan settings", so maybe earlier; block puts it "before the paragraph that contains the footnote".
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

    private keepsBreak(box: ElementBox): boolean {
        // CSS Text 4 §6.3.5: always, column and page apply to a page break, since a column is not fragmented; spread applies to the
        // break after the page that ends a spread, which is the recto page.
        const limit: string = this.keyword(box.style.values["hyphenate-limit-last"]);
        return limit === "always" || limit === "column" || limit === "page" || (limit === "spread" && this.endsSpread);
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
        // them from the page where they would have been, so they leave an empty fragment there; CSS Page Floats 3 §2: so does the
        // float anchor of a page float.
        return { kind: "box", box, inline: 0, block, inlineSize: 0, blockSize: 0 };
    }

    placeholder(box: ElementBox): BoxFragment {
        const fragment: BoxFragment = { kind: "box", box, inline: 0, block: 0, inlineSize: 0, blockSize: 0 };
        this.pending = this.pending ?? new Set<BoxFragment>();
        this.pending.add(fragment);
        return fragment;
    }

    initialContainer(fragment: BoxFragment): void {
        // A formula is drawn as an image laid out by itself, so its box is the initial containing block of the positioned boxes in it, the
        // fixed ones too, as the root box of a document is.
        this.positioned(fragment, true);
    }

    usesStaticFixed(root: ElementBox): boolean {
        // CSS 2 §10.3.7 and §10.6.4: a box with both insets of an axis auto is placed at its static position, which a fixed box keeps on the
        // pages that come before its element, so a layout before the painted one finds it.
        const frame: number = this.sizes.frame(root.style);
        const unset: (box: ElementBox, start: number, end: number) => boolean = (box: ElementBox, start: number, end: number): boolean =>
            this.sizes.inset(box.style, start, 0, frame) === undefined && this.sizes.inset(box.style, end, 0, frame) === undefined;
        return this.fixedBoxes(root).some((box: ElementBox) => unset(box, BoxSizes.INLINE_START, BoxSizes.INLINE_END) || unset(box, BoxSizes.BLOCK_START, BoxSizes.BLOCK_END));
    }

    startFixed(): void {
        // Each layout finds the static positions again, and until it does those of the layout before stand.
        for (const [box, place] of this.fixedStatic) {
            this.fixedKnown.set(box, place);
        }
        this.fixedStatic.clear();
    }

    fixedPage(root: ElementBox, fragments: ReadonlyArray<BoxFragment>, inlineSize: number, blockSize: number, first: boolean): BoxFragment | undefined {
        // CSS Position 3 §3.1: "In paged media, the initial fixed containing block is the page area of each page; fixed positioned boxes are thus
        // replicated on every page"; CSS 2 §10.3.7: their static position is a guess, here the place their element has on its first page.
        const frame: number = this.sizes.frame(root.style);
        const boxes: ReadonlyArray<ElementBox> = this.fixedBoxes(root);
        let spare: BoxFragment | undefined;
        if (boxes.length > 0) {
            for (const fragment of fragments) {
                if (fragment.children !== undefined) {
                    this.staticPlaces(fragment.children, this.sizes.inside(fragment, frame), this.sizes.frame(fragment.box.style));
                }
            }
            const container: BoxFragment = { kind: "box", box: root, inline: 0, block: 0, inlineSize, blockSize, children: [...fragments] };
            const outerFrame: number = this.frame;
            const outerSign: number = this.sign;
            const outerFlow: boolean = this.pageFlow;
            this.frame = frame;
            this.sign = 1;
            // CSS Page Floats 3 §3.1: a fixed box is outside the pages that the document flows through, so its page floats float in a line box.
            this.pageFlow = false;
            try {
                for (const box of boxes) {
                    const place: readonly [number, number, number, number, number] = this.fixedStatic.get(box) ?? this.fixedKnown.get(box) ?? [0, 0, 0, 0, frame];
                    const copy: BoxFragment = { kind: "box", box, inline: place[0], block: place[1], inlineSize: place[2], blockSize: place[3] };
                    const path: ReadonlyArray<ElementBox> | undefined = this.fixedPaths.get(box);
                    this.absolute(copy, BoxSizes.IDENTITY, inlineSize, blockSize, container, BoxSizes.IDENTITY, place[4], true, path?.[path.length - 2]);
                    if (copy.children !== undefined) {
                        this.staticPlaces(copy.children, this.sizes.inside(copy, frame), this.sizes.frame(box.style));
                    }
                    if (!first) {
                        // CSS Content 3 §3: a link to an element goes to its first box, which is the copy on the first page.
                        this.resume(copy);
                    }
                    spare = this.holdFixed(root, copy, fragments, spare);
                }
            } finally {
                this.frame = outerFrame;
                this.sign = outerSign;
                this.pageFlow = outerFlow;
            }
        }
        // The placeholders of the layouts that the pages did not keep wait for nothing.
        for (const placeholder of this.pending ?? []) {
            if (placeholder.box.placement === "fixed") {
                this.pending?.delete(placeholder);
            }
        }
        return spare;
    }

    private fixedBoxes(root: ElementBox): ReadonlyArray<ElementBox> {
        // CSS Position 3 §3.1: a fixed box takes the page area unless an ancestor establishes its containing block, and a box laid out as an
        // image has its own.
        if (this.fixedRoot !== root) {
            const found: Array<ElementBox> = [];
            this.fixedPaths.clear();
            this.boxOrder.clear();
            if (!this.fixedContainer(root)) {
                this.findFixed(root, found, [root]);
            }
            if (found.length > 0) {
                this.numberBoxes(root);
            }
            this.fixedRoot = root;
            this.fixedList = found;
        }
        return this.fixedList;
    }

    private numberBoxes(box: ElementBox): void {
        // The boxes in document order, which the copies of the fixed boxes keep among the boxes they go into (CSS 2 Appendix E.2).
        this.boxOrder.set(box, this.boxOrder.size);
        for (const child of box.children) {
            if (child.kind === "box") {
                this.numberBoxes(child);
            }
        }
    }

    registerCopy(copy: ElementBox, original: ElementBox): void {
        // A layout that lays out a copy of a box, as the footnote area does, keeps the box it stands for.
        this.copyOrigins.set(copy, original);
    }

    private originOf(box: ElementBox): ElementBox {
        return this.copyOrigins.get(box) ?? box;
    }

    fixedFootnotes(root: ElementBox): ReadonlyArray<ElementBox> {
        // GCPM 3 §2.2: a footnote body goes to the page of its call, and a call in a fixed box is first on the first page (CSS Content 3 §3).
        const found: Array<ElementBox> = [];
        const walk: (box: ElementBox) => void = (box: ElementBox): void => {
            for (const child of box.children) {
                if (child.kind !== "box") {
                    continue;
                }
                if (child.placement === "footnote" && !found.includes(child)) {
                    found.push(child);
                } else if (child.placement !== "fixed" && !child.replaced) {
                    walk(child);
                }
            }
        };
        for (const box of this.fixedBoxes(root)) {
            walk(box);
        }
        return found;
    }

    private pageAbsolutes(fragment: BoxFragment, origin: readonly [number, number]): void {
        // The children of the root box are placed in the page area from the place the page floats leave the root at.
        if (this.pending === undefined || this.pending.size === 0 || fragment.children === undefined) {
            return;
        }
        const area: readonly [number, number] = this.pageArea;
        const container: BoxFragment = { kind: "box", box: fragment.box, inline: 0, block: 0, inlineSize: area[0], blockSize: area[1], children: fragment.children };
        const transform: Transform = this.sizes.compose([1, 0, 0, 1, origin[0], origin[1]], this.sizes.inside(fragment, this.frame));
        // The page area of each page is a containing block of its own, so its boxes are placed at once, and what goes past its end goes on in the next page.
        this.placeAlone({ fragment: container, content: fragment, base: transform, room: area[1] }, false, true);
    }

    private runningPlace(box: ElementBox, place: readonly [number, number], frame: number): void {
        // CSS 2 §10.3.7 leaves the static position to a guess: a fixed box in a running element, which a page-margin box shows, takes the
        // place where the running element would have been in the flow.
        for (const fixed of this.fixedList) {
            if (!this.fixedStatic.has(fixed) && this.fixedPaths.get(fixed)?.includes(box) === true) {
                this.fixedStatic.set(fixed, [place[0], place[1], 0, 0, frame]);
            }
        }
    }

    private insertInOrder(children: Array<BoxFragment | LineFragment>, fragment: BoxFragment): void {
        // CSS 2 Appendix E.2 paints positioned boxes of one level in tree order, so the fragment goes before the first child that comes later.
        const order: number | undefined = this.boxOrder.get(fragment.box);
        const at: number = order === undefined ? -1 : children.findIndex((child: BoxFragment | LineFragment) => (this.firstOrder(child) ?? -1) > order);
        if (at < 0) {
            children.push(fragment);
        } else {
            children.splice(at, 0, fragment);
        }
    }

    private firstOrder(fragment: BoxFragment | LineFragment): number | undefined {
        // The place in document order of the first box of the document that a fragment holds.
        if (fragment.kind === "box") {
            const own: number | undefined = this.boxOrder.get(this.originOf(fragment.box));
            if (own !== undefined) {
                return own;
            }
        }
        for (const child of fragment.kind === "line" ? fragment.pieces : fragment.children ?? []) {
            const order: number | undefined = child.kind === "text" ? undefined : this.firstOrder(child);
            if (order !== undefined) {
                return order;
            }
        }
        return undefined;
    }

    private findFixed(box: ElementBox, found: Array<ElementBox>, path: Array<ElementBox>): void {
        for (const child of box.children) {
            if (child.kind !== "box") {
                continue;
            }
            if (child.placement === "fixed") {
                found.push(child);
                this.fixedPaths.set(child, [...path, child]);
            }
            if (!child.replaced && !this.fixedContainer(child)) {
                path.push(child);
                this.findFixed(child, found, path);
                path.pop();
            }
        }
    }

    private staticPlaces(children: Array<BoxFragment | LineFragment>, transform: Transform | undefined, frame: number): void {
        // The placeholders of the fixed boxes give their static positions in the page area, and leave the boxes they are in, whose places the
        // copies take; boxes outside the page area, as those of the page-margin boxes, have no transform and give none.
        for (let index: number = children.length - 1; index >= 0; index--) {
            const child: BoxFragment | LineFragment = children[index];
            if (child.kind === "box") {
                if (this.fixedPlaceholder(child, transform, frame)) {
                    children.splice(index, 1);
                } else if (child.box.placement === "running" && transform !== undefined) {
                    this.runningPlace(child.box, this.sizes.apply(transform, child.inline, child.block), frame);
                } else if (child.children !== undefined) {
                    this.staticPlaces(child.children, transform === undefined ? undefined : this.sizes.compose(transform, this.sizes.inside(child, frame)),
                        this.sizes.frame(child.box.style));
                }
                continue;
            }
            const line: Transform | undefined = transform === undefined ? undefined : this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]);
            for (let at: number = child.pieces.length - 1; at >= 0; at--) {
                const piece: TextPiece | BoxFragment = child.pieces[at];
                if (piece.kind !== "box") {
                    continue;
                }
                if (this.fixedPlaceholder(piece, line, frame)) {
                    child.pieces.splice(at, 1);
                } else if (piece.box.placement === "running" && line !== undefined) {
                    this.runningPlace(piece.box, this.sizes.apply(line, piece.inline, piece.block), frame);
                } else if (piece.children !== undefined) {
                    this.staticPlaces(piece.children, line === undefined ? undefined : this.sizes.compose(line, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style));
                }
            }
        }
    }

    private fixedPlaceholder(fragment: BoxFragment, transform: Transform | undefined, frame: number): boolean {
        if (fragment.box.placement !== "fixed" || this.pending === undefined || !this.pending.has(fragment)) {
            return false;
        }
        this.pending.delete(fragment);
        if (transform !== undefined && !this.fixedStatic.has(fragment.box)) {
            // CSS Position 3 §3.5.2: the static-position rectangle keeps the writing mode of the static-position containing block, which aligns it.
            this.fixedStatic.set(fragment.box, [...this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize), frame]);
        }
        return true;
    }

    private resume(fragment: BoxFragment): void {
        fragment.resumed = true;
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind === "box") {
                    this.resume(piece);
                }
            }
        }
    }

    private holdFixed(root: ElementBox, copy: BoxFragment, fragments: ReadonlyArray<BoxFragment>, spare: BoxFragment | undefined): BoxFragment | undefined {
        // A copy goes into its nearest ancestor on the page, and a page without its ancestors has an empty box of the root (CSS Fragmentation 4 §5.5).
        const path: ReadonlyArray<ElementBox> = this.fixedPaths.get(copy.box) ?? [root, copy.box];
        const frame: number = this.sizes.frame(root.style);
        const found: Holder = this.holderIn(path, fragments, BoxSizes.IDENTITY, frame);
        let kept: BoxFragment | undefined = spare;
        if (found.fragment === undefined) {
            kept = kept ?? { kind: "box", box: root, inline: 0, block: 0, inlineSize: 0, blockSize: 0, resumed: true };
            found.fragment = kept;
            found.transform = this.sizes.inside(kept, frame);
            found.depth = 0;
        }
        this.lodge(path, copy, found);
        return kept;
    }

    private holderIn(path: ReadonlyArray<ElementBox>, fragments: ReadonlyArray<BoxFragment>, transform: Transform, frame: number): Holder {
        // The deepest ancestor of the last box of the path that has a fragment among these, with the map from that fragment's content to the
        // coordinates the fragments are placed in.
        const depths: Map<ElementBox, number> = new Map<ElementBox, number>();
        for (let depth: number = 0; depth < path.length - 1; depth++) {
            depths.set(path[depth], depth);
        }
        const found: Holder = { transform: BoxSizes.IDENTITY, frame, depth: -1 };
        for (const fragment of fragments) {
            this.holderOf(fragment, transform, frame, depths, found);
        }
        return found;
    }

    private lodge(path: ReadonlyArray<ElementBox>, piece: BoxFragment, found: Holder): () => void {
        // The piece goes into the holder through empty boxes (CSS Fragmentation 4 §5.5) of the ancestors between that make a stacking context
        // or a group, so that it is painted with them; its rectangle is given in the coordinates the holder's transform leads to.
        this.ordered();
        let held: BoxFragment = found.fragment as BoxFragment;
        let transform: Transform = found.transform;
        let inner: number = found.frame;
        const added: Array<readonly [Array<BoxFragment | LineFragment>, BoxFragment]> = [];
        for (let depth: number = found.depth + 1; depth < path.length - 1; depth++) {
            const between: ElementBox = path[depth];
            if (!this.stacksApart(between)) {
                continue;
            }
            const children: Array<BoxFragment | LineFragment> = held.children ?? [];
            held.children = children;
            let empty: BoxFragment | undefined = children.find((child: BoxFragment | LineFragment): child is BoxFragment => child.kind === "box" && child.box === between
                && child.resumed === true && child.inlineSize === 0 && child.blockSize === 0);
            if (empty === undefined) {
                empty = { kind: "box", box: between, inline: 0, block: 0, inlineSize: 0, blockSize: 0, resumed: true };
                this.insertInOrder(children, empty);
                added.push([children, empty]);
            }
            transform = this.sizes.compose(transform, this.sizes.inside(empty, inner));
            inner = this.sizes.frame(between.style);
            held = empty;
        }
        const rectangle: readonly [number, number, number, number] = this.sizes.mapped(this.sizes.inverse(transform), piece.inline, piece.block, piece.inlineSize, piece.blockSize);
        piece.inline = rectangle[0];
        piece.block = rectangle[1];
        piece.inlineSize = rectangle[2];
        piece.blockSize = rectangle[3];
        const holding: Array<BoxFragment | LineFragment> = held.children ?? [];
        held.children = holding;
        this.insertInOrder(holding, piece);
        added.push([holding, piece]);
        return (): void => {
            for (let index: number = added.length - 1; index >= 0; index--) {
                const [list, fragment]: readonly [Array<BoxFragment | LineFragment>, BoxFragment] = added[index];
                const at: number = list.indexOf(fragment);
                // An empty box that holds the piece of another box stays.
                if (at >= 0 && (fragment === piece || (fragment.children?.length ?? 0) === 0)) {
                    list.splice(at, 1);
                }
            }
        };
    }

    private ordered(): void {
        // CSS 2 Appendix E.2: a box that goes in among others keeps its place in document order, for which the boxes are numbered once.
        if (this.rootBox !== undefined && !this.boxOrder.has(this.rootBox)) {
            this.numberBoxes(this.rootBox);
        }
    }

    private locate(fragment: BoxFragment, target: BoxFragment, transform: Transform, frame: number): Transform | undefined {
        // The map from the content of the target fragment to the coordinates the first fragment is placed in, when the target is inside it.
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        if (fragment === target) {
            return inner;
        }
        const own: number = this.sizes.frame(fragment.box.style);
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                const found: Transform | undefined = this.locate(child, target, inner, own);
                if (found !== undefined) {
                    return found;
                }
                continue;
            }
            const line: Transform = this.sizes.compose(inner, [1, 0, 0, 1, child.inline ?? 0, child.block]);
            for (const piece of child.pieces) {
                const found: Transform | undefined = piece.kind === "box" ? this.locate(piece, target, line, own) : undefined;
                if (found !== undefined) {
                    return found;
                }
            }
        }
        return undefined;
    }

    private holderOf(fragment: BoxFragment, transform: Transform, frame: number, depths: ReadonlyMap<ElementBox, number>, found: Holder): void {
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const own: number = this.sizes.frame(fragment.box.style);
        const depth: number | undefined = depths.get(this.originOf(fragment.box));
        if (depth !== undefined && depth > found.depth) {
            found.fragment = fragment;
            found.transform = inner;
            found.frame = own;
            found.depth = depth;
        }
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.holderOf(child, inner, own, depths, found);
                continue;
            }
            const line: Transform = this.sizes.compose(inner, [1, 0, 0, 1, child.inline ?? 0, child.block]);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    this.holderOf(piece, line, own, depths, found);
                }
            }
        }
    }

    private stacksApart(box: ElementBox): boolean {
        // CSS 2 §9.9.1 and CSS Position 3 §2: a positioned box with an integer z-index, and a fixed or sticky one, makes a stacking context; Compositing 1
        // §3.1: opacity, a blend mode and isolation make a group; CSS Masking 1 §5.1, §7.1, §8.1, CSS Containment 2 §3.2, §3.4 and CSS Will Change 1 §2 add theirs.
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        const masked: boolean = ["clip-path", "mask-image", "mask-border-source"].some((property: string) => {
            const value: CssValue | undefined = values[property];
            return value !== undefined && (value.kind === "list" ? value.items : [value]).some((item: CssValue) => !(item.kind === "ident" && item.lower === "none"));
        });
        const position: string = this.keyword(values["position"]);
        const positioned: boolean = position !== "none" && position !== "static";
        const z: CssValue | undefined = values["z-index"];
        const opacity: CssValue | undefined = values["opacity"];
        const alpha: number = opacity === undefined ? 1 : (opacity.kind === "number" ? opacity.value : (opacity.kind === "percentage" ? opacity.value / 100 : 1));
        const blend: string = this.keyword(values["mix-blend-mode"]);
        return (positioned && z !== undefined && z.kind === "number") || position === "fixed" || position === "sticky" || alpha < 1 || (blend !== "none" && blend !== "normal") || masked
            || this.keyword(values["isolation"]) === "isolate" || (this.containment(box) & CONTAINING_BLOCK) !== 0
            || this.displays.changesStacking(values, box.display, box.replaced, positioned);
    }

    private inlineContainers(fragment: BoxFragment, fragmenting: boolean, incoming: BreakToken | undefined, space: number | undefined): void {
        // CSS Position 3 §2.1: an inline box that establishes the containing block forms it, "using the writing mode of that box", "from the start-most
        // content edges (in both axes) of the first box fragment of the ancestor, and the end-most content edges of the end-most box fragment(s)";
        // CSS Fragmentation 4 §5.5: across the fragments of the block that holds its lines, which are joined as for a block containing block.
        const box: ElementBox = fragment.box;
        const known: InlineChain | undefined = this.inlineChains.get(box);
        const breaks: boolean = fragmenting && (fragment.token !== undefined || incoming !== undefined);
        // A block that breaks keeps all its fragments, since an inline box can start in one before its positioned boxes come.
        if (!breaks && known === undefined && (this.pending === undefined || this.pending.size === 0 || fragment.children === undefined)) {
            return;
        }
        const at: number = known === undefined || incoming === undefined || !breaks ? -1 : known.parts.findIndex((part: ChainPart) => part.fragment.token === incoming);
        for (const holder of known?.holders.values() ?? []) {
            this.unplace(holder.chain);
        }
        this.inlineChains.delete(box);
        let inline: InlineChain = { parts: [], holders: new Map<SourceElement, InlineHolder>() };
        if (known !== undefined && at >= 0) {
            // A fragmentainer laid out again replaces what its earlier layout gave.
            inline = known;
            inline.parts.length = at + 1;
            for (const [element, holder] of inline.holders) {
                holder.pieces = holder.pieces.filter((piece: readonly [readonly [number, number, number, number], number, number]) => piece[1] <= at);
                holder.chain.waiting = holder.chain.waiting.filter((entry: Waiting) => entry.part <= at);
                holder.chain.done = false;
                if (holder.pieces.length === 0) {
                    inline.holders.delete(element);
                }
            }
        }
        const frame: number = this.sizes.frame(box.style);
        const part: number = inline.parts.length;
        const base: Transform = this.paddingBase(fragment);
        inline.parts.push({ fragment, content: fragment, base, room: space === undefined || !fragmenting ? Number.POSITIVE_INFINITY : space });
        const found: Map<SourceElement, Array<readonly [BoxFragment, readonly [number, number, number, number], number]>> =
            new Map<SourceElement, Array<readonly [BoxFragment, readonly [number, number, number, number], number]>>();
        this.inlineFragments(fragment.children ?? [], BoxSizes.IDENTITY, frame, found, { count: 0 });
        for (const [element, pieces] of found) {
            let holder: InlineHolder | undefined = inline.holders.get(element);
            if (holder === undefined) {
                holder = { box: pieces[0][0].box, pieces: [], chain: { parts: inline.parts, waiting: [], placed: [], initial: false, done: false } };
                inline.holders.set(element, holder);
            }
            for (const piece of pieces) {
                holder.pieces.push([piece[1], part, piece[2]]);
            }
        }
        // The boxes inside another inline box take their boxes first, since the containing block is the nearest one.
        const elements: Array<SourceElement> = [...inline.holders.keys()].sort((first: SourceElement, second: SourceElement) => this.elementDepth(second) - this.elementDepth(first));
        for (const element of elements) {
            const holder: InlineHolder = inline.holders.get(element) as InlineHolder;
            if (fragment.children !== undefined) {
                this.gatherWaiting(fragment.children, base, frame, this.fixedContainer(holder.box), holder.chain, part, [this.originOf(box)], element);
            }
        }
        if (fragment.token !== undefined && breaks) {
            this.inlineChains.set(box, inline);
            return;
        }
        if (inline.holders.size === 0) {
            return;
        }
        // The fragments are joined in the block flow direction, each at the offset of its padding box in the joined box.
        const offsets: Array<number> = [];
        let total: number = 0;
        for (const joined of inline.parts) {
            offsets.push(total);
            total += joined.fragment.blockSize - this.side(BoxSizes.BLOCK_START, joined.fragment.border) - this.side(BoxSizes.BLOCK_END, joined.fragment.border);
        }
        for (const element of elements) {
            const holder: InlineHolder = inline.holders.get(element) as InlineHolder;
            holder.chain.area = { rectangle: this.inlineArea(holder, inline.parts, offsets, frame), box: holder.box };
            if (holder.chain.waiting.length > 0) {
                this.placeChain(holder.chain);
            }
            holder.chain.done = true;
        }
        if (inline.parts.length > 1) {
            this.inlineChains.set(box, inline);
        }
    }

    private inlineArea(holder: InlineHolder, parts: ReadonlyArray<ChainPart>, offsets: ReadonlyArray<number>, frame: number): readonly [number, number, number, number] {
        // The content boxes of the fragments, in the joined padding box; the first fragment is on the first line, the start-most there: "If there are
        // multiple fragments on the same line", "take the start-most fragment as the first fragment."
        const forward: boolean = ((this.sizes.frame(holder.box.style) ^ frame) & BoxSizes.INLINE_REVERSED) === 0;
        const areas: Array<readonly [number, number, number, number]> = [];
        let first: number = 0;
        for (const [index, piece] of holder.pieces.entries()) {
            const own: ChainPart = parts[piece[1]];
            const area: readonly [number, number, number, number] = [piece[0][0] + own.base[4], piece[0][1] + own.base[5] + offsets[piece[1]], piece[0][2], piece[0][3]];
            areas.push(area);
            const lead: readonly [readonly [number, number, number, number], number, number] = holder.pieces[first];
            const earlier: boolean = piece[1] < lead[1] || (piece[1] === lead[1] && piece[2] < lead[2]);
            const sameLine: boolean = piece[1] === lead[1] && piece[2] === lead[2];
            if (earlier || (sameLine && (forward ? area[0] < areas[first][0] : area[0] + area[2] > areas[first][0] + areas[first][2]))) {
                first = index;
            }
        }
        const start: readonly [number, number, number, number] = areas[first];
        let inlineEnd: number = forward ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
        let blockEnd: number = Number.NEGATIVE_INFINITY;
        for (const area of areas) {
            inlineEnd = forward ? Math.max(inlineEnd, area[0] + area[2]) : Math.min(inlineEnd, area[0]);
            blockEnd = Math.max(blockEnd, area[1] + area[3]);
        }
        // An end edge before the start edge leaves the rectangle empty there.
        const low: number = forward ? start[0] : Math.min(inlineEnd, start[0] + start[2]);
        const high: number = forward ? Math.max(inlineEnd, start[0]) : start[0] + start[2];
        return [low, start[1], high - low, Math.max(0, blockEnd - start[1])];
    }

    private inlineFragments(children: ReadonlyArray<BoxFragment | LineFragment>, transform: Transform, frame: number,
        found: Map<SourceElement, Array<readonly [BoxFragment, readonly [number, number, number, number], number]>>, lines: { count: number }): void {
        // The content boxes of the fragments of the inline boxes that are containing blocks, in the lines of the block and of the anonymous
        // blocks that its inline content was split into (CSS 2 §9.2.1.1), with the line each is on.
        for (const child of children) {
            if (child.kind === "box") {
                if (child.box.element === undefined && child.box.pseudoElement === undefined && child.children !== undefined && !this.isIndependent(child.box)) {
                    this.inlineFragments(child.children, this.sizes.compose(transform, this.sizes.inside(child, frame)), this.sizes.frame(child.box.style), found, lines);
                }
                continue;
            }
            lines.count++;
            const line: Transform = this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]);
            for (const piece of child.pieces) {
                const element: SourceElement | undefined = piece.kind === "box" && piece.box.pseudoElement === undefined ? piece.box.element : undefined;
                if (piece.kind !== "box" || element === undefined || piece.box.replaced || !this.displays.isInlineBox(piece.box.display)
                    || (!this.absoluteContainer(piece.box) && !this.fixedContainer(piece.box))) {
                    continue;
                }
                // The fragment's edges are on the sides of the box's own writing mode.
                const own: number = this.sizes.frame(piece.box.style);
                const edge: (side: number) => number = (side: number): number => {
                    const ownSide: number = this.sizes.side(frame, own, side);
                    return this.side(ownSide, piece.border) + this.side(ownSide, piece.padding);
                };
                const area: readonly [number, number, number, number] = this.sizes.mapped(line, piece.inline, piece.block, piece.inlineSize, piece.blockSize);
                const content: readonly [number, number, number, number] = [area[0] + edge(BoxSizes.INLINE_START), area[1] + edge(BoxSizes.BLOCK_START),
                    Math.max(0, area[2] - edge(BoxSizes.INLINE_START) - edge(BoxSizes.INLINE_END)), Math.max(0, area[3] - edge(BoxSizes.BLOCK_START) - edge(BoxSizes.BLOCK_END))];
                const known: Array<readonly [BoxFragment, readonly [number, number, number, number], number]> | undefined = found.get(element);
                if (known === undefined) {
                    found.set(element, [[piece, content, lines.count]]);
                } else {
                    known.push([piece, content, lines.count]);
                }
            }
        }
    }

    private descends(box: ElementBox, ancestor: SourceElement): boolean {
        // A pseudo-element of the ancestor is inside it, and an element is when the ancestor is one of its parents.
        for (let element: SourceElement | undefined = box.element; element !== undefined; element = element.getParent()) {
            if (element === ancestor) {
                return element !== box.element || box.pseudoElement !== undefined;
            }
        }
        return false;
    }

    private elementDepth(element: SourceElement): number {
        let depth: number = 0;
        for (let parent: SourceElement | undefined = element.getParent(); parent !== undefined; parent = parent.getParent()) {
            depth++;
        }
        return depth;
    }

    private positioned(container: BoxFragment, all: boolean): void {
        // CSS 2 §10.1: the containing block of an absolutely positioned box is "formed by the padding edge of the ancestor"
        // that is positioned, and the initial containing block when there is none, as for a fixed one.
        if (this.pending === undefined || this.pending.size === 0 || container.children === undefined) {
            return;
        }
        const inlineSize: number = container.inlineSize - this.side(BoxSizes.INLINE_START, container.border) - this.side(BoxSizes.INLINE_END, container.border);
        const blockSize: number = container.blockSize - this.side(BoxSizes.BLOCK_START, container.border) - this.side(BoxSizes.BLOCK_END, container.border);
        const base: Transform = [1, 0, 0, 1, this.side(BoxSizes.INLINE_START, container.padding), this.side(BoxSizes.BLOCK_START, container.padding)];
        this.absolutes(container.children, base, this.sizes.frame(container.box.style), inlineSize, blockSize, all, container, base, false, container.box);
    }

    private absolutes(children: ReadonlyArray<BoxFragment | LineFragment>, transform: Transform, frame: number, inlineSize: number, blockSize: number, all: boolean,
        container: BoxFragment, base: Transform, initial: boolean, parent: ElementBox): void {
        // The transform takes a point of these children's container, the parent box, to the containing block, across the writing modes between,
        // and the base takes a point of the containing block's own children there.
        for (const child of children) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                const local: Transform = child.kind === "line" ? this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]) : transform;
                if (this.pending !== undefined && this.pending.has(piece)) {
                    if (all || piece.box.placement === "absolute") {
                        this.pending.delete(piece);
                        this.absolute(piece, local, inlineSize, blockSize, container, base, frame, initial, parent);
                    }
                } else if (piece.children !== undefined) {
                    this.absolutes(piece.children, this.sizes.compose(local, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style), inlineSize, blockSize, all,
                        container, base, initial, piece.box);
                }
            }
        }
    }

    private absolute(target: BoxFragment, local: Transform, containerInline: number, containerBlock: number, container: BoxFragment, base: Transform, staticFrame: number,
        initial: boolean, parent: ElementBox | undefined): AbsolutePlace {
        // CSS Anchor Positioning 1 §6.5: a box that overflows its inset-modified containing block with its base styles takes the first position
        // option that does not, in the order of position-try-order, and keeps its base styles when none does.
        const box: ElementBox = target.box;
        const setting: AbsoluteSetting = {
            box, container, base, containing: this.sizes.frame(container.box.style), inlineSize: containerInline, blockSize: containerBlock,
            statics: this.sizes.mapped(local, target.inline, target.block, target.inlineSize, target.blockSize), staticFrame, parent, initial, found: {}
        };
        let chosen: AbsolutePlace = this.placeAbsolute(setting, box.style);
        const options: ReadonlyArray<PositionOption> | undefined = box.style.positionOptions;
        if (options !== undefined && chosen.overflows) {
            const styles: Array<ComputedStyle> = [box.style];
            for (const option of options) {
                const style: ComputedStyle = option.area === undefined ? option.style : this.anchorRules.withArea(option.style, option.area);
                styles.push(option.tactics.length === 0 ? style : this.anchorRules.tactic(style, option.tactics, setting.containing));
            }
            for (const style of this.tryOrder(setting, styles)) {
                // §6.5 skips the option in use, which in a first layout is the base styles; "If cb rect was negative-size in either axis and
                // corrected into zero-size, continue", and so if "el rect is not fully contained within cb rect".
                if (style === box.style) {
                    continue;
                }
                const place: AbsolutePlace = this.placeAbsolute(setting, style);
                if (!place.corrected && !place.overflows) {
                    chosen = place;
                    break;
                }
            }
        }
        const rectangle: readonly [number, number, number, number] = this.sizes.mapped(this.sizes.inverse(local), chosen.inline, chosen.block, chosen.across, chosen.down);
        delete target.margin;
        Object.assign(target, chosen.fragment);
        target.box = box;
        target.inline = rectangle[0];
        target.block = rectangle[1];
        target.inlineSize = rectangle[2];
        target.blockSize = rectangle[3];
        this.positionVisibility(chosen, target);
        return chosen;
    }

    holdsPages(): boolean {
        // A containing block that has not ended may still place boxes on the pages it went through.
        for (const chain of this.chains.values()) {
            if (!chain.done && chain.waiting.length > 0) {
                return true;
            }
        }
        for (const inline of this.inlineChains.values()) {
            for (const holder of inline.holders.values()) {
                if (!holder.chain.done && holder.chain.waiting.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private chained(fragment: BoxFragment, all: boolean, incoming: BreakToken | undefined, room: number): void {
        // CSS Fragmentation 4 §5.5: "Both the coordinate system and absolutely-positioned boxes belonging to a containing block will fragment across
        // fragmentainers in the same fragmentation flow as the containing block", so its boxes wait for the whole containing block.
        const box: ElementBox = fragment.box;
        const known: Chain | undefined = this.chains.get(box);
        const at: number = known === undefined || incoming === undefined ? -1 : known.parts.findIndex((part: ChainPart) => part.fragment.token === incoming);
        if (known !== undefined) {
            this.unplace(known);
        }
        this.chains.delete(box);
        let chain: Chain;
        if (known === undefined || at < 0) {
            chain = { parts: [], waiting: [], placed: [], initial: false, done: false };
        } else {
            // A fragmentainer laid out again replaces what its earlier layout gave.
            chain = known;
            chain.parts.length = at + 1;
            chain.waiting = chain.waiting.filter((entry: Waiting) => entry.part <= at);
            chain.done = false;
        }
        const part: number = chain.parts.length;
        const base: Transform = this.paddingBase(fragment);
        chain.parts.push({ fragment, content: fragment, base, room });
        if (fragment.children !== undefined) {
            this.gatherWaiting(fragment.children, base, this.sizes.frame(box.style), all, chain, part, [this.originOf(box)]);
        }
        if (fragment.token !== undefined) {
            this.chains.set(box, chain);
            return;
        }
        if (chain.waiting.length > 0) {
            this.placeChain(chain);
        }
        chain.done = true;
        // The last fragmentainer may be laid out again, which places the boxes again over the fragments kept before it.
        if (chain.parts.length > 1) {
            this.chains.set(box, chain);
        }
    }

    private placeAlone(part: ChainPart, all: boolean, initial: boolean): void {
        // A containing block that is not continued from fragmentainer to fragmentainer places its boxes at once.
        const chain: Chain = { parts: [part], waiting: [], placed: [], initial, done: false };
        if (part.content.children !== undefined) {
            this.gatherWaiting(part.content.children, part.base, this.sizes.frame(part.content.box.style), all, chain, 0, [this.originOf(part.content.box)]);
        }
        if (chain.waiting.length > 0) {
            this.placeChain(chain);
        }
        chain.done = true;
    }

    private paddingBase(fragment: BoxFragment): Transform {
        // CSS 2 §10.1: the containing block is "formed by the padding edge", and the children are placed from the content edge.
        return [1, 0, 0, 1, this.side(BoxSizes.INLINE_START, fragment.padding), this.side(BoxSizes.BLOCK_START, fragment.padding)];
    }

    private gatherWaiting(children: Array<BoxFragment | LineFragment>, transform: Transform, frame: number, all: boolean, chain: Chain, part: number,
        path: Array<ElementBox>, within?: SourceElement): void {
        // The placeholders of the boxes that the containing block holds, with their static positions in its padding box, as absolutes() finds them,
        // and the boxes between, for a piece that goes into another fragment of the containing block.
        for (const child of children) {
            const line: LineFragment | undefined = child.kind === "line" ? child : undefined;
            for (const piece of line === undefined ? [child] : line.pieces) {
                if (piece.kind !== "box") {
                    continue;
                }
                const local: Transform = line === undefined ? transform : this.sizes.compose(transform, [1, 0, 0, 1, line.inline ?? 0, line.block]);
                if (this.pending !== undefined && this.pending.has(piece)) {
                    if ((all || piece.box.placement === "absolute") && (within === undefined || this.descends(piece.box, within))) {
                        this.pending.delete(piece);
                        const replace: (fragment?: BoxFragment) => () => void = line === undefined
                            ? (fragment?: BoxFragment): (() => void) => this.swap(children, piece, fragment)
                            : (fragment?: BoxFragment): (() => void) => this.swap(line.pieces, piece, fragment);
                        chain.waiting.push({ box: piece.box, placeholder: piece, local, frame, part, path: [...path, piece.box], replace });
                    }
                } else if (piece.children !== undefined) {
                    path.push(this.originOf(piece.box));
                    this.gatherWaiting(piece.children, this.sizes.compose(local, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style), all, chain, part, path, within);
                    path.pop();
                }
            }
        }
    }

    private swap<T>(list: Array<T | BoxFragment>, placeholder: BoxFragment, piece: BoxFragment | undefined): () => void {
        // The piece takes the place of the placeholder among its siblings, which keeps it in tree order (CSS 2 Appendix E.2), and gives the place
        // back when the chain is placed again.
        const at: number = list.indexOf(placeholder);
        if (at < 0) {
            return (): void => undefined;
        }
        if (piece === undefined) {
            list.splice(at, 1);
        } else {
            list[at] = piece;
        }
        return (): void => {
            if (piece === undefined) {
                list.splice(Math.min(at, list.length), 0, placeholder);
                return;
            }
            const now: number = list.indexOf(piece);
            if (now >= 0) {
                list[now] = placeholder;
            }
        };
    }

    private placeChain(chain: Chain): void {
        // The boxes are placed in the containing block as unbroken, its fragments joined in the block flow direction as the composite box of
        // slice joins them (§5.4.1), whose padding box holds the coordinates; a positioned box in it "sees the anchor box as unfragmented".
        const parts: ReadonlyArray<ChainPart> = chain.parts;
        const first: BoxFragment = parts[0].fragment;
        const last: BoxFragment = parts[parts.length - 1].fragment;
        const box: ElementBox = first.box;
        const offsets: Array<number> = [];
        const extents: Array<number> = [];
        let total: number = 0;
        for (const part of parts) {
            const extent: number = part.fragment.blockSize - this.side(BoxSizes.BLOCK_START, part.fragment.border) - this.side(BoxSizes.BLOCK_END, part.fragment.border);
            offsets.push(total);
            extents.push(extent);
            total += extent;
        }
        const border: [number, number, number, number] = [this.side(BoxSizes.BLOCK_START, first.border), this.side(BoxSizes.INLINE_END, first.border),
            this.side(BoxSizes.BLOCK_END, last.border), this.side(BoxSizes.INLINE_START, first.border)];
        const inlineSize: number = first.inlineSize - border[1] - border[3];
        let container: BoxFragment = first;
        let base: Transform = parts[0].base;
        if (parts.length > 1) {
            // The fragments stand in the joined box under a box of no element, so that the containing block is not among the anchors it holds.
            const shell: ElementBox = { ...box };
            delete shell.element;
            delete shell.pseudoElement;
            const standIns: Array<BoxFragment | LineFragment> = parts.map((part: ChainPart, index: number): BoxFragment => {
                const own: BoxFragment = part.fragment;
                const standIn: BoxFragment = {
                    kind: "box", box: shell, inline: -this.side(BoxSizes.INLINE_START, own.border), block: offsets[index] - this.side(BoxSizes.BLOCK_START, own.border),
                    inlineSize: own.inlineSize, blockSize: own.blockSize
                };
                if (own.border !== undefined) {
                    standIn.border = own.border;
                }
                if (own.padding !== undefined) {
                    standIn.padding = own.padding;
                }
                if (own.children !== undefined) {
                    standIn.children = own.children;
                }
                return standIn;
            });
            container = { kind: "box", box, inline: 0, block: 0, inlineSize: first.inlineSize, blockSize: total + border[0] + border[2], border, children: standIns };
            base = BoxSizes.IDENTITY;
        }
        const final: number = parts.length - 1;
        const limit: (part: number) => number = (part: number): number => part < final ? offsets[part] + extents[part]
            : offsets[part] - this.side(BoxSizes.BLOCK_START, parts[part].fragment.border) + parts[part].room;
        // An inline box that is the containing block has its rectangle in the joined box, in its own writing mode (CSS Position 3 §2.1).
        let toArea: Transform = BoxSizes.IDENTITY;
        let across: number = inlineSize;
        let down: number = total;
        const area: InlineArea | undefined = chain.area;
        if (area !== undefined) {
            const rectangle: readonly [number, number, number, number] = area.rectangle;
            const outer: number = this.sizes.frame(box.style);
            const vertical: boolean = (outer & BoxSizes.VERTICAL) !== 0;
            toArea = this.sizes.compose(this.sizes.between(outer, this.sizes.frame(area.box.style), vertical ? rectangle[3] : rectangle[2], vertical ? rectangle[2] : rectangle[3]),
                [1, 0, 0, 1, -rectangle[0], -rectangle[1]]);
            container = { kind: "box", box: area.box, inline: rectangle[0], block: rectangle[1], inlineSize: rectangle[2], blockSize: rectangle[3], children: container.children ?? [] };
            base = this.sizes.compose(toArea, base);
            across = rectangle[2];
            down = rectangle[3];
        }
        const mark: number = this.overflows.length;
        this.placements++;
        for (const entry of chain.waiting) {
            const local: Transform = this.sizes.compose([1, 0, 0, 1, 0, offsets[entry.part]], entry.local);
            const placeholder: BoxFragment = entry.placeholder;
            const target: BoxFragment = { kind: "box", box: entry.box, inline: placeholder.inline, block: placeholder.block, inlineSize: placeholder.inlineSize, blockSize: placeholder.blockSize };
            const place: AbsolutePlace = this.absolute(target, this.sizes.compose(toArea, local), across, down, container, base, entry.frame, chain.initial,
                entry.path[entry.path.length - 2]);
            this.cut(chain, entry, target, place, local, offsets, limit);
        }
        if (final > 0) {
            this.reroute(chain, mark, offsets, limit);
        }
        chain.done = true;
    }

    private spread(chain: Chain, offsets: ReadonlyArray<number>, limit: (part: number) => number, index: number, start: number, token: BreakToken | undefined,
        lay: (space: number, incoming: BreakToken | undefined) => BoxFragment): Spread {
        // The pieces of a box from the fragment of the containing block it starts in, each laid out in what is left of its fragment, until the box ends
        // or reaches past the fragmentainer of the last fragment.
        const last: number = chain.parts.length - 1;
        const spread: Spread = { pieces: [], beyond: false, start };
        let rest: BreakToken | undefined = token;
        const appeal: number = this.flowAppeal;
        try {
            for (let part: number = index; part <= last; part++) {
                if (part === last && spread.start >= limit(last) - TOLERANCE) {
                    spread.beyond = true;
                    break;
                }
                const laid: BoxFragment = lay(Math.max(MINIMUM_FRAGMENTAINER, limit(part) - spread.start), rest);
                spread.pieces.push([laid, part, spread.start]);
                rest = laid.token;
                if (rest === undefined) {
                    break;
                }
                spread.start = part < last ? offsets[part + 1] : spread.start;
            }
        } finally {
            this.flowAppeal = appeal;
        }
        if (rest !== undefined) {
            spread.rest = rest;
        }
        return spread;
    }

    private cut(chain: Chain, entry: Waiting, target: BoxFragment, place: AbsolutePlace, local: Transform, offsets: ReadonlyArray<number>,
        limit: (part: number) => number): void {
        // §5.5: the box fragments "across fragmentainers in the same fragmentation flow as the containing block": each piece goes into the fragment of the
        // containing block it falls in, and what reaches past the fragmentainer of the last one goes on in the next fragmentainers.
        const parts: ReadonlyArray<ChainPart> = chain.parts;
        const last: number = parts.length - 1;
        const area: readonly [number, number, number, number] = this.sizes.mapped(local, target.inline, target.block, target.inlineSize, target.blockSize);
        let index: number = 0;
        while (index < last && offsets[index + 1] <= area[1]) {
            index++;
        }
        let spread: Spread = { pieces: [], beyond: true, start: area[1] };
        if (index < last || area[1] < limit(last) - TOLERANCE) {
            // A box that fits whole may hold positioned boxes that do not, which fragment with it as their containing block, so it is laid out
            // again in the fragmentation context.
            const own: number = this.sizes.frame(target.box.style);
            const reach: number = place.monolithic ? 0 : this.positionedReach(target.children ?? [], this.sizes.inside({ ...target, inline: 0, block: 0 }, own), own);
            if (place.monolithic || area[1] + Math.max(area[3], reach) <= limit(index) + TOLERANCE) {
                spread = { pieces: [[target, index, area[1]]], beyond: false, start: area[1] };
            } else {
                const kinds: ReadonlyArray<string> = this.fragmenting?.kinds ?? PAGE_CONTEXT;
                this.anchoring.push(place.context);
                try {
                    spread = this.spread(chain, offsets, limit, index, area[1], undefined, (space: number, incoming: BreakToken | undefined): BoxFragment => {
                        const laid: BoxFragment = this.fragmented(kinds, space, place.size, incoming,
                            (): BoxFragment => this.flow(target.box, place.sizes, place.size, 0, true, 0, 0, undefined, space, incoming));
                        this.marked(laid, target, incoming === undefined);
                        return laid;
                    });
                } finally {
                    this.anchoring.pop();
                }
            }
        }
        const pieces: ReadonlyArray<readonly [BoxFragment, number, number]> = spread.pieces;
        const rest: BreakToken | undefined = spread.rest;
        const beyond: boolean = spread.beyond;
        const start: number = spread.start;
        let kept: boolean = false;
        for (const [piece, part, at] of pieces) {
            const rectangle: readonly [number, number, number, number] = [area[0], at, area[2], piece === target ? area[3] : piece.blockSize];
            // The piece in the fragment that holds the placeholder takes its place; the others go into the fragment they fall in.
            if (part !== entry.part || kept) {
                this.inPart(chain, offsets, part, entry.path, piece, rectangle);
                continue;
            }
            const placed: readonly [number, number, number, number] = this.sizes.mapped(this.sizes.inverse(local), rectangle[0], rectangle[1], rectangle[2], rectangle[3]);
            piece.inline = placed[0];
            piece.block = placed[1];
            piece.inlineSize = placed[2];
            piece.blockSize = placed[3];
            chain.placed.push(entry.replace(piece));
            kept = true;
        }
        if (!kept) {
            chain.placed.push(entry.replace());
        }
        if (beyond || rest !== undefined) {
            this.overflows.push(this.overflow(target, place, parts[last], [area[0], 0, area[2], area[3]], beyond ? start - limit(last) : 0, rest,
                beyond && place.monolithic ? target : undefined, beyond && rest === undefined));
        }
    }

    private inPart(chain: Chain, offsets: ReadonlyArray<number>, part: number, path: ReadonlyArray<ElementBox>, piece: BoxFragment,
        rectangle: readonly [number, number, number, number]): void {
        // A piece goes into the fragment of the containing block it falls in, under its nearest ancestor there; the rectangle is in the joined box.
        const holder: ChainPart = chain.parts[part];
        const placed: readonly [number, number, number, number] = this.sizes.mapped(this.sizes.inverse(this.sizes.compose([1, 0, 0, 1, 0, offsets[part]], holder.base)),
            rectangle[0], rectangle[1], rectangle[2], rectangle[3]);
        piece.inline = placed[0];
        piece.block = placed[1];
        piece.inlineSize = placed[2];
        piece.blockSize = placed[3];
        const frame: number = this.sizes.frame(holder.content.box.style);
        const found: Holder = this.holderIn(path, [holder.content], this.sizes.inverse(this.sizes.inside(holder.content, frame)), frame);
        if (found.fragment !== undefined) {
            chain.placed.push(this.lodge(path, piece, found));
        }
    }

    private reroute(chain: Chain, mark: number, offsets: ReadonlyArray<number>, limit: (part: number) => number): void {
        // §5.5: a box whose containing block ended in an earlier fragment of this one goes on in the next fragments of this one, "as if that content were
        // overflowing an empty box with zero margins/borders/padding at the start of the fragmentainer".
        const parts: ReadonlyArray<ChainPart> = chain.parts;
        const last: number = parts.length - 1;
        const kinds: ReadonlyArray<string> = this.fragmenting?.kinds ?? PAGE_CONTEXT;
        for (const overflow of this.overflows.splice(mark)) {
            const part: ChainPart | undefined = overflow.part;
            let at: number = 0;
            let located: Transform | undefined;
            for (; part !== undefined && at < last; at++) {
                const content: BoxFragment = parts[at].content;
                const frame: number = this.sizes.frame(content.box.style);
                located = this.locate(content, part.content, this.sizes.inverse(this.sizes.inside(content, frame)), frame);
                if (located !== undefined) {
                    break;
                }
            }
            if (part === undefined || located === undefined) {
                this.overflows.push(overflow);
                continue;
            }
            const map: Transform = this.sizes.compose(this.sizes.compose([1, 0, 0, 1, 0, offsets[at]], parts[at].base), this.sizes.compose(located, this.sizes.inverse(part.base)));
            const span: readonly [number, number, number, number] = this.sizes.mapped(map, overflow.area[0], 0, overflow.area[2], overflow.area[3]);
            // The next fragment starts where its fragmentainer does, at its border edge, and the box as far below as it still has to go.
            const begin: number = offsets[at + 1] - this.side(BoxSizes.BLOCK_START, parts[at + 1].fragment.border) + overflow.offset;
            let index: number = at + 1;
            while (index < last && offsets[index + 1] <= begin) {
                index++;
            }
            const box: ElementBox = overflow.box;
            const whole: BoxFragment | undefined = overflow.whole;
            let spread: Spread = { pieces: [], beyond: true, start: begin };
            if (index < last || begin < limit(last) - TOLERANCE) {
                if (whole !== undefined) {
                    spread = { pieces: [[whole, index, begin]], beyond: false, start: begin };
                } else {
                    const context: AnchorContext | undefined = overflow.context;
                    if (context !== undefined) {
                        this.anchoring.push(context);
                    }
                    try {
                        spread = this.spread(chain, offsets, limit, index, begin, overflow.token, (space: number, incoming: BreakToken | undefined): BoxFragment => {
                            const laid: BoxFragment = this.fragmented(kinds, space, overflow.size, incoming,
                                (): BoxFragment => this.flow(box, overflow.sizes, overflow.size, 0, true, 0, 0, undefined, space, incoming));
                            this.marked(laid, overflow, incoming === undefined);
                            return laid;
                        });
                    } finally {
                        if (context !== undefined) {
                            this.anchoring.pop();
                        }
                    }
                }
            }
            const path: ReadonlyArray<ElementBox> = this.pathTo(this.originOf(parts[0].content.box), box, []) ?? [box];
            for (const [piece, holder, top] of spread.pieces) {
                this.inPart(chain, offsets, holder, path, piece, [span[0], top, span[2], piece === whole ? span[3] : piece.blockSize]);
            }
            if (spread.beyond || spread.rest !== undefined) {
                const going: Overflow = { box, part: parts[last], area: [span[0], 0, span[2], span[3]], offset: spread.beyond ? spread.start - limit(last) : 0,
                    sizes: overflow.sizes, size: overflow.size };
                if (spread.rest !== undefined) {
                    going.token = spread.rest;
                }
                if (spread.beyond && whole !== undefined) {
                    going.whole = whole;
                }
                if (spread.beyond && spread.rest === undefined && overflow.margin !== undefined) {
                    going.margin = overflow.margin;
                }
                if (overflow.context !== undefined) {
                    going.context = overflow.context;
                }
                if (overflow.hidden !== undefined) {
                    going.hidden = overflow.hidden;
                }
                if (overflow.anchoredTo !== undefined) {
                    going.anchoredTo = overflow.anchoredTo;
                }
                this.overflows.push(going);
            }
        }
    }

    private positionedReach(children: ReadonlyArray<BoxFragment | LineFragment>, transform: Transform, frame: number): number {
        // How far down the absolutely positioned boxes inside a box reach, from the box's block-start border edge.
        let reach: number = 0;
        for (const child of children) {
            const line: Transform = child.kind === "line" ? this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]) : transform;
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                if (piece.box.placement === "absolute" || piece.box.placement === "fixed") {
                    const area: readonly [number, number, number, number] = this.sizes.mapped(line, piece.inline, piece.block, piece.inlineSize, piece.blockSize);
                    reach = Math.max(reach, area[1] + area[3]);
                }
                if (piece.children !== undefined) {
                    reach = Math.max(reach, this.positionedReach(piece.children, this.sizes.compose(line, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style)));
                }
            }
        }
        return reach;
    }

    private marked(piece: BoxFragment, target: BoxFragment | Overflow, first: boolean): void {
        // The pieces of a box are drawn as it is, hidden by position-visibility or tied to the anchor whose visibility it follows (CSS Anchor
        // Positioning 1 §6.6), and only the first has the block-start margin that placed the box.
        if (target.hidden !== undefined) {
            piece.hidden = target.hidden;
        }
        if (target.anchoredTo !== undefined) {
            piece.anchoredTo = target.anchoredTo;
        }
        if (first && target.margin !== undefined) {
            piece.margin = target.margin;
        }
    }

    private overflow(target: BoxFragment, place: AbsolutePlace, part: ChainPart | undefined, area: readonly [number, number, number, number], offset: number,
        token: BreakToken | undefined, whole: BoxFragment | undefined, first: boolean): Overflow {
        const overflow: Overflow = { box: target.box, area, offset, sizes: place.sizes, size: place.size, context: place.context };
        if (part !== undefined) {
            overflow.part = part;
        }
        if (token !== undefined) {
            overflow.token = token;
        }
        if (whole !== undefined) {
            overflow.whole = whole;
        }
        if (first && target.margin !== undefined) {
            overflow.margin = target.margin;
        }
        if (target.hidden !== undefined) {
            overflow.hidden = target.hidden;
        }
        if (target.anchoredTo !== undefined) {
            overflow.anchoredTo = target.anchoredTo;
        }
        return overflow;
    }

    private unplace(chain: Chain): void {
        // What was placed is taken back in the reverse order, so that each placeholder gets its own place back.
        for (let index: number = chain.placed.length - 1; index >= 0; index--) {
            chain.placed[index]();
        }
        chain.placed.length = 0;
    }

    private carryOut(root: BoxFragment): void {
        // CSS Fragmentation 4 §5.5: a positioned box that reaches past the fragmentainer of its containing block's last fragment goes on in the next
        // fragmentainers, where the containing block has ended; its place across the line is that of this fragmentainer.
        if (this.overflows.length === 0) {
            return;
        }
        const frame: number = this.sizes.frame(root.box.style);
        const carries: Array<PositionedCarry> = [];
        for (const overflow of this.overflows) {
            const part: ChainPart | undefined = overflow.part;
            // A containing block that is not in this fragmentainer was laid out by a layout that was not kept, or before this fragmentainer.
            const located: Transform | undefined = part === undefined ? BoxSizes.IDENTITY : this.locate(root, part.content, BoxSizes.IDENTITY, frame);
            if (located === undefined) {
                continue;
            }
            const map: Transform = part === undefined ? located : this.sizes.compose(located, this.sizes.inverse(part.base));
            const span: readonly [number, number, number, number] = this.sizes.mapped(map, overflow.area[0], 0, overflow.area[2], overflow.area[3]);
            const carry: PositionedCarry = { box: overflow.box, offset: overflow.offset, inline: span[0], inlineSize: span[2], extent: span[3], sizes: overflow.sizes, size: overflow.size };
            if (overflow.token !== undefined) {
                carry.token = overflow.token;
            }
            if (overflow.whole !== undefined) {
                carry.whole = overflow.whole;
            }
            if (overflow.margin !== undefined) {
                carry.margin = overflow.margin;
            }
            if (overflow.hidden !== undefined) {
                carry.hidden = overflow.hidden;
            }
            if (overflow.anchoredTo !== undefined) {
                carry.anchoredTo = overflow.anchoredTo;
            }
            if (overflow.context !== undefined) {
                this.carriedContexts.set(carry, overflow.context);
            }
            carries.push(carry);
        }
        if (carries.length === 0) {
            return;
        }
        // A fragmentainer whose content ended goes on for them alone, as the overflow-only fragment of its box.
        root.token = root.token ?? { box: root.box, consumed: 0, child: root.box.children.length, sequence: root.box.inline?.length ?? 0, ended: true };
        root.token.positioned = carries;
    }

    private carryIn(root: BoxFragment, incoming: BreakToken | undefined, kinds: ReadonlyArray<string>, extent: number): void {
        // §5.5: the rest of a box goes on "as if that content were overflowing an empty box with zero margins/borders/padding at the start of the
        // fragmentainer", at its place across the line, and below the start by what it has still to go down.
        const carries: ReadonlyArray<PositionedCarry> | undefined = incoming?.positioned;
        if (carries === undefined) {
            return;
        }
        const frame: number = this.sizes.frame(root.box.style);
        const appeal: number = this.flowAppeal;
        const state: Fragmentation | undefined = this.pageState;
        for (const carry of carries) {
            const context: AnchorContext | undefined = this.carriedContexts.get(carry);
            const area: readonly [number, number, number, number] = [carry.inline, 0, carry.inlineSize, carry.extent];
            if (carry.offset >= extent - TOLERANCE) {
                const passing: Overflow = { box: carry.box, area, offset: carry.offset - extent, sizes: carry.sizes, size: carry.size };
                this.carried(passing, carry, carry.token, carry.whole, context, true);
                this.overflows.push(passing);
                continue;
            }
            let piece: BoxFragment;
            if (carry.whole !== undefined) {
                piece = carry.whole;
            } else {
                const space: number = Math.max(MINIMUM_FRAGMENTAINER, extent - carry.offset);
                const token: BreakToken | undefined = carry.token;
                if (context !== undefined) {
                    this.anchoring.push(context);
                }
                try {
                    piece = this.fragmented(kinds, space, carry.size, token, (): BoxFragment => this.flow(carry.box, carry.sizes, carry.size, 0, true, 0, 0, undefined, space, token));
                } finally {
                    if (context !== undefined) {
                        this.anchoring.pop();
                    }
                }
                if (carry.hidden !== undefined) {
                    piece.hidden = carry.hidden;
                }
                if (carry.anchoredTo !== undefined) {
                    piece.anchoredTo = carry.anchoredTo;
                }
                if (carry.margin !== undefined) {
                    piece.margin = carry.margin;
                }
            }
            piece.inline = carry.inline;
            piece.block = carry.offset;
            piece.inlineSize = carry.inlineSize;
            if (carry.whole !== undefined) {
                piece.blockSize = carry.extent;
            }
            this.lodgeCarried(root, carry.box, piece, frame);
            if (carry.whole === undefined && piece.token !== undefined) {
                const going: Overflow = { box: carry.box, area, offset: 0, sizes: carry.sizes, size: carry.size };
                this.carried(going, carry, piece.token, undefined, context, false);
                this.overflows.push(going);
            }
        }
        this.flowAppeal = appeal;
        if (state === undefined) {
            delete this.pageState;
        } else {
            this.pageState = state;
        }
    }

    private carried(overflow: Overflow, carry: PositionedCarry, token: BreakToken | undefined, whole: BoxFragment | undefined, context: AnchorContext | undefined,
        first: boolean): void {
        if (token !== undefined) {
            overflow.token = token;
        }
        if (whole !== undefined) {
            overflow.whole = whole;
        }
        if (context !== undefined) {
            overflow.context = context;
        }
        if (first && carry.margin !== undefined) {
            overflow.margin = carry.margin;
        }
        if (carry.hidden !== undefined) {
            overflow.hidden = carry.hidden;
        }
        if (carry.anchoredTo !== undefined) {
            overflow.anchoredTo = carry.anchoredTo;
        }
    }

    private lodgeCarried(root: BoxFragment, box: ElementBox, piece: BoxFragment, frame: number): void {
        // The piece goes into its nearest ancestor in the fragmentainer, or into the fragmentainer's own box, below the boxes that hold that box.
        const path: ReadonlyArray<ElementBox> = (this.rootBox === undefined ? undefined : this.pathTo(this.rootBox, box, [])) ?? [box];
        const found: Holder = this.holderIn(path, [root], BoxSizes.IDENTITY, frame);
        if (found.fragment === undefined) {
            let depth: number = path.indexOf(this.originOf(root.box));
            if (depth < 0) {
                depth = path.findIndex((ancestor: ElementBox) => root.box.children.some((child: BoxNode) => child.kind === "box" && this.originOf(child) === ancestor)) - 1;
            }
            found.fragment = root;
            found.transform = this.sizes.inside(root, frame);
            found.frame = this.sizes.frame(root.box.style);
            found.depth = Math.max(-1, depth);
        }
        this.lodge(path, piece, found);
    }

    private placeAbsolute(setting: AbsoluteSetting, style: ComputedStyle): AbsolutePlace {
        // CSS Position 3 §4: the inset-modified containing block is found, the box is sized in it, its auto margins resolved and its margin box
        // aligned in it; CSS Writing Modes 4 §7.3 and §7.4: the box is sized in its own writing mode and placed in the containing block's.
        const box: ElementBox = setting.box;
        const containing: number = setting.containing;
        const own: number = this.sizes.frame(style);
        const orthogonal: boolean = this.sizes.isOrthogonal(containing, own);
        const context: AnchorContext = this.anchorContext(setting, style);
        this.anchoring.push(context);
        try {
            const option: OptionArea = this.optionArea(context, own);
            const region: readonly [number, number, number, number] = context.region;
            const spans: readonly [number, number] = [region[1] - region[0], region[3] - region[2]];
            const insets: Array<number | undefined> = [];
            for (let side: number = 0; side < 4; side++) {
                insets.push(this.sizes.inset(style, side, spans[side % 2 === 0 ? 1 : 0], containing));
            }
            // CSS Anchor Positioning 1 §3.1 and §4.2: with a position-area or anchor-center, auto insets and auto margins are zero.
            const zeroed: boolean = option.area !== undefined || option.justify.kind === "anchor-center" || option.align.kind === "anchor-center";
            const kinds: Array<Alignment> = [option.justify, option.align];
            const modes: Array<string> = [];
            const imcb: Array<readonly [number, number]> = [];
            let corrected: boolean = false;
            for (let axis: number = 0; axis < 2; axis++) {
                const start: number | undefined = insets[axis === 0 ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START];
                const end: number | undefined = insets[axis === 0 ? BoxSizes.INLINE_END : BoxSizes.BLOCK_END];
                const low: number = region[axis * 2];
                const high: number = region[axis * 2 + 1];
                const single: boolean = (start === undefined) !== (end === undefined);
                let before: number = start ?? 0;
                let after: number = end ?? 0;
                let mode: string = "insets";
                if (zeroed || (start !== undefined && end !== undefined)) {
                    // §4.1: "if only one inset property in the relevant axis is auto", normal aligns "towards the edge with the non-auto inset", unsafely.
                    if (option.area !== undefined && single && this.anchorRules.alignment(style.values[axis === 0 ? "justify-self" : "align-self"], axis === 0, containing, own).kind === "normal") {
                        kinds[axis] = { kind: start === undefined ? "end" : "start", overflow: "unsafe" };
                    }
                } else if (single) {
                    mode = start !== undefined ? "start" : "end";
                } else {
                    // CSS Position 3 §3.5.1: with both insets auto, the alignment in the static-position containing block sets them from the
                    // static-position rectangle, center keeping the rectangle's center in the middle.
                    mode = this.staticAlignment(setting, style, axis, own);
                    const first: number = setting.statics[axis];
                    const last: number = first + setting.statics[axis + 2];
                    const middle: number = (first + last) / 2;
                    if (mode === "static-start") {
                        before = first - low;
                    } else if (mode === "static-end") {
                        after = high - last;
                    } else if (middle - low <= high - middle) {
                        after = high - low - 2 * Math.abs(middle - low);
                    } else {
                        before = high - low - 2 * Math.abs(high - middle);
                    }
                }
                let from: number = low + before;
                let to: number = high - after;
                if (to < from) {
                    // "the weaker inset in the affected axis is reduced (possibly becoming negative) to bring that size up to zero", the auto one
                    // when only one is auto and the end one otherwise.
                    corrected = true;
                    if (single && start === undefined) {
                        from = to;
                    } else {
                        to = from;
                    }
                }
                modes.push(mode);
                imcb.push([from, to]);
            }
            const inlineAxis: number = orthogonal ? 1 : 0;
            const blockAxis: number = 1 - inlineAxis;
            const given: UsedSizes = this.sizes.of(style, spans[inlineAxis], spans[blockAxis], spans[0]);
            const margin: (axis: number, end: boolean) => number | undefined = (axis: number, end: boolean): number | undefined => {
                const side: number = axis === 0 ? (end ? BoxSizes.INLINE_END : BoxSizes.INLINE_START) : (end ? BoxSizes.BLOCK_END : BoxSizes.BLOCK_START);
                const value: number | undefined = this.sizes.margin(given, this.sizes.side(containing, own, side));
                return value === undefined && zeroed ? 0 : value;
            };
            const room: (axis: number) => number = (axis: number): number => imcb[axis][1] - imcb[axis][0];
            const fits: (axis: number) => boolean = (axis: number): boolean => {
                // §4.1: the automatic size is the stretch-fit size for stretch without auto insets or margins, and for normal without auto insets
                // on a box that is neither replaced nor a table wrapper box; otherwise it is the fit-content size.
                const kind: string = kinds[axis].kind;
                const fixed: boolean = modes[axis] === "insets";
                return (kind === "stretch" && fixed && margin(axis, false) !== undefined && margin(axis, true) !== undefined)
                    || (kind === "normal" && fixed && !box.replaced && !this.tables.isWrapper(box));
            };
            const inlineEdges: number = this.inlineEdges(given);
            const blockEdges: number = this.sizes.edges(given, BoxSizes.BLOCK_START) + this.sizes.edges(given, BoxSizes.BLOCK_END);
            const inlineStretch: number = Math.max(0, room(inlineAxis) - (margin(inlineAxis, false) ?? 0) - (margin(inlineAxis, true) ?? 0) - inlineEdges);
            const blockStretch: number = Math.max(0, room(blockAxis) - (margin(blockAxis, false) ?? 0) - (margin(blockAxis, true) ?? 0) - blockEdges);
            // "When both axes have an automatic size, if only one axis has an auto inset then that axis is the ratio-dependent axis", whose size
            // follows from the stretch-fit size of the other.
            const keywords: ReadonlyArray<string> | undefined = given.keywords;
            const automatic: boolean = given.inlineSize === undefined && given.blockSize === undefined
                && (keywords === undefined || (keywords[BoxSizes.PREFERRED_INLINE] === "" && keywords[BoxSizes.PREFERRED_BLOCK] === ""));
            const basis: UsedSizes = given.ratio !== undefined && !box.replaced && automatic && modes[inlineAxis] !== "insets" && modes[blockAxis] === "insets" && fits(blockAxis)
                ? { ...given, blockSize: this.sizes.adjusted(given, BoxSizes.PREFERRED_BLOCK, blockStretch) } : given;
            const sizes: UsedSizes = this.resolved(box, basis, inlineStretch, room(blockAxis));
            let size: number;
            if (sizes.inlineSize !== undefined) {
                size = sizes.inlineSize;
            } else if (fits(inlineAxis)) {
                size = inlineStretch;
            } else {
                // CSS Sizing 3 §3.2: fit-content is "min(max-content, max(min-content, stretch-fit))"; a box whose content another layout lays
                // out, such as a MathML element in a formula, has the content width that layout gives.
                const inner: BoxFragment | undefined = this.innerLayout?.(box, sizes);
                const content: readonly [number, number] = inner === undefined ? this.contentSizes(box, sizes.blockSize)
                    : [inner.inlineSize - inlineEdges, inner.inlineSize - inlineEdges];
                size = Math.min(Math.max(content[0], inlineStretch), content[1]);
            }
            size = this.clamped(sizes.inlineSize ?? this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, size), sizes.minInlineSize, sizes.maxInlineSize);
            // CSS Sizing 4 §4.2: with a preferred aspect ratio the automatic block size follows from the inline size.
            const stretched: number | undefined = sizes.blockSize === undefined && sizes.ratio === undefined && fits(blockAxis) ? blockStretch : undefined;
            const final: UsedSizes = stretched === undefined ? sizes : { ...sizes, blockSize: this.sizes.adjusted(sizes, BoxSizes.PREFERRED_BLOCK, stretched) };
            const inner: BoxFragment | undefined = this.innerLayout?.(box, final, size);
            const laid: BoxFragment = inner ?? this.flow(box, final, size, 0, true, 0, 0);
            const extents: readonly [number, number] = orthogonal ? [laid.blockSize, laid.inlineSize] : [laid.inlineSize, laid.blockSize];
            const offsets: Array<number> = [];
            const used: [number, number, number, number] = [0, 0, 0, 0];
            let overflows: boolean = false;
            for (let axis: number = 0; axis < 2; axis++) {
                const from: number = imcb[axis][0];
                const to: number = imcb[axis][1];
                let before: number | undefined = margin(axis, false);
                let after: number | undefined = margin(axis, true);
                const loose: boolean = before === undefined || after === undefined;
                if (loose && modes[axis] === "insets") {
                    // §4.2: the remaining space is divided among the auto margins, but in the inline axis "the start margin resolves to zero and the
                    // end margin receives the remaining space" when it is negative and both are auto.
                    const remaining: number = to - from - extents[axis] - (before ?? 0) - (after ?? 0);
                    if (before === undefined && after === undefined) {
                        before = axis === 0 && remaining < 0 ? 0 : remaining / 2;
                        after = remaining - before;
                    } else if (before === undefined) {
                        before = remaining;
                    } else {
                        after = remaining;
                    }
                }
                const marginStart: number = before ?? 0;
                const outer: number = extents[axis] + marginStart + (after ?? 0);
                let position: number;
                // §5: with an auto inset the margin box goes to the edge of the stronger inset, and with auto margins those place it.
                if (modes[axis] === "start" || modes[axis] === "static-start" || (loose && modes[axis] === "insets")) {
                    position = from;
                } else if (modes[axis] === "end" || modes[axis] === "static-end") {
                    position = to - outer;
                } else if (modes[axis] === "static-center") {
                    position = from + (to - from - outer) / 2;
                } else {
                    position = this.aligned(kinds[axis], from, to, outer, setting, axis, option.anchor);
                }
                offsets.push(position + marginStart);
                used[this.sizes.side(containing, own, axis === 0 ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START)] = marginStart;
                used[this.sizes.side(containing, own, axis === 0 ? BoxSizes.INLINE_END : BoxSizes.BLOCK_END)] = after ?? 0;
                overflows = overflows || position < from - EDGE_TOLERANCE || position + outer > to + EDGE_TOLERANCE;
            }
            if (used.some((value: number) => value !== 0)) {
                laid.margin = used;
            }
            return {
                fragment: laid, inline: offsets[0], block: offsets[1], across: extents[0], down: extents[1], overflows, corrected, context, sizes: final, size,
                monolithic: inner !== undefined || orthogonal || box.replaced || this.isMonolithic(box)
            };
        } finally {
            this.anchoring.pop();
        }
    }

    private anchorContext(setting: AbsoluteSetting, style: ComputedStyle): AnchorContext {
        // CSS Anchor Positioning 1 §5.1: the anchor functions of the box's values, and of the descendants that inherit them, resolve while the
        // box is laid out; a position option has values of its own.
        const owners: Array<number> = [];
        for (const owner of [style.anchorOwner, setting.box.style.anchorOwner]) {
            if (owner !== undefined && !owners.includes(owner)) {
                owners.push(owner);
            }
        }
        return {
            owners, box: setting.box, style, container: setting.container, base: setting.base, frame: setting.containing,
            region: [0, setting.inlineSize, 0, setting.blockSize], found: setting.found, usesDefault: false, missing: false
        };
    }

    private optionArea(context: AnchorContext, own: number): OptionArea {
        // CSS Anchor Positioning 1 §3.1: a position-area makes its area of the grid around the default anchor box the containing block, and
        // has no effect without that box; §4.2: anchor-center without it "behaves as center".
        const style: ComputedStyle = context.style;
        const area: Area | undefined = this.anchorRules.area(style.values["position-area"], context.frame, own);
        let justify: Alignment = this.anchorRules.alignment(style.values["justify-self"], true, context.frame, own);
        let align: Alignment = this.anchorRules.alignment(style.values["align-self"], false, context.frame, own);
        let anchor: readonly [number, number, number, number] | undefined;
        if (area !== undefined || justify.kind === "anchor-center" || align.kind === "anchor-center") {
            context.usesDefault = true;
            anchor = this.defaultRect(context);
        }
        if (anchor === undefined) {
            const centered: (alignment: Alignment) => Alignment = (alignment: Alignment): Alignment => alignment.kind === "anchor-center" ? { ...alignment, kind: "center" } : alignment;
            return { justify: centered(justify), align: centered(align) };
        }
        if (area !== undefined) {
            const inline: readonly [number, number] = this.gridTracks(area.inline, anchor[0], anchor[2], context.region[1]);
            const block: readonly [number, number] = this.gridTracks(area.block, anchor[1], anchor[3], context.region[3]);
            context.region = [inline[0], inline[1], block[0], block[1]];
            justify = this.areaAlignment(justify, area.inline);
            align = this.areaAlignment(align, area.block);
            return { area, anchor, justify, align };
        }
        return { anchor, justify, align };
    }

    private gridTracks(tracks: readonly [number, number], low: number, high: number, size: number): readonly [number, number] {
        // §3.1.1: the lines are the start of the containing block or of the anchor box if that is more start-ward, the anchor's edges, and the
        // end of the containing block or of the anchor box if that is more end-ward.
        const lines: readonly [number, number, number, number] = [Math.min(0, low), low, high, Math.max(size, high)];
        return [lines[tracks[0]], lines[tracks[1] + 1]];
    }

    private areaAlignment(alignment: Alignment, tracks: readonly [number, number]): Alignment {
        // §4.1: normal is center for the center track alone, anchor-center for all three tracks, and otherwise toward the side track not selected.
        if (alignment.kind !== "normal") {
            return alignment;
        }
        if (tracks[0] === 1 && tracks[1] === 1) {
            return { kind: "center" };
        }
        if (tracks[0] === 0 && tracks[1] === 2) {
            return { kind: "anchor-center" };
        }
        return { kind: tracks[0] === 0 ? "end" : "start" };
    }

    private staticAlignment(setting: AbsoluteSetting, style: ComputedStyle, axis: number, own: number): string {
        // CSS Position 3 §3.5.2: the alignment uses the writing mode of the static-position containing block, normal as start and stretch and
        // baselines as their fallbacks, and overflow alignment is ignored; CSS Box Alignment 3 §6.1: auto takes the parent's default alignment.
        const crossed: boolean = this.sizes.isOrthogonal(setting.staticFrame, setting.containing);
        const inline: boolean = (axis === 0) !== crossed;
        const value: CssValue | undefined = this.selfValue(style.values[inline ? "justify-self" : "align-self"], setting.parent?.style.values[inline ? "justify-items" : "align-items"]);
        const kind: string = this.anchorRules.alignment(value, inline, setting.staticFrame, own).kind;
        if (kind === "center" || kind === "anchor-center") {
            return "static-center";
        }
        const forward: boolean = this.sizes.side(setting.staticFrame, setting.containing, inline ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START)
            === (axis === 0 ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START);
        return forward === (kind !== "end") ? "static-start" : "static-end";
    }

    private aligned(alignment: Alignment, from: number, to: number, outer: number, setting: AbsoluteSetting, axis: number,
        anchor: readonly [number, number, number, number] | undefined): number {
        // CSS Box Alignment 3 §6.1.2 and §6.2.2: normal behaves as start here, and so does stretch on a box that keeps its size; CSS Anchor
        // Positioning 1 §4.2: anchor-center centers the margin box on the default anchor box.
        const kind: string = alignment.kind;
        if (kind === "normal" || kind === "stretch") {
            return from;
        }
        const room: number = to - from;
        let wanted: number;
        if (kind === "start") {
            wanted = from;
        } else if (kind === "end") {
            wanted = to - outer;
        } else if (kind === "anchor-center" && anchor !== undefined) {
            wanted = (anchor[axis] + anchor[axis + 2]) / 2 - outer / 2;
        } else {
            wanted = from + (room - outer) / 2;
        }
        if (alignment.overflow === "unsafe") {
            return wanted;
        }
        if (alignment.overflow === "safe") {
            return outer > room ? from : wanted;
        }
        // §4.4.1.2: by default the box stays within the inset-modified containing block, covers it when larger within the overflow limit rect,
        // which also holds the original containing block, and starts that rect when larger still.
        if (outer <= room) {
            return Math.min(Math.max(wanted, from), to - outer);
        }
        const limitStart: number = Math.min(from, 0);
        const limitEnd: number = this.scrolls(setting) ? Number.POSITIVE_INFINITY : Math.max(to, axis === 0 ? setting.inlineSize : setting.blockSize);
        if (outer <= limitEnd - limitStart) {
            return Math.min(Math.max(wanted, to - outer, limitStart), from, limitEnd - outer);
        }
        return limitStart;
    }

    private scrolls(setting: AbsoluteSetting): boolean {
        // §4.4.1.2: the limit of a scroll container's box is "extended to infinity in any direction that does not extend into the unreachable
        // scrollable overflow region", unless it is the fixed containing block; the page area is no scroll container.
        if (setting.initial) {
            return false;
        }
        const values: Readonly<Record<string, CssValue>> = setting.container.box.style.values;
        return SCROLLING_OVERFLOW.has(this.keyword(values["overflow-x"])) || SCROLLING_OVERFLOW.has(this.keyword(values["overflow-y"]));
    }

    private tryOrder(setting: AbsoluteSetting, styles: ReadonlyArray<ComputedStyle>): ReadonlyArray<ComputedStyle> {
        // CSS Anchor Positioning 1 §6.2: the options are stably sorted by the size of the inset-modified containing block they give, "treating
        // auto inset values as zero", largest first, with logical directions of the containing block.
        const order: string = this.keyword(setting.box.style.values["position-try-order"]);
        if (order !== "most-width" && order !== "most-height" && order !== "most-inline-size" && order !== "most-block-size") {
            return styles;
        }
        let axis: number = order === "most-block-size" ? 1 : 0;
        if (order === "most-width" || order === "most-height") {
            axis = (order === "most-width") === ((setting.containing & BoxSizes.VERTICAL) === 0) ? 0 : 1;
        }
        const measured: Array<readonly [number, number]> = styles.map((style: ComputedStyle, index: number): readonly [number, number] => [this.insetModified(setting, style, axis), index]);
        measured.sort((first: readonly [number, number], second: readonly [number, number]) => second[0] - first[0] || first[1] - second[1]);
        return measured.map((entry: readonly [number, number]) => styles[entry[1]]);
    }

    private insetModified(setting: AbsoluteSetting, style: ComputedStyle, axis: number): number {
        const context: AnchorContext = this.anchorContext(setting, style);
        this.anchoring.push(context);
        try {
            this.optionArea(context, this.sizes.frame(style));
            const span: number = context.region[axis * 2 + 1] - context.region[axis * 2];
            const start: number = this.sizes.inset(style, axis === 0 ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START, span, setting.containing) ?? 0;
            const end: number = this.sizes.inset(style, axis === 0 ? BoxSizes.INLINE_END : BoxSizes.BLOCK_END, span, setting.containing) ?? 0;
            return Math.max(0, span - start - end);
        } finally {
            this.anchoring.pop();
        }
    }

    private positionVisibility(place: AbsolutePlace, target: BoxFragment): void {
        // CSS Anchor Positioning 1 §6.6: visibility "computes to force-hidden" when the box uses a default anchor box that is not found or
        // when it overflows; whether the anchor is invisible or clipped by intervening boxes depends on what is painted, which the painter knows.
        const context: AnchorContext = place.context;
        const value: CssValue | undefined = context.box.style.values["position-visibility"];
        const words: Array<string> = [];
        for (const item of value === undefined ? [] : (value.kind === "list" ? value.items : [value])) {
            if (item.kind === "ident") {
                words.push(item.lower);
            }
        }
        if (words.length === 0) {
            words.push("anchors-visible");
        }
        if (words.includes("always")) {
            return;
        }
        const anchor: ElementBox | undefined = this.defaultTarget(context);
        if ((words.includes("no-overflow") && place.overflows) || (words.includes("anchors-valid") && (context.missing || (context.usesDefault && anchor === undefined)))) {
            target.hidden = true;
        } else if (anchor !== undefined && words.includes("anchors-visible")) {
            target.anchoredTo = { anchor, container: context.container.box };
        }
    }

    private anchorLength(anchor: CalcAnchor, block: boolean, side?: number): number | undefined {
        // An anchor function belongs to the box whose computed value made it, which is being laid out when it is met.
        for (let index: number = this.anchoring.length - 1; index >= 0; index--) {
            const context: AnchorContext = this.anchoring[index];
            if (anchor.owner !== undefined && context.owners.includes(anchor.owner)) {
                if (anchor.anchor === undefined) {
                    context.usesDefault = true;
                }
                // §6.6: an anchor function without a fallback is a required anchor reference, which anchors-valid needs resolved.
                if (anchor.fallback === undefined && this.anchorTarget(context, anchor.anchor) === undefined) {
                    context.missing = true;
                }
                return anchor.name === "anchor" ? this.anchorEdge(context, anchor, side) : this.anchorSize(context, anchor, block);
            }
        }
        return undefined;
    }

    private anchorEdge(context: AnchorContext, anchor: CalcAnchor, side?: number): number | undefined {
        // CSS Anchor Positioning 1 §3.2: the length "that would align the edge of the positioned boxes' inset-modified containing block
        // corresponding to the property the function appears in with the specified edge" of the anchor box.
        const target: ElementBox | undefined = side === undefined ? undefined : this.anchorTarget(context, anchor.anchor);
        const rect: readonly [number, number, number, number] | undefined = target === undefined ? undefined : this.contextBounds(context).get(target);
        if (rect === undefined || side === undefined) {
            return undefined;
        }
        const block: boolean = side === BoxSizes.BLOCK_START || side === BoxSizes.BLOCK_END;
        const startSide: number = block ? BoxSizes.BLOCK_START : BoxSizes.INLINE_START;
        const low: number = block ? rect[1] : rect[0];
        const high: number = block ? rect[3] : rect[2];
        const atStart: boolean = side === startSide;
        const keyword: string | undefined = anchor.keyword;
        let edge: number | undefined;
        if (anchor.percent !== undefined || keyword === "center") {
            // "0% being equivalent to start and 100% being equivalent to end", and "center is equivalent to 50%".
            edge = low + (high - low) * (anchor.percent ?? 50) / 100;
        } else if (keyword === "inside" || keyword === "outside") {
            edge = atStart === (keyword === "inside") ? low : high;
        } else if (keyword === "start" || keyword === "end") {
            edge = keyword === "start" ? low : high;
        } else if (keyword === "self-start" || keyword === "self-end") {
            const ownStart: boolean = this.anchorRules.startSide(block ? "block" : "inline", context.frame, this.sizes.frame(context.style)) === startSide;
            edge = (keyword === "self-start") === ownStart ? low : high;
        } else if (keyword !== undefined) {
            // §3.2.1: a physical keyword resolves only in an inset property of its axis.
            const physical: number = PHYSICAL_EDGES.indexOf(keyword);
            if (physical === this.sizes.physicalSide(context.frame, startSide)) {
                edge = low;
            } else if (physical === this.sizes.physicalSide(context.frame, block ? BoxSizes.BLOCK_END : BoxSizes.INLINE_END)) {
                edge = high;
            }
        }
        if (edge === undefined) {
            return undefined;
        }
        const region: readonly [number, number, number, number] = context.region;
        return atStart ? edge - region[block ? 2 : 0] : region[block ? 3 : 1] - edge;
    }

    private anchorTarget(context: AnchorContext, name?: string): ElementBox | undefined {
        // §2.3: a named anchor is the target anchor element of that name, and an omitted name selects the default anchor element.
        return name === undefined ? this.defaultTarget(context) : this.namedAnchor(this.contextPath(context), context.box, name, this.contextBounds(context));
    }

    private defaultTarget(context: AnchorContext): ElementBox | undefined {
        return this.defaultAnchor(this.contextPath(context), (): ReadonlyMap<ElementBox, [number, number, number, number]> => this.contextBounds(context), context.style);
    }

    private defaultRect(context: AnchorContext): readonly [number, number, number, number] | undefined {
        const target: ElementBox | undefined = this.defaultTarget(context);
        return target === undefined ? undefined : this.contextBounds(context).get(target);
    }

    private contextPath(context: AnchorContext): ReadonlyArray<ElementBox> {
        // A box of the document has its ancestors from the root; one in a tree laid out apart, as the boxes of a formula, from its containing block.
        if (context.found.path === undefined) {
            context.found.path = (this.rootBox === undefined ? undefined : this.pathTo(this.rootBox, context.box, []))
                ?? this.pathTo(this.originOf(context.container.box), context.box, []) ?? [];
        }
        return context.found.path;
    }

    private contextBounds(context: AnchorContext): Map<ElementBox, [number, number, number, number]> {
        // §2.3: an anchor is acceptable when it "is laid out strictly before" the positioned box, which here is to have a fragment inside the
        // containing block when the positioned box is laid out; the rectangles are in the containing block, from its padding edge.
        const found: AnchorFound = context.found;
        if (found.bounds !== undefined) {
            return found.bounds;
        }
        if (this.anchorNames === undefined) {
            this.anchorNames = new Map<string, Array<ReadonlyArray<ElementBox>>>();
            this.anchorOwners = new Map<ElementBox, ElementBox>();
            this.elementOwners = new Map<SourceElement, Map<string, ElementBox>>();
            this.indexedTrees.clear();
        }
        const top: ElementBox | undefined = this.contextPath(context)[0];
        if (top !== undefined && !this.indexedTrees.has(top)) {
            this.indexedTrees.add(top);
            this.indexAnchors(top, []);
        }
        const wanted: Set<ElementBox> = new Set<ElementBox>(this.contextPath(context).map((box: ElementBox) => this.anchorOwner(box)));
        for (const anchors of this.anchorNames.values()) {
            for (const anchor of anchors) {
                wanted.add(this.anchorOwner(anchor[anchor.length - 1]));
            }
        }
        const bounds: Map<ElementBox, [number, number, number, number]> = new Map<ElementBox, [number, number, number, number]>();
        found.bounds = bounds;
        const container: BoxFragment = context.container;
        if (container.children !== undefined) {
            // §2: the anchor box's place includes transforms, as "the axis-aligned bounding rectangle of the anchor box in the coordinate space of the
            // absolutely positioned element's containing block"; transforms work in physical axes, so the rectangles are found there.
            const inline: number = container.inlineSize - this.side(BoxSizes.INLINE_START, container.border) - this.side(BoxSizes.INLINE_END, container.border);
            const block: number = container.blockSize - this.side(BoxSizes.BLOCK_START, container.border) - this.side(BoxSizes.BLOCK_END, container.border);
            const vertical: boolean = (context.frame & BoxSizes.VERTICAL) !== 0;
            const physical: Transform = this.sizes.between(context.frame, 0, vertical ? block : inline, vertical ? inline : block);
            this.anchorBounds(container.children, this.sizes.compose(physical, context.base), context.frame, wanted, bounds, this.sizes.inverse(physical), undefined, undefined);
        }
        return bounds;
    }

    private anchorSize(context: AnchorContext, anchor: CalcAnchor, block: boolean): number | undefined {
        // CSS Anchor Positioning 1 §5.1: the function takes an anchor name and a size keyword, both optional, and gives "the
        // <length> separating the relevant edges" "of the target anchor element's anchor box."
        const target: ElementBox | undefined = this.anchorTarget(context, anchor.anchor);
        const extent: readonly [number, number, number, number] | undefined = target === undefined ? undefined : this.contextBounds(context).get(target);
        if (extent === undefined) {
            return undefined;
        }
        const keyword: string = anchor.keyword ?? "";
        // §5.1: block and inline follow "the writing mode of the box's containing block", self-block and self-inline that
        // of the box, and a missing keyword is "whatever keyword matches the axis of the property".
        const flowing: boolean = (context.frame & BoxSizes.VERTICAL) === 0;
        const own: boolean = (this.sizes.frame(context.style) & BoxSizes.VERTICAL) === 0;
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
        // §2.1: anchor-name makes the element an anchor element "with a list of anchor names as specified" and its principal box the anchor box;
        // each anchor is kept with its ancestors, in tree order, and every box of the element stands for that principal box.
        path.push(box);
        const owner: ElementBox = this.claimOwner(box, path[path.length - 2]);
        const names: CssValue | undefined = box.style.values["anchor-name"];
        if (names !== undefined && this.anchorNames !== undefined && this.isAnchorable(box)) {
            for (const item of names.kind === "list" ? names.items : [names]) {
                if (item.kind === "ident" && item.name.startsWith("--")) {
                    const anchors: Array<ReadonlyArray<ElementBox>> = this.anchorNames.get(item.name) ?? [];
                    if (!anchors.some((anchor: ReadonlyArray<ElementBox>) => this.anchorOwner(anchor[anchor.length - 1]) === owner)) {
                        anchors.push([...path]);
                    }
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

    private claimOwner(box: ElementBox, parent?: ElementBox): ElementBox {
        // §2.1: the anchor box is the element's principal box, which a box wrapped in it stands for (CSS Display 3 §2: "the principal box contains
        // its descendant boxes"); the parts of an inline box that blocks split (CSS 2 §9.2.1.1) are one element, whose first part stands for all.
        const owners: Map<ElementBox, ElementBox> = this.anchorOwners as Map<ElementBox, ElementBox>;
        let owner: ElementBox = box.wrapped === true && parent !== undefined ? owners.get(parent) ?? parent : box;
        if (box.element !== undefined) {
            const byPseudo: Map<string, ElementBox> = this.elementOwners?.get(box.element) ?? new Map<string, ElementBox>();
            this.elementOwners?.set(box.element, byPseudo);
            owner = byPseudo.get(box.pseudoElement ?? "") ?? owner;
            byPseudo.set(box.pseudoElement ?? "", owner);
        }
        owners.set(box, owner);
        return owner;
    }

    private anchorOwner(box: ElementBox): ElementBox {
        // A box of the first line is a copy of its box, and stands for what that box stands for.
        const known: ElementBox | undefined = this.anchorOwners?.get(box);
        if (known !== undefined) {
            return known;
        }
        return box.element === undefined ? box : this.elementOwners?.get(box.element)?.get(box.pseudoElement ?? "") ?? box;
    }

    private isAnchorable(box: ElementBox): boolean {
        // §2.3: an acceptable anchor element "is either an element or a fully styleable tree-abiding pseudo-element", which CSS Pseudo-Elements 4 §4.1
        // makes ::before and ::after.
        return box.pseudoElement === undefined ? box.element !== undefined : box.pseudoElement === "before" || box.pseudoElement === "after";
    }

    private depthOf(path: ReadonlyArray<ElementBox>, owner: ElementBox): number {
        for (let index: number = path.length - 1; index >= 0; index--) {
            if (this.anchorOwner(path[index]) === owner) {
                return index;
            }
        }
        return -1;
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
        bounds: Map<ElementBox, [number, number, number, number]>, back: Transform, lens: Homography | undefined, view: Matrix4 | undefined): void {
        // A box in several fragments has the rectangle that holds them all, in the containing block's writing mode; a box that waits to be
        // positioned has none, and one that CSS Transforms 1 §10 does not display has no place.
        for (const child of children) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box" || (this.pending !== undefined && this.pending.has(piece))) {
                    continue;
                }
                const local: Transform = child.kind === "line" ? this.sizes.compose(transform, [1, 0, 0, 1, child.inline ?? 0, child.block]) : transform;
                const own: Homography | undefined | null = this.transforms.lens(lens, this.transforms.matrixOf(piece, local, view));
                if (own === null) {
                    continue;
                }
                const owner: ElementBox = this.anchorOwner(piece.box);
                const area: readonly [number, number, number, number] = this.sizes.mapped(local, piece.inline, piece.block, piece.inlineSize, piece.blockSize);
                const seen: Box | undefined = wanted.has(owner) ? this.transforms.projected(own, [area[0], area[1], area[2], area[3]]) : undefined;
                if (seen !== undefined) {
                    const placed: readonly [number, number, number, number] = this.sizes.mapped(back, seen[0], seen[1], seen[2], seen[3]);
                    const known: [number, number, number, number] | undefined = bounds.get(owner);
                    bounds.set(owner, known === undefined ? [placed[0], placed[1], placed[0] + placed[2], placed[1] + placed[3]]
                        : [Math.min(known[0], placed[0]), Math.min(known[1], placed[1]), Math.max(known[2], placed[0] + placed[2]), Math.max(known[3], placed[1] + placed[3])]);
                }
                if (piece.children !== undefined) {
                    this.anchorBounds(piece.children, this.sizes.compose(local, this.sizes.inside(piece, frame)), this.sizes.frame(piece.box.style), wanted, bounds, back, own,
                        this.transforms.childView(piece, local, view));
                }
            }
        }
    }

    private namedAnchor(path: ReadonlyArray<ElementBox>, box: ElementBox, name: string, bounds: ReadonlyMap<ElementBox, [number, number, number, number]>): ElementBox | undefined {
        // CSS Anchor Positioning 1 §2.3: "If an ancestor of query el satisfies the following conditions, return the nearest
        // such element to query el. Otherwise, return the last element el in tree order that satisfies the conditions."
        const anchors: ReadonlyArray<ReadonlyArray<ElementBox>> | undefined = this.anchorNames?.get(name);
        const self: ElementBox = this.anchorOwner(box);
        const limit: ElementBox | undefined = this.anchorScope(path, name, path.length - 2);
        let found: ElementBox | undefined;
        let depth: number = -1;
        for (const anchor of anchors ?? []) {
            const candidate: ElementBox = this.anchorOwner(anchor[anchor.length - 1]);
            // §2.2: anchor-scope keeps a name "in scope only for this element's descendants", and limits the descendants
            // "to only match these anchor names to anchor elements within this subtree."
            const scope: ElementBox | undefined = this.anchorScope(anchor, name, anchor.length - 1);
            const visible: boolean = scope === undefined || (this.anchorOwner(scope) !== self && this.depthOf(path, this.anchorOwner(scope)) >= 0);
            if (candidate === self || !bounds.has(candidate) || !visible || (limit !== undefined && this.depthOf(anchor, this.anchorOwner(limit)) < 0)) {
                continue;
            }
            const level: number = this.depthOf(path, candidate);
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

    private defaultAnchor(path: ReadonlyArray<ElementBox>, bounds: () => ReadonlyMap<ElementBox, [number, number, number, number]>, style?: ComputedStyle): ElementBox | undefined {
        // CSS Anchor Positioning 1 §2.4: position-anchor gives the default anchor element; normal "behaves as none" when position-area is none
        // and as auto otherwise, and auto uses the implicit anchor element; a position option can change both properties of the box.
        const box: ElementBox | undefined = path[path.length - 1];
        if (box === undefined) {
            return undefined;
        }
        const values: Readonly<Record<string, CssValue>> = (style ?? box.style).values;
        const value: CssValue | undefined = values["position-anchor"];
        if (value !== undefined && value.kind === "ident" && value.name.startsWith("--")) {
            return this.namedAnchor(path, box, value.name, bounds());
        }
        let keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "normal";
        const area: CssValue | undefined = values["position-area"];
        if (keyword === "normal") {
            keyword = area === undefined || (area.kind === "ident" && area.lower === "none") ? "none" : "auto";
        }
        // The originating element of a pseudo-element, and the parent of an element, are the nearest element above it, past any anonymous box.
        let parent: number = path.length - 2;
        while (parent >= 0 && (path[parent].element === undefined || path[parent].pseudoElement !== undefined)) {
            parent--;
        }
        let anchor: ElementBox | undefined;
        if (keyword === "auto" && box.pseudoElement !== undefined && parent >= 0) {
            // §2.4.1: "The implicit anchor element of a pseudo-element is its originating element"; the boxes of the elements are indexed with the bounds.
            bounds();
            anchor = this.anchorOwner(path[parent]);
        } else if (keyword === "match-parent" && parent >= 0) {
            // match-parent "Uses the same default anchor element as the parent", or as the originating element of a pseudo-element.
            anchor = this.defaultAnchor(path.slice(0, parent + 1), bounds);
        }
        return anchor !== undefined && bounds().has(anchor) ? anchor : undefined;
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
            const final: readonly [number, number] = this.replacedSizes(used, this.defaultObject(box), inlineStretch);
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
        const defaults: readonly [number, number] = this.defaultObject(box);
        const own: readonly [number, number] = this.replacedSizes(bare, defaults, stretch);
        return [this.replacedSizes(bare, defaults, 0)[0], own[0], own[1]];
    }

    private defaultObject(box: ElementBox): readonly [number, number] {
        // CSS Writing Modes 4 §3.2: "the default object size of 300px×150px does not re-orient", so in a vertical writing mode
        // the inline size is the 150px height.
        return (this.sizes.frame(box.style) & BoxSizes.VERTICAL) !== 0 ? [DEFAULT_HEIGHT, DEFAULT_WIDTH] : [DEFAULT_WIDTH, DEFAULT_HEIGHT];
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

    private replacedSizes(sizes: UsedSizes, defaults: readonly [number, number], available?: number): readonly [number, number] {
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
            const block: number = sizes.blockSize !== undefined ? sizes.blockSize + blockExtra : (ratio !== undefined ? inline / ratio : down ?? defaults[1] + blockExtra);
            pair = [inline, this.clamped(block, minimum[1], maximum[1])];
        } else if (sizes.blockSize !== undefined) {
            const block: number = this.clamped(sizes.blockSize + blockExtra, minimum[1], maximum[1]);
            pair = [this.clamped(ratio !== undefined ? block * ratio : across ?? defaults[0] + inlineExtra, minimum[0], maximum[0]), block];
        } else {
            pair = this.automaticSizes(sizes, minimum, maximum, across, down, inlineExtra, blockExtra, defaults, available);
        }
        return [Math.max(0, pair[0] - inlineExtra), Math.max(0, pair[1] - blockExtra)];
    }

    private automaticSizes(sizes: UsedSizes, minimum: readonly [number, number], maximum: readonly [number, number], across: number | undefined, down: number | undefined,
        inlineExtra: number, blockExtra: number, defaults: readonly [number, number], available?: number): readonly [number, number] {
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
            width = (available !== undefined && available > 0 ? Math.min(defaults[0], available) : defaults[0]) + inlineExtra;
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
            height = (across !== undefined || lowInline > 0 ? defaults[1] : (width - inlineExtra) * defaults[1] / defaults[0]) + blockExtra;
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
        // CSS Display 3 §2.2, CSS Overflow 3 §3, CSS Containment 2 §3.2 and §3.4, CSS Conditional 5 §5.1, CSS Align 3 §5.1.1 and CSS Multicol 1
        // §2: flow-root, other inner display types, replaced boxes, overflow, containment, size queries, align-content and columns.
        return box.replaced || box.display.inner !== "flow" || box.display.internal !== undefined || !this.hasVisibleOverflow(box)
            || (this.containment(box) & OWN_CONTEXT) !== 0 || this.alignsContent(box) || this.isMulticol(box);
    }

    private alignsContent(box: ElementBox): boolean {
        // CSS Align 3 §5.1.1: "All values other than normal force the block container to establish an independent formatting context";
        // a table cell aligns its content in its row, where the table lays it out.
        return !box.replaced && box.display.internal !== "table-cell" && this.displays.isBlockContainer(box.display)
            && !this.alignment.isNormal(box.style.values["align-content"]);
    }

    private hasFreeSpace(box: ElementBox, sizes: UsedSizes): boolean {
        // Without a definite, minimum or maximum block size, or size containment, the content box is as tall as the content.
        return sizes.blockSize !== undefined || sizes.minBlockSize !== undefined || sizes.maxBlockSize !== undefined
            || (this.containment(box) & DisplayTypes.SIZE_CONTAINMENT) !== 0;
    }

    private alignmentBreak(fragmenting: Fragmentation): Candidate {
        // CSS Fragmentation 4 §4.1 class C: the gap that the alignment leaves before the content is a break point (§4.4 rule 4: unless an
        // ancestor avoids breaks inside), usable when the gap starts inside the fragmentainer, which the gap then fills as content does.
        const local: Candidate = this.record(fragmenting, fragmenting.avoid > 0 ? APPEAL_AVOID : APPEAL_PERFECT, undefined);
        fragmenting.filled = true;
        return local;
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
