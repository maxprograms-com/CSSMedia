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
import type { ElementBox } from "../pdf/BoxTree.js";
import { BoxSizes } from "./BoxSizes.js";
import type { BoxFragment } from "./Fragment.js";

export interface StackedFloat {
    box: ElementBox;
    fragment: BoxFragment;
    side: number;
    inlineSize: number;
    blockSize: number;
    start: number;
    before: number;
    offset?: CssValue;
    closes: number;
}

export interface FloatArea {
    inlineStart: number;
    inlineSize: number;
    blockStart: number;
    blockSize: number;
    fits: boolean;
}

const TOLERANCE: number = 0.001;
const TOP: number = 0;
const RIGHT: number = 1;
const BOTTOM: number = 2;
const LEFT: number = 3;
const PHYSICAL: ReadonlyMap<string, number> = new Map<string, number>([["top", TOP], ["right", RIGHT], ["bottom", BOTTOM], ["left", LEFT]]);
const LOGICAL: ReadonlyMap<string, number> = new Map<string, number>([
    ["block-start", BoxSizes.BLOCK_START], ["block-end", BoxSizes.BLOCK_END], ["inline-start", BoxSizes.INLINE_START], ["inline-end", BoxSizes.INLINE_END]
]);

export class FloatStack {

    private readonly sizes: BoxSizes;

    constructor(sizes: BoxSizes) {
        this.sizes = sizes;
    }

    side(value: CssValue | undefined, frame: number): number | undefined {
        // CSS Page Floats 3 §3.2: a page float goes to an edge of its float reference, and left, right, top and bottom behave like the
        // flow-relative value of that edge "depending on the float containing block's direction and writing-mode".
        const keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "none";
        const logical: number | undefined = LOGICAL.get(keyword);
        if (logical !== undefined) {
            return logical;
        }
        const physical: number | undefined = PHYSICAL.get(keyword);
        return physical === undefined ? undefined : this.logicalSide(frame, physical);
    }

    closes(value: CssValue | undefined, frame: number): number {
        // §4: on a page float, clear makes its float reference "seen as full" for the later page floats that float in the directions
        // it names; CSS 2 §9.5.2: both names the left and the right.
        const keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "none";
        if (keyword === "both") {
            return (1 << this.logicalSide(frame, LEFT)) | (1 << this.logicalSide(frame, RIGHT));
        }
        const side: number | undefined = this.side(value, frame);
        return side === undefined ? 0 : 1 << side;
    }

    target(value: CssValue | undefined, at: number, last: number): number {
        // CSS Page Floats 3 §5.1, with fragmentation containers counted from 1: a positive float-defer counts on from the container of the
        // anchor and stops at the last one, a negative one counts back from the last, and last is the last; "If the value of the float-defer
        // property would cause the initial float reference to be an inexistent fragmentation container, the property is interpreted as if it
        // were zero."
        const final: number = Math.max(at, last);
        if (value !== undefined && value.kind === "ident") {
            return value.lower === "last" ? final : at;
        }
        if (value === undefined || value.kind !== "number" || value.value === 0) {
            return at;
        }
        if (value.value > 0) {
            return Math.min(at + value.value, final);
        }
        const counted: number = final + 1 + value.value;
        return counted < 1 ? at : counted;
    }

    arrange(floats: ReadonlyArray<StackedFloat>, inlineSize: number, blockSize: number): FloatArea {
        // §8.2: page floats are stacked "in the order of their placement", without overlapping, and "it is assumed that the page floats in
        // the block directions fill the entire line size of the float reference and page floats in the inline direction fill the entire
        // block size"; each keeps "a distance N" from the edge or the last float of its value, N being its float-offset.
        const low: [number, number] = [0, 0];
        const high: [number, number] = [inlineSize, blockSize];
        let closed: number = 0;
        let fits: boolean = true;
        for (const float of floats) {
            if ((closed & (1 << float.side)) !== 0) {
                fits = false;
            }
            const block: boolean = float.side === BoxSizes.BLOCK_START || float.side === BoxSizes.BLOCK_END;
            const axis: number = block ? 1 : 0;
            const extent: number = block ? float.blockSize : float.inlineSize;
            // §7: a percentage of float-offset is of the reference size less the float's own, along the axis it floats in.
            const gap: number = float.offset === undefined ? 0 : this.sizes.pixels(float.offset, (block ? blockSize : inlineSize) - extent);
            const near: boolean = float.side === BoxSizes.BLOCK_START || float.side === BoxSizes.INLINE_START;
            if (gap + extent > high[axis] - low[axis] + TOLERANCE) {
                fits = false;
            }
            const place: number = near ? low[axis] + gap : high[axis] - gap - extent;
            // §3.2: a block-start or block-end float is "floated to the block-start and line-start outer edges", and an inline one starts
            // where the block floats before it end.
            float.fragment.inline = (block ? low[0] : place) + float.start;
            float.fragment.block = (block ? place : low[1]) + float.before;
            if (near) {
                low[axis] = place + extent;
            } else {
                high[axis] = place;
            }
            closed |= float.closes;
        }
        return { inlineStart: low[0], inlineSize: Math.max(0, high[0] - low[0]), blockStart: low[1], blockSize: Math.max(0, high[1] - low[1]), fits };
    }

    private logicalSide(frame: number, physical: number): number {
        for (let side: number = 0; side < 4; side++) {
            if (this.sizes.physicalSide(frame, side) === physical) {
                return side;
            }
        }
        return BoxSizes.BLOCK_START;
    }
}
