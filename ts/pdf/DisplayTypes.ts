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

import type { CssValue, IdentValue } from "../css/values/CssValue.js";
import type { BoxNode, ElementBox } from "./BoxTree.js";

type OuterDisplay = "block" | "inline" | "run-in";

type InnerDisplay = "flow" | "flow-root" | "table" | "flex" | "grid" | "grid-lanes" | "ruby" | "math";

export interface DisplayType {
    box?: "none" | "contents";
    internal?: string;
    outer: OuterDisplay;
    inner: InnerDisplay;
    listItem: boolean;
}

const OUTER: ReadonlySet<string> = new Set<string>(["block", "inline", "run-in"]);
const INNER: ReadonlySet<string> = new Set<string>(["flow", "flow-root", "table", "flex", "grid", "grid-lanes", "ruby", "math"]);
const LEGACY: ReadonlyMap<string, InnerDisplay> = new Map<string, InnerDisplay>([
    ["inline-block", "flow-root"], ["inline-table", "table"], ["inline-flex", "flex"], ["inline-grid", "grid"], ["inline-grid-lanes", "grid-lanes"]
]);
const FLOW_ROOT_INTERNAL: ReadonlySet<string> = new Set<string>(["table-cell", "table-caption"]);
const FLOW_RUBY_INTERNAL: ReadonlySet<string> = new Set<string>(["ruby-base", "ruby-text"]);
const BREAKING_INTERNAL: ReadonlySet<string> = new Set<string>(["table-row", "table-row-group", "table-header-group", "table-footer-group", "table-caption"]);

export class DisplayTypes {

    static readonly SIZE_CONTAINMENT: number = 1;
    static readonly INLINE_SIZE_CONTAINMENT: number = 2;
    static readonly LAYOUT_CONTAINMENT: number = 4;
    static readonly STYLE_CONTAINMENT: number = 8;
    static readonly PAINT_CONTAINMENT: number = 16;
    static readonly SIZE_QUERIES: number = 32;

    private readonly parsed: WeakMap<CssValue, DisplayType> = new WeakMap<CssValue, DisplayType>();
    private readonly named: Map<string, DisplayType> = new Map<string, DisplayType>();
    private initial?: DisplayType;

    parse(value?: CssValue): DisplayType {
        // The same few values come for every box, so each one is read once; the result is shared and never changed.
        let display: DisplayType | undefined = value === undefined ? this.initial : this.parsed.get(value);
        if (display === undefined) {
            const keywords: Array<string> = this.keywords(value);
            const key: string = keywords.join(" ");
            display = this.named.get(key);
            if (display === undefined) {
                display = this.read(keywords);
                this.named.set(key, display);
            }
            if (value === undefined) {
                this.initial = display;
            } else {
                this.parsed.set(value, display);
            }
        }
        return display;
    }

    private read(keywords: ReadonlyArray<string>): DisplayType {
        // CSS Display 3 §2: the outer and inner types, the list-item flag, or one internal or box keyword.
        const display: DisplayType = { outer: "inline", inner: "flow", listItem: false };
        if (keywords.length === 1 && (keywords[0] === "none" || keywords[0] === "contents")) {
            return { ...display, box: keywords[0] };
        }
        if (keywords.length === 1 && keywords[0].startsWith("table-")) {
            // §2.4: table-cell and table-caption have a flow-root inner type.
            return { ...display, internal: keywords[0], outer: "block", inner: FLOW_ROOT_INTERNAL.has(keywords[0]) ? "flow-root" : "flow" };
        }
        if (keywords.length === 1 && keywords[0].startsWith("ruby-")) {
            // §2.4: ruby-base and ruby-text have a flow inner type; CSS Ruby 1 §2.1.1: the internal ruby boxes are in the
            // inline formatting context of their ruby container.
            return { ...display, internal: keywords[0], outer: "inline", inner: FLOW_RUBY_INTERNAL.has(keywords[0]) ? "flow" : "ruby" };
        }
        if (keywords.length === 1 && LEGACY.has(keywords[0])) {
            return { ...display, outer: "inline", inner: LEGACY.get(keywords[0]) as InnerDisplay };
        }
        const outer: string | undefined = keywords.find((keyword: string) => OUTER.has(keyword));
        const inner: string | undefined = keywords.find((keyword: string) => INNER.has(keyword));
        // §2.1 to §2.3: a missing inner type is flow, and a missing outer type is block, or inline for ruby. CSS Grid 3 §2.2
        // adds grid-lanes and inline-grid-lanes, and MathML Core §4.1 the inner type math.
        return {
            ...display,
            outer: (outer ?? (inner === "ruby" ? "inline" : "block")) as OuterDisplay,
            inner: (inner ?? "flow") as InnerDisplay,
            listItem: keywords.includes("list-item")
        };
    }

    blockify(display: DisplayType): DisplayType {
        // CSS Display 3 §2.7: the outer type becomes block; an inline flow-root or run-in flow-root becomes a block box, and a
        // layout-internal box a block container; none and contents generate no box and do not change.
        if (display.box !== undefined) {
            return display;
        }
        if (display.internal !== undefined) {
            return { outer: "block", inner: "flow", listItem: display.listItem };
        }
        const inner: InnerDisplay = display.outer !== "block" && display.inner === "flow-root" ? "flow" : display.inner;
        return { ...display, outer: "block", inner };
    }

    blockifyRoot(display: DisplayType): DisplayType {
        // CSS Display 3 §2.8: the root element is always blockified, and contents computes to block on it.
        if (display.box === "contents") {
            return { outer: "block", inner: "flow", listItem: false };
        }
        return this.blockify(display);
    }

    inlinify(display: DisplayType): DisplayType {
        // CSS Display 3 §2.7: the outer type becomes inline, and a block box becomes an inline block so that it stays a block
        // container; "Inlinification has no effect on layout-internal boxes", nor on none and contents.
        if (display.box !== undefined || display.internal !== undefined) {
            return display;
        }
        const inner: InnerDisplay = display.outer === "block" && display.inner === "flow" ? "flow-root" : display.inner;
        return { ...display, outer: "inline", inner };
    }

    isBlockContainer(display: DisplayType): boolean {
        // CSS Display 3 §2.2: flow-root generates a block container, and flow a block container or an inline box; among the
        // layout-internal boxes only the table cell and the table caption, which are flow-root, are block containers.
        return display.inner === "flow-root" || (display.inner === "flow" && display.internal === undefined && display.outer === "block");
    }

    isItemContainer(display: DisplayType): boolean {
        // CSS Grid 3 §2: "A grid lanes container is a grid container whose contents participate in grid lanes layout."
        return display.box === undefined && display.internal === undefined && (display.inner === "flex" || display.inner === "grid" || display.inner === "grid-lanes");
    }

    isTableRoot(display: DisplayType): boolean {
        return display.box === undefined && display.internal === undefined && display.inner === "table";
    }

    isRubyContainer(display: DisplayType): boolean {
        return display.box === undefined && display.internal === undefined && display.inner === "ruby";
    }

    isRubyBox(display: DisplayType): boolean {
        return this.isRubyContainer(display) || (display.internal !== undefined && display.internal.startsWith("ruby-"));
    }

    isInlineBox(display: DisplayType): boolean {
        return display.internal === undefined && display.outer !== "block" && display.inner === "flow";
    }

    takesPage(node: BoxNode): node is ElementBox {
        // CSS Paged Media 3 §8.1: page applies to "boxes that create class A break points", which CSS Fragmentation 4 §4.1
        // lists for block flow: in-flow block-level boxes, floats, table row groups and table rows; not cells or columns.
        if (node.kind !== "box") {
            return false;
        }
        const internal: string | undefined = node.display.internal;
        if (internal !== undefined) {
            return node.placement === "in-flow" && BREAKING_INTERNAL.has(internal);
        }
        return node.placement === "float" || (node.placement === "in-flow" && node.display.outer === "block");
    }

    containment(values: Readonly<Record<string, CssValue>>, display: DisplayType, replaced: boolean): number {
        // CSS Containment 2 §2: strict is size layout paint style and content is layout paint style; CSS Conditional 5 §5.1:
        // container-type size and inline-size apply style containment and size or inline-size containment.
        const contain: CssValue | undefined = values["contain"];
        const type: CssValue | undefined = values["container-type"];
        if ((contain === undefined || (contain.kind === "ident" && contain.lower === "none")) && (type === undefined || (type.kind === "ident" && type.lower === "normal"))) {
            return 0;
        }
        let flags: number = 0;
        for (const keyword of this.keywords(values["contain"])) {
            flags |= keyword === "strict" ? DisplayTypes.SIZE_CONTAINMENT | DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT | DisplayTypes.STYLE_CONTAINMENT
                : (keyword === "content" ? DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT | DisplayTypes.STYLE_CONTAINMENT : this.containmentOf(keyword));
        }
        for (const keyword of this.keywords(values["container-type"])) {
            if (keyword === "size" || keyword === "inline-size") {
                flags |= DisplayTypes.STYLE_CONTAINMENT | DisplayTypes.SIZE_QUERIES | this.containmentOf(keyword);
            }
        }
        if (flags === 0 || display.box !== undefined) {
            return flags & DisplayTypes.STYLE_CONTAINMENT;
        }
        // CSS Containment 2 §3.1, §3.2 and §3.4: no effect on an internal ruby box or a non-atomic inline-level box, nor on
        // an internal table box, except table-cell for layout and paint; size containment has none on a table either.
        const internal: string | undefined = display.internal;
        const inline: boolean = !replaced && internal === undefined && display.outer !== "block" && (display.inner === "flow" || display.inner === "ruby");
        if (inline || (internal !== undefined && internal.startsWith("ruby-"))) {
            return flags & DisplayTypes.STYLE_CONTAINMENT;
        }
        const tablePart: boolean = internal !== undefined && internal.startsWith("table-") && internal !== "table-caption";
        if (tablePart && internal !== "table-cell") {
            flags &= ~(DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT);
        }
        if (tablePart || this.isTableRoot(display)) {
            flags &= ~(DisplayTypes.SIZE_CONTAINMENT | DisplayTypes.INLINE_SIZE_CONTAINMENT | DisplayTypes.SIZE_QUERIES);
        }
        return flags;
    }

    private containmentOf(keyword: string): number {
        switch (keyword) {
            case "size":
                return DisplayTypes.SIZE_CONTAINMENT;
            case "inline-size":
                return DisplayTypes.INLINE_SIZE_CONTAINMENT;
            case "layout":
                return DisplayTypes.LAYOUT_CONTAINMENT;
            case "style":
                return DisplayTypes.STYLE_CONTAINMENT;
            case "paint":
                return DisplayTypes.PAINT_CONTAINMENT;
            default:
                return 0;
        }
    }

    value(display: DisplayType): CssValue {
        // The computed value: the box or internal keyword, or the outer and inner types with the list-item flag.
        let keywords: Array<string> = display.box !== undefined ? [display.box] : (display.internal !== undefined ? [display.internal] : [display.outer, display.inner]);
        if (display.box === undefined && display.internal === undefined && display.listItem) {
            keywords.push("list-item");
        }
        if (display.box === undefined && display.internal === undefined && display.inner === "grid-lanes") {
            // CSS Grid 3 §2.2: the grammar has only the two single keywords.
            keywords = [display.outer === "block" ? "grid-lanes" : "inline-grid-lanes"];
        }
        const items: Array<IdentValue> = keywords.map((keyword: string): IdentValue => ({ kind: "ident", name: keyword, lower: keyword }));
        return items.length === 1 ? items[0] : { kind: "list", separator: "space", items };
    }

    private keywords(value?: CssValue): Array<string> {
        if (value === undefined) {
            return ["inline"];
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        return items.filter((item: CssValue): item is IdentValue => item.kind === "ident").map((item: IdentValue) => item.lower);
    }
}
