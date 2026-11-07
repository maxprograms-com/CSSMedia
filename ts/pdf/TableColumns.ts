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

import { TextNode } from "typesxml";
import type { CssValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import type { Cascade } from "./Cascade.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { ContentValues } from "./ContentValues.js";
import type { DisplayType } from "./DisplayTypes.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { SelectorMatcher } from "./SelectorMatcher.js";
import { StyleComputer } from "./StyleComputer.js";

type Role = "table" | "row-group" | "row" | "cell" | "column-group" | "column" | "caption" | "other";

interface Item {
    role: Role;
    element?: SourceElement;
    inside: ReadonlyArray<Item>;
}

interface Grid {
    tracks?: Map<number, Array<SourceElement>>;
    rows: Array<Array<SourceElement>>;
    count: number;
}

interface Slot {
    grid: Grid;
    column: number;
}

interface Pseudo {
    display: DisplayType;
    items: Array<CssValue>;
}

const TEXT: Item = { role: "other", inside: [] };

export class TableColumns {

    static readonly PROPERTIES: ReadonlySet<string> = new Set<string>(["display", "position", "float", "content", "all"]);

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly root: SourceElement;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly content: ContentValues = new ContentValues();
    private readonly slots: WeakMap<SourceElement, Slot> = new WeakMap<SourceElement, Slot>();
    private readonly grids: WeakMap<SourceElement, Grid> = new WeakMap<SourceElement, Grid>();
    private built: boolean = false;

    constructor(cascade: Cascade, computer: StyleComputer, root: SourceElement) {
        this.cascade = cascade;
        this.computer = computer;
        this.root = root;
    }

    columnsOf(cell: SourceElement): ReadonlyArray<SourceElement> | undefined {
        // Selectors 5 §8.1: the column elements of the column the cell belongs to, which are its table-column and the
        // table-column-group that holds it.
        this.build();
        const slot: Slot | undefined = this.slots.get(cell);
        return slot?.grid.tracks?.get(slot.column);
    }

    cellsOf(column: SourceElement): Array<SourceElement> | undefined {
        this.build();
        const grid: Grid | undefined = this.grids.get(column);
        if (grid === undefined || grid.tracks === undefined) {
            return undefined;
        }
        let cells: Array<SourceElement> | undefined;
        for (const [index, elements] of grid.tracks) {
            if (!elements.includes(column)) {
                continue;
            }
            for (const row of grid.rows) {
                for (const cell of row) {
                    if (this.slots.get(cell)?.column === index) {
                        cells = cells ?? [];
                        cells.push(cell);
                    }
                }
            }
        }
        return cells;
    }

    columnIndex(cell: SourceElement, fromEnd: boolean): number | undefined {
        // Selectors 5 §8.2 and §8.3: the columns before the cell's column, or after it, plus one.
        this.build();
        const slot: Slot | undefined = this.slots.get(cell);
        if (slot === undefined) {
            return undefined;
        }
        return fromEnd ? slot.grid.count - slot.column : slot.column + 1;
    }

    private build(): void {
        if (!this.built) {
            this.built = true;
            this.flow(this.element(this.root));
        }
    }

    private style(element: SourceElement, pseudoElement?: string, parent?: ComputedStyle): ComputedStyle {
        // The properties that decide which boxes exist, cascaded without the grid-structural selectors, which need the answer.
        return this.computer.compute(StyleComputer.input(this.cascade.structureDeclarations(element, pseudoElement), { width: 0, height: 0 }, StyleComputer.NO_CONTAINERS,
            parent, undefined, element, pseudoElement, undefined));
    }

    private element(element: SourceElement, parent?: ComputedStyle): ReadonlyArray<Item> {
        const style: ComputedStyle = this.style(element, undefined, parent);
        const display: DisplayType = this.displays.parse(style.values["display"]);
        if (display.box === "none") {
            return [];
        }
        const items: Array<CssValue> | undefined = this.content.items(style.values["content"]);
        const replaced: boolean = items !== undefined && this.content.isReplacement(items);
        const inside: ReadonlyArray<Item> = replaced ? [] : this.contentsOf(element, style, items);
        if (display.box === "contents") {
            // CSS Display 3 §2.5: the element is replaced in the box tree by its contents.
            return inside;
        }
        // CSS Tables 3 §2.1: a replaced element with a table display type is an inline-level or a block-level box.
        return [{ role: replaced ? "other" : this.role(display), element, inside }];
    }

    private contentsOf(element: SourceElement, style: ComputedStyle, items?: Array<CssValue>): ReadonlyArray<Item> {
        // CSS Content 3 §2.3: contents goes to the first of the element, ::before and ::after that uses it.
        const before: Pseudo | undefined = this.pseudo(element, style, "before");
        const after: Pseudo | undefined = this.pseudo(element, style, "after");
        const ownContents: boolean = items === undefined || this.content.usesContents(items);
        const beforeContents: boolean = !ownContents && before !== undefined && this.content.usesContents(before.items);
        const afterContents: boolean = !ownContents && !beforeContents && after !== undefined && this.content.usesContents(after.items);
        const result: Array<Item> = [];
        if (before !== undefined) {
            result.push(...this.pseudoItems(before, beforeContents ? this.children(element, style) : undefined));
        }
        if (items === undefined) {
            result.push(...this.children(element, style));
        } else {
            result.push(...this.generated(items, ownContents ? this.children(element, style) : undefined));
        }
        if (after !== undefined) {
            result.push(...this.pseudoItems(after, afterContents ? this.children(element, style) : undefined));
        }
        return result;
    }

    private children(element: SourceElement, style: ComputedStyle): Array<Item> {
        // CSS Tables 3 §2.2.1: the fixup discards the white space around and between the boxes of a table, so that text of
        // white space alone never makes an anonymous table box.
        const result: Array<Item> = [];
        for (const node of element.getContent()) {
            if (node instanceof TextNode) {
                if (!SelectorMatcher.WHITESPACE_ONLY.test(node.getValue())) {
                    result.push(TEXT);
                }
            } else if (node instanceof SourceElement) {
                result.push(...this.element(node, style));
            }
        }
        return result;
    }

    private pseudo(element: SourceElement, parent: ComputedStyle, name: string): Pseudo | undefined {
        // CSS Content 3 §1: with content normal or none, ::before and ::after are not generated.
        const style: ComputedStyle = this.style(element, name, parent);
        const display: DisplayType = this.displays.parse(style.values["display"]);
        const items: Array<CssValue> | undefined = this.content.items(style.values["content"]);
        return items === undefined || display.box === "none" ? undefined : { display, items };
    }

    private pseudoItems(pseudo: Pseudo, contents?: Array<Item>): ReadonlyArray<Item> {
        const replaced: boolean = this.content.isReplacement(pseudo.items);
        const inside: ReadonlyArray<Item> = replaced ? [] : this.generated(pseudo.items, contents);
        if (pseudo.display.box === "contents") {
            return inside;
        }
        return [{ role: replaced ? "other" : this.role(pseudo.display), inside }];
    }

    private generated(items: ReadonlyArray<CssValue>, contents?: Array<Item>): Array<Item> {
        // CSS Content 3 §2.3: the contents can be used only once; every other value is generated text or an image.
        const result: Array<Item> = [];
        let used: boolean = false;
        for (const item of items) {
            if (item.kind === "ident" && item.lower === "contents") {
                if (contents !== undefined && !used) {
                    result.push(...contents);
                    used = true;
                }
            } else if (!(item.kind === "string" && SelectorMatcher.WHITESPACE_ONLY.test(item.value))) {
                result.push(TEXT);
            }
        }
        return result;
    }

    private role(display: DisplayType): Role {
        // CSS Tables 3 §2.1: the display values that give an element a part in the table model.
        switch (display.internal) {
            case "table-row-group":
            case "table-header-group":
            case "table-footer-group":
                return "row-group";
            case "table-row":
                return "row";
            case "table-cell":
                return "cell";
            case "table-column-group":
                return "column-group";
            case "table-column":
                return "column";
            case "table-caption":
                return "caption";
            default:
                return display.inner === "table" ? "table" : "other";
        }
    }

    private flow(items: ReadonlyArray<Item>): void {
        // CSS Tables 3 §2.2.1, generate missing parents: an anonymous table goes around each sequence of consecutive
        // misparented table boxes, with the consecutive cells among them in an anonymous row.
        let run: Array<Item> = [];
        for (const item of items) {
            if (item.role !== "table" && item.role !== "other") {
                run.push(item);
                continue;
            }
            if (run.length > 0) {
                this.table(run);
                run = [];
            }
            if (item.role === "table") {
                this.table(item.inside);
            } else {
                this.flow(item.inside);
            }
        }
        if (run.length > 0) {
            this.table(run);
        }
    }

    private table(items: ReadonlyArray<Item>): void {
        // CSS Tables 3 §3.3.1 applies the table model of HTML, in which the columns are declared before the first row or
        // row group; §2.2.1 puts each sequence of children that are not proper table children in an anonymous row.
        const grid: Grid = { rows: [], count: 0 };
        let columnsOpen: boolean = true;
        let run: Array<Item> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                grid.rows.push(this.row(run, grid));
                run = [];
                columnsOpen = false;
            }
        };
        for (const item of items) {
            if (item.role === "cell" || item.role === "table" || item.role === "other") {
                run.push(item);
                continue;
            }
            flush();
            switch (item.role) {
                case "column-group":
                    if (columnsOpen) {
                        this.columnGroup(item, grid);
                    }
                    break;
                case "column":
                    // CSS Tables 3 §2.1: a table has "one or more table columns, optionally in column groups".
                    if (columnsOpen) {
                        this.track(grid, item.element === undefined ? undefined : [item.element]);
                    }
                    break;
                case "row-group":
                    columnsOpen = false;
                    this.rowGroup(item.inside, grid);
                    break;
                case "row":
                    columnsOpen = false;
                    grid.rows.push(this.row(item.inside, grid));
                    break;
                default:
                    this.flow(item.inside);
                    break;
            }
        }
        flush();
        if (grid.tracks !== undefined) {
            for (const track of grid.tracks.values()) {
                for (const column of track) {
                    this.grids.set(column, grid);
                }
            }
        }
    }

    private track(grid: Grid, elements?: Array<SourceElement>): void {
        // Columns are declared before the first row, so the count of columns so far is the index of the new one.
        if (elements !== undefined) {
            grid.tracks = grid.tracks ?? new Map<number, Array<SourceElement>>();
            grid.tracks.set(grid.count, elements);
        }
        grid.count++;
    }

    private columnGroup(group: Item, grid: Grid): void {
        // CSS Tables 3 §2.2.1 discards the children of a column group that are not columns; in the table model of HTML a
        // group holds one column for each column in it, or a single column when it has none.
        const owner: SourceElement | undefined = group.element;
        const columns: Array<Item> = group.inside.filter((item: Item) => item.role === "column");
        if (columns.length === 0) {
            this.track(grid, owner === undefined ? undefined : [owner]);
            return;
        }
        for (const column of columns) {
            if (column.element === undefined) {
                this.track(grid, owner === undefined ? undefined : [owner]);
            } else {
                this.track(grid, owner === undefined ? [column.element] : [column.element, owner]);
            }
        }
    }

    private rowGroup(items: ReadonlyArray<Item>, grid: Grid): void {
        // CSS Tables 3 §2.2.1: an anonymous row goes around each sequence of children of a row group that are not rows.
        let run: Array<Item> = [];
        for (const item of items) {
            if (item.role !== "row") {
                run.push(item);
                continue;
            }
            if (run.length > 0) {
                grid.rows.push(this.row(run, grid));
                run = [];
            }
            grid.rows.push(this.row(item.inside, grid));
        }
        if (run.length > 0) {
            grid.rows.push(this.row(run, grid));
        }
    }

    private row(items: ReadonlyArray<Item>, grid: Grid): Array<SourceElement> {
        // CSS Tables 3 §2.2.1: an anonymous cell goes around each sequence of children of a row that are not cells; §3.3.1:
        // CSS gives a cell no span, so each cell takes the next column of its row.
        const cells: Array<SourceElement> = [];
        let column: number = 0;
        let run: Array<Item> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                column++;
                this.flow(run);
                run = [];
            }
        };
        for (const item of items) {
            if (item.role !== "cell") {
                run.push(item);
                continue;
            }
            flush();
            if (item.element !== undefined) {
                this.slots.set(item.element, { grid, column });
                cells.push(item.element);
            }
            column++;
            this.flow(item.inside);
        }
        flush();
        grid.count = Math.max(grid.count, column);
        return cells;
    }
}
