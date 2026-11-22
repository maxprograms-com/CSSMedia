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

import type { CalcAnchor, CalcNode, CssValue, IdentValue } from "../css/values/CssValue.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { BoxSizes } from "./BoxSizes.js";

export type Tracks = readonly [number, number];

export interface Area {
    inline: Tracks;
    block: Tracks;
}

export type AlignKind = "start" | "end" | "center" | "stretch" | "normal" | "anchor-center";

export interface Alignment {
    kind: AlignKind;
    overflow?: "safe" | "unsafe";
}

interface AreaWord {
    axis?: string;
    kind: string;
    physical?: number;
    self: boolean;
}

const TOP: number = 0;
const RIGHT: number = 1;
const BOTTOM: number = 2;
const LEFT: number = 3;
const PHYSICAL_NAMES: ReadonlyArray<string> = ["top", "right", "bottom", "left"];
const SIDE_NAMES: ReadonlyArray<string> = ["block-start", "inline-end", "block-end", "inline-start"];
const PHYSICAL_WORDS: ReadonlyMap<string, number> = new Map<string, number>([["top", TOP], ["right", RIGHT], ["bottom", BOTTOM], ["left", LEFT]]);
const FLIPPED_POSITIONS: ReadonlyMap<string, string> = new Map<string, string>([
    ["start", "end"], ["end", "start"], ["flex-start", "flex-end"], ["flex-end", "flex-start"], ["self-start", "self-end"], ["self-end", "self-start"], ["left", "right"],
    ["right", "left"]
]);
const FLIPPED_SIZES: ReadonlyMap<string, string> = new Map<string, string>([
    ["width", "height"], ["height", "width"], ["block", "inline"], ["inline", "block"], ["self-block", "self-inline"], ["self-inline", "self-block"]
]);
const SIZE_PAIRS: ReadonlyArray<readonly [string, string]> = [["width", "height"], ["min-width", "min-height"], ["max-width", "max-height"]];

export class AnchorPositioning {

    private readonly sizes: BoxSizes;

    constructor(sizes: BoxSizes) {
        this.sizes = sizes;
    }

    area(value: CssValue | undefined, frame: number, own: number): Area | undefined {
        // CSS Anchor Positioning 1 §3.1.2: a pair of keywords selects the rows and columns of the grid, flow-relative ones in the writing mode of the
        // containing block or, the self-* ones, of the box; an ambiguous keyword takes the axis the other one leaves, the block axis first.
        if (value === undefined || (value.kind === "ident" && value.lower === "none")) {
            return undefined;
        }
        const words: Array<AreaWord> = [];
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind !== "ident") {
                return undefined;
            }
            words.push(this.word(item.lower));
        }
        if (words.length === 0 || words.length > 2) {
            return undefined;
        }
        if (words.length === 1) {
            // "If only a single keyword is given, it behaves as if the second keyword is span-all if the given keyword is unambigous about its
            // axis; otherwise, it behaves as if the given keyword was repeated."
            words.push(words[0].axis === undefined ? words[0] : { kind: "all", self: false });
        }
        let first: string | undefined = words[0].axis === undefined ? undefined : this.cbAxis(words[0].axis, frame, own);
        let second: string | undefined = words[1].axis === undefined ? undefined : this.cbAxis(words[1].axis, frame, own);
        if (first === undefined && second === undefined) {
            first = "block";
            second = "inline";
        } else if (first === undefined) {
            first = second === "block" ? "inline" : "block";
        } else if (second === undefined) {
            second = first === "block" ? "inline" : "block";
        }
        if (first === second) {
            return undefined;
        }
        const firstTracks: Tracks = this.tracks(words[0], first, frame, own);
        const secondTracks: Tracks = this.tracks(words[1], second as string, frame, own);
        return first === "inline" ? { inline: firstTracks, block: secondTracks } : { inline: secondTracks, block: firstTracks };
    }

    private word(keyword: string): AreaWord {
        if (keyword === "center") {
            return { kind: "center", self: false };
        }
        if (keyword === "span-all") {
            return { kind: "all", self: false };
        }
        const span: boolean = keyword.startsWith("span-");
        let base: string = span ? keyword.slice(5) : keyword;
        const physical: number | undefined = PHYSICAL_WORDS.get(base);
        if (physical !== undefined) {
            return { axis: physical === LEFT || physical === RIGHT ? "x" : "y", kind: span ? "span-start" : "start", physical, self: false };
        }
        const self: boolean = base.startsWith("self-");
        base = self ? base.slice(5) : base;
        const end: boolean = base.endsWith("end");
        const kind: string = (span ? "span-" : "") + (end ? "end" : "start");
        const prefix: string = base.slice(0, base.lastIndexOf("-") + 1);
        const axis: string | undefined = prefix === "x-" ? "x" : (prefix === "y-" ? "y" : (prefix === "block-" ? "block" : (prefix === "inline-" ? "inline" : undefined)));
        return axis === undefined ? { kind, self } : { axis: self && (axis === "block" || axis === "inline") ? "self-" + axis : axis, kind, self };
    }

    private cbAxis(axis: string, frame: number, own: number): string {
        // The physical axes and the axes of the box are those of the containing block that run the same way.
        const horizontal: boolean = (frame & BoxSizes.VERTICAL) === 0;
        if (axis === "x") {
            return horizontal ? "inline" : "block";
        }
        if (axis === "y") {
            return horizontal ? "block" : "inline";
        }
        if (axis === "self-block" || axis === "self-inline") {
            const ownInlineHorizontal: boolean = (own & BoxSizes.VERTICAL) === 0;
            const runsInline: boolean = (axis === "self-inline") === (ownInlineHorizontal === horizontal);
            return runsInline ? "inline" : "block";
        }
        return axis;
    }

    private tracks(word: AreaWord, axis: string, frame: number, own: number): Tracks {
        // Each keyword names tracks counted from the start of its own direction, which the containing block counts from its start or its end.
        let tracks: Tracks;
        switch (word.kind) {
            case "center":
                return [1, 1];
            case "all":
                return [0, 2];
            case "start":
                tracks = [0, 0];
                break;
            case "end":
                tracks = [2, 2];
                break;
            case "span-start":
                tracks = [0, 1];
                break;
            default:
                tracks = [1, 2];
        }
        const start: number = axis === "block" ? BoxSizes.BLOCK_START : BoxSizes.INLINE_START;
        let forward: boolean = true;
        if (word.physical !== undefined) {
            forward = this.sizes.physicalSide(frame, start) === word.physical;
        } else if (word.self) {
            forward = this.startSide(axis, frame, own) === start;
        }
        return forward ? tracks : [2 - tracks[1], 2 - tracks[0]];
    }

    startSide(axis: string, frame: number, own: number): number {
        // The side of the containing block where the box's own writing mode starts the axis.
        for (const side of [BoxSizes.BLOCK_START, BoxSizes.INLINE_START]) {
            const mapped: number = this.sizes.side(own, frame, side);
            if ((mapped === BoxSizes.BLOCK_START || mapped === BoxSizes.BLOCK_END) === (axis === "block")) {
                return mapped;
            }
        }
        return axis === "block" ? BoxSizes.BLOCK_START : BoxSizes.INLINE_START;
    }

    areaValue(area: Area): CssValue {
        // The value written with the flow-relative keywords of the containing block, block axis first.
        const word: (tracks: Tracks, axis: string) => string = (tracks: Tracks, axis: string): string => {
            if (tracks[0] === tracks[1]) {
                return tracks[0] === 1 ? "center" : axis + (tracks[0] === 0 ? "-start" : "-end");
            }
            return tracks[1] - tracks[0] === 2 ? "span-all" : "span-" + axis + (tracks[0] === 0 ? "-start" : "-end");
        };
        const items: Array<IdentValue> = [word(area.block, "block"), word(area.inline, "inline")].map((name: string): IdentValue => ({ kind: "ident", name, lower: name }));
        return { kind: "list", separator: "space", items };
    }

    alignment(value: CssValue | undefined, inline: boolean, frame: number, own: number): Alignment {
        // CSS Box Alignment 3 §6.1 and §6.2: auto is normal for the place of an absolutely positioned box; self-start and self-end follow the
        // box's writing mode, left and right the line-left and line-right; §4.2: a baseline falls back to safe self-start or safe self-end.
        const words: Array<string> = [];
        for (const item of value === undefined ? [] : (value.kind === "list" ? value.items : [value])) {
            if (item.kind === "ident") {
                words.push(item.lower);
            }
        }
        const overflow: "safe" | "unsafe" | undefined = words.includes("safe") ? "safe" : (words.includes("unsafe") ? "unsafe" : undefined);
        const keyword: string = words.find((word: string) => word !== "safe" && word !== "unsafe" && word !== "first") ?? "normal";
        const axis: string = inline ? "inline" : "block";
        const start: number = inline ? BoxSizes.INLINE_START : BoxSizes.BLOCK_START;
        let kind: AlignKind;
        let fallback: "safe" | "unsafe" | undefined = overflow;
        switch (keyword) {
            case "start":
            case "flex-start":
                kind = "start";
                break;
            case "end":
            case "flex-end":
                kind = "end";
                break;
            case "center":
            case "stretch":
            case "anchor-center":
                kind = keyword;
                break;
            case "self-start":
            case "self-end":
            case "baseline":
            case "last": {
                const ownStart: boolean = this.startSide(axis, frame, own) === start;
                kind = (keyword === "self-start" || keyword === "baseline") === ownStart ? "start" : "end";
                fallback = keyword === "baseline" || keyword === "last" ? "safe" : overflow;
                break;
            }
            case "left":
            case "right":
                // §5.1: the line-left or physical left edge, "whichever is in the appropriate axis", and start in an axis that has neither.
                if (inline) {
                    kind = (keyword === "left") === ((frame & BoxSizes.RIGHT_TO_LEFT) === 0) ? "start" : "end";
                } else if ((frame & BoxSizes.VERTICAL) !== 0) {
                    kind = (keyword === "left") === (this.sizes.physicalSide(frame, BoxSizes.BLOCK_START) === LEFT) ? "start" : "end";
                } else {
                    kind = "start";
                }
                break;
            default:
                kind = "normal";
        }
        return fallback === undefined ? { kind } : { kind, overflow: fallback };
    }

    tactic(style: ComputedStyle, tactics: ReadonlyArray<string>, frame: number): ComputedStyle {
        // CSS Anchor Positioning 1 §6.5.2: a try tactic swaps the accepted @position-try properties between two directions and changes their
        // values to keep their relation to the new direction; logical directions are those of the containing block, and the tactics compose.
        const own: number = this.sizes.frame(style);
        const values: Record<string, CssValue> = {};
        const read: (name: string) => CssValue | undefined = (name: string): CssValue | undefined => name in values ? values[name] : style.values[name];
        for (const tactic of tactics) {
            const pairs: Array<readonly [number, number]> = [];
            let perpendicular: boolean = false;
            if (tactic === "flip-x") {
                pairs.push([LEFT, RIGHT]);
            } else if (tactic === "flip-y") {
                pairs.push([TOP, BOTTOM]);
            } else if (tactic === "flip-block" || tactic === "flip-inline") {
                const start: number = tactic === "flip-block" ? BoxSizes.BLOCK_START : BoxSizes.INLINE_START;
                const end: number = tactic === "flip-block" ? BoxSizes.BLOCK_END : BoxSizes.INLINE_END;
                pairs.push([this.sizes.physicalSide(frame, start), this.sizes.physicalSide(frame, end)]);
            } else if (tactic === "flip-start") {
                perpendicular = true;
                pairs.push([this.sizes.physicalSide(frame, BoxSizes.BLOCK_START), this.sizes.physicalSide(frame, BoxSizes.INLINE_START)],
                    [this.sizes.physicalSide(frame, BoxSizes.BLOCK_END), this.sizes.physicalSide(frame, BoxSizes.INLINE_END)]);
            } else {
                continue;
            }
            const map: (side: number) => number = (side: number): number => {
                for (const [first, second] of pairs) {
                    if (side === first) {
                        return second;
                    }
                    if (side === second) {
                        return first;
                    }
                }
                return side;
            };
            const insets: Array<CssValue | undefined> = PHYSICAL_NAMES.map((name: string) => read(name));
            const margins: Array<CssValue | undefined> = PHYSICAL_NAMES.map((name: string) => read("margin-" + name));
            for (let side: number = 0; side < 4; side++) {
                const target: number = map(side);
                if (target === side) {
                    continue;
                }
                const inset: CssValue | undefined = insets[side];
                if (inset !== undefined) {
                    values[PHYSICAL_NAMES[target]] = this.flippedInset(inset, map, perpendicular);
                }
                const margin: CssValue | undefined = margins[side];
                if (margin !== undefined) {
                    values["margin-" + PHYSICAL_NAMES[target]] = margin;
                }
            }
            const horizontalCb: boolean = (frame & BoxSizes.VERTICAL) === 0;
            if (perpendicular) {
                for (const [width, height] of SIZE_PAIRS) {
                    const across: CssValue | undefined = read(width);
                    const down: CssValue | undefined = read(height);
                    if (across !== undefined) {
                        values[height] = this.flippedSize(across);
                    }
                    if (down !== undefined) {
                        values[width] = this.flippedSize(down);
                    }
                }
                const justify: CssValue | undefined = read("justify-self");
                const align: CssValue | undefined = read("align-self");
                if (justify !== undefined) {
                    values["align-self"] = justify;
                }
                if (align !== undefined) {
                    values["justify-self"] = align;
                }
            } else {
                // The pair is on one physical axis, which is the inline or the block axis of the containing block.
                const horizontalPair: boolean = pairs[0][0] === LEFT || pairs[0][0] === RIGHT;
                const property: string = horizontalPair === horizontalCb ? "justify-self" : "align-self";
                const current: CssValue | undefined = read(property);
                if (current !== undefined) {
                    values[property] = this.flippedAlignment(current);
                }
            }
            const area: Area | undefined = this.area(read("position-area"), frame, own);
            if (area !== undefined) {
                let changed: Area = area;
                if (perpendicular) {
                    changed = { inline: area.block, block: area.inline };
                } else {
                    const inlinePair: boolean = (pairs[0][0] === LEFT || pairs[0][0] === RIGHT) === horizontalCb;
                    const reversed: (tracks: Tracks) => Tracks = (tracks: Tracks): Tracks => [2 - tracks[1], 2 - tracks[0]];
                    changed = inlinePair ? { inline: reversed(area.inline), block: area.block } : { inline: area.inline, block: reversed(area.block) };
                }
                values["position-area"] = this.areaValue(changed);
            }
        }
        // The flow-relative properties share their computed values with the physical ones of the box's writing mode (CSS Logical 1 §4).
        for (let side: number = 0; side < 4; side++) {
            const physical: string = PHYSICAL_NAMES[this.sizes.physicalSide(own, side)];
            if (physical in values) {
                values["inset-" + SIDE_NAMES[side]] = values[physical];
            }
            if ("margin-" + physical in values) {
                values["margin-" + SIDE_NAMES[side]] = values["margin-" + physical];
            }
        }
        const ownHorizontal: boolean = (own & BoxSizes.VERTICAL) === 0;
        for (const [logical, horizontal, vertical] of [["inline-size", "width", "height"], ["block-size", "height", "width"], ["min-inline-size", "min-width", "min-height"],
            ["min-block-size", "min-height", "min-width"], ["max-inline-size", "max-width", "max-height"], ["max-block-size", "max-height", "max-width"]] as ReadonlyArray<readonly [string, string, string]>) {
            const physical: string = ownHorizontal ? horizontal : vertical;
            if (physical in values) {
                values[logical] = values[physical];
            }
        }
        return { ...style, values: Object.assign(Object.create(style.values) as Record<string, CssValue>, values) };
    }

    withArea(style: ComputedStyle, area: CssValue): ComputedStyle {
        // §6.1: a <position-area> entry is a position option "composed solely of a position-area property with the given value".
        return { ...style, values: Object.assign(Object.create(style.values) as Record<string, CssValue>, { "position-area": area }) };
    }

    private flippedInset(value: CssValue, map: (side: number) => number, perpendicular: boolean): CssValue {
        // §6.5.2: an anchor() keeps "the same relative relationship to the new direction": across opposing directions its sides on that axis
        // swap and a percentage becomes 100% minus it; across perpendicular ones a physical side moves to the other axis.
        if (value.kind !== "calc") {
            return value;
        }
        const anchor: (node: CalcAnchor) => CalcAnchor = (node: CalcAnchor): CalcAnchor => {
            if (node.name !== "anchor") {
                return node;
            }
            const changed: CalcAnchor = { ...node };
            const physical: number | undefined = node.keyword === undefined ? undefined : PHYSICAL_WORDS.get(node.keyword);
            if (physical !== undefined) {
                changed.keyword = PHYSICAL_NAMES[map(physical)];
            } else if (!perpendicular && node.keyword !== undefined) {
                changed.keyword = FLIPPED_POSITIONS.get(node.keyword) ?? node.keyword;
            }
            if (!perpendicular && node.percent !== undefined) {
                changed.percent = 100 - node.percent;
            }
            return changed;
        };
        return { kind: "calc", root: this.mapAnchors(value.root, anchor) };
    }

    private flippedSize(value: CssValue): CssValue {
        // §6.5.2: "For sizing properties, change the specified axis in anchor-size() functions".
        if (value.kind !== "calc") {
            return value;
        }
        return {
            kind: "calc", root: this.mapAnchors(value.root, (node: CalcAnchor): CalcAnchor => node.name === "anchor-size" && node.keyword !== undefined
                ? { ...node, keyword: FLIPPED_SIZES.get(node.keyword) ?? node.keyword } : node)
        };
    }

    private flippedAlignment(value: CssValue): CssValue {
        // §6.5.2: for opposing directions "change the specified <self-position> (or left/right keywords)"; center and baselines stay.
        const flip: (item: CssValue) => CssValue = (item: CssValue): CssValue => {
            const name: string | undefined = item.kind === "ident" ? FLIPPED_POSITIONS.get(item.lower) : undefined;
            return name === undefined ? item : { kind: "ident", name, lower: name };
        };
        return value.kind === "list" ? { ...value, items: value.items.map(flip) } : flip(value);
    }

    private mapAnchors(node: CalcNode, change: (anchor: CalcAnchor) => CalcAnchor): CalcNode {
        if (node.kind === "anchor") {
            const changed: CalcAnchor = change(node);
            return node.fallback === undefined ? changed : { ...changed, fallback: this.mapAnchors(node.fallback, change) };
        }
        if (node.kind === "leaf" || node.kind === "channel") {
            return node;
        }
        const children: Array<CalcNode> = node.children.map((child: CalcNode) => this.mapAnchors(child, change));
        return node.kind === "round" ? { kind: "round", strategy: node.strategy, children } : { kind: "operation", operator: node.operator, children };
    }
}
