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

import type { MarginBoxName } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { BlockLayout } from "../layout/BlockLayout.js";
import type { UsedSizes } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment, LineFragment } from "../layout/Fragment.js";
import type { BoxNode, ElementBox, InlineSequence } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { ContentValues } from "../pdf/ContentValues.js";
import type { CrossReferences } from "../pdf/CrossReferences.js";
import type { Counter, CounterSet } from "../pdf/CounterScopes.js";
import { CounterScopes } from "../pdf/CounterScopes.js";
import type { CounterStyles } from "../pdf/CounterStyles.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import type { ContentState } from "../pdf/GeneratedContent.js";
import { GeneratedContent } from "../pdf/GeneratedContent.js";
import type { InlineTextBuilder } from "../pdf/InlineTextBuilder.js";
import type { MarginAreas, PageCanvas, PageMarginBox, Rectangle } from "../pdf/PageCanvas.js";
import type { QuotePair } from "../pdf/QuoteSystems.js";
import { QuoteSystems } from "../pdf/QuoteSystems.js";
import { WhiteSpaceProcessor } from "../pdf/WhiteSpaceProcessor.js";
import type { NamedValues } from "./NamedValues.js";

type Sides = [number, number, number, number];

type Margins = [number | undefined, number | undefined, number | undefined, number | undefined];

interface Dimensions {
    margin: Margins;
    border: Sides;
    padding: Sides;
    width?: number;
    height?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
}

interface Built {
    box: ElementBox;
    dimensions: Dimensions;
}

interface Slot {
    generated: boolean;
    auto: boolean;
    outer: number;
    min: number;
    max: number;
    extra: number;
    least?: number;
    most?: number;
}

const TOP: number = 0;
const RIGHT: number = 1;
const BOTTOM: number = 2;
const LEFT: number = 3;
const BLOCK_DISPLAY: DisplayType = { outer: "block", inner: "flow", listItem: false };
const MARGIN_DISPLAY: DisplayType = { outer: "block", inner: "flow-root", listItem: false };
const PAINT_ORDER: ReadonlyArray<MarginBoxName> = ["top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "right-top", "right-middle", "right-bottom",
    "bottom-right-corner", "bottom-right", "bottom-center", "bottom-left", "bottom-left-corner", "left-bottom", "left-middle", "left-top"];
const NOT_GENERATED: Slot = { generated: false, auto: false, outer: 0, min: 0, max: 0, extra: 0 };

export class MarginBoxes {

    private readonly layout: BlockLayout;
    private readonly text: InlineTextBuilder;
    private readonly sizes: BoxSizes = new BoxSizes((): number | undefined => undefined);
    private readonly scopes: CounterScopes = new CounterScopes();
    private readonly values: ContentValues = new ContentValues();
    private readonly content: GeneratedContent;
    private readonly quotes: QuoteSystems = new QuoteSystems();
    private readonly references: CrossReferences;
    private readonly fill: (box: ElementBox, strings: NamedValues<string>) => void;

    constructor(layout: BlockLayout, text: InlineTextBuilder, counterStyles: CounterStyles, references: CrossReferences,
        fill: (box: ElementBox, strings: NamedValues<string>) => void) {
        this.layout = layout;
        this.text = text;
        this.content = new GeneratedContent(this.scopes, counterStyles, this.values);
        this.references = references;
        this.fill = fill;
    }

    boxes(canvas: PageCanvas, counters: CounterSet, strings: NamedValues<string>, running: NamedValues<ElementBox>): Array<BoxFragment> {
        // CSS Paged Media 3 §3.1: page-margin boxes are painted from @top-left-corner clockwise.
        const built: Map<MarginBoxName, Built> = new Map<MarginBoxName, Built>();
        for (const margin of canvas.marginBoxes) {
            const box: ElementBox | undefined = this.build(margin, counters, strings, running);
            if (box !== undefined) {
                built.set(margin.name, { box, dimensions: { margin: [0, 0, 0, 0], border: [0, 0, 0, 0], padding: [0, 0, 0, 0] } });
            }
        }
        const placed: Map<MarginBoxName, BoxFragment> = new Map<MarginBoxName, BoxFragment>();
        const areas: MarginAreas = canvas.marginAreas;
        this.corner("top-left-corner", areas.topLeftCorner, true, true, built, placed);
        this.corner("top-right-corner", areas.topRightCorner, false, true, built, placed);
        this.corner("bottom-right-corner", areas.bottomRightCorner, false, false, built, placed);
        this.corner("bottom-left-corner", areas.bottomLeftCorner, true, false, built, placed);
        this.across(["top-left", "top-center", "top-right"], areas.top, true, built, placed);
        this.across(["bottom-left", "bottom-center", "bottom-right"], areas.bottom, false, built, placed);
        this.down(["left-top", "left-middle", "left-bottom"], areas.left, true, built, placed);
        this.down(["right-top", "right-middle", "right-bottom"], areas.right, false, built, placed);
        const ordered: Array<BoxFragment> = [];
        for (const name of PAINT_ORDER) {
            const fragment: BoxFragment | undefined = placed.get(name);
            if (fragment !== undefined) {
                ordered.push(fragment);
            }
        }
        return ordered;
    }

    private build(margin: PageMarginBox, counters: CounterSet, strings: NamedValues<string>, running: NamedValues<ElementBox>): ElementBox | undefined {
        // CSS Paged Media 3 §6.1: the counters of the margin context hide those of the page context and of the document.
        const style: ComputedStyle = margin.style;
        const items: Array<CssValue> | undefined = this.values.items(style.values["content"]);
        if (items === undefined) {
            return undefined;
        }
        const text: ComputedStyle = { values: style.inherited, inherited: style.inherited, custom: style.custom };
        const node: number = this.scopes.node();
        const own: Array<Counter> = counters.map((counter: Counter): Counter => ({ ...counter }));
        this.scopes.apply(own, node, this.scopes.changes(0, style.values["counter-reset"]), this.scopes.changes(1, style.values["counter-increment"]),
            this.scopes.changes(0, style.values["counter-set"]));
        const state: ContentState = { counters: own, node, quotes: (): ReadonlyArray<QuotePair> => this.quotePairs(style.values["quotes"]), references: this.references };
        this.content.quoteDepth = 0;
        const children: Array<BoxNode> = [];
        let element: boolean = false;
        for (const item of items) {
            const name: CssValue | undefined = item.kind === "function" ? item.args[0] : undefined;
            const which: CssValue | undefined = item.kind === "function" ? item.args[1] : undefined;
            const keyword: string = which !== undefined && which.kind === "ident" ? which.lower : "first";
            if (item.kind === "function" && item.name === "string" && name !== undefined && name.kind === "ident") {
                children.push(...this.content.evaluate([{ kind: "string", value: strings.value(name.name, keyword) ?? "" }], text, state));
            } else if (item.kind === "function" && item.name === "element" && name !== undefined && name.kind === "ident") {
                const found: ElementBox | undefined = running.value(name.name, keyword);
                if (found !== undefined) {
                    this.fill(found, strings);
                    children.push({ ...found, placement: "in-flow" });
                    element = true;
                }
            } else {
                children.push(...this.content.evaluate([item], text, state));
            }
        }
        const box: ElementBox = {
            kind: "box", style, display: MARGIN_DISPLAY, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: "", startPage: "",
            endPage: "", children: this.blockChildren(children, text)
        };
        // The text of a running element was prepared with the document; only the text made here is prepared now.
        if (!element || box.children.some((child: BoxNode) => !(child.kind === "box" && child.display.outer === "block"))) {
            const sequences: Array<InlineSequence> = new WhiteSpaceProcessor().process(box);
            this.text.prepare(sequences);
        }
        return box;
    }

    private blockChildren(children: Array<BoxNode>, text: ComputedStyle): Array<BoxNode> {
        // CSS 2 §9.2.1.1: in a block container with block-level boxes, each run of inline-level content goes into an
        // anonymous block box.
        const isBlock: (node: BoxNode) => boolean = (node: BoxNode): boolean => node.kind === "box" && node.display.outer === "block";
        if (!children.some(isBlock) || children.every(isBlock)) {
            return children;
        }
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                result.push({
                    kind: "box", style: text, display: BLOCK_DISPLAY, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: "", startPage: "",
                    endPage: "", children: run
                });
                run = [];
            }
        };
        for (const child of children) {
            if (isBlock(child)) {
                flush();
                result.push(child);
            } else {
                run.push(child);
            }
        }
        flush();
        return result;
    }

    private quotePairs(value?: CssValue): ReadonlyArray<QuotePair> {
        // CSS Content 3 §2.4.1: auto follows the content language, which a page-margin box does not have.
        if (value === undefined || value.kind === "ident") {
            return value !== undefined && value.lower === "none" ? [] : this.quotes.forLanguage("");
        }
        const strings: Array<string> = [];
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind === "string") {
                strings.push(item.value);
            }
        }
        const pairs: Array<QuotePair> = [];
        for (let index: number = 0; index + 1 < strings.length; index += 2) {
            pairs.push([strings[index], strings[index + 1]]);
        }
        return pairs;
    }

    private measure(built: Built, width: number, height: number): Dimensions {
        // CSS Paged Media 3 §6: percentages of margins and padding refer to the width of the containing block on the left
        // and right sides and to its height on the top and bottom sides.
        const style: ComputedStyle = built.box.style;
        const frame: number = this.sizes.frame(style);
        if ((frame & BoxSizes.VERTICAL) !== 0) {
            throw new Error("Page-margin boxes in vertical writing modes are not implemented");
        }
        const across: UsedSizes = this.sizes.of(style, width, height);
        const down: UsedSizes = this.sizes.of(style, width, height, height);
        const dimensions: Dimensions = built.dimensions;
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(frame, side);
            const source: UsedSizes = physical === TOP || physical === BOTTOM ? down : across;
            dimensions.margin[physical] = this.sizes.margin(source, side);
            dimensions.border[physical] = source.border === undefined ? 0 : source.border[side];
            dimensions.padding[physical] = source.padding === undefined ? 0 : source.padding[side];
        }
        this.copy(dimensions, "width", across.inlineSize);
        this.copy(dimensions, "height", across.blockSize);
        this.copy(dimensions, "minWidth", across.minInlineSize);
        this.copy(dimensions, "maxWidth", across.maxInlineSize);
        this.copy(dimensions, "minHeight", across.minBlockSize);
        this.copy(dimensions, "maxHeight", across.maxBlockSize);
        return dimensions;
    }

    private copy(dimensions: Dimensions, field: "width" | "height" | "minWidth" | "maxWidth" | "minHeight" | "maxHeight", value?: number): void {
        if (value === undefined) {
            delete dimensions[field];
        } else {
            dimensions[field] = value;
        }
    }

    private corner(name: MarginBoxName, area: Rectangle, left: boolean, top: boolean, built: Map<MarginBoxName, Built>, placed: Map<MarginBoxName, BoxFragment>): void {
        const entry: Built | undefined = built.get(name);
        if (entry === undefined) {
            return;
        }
        const dimensions: Dimensions = this.measure(entry, area.width, area.height);
        const across: readonly [number, number] = this.fixedWidth(area.width, dimensions, left);
        const down: readonly [number, number] = this.fixedHeight(area.height, dimensions, top);
        placed.set(name, this.place(entry, dimensions, area.x + across[0], area.y + down[0], across[1], down[1]));
    }

    private across(names: readonly [MarginBoxName, MarginBoxName, MarginBoxName], area: Rectangle, top: boolean, built: Map<MarginBoxName, Built>,
        placed: Map<MarginBoxName, BoxFragment>): void {
        const slots: Array<Slot> = [];
        const measured: Array<Dimensions | undefined> = [];
        for (const name of names) {
            const entry: Built | undefined = built.get(name);
            const dimensions: Dimensions | undefined = entry === undefined ? undefined : this.measure(entry, area.width, area.height);
            measured.push(dimensions);
            if (entry === undefined || dimensions === undefined) {
                slots.push(NOT_GENERATED);
                continue;
            }
            // §5.3.2.1: "If the margin-left or margin-right property of any of the three boxes computes to auto, the used
            // value is zero."
            const extra: number = (dimensions.margin[LEFT] ?? 0) + (dimensions.margin[RIGHT] ?? 0) + dimensions.border[LEFT] + dimensions.padding[LEFT]
                + dimensions.border[RIGHT] + dimensions.padding[RIGHT];
            const content: readonly [number, number] = this.layout.marginContent(entry.box);
            slots.push(this.slot(dimensions.width, extra, content, dimensions.minWidth, dimensions.maxWidth));
        }
        const outer: readonly [number, number, number] = this.constrained(area.width, slots);
        const starts: readonly [number, number, number] = [area.x, area.x + (area.width - outer[1]) / 2, area.x + area.width - outer[2]];
        for (const [index, name] of names.entries()) {
            const entry: Built | undefined = built.get(name);
            const dimensions: Dimensions | undefined = measured[index];
            if (entry === undefined || dimensions === undefined) {
                continue;
            }
            const before: number = dimensions.margin[LEFT] ?? 0;
            const width: number = outer[index] - before - (dimensions.margin[RIGHT] ?? 0);
            const down: readonly [number, number] = this.fixedHeight(area.height, dimensions, top);
            placed.set(name, this.place(entry, dimensions, starts[index] + before, area.y + down[0], width, down[1]));
        }
    }

    private down(names: readonly [MarginBoxName, MarginBoxName, MarginBoxName], area: Rectangle, left: boolean, built: Map<MarginBoxName, Built>,
        placed: Map<MarginBoxName, BoxFragment>): void {
        // The content heights that §5.3.2 needs follow from laying the boxes out at the widths that §5.3.3 fixes.
        const slots: Array<Slot> = [];
        const measured: Array<readonly [Dimensions, readonly [number, number], BoxFragment] | undefined> = [];
        for (const name of names) {
            const entry: Built | undefined = built.get(name);
            if (entry === undefined) {
                measured.push(undefined);
                slots.push(NOT_GENERATED);
                continue;
            }
            const dimensions: Dimensions = this.measure(entry, area.width, area.height);
            const across: readonly [number, number] = this.fixedWidth(area.width, dimensions, left);
            const laid: BoxFragment = this.laid(entry.box, dimensions, across[1]);
            const vertical: number = dimensions.border[TOP] + dimensions.padding[TOP] + dimensions.border[BOTTOM] + dimensions.padding[BOTTOM];
            const extra: number = (dimensions.margin[TOP] ?? 0) + (dimensions.margin[BOTTOM] ?? 0) + vertical;
            const height: number = laid.blockSize - vertical;
            measured.push([dimensions, across, laid]);
            slots.push(this.slot(dimensions.height, extra, [height, height], dimensions.minHeight, dimensions.maxHeight));
        }
        const outer: readonly [number, number, number] = this.constrained(area.height, slots);
        const starts: readonly [number, number, number] = [area.y, area.y + (area.height - outer[1]) / 2, area.y + area.height - outer[2]];
        for (const [index, name] of names.entries()) {
            const entry: readonly [Dimensions, readonly [number, number], BoxFragment] | undefined = measured[index];
            if (entry === undefined) {
                continue;
            }
            const dimensions: Dimensions = entry[0];
            const before: number = dimensions.margin[TOP] ?? 0;
            const vertical: number = dimensions.border[TOP] + dimensions.padding[TOP] + dimensions.border[BOTTOM] + dimensions.padding[BOTTOM];
            const height: number = outer[index] - before - (dimensions.margin[BOTTOM] ?? 0) - vertical;
            placed.set(name, this.aligned(entry[2], dimensions, area.x + entry[1][0], starts[index] + before, height));
        }
    }

    private slot(size: number | undefined, extra: number, content: readonly [number, number], least?: number, most?: number): Slot {
        // §5.3.1: the outer min and max sizes use the min-content and max-content sizes when the size is auto.
        const slot: Slot = size === undefined ? { generated: true, auto: true, outer: 0, min: content[0] + extra, max: content[1] + extra, extra }
            : { generated: true, auto: false, outer: size + extra, min: size + extra, max: size + extra, extra };
        if (least !== undefined) {
            slot.least = least;
        }
        if (most !== undefined) {
            slot.most = most;
        }
        return slot;
    }

    private constrained(available: number, slots: Array<Slot>): readonly [number, number, number] {
        // §5.3.2.3: the sizes are found without the minimum and maximum sizes, again with the maximum as the size of a box
        // that it exceeds, and again with the minimum as the size of a box that is below it.
        let outer: readonly [number, number, number] = this.resolved(available, slots);
        for (const limit of ["most", "least"] as Array<"most" | "least">) {
            let changed: boolean = false;
            for (const [index, slot] of slots.entries()) {
                const bound: number | undefined = slot[limit];
                const size: number = outer[index] - slot.extra;
                if (slot.generated && bound !== undefined && (limit === "most" ? size > bound : size < bound)) {
                    slots[index] = { ...slot, auto: false, outer: bound + slot.extra, min: bound + slot.extra, max: bound + slot.extra };
                    changed = true;
                }
            }
            if (changed) {
                outer = this.resolved(available, slots);
            }
        }
        return outer;
    }

    private resolved(available: number, slots: ReadonlyArray<Slot>): readonly [number, number, number] {
        // §5.3.2.2: without a middle box the others share the available width; with one, the middle box is sized against
        // an imaginary box twice as large as the larger side box, which keeps it centered, and the side boxes take the rest.
        const [start, middle, end]: ReadonlyArray<Slot> = slots;
        if (!middle.generated) {
            if (start.auto && end.auto) {
                const shared: readonly [number, number] = this.distributed(available, start, end);
                return [shared[0], 0, shared[1]];
            }
            return [start.auto ? available - end.outer : start.outer, 0, end.auto ? available - start.outer : end.outer];
        }
        let center: number = middle.outer;
        if (middle.auto) {
            const least: number = 2 * Math.max(start.auto ? start.min : start.outer, end.auto ? end.min : end.outer);
            const most: number = 2 * Math.max(start.auto ? start.max : start.outer, end.auto ? end.max : end.outer);
            center = this.distributed(available, middle, { generated: true, auto: true, outer: 0, min: least, max: most, extra: 0 })[0];
        }
        const rest: number = (available - center) / 2;
        return [start.auto ? rest : start.outer, center, end.auto ? rest : end.outer];
    }

    private distributed(available: number, first: Slot, second: Slot): readonly [number, number] {
        // §5.3.2.2: the flex space goes by the max-content sizes, or else by their difference from the min-content sizes, or
        // else by the min-content sizes; "both flex factors are assumed to be 1 if their sum is equal to zero".
        const most: number = first.max + second.max;
        if (most < available) {
            return this.shared(available - most, first.max, second.max, first.max, second.max);
        }
        const least: number = first.min + second.min;
        if (least < available) {
            return this.shared(available - least, first.min, second.min, first.max - first.min, second.max - second.min);
        }
        return this.shared(available - least, first.min, second.min, first.min, second.min);
    }

    private shared(flex: number, first: number, second: number, firstFactor: number, secondFactor: number): readonly [number, number] {
        const sum: number = firstFactor + secondFactor;
        const factors: readonly [number, number] = sum === 0 ? [1, 1] : [firstFactor, secondFactor];
        const total: number = sum === 0 ? 2 : sum;
        return [first + flex * factors[0] / total, second + flex * factors[1] / total];
    }

    private fixedWidth(depth: number, dimensions: Dimensions, left: boolean): readonly [number, number] {
        // §5.3.3: an over-constrained left box ignores "the specified value of margin-left", and a right box margin-right.
        const edges: readonly [number, number] = [dimensions.border[LEFT] + dimensions.padding[LEFT], dimensions.border[RIGHT] + dimensions.padding[RIGHT]];
        return this.fixed(depth, dimensions.margin[LEFT], dimensions.width, dimensions.margin[RIGHT], edges, left, dimensions.minWidth, dimensions.maxWidth);
    }

    private fixedHeight(depth: number, dimensions: Dimensions, top: boolean): readonly [number, number] {
        const edges: readonly [number, number] = [dimensions.border[TOP] + dimensions.padding[TOP], dimensions.border[BOTTOM] + dimensions.padding[BOTTOM]];
        return this.fixed(depth, dimensions.margin[TOP], dimensions.height, dimensions.margin[BOTTOM], edges, top, dimensions.minHeight, dimensions.maxHeight);
    }

    private fixed(depth: number, before: number | undefined, size: number | undefined, after: number | undefined, edges: readonly [number, number], outerFirst: boolean,
        least?: number, most?: number): readonly [number, number] {
        // §5.3: "The rules for applying min-height, max-height, min-width, and max-width" apply, so a size that breaks them
        // is solved again with the limit as the size.
        let solved: readonly [number, number] = this.solved(depth, before, size, after, edges, outerFirst);
        const content: number = solved[1] - edges[0] - edges[1];
        if (most !== undefined && content > most) {
            solved = this.solved(depth, before, most, after, edges, outerFirst);
        }
        if (least !== undefined && solved[1] - edges[0] - edges[1] < least) {
            solved = this.solved(depth, before, least, after, edges, outerFirst);
        }
        return solved;
    }

    private solved(depth: number, before: number | undefined, size: number | undefined, after: number | undefined, edges: readonly [number, number],
        outerFirst: boolean): readonly [number, number] {
        // §5.3.3: the margins, edges and size add up to the page margin; auto margins are zero when the rest is larger, an
        // over-constrained box drops its outer margin, an auto size takes what is left and two auto margins are equal.
        let start: number | undefined = before;
        let end: number | undefined = after;
        const inner: number = edges[0] + edges[1];
        if (inner + (size ?? 0) + (start ?? 0) + (end ?? 0) > depth) {
            start = start ?? 0;
            end = end ?? 0;
        }
        if (size !== undefined && start !== undefined && end !== undefined) {
            if (outerFirst) {
                start = undefined;
            } else {
                end = undefined;
            }
        }
        let used: number;
        if (size === undefined) {
            start = start ?? 0;
            end = end ?? 0;
            used = depth - start - end - inner;
        } else {
            used = size;
            if (start === undefined && end === undefined) {
                start = (depth - size - inner) / 2;
            } else if (start === undefined) {
                start = depth - size - inner - (end ?? 0);
            }
        }
        return [start ?? 0, Math.max(0, used) + inner];
    }

    private place(built: Built, dimensions: Dimensions, x: number, y: number, width: number, height: number): BoxFragment {
        return this.aligned(this.laid(built.box, dimensions, width), dimensions, x, y, height - dimensions.border[TOP] - dimensions.padding[TOP]
            - dimensions.border[BOTTOM] - dimensions.padding[BOTTOM]);
    }

    private laid(box: ElementBox, dimensions: Dimensions, width: number): BoxFragment {
        const frame: number = this.sizes.frame(box.style);
        const border: [number, number, number, number] = [0, 0, 0, 0];
        const padding: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(frame, side);
            border[side] = dimensions.border[physical];
            padding[side] = dimensions.padding[physical];
        }
        const sizes: UsedSizes = { border, padding };
        const inner: number = width - dimensions.border[LEFT] - dimensions.padding[LEFT] - dimensions.border[RIGHT] - dimensions.padding[RIGHT];
        return this.layout.marginBox(box, sizes, Math.max(0, inner));
    }

    private aligned(fragment: BoxFragment, dimensions: Dimensions, x: number, y: number, height: number): BoxFragment {
        // CSS Paged Media 3 §6: "On page-margin boxes, the vertical-align property behaves as specified for table cells", in
        // the vertical dimension, which CSS Inline 3 §4.2 gives by baseline-shift and alignment-baseline.
        const vertical: number = dimensions.border[TOP] + dimensions.padding[TOP] + dimensions.border[BOTTOM] + dimensions.padding[BOTTOM];
        const content: number = fragment.blockSize - vertical;
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        const shift: CssValue | undefined = values["baseline-shift"];
        const middle: CssValue | undefined = values["alignment-baseline"];
        let share: number = 0;
        if (shift !== undefined && shift.kind === "ident" && shift.lower === "bottom") {
            share = 1;
        } else if (middle !== undefined && middle.kind === "ident" && middle.lower === "middle") {
            share = 0.5;
        }
        const distance: number = (height - content) * share;
        for (const child of fragment.children ?? []) {
            (child as BoxFragment | LineFragment).block += distance;
        }
        fragment.inline = x;
        fragment.block = y;
        fragment.blockSize = Math.max(0, height) + vertical;
        return fragment;
    }
}
