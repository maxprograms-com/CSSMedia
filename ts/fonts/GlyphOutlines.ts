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

import type { PathData, Point, StrokeStyle } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import { ByteCursor } from "./ByteCursor.js";
import type { OutlineBounds } from "./CompactOutlines.js";
import { CompactOutlines } from "./CompactOutlines.js";
import type { PhantomDeltas } from "./PhantomPointVariations.js";
import { PhantomPointVariations } from "./PhantomPointVariations.js";
import type { FontInstance, Typeface } from "./Typeface.js";
import { Woff2Decoder } from "./Woff2Decoder.js";

export interface OutlinePoints {
    xs: Float64Array;
    ys: Float64Array;
    ends: Array<number>;
    onCurve: Uint8Array;
}

interface Component {
    glyph: number;
    flags: number;
    first: number;
    second: number;
    transform: [number, number, number, number];
}

const ON_CURVE: number = 0x01;
const REPEAT_FLAG: number = 0x08;
const X_SHORT: number = 0x02;
const Y_SHORT: number = 0x04;
const X_SAME_OR_POSITIVE: number = 0x10;
const Y_SAME_OR_POSITIVE: number = 0x20;
const ARGS_ARE_XY_VALUES: number = 0x0002;
const SCALED_COMPONENT_OFFSET: number = 0x0800;
const UNSCALED_COMPONENT_OFFSET: number = 0x1000;
const MAXIMUM_DEPTH: number = 16;
const MITER_LIMIT: number = 4;
const WHOLE_UNIT: number = 0.5;
const GRID: number = 1 / 64;

export class GlyphOutlines {

    private static readonly compact: WeakMap<FontInstance, CompactOutlines | null> = new WeakMap<FontInstance, CompactOutlines | null>();
    private static readonly grown: WeakMap<FontInstance, Map<number, PathData | null>> = new WeakMap<FontInstance, Map<number, PathData | null>>();

    private readonly variations: PhantomPointVariations = new PhantomPointVariations();
    private readonly geometry: PathGeometry = new PathGeometry();

    points(tables: Readonly<Record<string, Buffer>>, glyph: number, coordinates: Float64Array): OutlinePoints | undefined {
        // OpenType glyf: the control points of a glyph at a variation instance, those of a composite glyph being the points
        // of its components, in order, after their transformation and offset.
        return this.pointsOf(tables, glyph, coordinates, 0);
    }

    bounds(instance: FontInstance, glyph: number): OutlineBounds | undefined {
        // The bounding box of a glyph's outline at the instance, in font units: the glyf header, which the glyph's points
        // give at a variation instance, the CharString of CFF and CFF2, or the character box of the AFM file.
        if (instance.emboldening !== undefined) {
            const path: PathData | undefined = this.path(instance, glyph);
            if (path === undefined || path.points.length === 0) {
                return undefined;
            }
            const bounds: OutlineBounds = { xMin: path.points[0], yMin: path.points[1], xMax: path.points[0], yMax: path.points[1] };
            for (let index: number = 2; index < path.points.length; index += 2) {
                bounds.xMin = Math.min(bounds.xMin, path.points[index]);
                bounds.yMin = Math.min(bounds.yMin, path.points[index + 1]);
                bounds.xMax = Math.max(bounds.xMax, path.points[index]);
                bounds.yMax = Math.max(bounds.yMax, path.points[index + 1]);
            }
            return bounds;
        }
        const typeface: Typeface = instance.typeface;
        const boxes: Int16Array | undefined = typeface.glyphs.bounds;
        if (boxes !== undefined) {
            const at: number = glyph * 4;
            return at + 3 < boxes.length && (boxes[at] !== boxes[at + 2] || boxes[at + 1] !== boxes[at + 3])
                ? { xMin: boxes[at], yMin: boxes[at + 1], xMax: boxes[at + 2], yMax: boxes[at + 3] } : undefined;
        }
        const tables: Readonly<Record<string, Buffer>> = typeface.tables;
        if (tables["glyf"] !== undefined) {
            if (!instance.coordinates.some((value: number) => value !== 0)) {
                return this.header(tables, glyph);
            }
            const outline: OutlinePoints | undefined = this.points(tables, glyph, instance.coordinates);
            if (outline === undefined || outline.xs.length === 0) {
                return undefined;
            }
            const bounds: OutlineBounds = { xMin: outline.xs[0], yMin: outline.ys[0], xMax: outline.xs[0], yMax: outline.ys[0] };
            for (let point: number = 1; point < outline.xs.length; point++) {
                bounds.xMin = Math.min(bounds.xMin, outline.xs[point]);
                bounds.yMin = Math.min(bounds.yMin, outline.ys[point]);
                bounds.xMax = Math.max(bounds.xMax, outline.xs[point]);
                bounds.yMax = Math.max(bounds.yMax, outline.ys[point]);
            }
            return bounds;
        }
        return this.compactOf(instance)?.bounds(glyph);
    }

    path(instance: FontInstance, glyph: number): PathData | undefined {
        // The outline at the instance in font units, from glyf or from the CharStrings of CFF and CFF2; the standard fonts have
        // only the metrics of their AFM files.
        if (instance.emboldening !== undefined) {
            return this.grownPath(instance, instance.emboldening, glyph);
        }
        return this.designed(instance, glyph);
    }

    programPoints(instance: FontInstance, glyph: number): OutlinePoints | undefined {
        // The curves of a synthesized bold glyph are quadratic ones raised to cubic ones, so each gives back its one control point.
        if (instance.emboldening === undefined) {
            return this.points(instance.typeface.tables, glyph, instance.coordinates);
        }
        const path: PathData | undefined = this.path(instance, glyph);
        if (path === undefined) {
            return undefined;
        }
        const xs: Array<number> = [];
        const ys: Array<number> = [];
        const flags: Array<number> = [];
        const ends: Array<number> = [];
        const add: (x: number, y: number, on: boolean) => void = (x: number, y: number, on: boolean): void => {
            xs.push(x);
            ys.push(y);
            flags.push(on ? ON_CURVE : 0);
        };
        let first: number = 0;
        let index: number = 0;
        for (const verb of path.verbs) {
            if (verb === PathGeometry.CLOSE) {
                // A contour ends at its start, which TrueType does not repeat.
                const last: number = xs.length - 1;
                if (last > first && xs[last] === xs[first] && ys[last] === ys[first]) {
                    xs.pop();
                    ys.pop();
                    flags.pop();
                }
                ends.push(xs.length - 1);
                first = xs.length;
                continue;
            }
            if (verb === PathGeometry.CURVE) {
                const x: number = xs[xs.length - 1];
                const y: number = ys[ys.length - 1];
                add(x + 3 * (path.points[index] - x) / 2, y + 3 * (path.points[index + 1] - y) / 2, false);
                index += 4;
            }
            add(path.points[index], path.points[index + 1], true);
            index += 2;
        }
        return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), ends, onCurve: Uint8Array.from(flags) };
    }

    private designed(instance: FontInstance, glyph: number): PathData | undefined {
        const tables: Readonly<Record<string, Buffer>> = instance.typeface.tables;
        if (tables["glyf"] !== undefined) {
            const outline: OutlinePoints | undefined = this.points(tables, glyph, instance.coordinates);
            return outline === undefined ? undefined : this.contours(outline);
        }
        return this.compactOf(instance)?.outline(glyph);
    }

    private grownPath(instance: FontInstance, stroke: number, glyph: number): PathData | undefined {
        // CSS Fonts 4 §2.8: the glyph with "a thin stroke around" it, miter joined with the limit of 4 (Fill and Stroke 3 §4.2.5); its
        // program holds whole font units, below which the flattening stays, and the grid is a power of two, so cell centres are exact.
        let glyphs: Map<number, PathData | null> | undefined = GlyphOutlines.grown.get(instance);
        if (glyphs === undefined) {
            glyphs = new Map<number, PathData | null>();
            GlyphOutlines.grown.set(instance, glyphs);
        }
        const known: PathData | null | undefined = glyphs.get(glyph);
        if (known !== undefined) {
            return known ?? undefined;
        }
        const designed: PathData | undefined = this.designed(instance, glyph);
        const thin: StrokeStyle = { width: stroke, cap: "butt", extension: "miter", shape: "fallback", limit: MITER_LIMIT };
        const path: PathData | null = designed === undefined ? null : this.geometry.outlineOf(this.geometry.thickened(designed, thin, WHOLE_UNIT), WHOLE_UNIT, GRID);
        glyphs.set(glyph, path);
        return path ?? undefined;
    }

    private compactOf(instance: FontInstance): CompactOutlines | undefined {
        let compact: CompactOutlines | null | undefined = GlyphOutlines.compact.get(instance);
        if (compact === undefined) {
            compact = CompactOutlines.of(instance.typeface.tables, instance.coordinates) ?? null;
            GlyphOutlines.compact.set(instance, compact);
        }
        return compact ?? undefined;
    }

    private contours(outline: OutlinePoints): PathData {
        // OpenType glyf: two off-curve points in a row have an implied on-curve point midway; a quadratic curve becomes the cubic
        // whose control points are two thirds of the way to its control point.
        const path: PathData = { verbs: [], points: [] };
        let first: number = 0;
        for (const last of outline.ends) {
            const count: number = last - first + 1;
            if (count <= 0) {
                first = last + 1;
                continue;
            }
            const point: (index: number) => Point = (index: number): Point => [outline.xs[first + index % count], outline.ys[first + index % count]];
            const on: (index: number) => boolean = (index: number): boolean => (outline.onCurve[first + index % count] & ON_CURVE) !== 0;
            const middle: (a: Point, b: Point) => Point = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            let begin: number = 0;
            while (begin < count && !on(begin)) {
                begin++;
            }
            const start: Point = begin < count ? point(begin) : middle(point(count - 1), point(0));
            const offset: number = begin < count ? begin + 1 : 0;
            const steps: number = begin < count ? count - 1 : count;
            let current: Point = start;
            let control: Point | undefined;
            const quadratic: (to: Point) => void = (to: Point): void => {
                const handle: Point = control as Point;
                path.verbs.push(PathGeometry.CURVE);
                path.points.push(current[0] + 2 * (handle[0] - current[0]) / 3, current[1] + 2 * (handle[1] - current[1]) / 3,
                    to[0] + 2 * (handle[0] - to[0]) / 3, to[1] + 2 * (handle[1] - to[1]) / 3, to[0], to[1]);
                current = to;
            };
            path.verbs.push(PathGeometry.MOVE);
            path.points.push(start[0], start[1]);
            for (let step: number = 0; step < steps; step++) {
                const index: number = offset + step;
                const here: Point = point(index);
                if (on(index)) {
                    if (control === undefined) {
                        path.verbs.push(PathGeometry.LINE);
                        path.points.push(here[0], here[1]);
                        current = here;
                    } else {
                        quadratic(here);
                        control = undefined;
                    }
                } else {
                    if (control !== undefined) {
                        quadratic(middle(control, here));
                    }
                    control = here;
                }
            }
            if (control !== undefined) {
                quadratic(start);
            }
            path.verbs.push(PathGeometry.CLOSE);
            first = last + 1;
        }
        return path;
    }

    header(tables: Readonly<Record<string, Buffer>>, glyph: number): OutlineBounds | undefined {
        // OpenType glyf, "Glyph headers": xMin, yMin, xMax and yMax after the number of contours; a glyph without outline
        // has no glyph data.
        const glyf: Buffer | undefined = tables["glyf"];
        const loca: Buffer | undefined = tables["loca"];
        const head: Buffer | undefined = tables["head"];
        if (glyf === undefined || loca === undefined || head === undefined || head.length < 52) {
            return undefined;
        }
        const longOffsets: boolean = head.readInt16BE(50) !== 0;
        const entry: number = longOffsets ? glyph * 4 : glyph * 2;
        if (entry + (longOffsets ? 8 : 4) > loca.length) {
            return undefined;
        }
        const start: number = longOffsets ? loca.readUInt32BE(entry) : loca.readUInt16BE(entry) * 2;
        const end: number = longOffsets ? loca.readUInt32BE(entry + 4) : loca.readUInt16BE(entry + 2) * 2;
        if (end <= start || start + 10 > glyf.length) {
            return undefined;
        }
        return { xMin: glyf.readInt16BE(start + 2), yMin: glyf.readInt16BE(start + 4), xMax: glyf.readInt16BE(start + 6), yMax: glyf.readInt16BE(start + 8) };
    }

    private pointsOf(tables: Readonly<Record<string, Buffer>>, glyph: number, coordinates: Float64Array, depth: number): OutlinePoints | undefined {
        const glyf: Buffer | undefined = tables["glyf"];
        const loca: Buffer | undefined = tables["loca"];
        const head: Buffer | undefined = tables["head"];
        if (glyf === undefined || loca === undefined || head === undefined || head.length < 52 || depth > MAXIMUM_DEPTH) {
            return undefined;
        }
        const longOffsets: boolean = head.readInt16BE(50) !== 0;
        const entry: number = longOffsets ? glyph * 4 : glyph * 2;
        if (entry + (longOffsets ? 8 : 4) > loca.length) {
            return undefined;
        }
        const start: number = longOffsets ? loca.readUInt32BE(entry) : loca.readUInt16BE(entry) * 2;
        const end: number = Math.min(longOffsets ? loca.readUInt32BE(entry + 4) : loca.readUInt16BE(entry + 2) * 2, glyf.length);
        if (end <= start || start + 10 > glyf.length) {
            return { xs: new Float64Array(0), ys: new Float64Array(0), ends: [], onCurve: new Uint8Array(0) };
        }
        const contours: number = glyf.readInt16BE(start);
        const cursor: ByteCursor = new ByteCursor(glyf, start + 10, end);
        return contours >= 0 ? this.simple(tables, glyph, coordinates, cursor, contours) : this.composite(tables, glyph, coordinates, cursor, depth);
    }

    private simple(tables: Readonly<Record<string, Buffer>>, glyph: number, coordinates: Float64Array, cursor: ByteCursor, contours: number): OutlinePoints {
        // OpenType glyf, "Simple glyph description": the end points of the contours, the instructions, then the flags, the x
        // coordinates and the y coordinates, each coordinate relative to the one before.
        const ends: Array<number> = [];
        for (let index: number = 0; index < contours; index++) {
            ends.push(cursor.uint16());
        }
        const count: number = contours === 0 ? 0 : ends[contours - 1] + 1;
        cursor.skip(cursor.uint16());
        const flags: Uint8Array = new Uint8Array(count);
        for (let index: number = 0; index < count; index++) {
            const flag: number = cursor.uint8();
            flags[index] = flag;
            if ((flag & REPEAT_FLAG) !== 0) {
                for (let repeat: number = cursor.uint8(); repeat > 0 && index + 1 < count; repeat--) {
                    flags[++index] = flag;
                }
            }
        }
        const xs: Float64Array = this.coordinates(cursor, flags, X_SHORT, X_SAME_OR_POSITIVE);
        const ys: Float64Array = this.coordinates(cursor, flags, Y_SHORT, Y_SAME_OR_POSITIVE);
        const deltas: PhantomDeltas = this.variations.pointDeltas(tables, coordinates, glyph, xs, ys, ends);
        for (let index: number = 0; index < count; index++) {
            xs[index] += deltas.x[index];
            ys[index] += deltas.y[index];
        }
        return { xs, ys, ends, onCurve: flags };
    }

    private coordinates(cursor: ByteCursor, flags: Uint8Array, short: number, sameOrPositive: number): Float64Array {
        const values: Float64Array = new Float64Array(flags.length);
        let current: number = 0;
        for (let index: number = 0; index < flags.length; index++) {
            const flag: number = flags[index];
            if ((flag & short) !== 0) {
                const magnitude: number = cursor.uint8();
                current += (flag & sameOrPositive) !== 0 ? magnitude : -magnitude;
            } else if ((flag & sameOrPositive) === 0) {
                current += cursor.int16();
            }
            values[index] = current;
        }
        return values;
    }

    private composite(tables: Readonly<Record<string, Buffer>>, glyph: number, coordinates: Float64Array, cursor: ByteCursor, depth: number): OutlinePoints {
        // OpenType glyf, "Composite glyph description": each component is transformed, then placed by an offset or by making
        // one of its points meet a point of the glyph built so far; in gvar the points of a composite are its components.
        const components: Array<Component> = [];
        let more: boolean = true;
        while (more) {
            const flags: number = cursor.uint16();
            const component: number = cursor.uint16();
            const words: boolean = (flags & Woff2Decoder.ARGS_ARE_WORDS) !== 0;
            const xy: boolean = (flags & ARGS_ARE_XY_VALUES) !== 0;
            const first: number = words ? (xy ? cursor.int16() : cursor.uint16()) : (xy ? cursor.int8() : cursor.uint8());
            const second: number = words ? (xy ? cursor.int16() : cursor.uint16()) : (xy ? cursor.int8() : cursor.uint8());
            const transform: [number, number, number, number] = [1, 0, 0, 1];
            if ((flags & Woff2Decoder.HAVE_SCALE) !== 0) {
                transform[0] = cursor.int16() / 16384;
                transform[3] = transform[0];
            } else if ((flags & Woff2Decoder.HAVE_X_AND_Y_SCALE) !== 0) {
                transform[0] = cursor.int16() / 16384;
                transform[3] = cursor.int16() / 16384;
            } else if ((flags & Woff2Decoder.HAVE_TWO_BY_TWO) !== 0) {
                transform[0] = cursor.int16() / 16384;
                transform[1] = cursor.int16() / 16384;
                transform[2] = cursor.int16() / 16384;
                transform[3] = cursor.int16() / 16384;
            }
            components.push({ glyph: component, flags, first, second, transform });
            more = (flags & Woff2Decoder.MORE_COMPONENTS) !== 0;
        }
        const offsetsX: Float64Array = Float64Array.from(components.map((component: Component) => (component.flags & ARGS_ARE_XY_VALUES) !== 0 ? component.first : 0));
        const offsetsY: Float64Array = Float64Array.from(components.map((component: Component) => (component.flags & ARGS_ARE_XY_VALUES) !== 0 ? component.second : 0));
        const deltas: PhantomDeltas = this.variations.pointDeltas(tables, coordinates, glyph, offsetsX, offsetsY);
        const xs: Array<number> = [];
        const ys: Array<number> = [];
        const ends: Array<number> = [];
        const flags: Array<number> = [];
        components.forEach((component: Component, index: number) => {
            const child: OutlinePoints | undefined = this.pointsOf(tables, component.glyph, coordinates, depth + 1);
            if (child === undefined) {
                return;
            }
            const [xScale, scale01, scale10, yScale]: [number, number, number, number] = component.transform;
            const childXs: Array<number> = [];
            const childYs: Array<number> = [];
            for (let point: number = 0; point < child.xs.length; point++) {
                childXs.push(xScale * child.xs[point] + scale10 * child.ys[point]);
                childYs.push(scale01 * child.xs[point] + yScale * child.ys[point]);
            }
            let offsetX: number = 0;
            let offsetY: number = 0;
            if ((component.flags & ARGS_ARE_XY_VALUES) !== 0) {
                offsetX = component.first + deltas.x[index];
                offsetY = component.second + deltas.y[index];
                if ((component.flags & SCALED_COMPONENT_OFFSET) !== 0 && (component.flags & UNSCALED_COMPONENT_OFFSET) === 0) {
                    const scaledX: number = xScale * offsetX + scale10 * offsetY;
                    offsetY = scale01 * offsetX + yScale * offsetY;
                    offsetX = scaledX;
                }
            } else if (component.first < xs.length && component.second < childXs.length) {
                offsetX = xs[component.first] - childXs[component.second];
                offsetY = ys[component.first] - childYs[component.second];
            }
            for (const end of child.ends) {
                ends.push(end + xs.length);
            }
            flags.push(...child.onCurve);
            for (let point: number = 0; point < childXs.length; point++) {
                xs.push(childXs[point] + offsetX);
                ys.push(childYs[point] + offsetY);
            }
        });
        return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), ends, onCurve: Uint8Array.from(flags) };
    }
}
