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

import type { ColorSpaceResource } from "./PdfColorSpaces.js";
import type { PdfFile } from "./PdfFile.js";
import { PdfSyntax } from "./PdfSyntax.js";

export interface ColorStop {
    offset: number;
    components: ReadonlyArray<number>;
    exponent?: number;
}

export interface ShadingResource {
    key: string;
    object: number;
}

export interface PatternResource {
    key: string;
    object: number;
}

export interface CoonsPatch {
    points: ReadonlyArray<readonly [number, number]>;
    colors: ReadonlyArray<ReadonlyArray<number>>;
}

export interface ShadingRepeat {
    from: number;
    to: number;
    reflect: boolean;
}

const SMALLEST: number = 1e-9;
const PARALLEL: number = 1e-9;
const DIGITS: number = 12;

export class PdfShadings {

    private readonly file: PdfFile;
    private readonly syntax: PdfSyntax = new PdfSyntax();

    constructor(file: PdfFile) {
        this.file = file;
    }

    axial(space: ColorSpaceResource, coordinates: readonly [number, number, number, number], stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        // ISO 32000-2 §8.7.4.5.3: a type 2 shading along [x0 y0 x1 y1], with t from 0 to 1 at the two ends, or over the
        // domain of the repetitions.
        return this.shading(2, space, coordinates, stops, extend, repeat);
    }

    radial(space: ColorSpaceResource, coordinates: readonly [number, number, number, number, number, number], stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        // §8.7.4.5.4: a type 3 shading between the circles [x0 y0 r0 x1 y1 r1].
        return this.shading(3, space, coordinates, stops, extend, repeat);
    }

    calculated(space: ColorSpaceResource, domain: readonly [number, number, number, number], program: string): ShadingResource {
        // §8.7.4.5.2: a type 1 shading gives each point (x, y) of its Domain [xmin xmax ymin ymax] the color of a function,
        // here a type 4 function (§7.10.5), whose PostScript calculator program takes x and y and leaves the components.
        const bounds: string = "[" + this.syntax.numbers(domain) + "]";
        const object: number = this.file.add("<< /ShadingType 1 /ColorSpace " + space.value + " /Domain " + bounds + " /Function "
            + this.syntax.reference(this.program(space, bounds, program)) + " >>");
        return { key: "Sh" + object, object };
    }

    meshed(space: ColorSpaceResource, patches: ReadonlyArray<CoonsPatch>): ShadingResource {
        // §8.7.4.5.7: a type 6 shading of Coons patches, each its flag, its 12 boundary points from p00 up the u = 0 edge and
        // round, and the colors of its corners p00, p03, p33 and p30, from 0 to 1; Quartz draws no patches with a function.
        let low: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
        let high: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
        for (const patch of patches) {
            for (const [x, y] of patch.points) {
                low = [Math.min(low[0], x), Math.min(low[1], y)];
                high = [Math.max(high[0], x), Math.max(high[1], y)];
            }
        }
        const span: (value: number, from: number, to: number, levels: number) => number = (value: number, from: number, to: number, levels: number): number =>
            to > from ? Math.round(Math.min(1, Math.max(0, (value - from) / (to - from))) * levels) : 0;
        const components: number = space.components;
        const data: Buffer = Buffer.alloc(patches.length * (1 + 12 * 8 + 4 * components * 2));
        let at: number = 0;
        for (const patch of patches) {
            data[at++] = 0;
            for (const [x, y] of patch.points) {
                data.writeUInt32BE(span(x, low[0], high[0], 0xFFFFFFFF), at);
                data.writeUInt32BE(span(y, low[1], high[1], 0xFFFFFFFF), at + 4);
                at += 8;
            }
            for (const color of patch.colors) {
                for (let channel: number = 0; channel < components; channel++) {
                    data.writeUInt16BE(span(color[channel] ?? 0, 0, 1, 0xFFFF), at);
                    at += 2;
                }
            }
        }
        const decode: Array<number> = [low[0], high[0], low[1], high[1]];
        for (let channel: number = 0; channel < components; channel++) {
            decode.push(0, 1);
        }
        const object: number = this.file.addStream("/ShadingType 6 /ColorSpace " + space.value + " /BitsPerCoordinate 32 /BitsPerComponent 16 /BitsPerFlag 8 /Decode ["
            + this.syntax.numbers(decode) + "]", data, true);
        return { key: "Sh" + object, object };
    }

    private program(space: ColorSpaceResource, bounds: string, program: string): number {
        const range: Array<number> = [];
        for (let component: number = 0; component < space.components; component++) {
            range.push(0, 1);
        }
        return this.file.addStream("/FunctionType 4 /Domain " + bounds + " /Range [" + this.syntax.numbers(range) + "]", Buffer.from("{" + program + "}", "latin1"), true);
    }

    operand(value: number): string {
        // §7.10.5: the operands of a calculator function are PDF numbers, which have no exponent.
        if (Math.abs(value) < SMALLEST) {
            return "0";
        }
        const text: string = value.toFixed(DIGITS).replace(/0+$/, "").replace(/\.$/, "");
        return text === "-0" ? "0" : text;
    }

    along(x0: number, y0: number, dx: number, dy: number): string {
        const length: number = dx * dx + dy * dy;
        return this.operand(y0) + " sub " + this.operand(dy / length) + " mul exch " + this.operand(x0) + " sub " + this.operand(dx / length) + " mul add";
    }

    betweenCircles(circles: readonly [number, number, number, number, number, number]): string | undefined {
        // The largest root of (p - c(ω))² = r(ω)² with r(ω) ≥ 0 is the circle drawn last, the one that is seen.
        const [x0, y0, r0, x1, y1, r1] = circles;
        const cx: number = x1 - x0;
        const cy: number = y1 - y0;
        const dr: number = r1 - r0;
        if (cx === 0 && cy === 0 && dr === 0) {
            return undefined;
        }
        const a: number = cx * cx + cy * cy - dr * dr;
        const radius: string = this.operand(dr) + " mul " + this.operand(r0) + " add 0 ge";
        const start: string = this.operand(y0) + " sub exch " + this.operand(x0) + " sub 2 copy " + this.operand(cx) + " mul exch " + this.operand(cy) + " mul add "
            + this.operand(r0 * dr) + " add 3 1 roll dup mul exch dup mul add " + this.operand(r0 * r0) + " sub ";
        if (Math.abs(a) < PARALLEL * (cx * cx + cy * cy + dr * dr)) {
            // Quartz misreads eq, so zero is the value whose absolute value is not above it.
            return start + "exch dup abs 0 le { pop pop 0 false } { 2 mul div dup " + radius + " } ifelse";
        }
        return start + this.operand(a) + " mul 1 index dup mul exch sub dup 0 lt { pop pop 0 false } { sqrt 2 copy add " + this.operand(1 / a) + " mul 3 1 roll sub "
            + this.operand(1 / a) + " mul 2 copy gt { exch } if dup " + radius + " { exch pop true } { pop dup " + radius + " } ifelse } ifelse";
    }

    colorLine(stops: ReadonlyArray<ColorStop>, alphas?: ReadonlyArray<number>, repeat?: ShadingRepeat, plain?: number): string | undefined {
        const constant: (stop: ColorStop) => string = (stop: ColorStop): string => stop.components.map((channel: number) => this.operand(channel)).join(" ");
        const first: ColorStop = stops[0];
        const last: ColorStop = stops[stops.length - 1];
        if (stops.length === 1) {
            return "pop " + constant(first);
        }
        let mapped: string = "";
        if (repeat !== undefined) {
            if (repeat.to <= repeat.from) {
                return undefined;
            }
            const length: string = this.operand(repeat.to - repeat.from);
            const start: string = this.operand(repeat.from);
            mapped = repeat.reflect ? start + " sub " + length + " div dup floor dup 2 div dup floor sub 0 gt { sub 1 exch sub } { sub } ifelse " + length + " mul " + start
                + " add " : start + " sub " + length + " div dup floor sub " + length + " mul " + start + " add ";
        }
        if (last.offset <= first.offset) {
            return mapped + this.operand(first.offset) + " lt { " + constant(first) + " } { " + constant(last) + " } ifelse";
        }
        return mapped + "dup " + this.operand(first.offset) + " lt { pop " + constant(first) + " } { dup " + this.operand(last.offset) + " ge { pop " + constant(last)
            + " } { " + this.segments(stops, alphas, plain) + " } ifelse } ifelse";
    }

    pattern(shading: ShadingResource, matrix: ReadonlyArray<number>): PatternResource {
        // §8.7.3.3: a shading pattern, whose matrix maps the shading space to the default space of the content that uses it.
        const object: number = this.file.add("<< /Type /Pattern /PatternType 2 /Shading " + this.syntax.reference(shading.object) + " /Matrix [" + this.syntax.numbers(matrix) + "] >>");
        return { key: "P" + object, object };
    }

    private segments(stops: ReadonlyArray<ColorStop>, alphas?: ReadonlyArray<number>, plain?: number): string {
        // Of two stops at one offset the later one takes over there, so the earlier one starts no segment.
        const pieces: Array<number> = [];
        for (let index: number = 1; index < stops.length; index++) {
            if (stops[index].offset > stops[index - 1].offset) {
                pieces.push(index);
            }
        }
        let code: string = this.segment(stops, pieces[pieces.length - 1], alphas, plain);
        for (let index: number = pieces.length - 2; index >= 0; index--) {
            code = "dup " + this.operand(stops[pieces[index]].offset) + " lt { " + this.segment(stops, pieces[index], alphas, plain) + " } { " + code + " } ifelse";
        }
        return code;
    }

    private segment(stops: ReadonlyArray<ColorStop>, end: number, alphas?: ReadonlyArray<number>, plain?: number): string {
        // A plain channel, such as a hue, is interpolated without the alphas.
        const from: ColorStop = stops[end - 1];
        const to: ColorStop = stops[end];
        const count: number = from.components.length;
        let fraction: string = this.operand(from.offset) + " sub " + this.operand(1 / (to.offset - from.offset)) + " mul";
        const exponent: number | undefined = from.exponent;
        if (exponent !== undefined && exponent !== 1) {
            fraction += exponent === Number.POSITIVE_INFINITY ? " pop 0" : (exponent === 0 ? " pop 1" : " " + this.operand(exponent) + " exp");
        }
        const start: number = alphas === undefined ? 1 : alphas[end - 1];
        const stop: number = alphas === undefined ? 1 : alphas[end];
        if (start === stop) {
            let code: string = fraction;
            for (let channel: number = 0; channel < count; channel++) {
                code += " dup " + this.operand(to.components[channel] - from.components[channel]) + " mul " + this.operand(from.components[channel]) + " add exch";
            }
            return code + " pop";
        }
        let code: string = fraction + " dup " + this.operand(stop - start) + " mul " + this.operand(start) + " add dup " + this.operand(SMALLEST) + " lt { pop "
            + this.operand(SMALLEST) + " } if";
        for (let channel: number = 0; channel < count; channel++) {
            if (channel === plain) {
                code += " " + (channel + 1) + " index " + this.operand(to.components[channel] - from.components[channel]) + " mul " + this.operand(from.components[channel])
                    + " add";
                continue;
            }
            const premultiplied: number = from.components[channel] * start;
            code += " " + (channel + 1) + " index " + this.operand(to.components[channel] * stop - premultiplied) + " mul " + this.operand(premultiplied) + " add "
                + (channel + 1) + " index div";
        }
        return code + " " + (count + 2) + " " + count + " roll pop pop";
    }

    private shading(type: number, space: ColorSpaceResource, coordinates: ReadonlyArray<number>, stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        const domain: string = repeat === undefined ? "" : " /Domain [" + this.syntax.numbers([repeat.from, repeat.to]) + "]";
        const object: number = this.file.add("<< /ShadingType " + type + " /ColorSpace " + space.value + " /Coords [" + this.syntax.numbers(coordinates)
            + "]" + domain + " /Function " + (repeat === undefined ? this.function(stops) : this.repeated(this.function(stops), repeat)) + " /Extend ["
            + extend[0] + " " + extend[1] + "] >>");
        return { key: "Sh" + object, object };
    }

    private repeated(period: string, repeat: ShadingRepeat): string {
        // §7.10.4: one copy of the function for each unit of the domain, every other one encoded backwards when it reflects.
        const pieces: Array<string> = [];
        const bounds: Array<number> = [];
        const encode: Array<number> = [];
        for (let unit: number = repeat.from; unit < repeat.to; unit++) {
            if (unit > repeat.from) {
                bounds.push(unit);
            }
            pieces.push(period);
            const backwards: boolean = repeat.reflect && Math.abs(unit % 2) === 1;
            encode.push(backwards ? 1 : 0, backwards ? 0 : 1);
        }
        return "<< /FunctionType 3 /Domain [" + this.syntax.numbers([repeat.from, repeat.to]) + "] /Functions [" + pieces.join(" ") + "] /Bounds ["
            + this.syntax.numbers(bounds) + "] /Encode [" + this.syntax.numbers(encode) + "] >>";
    }

    private function(stops: ReadonlyArray<ColorStop>): string {
        // §7.10.3: a type 2 function with N 1 is linear between two colours; §7.10.4: a type 3 function joins one for each
        // pair of stops, and its Bounds increase strictly, so a stop at the offset of the one before has no piece of its own.
        const points: Array<ColorStop> = [];
        for (const stop of stops) {
            const offset: number = Math.min(1, Math.max(0, stop.offset));
            const last: ColorStop | undefined = points[points.length - 1];
            if (last !== undefined && offset < last.offset) {
                points.push({ offset: last.offset, components: stop.components });
            } else {
                points.push({ offset, components: stop.components });
            }
        }
        if (points.length === 0) {
            return "<< /FunctionType 2 /Domain [0 1] /N 1 >>";
        }
        if (points[0].offset > 0) {
            points.unshift({ offset: 0, components: points[0].components });
        }
        if (points[points.length - 1].offset < 1) {
            points.push({ offset: 1, components: points[points.length - 1].components });
        }
        const pieces: Array<string> = [];
        const bounds: Array<number> = [];
        for (let index: number = 1; index < points.length; index++) {
            const from: ColorStop = points[index - 1];
            const to: ColorStop = points[index];
            if (to.offset <= from.offset && points.length > 2) {
                continue;
            }
            if (pieces.length > 0) {
                bounds.push(from.offset);
            }
            pieces.push("<< /FunctionType 2 /Domain [0 1] /C0 [" + this.syntax.numbers(from.components) + "] /C1 [" + this.syntax.numbers(to.components) + "] /N 1 >>");
        }
        if (pieces.length === 1) {
            return pieces[0];
        }
        const encode: Array<number> = [];
        for (let index: number = 0; index < pieces.length; index++) {
            encode.push(0, 1);
        }
        return "<< /FunctionType 3 /Domain [0 1] /Functions [" + pieces.join(" ") + "] /Bounds [" + this.syntax.numbers(bounds) + "] /Encode ["
            + this.syntax.numbers(encode) + "] >>";
    }
}
