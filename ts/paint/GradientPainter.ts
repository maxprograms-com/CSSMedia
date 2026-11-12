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

import { ColorSpaces } from "../css/values/ColorSpaces.js";
import { CssUnits } from "../css/values/CssUnits.js";
import type { ColorSpace, ColorValue, CssValue, FunctionValue } from "../css/values/CssValue.js";
import type { Matrix, PathGeometry } from "../geometry/PathGeometry.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { ColorStop, CoonsPatch, PdfShadings, ShadingResource } from "../writer/PdfShadings.js";
import type { ColorOutput } from "./ColorOutput.js";

type Box = readonly [number, number, number, number];

type Colors = (position: number) => ReadonlyArray<number>;

interface StopEntry {
    color?: ColorValue;
    position?: number;
}

interface Line {
    kind: "linear" | "across" | "radial" | "conic";
    length: number;
    solid?: boolean;
    origin: readonly [number, number];
    direction: readonly [number, number];
    scale: number;
    turn: number;
    reach: readonly [number, number];
    radius: number;
}

interface Piece {
    from: number;
    to: number;
    start: ColorStop;
    end: ColorStop;
    alphas: readonly [number, number];
}

interface Method {
    space: ColorSpace;
    hue: string;
    profile?: string;
}

const SIDES: Readonly<Record<string, number>> = { top: 0, right: 90, bottom: 180, left: 270 };
const EXTENTS: ReadonlySet<string> = new Set<string>(["closest-side", "closest-corner", "farthest-side", "farthest-corner"]);
const DEFAULT_METHOD: Method = { space: "oklab", hue: "shorter" };
const TOLERANCE: number = 0.5 / 255;
const FINEST: number = 0.0001;
const PRECISION: number = 0.0001;

export class GradientPainter {

    static readonly NAMES: ReadonlySet<string> = new Set<string>([
        "linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient"
    ]);

    private readonly document: PdfDocument;
    private readonly colors: ColorOutput;
    private readonly geometry: PathGeometry;
    private readonly spaces: ColorSpaces = new ColorSpaces();
    private readonly units: CssUnits = new CssUnits();

    constructor(document: PdfDocument, colors: ColorOutput, geometry: PathGeometry) {
        this.document = document;
        this.colors = colors;
        this.geometry = geometry;
    }

    paint(value: FunctionValue, box: Box, style: ComputedStyle, pdf: PdfPage): void {
        // CSS Images 3 §3: the gradient is drawn into the gradient box, here x, y, width and height on the page; each point
        // takes the color of its place on the gradient line.
        if (box[2] <= 0 || box[3] <= 0) {
            return;
        }
        const repeating: boolean = value.name.startsWith("repeating-");
        const kind: string = value.name.substring(repeating ? 10 : 0, value.name.length - 9);
        const first: ReadonlyArray<CssValue> = this.items(value.args[0]);
        const preamble: ReadonlyArray<CssValue> = first.length > 0 && this.colors.colorValue(first[0], style) === undefined ? first : [];
        const entries: ReadonlyArray<CssValue> = preamble.length > 0 ? value.args.slice(1) : value.args;
        const method: Method = this.method(preamble);
        const shape: ReadonlyArray<CssValue> = this.before(preamble, "in");
        const line: Line = kind === "linear" ? this.linear(shape, box) : (kind === "radial" ? this.radial(shape, box, style) : this.conic(shape, box, style));
        const stops: Array<StopEntry> = [];
        const hints: Map<number, number> = new Map<number, number>();
        for (const entry of entries) {
            const items: ReadonlyArray<CssValue> = this.items(entry);
            const color: ColorValue | undefined = this.colors.colorValue(items[0], style);
            if (color === undefined) {
                hints.set(stops.length, this.offset(items[0], line.length, kind === "conic"));
                continue;
            }
            const positions: ReadonlyArray<CssValue> = items.slice(1);
            if (positions.length === 0) {
                stops.push({ color });
            }
            for (const position of positions) {
                stops.push({ color, position: this.offset(position, line.length, kind === "conic") });
            }
        }
        if (stops.length === 0) {
            return;
        }
        const placed: Array<number> = this.fixup(stops, hints, line.length);
        const colors: ReadonlyArray<ColorValue> = stops.map((stop: StopEntry) => stop.color as ColorValue);
        if (line.solid === true || (repeating && placed[placed.length - 1] - placed[0] <= 0)) {
            // Images 3 §3.2.3 and §3.3: an ending shape of no height shows the last stop, or the average color when it repeats; a
            // repeating gradient whose stops are all at one place shows the average color of its stops spread out evenly.
            this.solid(repeating ? this.average(colors, placed[placed.length - 1] - placed[0] <= 0 ? Array.from(colors.keys()) : placed)
                : colors[colors.length - 1], box, pdf);
            return;
        }
        this.shade(line, colors, placed, hints, method, repeating, box, pdf);
    }

    private shade(gradient: Line, colors: ReadonlyArray<ColorValue>, placed: ReadonlyArray<number>, hints: ReadonlyMap<number, number>, method: Method,
        repeating: boolean, box: Box, pdf: PdfPage): void {
        // Images 4 §3.5.2: between two stops the colors are interpolated in the space of the method with premultiplied alpha, a
        // missing component taking the other color's, the hues fixed up for each pair; a hint bends the weight to P^log_H(.5).
        const plain: number | undefined = method.profile === undefined ? this.spaces.hueIndex(method.space) : undefined;
        const line: Array<ColorStop> = [];
        const alphas: Array<number> = [];
        let output: ColorSpaceResource | undefined;
        const add: (offset: number, components: ReadonlyArray<number>, alpha: number, exponent?: number) => void =
            (offset: number, components: ReadonlyArray<number>, alpha: number, exponent?: number): void => {
                const stop: ColorStop = { offset, components };
                if (exponent !== undefined) {
                    stop.exponent = exponent;
                }
                line.push(stop);
                alphas.push(alpha);
            };
        const components: (color: ColorValue) => ReadonlyArray<number | null> = (color: ColorValue): ReadonlyArray<number | null> => {
            if (method.profile === undefined) {
                return this.spaces.carriedForward(color, method.space).components;
            }
            const converted: readonly [ColorSpaceResource, ReadonlyArray<number>] | undefined = this.colors.profileOutput(method.profile, color);
            output = converted?.[0];
            return converted?.[1] ?? [0, 0, 0];
        };
        if (colors.length === 1) {
            add(placed[0], components(colors[0]).map((component: number | null) => component ?? 0), colors[0].alpha ?? 0);
        }
        for (let index: number = 0; index + 1 < colors.length; index++) {
            const from: ReadonlyArray<number | null> = components(colors[index]);
            const to: ReadonlyArray<number | null> = components(colors[index + 1]);
            const start: Array<number> = from.map((component: number | null, channel: number) => component ?? to[channel] ?? 0);
            const end: Array<number> = to.map((component: number | null, channel: number) => component ?? from[channel] ?? 0);
            if (plain !== undefined) {
                [start[plain], end[plain]] = this.spaces.fixedUpHues(start[plain], end[plain], method.hue);
            }
            const startAlpha: number = colors[index].alpha ?? colors[index + 1].alpha ?? 0;
            const endAlpha: number = colors[index + 1].alpha ?? colors[index].alpha ?? 0;
            const hint: number | undefined = hints.get(index + 1);
            const span: number = placed[index + 1] - placed[index];
            const fraction: number | undefined = hint === undefined || span <= 0 ? undefined : (hint - placed[index]) / span;
            add(placed[index], start, startAlpha, fraction === undefined ? undefined
                : (fraction <= 0 ? 0 : (fraction >= 1 ? Number.POSITIVE_INFINITY : Math.log(0.5) / Math.log(fraction))));
            add(placed[index + 1], end, endAlpha);
        }
        // Viewers draw a shading from a few samples of its function, which blurs stops that meet, so each piece between two
        // stops is a shading of its own clipped to its region; before the first stop and after the last the colors extend.
        const pieces: Array<Piece> = [];
        for (let index: number = 0; index + 1 < line.length; index += 2) {
            if (line[index + 1].offset > line[index].offset) {
                pieces.push({ from: line[index].offset, to: line[index + 1].offset, start: line[index], end: line[index + 1], alphas: [alphas[index], alphas[index + 1]] });
            }
        }
        const [low, high]: readonly [number, number] = gradient.reach;
        const covering: Array<Piece> = [];
        const first: ColorStop = line[0];
        const last: ColorStop = line[line.length - 1];
        if (!repeating) {
            const extended: (from: number, to: number, stop: ColorStop, alpha: number) => Piece = (from: number, to: number, stop: ColorStop, alpha: number): Piece =>
                ({ from, to, start: { offset: from, components: stop.components }, end: { offset: to, components: stop.components }, alphas: [alpha, alpha] });
            if (first.offset > low) {
                covering.push(extended(low, first.offset, first, alphas[0]));
            }
            covering.push(...pieces);
            if (last.offset < high) {
                covering.push(extended(last.offset, high, last, alphas[alphas.length - 1]));
            }
        } else {
            const period: number = last.offset - first.offset;
            for (let shift: number = Math.floor((low - last.offset) / period) * period; first.offset + shift < high; shift += period) {
                for (const piece of pieces) {
                    if (piece.to + shift > low && piece.from + shift < high) {
                        covering.push({ from: piece.from + shift, to: piece.to + shift, start: { ...piece.start, offset: piece.start.offset + shift },
                            end: { ...piece.end, offset: piece.end.offset + shift }, alphas: piece.alphas });
                    }
                }
            }
        }
        // An opaque piece reaches over an opaque one after it, which paints over that part again, so antialiasing leaves no
        // seam between them.
        const opaque: (piece: Piece) => boolean = (piece: Piece): boolean => piece.alphas[0] >= 1 && piece.alphas[1] >= 1;
        pdf.content.save();
        pdf.content.rectangle(box[0], box[1], box[2], box[3]);
        pdf.content.clip(false);
        for (let index: number = 0; index < covering.length; index++) {
            const piece: Piece = covering[index];
            const next: Piece | undefined = covering[index + 1];
            const end: number = next !== undefined && opaque(piece) && opaque(next) ? next.to : piece.to;
            this.piece(gradient, piece, end, method, plain, output, box, pdf);
        }
        pdf.content.restore();
    }

    private piece(gradient: Line, piece: Piece, end: number, method: Method, plain: number | undefined, output: ColorSpaceResource | undefined, box: Box,
        pdf: PdfPage): void {
        // The colors are found as solid colors are, gamut mapping included, and each piece is filled by linear functions between
        // samples of them: every viewer draws those, and the conic ones as the corners of a mesh.
        const [startAlpha, endAlpha]: readonly [number, number] = piece.alphas;
        if (startAlpha <= 0 && endAlpha <= 0) {
            return;
        }
        const shadings: PdfShadings = this.document.shadings;
        const [from, to]: readonly [number, number] = [piece.from, piece.to];
        const space: ColorSpaceResource = output ?? PdfColorSpaces.RGB;
        const translucent: boolean = startAlpha !== endAlpha;
        const color: Colors = (position: number): ReadonlyArray<number> => this.colorAt(piece, method, plain, position, output !== undefined);
        const alpha: Colors = (position: number): ReadonlyArray<number> => [startAlpha + (endAlpha - startAlpha) * this.progress(piece, position)];
        const [cx, cy]: readonly [number, number] = gradient.origin;
        const regions: Array<readonly [(target: ColorSpaceResource, colors: Colors) => ShadingResource, (() => void) | undefined, Matrix | undefined]> = [];
        switch (gradient.kind) {
            case "linear": {
                const [ux, uy]: readonly [number, number] = gradient.direction;
                const reach: number = Math.hypot(box[2], box[3]) + Math.hypot(cx - box[0], cy - box[1]);
                const band: () => void = (): void => {
                    pdf.content.moveTo(cx + ux * from - uy * reach, cy + uy * from + ux * reach);
                    pdf.content.lineTo(cx + ux * end - uy * reach, cy + uy * end + ux * reach);
                    pdf.content.lineTo(cx + ux * end + uy * reach, cy + uy * end - ux * reach);
                    pdf.content.lineTo(cx + ux * from + uy * reach, cy + uy * from - ux * reach);
                    pdf.content.closePath();
                    pdf.content.clip(false);
                };
                regions.push([(target: ColorSpaceResource, colors: Colors): ShadingResource =>
                    shadings.axial(target, [cx + ux * from, cy + uy * from, cx + ux * to, cy + uy * to], this.samples(from, to, colors), [true, true]), band, undefined]);
                break;
            }
            case "across":
                for (const side of [1, -1]) {
                    const band: () => void = (): void => {
                        pdf.content.rectangle(Math.min(cx + side * from, cx + side * end), box[1], end - from, box[3]);
                        pdf.content.clip(false);
                    };
                    regions.push([(target: ColorSpaceResource, colors: Colors): ShadingResource =>
                        shadings.axial(target, [cx + side * from, cy, cx + side * to, cy], this.samples(from, to, colors), [true, true]), band, undefined]);
                }
                break;
            case "radial": {
                const ring: () => void = (): void => {
                    this.circle(end, pdf);
                    if (from > 0) {
                        this.circle(from, pdf);
                    }
                    pdf.content.clip(true);
                };
                regions.push([(target: ColorSpaceResource, colors: Colors): ShadingResource =>
                    shadings.radial(target, [0, 0, from, 0, 0, to], this.samples(from, to, colors), [true, true]), ring, [1, 0, 0, gradient.scale, cx, cy]]);
                break;
            }
            default:
                regions.push([(target: ColorSpaceResource, colors: Colors): ShadingResource => shadings.meshed(target, this.wedge(gradient, from, end, to, colors)),
                    undefined, undefined]);
        }
        for (const [shading, clip, matrix] of regions) {
            pdf.content.save();
            if (translucent) {
                this.document.shadedMask(pdf, box, shading(PdfColorSpaces.GRAY, alpha), matrix);
            } else if (startAlpha < 1) {
                pdf.content.graphicsState(pdf.useState(startAlpha, 1, "Normal"));
            }
            if (matrix !== undefined) {
                pdf.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
            }
            clip?.();
            pdf.content.shade(pdf.useShading(shading(space, color)));
            pdf.content.restore();
        }
    }

    private progress(piece: Piece, position: number): number {
        // Images 4 §3.5.3: the weight of the second color, bent by a hint; a hint at the first stop gives the second color at
        // once, and one at the second stop keeps the first color to the end.
        const span: number = piece.to - piece.from;
        const fraction: number = span > 0 ? Math.min(1, Math.max(0, (position - piece.from) / span)) : 1;
        const exponent: number | undefined = piece.start.exponent;
        if (exponent === undefined || exponent === 1) {
            return fraction;
        }
        if (exponent === Number.POSITIVE_INFINITY) {
            return fraction >= 1 ? 1 : 0;
        }
        return exponent === 0 ? (fraction > 0 ? 1 : 0) : Math.pow(fraction, exponent);
    }

    private colorAt(piece: Piece, method: Method, plain: number | undefined, position: number, profile: boolean): ReadonlyArray<number> {
        // CSS Color 4 §12.3: the components are interpolated premultiplied by alpha, except a hue; the color goes out as sRGB,
        // gamut mapped as ColorOutput maps solid colors, or in the space of the profile of the method.
        const weight: number = this.progress(piece, position);
        const [startAlpha, endAlpha]: readonly [number, number] = piece.alphas;
        const alpha: number = startAlpha + (endAlpha - startAlpha) * weight;
        const components: Array<number> = piece.start.components.map((first: number, channel: number) => {
            const second: number = piece.end.components[channel];
            if (channel === plain || startAlpha === endAlpha || alpha <= 0) {
                return first + (second - first) * weight;
            }
            return (first * startAlpha + (second * endAlpha - first * startAlpha) * weight) / alpha;
        });
        if (profile) {
            return components;
        }
        const color: ColorValue = { kind: "color", space: method.space, components: [components[0], components[1], components[2]], alpha: 1, legacy: false };
        return this.spaces.gamutMap(color, "srgb").components.map((channel: number | null) => channel ?? 0);
    }

    private samples(from: number, to: number, colors: Colors): Array<ColorStop> {
        // Linear segments between samples of the colors, added until none strays from them by half a step of 8-bit color, which
        // no output shows; the finest step is what the offsets keep of their four decimals at least.
        const at: (fraction: number) => ReadonlyArray<number> = (fraction: number): ReadonlyArray<number> => colors(from + (to - from) * fraction);
        const stops: Array<ColorStop> = [{ offset: 0, components: at(0) }];
        const split: (start: number, first: ReadonlyArray<number>, end: number, last: ReadonlyArray<number>) => void =
            (start: number, first: ReadonlyArray<number>, end: number, last: ReadonlyArray<number>): void => {
                if (end - start > 2 * FINEST) {
                    for (const part of [0.25, 0.5, 0.75]) {
                        const sample: ReadonlyArray<number> = at(start + (end - start) * part);
                        if (sample.some((channel: number, index: number) => Math.abs(channel - (first[index] + (last[index] - first[index]) * part)) > TOLERANCE)) {
                            const middle: number = (start + end) / 2;
                            const between: ReadonlyArray<number> = at(middle);
                            split(start, first, middle, between);
                            split(middle, between, end, last);
                            return;
                        }
                    }
                }
                stops.push({ offset: end, components: last });
            };
        split(0, stops[0].components, 1, at(1));
        return stops;
    }

    private circle(radius: number, pdf: PdfPage): void {
        // Arcs of a cubic Bezier are fewer the closer they keep to the circle; their number grows until the farthest point
        // strays less than the 0.0001 to which the content stream writes numbers.
        let arcs: number = 4;
        while (radius * this.bulge(2 * Math.PI / arcs) > PRECISION) {
            arcs *= 2;
        }
        const step: number = 2 * Math.PI / arcs;
        const k: number = 4 / 3 * Math.tan(step / 4) * radius;
        pdf.content.moveTo(radius, 0);
        for (let arc: number = 0; arc < arcs; arc++) {
            const a0: number = arc * step;
            const a1: number = a0 + step;
            pdf.content.curveTo(radius * Math.cos(a0) - k * Math.sin(a0), radius * Math.sin(a0) + k * Math.cos(a0), radius * Math.cos(a1) + k * Math.sin(a1),
                radius * Math.sin(a1) - k * Math.cos(a1), radius * Math.cos(a1), radius * Math.sin(a1));
        }
        pdf.content.closePath();
    }

    private bulge(angle: number): number {
        // The largest distance of a Bezier arc of a unit circle from the circle.
        const k: number = 4 / 3 * Math.tan(angle / 4);
        let largest: number = 0;
        for (let step: number = 1; step < 32; step++) {
            const point: readonly [number, number] = this.arcPoint(angle, k, step / 32);
            largest = Math.max(largest, Math.abs(Math.hypot(point[0], point[1]) - 1));
        }
        return largest;
    }

    private arcPoint(angle: number, k: number, u: number): readonly [number, number] {
        // The point at u of the Bezier arc of a unit circle from angle 0 to angle, with control distance k.
        const p: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, k], [Math.cos(angle) + k * Math.sin(angle), Math.sin(angle) - k * Math.cos(angle)], [Math.cos(angle), Math.sin(angle)]];
        const v: number = 1 - u;
        const weights: ReadonlyArray<number> = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
        return [weights.reduce((sum: number, weight: number, index: number) => sum + weight * p[index][0], 0),
            weights.reduce((sum: number, weight: number, index: number) => sum + weight * p[index][1], 0)];
    }

    private wedge(gradient: Line, from: number, end: number, to: number, colors: Colors): ReadonlyArray<CoonsPatch> {
        // Images 4 §3.3: the angle turns clockwise from up. Each Coons patch has its u = 0 and u = 1 edges on rays from the
        // center and its v = 1 edge on the circle, so a point keeps the u of the ray through it and its color follows u. The
        // patches narrow until the colors between their corners, and at the angle a ray strays to, are within half a step of
        // 8-bit color; past the piece's own end they keep its last color.
        const [cx, cy]: readonly [number, number] = gradient.origin;
        const radius: number = gradient.radius;
        const at: (angle: number) => readonly [number, number] = (angle: number): readonly [number, number] => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
        const along: (point: readonly [number, number], fraction: number) => readonly [number, number] = (point: readonly [number, number], fraction: number):
            readonly [number, number] => [cx + (point[0] - cx) * fraction, cy + (point[1] - cy) * fraction];
        const center: readonly [number, number] = [cx, cy];
        const color: (position: number) => ReadonlyArray<number> = (position: number): ReadonlyArray<number> => colors(Math.min(position, to));
        let count: number = Math.max(1, Math.ceil((end - from) / 90));
        for (;;) {
            const step: number = (end - from) / count;
            const stray: number = this.stray(step * Math.PI / 180) * 180 / Math.PI;
            let fine: boolean = true;
            for (let index: number = 0; index < count && fine; index++) {
                const t0: number = from + step * index;
                const c0: ReadonlyArray<number> = color(t0);
                const c1: ReadonlyArray<number> = color(t0 + step);
                for (const part of [0.25, 0.5, 0.75]) {
                    const t: number = t0 + step * part;
                    const sample: ReadonlyArray<number> = color(t);
                    const shifted: ReadonlyArray<number> = color(Math.min(t0 + step, t + stray));
                    fine = fine && sample.every((value: number, channel: number) => Math.abs(value - (c0[channel] + (c1[channel] - c0[channel]) * part)) <= TOLERANCE
                        && Math.abs(value - shifted[channel]) <= TOLERANCE);
                }
            }
            if (fine || step <= FINEST) {
                break;
            }
            count *= 2;
        }
        const patches: Array<CoonsPatch> = [];
        for (let index: number = 0; index < count; index++) {
            const t0: number = from + (end - from) * index / count;
            const t1: number = from + (end - from) * (index + 1) / count;
            const a0: number = (gradient.turn + t0) * Math.PI / 180;
            const a1: number = (gradient.turn + t1) * Math.PI / 180;
            const k: number = 4 / 3 * Math.tan((a1 - a0) / 4) * radius;
            const start: readonly [number, number] = at(a0);
            const stop: readonly [number, number] = at(a1);
            const first: ReadonlyArray<number> = color(t0);
            const second: ReadonlyArray<number> = color(t1);
            patches.push({
                points: [center, along(start, 1 / 3), along(start, 2 / 3), start, [start[0] + k * Math.cos(a0), start[1] + k * Math.sin(a0)],
                    [stop[0] - k * Math.cos(a1), stop[1] - k * Math.sin(a1)], stop, along(stop, 2 / 3), along(stop, 1 / 3), center, center, center],
                colors: [first, first, second, second]
            });
        }
        return patches;
    }

    private stray(angle: number): number {
        // The largest difference between the angle of the point at u of a Bezier arc and u times the arc's angle.
        const k: number = 4 / 3 * Math.tan(angle / 4);
        let largest: number = 0;
        for (let step: number = 1; step < 32; step++) {
            const u: number = step / 32;
            const point: readonly [number, number] = this.arcPoint(angle, k, u);
            largest = Math.max(largest, Math.abs(Math.atan2(point[1], point[0]) - u * angle));
        }
        return largest;
    }

    private linear(shape: ReadonlyArray<CssValue>, box: Box): Line {
        // Images 3 §3.1.1: the angle points up at 0deg and turns clockwise, to bottom when it is omitted; to a corner is
        // perpendicular to the line through the two neighboring corners; the line has length |W sin A| + |H cos A|.
        let x: number = 0;
        let y: number = 1;
        const first: CssValue | undefined = shape[0];
        if (first !== undefined && first.kind === "ident" && first.lower === "to") {
            const sides: ReadonlyArray<string> = shape.slice(1).map((item: CssValue) => item.kind === "ident" ? item.lower : "");
            const across: number = sides.includes("left") ? -1 : (sides.includes("right") ? 1 : 0);
            const down: number = sides.includes("top") ? -1 : (sides.includes("bottom") ? 1 : 0);
            if (across !== 0 && down !== 0) {
                const length: number = Math.hypot(box[3], box[2]);
                x = across * box[3] / length;
                y = down * box[2] / length;
            } else {
                const angle: number = SIDES[sides.find((side: string) => SIDES[side] !== undefined) ?? "bottom"] * Math.PI / 180;
                x = Math.sin(angle);
                y = -Math.cos(angle);
            }
        } else if (first !== undefined && first.kind !== "ident") {
            const angle: number = this.degrees(first) * Math.PI / 180;
            x = Math.sin(angle);
            y = -Math.cos(angle);
        }
        const length: number = Math.abs(box[2] * x) + Math.abs(box[3] * y);
        const startX: number = box[0] + box[2] / 2 - x * length / 2;
        const startY: number = box[1] + box[3] / 2 - y * length / 2;
        // The line ends at two corners of the box, so its positions from 0 to its length cover the box.
        return { kind: "linear", length, origin: [startX, startY], direction: [x, y], scale: 1, turn: 0, reach: [0, length], radius: 0 };
    }

    private radial(shape: ReadonlyArray<CssValue>, box: Box, style: ComputedStyle): Line {
        // Images 3 §3.2.1 and Images 4 §3.2.2: the ending shape is a circle when its size is one length and an ellipse otherwise;
        // the gradient line runs from the center to the right, to the ending shape, and an ellipse scales it in y.
        const at: number = shape.findIndex((item: CssValue) => item.kind === "ident" && item.lower === "at");
        const size: ReadonlyArray<CssValue> = (at < 0 ? shape : shape.slice(0, at)).filter((item: CssValue) => !(item.kind === "ident" && (item.lower === "circle" || item.lower === "ellipse")));
        const circle: boolean = shape.some((item: CssValue) => item.kind === "ident" && item.lower === "circle")
            || (!shape.some((item: CssValue) => item.kind === "ident" && item.lower === "ellipse") && size.length === 1 && size[0].kind !== "ident" && size[0].kind !== "percentage");
        const center: readonly [number, number] = this.center(at < 0 ? [] : shape.slice(at + 1), box, style);
        const left: number = center[0];
        const right: number = box[2] - center[0];
        const top: number = center[1];
        const bottom: number = box[3] - center[1];
        const near: readonly [number, number] = [Math.min(Math.abs(left), Math.abs(right)), Math.min(Math.abs(top), Math.abs(bottom))];
        const far: readonly [number, number] = [Math.max(Math.abs(left), Math.abs(right)), Math.max(Math.abs(top), Math.abs(bottom))];
        const extent: (keyword: string, axis: number) => number = (keyword: string, axis: number): number => keyword.startsWith("closest") ? near[axis] : far[axis];
        let rx: number;
        let ry: number;
        const keyword: string = size.length === 0 ? "farthest-corner" : (size[0].kind === "ident" ? size[0].lower : "");
        if (size.length <= 1 && EXTENTS.has(keyword)) {
            const corner: boolean = keyword.endsWith("corner");
            if (circle) {
                rx = corner ? Math.hypot(extent(keyword, 0), extent(keyword, 1)) : (keyword.startsWith("closest") ? Math.min(near[0], near[1]) : Math.max(far[0], far[1]));
                ry = rx;
            } else if (!corner) {
                rx = extent(keyword, 0);
                ry = extent(keyword, 1);
            } else {
                // §3.2.1: a corner ellipse keeps the aspect ratio of the side one of the same kind and passes through the corner.
                const sides: readonly [number, number] = keyword.startsWith("closest") ? near : far;
                const ratio: number = sides[1] === 0 ? 0 : sides[0] / sides[1];
                rx = Math.hypot(sides[0], sides[1] * ratio);
                ry = ratio === 0 ? 0 : rx / ratio;
            }
        } else if (circle) {
            rx = Math.max(0, this.geometry.pixels(size[0], Math.hypot(box[2], box[3]) / Math.SQRT2));
            ry = rx;
        } else {
            const second: CssValue = size[1] ?? size[0];
            rx = size[0].kind === "ident" ? extent(size[0].lower, 0) : Math.max(0, this.geometry.pixels(size[0], box[2]));
            ry = second.kind === "ident" ? extent(second.lower, 1) : Math.max(0, this.geometry.pixels(second, box[3]));
        }
        const cx: number = box[0] + center[0];
        const cy: number = box[1] + center[1];
        if (rx === 0) {
            // §3.2.3: with no width the ending shape is very narrow and very tall, so the position is the distance across.
            const across: number = Math.max(Math.abs(box[0] - cx), Math.abs(box[0] + box[2] - cx));
            return { kind: "across", length: 0, origin: [cx, cy], direction: [1, 0], scale: 1, turn: 0, reach: [0, across], radius: 0 };
        }
        if (ry === 0) {
            return { kind: "radial", length: rx, solid: true, origin: [cx, cy], direction: [1, 0], scale: 1, turn: 0, reach: [0, 0], radius: 0 };
        }
        // Circles around the center in a space scaled by ry / rx in y, out to the farthest corner of the box.
        return { kind: "radial", length: rx, origin: [cx, cy], direction: [1, 0], scale: ry / rx, turn: 0, reach: [0, this.farthest(box, cx, cy, rx / ry)], radius: 0 };
    }

    private conic(shape: ReadonlyArray<CssValue>, box: Box, style: ComputedStyle): Line {
        // Images 4 §3.3: around the center, 0deg up and clockwise, turned by the from angle; the positions are angles, a
        // percentage being of the full turn, and the line goes from 0deg to 360deg.
        const at: number = shape.findIndex((item: CssValue) => item.kind === "ident" && item.lower === "at");
        const from: number = shape.findIndex((item: CssValue) => item.kind === "ident" && item.lower === "from");
        const turn: number = from < 0 || shape[from + 1] === undefined ? 0 : this.degrees(shape[from + 1]);
        const center: readonly [number, number] = this.center(at < 0 ? [] : shape.slice(at + 1), box, style);
        const cx: number = box[0] + center[0];
        const cy: number = box[1] + center[1];
        return { kind: "conic", length: 360, origin: [cx, cy], direction: [0, 0], scale: 1, turn, reach: [0, 360], radius: this.farthest(box, cx, cy, 1) };
    }

    private farthest(box: Box, cx: number, cy: number, stretch: number): number {
        // The distance from the center to the farthest corner of the box, with y stretched.
        let reach: number = 0;
        for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
            reach = Math.max(reach, Math.hypot(x - cx, (y - cy) * stretch));
        }
        return reach;
    }

    private center(position: ReadonlyArray<CssValue>, box: Box, style: ComputedStyle): readonly [number, number] {
        // Images 3 §3.2.1: the position is resolved with the center point as the object and the gradient box as the area.
        const values: Readonly<Record<string, CssValue>> = style.values;
        const mode: CssValue | undefined = values["writing-mode"];
        const vertical: boolean = mode !== undefined && mode.kind === "ident" && mode.lower !== "horizontal-tb";
        const direction: CssValue | undefined = values["direction"];
        const rtl: boolean = direction !== undefined && direction.kind === "ident" && direction.lower === "rtl";
        const flipped: boolean = vertical && mode !== undefined && mode.kind === "ident" && mode.lower.endsWith("-rl");
        return this.geometry.position(position, box[2], box[3], rtl, vertical, flipped);
    }

    private method(preamble: ReadonlyArray<CssValue>): Method {
        // CSS Color 4 §12.1: in a space, with a hue method for a polar one; Oklab when the gradient gives none. CSS Color 5
        // §9.1: a custom color space is the space of a profile.
        const start: number = preamble.findIndex((item: CssValue) => item.kind === "ident" && item.lower === "in");
        if (start < 0) {
            return DEFAULT_METHOD;
        }
        const name: CssValue | undefined = preamble[start + 1];
        if (name !== undefined && name.kind === "ident" && name.name.startsWith("--")) {
            return { space: "srgb", hue: "shorter", profile: name.name };
        }
        const parts: Array<CssValue> = preamble.slice(start, start + 2);
        const next: CssValue | undefined = preamble[start + 2];
        const word: CssValue | undefined = preamble[start + 3];
        if (next !== undefined && next.kind === "ident" && word !== undefined && word.kind === "ident" && word.lower === "hue") {
            parts.push(next, word);
        }
        const parsed: readonly [ColorSpace, string] | undefined = this.colors.interpolation({ kind: "list", separator: "space", items: parts });
        return parsed === undefined ? DEFAULT_METHOD : { space: parsed[0], hue: parsed[1] };
    }

    private before(items: ReadonlyArray<CssValue>, keyword: string): ReadonlyArray<CssValue> {
        // The interpolation method is either first or last in the preamble, and takes its space and its hue method with it.
        const start: number = items.findIndex((item: CssValue) => item.kind === "ident" && item.lower === keyword);
        if (start < 0) {
            return items;
        }
        const word: CssValue | undefined = items[start + 3];
        const length: number = word !== undefined && word.kind === "ident" && word.lower === "hue" ? 4 : 2;
        return [...items.slice(0, start), ...items.slice(start + length)];
    }

    private offset(value: CssValue, length: number, angular: boolean): number {
        // Images 4 §3.5.1: a percentage is of the length of the gradient line, and an angular one of the full turn.
        if (value.kind === "percentage") {
            return value.value / 100 * length;
        }
        return angular ? this.degrees(value) : this.geometry.pixels(value, length);
    }

    private degrees(value: CssValue): number {
        if (value.kind === "dimension") {
            return this.units.toCanonical(value.value, value.unit) ?? 0;
        }
        return value.kind === "number" ? value.value : 0;
    }

    private fixup(stops: ReadonlyArray<StopEntry>, hints: Map<number, number>, length: number): Array<number> {
        // Images 4 §3.5.3: the first and last stops default to 0% and 100%; a position before a larger one earlier in the list
        // takes that one's; runs of stops without one are spread evenly between the stops around them.
        const placed: Array<number | undefined> = stops.map((stop: StopEntry) => stop.position);
        if (placed[0] === undefined) {
            placed[0] = 0;
        }
        if (placed[placed.length - 1] === undefined) {
            placed[placed.length - 1] = length;
        }
        let largest: number = Number.NEGATIVE_INFINITY;
        for (let index: number = 0; index < placed.length; index++) {
            const hint: number | undefined = hints.get(index);
            if (hint !== undefined) {
                hints.set(index, Math.max(hint, largest));
                largest = Math.max(largest, hint);
            }
            const position: number | undefined = placed[index];
            if (position !== undefined) {
                placed[index] = Math.max(position, largest);
                largest = Math.max(position, largest);
            }
        }
        for (let index: number = 1; index < placed.length; index++) {
            if (placed[index] !== undefined) {
                continue;
            }
            let end: number = index;
            while (placed[end] === undefined) {
                end++;
            }
            const from: number = placed[index - 1] as number;
            const to: number = placed[end] as number;
            for (let step: number = index; step < end; step++) {
                placed[step] = from + (to - from) * (step - index + 1) / (end - index + 1);
            }
        }
        return placed as Array<number>;
    }

    private average(colors: ReadonlyArray<ColorValue>, placed: ReadonlyArray<number>): ColorValue {
        // Images 3 §3.3: each pair of stops adds half its share of the total length to each of its two colors, in premultiplied sRGB.
        const total: number = placed[placed.length - 1] - placed[0];
        const sum: Array<number> = [0, 0, 0, 0];
        for (let index: number = 0; index + 1 < colors.length && total > 0; index++) {
            const weight: number = (placed[index + 1] - placed[index]) / 2 / total;
            for (const color of [colors[index], colors[index + 1]]) {
                const rgb: ColorValue = this.spaces.convert(color, "srgb");
                const alpha: number = color.alpha ?? 0;
                for (let channel: number = 0; channel < 3; channel++) {
                    sum[channel] += (rgb.components[channel] ?? 0) * alpha * weight;
                }
                sum[3] += alpha * weight;
            }
        }
        const alpha: number = total > 0 ? sum[3] : colors[colors.length - 1].alpha ?? 0;
        const components: readonly [number, number, number] = alpha > 0 ? [sum[0] / alpha, sum[1] / alpha, sum[2] / alpha] : [0, 0, 0];
        return { kind: "color", space: "srgb", components, alpha, legacy: false };
    }

    private solid(color: ColorValue, box: Box, pdf: PdfPage): void {
        // As ColorOutput fills solid colors: sRGB, gamut mapped.
        const alpha: number = Math.min(1, Math.max(0, color.alpha ?? 0));
        if (alpha <= 0) {
            return;
        }
        const srgb: ColorValue = this.spaces.gamutMap(color, "srgb");
        pdf.content.save();
        pdf.content.fillSpace(pdf.useColorSpace(PdfColorSpaces.RGB));
        pdf.content.fillColor(srgb.components.map((channel: number | null) => channel ?? 0));
        if (alpha < 1) {
            pdf.content.graphicsState(pdf.useState(alpha, 1, "Normal"));
        }
        pdf.content.rectangle(box[0], box[1], box[2], box[3]);
        pdf.content.fill(false);
        pdf.content.restore();
    }

    private items(value?: CssValue): ReadonlyArray<CssValue> {
        if (value === undefined) {
            return [];
        }
        return value.kind === "list" && value.separator === "space" ? value.items : [value];
    }
}
