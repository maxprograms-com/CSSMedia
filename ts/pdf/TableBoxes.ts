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
import type { BoxNode, ElementBox } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { DisplayType } from "./DisplayTypes.js";
import { DisplayTypes } from "./DisplayTypes.js";

type CellContent = (children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string) => Array<BoxNode>;

const TABLE: string = "table";
const ROW: string = "table-row";
const CELL: string = "table-cell";
const COLUMN: string = "table-column";
const COLUMN_GROUP: string = "table-column-group";
const CAPTION: string = "table-caption";
const HEADER_GROUP: string = "table-header-group";
const FOOTER_GROUP: string = "table-footer-group";
const ROW_GROUPS: ReadonlySet<string> = new Set<string>(["table-row-group", HEADER_GROUP, FOOTER_GROUP]);
const WHITE_SPACE: RegExp = /^[ \t\r\n]*$/;
const ROW_DISPLAY: DisplayType = { internal:ROW, outer: "block", inner: "flow", listItem: false };
const CELL_DISPLAY: DisplayType = { internal:CELL, outer: "block", inner: "flow-root", listItem: false };
const WRAPPER_PROPERTIES: ReadonlySet<string> = new Set<string>([
    "position", "float", "top", "right", "bottom", "left", "overflow-x", "overflow-y", "overflow-block", "overflow-inline", "opacity", "filter", "clip",
    "clip-path", "isolation", "mix-blend-mode", "perspective"
]);
const WRAPPER_PREFIXES: ReadonlyArray<string> = ["margin-", "inset-", "mask-", "transform"];

export class TableBoxes {

    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly cellContent: CellContent;

    constructor(cellContent: CellContent) {
        this.cellContent = cellContent;
    }

    arrange(display: DisplayType, children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): ReadonlyArray<BoxNode> {
        // CSS Tables 3 §2.2.1: the children of a box with this display type, after the three stages of the table fixup.
        const role: string | undefined = this.roleOf(display);
        if (role === undefined && !children.some((child: BoxNode) => this.kindOf(child) !== undefined)) {
            return children;
        }
        // "Children of a table-column" and "Children of a table-column-group which are not a table-column" are discarded.
        if (role === COLUMN) {
            return [];
        }
        if (role === COLUMN_GROUP) {
            return children.filter((child: BoxNode) => this.kindOf(child) === COLUMN);
        }
        const nodes: Array<BoxNode> = this.withoutWhiteSpace(children, role);
        // "Generate missing child wrappers": a row around what is not a proper table child in a table-root, or not a row in a
        // row group, and a cell around what is not a cell in a row.
        if (role === TABLE) {
            return this.wrapRuns(nodes, (kind?: string) => kind !== undefined && kind !== CELL, ROW_DISPLAY, style, usedPage);
        }
        if (role !== undefined && ROW_GROUPS.has(role)) {
            return this.wrapRuns(nodes, (kind?: string) => kind === ROW, ROW_DISPLAY, style, usedPage);
        }
        if (role === ROW) {
            return this.wrapRuns(nodes, (kind?: string) => kind === CELL, CELL_DISPLAY, style, usedPage);
        }
        return this.missingParents(display, nodes, style, usedPage);
    }

    wrap(grid: ElementBox): ElementBox {
        // CSS Tables 3 §2.2.1: "An anonymous table-wrapper box must be generated around each table-root. Its display type is
        // inline-block for inline-table boxes and block for table boxes"; §2.1.1: the table grid box excludes the captions.
        const style: ComputedStyle = grid.style;
        const isCaption: (node: BoxNode) => boolean = (node: BoxNode): boolean => this.kindOf(node) === CAPTION;
        const below: (node: BoxNode) => boolean = (node: BoxNode): boolean => {
            // CSS Tables 3 §3.5.3: caption-side puts a caption above or below the table grid box, which is its place in the flow.
            const side: CssValue | undefined = node.kind === "box" ? node.style.values["caption-side"] : undefined;
            return side !== undefined && side.kind === "ident" && side.lower === "bottom";
        };
        const wrapper: ElementBox = {
            kind: "box", style: this.splitStyle(style, true),
            display: {outer: grid.display.outer === "block" ? "block" : "inline", inner: "flow-root", listItem: false },
            placement: grid.placement, replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: grid.usedPage, startPage: grid.usedPage,
            endPage: grid.usedPage,
            children: [...grid.children.filter((node: BoxNode) => isCaption(node) && !below(node)), grid, ...grid.children.filter((node: BoxNode) => isCaption(node) && below(node))]
        };
        if (grid.runningName !== undefined) {
            wrapper.runningName = grid.runningName;
        }
        grid.children = grid.children.filter((node: BoxNode) => !isCaption(node));
        grid.style = this.splitStyle(style, false);
        grid.display = { ...grid.display, outer: "block" };
        grid.placement = "in-flow";
        delete grid.runningName;
        this.pageValues(wrapper);
        return wrapper;
    }

    pageValues(box: ElementBox): void {
        // CSS Paged Media 3 §8.1: the start and end page values of a box are "the value (if any) propagated from its first or
        // last child box", in the order of the flow, "else the used value on the box itself".
        const nodes: ReadonlyArray<BoxNode> = this.roleOf(box.display) === TABLE ? this.rowOrder(box.children) : box.children;
        const first: BoxNode | undefined = nodes[0];
        const last: BoxNode | undefined = nodes[nodes.length - 1];
        box.startPage = first !== undefined && this.displays.takesPage(first) ? first.startPage : box.usedPage;
        box.endPage = last !== undefined && this.displays.takesPage(last) ? last.endPage : box.usedPage;
    }

    private rowOrder(children: ReadonlyArray<BoxNode>): Array<BoxNode> {
        // CSS 2 §17.2: the first header group comes before the other rows and row groups, and the first footer group after
        // them; the columns are not in the block flow.
        const parts: Array<BoxNode> = children.filter((node: BoxNode) => {
            const kind: string | undefined = this.kindOf(node);
            return kind === ROW || (kind !== undefined && ROW_GROUPS.has(kind));
        });
        const header: BoxNode | undefined = parts.find((node: BoxNode) => this.kindOf(node) === HEADER_GROUP);
        const footer: BoxNode | undefined = parts.find((node: BoxNode) => this.kindOf(node) === FOOTER_GROUP);
        const body: Array<BoxNode> = parts.filter((node: BoxNode) => node !== header && node !== footer);
        return [...(header === undefined ? [] : [header]), ...body, ...(footer === undefined ? [] : [footer])];
    }

    private splitStyle(style: ComputedStyle, wrapper: boolean): ComputedStyle {
        // CSS Tables 3 §3.6.1: position, float, margin-*, the inset properties and those that could flatten transform-style
        // "are used on the table-wrapper box and not the table grid box"; a box takes "the unset values" for the others' share.
        if (style.values === style.inherited) {
            return style;
        }
        const values: Record<string, CssValue> = Object.create(style.inherited) as Record<string, CssValue>;
        for (const property of Object.keys(style.values)) {
            const wrapped: boolean = WRAPPER_PROPERTIES.has(property) || WRAPPER_PREFIXES.some((prefix: string) => property.startsWith(prefix));
            if (wrapped === wrapper) {
                values[property] = style.values[property];
            }
        }
        return { values, inherited: style.inherited, custom: style.custom };
    }

    private roleOf(display: DisplayType): string | undefined {
        if (display.box !== undefined) {
            return undefined;
        }
        if (display.internal !== undefined) {
            return display.internal.startsWith("table-") ? display.internal : undefined;
        }
        return display.inner === "table" ? TABLE : undefined;
    }

    private kindOf(node: BoxNode): string | undefined {
        // "out-of-flow elements are represented as inline elements of zero width and height."
        const internal: string | undefined = node.kind === "box" && node.placement === "in-flow" ? node.display.internal : undefined;
        return internal !== undefined && internal.startsWith("table-") ? internal : undefined;
    }

    private isWhite(node: BoxNode): boolean {
        return node.kind === "text" && WHITE_SPACE.test(node.text);
    }

    private withoutWhiteSpace(children: ReadonlyArray<BoxNode>, role?: string): Array<BoxNode> {
        // "Remove irrelevant boxes": white space between two table-non-root boxes, and white space that is the first or last
        // child of a tabular container "whose immediate sibling, if any, is a table-non-root box".
        const tabular: boolean = role === TABLE || role === ROW || (role !== undefined && ROW_GROUPS.has(role));
        const result: Array<BoxNode> = [];
        let index: number = 0;
        while (index < children.length) {
            if (!this.isWhite(children[index])) {
                result.push(children[index]);
                index++;
                continue;
            }
            let end: number = index;
            while (end < children.length && this.isWhite(children[end])) {
                end++;
            }
            const first: boolean = index === 0;
            const last: boolean = end === children.length;
            const tableBefore: boolean = !first && this.kindOf(children[index - 1]) !== undefined;
            const tableAfter: boolean = !last && this.kindOf(children[end]) !== undefined;
            const between: boolean = tableBefore && tableAfter;
            const edge: boolean = tabular && (first || last) && (first || tableBefore) && (last || tableAfter);
            if (!between && !edge) {
                result.push(...children.slice(index, end));
            }
            index = end;
        }
        return result;
    }

    private wrapRuns(nodes: ReadonlyArray<BoxNode>, keeps: (kind?: string) => boolean, wrapper: DisplayType, style: ComputedStyle,
        usedPage: string): Array<BoxNode> {
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                const anonymous: ComputedStyle = this.inherited(style);
                const content: Array<BoxNode> = wrapper === CELL_DISPLAY ? this.cellContent(run, anonymous, usedPage) : [...this.arrange(wrapper, run, anonymous, usedPage)];
                result.push(this.anonymous(wrapper, anonymous, usedPage, content));
                run = [];
            }
        };
        for (const node of nodes) {
            if (keeps(this.kindOf(node))) {
                flush();
                result.push(node);
            } else {
                run.push(node);
            }
        }
        flush();
        return result;
    }

    private missingParents(display: DisplayType, nodes: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): Array<BoxNode> {
        // "An anonymous table-row box must be generated around each sequence of consecutive table-cell boxes whose parent is
        // not a table-row."
        const rows: Array<BoxNode> = [];
        let cells: Array<BoxNode> = [];
        const flushCells: () => void = (): void => {
            if (cells.length > 0) {
                rows.push(this.anonymous(ROW_DISPLAY, this.inherited(style), usedPage, cells));
                cells = [];
            }
        };
        for (const node of nodes) {
            if (this.kindOf(node) === CELL) {
                cells.push(node);
            } else {
                flushCells();
                rows.push(node);
            }
        }
        flushCells();
        // "An anonymous table or inline-table box must be generated around each sequence of consecutive proper table child
        // boxes which are misparented", inline-table when "the box's parent is an inline, run-in, or ruby box".
        const inline: boolean = this.displays.isInlineBox(display) || this.displays.isRubyBox(display);
        const table: DisplayType = {outer: inline ? "inline" : "block", inner: "table", listItem: false };
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                result.push(this.wrap(this.anonymous(table, this.inherited(style), usedPage, run)));
                run = [];
            }
        };
        for (const node of rows) {
            if (this.kindOf(node) === undefined) {
                flush();
                result.push(node);
            } else {
                run.push(node);
            }
        }
        flush();
        return result;
    }

    private inherited(style: ComputedStyle): ComputedStyle {
        // CSS Tables 3 §2.2.2: the fixup boxes "do not receive any specific or default styling", and inherit through the box tree.
        return { values: style.inherited, inherited: style.inherited, custom: style.custom };
    }

    private anonymous(display: DisplayType, style: ComputedStyle, usedPage: string, children: Array<BoxNode>): ElementBox {
        const box: ElementBox = {
            kind: "box", style, display, placement: "in-flow", replaced: false,
            hasStartEdge: true, hasEndEdge: true, usedPage, startPage: usedPage, endPage: usedPage, children
        };
        this.pageValues(box);
        return box;
    }
}
