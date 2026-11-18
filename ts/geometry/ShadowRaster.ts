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

import type { PathData, Point, StrokeStyle } from "./PathGeometry.js";
import { PathGeometry } from "./PathGeometry.js";

export interface ShadowMask {
    left: number;
    top: number;
    width: number;
    height: number;
    scale: number;
    pixels: Buffer;
}

type Edge = readonly [number, number, number, number, number, number];

const SAMPLES: number = 4;
const FLATNESS: number = 0.05;
const MAXIMUM_PIXELS: number = 4000000;
const KERNEL_RADII: number = 3;

export class ShadowRaster extends PathGeometry {

    mask(shapes: ReadonlyArray<PathData>, spread: number, deviation: number, scale: number, extent: readonly [number, number, number, number], inverted: boolean,
        eroded: boolean): ShadowMask | undefined {
        // CSS Backgrounds 3 §7.2: the blur is a Gaussian with a deviation of half the radius; Text Decoration 4 §4: the spread is an
        // outset distance from the outline, so a band around it. An inner shadow is what the eroded shape leaves of the area.
        const tolerance: number = FLATNESS / scale;
        const stroke: StrokeStyle = { width: 2 * spread, cap: "round", extension: "crop", shape: "round", limit: 4 };
        const shape: Array<Array<Array<Point>>> = [];
        const band: Array<Array<Array<Point>>> = [];
        for (const path of shapes) {
            const polygons: Array<Array<Point>> = this.polygons(path, tolerance);
            if (polygons.length === 0) {
                continue;
            }
            shape.push(polygons);
            if (spread > 0 && !eroded) {
                // The outset of a union is the union of the outsets, so each shape adds the band around its own outline.
                band.push(this.polygons(this.strokeOutline(path, stroke, FLATNESS, PathGeometry.IDENTITY3), tolerance));
            }
        }
        if (shape.length === 0) {
            return undefined;
        }
        if (spread > 0 && eroded) {
            // Text Decoration 4 §4: an inner shadow is cast by the canvas, so the spread goes from the outline of the shapes composited
            // together, of which the edges that one shape has inside another are no part.
            band.push(this.polygons(this.strokeOutline(this.unionOutline(shapes, tolerance), stroke, FLATNESS, PathGeometry.IDENTITY3), tolerance));
        }
        let left: number = extent[0];
        let top: number = extent[1];
        let right: number = extent[0] + extent[2];
        let bottom: number = extent[1] + extent[3];
        for (const polygons of [...shape, ...band]) {
            for (const points of polygons) {
                for (const point of points) {
                    left = Math.min(left, point[0]);
                    right = Math.max(right, point[0]);
                    top = Math.min(top, point[1]);
                    bottom = Math.max(bottom, point[1]);
                }
            }
        }
        const margin: number = KERNEL_RADII * deviation + 1;
        left -= margin;
        top -= margin;
        right += margin;
        bottom += margin;
        const factor: number = Math.min(scale, Math.sqrt(MAXIMUM_PIXELS / Math.max(1, (right - left) * (bottom - top))));
        const width: number = Math.max(1, Math.ceil((right - left) * factor));
        const height: number = Math.max(1, Math.ceil((bottom - top) * factor));
        const covered: Float32Array = this.coverage([...shape, ...band], shape.length, eroded, left, top, factor, width, height);
        const blurred: Float32Array = this.blur(covered, width, height, deviation * factor);
        const pixels: Buffer = Buffer.alloc(width * height);
        for (let index: number = 0; index < blurred.length; index++) {
            const value: number = inverted ? 1 - blurred[index] : blurred[index];
            pixels[index] = Math.round(255 * Math.min(1, Math.max(0, value)));
        }
        return { left, top, width, height, scale: factor, pixels };
    }

    private polygons(path: PathData, tolerance: number): Array<Array<Point>> {
        return this.flattened(path, tolerance, PathGeometry.IDENTITY3).map(([points]: readonly [Array<Point>, boolean]) => points);
    }

    private unionOutline(shapes: ReadonlyArray<PathData>, tolerance: number): PathData {
        // Each shape as the contours of its own nonzero area, turned so that its area winds positively: the windings of the shapes
        // then add up, and the nonzero area of them all is their union.
        const union: PathData = { verbs: [], points: [] };
        for (const path of shapes) {
            const contours: Array<Array<Point>> = this.polygons(this.outlineOf(path, tolerance, tolerance), tolerance);
            const area: number = contours.reduce((total: number, points: Array<Point>) => total + this.area(points), 0);
            for (const points of contours) {
                (area < 0 ? [...points].reverse() : points).forEach((point: Point, index: number) => {
                    union.verbs.push(index === 0 ? PathGeometry.MOVE : PathGeometry.LINE);
                    union.points.push(point[0], point[1]);
                });
                union.verbs.push(PathGeometry.CLOSE);
            }
        }
        return this.outlineOf(union, tolerance, tolerance);
    }

    private coverage(groups: ReadonlyArray<ReadonlyArray<ReadonlyArray<Point>>>, cut: number, eroded: boolean, left: number, top: number, scale: number, width: number,
        height: number): Float32Array {
        // Each pixel row is sampled by SAMPLES scanlines. Each group is one path, inside by the nonzero rule with its own winding,
        // so that paths wound in opposite senses add up; the groups from cut on are the band, which an eroded shape loses.
        const grid: Float32Array = new Float32Array(width * height);
        const edges: Array<Edge> = [];
        groups.forEach((polygons: ReadonlyArray<ReadonlyArray<Point>>, group: number) => {
            for (const points of polygons) {
                for (let index: number = 0; index < points.length; index++) {
                    const from: Point = points[index];
                    const to: Point = points[(index + 1) % points.length];
                    if (from[1] !== to[1]) {
                        edges.push(from[1] < to[1] ? [from[0], from[1], to[0], to[1], 1, group] : [to[0], to[1], from[0], from[1], -1, group]);
                    }
                }
            }
        });
        edges.sort((first: Edge, second: Edge) => first[1] - second[1]);
        const windings: Int32Array = new Int32Array(groups.length);
        let next: number = 0;
        let active: Array<Edge> = [];
        for (let line: number = 0; line < height * SAMPLES; line++) {
            const y: number = top + (line + 0.5) / (SAMPLES * scale);
            while (next < edges.length && edges[next][1] <= y) {
                active.push(edges[next++]);
            }
            active = active.filter((edge: Edge) => edge[3] > y);
            const crossings: Array<readonly [number, number, number]> = active.map((edge: Edge): readonly [number, number, number] => [
                edge[0] + (y - edge[1]) * (edge[2] - edge[0]) / (edge[3] - edge[1]), edge[4], edge[5]
            ]);
            crossings.sort((first: readonly [number, number, number], second: readonly [number, number, number]) => first[0] - second[0]);
            let inShape: number = 0;
            let inBand: number = 0;
            const row: number = Math.floor(line / SAMPLES) * width;
            for (let index: number = 0; index < crossings.length; index++) {
                const group: number = crossings[index][2];
                const before: number = windings[group];
                windings[group] += crossings[index][1];
                if ((before === 0) !== (windings[group] === 0)) {
                    const change: number = before === 0 ? 1 : -1;
                    if (group < cut) {
                        inShape += change;
                    } else {
                        inBand += change;
                    }
                }
                const inside: boolean = eroded ? inShape > 0 && inBand === 0 : inShape > 0 || inBand > 0;
                if (inside && index + 1 < crossings.length) {
                    this.span(grid, row, width, (crossings[index][0] - left) * scale, (crossings[index + 1][0] - left) * scale);
                }
            }
        }
        for (let index: number = 0; index < grid.length; index++) {
            grid[index] = Math.min(1, grid[index] / SAMPLES);
        }
        return grid;
    }

    private span(grid: Float32Array, row: number, width: number, from: number, to: number): void {
        const first: number = Math.max(0, Math.floor(from));
        const last: number = Math.min(width - 1, Math.floor(to));
        for (let pixel: number = first; pixel <= last; pixel++) {
            grid[row + pixel] += Math.min(to, pixel + 1) - Math.max(from, pixel);
        }
    }

    private blur(grid: Float32Array, width: number, height: number, deviation: number): Float32Array {
        if (deviation < 0.3) {
            return grid;
        }
        const radius: number = Math.ceil(KERNEL_RADII * deviation);
        const kernel: Float32Array = new Float32Array(2 * radius + 1);
        let total: number = 0;
        for (let index: number = -radius; index <= radius; index++) {
            kernel[index + radius] = Math.exp(-index * index / (2 * deviation * deviation));
            total += kernel[index + radius];
        }
        for (let index: number = 0; index < kernel.length; index++) {
            kernel[index] /= total;
        }
        const across: Float32Array = new Float32Array(grid.length);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                let sum: number = 0;
                for (let offset: number = -radius; offset <= radius; offset++) {
                    const at: number = x + offset;
                    sum += at < 0 || at >= width ? 0 : grid[y * width + at] * kernel[offset + radius];
                }
                across[y * width + x] = sum;
            }
        }
        const result: Float32Array = new Float32Array(grid.length);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                let sum: number = 0;
                for (let offset: number = -radius; offset <= radius; offset++) {
                    const at: number = y + offset;
                    sum += at < 0 || at >= height ? 0 : across[at * width + x] * kernel[offset + radius];
                }
                result[y * width + x] = sum;
            }
        }
        return result;
    }
}
