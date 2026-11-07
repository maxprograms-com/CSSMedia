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

import { ByteCursor } from "./ByteCursor.js";
import { RegionScalar } from "./RegionScalar.js";
import { Woff2Decoder } from "./Woff2Decoder.js";

interface GlyphOutline {
    pointCount: number;
    metricsComponent: number;
}

export interface TopPhantom {
    glyph: number;
    delta: number;
}

export interface PhantomDeltas {
    x: Float64Array;
    y: Float64Array;
}

const SHARED_POINT_NUMBERS: number = 0x8000;
const COUNT_MASK: number = 0x0FFF;
const EMBEDDED_PEAK_TUPLE: number = 0x8000;
const INTERMEDIATE_REGION: number = 0x4000;
const PRIVATE_POINT_NUMBERS: number = 0x2000;
const TUPLE_INDEX_MASK: number = 0x0FFF;
const POINTS_ARE_WORDS: number = 0x80;
const POINT_RUN_COUNT_MASK: number = 0x7F;
const DELTAS_ARE_ZERO: number = 0x80;
const DELTAS_ARE_WORDS: number = 0x40;
const DELTA_RUN_COUNT_MASK: number = 0x3F;
const USE_MY_METRICS: number = 0x0200;
const MAXIMUM_DEPTH: number = 16;

export class PhantomPointVariations {

    private readonly regionScalar: RegionScalar = new RegionScalar();
    private tables: Readonly<Record<string, Buffer>> = {};
    private coordinates: Float64Array = new Float64Array(0);
    private sharedTuples: Array<Float64Array> = [];
    private readonly sharedByTable: WeakMap<Buffer, Array<Float64Array>> = new WeakMap<Buffer, Array<Float64Array>>();
    private readonly impliedRegions: WeakMap<Float64Array, readonly [Float64Array, Float64Array]> = new WeakMap<Float64Array, readonly [Float64Array, Float64Array]>();

    apply(tables: Readonly<Record<string, Buffer>>, coordinates: Float64Array, glyphCount: number, advances?: Float64Array, verticalAdvances?: Float64Array): void {
        // OpenType gvar: the last four point numbers of every glyph are its phantom points, whose deltas give the metric deltas.
        const gvar: Buffer | undefined = tables["gvar"];
        if (gvar === undefined || tables["glyf"] === undefined || tables["loca"] === undefined || tables["head"] === undefined || gvar.length < 20 || gvar.readUInt16BE(0) !== 1) {
            return;
        }
        this.tables = tables;
        this.coordinates = coordinates;
        this.sharedTuples = this.sharedOf(gvar);
        const horizontal: Float64Array = new Float64Array(glyphCount);
        const vertical: Float64Array = new Float64Array(glyphCount);
        const outlines: Array<GlyphOutline> = [];
        for (let glyph: number = 0; glyph < glyphCount; glyph++) {
            const outline: GlyphOutline = this.outline(glyph);
            outlines.push(outline);
            const deltas: PhantomDeltas = this.phantomDeltas(gvar, glyph, outline.pointCount);
            horizontal[glyph] = deltas.x[1] - deltas.x[0];
            vertical[glyph] = deltas.y[2] - deltas.y[3];
        }
        const defaults: Float64Array | undefined = advances === undefined ? undefined : advances.slice();
        const verticalDefaults: Float64Array | undefined = verticalAdvances === undefined ? undefined : verticalAdvances.slice();
        for (let glyph: number = 0; glyph < glyphCount; glyph++) {
            const source: number = this.metricsSource(glyph, outlines);
            if (advances !== undefined && defaults !== undefined) {
                advances[glyph] = defaults[source] + horizontal[source];
            }
            if (verticalAdvances !== undefined && verticalDefaults !== undefined) {
                verticalAdvances[glyph] = verticalDefaults[source] + vertical[source];
            }
        }
    }

    topPhantom(tables: Readonly<Record<string, Buffer>>, coordinates: Float64Array, glyph: number): TopPhantom {
        // OpenType gvar: the third phantom point is the vertical origin of the glyph, so its y delta varies that origin; a
        // component with USE_MY_METRICS gives the composite its phantom points.
        this.tables = tables;
        this.coordinates = coordinates;
        let source: number = glyph;
        let outline: GlyphOutline = this.outline(source);
        for (let depth: number = 0; depth < MAXIMUM_DEPTH && outline.metricsComponent >= 0; depth++) {
            source = outline.metricsComponent;
            outline = this.outline(source);
        }
        const gvar: Buffer | undefined = tables["gvar"];
        if (gvar === undefined || gvar.length < 20 || gvar.readUInt16BE(0) !== 1) {
            return { glyph: source, delta: 0 };
        }
        this.sharedTuples = this.sharedOf(gvar);
        return { glyph: source, delta: this.phantomDeltas(gvar, source, outline.pointCount).y[2] };
    }

    private metricsSource(glyph: number, outlines: ReadonlyArray<GlyphOutline>): number {
        // OpenType gvar: a component with USE_MY_METRICS gives the composite its interpolated phantom points.
        let source: number = glyph;
        for (let depth: number = 0; depth < MAXIMUM_DEPTH && outlines[source].metricsComponent >= 0 && outlines[source].metricsComponent < outlines.length; depth++) {
            source = outlines[source].metricsComponent;
        }
        return source;
    }

    private sharedOf(gvar: Buffer): Array<Float64Array> {
        let tuples: Array<Float64Array> | undefined = this.sharedByTable.get(gvar);
        if (tuples === undefined) {
            tuples = this.readSharedTuples(gvar);
            this.sharedByTable.set(gvar, tuples);
        }
        return tuples;
    }

    private implied(peak: Float64Array): readonly [Float64Array, Float64Array] {
        let region: readonly [Float64Array, Float64Array] | undefined = this.impliedRegions.get(peak);
        if (region === undefined) {
            region = [peak.map((value: number) => Math.min(value, 0)), peak.map((value: number) => Math.max(value, 0))];
            this.impliedRegions.set(peak, region);
        }
        return region;
    }

    private readSharedTuples(gvar: Buffer): Array<Float64Array> {
        const axisCount: number = gvar.readUInt16BE(4);
        const count: number = gvar.readUInt16BE(6);
        const offset: number = gvar.readUInt32BE(8);
        const tuples: Array<Float64Array> = [];
        for (let index: number = 0; index < count; index++) {
            tuples.push(this.tuple(gvar, offset + index * axisCount * 2, axisCount));
        }
        return tuples;
    }

    private tuple(table: Buffer, offset: number, axisCount: number): Float64Array {
        const tuple: Float64Array = new Float64Array(axisCount);
        for (let axis: number = 0; axis < axisCount; axis++) {
            tuple[axis] = table.readInt16BE(offset + axis * 2) / 16384;
        }
        return tuple;
    }

    private outline(glyph: number): GlyphOutline {
        const glyf: Buffer = this.tables["glyf"];
        const loca: Buffer = this.tables["loca"];
        const longOffsets: boolean = this.tables["head"].readInt16BE(50) !== 0;
        const entry: number = longOffsets ? glyph * 4 : glyph * 2;
        if (entry + (longOffsets ? 8 : 4) > loca.length) {
            return { pointCount: 0, metricsComponent: -1 };
        }
        const start: number = longOffsets ? loca.readUInt32BE(entry) : loca.readUInt16BE(entry) * 2;
        const end: number = longOffsets ? loca.readUInt32BE(entry + 4) : loca.readUInt16BE(entry + 2) * 2;
        if (end <= start || start + 10 > glyf.length) {
            return { pointCount: 0, metricsComponent: -1 };
        }
        const contours: number = glyf.readInt16BE(start);
        if (contours >= 0) {
            return { pointCount: contours === 0 ? 0 : glyf.readUInt16BE(start + 10 + (contours - 1) * 2) + 1, metricsComponent: -1 };
        }
        const cursor: ByteCursor = new ByteCursor(glyf, start + 10, Math.min(end, glyf.length));
        let components: number = 0;
        let metricsComponent: number = -1;
        let more: boolean = true;
        while (more) {
            const flags: number = cursor.uint16();
            const component: number = cursor.uint16();
            let size: number = (flags & Woff2Decoder.ARGS_ARE_WORDS) !== 0 ? 4 : 2;
            if ((flags & Woff2Decoder.HAVE_SCALE) !== 0) {
                size += 2;
            } else if ((flags & Woff2Decoder.HAVE_X_AND_Y_SCALE) !== 0) {
                size += 4;
            } else if ((flags & Woff2Decoder.HAVE_TWO_BY_TWO) !== 0) {
                size += 8;
            }
            cursor.skip(size);
            if ((flags & USE_MY_METRICS) !== 0) {
                metricsComponent = component;
            }
            components++;
            more = (flags & Woff2Decoder.MORE_COMPONENTS) !== 0;
        }
        return { pointCount: components, metricsComponent };
    }

    pointDeltas(tables: Readonly<Record<string, Buffer>>, coordinates: Float64Array, glyph: number, xs: Float64Array, ys: Float64Array,
        contourEnds?: ReadonlyArray<number>): PhantomDeltas {
        // OpenType gvar: the deltas of every point of a glyph and of its four phantom points; for a composite glyph the
        // points are its components, and "Inferring of deltas for un-referenced points applies only to simple glyphs".
        const total: number = xs.length + 4;
        const result: PhantomDeltas = { x: new Float64Array(total), y: new Float64Array(total) };
        const gvar: Buffer | undefined = tables["gvar"];
        if (gvar === undefined || gvar.length < 20 || gvar.readUInt16BE(0) !== 1 || coordinates.every((value: number) => value === 0)) {
            return result;
        }
        this.tables = tables;
        this.coordinates = coordinates;
        this.sharedTuples = this.sharedOf(gvar);
        this.eachTuple(gvar, glyph, xs.length, (scalar: number, xDeltas: Int32Array, yDeltas: Int32Array, listed?: Array<number>): void => {
            const dx: Float64Array = new Float64Array(total);
            const dy: Float64Array = new Float64Array(total);
            if (listed === undefined) {
                dx.set(xDeltas.subarray(0, total));
                dy.set(yDeltas.subarray(0, total));
            } else {
                const referenced: Uint8Array = new Uint8Array(total);
                listed.forEach((point: number, index: number) => {
                    if (point < total) {
                        dx[point] = xDeltas[index];
                        dy[point] = yDeltas[index];
                        referenced[point] = 1;
                    }
                });
                if (contourEnds !== undefined) {
                    this.infer(dx, xs, referenced, contourEnds);
                    this.infer(dy, ys, referenced, contourEnds);
                }
            }
            for (let point: number = 0; point < total; point++) {
                result.x[point] += scalar * dx[point];
                result.y[point] += scalar * dy[point];
            }
        });
        return result;
    }

    private infer(deltas: Float64Array, coordinates: Float64Array, referenced: Uint8Array, contourEnds: ReadonlyArray<number>): void {
        // OpenType gvar, "Inferred deltas for un-referenced point numbers": contour by contour, from the nearest referenced
        // points before and after, in point number order and wrapping around the contour.
        let start: number = 0;
        for (const end of contourEnds) {
            const listed: Array<number> = [];
            for (let point: number = start; point <= end; point++) {
                if (referenced[point] === 1) {
                    listed.push(point);
                }
            }
            if (listed.length > 0 && listed.length < end - start + 1) {
                for (let point: number = start; point <= end; point++) {
                    if (referenced[point] === 1) {
                        continue;
                    }
                    const preceding: number = [...listed].reverse().find((candidate: number) => candidate < point) ?? listed[listed.length - 1];
                    const following: number = listed.find((candidate: number) => candidate > point) ?? listed[0];
                    deltas[point] = this.inferred(coordinates[point], coordinates[preceding], coordinates[following], deltas[preceding], deltas[following]);
                }
            }
            start = end + 1;
        }
    }

    private inferred(target: number, preceding: number, following: number, precedingDelta: number, followingDelta: number): number {
        if (preceding === following) {
            return precedingDelta === followingDelta ? precedingDelta : 0;
        }
        if (target <= Math.min(preceding, following)) {
            return preceding < following ? precedingDelta : followingDelta;
        }
        if (target >= Math.max(preceding, following)) {
            return preceding > following ? precedingDelta : followingDelta;
        }
        const proportion: number = (target - preceding) / (following - preceding);
        return (1 - proportion) * precedingDelta + proportion * followingDelta;
    }

    private phantomDeltas(gvar: Buffer, glyph: number, pointCount: number): PhantomDeltas {
        const deltas: PhantomDeltas = { x: new Float64Array(4), y: new Float64Array(4) };
        this.eachTuple(gvar, glyph, pointCount, (scalar: number, xDeltas: Int32Array, yDeltas: Int32Array, listed?: Array<number>): void => {
            for (let point: number = 0; point < xDeltas.length; point++) {
                const phantom: number = (listed === undefined ? point : listed[point]) - pointCount;
                if (phantom >= 0 && phantom < 4) {
                    deltas.x[phantom] += scalar * xDeltas[point];
                    deltas.y[phantom] += scalar * yDeltas[point];
                }
            }
        });
        return deltas;
    }

    private eachTuple(gvar: Buffer, glyph: number, pointCount: number,
        visit: (scalar: number, xDeltas: Int32Array, yDeltas: Int32Array, listed?: Array<number>) => void): void {
        const axisCount: number = gvar.readUInt16BE(4);
        const longOffsets: boolean = (gvar.readUInt16BE(14) & 1) !== 0;
        const arrayOffset: number = gvar.readUInt32BE(16);
        const entry: number = 20 + glyph * (longOffsets ? 4 : 2);
        if (glyph >= gvar.readUInt16BE(12) || entry + (longOffsets ? 8 : 4) > gvar.length) {
            return;
        }
        const start: number = arrayOffset + (longOffsets ? gvar.readUInt32BE(entry) : gvar.readUInt16BE(entry) * 2);
        const end: number = arrayOffset + (longOffsets ? gvar.readUInt32BE(entry + 4) : gvar.readUInt16BE(entry + 2) * 2);
        if (end <= start || end > gvar.length) {
            return;
        }
        const totalPoints: number = pointCount + 4;
        const header: ByteCursor = new ByteCursor(gvar, start, end);
        const countField: number = header.uint16();
        const data: ByteCursor = new ByteCursor(gvar, start + header.uint16(), end);
        const shared: Array<number> | undefined = (countField & SHARED_POINT_NUMBERS) !== 0 ? this.points(data) : undefined;
        for (let index: number = 0; index < (countField & COUNT_MASK); index++) {
            const size: number = header.uint16();
            const tupleIndex: number = header.uint16();
            let peak: Float64Array;
            if ((tupleIndex & EMBEDDED_PEAK_TUPLE) !== 0) {
                peak = this.tuple(gvar, header.position, axisCount);
                header.skip(axisCount * 2);
            } else {
                peak = this.sharedTuples[tupleIndex & TUPLE_INDEX_MASK] ?? new Float64Array(axisCount);
            }
            let starts: Float64Array;
            let ends: Float64Array;
            if ((tupleIndex & INTERMEDIATE_REGION) !== 0) {
                starts = this.tuple(gvar, header.position, axisCount);
                ends = this.tuple(gvar, header.position + axisCount * 2, axisCount);
                header.skip(axisCount * 4);
            } else {
                [starts, ends] = this.implied(peak);
            }
            const tupleData: ByteCursor = new ByteCursor(gvar, data.position, data.position + size);
            data.skip(size);
            const scalar: number = this.regionScalar.compute(starts, peak, ends, this.coordinates);
            if (scalar === 0) {
                continue;
            }
            const listed: Array<number> | undefined = (tupleIndex & PRIVATE_POINT_NUMBERS) !== 0 ? this.points(tupleData) : shared;
            const count: number = listed === undefined ? totalPoints : listed.length;
            const xDeltas: Int32Array = this.deltas(tupleData, count);
            const yDeltas: Int32Array = this.deltas(tupleData, count);
            visit(scalar, xDeltas, yDeltas, listed);
        }
    }

    private points(cursor: ByteCursor): Array<number> | undefined {
        // OpenType packed point numbers: a count of zero means every point, phantom points included.
        const first: number = cursor.uint8();
        if (first === 0) {
            return undefined;
        }
        const count: number = (first & POINTS_ARE_WORDS) !== 0 ? ((first & POINT_RUN_COUNT_MASK) << 8) | cursor.uint8() : first;
        const points: Array<number> = [];
        let last: number = 0;
        while (points.length < count) {
            const control: number = cursor.uint8();
            const run: number = (control & POINT_RUN_COUNT_MASK) + 1;
            for (let index: number = 0; index < run && points.length < count; index++) {
                last += (control & POINTS_ARE_WORDS) !== 0 ? cursor.uint16() : cursor.uint8();
                points.push(last);
            }
        }
        return points;
    }

    private deltas(cursor: ByteCursor, count: number): Int32Array {
        const deltas: Int32Array = new Int32Array(count);
        let index: number = 0;
        while (index < count) {
            const control: number = cursor.uint8();
            const run: number = (control & DELTA_RUN_COUNT_MASK) + 1;
            for (let item: number = 0; item < run && index < count; item++) {
                if ((control & DELTAS_ARE_ZERO) !== 0) {
                    deltas[index++] = 0;
                } else {
                    deltas[index++] = (control & DELTAS_ARE_WORDS) !== 0 ? cursor.int16() : cursor.int8();
                }
            }
        }
        return deltas;
    }
}
