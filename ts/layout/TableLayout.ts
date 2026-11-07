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
import type { BoxNode, ElementBox } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import type { BlockLayout } from "./BlockLayout.js";
import type { UsedSizes } from "./BoxSizes.js";
import { BoxSizes } from "./BoxSizes.js";
import type { BoxFragment, BreakToken, CollapsedBorders, EdgeSource, LineFragment, Sides } from "./Fragment.js";

interface Slot {
    cell: ElementBox;
    row: number;
    column: number;
}

interface Grid {
    table: ElementBox;
    rows: Array<ElementBox>;
    cells: Array<Array<Slot>>;
    count: number;
    declared: number;
    header: number;
    footer: number;
    groups?: Map<ElementBox, ElementBox>;
    columns?: Map<number, ElementBox>;
    columnGroups?: Map<number, ElementBox>;
    edges?: Map<number, EdgeSource>;
    resolved?: Uint8Array;
}

const SIDES: number = 4;
const CELL_ORIGIN: number = 6;
const ROW_ORIGIN: number = 5;
const ROW_GROUP_ORIGIN: number = 4;
const COLUMN_ORIGIN: number = 3;
const COLUMN_GROUP_ORIGIN: number = 2;
const TABLE_ORIGIN: number = 1;
const STYLE_RANKS: ReadonlyArray<string> = ["inset", "groove", "outset", "ridge", "dotted", "dashed", "solid", "double"];
const ROW_GROUPS: ReadonlySet<string> = new Set<string>(["table-row-group", "table-header-group", "table-footer-group"]);
const UNFRAGMENTED: readonly [number, number, boolean] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, false];
const TOLERANCE: number = 0.001;
const PROPORTIONAL: ReadonlyArray<boolean> = [true, false, true, false, false];
const MISSING_CELL: DisplayType = { internal: "table-cell", outer: "block", inner: "flow-root", listItem: false };

export class TableLayout {

    private readonly host: BlockLayout;
    private readonly sizes: BoxSizes;
    private readonly grids: WeakMap<ElementBox, Grid> = new WeakMap<ElementBox, Grid>();
    private gridWidth?: number;
    private measured?: readonly [ElementBox, readonly [Float64Array, Float64Array]];
    private constraints?: readonly [ElementBox, Uint8Array, Uint8Array];

    constructor(host: BlockLayout, sizes: BoxSizes) {
        this.host = host;
        this.sizes = sizes;
    }

    isGrid(box: ElementBox): boolean {
        return box.display.inner === "table" && box.display.internal === undefined && box.display.box === undefined;
    }

    isRowGroup(box: ElementBox): boolean {
        return box.display.internal !== undefined && ROW_GROUPS.has(box.display.internal);
    }

    edgeItem(box: ElementBox, first: boolean): ElementBox | undefined {
        // CSS Fragmentation 4 §3.1.1: the first and the last row, in the order they are laid out, are at the edges of the
        // table and of their row group.
        if (this.isGrid(box)) {
            const grid: Grid = this.structure(box);
            const row: ElementBox | undefined = grid.rows[first ? 0 : grid.rows.length - 1];
            return row === undefined ? undefined : grid.groups?.get(row) ?? row;
        }
        const rows: Array<ElementBox> = box.children.filter((node: BoxNode): node is ElementBox => node.kind === "box" && node.placement === "in-flow"
            && node.display.internal === "table-row");
        return rows[first ? 0 : rows.length - 1];
    }

    isWrapper(box: ElementBox): boolean {
        return box.element === undefined && box.display.inner === "flow-root" && box.children.some((child: BoxNode) => child.kind === "box" && this.isGrid(child));
    }

    rowBox(box: ElementBox, index: number): ElementBox | undefined {
        return this.structure(box).rows[index];
    }

    wrapperSize(wrapper: ElementBox, available: number): number {
        // CSS 2 §17.5.2: "The width of the table wrapper box is the border-edge width of the table box inside it", and a
        // caption is at least as wide as its minimum content.
        let size: number = 0;
        for (const child of wrapper.children) {
            if (child.kind !== "box" || child.placement !== "in-flow") {
                continue;
            }
            if (!this.isGrid(child)) {
                size = Math.max(size, this.host.intrinsic(child)[0]);
                continue;
            }
            const content: readonly [number, number] = this.intrinsic(child);
            const sizes: UsedSizes = this.sizes.of(child.style, available);
            const grid: Grid = this.structure(child);
            const edges: number = this.tableEdges(child, grid, sizes, BoxSizes.INLINE_START) + this.tableEdges(child, grid, sizes, BoxSizes.INLINE_END);
            this.gridWidth = Math.max(content[0], this.preferred(sizes, content, edges, available) ?? this.automatic(sizes, content, edges, available));
            size = Math.max(size, this.gridWidth);
        }
        return size;
    }

    intrinsic(box: ElementBox): readonly [number, number] {
        const grid: Grid = this.structure(box);
        const sizes: UsedSizes = this.sizes.of(box.style);
        const tracks: readonly [Float64Array, Float64Array] = this.tracks(box, grid);
        const edges: number = this.tableEdges(box, grid, sizes, BoxSizes.INLINE_START) + this.tableEdges(box, grid, sizes, BoxSizes.INLINE_END);
        const outer: number = edges + this.spacing(box)[0] * (grid.count === 0 ? 0 : grid.count + 1);
        let minimum: number = outer;
        let maximum: number = outer;
        for (let column: number = 0; column < grid.count; column++) {
            minimum += tracks[0][column];
            maximum += tracks[1][column];
        }
        // CSS 2 §17.6.1: the width of the table box holds the border spacing at its two ends, so only its edges are added.
        const given: number | undefined = this.preferred(sizes, [minimum, maximum], edges);
        return given === undefined ? [minimum, maximum] : [Math.max(minimum, given), Math.max(minimum, given)];
    }

    private preferred(sizes: UsedSizes, content: readonly [number, number], edges: number, available?: number): number | undefined {
        // CSS Sizing 3 §3.2 and CSS Sizing 4 §4.2: the border-box inline size that the table box asks for, with the sizing
        // keywords and, when only the block size is given, the size that the preferred aspect ratio gives.
        const keyword: string = sizes.keywords === undefined ? "" : sizes.keywords[BoxSizes.PREFERRED_INLINE];
        let size: number | undefined = sizes.inlineSize === undefined ? undefined : sizes.inlineSize + edges;
        if (keyword === "min-content" || keyword === "max-content") {
            size = keyword === "min-content" ? content[0] : content[1];
        } else if (keyword === BoxSizes.FIT_FUNCTION && sizes.fits !== undefined) {
            size = Math.min(Math.max(content[0], sizes.fits[BoxSizes.PREFERRED_INLINE] + edges), content[1]);
        } else if ((keyword === "stretch" || keyword === "contain") && available !== undefined) {
            size = available;
        } else if (size === undefined && keyword === "" && sizes.ratio !== undefined && sizes.blockSize !== undefined) {
            size = this.sizes.transferred(sizes, sizes.blockSize, true) + edges;
        }
        return size === undefined || sizes.inlineSize !== undefined ? size : this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, size - edges) + edges;
    }

    private automatic(sizes: UsedSizes, content: readonly [number, number], edges: number, available: number): number {
        // CSS 2 §17.5.2.2: an auto width is the available width held between the minimum and the maximum of the columns.
        return this.sizes.adjusted(sizes, BoxSizes.PREFERRED_INLINE, Math.min(Math.max(content[0], available), content[1]) - edges) + edges;
    }

    layout(box: ElementBox, containerInline: number, containerBlock?: number, space?: number, incoming?: BreakToken): BoxFragment {
        const grid: Grid = this.structure(box);
        const sizes: UsedSizes = this.sizes.of(box.style, containerInline, containerBlock);
        const collapse: boolean = this.collapses(box);
        const spacing: readonly [number, number] = this.spacing(box);
        const border: [number, number, number, number] = [0, 0, 0, 0];
        const padding: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < SIDES; side++) {
            // CSS 2 §17.6.2: in the collapsing model the table has no padding, and half of its outer border is its own.
            border[side] = collapse ? this.outerBorder(box, grid, side) / 2 : (sizes.border === undefined ? 0 : sizes.border[side]);
            padding[side] = collapse || sizes.padding === undefined ? 0 : sizes.padding[side];
        }
        const inlineEdges: number = border[BoxSizes.INLINE_START] + padding[BoxSizes.INLINE_START] + padding[BoxSizes.INLINE_END] + border[BoxSizes.INLINE_END];
        const gaps: number = spacing[0] * (grid.count === 0 ? 0 : grid.count + 1);
        const tracks: readonly [Float64Array, Float64Array] = this.tracks(box, grid);
        const content: [number, number] = [inlineEdges + gaps, inlineEdges + gaps];
        for (let column: number = 0; column < grid.count; column++) {
            content[0] += tracks[0][column];
            content[1] += tracks[1][column];
        }
        const given: number | undefined = this.preferred(sizes, content, inlineEdges, containerInline);
        const outer: number = this.gridWidth ?? Math.max(content[0], given ?? this.automatic(sizes, content, inlineEdges, containerInline));
        delete this.gridWidth;
        const widths: Float64Array = this.isFixed(box) ?this.fixedWidths(box, grid, outer - inlineEdges - gaps) : this.distributed(box, tracks, outer - inlineEdges - gaps);
        const offsets: Float64Array = new Float64Array(grid.count + 1);
        for (let column: number = 0; column < grid.count; column++) {
            offsets[column + 1] = offsets[column] + widths[column] + spacing[0];
        }
        const rowsInline: number = grid.count === 0 ? 0 : offsets[grid.count] - spacing[0];
        const fragmenting: boolean = space !== undefined && this.host.isFragmenting();
        const room: number = space ?? Number.POSITIVE_INFINITY;
        const page: readonly [number, number, boolean] = fragmenting ? this.host.fragmentainer() : UNFRAGMENTED;
        const firstRow: number = incoming?.child ?? 0;
        const laid: Array<BoxFragment | undefined> = [];
        const whole: (index: number) => BoxFragment = (index: number): BoxFragment => {
            const fragment: BoxFragment = laid[index] ?? this.row(grid, index, offsets, rowsInline, collapse, spacing[0]);
            laid[index] = fragment;
            return fragment;
        };
        // CSS Tables 3 §6.2: in paged media a header or footer group that avoids breaks inside it is repeated on each page
        // of the table, when it takes at most a quarter of the page and no row of it would show twice there.
        const header: number | undefined = page[2] ? this.repeatable(grid, 0, grid.header, page[0] / 4, spacing[1], whole) : undefined;
        const footer: number | undefined = page[2] ? this.repeatable(grid, grid.rows.length - grid.footer, grid.footer, page[0] / 4, spacing[1], whole) : undefined;
        const resumed: boolean = incoming !== undefined;
        const repeatsHeader: boolean = header !== undefined && incoming !== undefined && incoming.child >= grid.header;
        // CSS Fragmentation 4 §5.4: with slice no border and no padding are inserted at a break; §6.2: the table "top border"
        // is rendered with the repeated header rows, and its bottom border with the footer rows.
        const clone: boolean = this.keyword(box.style, "box-decoration-break") === "clone";
        const opens: boolean = resumed && !clone && !repeatsHeader;
        const blockStart: number = border[BoxSizes.BLOCK_START] + padding[BoxSizes.BLOCK_START];
        const blockEnd: number = border[BoxSizes.BLOCK_END] + padding[BoxSizes.BLOCK_END];
        const startEdge: number = opens ? 0 : blockStart;
        const limit: number = room - startEdge - (clone || footer !== undefined ? blockEnd : 0) - (footer ?? 0);
        const children: Array<BoxFragment | LineFragment> = [];
        const rows: Array<BoxFragment> = [];
        const indexes: Array<number> = [];
        let firstBaseline: number | undefined;
        let block: number = spacing[1];
        const place: (fragment: BoxFragment, index: number) => void = (fragment: BoxFragment, index: number): void => {
            fragment.inline = spacing[0];
            fragment.block = block;
            rows.push(fragment);
            indexes.push(index);
            firstBaseline = firstBaseline ?? (fragment.firstBaseline === undefined ? undefined : block + fragment.firstBaseline);
            block += fragment.blockSize + spacing[1];
        };
        const avoiding: boolean = fragmenting && this.host.enterBreaks(box);
        for (let index: number = 0; repeatsHeader && index < grid.header; index++) {
            if (!this.collapsed(grid.rows[index])) {
                place(whole(index), index);
            }
        }
        const last: number = grid.rows.length - (footer === undefined ? 0 : grid.footer);
        let token: BreakToken | undefined;
        let restarted: boolean = false;
        let previous: number = -1;
        for (let index: number = firstRow; index < last; index++) {
            const row: ElementBox = grid.rows[index];
            if (this.collapsed(row)) {
                continue;
            }
            const resuming: BreakToken | undefined = incoming !== undefined && incoming.child === index ? incoming.inner : undefined;
            let best: boolean = false;
            if (fragmenting && previous >= 0) {
                // CSS Fragmentation 4 §4.1: the gap between two rows is a class A break point.
                const point: readonly [string | undefined, boolean, boolean] = this.host.breakPoint(index, this.boundary(grid, previous, index));
                if (point[1]) {
                    token = this.breakToken(box, index, undefined, point[0]);
                    break;
                }
                best = point[2];
            }
            previous = index;
            let fragment: BoxFragment = resuming === undefined ? whole(index)
                : this.row(grid, index, offsets, rowsInline, collapse, spacing[0], Math.max(0, limit - block), resuming);
            if (fragmenting && resuming === undefined && block + fragment.blockSize > limit + TOLERANCE) {
                // CSS Tables 3 §6.1: a row that does not fit and is not freely fragmentable goes to the next fragmentainer; else its
                // cells get the remaining height and "fit as much content as it can", so if none can break there the row goes whole.
                const free: boolean = this.isFree(grid, index, fragment.blockSize, page);
                const spaced: BoxFragment | undefined = free ? this.row(grid, index, offsets, rowsInline, collapse, spacing[0], Math.max(0, limit - block)) : undefined;
                const stuck: boolean = spaced !== undefined && spaced.token === undefined && block + spaced.blockSize > limit + TOLERANCE;
                const weak: boolean = spaced !== undefined && spaced.token !== undefined && this.host.betterBreak(spaced.token);
                // The first row too, since a break before the table can take it; at the top of a fragmentainer no break can.
                if (!free || stuck || weak) {
                    if (best) {
                        token = this.breakToken(box, index, undefined, undefined);
                        break;
                    }
                    if (this.host.restartBreak()) {
                        restarted = true;
                        break;
                    }
                    this.host.contentOverflows();
                }
                fragment = spaced ?? this.row(grid, index, offsets, rowsInline, collapse, spacing[0], Math.max(0, limit - block));
            }
            place(fragment, index);
            if (fragment.token !== undefined) {
                token = this.breakToken(box, index, fragment.token, undefined);
                this.host.keepRowBreak(fragment.token);
                break;
            }
            if (fragmenting) {
                this.host.fill();
            }
        }
        // §6.1: "the footer must come directly after the last row in the fragmentainer and the vertical gap must be inserted
        // after the repeated footer."
        for (let index: number = last; !restarted && index < grid.rows.length; index++) {
            if (!this.collapsed(grid.rows[index])) {
                place(whole(index), index);
            }
        }
        if (fragmenting) {
            this.host.leaveBreaks(avoiding);
        }
        // CSS 2 §17.6.2: a collapsed border is centered on its grid line, so each line is painted once, by the cell after it,
        // and the cells of the last row of this fragment paint the line below them.
        const final: BoxFragment | undefined = rows[rows.length - 1];
        for (const cell of collapse && final !== undefined ? final.children ?? [] : []) {
            if (cell.kind === "box" && cell.collapsed !== undefined) {
                cell.collapsed.lastBlock = true;
            }
        }
        if (fragmenting && !restarted && token === undefined && startEdge + (rows.length === 0 ? 0 : block) + blockEnd > room + TOLERANCE) {
            // CSS Fragmentation 4 §4.4: the block-end edge that does not fit is pushed with what comes before it.
            this.host.restartBreak();
        }
        // CSS Sizing 4 §4.2: with a preferred aspect ratio, an automatic block size follows from the inline size.
        const tall: number | undefined = sizes.blockSize ?? (sizes.ratio === undefined ? undefined : this.sizes.transferred(sizes, Math.max(0, outer - inlineEdges), false));
        // CSS Fragmentation 4 §5.3: the earlier fragments count towards the table height.
        const left: number | undefined = tall === undefined ? undefined : Math.max(0, tall - (incoming?.consumed ?? 0));
        if (tall !== undefined && left !== undefined && rows.length > 0 && token === undefined && left > block + TOLERANCE) {
            block += this.shareHeight(grid, rows, indexes, tall, left - block);
        }
        const closes: boolean = token !== undefined && !clone && footer === undefined;
        const endEdge: number = closes ? 0 : blockEnd;
        let extent: number = rows.length === 0 ? 0 : block;
        if (token !== undefined) {
            // §5.3: the content box of a box that breaks "extends to fill any remaining fragmentainer extent".
            extent = Math.max(extent, room - startEdge - endEdge);
            token.consumed = (incoming?.consumed ?? 0) + extent;
        }
        // §5.3: a column box that breaks extends to the end of the fragmentainer, as the table box does.
        this.columns(grid, offsets, widths, spacing, token === undefined ? block - 2 * spacing[1] : extent - spacing[1], children);
        this.grouped(grid, rows, children);
        const fragment: BoxFragment = { kind: "box", box, inline: 0, block: 0, inlineSize: outer, blockSize: startEdge + extent + endEdge, children };
        if (border.some((width: number) => width !== 0)) {
            fragment.border = opens || closes ? this.sliced(border, opens, closes) : border;
        }
        if (padding.some((width: number) => width !== 0)) {
            fragment.padding = opens || closes ? this.sliced(padding, opens, closes) : padding;
        }
        if (resumed) {
            fragment.resumed = true;
        }
        if (token !== undefined) {
            fragment.token = token;
        }
        if (firstBaseline !== undefined && !resumed) {
            fragment.firstBaseline = startEdge + firstBaseline;
            fragment.baseline = fragment.firstBaseline;
        }
        return fragment;
    }

    private shareHeight(grid: Grid, rows: ReadonlyArray<BoxFragment>, indexes: ReadonlyArray<number>, tableHeight: number, excess: number): number {
        // CSS Tables 3 §3.10.5: a reference size counts percentages against the table height. Up to the sum of those, rows take
        // "the weighted mean of the base and the reference size"; beyond it the auto-height rows, if any, take the rest.
        const references: Array<number> = [];
        const automatic: Array<boolean> = [];
        let base: number = 0;
        let reference: number = 0;
        rows.forEach((row: BoxFragment, position: number) => {
            const heights: readonly [number, boolean] = this.referenceOf(grid, row, indexes[position], tableHeight);
            references.push(heights[0]);
            automatic.push(heights[1]);
            base += row.blockSize;
            reference += heights[0];
        });
        const total: number = base + excess;
        const autos: number = automatic.filter((auto: boolean) => auto).length;
        const increment: number = total <= reference ? 0 : (total - reference) / (autos === 0 ? rows.length : autos);
        const share: number = total <= reference ? excess / (reference - base) : 1;
        let moved: number = 0;
        rows.forEach((row: BoxFragment, position: number) => {
            const extra: number = (references[position] - row.blockSize) * share + (autos === 0 || automatic[position] ? increment : 0);
            row.block += moved;
            if (extra > 0) {
                this.stretch(row, extra);
            }
            moved += extra;
        });
        return moved;
    }

    private referenceOf(grid: Grid, row: BoxFragment, index: number, tableHeight: number): readonly [number, boolean] {
        // The specified heights of a row and of its cells; heights on row groups are not among them (§3.10.2).
        const own: number | undefined = this.sizes.of(grid.rows[index].style, undefined, tableHeight).blockSize;
        let reference: number = Math.max(row.blockSize, own ?? 0);
        let automatic: boolean = own === undefined;
        for (const slot of grid.cells[index]) {
            const asked: number | undefined = this.sizes.of(slot.cell.style, undefined, tableHeight).blockSize;
            const cell: BoxFragment | LineFragment | undefined = asked === undefined ? undefined : row.children?.find((child: BoxFragment | LineFragment) => child.kind === "box" && child.box === slot.cell);
            if (asked !== undefined && cell !== undefined && cell.kind === "box") {
                automatic = false;
                reference = Math.max(reference, asked + cell.blockSize - this.contentBlock(cell));
            }
        }
        return [reference, automatic];
    }

    private ended(cell: ElementBox): BreakToken {
        // A cell whose content ended before the break continues as an empty fragment.
        return { box: cell, consumed: 0, child: cell.children.length, sequence: cell.inline?.length ?? 0 };
    }

    private repeatable(grid: Grid, from: number, count: number, most: number, gap: number, whole: (index: number) => BoxFragment): number | undefined {
        const group: ElementBox | undefined = count === 0 ? undefined : grid.groups?.get(grid.rows[from]);
        if (group === undefined || !this.host.avoidsBreak(this.keyword(group.style, "break-inside"))) {
            return undefined;
        }
        let extent: number = 0;
        for (let index: number = from; index < from + count; index++) {
            extent += this.collapsed(grid.rows[index]) ? 0 : whole(index).blockSize + gap;
        }
        return extent <= most ? extent : undefined;
    }

    private isFree(grid: Grid, index: number, height: number, page: readonly [number, number, boolean]): boolean {
        // CSS Tables 3 §6.1: a row is kept whole when it is "at least twice smaller" than the fragmentainer both ways, and
        // CSS Fragmentation 4 §4.4 rule 1 keeps it whole when it avoids breaks inside.
        if (this.host.avoidsBreak(this.keyword(grid.rows[index].style, "break-inside"))) {
            return false;
        }
        return height * 2 > page[0] || height * 2 > page[1];
    }

    private boundary(grid: Grid, previous: number, next: number): Array<string> {
        // CSS Fragmentation 4 §3.1.1: the break values of a row at the edge of its group are propagated to the group; §4.4
        // rule 2: a group whose break-inside avoids breaks avoids the break between two of its rows.
        const values: Array<string> = [];
        const before: ElementBox = grid.rows[previous];
        const after: ElementBox = grid.rows[next];
        const ending: ElementBox | undefined = grid.groups?.get(before);
        const starting: ElementBox | undefined = grid.groups?.get(after);
        this.breakValue(values, before.style, "break-after");
        if (ending !== starting) {
            if (ending !== undefined) {
                this.breakValue(values, ending.style, "break-after");
            }
            if (starting !== undefined) {
                this.breakValue(values, starting.style, "break-before");
            }
        } else if (ending !== undefined) {
            this.breakValue(values, ending.style, "break-inside");
        }
        this.breakValue(values, after.style, "break-before");
        // CSS Paged Media 3 §8.1: rows whose page values do not match force a page break between them.
        if (before.endPage !== after.startPage) {
            values.push("page");
        }
        return values;
    }

    private breakValue(values: Array<string>, style: ComputedStyle, property: string): void {
        const keyword: string = this.keyword(style, property);
        if (keyword !== "" && keyword !== "auto") {
            values.push(keyword);
        }
    }

    private breakToken(box: ElementBox, child: number, inner: BreakToken | undefined, forced: string | undefined): BreakToken {
        const token: BreakToken = { box, consumed: 0, child, sequence: 0 };
        if (inner !== undefined) {
            token.inner = inner;
        }
        if (forced !== undefined) {
            token.forced = forced;
        }
        return token;
    }

    private sliced(sides: Sides, opens: boolean, closes: boolean): Sides {
        return [opens ? 0 : sides[BoxSizes.BLOCK_START], sides[BoxSizes.INLINE_END], closes ? 0 : sides[BoxSizes.BLOCK_END], sides[BoxSizes.INLINE_START]];
    }

    private sliceCollapsed(borders: CollapsedBorders, opens: boolean, closes: boolean): void {
        if (opens) {
            delete borders.blockStart;
        }
        if (closes) {
            delete borders.blockEnd;
        }
    }

    private collapsed(row: ElementBox): boolean {
        return this.keyword(row.style, "visibility") === "collapse";
    }

    private row(grid: Grid, index: number, offsets: Float64Array, inlineSize: number, collapse: boolean, gap: number, space?: number, incoming?: BreakToken): BoxFragment {
        // CSS 2 §17.5.3: the height of a row is the largest that its cells need, the cells with vertical-align: baseline
        // being put on one baseline, which is that of the first line box of a cell, or the bottom of its content edge.
        const row: ElementBox = grid.rows[index];
        const slots: ReadonlyArray<Slot> = grid.cells[index];
        const cells: Array<BoxFragment> = [];
        const baselines: Array<number> = [];
        const tokens: Array<BreakToken> = [];
        let broken: boolean = false;
        let above: number = 0;
        let below: number = 0;
        let height: number = incoming === undefined ? this.sizes.of(row.style).blockSize ?? 0 : 0;
        let appeal: number = Number.POSITIVE_INFINITY;
        for (const [position, slot] of slots.entries()) {
            const cell: ElementBox = slot.cell;
            const width: number = offsets[slot.column + 1] - offsets[slot.column] - gap;
            const edges: [number, number, number, number] | undefined = collapse ? this.cellBorders(grid, slot) : undefined;
            const resuming: BreakToken | undefined = incoming?.parallel?.[position];
            // CSS Fragmentation 4 §2.1: the contents of the cells of a row are parallel flows, each breaking on its own;
            // a cell that ended before the break continues as an empty fragment.
            const fragment: BoxFragment = space === undefined ? this.host.cell(cell, width, edges, undefined, resuming)
                : this.host.parallel((): BoxFragment => this.host.cell(cell, width, edges, space, resuming), resuming);
            if (space !== undefined) {
                broken = broken || fragment.token !== undefined;
                appeal = Math.min(appeal, this.host.breakAppeal(fragment.token));
                tokens.push(fragment.token ?? this.ended(cell));
            }
            if (collapse) {
                fragment.collapsed = this.collapsedBorders(grid, slot);
                // CSS Tables 3 §6.1: "top borders must not be repainted in continuation fragments", nor drawn where the cell breaks.
                if (this.keyword(cell.style, "box-decoration-break") !== "clone") {
                    this.sliceCollapsed(fragment.collapsed, fragment.resumed === true, fragment.token !== undefined);
                }
            }
            fragment.inline = offsets[slot.column];
            const asked: UsedSizes = this.sizes.of(cell.style);
            const blockEdges: number = fragment.blockSize - this.contentBlock(fragment);
            height = Math.max(height, fragment.blockSize, asked.blockSize === undefined || incoming !== undefined ? 0 : asked.blockSize + blockEdges);
            const aligned: string = this.cellAlignment(cell.style);
            const baseline: number = aligned !== "baseline" ? Number.NaN
                : fragment.firstBaseline ?? fragment.blockSize - (this.side(BoxSizes.BLOCK_END, fragment.border) + this.side(BoxSizes.BLOCK_END, fragment.padding));
            if (!Number.isNaN(baseline)) {
                above = Math.max(above, baseline);
                below = Math.max(below, fragment.blockSize - baseline);
            }
            baselines.push(baseline);
            cells.push(fragment);
        }
        // CSS Tables 3 §6.1: a row that breaks gives "all the remaining height in the fragmentainer to the cells", and each
        // continues "where it was stopped in its previous fragment", so no fragment of it aligns its cells.
        height = broken && space !== undefined ? space : Math.max(height, above + below);
        for (const [position, fragment] of cells.entries()) {
            const aligned: string = this.cellAlignment(slots[position].cell.style);
            const baseline: number = baselines[position];
            const free: number = height - fragment.blockSize;
            if (!broken && incoming === undefined) {
                this.lower(fragment, !Number.isNaN(baseline) ? above - baseline : (aligned === "bottom" ? free : (aligned === "middle" ? free / 2 : 0)));
            }
            fragment.blockSize = height;
        }
        const fragment: BoxFragment = { kind: "box", box: row, inline: 0, block: 0, inlineSize, blockSize: height };
        if (cells.length > 0) {
            fragment.children = cells;
        }
        if (broken) {
            fragment.token = { box: row, consumed: 0, child: 0, sequence: 0, parallel: tokens, appeal };
        }
        if (incoming !== undefined) {
            fragment.resumed = true;
        }
        if (above > 0) {
            fragment.firstBaseline = above;
            fragment.baseline = above;
        }
        return fragment;
    }

    private weights(measure: Float64Array, constrained: Uint8Array, originating: Uint8Array, from: number, to: number): Float64Array {
        // CSS Tables 3 §3.9.3.2, no track having an intrinsic percentage width: the first rule whose tracks exist decides, each
        // in proportion to its max-content size or equally.
        const rules: ReadonlyArray<(track: number) => boolean> = [
            (track: number): boolean => constrained[track] === 0 && originating[track] !== 0 && measure[track] > 0,
            (track: number): boolean => constrained[track] === 0 && originating[track] !== 0,
            (track: number): boolean => constrained[track] !== 0 && measure[track] > 0,
            (track: number): boolean => originating[track] !== 0,
            (): boolean => true
        ];
        const weights: Float64Array = new Float64Array(to - from);
        for (const [rule, applies] of rules.entries()) {
            let count: number = 0;
            let total: number = 0;
            for (let track: number = from; track < to; track++) {
                if (applies(track)) {
                    count++;
                    total += measure[track];
                }
            }
            if (count === 0) {
                continue;
            }
            for (let track: number = from; track < to; track++) {
                weights[track - from] = !applies(track) ? 0 : (PROPORTIONAL[rule] ? measure[track] / total : 1 / count);
            }
            return weights;
        }
        return weights;
    }

    private stretch(row: BoxFragment, extra: number): void {
        row.blockSize += extra;
        if (row.children === undefined) {
            return;
        }
        for (const cell of row.children) {
            if (cell.kind === "box") {
                const aligned: string = this.cellAlignment(cell.box.style);
                this.lower(cell, aligned === "bottom" ? extra : (aligned === "middle" ? extra / 2 : 0));
                cell.blockSize += extra;
            }
        }
    }

    private lower(cell: BoxFragment, distance: number): void {
        if (distance === 0) {
            return;
        }
        if (cell.children !== undefined) {
            for (const child of cell.children) {
                child.block += distance;
            }
        }
        if (cell.firstBaseline !== undefined) {
            cell.firstBaseline += distance;
        }
        if (cell.baseline !== undefined) {
            cell.baseline += distance;
        }
    }

    private cellAlignment(style: ComputedStyle): string {
        // CSS Inline 3 §4.2: on table cells top and bottom come from baseline-shift, and middle from alignment-baseline.
        const shift: string = this.keyword(style, "baseline-shift");
        if (shift === "top" || shift === "bottom") {
            return shift;
        }
        return this.keyword(style, "alignment-baseline") === "middle" ? "middle" : "baseline";
    }

    private contentBlock(fragment: BoxFragment): number {
        return fragment.blockSize - this.side(BoxSizes.BLOCK_START, fragment.border) - this.side(BoxSizes.BLOCK_START, fragment.padding)
            - this.side(BoxSizes.BLOCK_END, fragment.padding) - this.side(BoxSizes.BLOCK_END, fragment.border);
    }

    private columns(grid: Grid, offsets: Float64Array, widths: Float64Array, spacing: readonly [number, number], blockSize: number,
        children: Array<BoxFragment | LineFragment>): void {
        // CSS 2 §17.5.1: the backgrounds of the column groups and of the columns are layers under the rows, so they come first.
        let group: ElementBox | undefined;
        for (let column: number = 0; column < grid.count; column++) {
            const current: ElementBox | undefined = grid.columnGroups?.get(column);
            if (current !== undefined && current !== group) {
                let last: number = column;
                while (last + 1 < grid.count && grid.columnGroups?.get(last + 1) === current) {
                    last++;
                }
                children.push({
                    kind: "box", box: current, inline: spacing[0] + offsets[column], block: spacing[1], inlineSize: offsets[last] + widths[last] - offsets[column],
                    blockSize: Math.max(0, blockSize)
                });
            }
            group = current;
        }
        for (let column: number = 0; column < grid.count; column++) {
            const box: ElementBox | undefined = grid.columns?.get(column);
            if (box !== undefined) {
                children.push({ kind: "box", box, inline: spacing[0] + offsets[column], block: spacing[1], inlineSize: widths[column], blockSize: Math.max(0, blockSize) });
            }
        }
    }

    private grouped(grid: Grid, rows: ReadonlyArray<BoxFragment>, children: Array<BoxFragment | LineFragment>): void {
        let fragment: BoxFragment | undefined;
        for (const row of rows) {
            const group: ElementBox | undefined = grid.groups?.get(row.box);
            if (group === undefined) {
                fragment = undefined;
                children.push(row);
                continue;
            }
            if (fragment === undefined || fragment.box !== group) {
                fragment = { kind: "box", box: group, inline: row.inline, block: row.block, inlineSize: row.inlineSize, blockSize: 0 };
                children.push(fragment);
            }
            fragment.blockSize = row.block + row.blockSize - fragment.block;
            row.block -= fragment.block;
            row.inline = 0;
            if (fragment.children === undefined) {
                fragment.children = [row];
            } else {
                fragment.children.push(row);
            }
        }
    }

    private structure(box: ElementBox): Grid {
        // CSS 2 §17.2: the first header group and the first footer group go before and after the row groups; "the others
        // are treated as if they had display: table-row-group".
        const known: Grid | undefined = this.grids.get(box);
        if (known !== undefined) {
            return known;
        }
        const bodies: Array<ElementBox> = [];
        const grid: Grid = { table: box, rows: [], cells: [], count: 0, declared: 0, header: 0, footer: 0 };
        let header: ElementBox | undefined;
        let footer: ElementBox | undefined;
        for (const child of box.children) {
            if (child.kind !== "box" || child.placement !== "in-flow") {
                continue;
            }
            const internal: string | undefined = child.display.internal;
            if (internal === "table-header-group" && header === undefined) {
                header = child;
            } else if (internal === "table-footer-group" && footer === undefined) {
                footer = child;
            } else if (internal === "table-column") {
                grid.columns = grid.columns ?? new Map<number, ElementBox>();
                grid.columns.set(grid.declared++, child);
            } else if (internal === "table-column-group") {
                // CSS 2 §17.2: a column group with no column in it stands for one column.
                const inside: Array<ElementBox> = child.children.filter((node: BoxNode): node is ElementBox => node.kind === "box" && node.display.internal === "table-column");
                grid.columnGroups = grid.columnGroups ?? new Map<number, ElementBox>();
                grid.columnGroups.set(grid.declared, child);
                for (const column of inside) {
                    grid.columns = grid.columns ?? new Map<number, ElementBox>();
                    grid.columns.set(grid.declared, column);
                    grid.columnGroups.set(grid.declared++, child);
                }
                grid.declared += inside.length === 0 ? 1 : 0;
            } else if (internal !== undefined && internal !== "table-caption") {
                bodies.push(child);
            }
        }
        if (header !== undefined) {
            bodies.unshift(header);
        }
        if (footer !== undefined) {
            bodies.push(footer);
        }
        for (const item of bodies) {
            const rows: ReadonlyArray<BoxNode> = item.display.internal === "table-row" ? [item] : item.children;
            for (const row of rows) {
                if (row.kind === "box" && row.placement === "in-flow" && row.display.internal === "table-row") {
                    grid.rows.push(row);
                    grid.header += item === header ? 1 : 0;
                    grid.footer += item === footer ? 1 : 0;
                    if (row !== item) {
                        grid.groups = grid.groups ?? new Map<ElementBox, ElementBox>();
                        grid.groups.set(row, item);
                    }
                }
            }
        }
        this.form(grid);
        grid.count = Math.max(grid.count, grid.declared);
        this.fillMissing(grid);
        this.grids.set(box, grid);
        return grid;
    }

    private fillMissing(grid: Grid): void {
        // CSS Tables 3 §3.4: "Once the amount of columns in a table is known, any table-row box must be modified such that it owns
        // enough cells to fill all the columns of the table"; §2.2.2: the anonymous cells inherit and have no styling of their own.
        for (let index: number = 0; index < grid.rows.length; index++) {
            const row: ElementBox = grid.rows[index];
            let style: ComputedStyle | undefined;
            for (let column: number = grid.cells[index].length; column < grid.count; column++) {
                style = style ?? { values: row.style.inherited, inherited: row.style.inherited, custom: row.style.custom };
                const cell: ElementBox = {
                    kind: "box", style, display: MISSING_CELL, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true,
                    usedPage: row.usedPage, startPage: row.usedPage, endPage: row.usedPage, children: []
                };
                grid.cells[index].push({ cell, row: index, column });
            }
        }
    }

    private form(grid: Grid): void {
        // CSS Tables 3 §3.3.1: "There is no way to specify the span of a cell in css", so each cell takes the next column of its row.
        for (let row: number = 0; row < grid.rows.length; row++) {
            const origins: Array<Slot> = [];
            for (const node of grid.rows[row].children) {
                if (node.kind === "box" && node.placement === "in-flow" && node.display.internal === "table-cell") {
                    origins.push({ cell: node, row, column: origins.length });
                }
            }
            grid.cells.push(origins);
            grid.count = Math.max(grid.count, origins.length);
        }
    }

    private isFixed(box: ElementBox): boolean {
        // CSS Tables 3 §3.5.1: fixed mode needs table-layout: fixed and "the specified width of the table root is either a
        // <length-percentage>, min-content or fit-content".
        const size: CssValue | undefined = box.style.values["inline-size"];
        if (this.keyword(box.style, "table-layout") !== "fixed" || size === undefined) {
            return false;
        }
        if (size.kind === "ident") {
            return size.lower === "min-content" || size.lower === "fit-content";
        }
        return size.kind === "function" ? size.name === "fit-content" : true;
    }

    private tracks(box: ElementBox, grid: Grid): readonly [Float64Array, Float64Array] {
        // CSS 2 §17.5.2.2: a width given to a cell or column counts for both its minimum and maximum when larger.
        if (this.measured !== undefined && this.measured[0] === box) {
            return this.measured[1];
        }
        const minimum: Float64Array = new Float64Array(grid.count);
        const maximum: Float64Array = new Float64Array(grid.count);
        const constrained: Uint8Array = new Uint8Array(grid.count);
        const originating: Uint8Array = new Uint8Array(grid.count);
        const collapse: boolean = this.collapses(box);
        for (const origins of grid.cells) {
            for (const slot of origins) {
                const sizes: UsedSizes = this.sizes.of(slot.cell.style);
                const borders: [number, number, number, number] | undefined = collapse ? this.cellBorders(grid, slot) : sizes.border;
                const edges: number = (borders === undefined ? 0 : borders[BoxSizes.INLINE_START] + borders[BoxSizes.INLINE_END])
                    + (sizes.padding === undefined ? 0 : sizes.padding[BoxSizes.INLINE_START] + sizes.padding[BoxSizes.INLINE_END]);
                const content: readonly [number, number] = this.host.contentSizes(slot.cell);
                const least: number = Math.max(content[0], sizes.inlineSize ?? 0, sizes.minInlineSize ?? 0) + edges;
                const most: number = sizes.inlineSize === undefined ? Math.max(content[1] + edges, least) : least;
                originating[slot.column] = 1;
                minimum[slot.column] = Math.max(minimum[slot.column], least);
                maximum[slot.column] = Math.max(maximum[slot.column], most);
                constrained[slot.column] = sizes.inlineSize === undefined ? constrained[slot.column] : 1;
            }
        }
        if (grid.columns !== undefined) {
            for (const [column, element] of grid.columns) {
                const width: number | undefined = this.sizes.of(element.style).inlineSize;
                if (width !== undefined && column < grid.count) {
                    minimum[column] = Math.max(minimum[column], width);
                    maximum[column] = Math.max(minimum[column], width);
                    constrained[column] = 1;
                }
            }
        }
        // The widths of a table are asked for more than once while it is laid out, and measuring its cells is the costly part.
        this.measured = [box, [minimum, maximum]];
        this.constraints = [box, constrained, originating];
        return this.measured[1];
    }

    private distributed(box: ElementBox, tracks: readonly [Float64Array, Float64Array], space: number): Float64Array {
        // CSS 2 §17.5.2.2: no column is narrower than its minimum, and between the minimum and the maximum widths of the table
        // each column takes its share of the room; CSS Tables 3 §3.9.3.2 shares the room beyond the maximum by its rules.
        const count: number = tracks[0].length;
        const widths: Float64Array = new Float64Array(count);
        let least: number = 0;
        let most: number = 0;
        for (let column: number = 0; column < count; column++) {
            least += tracks[0][column];
            most += tracks[1][column];
        }
        for (let column: number = 0; column < count; column++) {
            if (space <= least) {
                widths[column] = tracks[0][column];
            } else if (space < most) {
                widths[column] = tracks[0][column] + (tracks[1][column] - tracks[0][column]) * (space - least) / (most - least);
            } else {
                widths[column] = tracks[1][column];
            }
        }
        const flags: readonly [ElementBox, Uint8Array, Uint8Array] | undefined = this.constraints !== undefined && this.constraints[0] === box ? this.constraints : undefined;
        if (space > most && count > 0) {
            const weights: Float64Array = flags === undefined ? new Float64Array(count).fill(1 / count) : this.weights(tracks[1], flags[1], flags[2], 0, count);
            for (let column: number = 0; column < count; column++) {
                widths[column] += (space - most) * weights[column];
            }
        }
        return widths;
    }

    private fixedWidths(box: ElementBox, grid: Grid, space: number): Float64Array {
        // CSS 2 §17.5.2.1: a column takes the width of its column element, or else of its cell in the first row, and "Any
        // remaining columns equally divide the remaining horizontal table space".
        const widths: Float64Array = new Float64Array(grid.count).fill(Number.NaN);
        const collapse: boolean = this.collapses(box);
        const first: ReadonlyArray<Slot> = grid.cells[0] ?? [];
        const outer: (slot: Slot) => number | undefined = (slot: Slot): number | undefined => {
            const sizes: UsedSizes = this.sizes.of(slot.cell.style, space);
            const borders: [number, number, number, number] | undefined = collapse ? this.cellBorders(grid, slot) : sizes.border;
            return sizes.inlineSize === undefined ? undefined : sizes.inlineSize + (borders === undefined ? 0 : borders[BoxSizes.INLINE_START] + borders[BoxSizes.INLINE_END])
                + (sizes.padding === undefined ? 0 : sizes.padding[BoxSizes.INLINE_START] + sizes.padding[BoxSizes.INLINE_END]);
        };
        for (let column: number = 0; column < grid.count; column++) {
            const element: ElementBox | undefined = grid.columns?.get(column);
            const cell: Slot | undefined = first[column];
            const width: number | undefined = element === undefined ? undefined : this.sizes.of(element.style, space).inlineSize;
            const given: number | undefined = width ?? (cell === undefined ? undefined : outer(cell));
            if (given !== undefined) {
                widths[column] = given;
            }
        }
        let used: number = 0;
        let open: number = 0;
        for (let column: number = 0; column < grid.count; column++) {
            if (Number.isNaN(widths[column])) {
                open++;
            } else {
                used += widths[column];
            }
        }
        for (let column: number = 0; column < grid.count; column++) {
            if (Number.isNaN(widths[column])) {
                widths[column] = Math.max(0, space - used) / open;
            } else if (open === 0 && used > 0) {
                widths[column] *= Math.max(space, used) / used;
            }
        }
        return widths;
    }

    private tableEdges(box: ElementBox, grid: Grid, sizes: UsedSizes, side: number): number {
        return this.collapses(box) ? this.outerBorder(box, grid, side) / 2 : this.sizes.edges(sizes, side);
    }

    private outerBorder(box: ElementBox, grid: Grid, side: number): number {
        // CSS 2 §17.6.2: the border of the table is as wide as the widest collapsed border along that edge.
        let width: number = grid.rows.length === 0 || grid.count === 0 ? this.sizes.border(box.style, side) : 0;
        const block: boolean = side === BoxSizes.BLOCK_START || side === BoxSizes.BLOCK_END;
        for (let index: number = 0; grid.rows.length > 0 && index < (block ? grid.count : grid.rows.length); index++) {
            const row: number = block ? (side === BoxSizes.BLOCK_START ? 0 : grid.rows.length - 1) : index;
            const column: number = block ? index : (side === BoxSizes.INLINE_START ? 0 : grid.count - 1);
            const winner: EdgeSource | undefined = this.edge(grid, row, column, side);
            width = Math.max(width, winner === undefined ? 0 : this.sizes.border(winner[0].style, winner[1]));
        }
        return width;
    }

    private cellBorders(grid: Grid, slot: Slot): [number, number, number, number] {
        const borders: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < SIDES; side++) {
            const winner: EdgeSource | undefined = this.edge(grid, slot.row, slot.column, side);
            borders[side] = winner === undefined ? 0 : this.sizes.border(winner[0].style, winner[1]) / 2;
        }
        return borders;
    }

    private collapsedBorders(grid: Grid, slot: Slot): CollapsedBorders {
        const borders: CollapsedBorders = {};
        const blockStart: EdgeSource | undefined = this.edge(grid, slot.row, slot.column, BoxSizes.BLOCK_START);
        const inlineEnd: EdgeSource | undefined = this.edge(grid, slot.row, slot.column, BoxSizes.INLINE_END);
        const blockEnd: EdgeSource | undefined = this.edge(grid, slot.row, slot.column, BoxSizes.BLOCK_END);
        const inlineStart: EdgeSource | undefined = this.edge(grid, slot.row, slot.column, BoxSizes.INLINE_START);
        if (blockStart !== undefined) {
            borders.blockStart = blockStart;
        }
        if (inlineEnd !== undefined) {
            borders.inlineEnd = inlineEnd;
        }
        if (blockEnd !== undefined) {
            borders.blockEnd = blockEnd;
        }
        if (inlineStart !== undefined) {
            borders.inlineStart = inlineStart;
        }
        if (slot.column + 1 >= grid.count) {
            borders.lastInline = true;
        }
        return borders;
    }

    private edge(grid: Grid, row: number, column: number, side: number): EdgeSource | undefined {
        // CSS Tables 3 §3.7.1.1: the borders on a section of the grid line are harmonized into one, whose winner is kept for each
        // slot and side.
        const slot: number = (row * grid.count + column) * SIDES + side;
        grid.resolved = grid.resolved ?? new Uint8Array(grid.rows.length * grid.count * SIDES);
        if (grid.resolved[slot] !== 0) {
            return grid.edges?.get(slot);
        }
        grid.resolved[slot] = 1;
        const candidates: Array<readonly [ElementBox, number, number]> = [];
        this.segment(grid, row, column, side, candidates);
        const winner: EdgeSource | undefined = this.winner(candidates);
        if (winner !== undefined) {
            grid.edges = grid.edges ?? new Map<number, EdgeSource>();
            grid.edges.set(slot, winner);
        }
        return winner;
    }

    private segment(grid: Grid, row: number, column: number, side: number, candidates: Array<readonly [ElementBox, number, number]>): void {
        const block: boolean = side === BoxSizes.BLOCK_START || side === BoxSizes.BLOCK_END;
        const before: boolean = side === BoxSizes.BLOCK_START || side === BoxSizes.INLINE_START;
        const opposite: number = (side + 2) % SIDES;
        // The neighbour across the edge, when there is one, sees the same edge from its other side.
        const farRow: number = block ? row + (before ? -1 : 1) : row;
        const farColumn: number = block ? column : column + (before ? -1 : 1);
        const inside: boolean = farRow >= 0 && farRow < grid.rows.length && farColumn >= 0 && farColumn < grid.count;
        this.candidate(candidates, side, CELL_ORIGIN, grid.cells[row][column]?.cell);
        this.candidate(candidates, opposite, CELL_ORIGIN, inside ? grid.cells[farRow][farColumn]?.cell : undefined);
        const group: ElementBox | undefined = grid.groups?.get(grid.rows[row]);
        const columnGroup: ElementBox | undefined = grid.columnGroups?.get(column);
        if (block) {
            const farGroup: ElementBox | undefined = inside ? grid.groups?.get(grid.rows[farRow]) : undefined;
            this.candidate(candidates, side, ROW_ORIGIN, grid.rows[row]);
            this.candidate(candidates, opposite, ROW_ORIGIN, inside ? grid.rows[farRow] : undefined);
            this.candidate(candidates, side, ROW_GROUP_ORIGIN, !inside || group !== farGroup ? group : undefined);
            this.candidate(candidates, opposite, ROW_GROUP_ORIGIN, group !== farGroup ? farGroup : undefined);
            this.candidate(candidates, side, COLUMN_ORIGIN, inside ? undefined : grid.columns?.get(column));
            this.candidate(candidates, side, COLUMN_GROUP_ORIGIN, inside ? undefined : columnGroup);
        } else {
            const farColumnGroup: ElementBox | undefined = inside ? grid.columnGroups?.get(farColumn) : undefined;
            this.candidate(candidates, side, COLUMN_ORIGIN, grid.columns?.get(column));
            this.candidate(candidates, opposite, COLUMN_ORIGIN, inside ? grid.columns?.get(farColumn) : undefined);
            this.candidate(candidates, side, COLUMN_GROUP_ORIGIN, !inside || columnGroup !== farColumnGroup ? columnGroup : undefined);
            this.candidate(candidates, opposite, COLUMN_GROUP_ORIGIN, columnGroup !== farColumnGroup ? farColumnGroup : undefined);
            this.candidate(candidates, side, ROW_ORIGIN, inside ? undefined : grid.rows[row]);
            this.candidate(candidates, side, ROW_GROUP_ORIGIN, inside ? undefined : group);
        }
        this.candidate(candidates, side, TABLE_ORIGIN, inside ? undefined : grid.table);
    }

    private candidate(candidates: Array<readonly [ElementBox, number, number]>, side: number, origin: number, box?: ElementBox): void {
        if (box !== undefined) {
            candidates.push([box, side, origin]);
        }
    }

    private winner(candidates: ReadonlyArray<readonly [ElementBox, number, number]>): EdgeSource | undefined {
        // CSS 2 §17.6.2.1: hidden suppresses the border; then the wider border wins, then the style in the order double,
        // solid, dashed, dotted, ridge, outset, groove, inset, then the cell, row, row group, column, column group and table.
        let best: EdgeSource | undefined;
        let bestWidth: number = 0;
        let bestStyle: number = -1;
        let bestOrigin: number = 0;
        for (const [box, side, origin] of candidates) {
            const style: string = this.sizes.borderStyle(box.style, side);
            if (style === "none") {
                continue;
            }
            if (style === "hidden") {
                return undefined;
            }
            const width: number = this.sizes.border(box.style, side);
            const rank: number = STYLE_RANKS.indexOf(style);
            if (width > bestWidth || (width === bestWidth && (rank > bestStyle || (rank === bestStyle && origin > bestOrigin)))) {
                best = [box, side];
                bestWidth = width;
                bestStyle = rank;
                bestOrigin = origin;
            }
        }
        return best;
    }

    private collapses(box: ElementBox): boolean {
        return this.keyword(box.style, "border-collapse") === "collapse";
    }

    private spacing(box: ElementBox): readonly [number, number] {
        // CSS 2 §17.6.1: border-spacing is the distance between the borders of adjoining cells, first in the inline axis.
        const value: CssValue | undefined = box.style.values["border-spacing"];
        if (value === undefined || this.collapses(box)) {
            return [0, 0];
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const across: number = this.sizes.pixels(items[0], 0);
        return [across, items.length > 1 ? this.sizes.pixels(items[1], 0) : across];
    }

    private side(side: number, sides?: readonly [number, number, number, number]): number {
        return sides === undefined ? 0 : sides[side];
    }

    private keyword(style: ComputedStyle, property: string): string {
        const value: CssValue | undefined = style.values[property];
        return value !== undefined && value.kind === "ident" ? value.lower : "";
    }
}
