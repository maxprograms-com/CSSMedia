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
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { RelativeUnits } from "../pdf/LengthResolver.js";
import { LengthResolver } from "../pdf/LengthResolver.js";
import type { BoxFragment, Sides } from "./Fragment.js";

export type Transform = readonly [number, number, number, number, number, number];

type SizeField = "inlineSize" | "blockSize" | "minInlineSize" | "maxInlineSize" | "minBlockSize" | "maxBlockSize";

type AnchorSizes = (anchor: CalcAnchor, block: boolean) => number | undefined;

export type NaturalSizes = readonly [number | undefined, number | undefined, number | undefined];

export interface UsedSizes {
    margin?: [number, number, number, number];
    border?: [number, number, number, number];
    padding?: [number, number, number, number];
    inlineSize?: number;
    blockSize?: number;
    minInlineSize?: number;
    maxInlineSize?: number;
    minBlockSize?: number;
    maxBlockSize?: number;
    keywords?: Array<string>;
    fits?: Array<number>;
    ratio?: number;
    ratioAuto?: boolean;
    ratioBoxed?: boolean;
    natural?: NaturalSizes;
    calculations?: Array<CalcNode | undefined>;
    extras?: readonly [number, number];
}

const NO_UNITS: RelativeUnits = { size: (): number | undefined => undefined };
const SIDE_NAMES: ReadonlyArray<string> = ["block-start", "inline-end", "block-end", "inline-start"];
const BORDER_KEYWORDS: ReadonlyMap<string, number> = new Map<string, number>([["thin", 1], ["medium", 3], ["thick", 5]]);
const SIZE_PROPERTIES: ReadonlyArray<string> = ["inline-size", "block-size", "min-inline-size", "max-inline-size", "min-block-size", "max-block-size"];
const SIZE_KEYWORDS: ReadonlySet<string> = new Set<string>(["min-content", "max-content", "fit-content", "stretch", "contain"]);
const PHYSICAL_SIDES: ReadonlyArray<string> = ["top", "right", "bottom", "left"];
const TOP: number = 0;
const RIGHT: number = 1;
const BOTTOM: number = 2;
const LEFT: number = 3;

export class BoxSizes {

    static readonly BLOCK_START: number = 0;
    static readonly INLINE_END: number = 1;
    static readonly BLOCK_END: number = 2;
    static readonly INLINE_START: number = 3;
    static readonly VERTICAL: number = 1;
    static readonly BLOCK_REVERSED: number = 2;
    static readonly INLINE_REVERSED: number = 4;
    static readonly GEOMETRY: number = 7;
    static readonly RIGHT_TO_LEFT: number = 8;
    static readonly PREFERRED_INLINE: number = 0;
    static readonly PREFERRED_BLOCK: number = 1;
    static readonly MINIMUM_INLINE: number = 2;
    static readonly MAXIMUM_INLINE: number = 3;
    static readonly MINIMUM_BLOCK: number = 4;
    static readonly MAXIMUM_BLOCK: number = 5;
    static readonly FIT_FUNCTION: string = "fit-content()";
    static readonly FIELDS: ReadonlyArray<SizeField> = ["inlineSize", "blockSize", "minInlineSize", "maxInlineSize", "minBlockSize", "maxBlockSize"];
    static readonly IDENTITY: Transform = [1, 0, 0, 1, 0, 0];

    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly inlineAnchors: (anchor: CalcAnchor) => number | undefined;
    private readonly blockAnchors: (anchor: CalcAnchor) => number | undefined;

    constructor(anchors: AnchorSizes) {
        this.inlineAnchors = (anchor: CalcAnchor): number | undefined => anchors(anchor, false);
        this.blockAnchors = (anchor: CalcAnchor): number | undefined => anchors(anchor, true);
    }

    frame(style: ComputedStyle): number {
        // CSS Writing Modes 4 §6.4: block-start is the top, the right in vertical-rl and sideways-rl and the left otherwise;
        // inline-start follows the used direction, which "a text-orientation value of upright forces" to ltr in vertical modes.
        const mode: CssValue | undefined = style.values["writing-mode"];
        const name: string = mode !== undefined && mode.kind === "ident" ? mode.lower : "horizontal-tb";
        const orientation: CssValue | undefined = style.values["text-orientation"];
        const upright: boolean = (name === "vertical-rl" || name === "vertical-lr") && orientation !== undefined && orientation.kind === "ident" && orientation.lower === "upright";
        const direction: CssValue | undefined = style.values["direction"];
        const rightToLeft: boolean = !upright && direction !== undefined && direction.kind === "ident" && direction.lower === "rtl";
        let frame: number = rightToLeft ? BoxSizes.RIGHT_TO_LEFT : 0;
        if (name !== "horizontal-tb") {
            frame |= BoxSizes.VERTICAL;
        }
        if (name === "vertical-rl" || name === "sideways-rl") {
            frame |= BoxSizes.BLOCK_REVERSED;
        }
        // In sideways-lr the inline-start side of ltr text is the bottom.
        if (rightToLeft !== (name === "sideways-lr")) {
            frame |= BoxSizes.INLINE_REVERSED;
        }
        return frame;
    }

    physicalSide(frame: number, side: number): number {
        // The top, right, bottom or left side that a flow-relative side of the frame is.
        const end: boolean = side === BoxSizes.BLOCK_END || side === BoxSizes.INLINE_END;
        const vertical: boolean = (frame & BoxSizes.VERTICAL) !== 0;
        if (side === BoxSizes.BLOCK_START || side === BoxSizes.BLOCK_END) {
            const far: boolean = end !== ((frame & BoxSizes.BLOCK_REVERSED) !== 0);
            return vertical ? (far ? RIGHT : LEFT) : (far ? BOTTOM : TOP);
        }
        const far: boolean = end !== ((frame & BoxSizes.INLINE_REVERSED) !== 0);
        return vertical ? (far ? BOTTOM : TOP) : (far ? RIGHT : LEFT);
    }

    side(from: number, to: number, side: number): number {
        // The side in frame to that is the given side in frame from.
        if (((from ^ to) & BoxSizes.GEOMETRY) === 0) {
            return side;
        }
        const physical: number = this.physicalSide(from, side);
        for (let candidate: number = 0; candidate < 4; candidate++) {
            if (this.physicalSide(to, candidate) === physical) {
                return candidate;
            }
        }
        return side;
    }

    isOrthogonal(first: number, second: number): boolean {
        return ((first ^ second) & BoxSizes.VERTICAL) !== 0;
    }

    inside(piece: BoxFragment, frame: number): Transform {
        // The map from a point of the piece's content box, in its own writing mode, to its container, in the given one.
        const shift: Transform = [1, 0, 0, 1, this.sideOf(BoxSizes.INLINE_START, piece.border) + this.sideOf(BoxSizes.INLINE_START, piece.padding),
            this.sideOf(BoxSizes.BLOCK_START, piece.border) + this.sideOf(BoxSizes.BLOCK_START, piece.padding)];
        const own: number = this.frame(piece.box.style);
        const place: Transform = [1, 0, 0, 1, piece.inline, piece.block];
        if (((own ^ frame) & BoxSizes.GEOMETRY) === 0) {
            return this.compose(place, shift);
        }
        const width: number = (frame & BoxSizes.VERTICAL) === 0 ? piece.inlineSize : piece.blockSize;
        const height: number = (frame & BoxSizes.VERTICAL) === 0 ? piece.blockSize : piece.inlineSize;
        return this.compose(place, this.compose(this.between(own, frame, width, height), shift));
    }

    between(from: number, to: number, width: number, height: number): Transform {
        // The map of points from one writing mode to another inside a rectangle of the given physical width and height.
        const origin: readonly [number, number] = this.reframed(from, to, 0, 0, width, height);
        const across: readonly [number, number] = this.reframed(from, to, 1, 0, width, height);
        const down: readonly [number, number] = this.reframed(from, to, 0, 1, width, height);
        return [across[0] - origin[0], down[0] - origin[0], across[1] - origin[1], down[1] - origin[1], origin[0], origin[1]];
    }

    reframed(from: number, to: number, inline: number, block: number, width: number, height: number): readonly [number, number] {
        // CSS Writing Modes 4 §6.4: a flow-relative point of one frame, through its physical place, in another frame.
        const vertical: boolean = (from & BoxSizes.VERTICAL) !== 0;
        const along: number = (from & BoxSizes.INLINE_REVERSED) !== 0 ? (vertical ? height : width) - inline : inline;
        const across: number = (from & BoxSizes.BLOCK_REVERSED) !== 0 ? (vertical ? width : height) - block : block;
        const x: number = vertical ? across : along;
        const y: number = vertical ? along : across;
        const turned: boolean = (to & BoxSizes.VERTICAL) !== 0;
        const inlineAxis: number = turned ? y : x;
        const blockAxis: number = turned ? x : y;
        return [(to & BoxSizes.INLINE_REVERSED) !== 0 ? (turned ? height : width) - inlineAxis : inlineAxis,
            (to & BoxSizes.BLOCK_REVERSED) !== 0 ? (turned ? width : height) - blockAxis : blockAxis];
    }

    compose(outer: Transform, inner: Transform): Transform {
        return [
            outer[0] * inner[0] + outer[1] * inner[2], outer[0] * inner[1] + outer[1] * inner[3],
            outer[2] * inner[0] + outer[3] * inner[2], outer[2] * inner[1] + outer[3] * inner[3],
            outer[0] * inner[4] + outer[1] * inner[5] + outer[4], outer[2] * inner[4] + outer[3] * inner[5] + outer[5]
        ];
    }

    apply(transform: Transform, inline: number, block: number): readonly [number, number] {
        return [transform[0] * inline + transform[1] * block + transform[4], transform[2] * inline + transform[3] * block + transform[5]];
    }

    inverse(transform: Transform): Transform {
        // The axes only turn by quarter turns and reflect, so the inverse of the matrix is its transpose.
        const inline: number = -(transform[0] * transform[4] + transform[2] * transform[5]);
        const block: number = -(transform[1] * transform[4] + transform[3] * transform[5]);
        return [transform[0], transform[2], transform[1], transform[3], inline, block];
    }

    mapped(transform: Transform, inline: number, block: number, inlineSize: number, blockSize: number): readonly [number, number, number, number] {
        const first: readonly [number, number] = this.apply(transform, inline, block);
        const second: readonly [number, number] = this.apply(transform, inline + inlineSize, block + blockSize);
        return [Math.min(first[0], second[0]), Math.min(first[1], second[1]), Math.abs(second[0] - first[0]), Math.abs(second[1] - first[1])];
    }

    private sideOf(side: number, sides?: Sides): number {
        return sides === undefined ? 0 : sides[side];
    }

    of(style: ComputedStyle, inlineBasis?: number, blockBasis?: number, edgeBasis?: number): UsedSizes {
        // CSS Box 4 §3.1 and §4.1: percentages of margin and padding, on every side, refer to the inline size of the
        // containing block, which CSS Writing Modes 4 §7.2 takes in its own writing mode; an auto margin has no length yet.
        const values: Readonly<Record<string, CssValue>> = style.values;
        const basis: number = Math.max(0, edgeBasis ?? inlineBasis ?? 0);
        const sizeBasis: number | undefined = inlineBasis === undefined ? undefined : basis;
        const sizes: UsedSizes = {};
        for (let side: number = 0; side < SIDE_NAMES.length; side++) {
            const name: string = SIDE_NAMES[side];
            const marginValue: CssValue | undefined = this.unanchored(values["margin-" + name], side % 2 === 0);
            let margin: number = 0;
            if (marginValue !== undefined) {
                margin = marginValue.kind === "ident" ? Number.NaN : this.pixels(marginValue, basis);
            }
            if (margin !== 0) {
                sizes.margin = sizes.margin ?? [0, 0, 0, 0];
                sizes.margin[side] = margin;
            }
            const border: number = this.borderWidth(values["border-" + name + "-style"], values["border-" + name + "-width"]);
            if (border !== 0) {
                sizes.border = sizes.border ?? [0, 0, 0, 0];
                sizes.border[side] = border;
            }
            const paddingValue: CssValue | undefined = values["padding-" + name];
            const padding: number = paddingValue === undefined ? 0 : Math.max(0, this.pixels(paddingValue, basis));
            if (padding !== 0) {
                sizes.padding = sizes.padding ?? [0, 0, 0, 0];
                sizes.padding[side] = padding;
            }
        }
        // CSS Sizing 3 §3.3: with box-sizing: border-box the sizing properties give the border box, and "the content width
        // and height are calculated by subtracting the respective border and padding", floored at zero.
        const sizing: CssValue | undefined = values["box-sizing"];
        const borderBox: boolean = sizing !== undefined && sizing.kind === "ident" && sizing.lower === "border-box";
        const inlineExtra: number = borderBox ? this.edges(sizes, BoxSizes.INLINE_START) + this.edges(sizes, BoxSizes.INLINE_END) : 0;
        const blockExtra: number = borderBox ? this.edges(sizes, BoxSizes.BLOCK_START) + this.edges(sizes, BoxSizes.BLOCK_END) : 0;
        for (let slot: number = 0; slot < SIZE_PROPERTIES.length; slot++) {
            const block: boolean = slot === BoxSizes.PREFERRED_BLOCK || slot >= BoxSizes.MINIMUM_BLOCK;
            const value: CssValue | undefined = this.unanchored(values[SIZE_PROPERTIES[slot]], block);
            if (value === undefined) {
                continue;
            }
            const extra: number = block ? blockExtra : inlineExtra;
            // CSS Sizing 3 §5.2.1: "For the min size properties", "a cyclic percentage is resolved against zero for
            // determining intrinsic size contributions."
            const sizeOf: number | undefined = block ? blockBasis : (sizeBasis ?? (slot === BoxSizes.MINIMUM_INLINE ? 0 : undefined));
            if (value.kind === "ident") {
                if (SIZE_KEYWORDS.has(value.lower)) {
                    sizes.keywords = sizes.keywords ?? ["", "", "", "", "", ""];
                    sizes.keywords[slot] = value.lower;
                }
                continue;
            }
            if (value.kind === "function" && value.name === "calc-size") {
                this.calculated(sizes, slot, value, extra, sizeOf);
                if (sizes.calculations !== undefined) {
                    sizes.extras = [inlineExtra, blockExtra];
                }
                continue;
            }
            if (value.kind === "function") {
                // CSS Sizing 4 §3.2: the argument of fit-content() "is resolved exactly as for <length-percentage> values
                // standing alone".
                const argument: CssValue | undefined = value.args[0];
                const limit: number | undefined = value.name === "fit-content" && argument !== undefined ? this.size(extra, argument, sizeOf) : undefined;
                if (limit !== undefined) {
                    sizes.keywords = sizes.keywords ?? ["", "", "", "", "", ""];
                    sizes.keywords[slot] = BoxSizes.FIT_FUNCTION;
                    sizes.fits = sizes.fits ?? [0, 0, 0, 0, 0, 0];
                    sizes.fits[slot] = limit;
                }
                continue;
            }
            const size: number | undefined = this.size(extra, value, sizeOf);
            if (size !== undefined) {
                sizes[BoxSizes.FIELDS[slot]] = size;
            }
        }
        const ratio: CssValue | undefined = values["aspect-ratio"];
        if (ratio !== undefined && ratio.kind !== "ident") {
            this.preferredRatio(sizes, ratio, borderBox, values["writing-mode"]);
        }
        return sizes;
    }

    private calculated(sizes: UsedSizes, slot: number, value: CssValue, extra: number, basis?: number): void {
        // CSS Values 5 §10.1: with a calc-size() as its basis, the basis of the outer function "is replaced with that of
        // the inner function", whose calculation "is substituted into the outer function's calc-size calculation."
        let calculation: CalcNode | undefined;
        let current: CssValue = value;
        while (current.kind === "function" && current.name === "calc-size" && current.args.length === 2) {
            const argument: CssValue = current.args[1];
            const node: CalcNode | undefined = argument.kind === "calc" ? argument.root
                : (argument.kind === "length" ? { kind: "leaf", value: argument.px, unit: "px" } : (argument.kind === "percentage" ? { kind: "leaf", value: argument.value, unit: "%" } : undefined));
            if (node === undefined) {
                return;
            }
            calculation = calculation === undefined ? node : this.lengths.substituted(calculation, node);
            current = current.args[0];
        }
        if (calculation === undefined) {
            return;
        }
        const field: SizeField = BoxSizes.FIELDS[slot];
        const definite: number | undefined = this.size(0, current, basis);
        if (definite !== undefined || (current.kind === "ident" && current.lower === "any")) {
            // §10.2: "If the calc-size basis is any, the calc-size() is a definite length, equal to its calc-size
            // calculation"; a basis that is a definite size is the size keyword.
            sizes[field] = Math.max(0, (this.lengths.sized(this.lengths.percentFree(calculation, basis ?? 0), definite ?? 0) ?? 0) - extra);
            return;
        }
        if (current.kind === "ident" && SIZE_KEYWORDS.has(current.lower)) {
            sizes.keywords = sizes.keywords ?? ["", "", "", "", "", ""];
            sizes.keywords[slot] = current.lower;
        } else if (current.kind !== "ident") {
            // §10.2: a percentage that is not definite becomes size references, and the basis "then becomes 100%, behaving
            // as whatever 100% would normally do in that context", which is the automatic size.
            const root: CalcNode | undefined = current.kind === "calc" ? current.root : (current.kind === "percentage" ? { kind: "leaf", value: current.value, unit: "%" } : undefined);
            calculation = root === undefined ? calculation : this.lengths.substituted(calculation, this.lengths.depercentified(root));
        }
        sizes.calculations = sizes.calculations ?? [undefined, undefined, undefined, undefined, undefined, undefined];
        sizes.calculations[slot] = this.lengths.percentFree(calculation, basis ?? 0);
    }

    adjusted(sizes: UsedSizes, slot: number, size: number): number {
        // CSS Values 5 §10.2: "the size represented by its calc-size basis is modified to be the value of its calc-size
        // calculation"; the size is the one that the property gives, on the box that box-sizing names.
        const calculation: CalcNode | undefined = sizes.calculations === undefined ? undefined : sizes.calculations[slot];
        if (calculation === undefined || sizes.extras === undefined) {
            return size;
        }
        const extra: number = sizes.extras[slot === BoxSizes.PREFERRED_BLOCK || slot >= BoxSizes.MINIMUM_BLOCK ? 1 : 0];
        return Math.max(0, (this.lengths.sized(calculation, size + extra) ?? size + extra) - extra);
    }

    private preferredRatio(sizes: UsedSizes, value: CssValue, borderBox: boolean, mode?: CssValue): void {
        // CSS Sizing 4 §4.1: the ratio is "of width / height"; alone it works "with the dimensions of the box specified by
        // box-sizing", and with auto "with the content box dimensions always".
        let auto: boolean = false;
        let width: number | undefined;
        let height: number | undefined;
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind === "ident") {
                auto = auto || item.lower === "auto";
            } else if (item.kind === "number" && width === undefined) {
                width = item.value;
            } else if (item.kind === "number") {
                height = item.value;
            }
        }
        const across: number = width ?? 0;
        const down: number = height ?? 1;
        // "If the <ratio> is degenerate, the property instead behaves as auto."
        if (!(across > 0) || !(down > 0) || !Number.isFinite(across) || !Number.isFinite(down)) {
            return;
        }
        const horizontal: boolean = mode === undefined || (mode.kind === "ident" && mode.lower === "horizontal-tb");
        sizes.ratio = horizontal ? across / down : down / across;
        if (auto) {
            sizes.ratioAuto = true;
        } else if (borderBox) {
            sizes.ratioBoxed = true;
        }
    }

    transferred(sizes: UsedSizes, size: number, toInline: boolean): number {
        // The content size in one axis that the preferred aspect ratio gives for a content size in the other one.
        const ratio: number = sizes.ratio as number;
        const inlineEdges: number = sizes.ratioBoxed === true ? this.edges(sizes, BoxSizes.INLINE_START) + this.edges(sizes, BoxSizes.INLINE_END) : 0;
        const blockEdges: number = sizes.ratioBoxed === true ? this.edges(sizes, BoxSizes.BLOCK_START) + this.edges(sizes, BoxSizes.BLOCK_END) : 0;
        return Math.max(0, toInline ? (size + blockEdges) * ratio - inlineEdges : (size + inlineEdges) / ratio - blockEdges);
    }

    inset(style: ComputedStyle, side: number, basis: number | undefined, frame: number): number | undefined {
        // CSS Writing Modes 4 §7.4: the positioning offsets take the flow-relative sides of the containing block's writing
        // mode, given as a frame; the left, top, right and bottom properties themselves are physical.
        const name: string = PHYSICAL_SIDES[this.physicalSide(frame, side)];
        const value: CssValue | undefined = this.unanchored(style.values[name], (side % 2 === 0) !== this.isOrthogonal(this.frame(style), frame));
        if (value === undefined || value.kind === "ident" || value.kind === "function" || (basis === undefined && value.kind !== "length")) {
            return undefined;
        }
        return this.pixels(value, basis ?? 0);
    }

    private unanchored(value: CssValue | undefined, block: boolean): CssValue | undefined {
        // CSS Anchor Positioning 1 §5.1: the anchor functions of the value become lengths, the box's or those of the ancestor
        // it inherited the value from; undefined is a declaration invalid at computed-value time, which acts as unset.
        if (value === undefined) {
            return undefined;
        }
        if (value.kind === "calc") {
            const root: CalcNode | undefined = this.lengths.anchored(value.root, block ? this.blockAnchors : this.inlineAnchors);
            if (root === undefined) {
                return undefined;
            }
            return root === value.root ? value : this.lengths.compute({ kind: "calc", root }, NO_UNITS);
        }
        if (value.kind !== "function") {
            return value;
        }
        let args: Array<CssValue> | undefined;
        for (let index: number = 0; index < value.args.length; index++) {
            const argument: CssValue = value.args[index];
            const replaced: CssValue | undefined = this.unanchored(argument, block);
            if (replaced === undefined) {
                return undefined;
            }
            if (replaced !== argument) {
                args = args ?? [...value.args];
                args[index] = replaced;
            }
        }
        return args === undefined ? value : { kind: "function", name: value.name, args };
    }

    relativeShift(style: ComputedStyle, inlineBasis: number, blockBasis: number | undefined, frame: number): readonly [number, number] | undefined {
        // CSS Position 3 §3.3: a relatively positioned box is shifted by its insets, and when both insets of an axis are
        // given the end one is ignored; the sides are those of the containing block's frame. A page does not scroll.
        const position: CssValue | undefined = style.values["position"];
        if (position === undefined || position.kind !== "ident" || position.lower !== "relative") {
            return undefined;
        }
        const inlineEnd: number | undefined = this.inset(style, BoxSizes.INLINE_END, inlineBasis, frame);
        const blockEnd: number | undefined = this.inset(style, BoxSizes.BLOCK_END, blockBasis, frame);
        const inline: number = this.inset(style, BoxSizes.INLINE_START, inlineBasis, frame) ?? (inlineEnd === undefined ? 0 : -inlineEnd);
        const block: number = this.inset(style, BoxSizes.BLOCK_START, blockBasis, frame) ?? (blockEnd === undefined ? 0 : -blockEnd);
        return inline === 0 && block === 0 ? undefined : [inline, block];
    }

    border(style: ComputedStyle, side: number): number {
        return this.borderWidth(style.values["border-" + SIDE_NAMES[side] + "-style"], style.values["border-" + SIDE_NAMES[side] + "-width"]);
    }

    borderStyle(style: ComputedStyle, side: number): string {
        const value: CssValue | undefined = style.values["border-" + SIDE_NAMES[side] + "-style"];
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }

    edges(sizes: UsedSizes, side: number): number {
        return (sizes.border === undefined ? 0 : sizes.border[side]) + (sizes.padding === undefined ? 0 : sizes.padding[side]);
    }

    margin(sizes: UsedSizes, side: number): number | undefined {
        // An auto margin is kept as NaN, and has no length here.
        if (sizes.margin === undefined) {
            return 0;
        }
        const margin: number = sizes.margin[side];
        return Number.isNaN(margin) ? undefined : margin;
    }

    private size(extra: number, value?: CssValue, basis?: number): number | undefined {
        // CSS Sizing 3 §5.2: a percentage against a containing block size that is not definite behaves as auto; the
        // keywords (auto, none, min-content and the others) are not lengths.
        if (value === undefined || value.kind === "ident" || value.kind === "function") {
            return undefined;
        }
        if (basis === undefined && value.kind !== "length") {
            return undefined;
        }
        return Math.max(0, this.pixels(value, basis ?? 0) - extra);
    }

    private borderWidth(style?: CssValue, width?: CssValue): number {
        // CSS Backgrounds 3 §3.3: the used width is zero when the style is none or hidden; §3.2: medium is the initial width.
        if (style === undefined || (style.kind === "ident" && (style.lower === "none" || style.lower === "hidden"))) {
            return 0;
        }
        if (width === undefined) {
            return BORDER_KEYWORDS.get("medium") as number;
        }
        return this.lineWidth(width);
    }

    private lineWidth(width: CssValue): number {
        return width.kind === "ident" ? BORDER_KEYWORDS.get(width.lower) ?? 0 : Math.max(0, this.pixels(width, 0));
    }

    pixels(value: CssValue, basis: number): number {
        return this.lengths.pixelsOf(value, NO_UNITS, basis) ?? 0;
    }
}
