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

import type { ContentStream } from "../writer/ContentStream.js";

export type Homography = ReadonlyArray<number>;

export type Point = readonly [number, number];

export interface PathData {
    verbs: Array<number>;
    points: Array<number>;
}

interface DashJustify {
    mode: string;
    dashes: boolean;
    gaps: boolean;
}

export interface StrokeStyle {
    width: number;
    cap: string;
    extension: string;
    shape: string;
    limit: number;
    joins: boolean;
    dashes?: readonly [ReadonlyArray<number>, number];
    corner?: number;
    justify?: DashJustify;
}

interface Tangent {
    direction: Point;
    curvature: number;
}

interface Vertex {
    incoming: Tangent;
    outgoing: Tangent;
}

interface Subpath {
    points: Array<Point>;
    lengths: Array<number>;
    vertices: Map<number, Vertex>;
    corners: Array<number>;
    closed: boolean;
    drawn: boolean;
}

interface Run {
    points: Array<Point>;
    vertices: Array<Vertex | undefined>;
    direction?: Point;
}

interface Edge {
    point: Point;
    direction: Point;
    center?: Point;
    radius: number;
}

const STRAIGHT: number = 1e-12;
const W_LIMIT: number = 1e-6;
const MOVE: number = 0;
const LINE: number = 1;
const CURVE: number = 2;
const CLOSE: number = 3;
const ARC_PART: number = 4;

export class PathGeometry {

    static readonly MOVE: number = MOVE;
    static readonly LINE: number = LINE;
    static readonly CURVE: number = CURVE;
    static readonly CLOSE: number = CLOSE;
    static readonly ARC_PART: number = ARC_PART;
    static readonly IDENTITY3: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    static readonly W_LIMIT: number = W_LIMIT;

    protected mapped(homography: Homography, x: number, y: number): readonly [number, number, number] {
        return [homography[0] * x + homography[1] * y + homography[2], homography[3] * x + homography[4] * y + homography[5], homography[6] * x + homography[7] * y + homography[8]];
    }

    trace(path: PathData, content: ContentStream): void {
        let index: number = 0;
        const points: ReadonlyArray<number> = path.points;
        for (const verb of path.verbs) {
            if (verb === CLOSE) {
                content.closePath();
            } else if (verb === MOVE) {
                content.moveTo(points[index], points[index + 1]);
                index += 2;
            } else if (verb === LINE) {
                content.lineTo(points[index], points[index + 1]);
                index += 2;
            } else {
                content.curveTo(points[index], points[index + 1], points[index + 2], points[index + 3], points[index + 4], points[index + 5]);
                index += 6;
            }
        }
    }

    protected segments(path: PathData, visit: (verb: number, start: Point, points: ReadonlyArray<number>) => void): void {
        let index: number = 0;
        let current: Point = [0, 0];
        let start: Point = [0, 0];
        for (const verb of path.verbs) {
            if (verb === CLOSE) {
                visit(verb, current, [start[0], start[1]]);
                current = start;
                continue;
            }
            const count: number = verb === CURVE || verb === ARC_PART ? 6 : 2;
            const points: ReadonlyArray<number> = path.points.slice(index, index + count);
            index += count;
            visit(verb, current, points);
            current = [points[count - 2], points[count - 1]];
            if (verb === MOVE) {
                start = current;
            }
        }
    }

    protected flattened(path: PathData, tolerance: number, homography: Homography): Array<readonly [Array<Point>, boolean]> {
        const result: Array<[Array<Point>, boolean]> = [];
        const push: (point: Point) => void = (point: Point): void => {
            const points: Array<Point> = result[result.length - 1][0];
            const last: Point | undefined = points[points.length - 1];
            if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) {
                points.push(point);
            }
        };
        this.segments(path, (verb: number, start: Point, points: ReadonlyArray<number>) => {
            if (verb === MOVE) {
                result.push([[[points[0], points[1]]], false]);
                return;
            }
            if (result.length === 0) {
                result.push([[start], false]);
            }
            if (verb === CLOSE) {
                result[result.length - 1][1] = true;
                return;
            }
            if (verb === LINE) {
                push([points[0], points[1]]);
                return;
            }
            this.flatCurve(start, [points[0], points[1]], [points[2], points[3]], [points[4], points[5]], tolerance, homography, push);
        });
        for (const entry of result) {
            const points: Array<Point> = entry[0];
            if (entry[1] && points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) {
                points.pop();
            }
            if (entry[1] && points.length > 1) {
                points.push(points[0]);
            }
        }
        return result;
    }

    protected flatCurve(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number, homography: Homography, push: (point: Point) => void): void {
        // Flatness is measured where the curve is drawn, since a projection magnifies some parts of it.
        const middle: (a: Point, b: Point) => Point = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const q0: Point = middle(p0, p1);
        const q1: Point = middle(p1, p2);
        const q2: Point = middle(p2, p3);
        const r0: Point = middle(q0, q1);
        const r1: Point = middle(q1, q2);
        const split: Point = middle(r0, r1);
        // A piece that crosses w = 0 is never straight, so its splitting ends where doubles hold no point between its ends.
        if (this.straight([p0, p1, p2, p3], tolerance, homography) || this.same(split, p0) || this.same(split, p3)) {
            push(p3);
            return;
        }
        this.flatCurve(p0, q0, r0, split, tolerance, homography, push);
        this.flatCurve(split, r1, q2, p3, tolerance, homography, push);
    }

    protected straight(points: ReadonlyArray<Point>, tolerance: number, homography: Homography): boolean {
        // A piece wholly behind the viewer is cut away, so its shape does not matter; one that crosses w = 0 is split on.
        const drawn: Array<readonly [number, number, number]> = points.map((point: Point) => this.mapped(homography, point[0], point[1]));
        if (drawn.every((point: readonly [number, number, number]) => point[2] <= W_LIMIT)) {
            return true;
        }
        if (drawn.some((point: readonly [number, number, number]) => point[2] <= W_LIMIT)) {
            return false;
        }
        const [a, b, c, d]: ReadonlyArray<Point> = drawn.map((point: readonly [number, number, number]): Point => [point[0] / point[2], point[1] / point[2]]);
        return this.away(b, a, d) <= tolerance && this.away(c, a, d) <= tolerance;
    }

    protected same(first: Point, second: Point): boolean {
        return first[0] === second[0] && first[1] === second[1];
    }

    private away(point: Point, from: Point, to: Point): number {
        const dx: number = to[0] - from[0];
        const dy: number = to[1] - from[1];
        const length: number = dx * dx + dy * dy;
        const t: number = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length));
        return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dy);
    }

    protected oriented(points: ReadonlyArray<Point>): ReadonlyArray<Point> {
        let area: number = 0;
        points.forEach((point: Point, index: number) => {
            const next: Point = points[(index + 1) % points.length];
            area += point[0] * next[1] - next[0] * point[1];
        });
        return area > 0 ? [...points].reverse() : points;
    }

    protected circle(center: Point, radius: number, tolerance: number, homography: Homography): Array<Point> {
        const points: Array<Point> = [];
        const at: (angle: number) => Point = (angle: number): Point => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
        const arc: (from: number, to: number, depth: number) => void = (from: number, to: number, depth: number): void => {
            // The quarter points are always kept, so the extremes of the circle are exact; the splitting ends where doubles hold
            // no angle between the ends.
            const middle: number = (from + to) / 2;
            if (middle !== from && middle !== to && (depth < 2 || !this.straight([at(from), at(middle), at(middle), at(to)], tolerance, homography))) {
                arc(from, middle, depth + 1);
                arc(middle, to, depth + 1);
                return;
            }
            points.push(at(from));
        };
        arc(0, 2 * Math.PI, 0);
        return points;
    }

    strokeOutline(path: PathData, stroke: StrokeStyle, tolerance: number, homography: Homography): PathData {
        // CSS Fill and Stroke 3 §4.6.2: the union of the dashes of each subpath, each with its caps and the joins inside it;
        // each piece winds once, so nonzero fills them. A closed subpath without dashes has a join where it closes, not caps.
        const result: PathData = { verbs: [], points: [] };
        const half: number = stroke.width / 2;
        if (half <= 0) {
            return result;
        }
        const piece: (points: ReadonlyArray<Point>) => void = (points: ReadonlyArray<Point>): void => {
            if (points.length < 3) {
                return;
            }
            this.oriented(points).forEach((point: Point, index: number) => {
                result.verbs.push(index === 0 ? MOVE : LINE);
                result.points.push(point[0], point[1]);
            });
            result.verbs.push(CLOSE);
        };
        for (const subpath of this.subpaths(path, tolerance, homography)) {
            const length: number = subpath.lengths[subpath.lengths.length - 1];
            const whole: boolean = subpath.closed && stroke.dashes === undefined && stroke.corner === undefined;
            const dashes: ReadonlyArray<readonly [number, number]> = whole ? [[0, length]] : this.positions(subpath, stroke);
            for (const [start, end] of dashes) {
                this.dash(subpath, start, end, whole, stroke, half, piece, tolerance, homography);
            }
        }
        return result;
    }

    outline(path: PathData, width: number, tolerance: number): PathData {
        // The edge of the stroke of smooth open subpaths with butt ends: each side offset by half the width, without the loops
        // that the inner side makes where the curve turns tighter than that.
        const half: number = width / 2;
        const result: PathData = { verbs: [], points: [] };
        for (const subpath of this.subpaths(path, tolerance, PathGeometry.IDENTITY3)) {
            if (subpath.points.length < 2) {
                continue;
            }
            const left: Array<Point> = this.untangled(this.offset(subpath.points, half), half);
            const right: Array<Point> = this.untangled(this.offset(subpath.points, -half), half);
            [...left, ...right.reverse()].forEach((point: Point, index: number) => {
                result.verbs.push(index === 0 ? MOVE : LINE);
                result.points.push(point[0], point[1]);
            });
            result.verbs.push(CLOSE);
        }
        return result;
    }

    private subpaths(path: PathData, tolerance: number, homography: Homography): Array<Subpath> {
        // §4.6.5 and §4.6.6: joins are made where two segments meet, with their tangents and curvatures there; the points
        // where a curve is flattened are not corners, and the parts of an arc make one segment.
        const result: Array<Subpath> = [];
        let current: Subpath | undefined;
        let first: Tangent | undefined;
        let last: Tangent | undefined;
        let continued: boolean = false;
        const finish: () => void = (): void => {
            if (current !== undefined) {
                current.corners.push(current.lengths[current.lengths.length - 1]);
            }
        };
        const open: (point: Point) => void = (point: Point): void => {
            finish();
            current = { points: [point], lengths: [0], vertices: new Map<number, Vertex>(), corners: [0], closed: false, drawn: false };
            result.push(current);
            first = undefined;
            last = undefined;
            continued = false;
        };
        const add: (point: Point) => void = (point: Point): void => {
            const subpath: Subpath = current as Subpath;
            const previous: Point = subpath.points[subpath.points.length - 1];
            if (previous[0] !== point[0] || previous[1] !== point[1]) {
                subpath.lengths.push(subpath.lengths[subpath.lengths.length - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]));
                subpath.points.push(point);
            }
        };
        const segment: (start: Tangent, end: Tangent, draw: () => void, arc: boolean) => void = (start: Tangent, end: Tangent, draw: () => void, arc: boolean): void => {
            const subpath: Subpath = current as Subpath;
            if (last !== undefined && !continued) {
                subpath.vertices.set(subpath.points.length - 1, { incoming: last, outgoing: start });
                subpath.corners.push(subpath.lengths[subpath.lengths.length - 1]);
            }
            first = first ?? start;
            draw();
            last = end;
            continued = arc;
        };
        this.segments(path, (verb: number, start: Point, points: ReadonlyArray<number>) => {
            if (verb === MOVE) {
                open([points[0], points[1]]);
                return;
            }
            if (current === undefined || current.closed) {
                open(start);
            }
            const subpath: Subpath = current as Subpath;
            subpath.drawn = true;
            if (verb === LINE || verb === CLOSE) {
                const end: Point = [points[0], points[1]];
                const direction: Point | undefined = this.unit(end[0] - start[0], end[1] - start[1]);
                if (direction !== undefined) {
                    const tangent: Tangent = { direction, curvature: 0 };
                    segment(tangent, tangent, () => add(end), false);
                }
                if (verb === CLOSE) {
                    if (first !== undefined && last !== undefined) {
                        subpath.vertices.set(subpath.points.length - 1, { incoming: last, outgoing: first });
                    }
                    subpath.closed = true;
                }
                return;
            }
            const p1: Point = [points[0], points[1]];
            const p2: Point = [points[2], points[3]];
            const p3: Point = [points[4], points[5]];
            const ends: readonly [Tangent, Tangent] | undefined = this.ends(start, p1, p2, p3);
            if (ends !== undefined) {
                segment(ends[0], ends[1], () => this.flatCurve(start, p1, p2, p3, tolerance, homography, add), verb === ARC_PART);
            }
        });
        finish();
        return result.filter((subpath: Subpath) => subpath.drawn);
    }

    private ends(p0: Point, p1: Point, p2: Point, p3: Point): readonly [Tangent, Tangent] | undefined {
        // §4.6.6: the signed curvatures at the ends of a cubic Bézier curve; where a control point is on the end point the
        // curvature is infinite, and "a line should be used in constructing the join".
        const start: Point | undefined = this.unit(p1[0] - p0[0], p1[1] - p0[1]) ?? this.unit(p2[0] - p0[0], p2[1] - p0[1]) ?? this.unit(p3[0] - p0[0], p3[1] - p0[1]);
        const end: Point | undefined = this.unit(p3[0] - p2[0], p3[1] - p2[1]) ?? this.unit(p3[0] - p1[0], p3[1] - p1[1]) ?? this.unit(p3[0] - p0[0], p3[1] - p0[1]);
        if (start === undefined || end === undefined) {
            return undefined;
        }
        const first: number = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const last: number = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const startCurvature: number = first === 0 ? 0 : 2 / 3 * ((p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])) / (first * first * first);
        const endCurvature: number = last === 0 ? 0 : 2 / 3 * ((p3[0] - p2[0]) * (p1[1] - p2[1]) - (p3[1] - p2[1]) * (p1[0] - p2[0])) / (last * last * last);
        return [{ direction: start, curvature: startCurvature }, { direction: end, curvature: endCurvature }];
    }

    private unit(dx: number, dy: number): Point | undefined {
        const length: number = Math.hypot(dx, dy);
        return length === 0 || !Number.isFinite(length) ? undefined : [dx / length, dy / length];
    }

    private positions(subpath: Subpath, stroke: StrokeStyle): Array<readonly [number, number]> {
        // §4.3.3: with a corner length, a dash at each vertex, the first of an open subpath beginning at its start and the last
        // ending at its end, the others centered on the vertex; the dash pattern is repeated separately between them.
        const length: number = subpath.lengths[subpath.lengths.length - 1];
        if (stroke.corner === undefined) {
            return this.pattern(0, length, stroke);
        }
        const corner: number = stroke.corner;
        const corners: ReadonlyArray<number> = subpath.corners;
        const reach: (index: number) => readonly [number, number] = (index: number): readonly [number, number] => {
            if (!subpath.closed && index === 0) {
                return [0, Math.min(corner, length)];
            }
            if (!subpath.closed && index === corners.length - 1) {
                return [Math.max(0, length - corner), length];
            }
            return [corners[index] - corner / 2, corners[index] + corner / 2];
        };
        const result: Array<readonly [number, number]> = [];
        const count: number = subpath.closed ? corners.length - 1 : corners.length;
        for (let index: number = 0; index < count; index++) {
            const [from, to]: readonly [number, number] = reach(index);
            result.push(from < 0 ? [from + length, to + length] : [from, to]);
            const next: number = index + 1 < corners.length ? reach(index + 1)[0] : to;
            if (next > to) {
                result.push(...this.pattern(to, next, stroke));
            }
        }
        return result;
    }

    private pattern(from: number, to: number, stroke: StrokeStyle): Array<readonly [number, number]> {
        // §4.6.3: the dashes from the offset into the pattern on, each cut at the end of the length.
        const length: number = to - from;
        if (length < 0) {
            return [];
        }
        if (stroke.dashes === undefined) {
            return [[from, to]];
        }
        const dashes: ReadonlyArray<number> = this.justified(stroke.dashes[0], length, stroke.justify);
        const count: number = dashes.length;
        const sum: number = dashes.reduce((total: number, dash: number) => total + dash, 0);
        if (sum <= 0) {
            return [[from, to]];
        }
        let offset: number = stroke.dashes[1];
        if (offset < 0) {
            offset = sum - Math.abs(offset);
        }
        offset = ((offset % sum) + sum) % sum;
        let index: number = 0;
        let cumulative: number = dashes[0];
        while (cumulative < offset && index + 1 < count) {
            index++;
            cumulative += dashes[index];
        }
        let dashLength: number = Math.min(cumulative - offset, length);
        const result: Array<readonly [number, number]> = [];
        if (index % 2 === 0) {
            result.push([from, from + dashLength]);
        }
        let position: number = dashLength;
        while (position < length) {
            index = (index + 1) % count;
            dashLength = Math.min(dashes[index], length - position);
            if (index % 2 === 0) {
                result.push([from + position, from + position + dashLength]);
            }
            position += dashLength;
        }
        return result;
    }

    private justified(lengths: ReadonlyArray<number>, target: number, justify?: DashJustify): ReadonlyArray<number> {
        // §4.3.3: the adjusted lengths are scaled by the factor nearest to 1 that fits the pattern a whole number of times,
        // stretched up or compressed down; with neither dashes nor gaps named the gaps are adjusted, as the issue there proposes.
        if (justify === undefined || target <= 0) {
            return lengths;
        }
        const gaps: boolean = justify.gaps || !justify.dashes;
        const adjusted: (index: number) => boolean = (index: number): boolean => index % 2 === 0 ? justify.dashes : gaps;
        let adjustable: number = 0;
        let fixed: number = 0;
        lengths.forEach((length: number, index: number) => {
            if (adjusted(index)) {
                adjustable += length;
            } else {
                fixed += length;
            }
        });
        const sum: number = adjustable + fixed;
        if (adjustable <= 0) {
            return lengths;
        }
        const factor: (repetitions: number) => number = (repetitions: number): number => (target / repetitions - fixed) / adjustable;
        const whole: number = Math.floor(target / sum);
        const stretched: number | undefined = whole >= 1 ? factor(whole) : undefined;
        const compressed: number = Math.max(0, factor(Math.ceil(target / sum)));
        let scale: number;
        if (justify.mode === "stretch") {
            if (stretched === undefined) {
                return lengths;
            }
            scale = stretched;
        } else if (justify.mode === "compress") {
            scale = compressed;
        } else {
            scale = stretched !== undefined && Math.abs(stretched - 1) <= Math.abs(compressed - 1) ? stretched : compressed;
        }
        return lengths.map((length: number, index: number) => adjusted(index) ? length * scale : length);
    }

    private run(subpath: Subpath, start: number, end: number): Run {
        // The points of a subpath from one distance along it to another, the vertices between them, and the direction at the
        // start; a dash of a closed subpath may go on past its end into its start.
        const points: ReadonlyArray<Point> = subpath.points;
        const lengths: ReadonlyArray<number> = subpath.lengths;
        const total: number = lengths[lengths.length - 1];
        const at: (distance: number) => readonly [Point, number] = (distance: number): readonly [Point, number] => {
            let low: number = 0;
            let high: number = Math.max(0, points.length - 2);
            while (low < high) {
                const middle: number = (low + high + 1) >> 1;
                if (lengths[middle] <= distance) {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            if (points.length < 2) {
                return [points[0], 0];
            }
            const ratio: number = Math.max(0, Math.min(1, (distance - lengths[low]) / (lengths[low + 1] - lengths[low])));
            return [[points[low][0] + (points[low + 1][0] - points[low][0]) * ratio, points[low][1] + (points[low + 1][1] - points[low][1]) * ratio], low];
        };
        const [first, segment]: readonly [Point, number] = at(start);
        const run: Run = { points: [first], vertices: [undefined] };
        const direction: Point | undefined = points.length < 2 ? undefined
            : this.unit(points[segment + 1][0] - points[segment][0], points[segment + 1][1] - points[segment][1]);
        if (direction !== undefined) {
            run.direction = direction;
        }
        const wraps: boolean = subpath.closed && end > total;
        let limit: number = Math.min(end, total);
        let index: number = segment + 1;
        for (let pass: number = 0; pass < (wraps ? 2 : 1); pass++) {
            while (index < points.length && lengths[index] < limit) {
                run.points.push(points[index]);
                run.vertices.push(subpath.vertices.get(index));
                index++;
            }
            if (wraps && pass === 0) {
                run.points.push(points[points.length - 1]);
                run.vertices.push(subpath.vertices.get(points.length - 1));
                limit = Math.min(end - total, total);
                index = 1;
            }
        }
        run.points.push(at(limit)[0]);
        run.vertices.push(undefined);
        return run;
    }

    private dash(subpath: Subpath, start: number, end: number, whole: boolean, stroke: StrokeStyle, half: number, piece: (points: ReadonlyArray<Point>) => void,
        tolerance: number, homography: Homography): void {
        // §4.6.2: the band of the stroke along the dash, the joins at the vertices inside it and the caps at its ends; where a
        // curve was flattened, the gap between two pieces on the outer side is filled as the curve would.
        const run: Run = this.run(subpath, start, end);
        const points: Array<Point> = [];
        const vertices: Array<Vertex | undefined> = [];
        run.points.forEach((point: Point, index: number) => {
            const previous: Point | undefined = points[points.length - 1];
            if (previous === undefined || previous[0] !== point[0] || previous[1] !== point[1]) {
                points.push(point);
                vertices.push(run.vertices[index]);
            }
        });
        if (points.length < 2) {
            // §4.6.1: a zero length subpath or dash has the caps of its point, round as a circle and square as a square.
            this.cap(points[0], run.direction ?? [1, 0], half, stroke.cap, piece, tolerance, homography, true);
            return;
        }
        const directions: Array<Point> = [];
        for (let index: number = 0; index + 1 < points.length; index++) {
            const from: Point = points[index];
            const to: Point = points[index + 1];
            const direction: Point = this.unit(to[0] - from[0], to[1] - from[1]) as Point;
            directions.push(direction);
            const nx: number = -direction[1] * half;
            const ny: number = direction[0] * half;
            piece([[from[0] + nx, from[1] + ny], [to[0] + nx, to[1] + ny], [to[0] - nx, to[1] - ny], [from[0] - nx, from[1] - ny]]);
        }
        for (let index: number = 1; index + 1 < points.length; index++) {
            this.corner(points[index], directions[index - 1], directions[index], vertices[index], stroke, half, piece, tolerance, homography);
        }
        if (whole) {
            this.corner(points[0], directions[directions.length - 1], directions[0], subpath.vertices.get(subpath.points.length - 1), stroke, half, piece, tolerance, homography);
            return;
        }
        const last: Point = directions[directions.length - 1];
        this.cap(points[0], [-directions[0][0], -directions[0][1]], half, stroke.cap, piece, tolerance, homography, false);
        this.cap(points[points.length - 1], last, half, stroke.cap, piece, tolerance, homography, false);
    }

    private corner(point: Point, incoming: Point, outgoing: Point, vertex: Vertex | undefined, stroke: StrokeStyle, half: number, piece: (points: ReadonlyArray<Point>) => void,
        tolerance: number, homography: Homography): void {
        // §4.2.2: an inset stroke ignores stroke-linejoin, so its vertices have no join shape at all.
        if (vertex === undefined) {
            this.bevel(point, incoming, outgoing, half, piece);
        } else if (stroke.joins) {
            this.bevel(point, incoming, outgoing, half, piece);
            this.join(point, vertex, stroke, half, piece, tolerance, homography);
        }
    }

    private bevel(point: Point, incoming: Point, outgoing: Point, half: number, piece: (points: ReadonlyArray<Point>) => void): void {
        const cross: number = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
        const dot: number = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
        if (Math.abs(cross) < STRAIGHT && dot > 0) {
            return;
        }
        const side: number = cross > 0 ? -1 : 1;
        piece([point, [point[0] - side * incoming[1] * half, point[1] + side * incoming[0] * half], [point[0] - side * outgoing[1] * half, point[1] + side * outgoing[0] * half]]);
    }

    private join(point: Point, vertex: Vertex, stroke: StrokeStyle, half: number, piece: (points: ReadonlyArray<Point>) => void, tolerance: number, homography: Homography): void {
        // §4.2.4: crop forces the miter limit to 1; past the limit, fallback bevels, bevel cuts the join square at the limit's
        // length, and round adds an arc tangent to the cut edges.
        const a: Point = vertex.incoming.direction;
        const b: Point = vertex.outgoing.direction;
        const cross: number = a[0] * b[1] - a[1] * b[0];
        const dot: number = a[0] * b[0] + a[1] * b[1];
        if (Math.abs(cross) < STRAIGHT && dot > 0) {
            return;
        }
        if (stroke.extension === "crop") {
            if (stroke.shape === "round") {
                piece(this.circle(point, half, tolerance, homography));
            }
            return;
        }
        const side: number = cross > 0 ? -1 : 1;
        const first: Point = [point[0] - side * a[1] * half, point[1] + side * a[0] * half];
        const second: Point = [point[0] - side * b[1] * half, point[1] + side * b[0] * half];
        const bisector: Point = this.unit(first[0] + second[0] - 2 * point[0], first[1] + second[1] - 2 * point[1]) ?? a;
        const region: readonly [Array<Point>, number, Point, Point] | undefined = stroke.extension === "arcs"
            ? this.arcsRegion(point, vertex, first, second, bisector, stroke.limit * half, tolerance) : undefined;
        if (region !== undefined) {
            this.limited(region[0], region[1], region[2], region[3], stroke, half, piece, tolerance, homography);
            return;
        }
        // §4.2.5: the diagonal of a miter is stroke-width / sin(θ / 2) for the angle θ between the segments; half of it lies on
        // each side of the vertex, so the limit is reached at half the width times the limit.
        const sine: number = Math.sqrt(Math.max(0, (1 + dot) / 2));
        const reach: number = sine > 0 ? half / sine : Number.POSITIVE_INFINITY;
        const far: number = Math.min(reach, stroke.limit * half + half);
        const along: (from: Point, direction: Point) => Point = (from: Point, direction: Point): Point => {
            const speed: number = direction[0] * bisector[0] + direction[1] * bisector[1];
            const distance: number = speed > 0 ? (far - ((from[0] - point[0]) * bisector[0] + (from[1] - point[1]) * bisector[1])) / speed : 0;
            return [from[0] + direction[0] * distance, from[1] + direction[1] * distance];
        };
        const polygon: Array<Point> = [point, first, along(first, a), along(second, [-b[0], -b[1]]), second];
        const limit: Point = [point[0] + bisector[0] * stroke.limit * half, point[1] + bisector[1] * stroke.limit * half];
        this.limited(polygon, reach, bisector, limit, stroke, half, piece, tolerance, homography);
    }

    private limited(polygon: Array<Point>, length: number, direction: Point, limit: Point, stroke: StrokeStyle, half: number, piece: (points: ReadonlyArray<Point>) => void,
        tolerance: number, homography: Homography): void {
        // The join region, its length, and the direction of the line that measures it where it reaches the limit.
        if (length <= stroke.limit * half) {
            piece(polygon);
            return;
        }
        if (stroke.shape === "fallback") {
            return;
        }
        const clipped: Array<readonly [Point, boolean]> = this.clip(polygon, limit, direction);
        if (stroke.shape !== "round") {
            piece(clipped.map((entry: readonly [Point, boolean]) => entry[0]));
            return;
        }
        const count: number = clipped.length;
        const cut: number = clipped.findIndex((entry: readonly [Point, boolean], index: number) => entry[1] && clipped[(index + 1) % count][1]);
        if (cut < 0) {
            piece(clipped.map((entry: readonly [Point, boolean]) => entry[0]));
            return;
        }
        const before: Point = clipped[(cut + count - 1) % count][0];
        const start: Point = clipped[cut][0];
        const end: Point = clipped[(cut + 1) % count][0];
        const after: Point = clipped[(cut + 2) % count][0];
        const result: Array<Point> = [];
        for (let index: number = 0; index <= cut; index++) {
            result.push(clipped[index][0]);
        }
        result.push(...this.tipArc(start, this.unit(start[0] - before[0], start[1] - before[1]) ?? direction, end, this.unit(after[0] - end[0], after[1] - end[1]) ?? direction,
            tolerance, homography));
        for (let index: number = cut + 2; index < count; index++) {
            result.push(clipped[index][0]);
        }
        piece(result);
    }

    private arcsRegion(point: Point, vertex: Vertex, first: Point, second: Point, bisector: Point, travel: number,
        tolerance: number): readonly [Array<Point>, number, Point, Point] | undefined {
        // §4.6.6: each outer edge continues along its curvature circle, or tangent, to where the two meet nearest the vertex;
        // §4.2.5: the length is measured along the circle tangent to the bisector through that end, and cut square to it.
        const a: Point = vertex.incoming.direction;
        const b: Point = vertex.outgoing.direction;
        const edgeA: Edge = this.edgeOf(point, first, a, vertex.incoming.curvature);
        const edgeB: Edge = this.edgeOf(point, second, [-b[0], -b[1]], -vertex.outgoing.curvature);
        if (edgeA.center === undefined && edgeB.center === undefined) {
            return undefined;
        }
        let end: Point | undefined;
        let nearest: number = Number.POSITIVE_INFINITY;
        for (const candidate of this.meetings(edgeA, edgeB)) {
            const distance: number = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
            if ((candidate[0] - point[0]) * bisector[0] + (candidate[1] - point[1]) * bisector[1] > 0 && distance < nearest) {
                nearest = distance;
                end = candidate;
            }
        }
        const along: Array<Point> | undefined = end === undefined ? undefined : this.edgePoints(edgeA, end, tolerance);
        const back: Array<Point> | undefined = end === undefined ? undefined : this.edgePoints(edgeB, end, tolerance);
        if (end === undefined || along === undefined || back === undefined) {
            return undefined;
        }
        const polygon: Array<Point> = [point, first, ...along, ...back.reverse().slice(1), second];
        const dx: number = end[0] - point[0];
        const dy: number = end[1] - point[1];
        const normal: Point = [-bisector[1], bisector[0]];
        const across: number = dx * normal[0] + dy * normal[1];
        const chord: number = Math.hypot(dx, dy);
        if (Math.abs(across) < STRAIGHT * Math.max(1, chord)) {
            return [polygon, chord, bisector, [point[0] + bisector[0] * travel, point[1] + bisector[1] * travel]];
        }
        // Turning by a positive angle takes the bisector towards its left normal, where the measuring circle's center is when
        // the end lies on that side.
        const turn: number = across > 0 ? 1 : -1;
        const radius: number = chord * chord / (2 * Math.abs(across));
        const center: Point = [point[0] + normal[0] * turn * radius, point[1] + normal[1] * turn * radius];
        const length: number = radius * 2 * Math.asin(Math.min(1, chord / (2 * radius)));
        const cosine: number = Math.cos(travel / radius * turn);
        const sine: number = Math.sin(travel / radius * turn);
        const fromCenter: Point = [point[0] - center[0], point[1] - center[1]];
        const at: Point = [center[0] + fromCenter[0] * cosine - fromCenter[1] * sine, center[1] + fromCenter[0] * sine + fromCenter[1] * cosine];
        const direction: Point = [bisector[0] * cosine - bisector[1] * sine, bisector[0] * sine + bisector[1] * cosine];
        return [polygon, length, direction, at];
    }

    private edgeOf(point: Point, start: Point, direction: Point, curvature: number): Edge {
        // The circle that the edge follows has the center of the path's osculating circle, on the left of the direction for a
        // positive curvature.
        if (curvature === 0 || !Number.isFinite(curvature)) {
            return { point: start, direction, radius: 0 };
        }
        const center: Point = [point[0] - direction[1] / curvature, point[1] + direction[0] / curvature];
        return { point: start, direction, center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]) };
    }

    private meetings(first: Edge, second: Edge): Array<Point> {
        if (first.center === undefined) {
            return this.lineCircle(first, second);
        }
        if (second.center === undefined) {
            return this.lineCircle(second, first);
        }
        const [ax, ay]: Point = first.center;
        const [bx, by]: Point = second.center;
        const distance: number = Math.hypot(bx - ax, by - ay);
        if (distance === 0 || distance > first.radius + second.radius || distance < Math.abs(first.radius - second.radius)) {
            return [];
        }
        const along: number = (first.radius * first.radius - second.radius * second.radius + distance * distance) / (2 * distance);
        const height: number = Math.sqrt(Math.max(0, first.radius * first.radius - along * along));
        const mx: number = ax + (bx - ax) * along / distance;
        const my: number = ay + (by - ay) * along / distance;
        return [[mx + (by - ay) * height / distance, my - (bx - ax) * height / distance], [mx - (by - ay) * height / distance, my + (bx - ax) * height / distance]];
    }

    private lineCircle(line: Edge, circle: Edge): Array<Point> {
        const center: Point = circle.center as Point;
        const fx: number = line.point[0] - center[0];
        const fy: number = line.point[1] - center[1];
        const projection: number = fx * line.direction[0] + fy * line.direction[1];
        const discriminant: number = projection * projection - (fx * fx + fy * fy - circle.radius * circle.radius);
        if (discriminant < 0) {
            return [];
        }
        const root: number = Math.sqrt(discriminant);
        return [-projection - root, -projection + root].filter((t: number) => t >= 0)
            .map((t: number): Point => [line.point[0] + line.direction[0] * t, line.point[1] + line.direction[1] * t]);
    }

    private edgePoints(edge: Edge, end: Point, tolerance: number): Array<Point> | undefined {
        // The points of an edge from its start, going on in its direction, to the end; the start itself is left out. An end
        // that the edge reaches only by going more than half way round its circle is not the meeting of the extended edges.
        if (edge.center === undefined) {
            return [end];
        }
        const center: Point = edge.center;
        const radius: number = edge.radius;
        const from: number = Math.atan2(edge.point[1] - center[1], edge.point[0] - center[0]);
        const turn: number = (edge.point[0] - center[0]) * edge.direction[1] - (edge.point[1] - center[1]) * edge.direction[0] > 0 ? 1 : -1;
        let sweep: number = (Math.atan2(end[1] - center[1], end[0] - center[0]) - from) * turn;
        sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (sweep > Math.PI) {
            return undefined;
        }
        const step: number = radius > tolerance ? 2 * Math.acos(Math.max(-1, 1 - tolerance / radius)) : Math.PI / 2;
        const count: number = Math.max(1, Math.ceil(sweep / step));
        const points: Array<Point> = [];
        for (let index: number = 1; index < count; index++) {
            const angle: number = from + turn * sweep * index / count;
            points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
        }
        points.push(end);
        return points;
    }

    private clip(polygon: ReadonlyArray<Point>, limit: Point, direction: Point): Array<readonly [Point, boolean]> {
        // The part of the polygon on the vertex's side of the line through the limit square to the direction; the points made
        // on that line are marked.
        const result: Array<readonly [Point, boolean]> = [];
        const side: (point: Point) => number = (point: Point): number => (point[0] - limit[0]) * direction[0] + (point[1] - limit[1]) * direction[1];
        polygon.forEach((point: Point, index: number) => {
            const next: Point = polygon[(index + 1) % polygon.length];
            const here: number = side(point);
            const there: number = side(next);
            if (here <= 0) {
                result.push([point, false]);
            }
            if ((here <= 0) !== (there <= 0)) {
                const t: number = here / (here - there);
                result.push([[point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t], true]);
            }
        });
        return result;
    }

    private tipArc(start: Point, leaving: Point, end: Point, arriving: Point, tolerance: number, homography: Homography): Array<Point> {
        // A circular arc that leaves the start along one edge and reaches the end along the other, as a cubic Bézier curve
        // with its control points at 4/3 tan(φ / 4) of the radius for the turn φ; the start itself is left out.
        const points: Array<Point> = [];
        const turn: number = Math.acos(Math.max(-1, Math.min(1, leaving[0] * arriving[0] + leaving[1] * arriving[1])));
        const chord: number = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (turn < STRAIGHT || chord === 0) {
            return [end];
        }
        const radius: number = chord / (2 * Math.sin(turn / 2));
        const handle: number = 4 / 3 * Math.tan(turn / 4) * radius;
        this.flatCurve(start, [start[0] + leaving[0] * handle, start[1] + leaving[1] * handle], [end[0] - arriving[0] * handle, end[1] - arriving[1] * handle], end,
            tolerance, homography, (point: Point) => points.push(point));
        return points;
    }

    private cap(point: Point, outward: Point, half: number, cap: string, piece: (points: ReadonlyArray<Point>) => void, tolerance: number, homography: Homography,
        both: boolean): void {
        // §4.6.4: a round cap is a half disc and a square one reaches half the width past the end; the other half of the disc
        // lies on the stroke. A point alone has both caps, a whole disc or a square centered on it.
        if (cap === "round") {
            piece(this.circle(point, half, tolerance, homography));
        } else if (cap === "square") {
            const nx: number = -outward[1] * half;
            const ny: number = outward[0] * half;
            const back: Point = both ? [point[0] - outward[0] * half, point[1] - outward[1] * half] : point;
            const end: Point = [point[0] + outward[0] * half, point[1] + outward[1] * half];
            piece([[back[0] + nx, back[1] + ny], [end[0] + nx, end[1] + ny], [end[0] - nx, end[1] - ny], [back[0] - nx, back[1] - ny]]);
        }
    }

    private offset(points: ReadonlyArray<Point>, distance: number): Array<Point> {
        // Each point moves along the normal halfway between its two pieces, as far as keeps the moved pieces at the distance.
        const result: Array<Point> = [];
        for (let index: number = 0; index < points.length; index++) {
            const point: Point = points[index];
            const before: Point | undefined = index > 0 ? this.unit(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) : undefined;
            const after: Point | undefined = index + 1 < points.length ? this.unit(points[index + 1][0] - point[0], points[index + 1][1] - point[1]) : undefined;
            const a: Point = (before ?? after) as Point;
            const b: Point = (after ?? before) as Point;
            const normal: Point = this.unit(-(a[1] + b[1]), a[0] + b[0]) ?? [-a[1], a[0]];
            const cosine: number = normal[0] * -a[1] + normal[1] * a[0];
            const scale: number = cosine > 0 ? distance / cosine : distance;
            result.push([point[0] + normal[0] * scale, point[1] + normal[1] * scale]);
        }
        return result;
    }

    private untangled(points: ReadonlyArray<Point>, half: number): Array<Point> {
        // A loop of an offset is cut out where its two ends cross; it is no longer than a turn round a circle of the distance.
        const result: Array<Point> = [];
        const reach: number = 2 * Math.PI * half;
        let index: number = 0;
        while (index < points.length) {
            result.push(points[index]);
            let crossing: readonly [number, Point] | undefined;
            let travelled: number = 0;
            for (let other: number = index + 2; other + 1 < points.length && travelled <= reach; other++) {
                travelled += Math.hypot(points[other][0] - points[other - 1][0], points[other][1] - points[other - 1][1]);
                const hit: Point | undefined = index + 1 < points.length ? this.crossing(points[index], points[index + 1], points[other], points[other + 1]) : undefined;
                if (hit !== undefined) {
                    crossing = [other, hit];
                }
            }
            if (crossing === undefined) {
                index++;
            } else {
                result.push(crossing[1]);
                index = crossing[0] + 1;
            }
        }
        return result;
    }

    private crossing(a: Point, b: Point, c: Point, d: Point): Point | undefined {
        const rx: number = b[0] - a[0];
        const ry: number = b[1] - a[1];
        const sx: number = d[0] - c[0];
        const sy: number = d[1] - c[1];
        const denominator: number = rx * sy - ry * sx;
        if (denominator === 0) {
            return undefined;
        }
        const t: number = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
        const u: number = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
        return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + rx * t, a[1] + ry * t] : undefined;
    }
}
