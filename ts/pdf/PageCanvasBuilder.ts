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

import type { CssNode } from "css-tree";
import { parse } from "css-tree";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type { PropertyTable } from "../css/PropertyTable.js";
import type { Declaration, DeclaredValue, MarginBoxName, MarginRule, PageRule } from "../css/Stylesheet.js";
import { DEFAULT_PAGE_SIZE } from "../css/StylesheetReader.js";
import type { CalcLeaf, CalcNode, CssValue } from "../css/values/CssValue.js";
import type { CalcContext } from "../css/values/CalcSimplifier.js";
import { CalcSimplifier } from "../css/values/CalcSimplifier.js";
import type { Cascade } from "./Cascade.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { ContentValues } from "./ContentValues.js";
import type { Edges, PageCanvas, PageContext, PageMarginBox, Rectangle, Size } from "./PageCanvas.js";
import { StyleComputer } from "./StyleComputer.js";

type Length = number | "auto";

interface Solved {
    start: number;
    size: number;
    end: number;
    containing: number;
}

const MM: number = 96 / 25.4;
const IN: number = 96;
const PAGE_SIZES: ReadonlyMap<string, Size> = new Map<string, Size>([
    ["a5", { width: 148 * MM, height: 210 * MM }], ["a4", { width: 210 * MM, height: 297 * MM }], ["a3", { width: 297 * MM, height: 420 * MM }],
    ["b5", { width: 176 * MM, height: 250 * MM }], ["b4", { width: 250 * MM, height: 353 * MM }],
    ["jis-b5", { width: 182 * MM, height: 257 * MM }], ["jis-b4", { width: 257 * MM, height: 364 * MM }],
    ["letter", { width: 8.5 * IN, height: 11 * IN }], ["legal", { width: 8.5 * IN, height: 14 * IN }], ["ledger", { width: 11 * IN, height: 17 * IN }]
]);
const MARGIN_BOX_DEFAULTS: ReadonlyArray<readonly [MarginBoxName, readonly [string, string]]> = [
    ["top-left-corner", ["right", "middle"]], ["top-left", ["left", "middle"]], ["top-center", ["center", "middle"]], ["top-right", ["right", "middle"]],
    ["top-right-corner", ["left", "middle"]], ["left-top", ["center", "top"]], ["left-middle", ["center", "middle"]], ["left-bottom", ["center", "bottom"]],
    ["right-top", ["center", "top"]], ["right-middle", ["center", "middle"]], ["right-bottom", ["center", "bottom"]],
    ["bottom-left-corner", ["right", "middle"]], ["bottom-left", ["left", "middle"]], ["bottom-center", ["center", "middle"]],
    ["bottom-right", ["right", "middle"]], ["bottom-right-corner", ["left", "middle"]]
];
const CROP_BLEED: number = 6 * 96 / 72;
const BORDER_KEYWORDS: ReadonlyMap<string, number> = new Map<string, number>([["thin", 1], ["medium", 3], ["thick", 5]]);
const PAGE_RULE: string = "@page";

export class PageCanvasBuilder {

    static readonly DESCRIPTORS: ReadonlyArray<string> = ["size", "bleed", "marks", "page-orientation"];

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly rules: ReadonlyArray<PageRule>;
    private readonly userAgentRules: ReadonlyArray<PageRule>;
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();
    private readonly content: ContentValues = new ContentValues();

    constructor(cascade: Cascade, computer: StyleComputer, rules: ReadonlyArray<PageRule>, table: PropertyTable) {
        this.cascade = cascade;
        this.computer = computer;
        this.rules = rules;
        // CSS Paged Media 3 §6: the default page margin comes from the user agent stylesheet.
        const inch: DeclaredValue = { kind: "value", value: { kind: "dimension", value: 1, unit: "in" } };
        const margins: Array<Declaration> = StyleComputer.SIDES.map((side: string): Declaration => ({ property: "margin-" + side, value: inch, important: false }));
        // CSS Paged Media 3 §6.2: user agents behave as though their default style sheet set the values of Table 2.
        const reader: DeclarationReader = new DeclarationReader(table);
        const marginRules: Array<MarginRule> = [];
        for (const [name, [textAlign, verticalAlign]] of MARGIN_BOX_DEFAULTS) {
            const declarations: Array<Declaration> = [];
            const list: CssNode = parse("text-align: " + textAlign + "; vertical-align: " + verticalAlign, { context: "declarationList" });
            if (list.type === "DeclarationList") {
                for (const node of list.children.toArray()) {
                    const read: Array<Declaration> | undefined = node.type === "Declaration" ? reader.read(node, "about:blank", DeclarationReader.NO_NAMESPACES) : undefined;
                    if (read !== undefined) {
                        declarations.push(...read);
                    }
                }
            }
            marginRules.push({ name, declarations });
        }
        this.userAgentRules = [{ kind: "page", selectors: [], declarations: margins, marginRules, footnote: [], layer: 0, order: 0 }];
    }

    defaultPageArea(initial: ComputedStyle): Size {
        // Media queries assume the sheet chosen when no @page rule applies (CSS Paged Media 3 §7.1); its page area comes from
        // the user agent rules alone and the initial values.
        const context: PageContext = { first: false, side: "right", blank: false, position: 1, groups: [] };
        const area: Rectangle = this.buildWith(context, initial, { width: 0, height: 0 }, []).pageArea;
        return { width: area.width, height: area.height };
    }

    build(context: PageContext, root: ComputedStyle, viewport: Size): PageCanvas {
        return this.buildWith(context, root, viewport, this.rules);
    }

    private buildWith(context: PageContext, root: ComputedStyle, viewport: Size, rules: ReadonlyArray<PageRule>): PageCanvas {
        // CSS Paged Media 3 §6: the page context has a computed value for every property, even one that does not apply to the page box.
        const cascaded: Map<string, DeclaredValue> = this.cascade.page(context, rules, this.userAgentRules);
        const style: ComputedStyle = this.computer.compute(StyleComputer.input(cascaded, viewport, StyleComputer.NO_CONTAINERS, root, root, undefined, undefined,
            { atRule: PAGE_RULE, names: PageCanvasBuilder.DESCRIPTORS }));
        const values: Readonly<Record<string, CssValue>> = style.values;
        const box: Size = this.pageBoxSize(values["size"]);
        // CSS Paged Media 3 §3: the page box is sized like a non-replaced block in normal flow, in a containing block of the
        // size given by size; when over-constrained, the containing block is resized to the margin edges instead of dropping a margin.
        const horizontal: Solved = this.solve(box.width, values, "left", "right", "width");
        const vertical: Solved = this.solve(box.height, values, "top", "bottom", "height");
        const margins: Edges = { top: vertical.start, right: horizontal.end, bottom: vertical.end, left: horizontal.start };
        const borders: Edges = this.edges((side: keyof Edges) => this.borderWidth(values, side));
        const padding: Edges = this.edges((side: keyof Edges) => this.fixed(side === "left" || side === "right" ? box.width : box.height, values["padding-" + side]));
        const sheet: Size = { width: horizontal.containing, height: vertical.containing };
        const borderBox: Rectangle = { x: margins.left, y: margins.top, width: sheet.width - margins.left - margins.right, height: sheet.height - margins.top - margins.bottom };
        const pageArea: Rectangle = {
            x: margins.left + borders.left + padding.left,
            y: margins.top + borders.top + padding.top,
            width: horizontal.size,
            height: vertical.size
        };
        const marks: ReadonlyArray<string> | undefined = this.keywords(values["marks"]);
        const bleed: number = this.bleed(marks?.includes("crop") === true, values["bleed"]);
        const orientation: CssValue | undefined = values["page-orientation"];
        return {
            context,
            style,
            sheet,
            margins,
            borders,
            padding,
            borderBox,
            pageArea,
            bleed,
            cropMarks: marks?.includes("crop") === true,
            crossMarks: marks?.includes("cross") === true,
            orientation: orientation !== undefined && orientation.kind === "ident" && (orientation.lower === "rotate-left" || orientation.lower === "rotate-right") ? orientation.lower : "upright",
            marginAreas: {
                topLeftCorner: { x: 0, y: 0, width: margins.left, height: margins.top },
                top: { x: margins.left, y: 0, width: borderBox.width, height: margins.top },
                topRightCorner: { x: sheet.width - margins.right, y: 0, width: margins.right, height: margins.top },
                right: { x: sheet.width - margins.right, y: margins.top, width: margins.right, height: borderBox.height },
                bottomRightCorner: { x: sheet.width - margins.right, y: sheet.height - margins.bottom, width: margins.right, height: margins.bottom },
                bottom: { x: margins.left, y: sheet.height - margins.bottom, width: borderBox.width, height: margins.bottom },
                bottomLeftCorner: { x: 0, y: sheet.height - margins.bottom, width: margins.left, height: margins.bottom },
                left: { x: 0, y: margins.top, width: margins.left, height: borderBox.height }
            },
            marginBoxes: this.marginBoxes(context, style, root, viewport, rules)
        };
    }

    private marginBoxes(context: PageContext, page: ComputedStyle, root: ComputedStyle, viewport: Size, rules: ReadonlyArray<PageRule>): Array<PageMarginBox> {
        // CSS Paged Media 3 §6: "page-margin boxes inherit from the page context"; §5.2: content: normal computes to none, and
        // "A page-margin box is generated if and only if the computed value of its content property is not none."
        const boxes: Array<PageMarginBox> = [];
        for (const [name] of MARGIN_BOX_DEFAULTS) {
            const cascaded: Map<string, DeclaredValue> = this.cascade.marginBox(context, name, rules, this.userAgentRules);
            if (!cascaded.has("content")) {
                continue;
            }
            const style: ComputedStyle = this.computer.compute(StyleComputer.input(cascaded, viewport, StyleComputer.NO_CONTAINERS, page, root));
            if (this.content.items(style.values["content"]) !== undefined) {
                // A page-margin box gets its computed style here; CSS Paged Media 3 §5.3 computes its dimensions during layout.
                boxes.push({ name, style });
            }
        }
        return boxes;
    }

    private pageBoxSize(value?: CssValue): Size {
        // CSS Paged Media 3 §7.1: auto is the sheet the user agent chooses; one length makes a square; portrait puts the
        // shorter sides horizontal and landscape the longer ones; an orientation alone applies to the user agent's sheet.
        const lengths: Array<number> = [];
        let named: Size | undefined;
        let orientation: string | undefined;
        if (value !== undefined) {
            for (const item of value.kind === "list" ? value.items : [value]) {
                if (item.kind === "length") {
                    lengths.push(item.px);
                } else if (item.kind === "ident" && PAGE_SIZES.has(item.lower)) {
                    named = PAGE_SIZES.get(item.lower);
                } else if (item.kind === "ident" && (item.lower === "portrait" || item.lower === "landscape")) {
                    orientation = item.lower;
                }
            }
        }
        if (lengths.length > 0) {
            return { width: lengths[0], height: lengths.length > 1 ? lengths[1] : lengths[0] };
        }
        const sheet: Size = named ?? DEFAULT_PAGE_SIZE;
        const shorter: number = Math.min(sheet.width, sheet.height);
        const longer: number = Math.max(sheet.width, sheet.height);
        if (orientation === "landscape") {
            return { width: longer, height: shorter };
        }
        if (orientation === "portrait") {
            return { width: shorter, height: longer };
        }
        return sheet;
    }

    private solve(containing: number, values: Readonly<Record<string, CssValue>>, startSide: string, endSide: string, dimension: string): Solved {
        // CSS 2.1 §10.3.3 and §10.4, with CSS Paged Media 3 §6: percentages refer to the containing block in the same axis.
        const start: Length = this.length(containing, values["margin-" + startSide]);
        const end: Length = this.length(containing, values["margin-" + endSide]);
        const inner: number = this.borderWidth(values, startSide) + this.borderWidth(values, endSide)
            + this.fixed(containing, values["padding-" + startSide]) + this.fixed(containing, values["padding-" + endSide]);
        const minimum: Length = this.length(containing, values["min-" + dimension]);
        const maximum: Length = this.length(containing, values["max-" + dimension]);
        let solved: Solved = this.constrain(containing, start, this.length(containing, values[dimension]), end, inner);
        if (maximum !== "auto" && solved.size > maximum) {
            solved = this.constrain(containing, start, maximum, end, inner);
        }
        const floor: number = minimum === "auto" ? 0 : minimum;
        if (solved.size < floor) {
            solved = this.constrain(containing, start, floor, end, inner);
        }
        return solved;
    }

    private constrain(containing: number, start: Length, size: Length, end: Length, inner: number): Solved {
        if (size === "auto") {
            const startValue: number = start === "auto" ? 0 : start;
            const endValue: number = end === "auto" ? 0 : end;
            return { start: startValue, size: containing - startValue - inner - endValue, end: endValue, containing };
        }
        const used: number = size + inner + (start === "auto" ? 0 : start) + (end === "auto" ? 0 : end);
        if (used > containing || (start !== "auto" && end !== "auto")) {
            const startValue: number = start === "auto" ? 0 : start;
            const endValue: number = end === "auto" ? 0 : end;
            return { start: startValue, size, end: endValue, containing: startValue + inner + size + endValue };
        }
        const free: number = containing - used;
        if (start === "auto" && end === "auto") {
            return { start: free / 2, size, end: free / 2, containing };
        }
        if (start === "auto") {
            return { start: free, size, end: end === "auto" ? 0 : end, containing };
        }
        return { start, size, end: free, containing };
    }

    private borderWidth(values: Readonly<Record<string, CssValue>>, side: string): number {
        // CSS Backgrounds 3 §3.3: with a border style of none or hidden "the used width is 0"; §3.2: thin, medium and thick.
        const style: CssValue | undefined = values["border-" + side + "-style"];
        if (style === undefined || (style.kind === "ident" && (style.lower === "none" || style.lower === "hidden"))) {
            return 0;
        }
        const width: CssValue | undefined = values["border-" + side + "-width"];
        if (width !== undefined && width.kind === "ident") {
            return BORDER_KEYWORDS.get(width.lower) ?? 0;
        }
        return width === undefined ? BORDER_KEYWORDS.get("medium") as number : this.fixed(0, width);
    }

    private length(basis: number, value?: CssValue): Length {
        if (value === undefined || value.kind === "ident") {
            return value !== undefined && value.lower === "none" ? Number.POSITIVE_INFINITY : "auto";
        }
        return this.resolve(value, basis) ?? "auto";
    }

    private fixed(basis: number, value?: CssValue): number {
        return value === undefined ? 0 : (this.resolve(value, basis) ?? 0);
    }

    private resolve(value: CssValue, basis: number): number | undefined {
        switch (value.kind) {
            case "length":
                return value.px;
            case "percentage":
                return basis * value.value / 100;
            case "calc": {
                const context: CalcContext = {
                    toCanonical: (): number | undefined => undefined,
                    resolvePercentage: (percentage: number): CalcLeaf => ({ kind: "leaf", value: basis * percentage / 100, unit: "px" }),
                    rawPercentages: false
                };
                const resolved: CalcNode = this.simplifier.simplify(value.root, context);
                return resolved.kind === "leaf" && resolved.unit === "px" ? resolved.value : undefined;
            }
            default:
                return undefined;
        }
    }

    private bleed(crop: boolean, value?: CssValue): number {
        // CSS Paged Media 3 §7.3: auto computes to 6pt when marks has crop, and to zero otherwise.
        if (value !== undefined && value.kind === "length") {
            return value.px;
        }
        return crop ? CROP_BLEED : 0;
    }

    private keywords(value?: CssValue): Array<string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }

    private edges(of: (side: keyof Edges) => number): Edges {
        return { top: of("top"), right: of("right"), bottom: of("bottom"), left: of("left") };
    }

    firstPageSide(root: ComputedStyle): "left" | "right" {
        // CSS Paged Media 3 §3.3: the page progression follows the inline base direction of horizontal text and the block flow
        // direction of vertical text; with a left-to-right progression the first page is a right page.
        const mode: CssValue | undefined = root.values["writing-mode"];
        const direction: CssValue | undefined = root.values["direction"];
        const modeName: string = mode !== undefined && mode.kind === "ident" ? mode.lower : "horizontal-tb";
        if (modeName === "horizontal-tb") {
            return direction !== undefined && direction.kind === "ident" && direction.lower === "rtl" ? "left" : "right";
        }
        return modeName === "vertical-rl" || modeName === "sideways-rl" ? "left" : "right";
    }
}
