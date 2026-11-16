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

import type { PathData, Point } from "./PathGeometry.js";
import { PathGeometry } from "./PathGeometry.js";

export interface ShadowMask {
    left: number;
    top: number;
    width: number;
    height: number;
    scale: number;
    pixels: Buffer;
}

const SAMPLES: number = 4;
const FLATNESS: number = 0.05;
const MAXIMUM_PIXELS: number = 4000000;
const KERNEL_RADII: number = 3;

export class ShadowRaster extends PathGeometry {

    mask(shapes: ReadonlyArray<PathData>, spread: number, deviation: number, scale: number, extent: readonly [number, number, number, number], inverted: boolean,
        eroded: boolean): ShadowMask | undefined {
        // CSS Backgrounds 3 §7.2: the blur is a Gaussian with a deviation of half the radius; Text Decoration 4 §4: the spread is an
        // outset distance from the outline, so a band around it. An inner shadow is what the eroded shape leaves of the area.
        const shape: Array<Array<Point>> = [];
        const band: Array<Array<Point>> = [];
        for (const path of shapes) {
            for (const [points] of this.flattened(path, FLATNESS / scale, PathGeometry.IDENTITY3)) {
                shape.push(points);
            }
            if (spread > 0) {
                const outline: PathData = this.strokeOutline(path, { width: 2 * spread, cap: "round", extension: "crop", shape: "round", limit: 4 }, FLATNESS, PathGeometry.IDENTITY3);
                for (const [points] of this.flattened(outline, FLATNESS / scale, PathGeometry.IDENTITY3)) {
                    band.push(points);
                }
            }
        }
        if (shape.length === 0) {
            return undefined;
        }
        let left: number = extent[0];
        let top: number = extent[1];
        let right: number = extent[0] + extent[2];
        let bottom: number = extent[1] + extent[3];
        for (const points of [...shape, ...band]) {
            for (const point of points) {
                left = Math.min(left, point[0]);
                right = Math.max(right, point[0]);
                top = Math.min(top, point[1]);
                bottom = Math.max(bottom, point[1]);
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
        const covered: Float32Array = this.coverage(shape, left, top, factor, width, height);
        if (spread > 0) {
            const outer: Float32Array = this.coverage(band, left, top, factor, width, height);
            for (let index: number = 0; index < covered.length; index++) {
                covered[index] = eroded ? Math.max(0, covered[index] - outer[index]) : Math.max(covered[index], outer[index]);
            }
        }
        const blurred: Float32Array = this.blur(covered, width, height, deviation * factor);
        const pixels: Buffer = Buffer.alloc(width * height);
        for (let index: number = 0; index < blurred.length; index++) {
            const value: number = inverted ? 1 - blurred[index] : blurred[index];
            pixels[index] = Math.round(255 * Math.min(1, Math.max(0, value)));
        }
        return { left, top, width, height, scale: factor, pixels };
    }

    private coverage(polygons: ReadonlyArray<ReadonlyArray<Point>>, left: number, top: number, scale: number, width: number, height: number): Float32Array {
        // Each pixel row is sampled by SAMPLES scanlines, and on each the parts inside the shape, by the nonzero rule, add their
        // length within each pixel.
        const grid: Float32Array = new Float32Array(width * height);
        const edges: Array<readonly [number, number, number, number, number]> = [];
        for (const points of polygons) {
            for (let index: number = 0; index < points.length; index++) {
                const from: Point = points[index];
                const to: Point = points[(index + 1) % points.length];
                if (from[1] !== to[1]) {
                    edges.push(from[1] < to[1] ? [from[0], from[1], to[0], to[1], 1] : [to[0], to[1], from[0], from[1], -1]);
                }
            }
        }
        edges.sort((first: readonly [number, number, number, number, number], second: readonly [number, number, number, number, number]) => first[1] - second[1]);
        let next: number = 0;
        let active: Array<readonly [number, number, number, number, number]> = [];
        for (let line: number = 0; line < height * SAMPLES; line++) {
            const y: number = top + (line + 0.5) / (SAMPLES * scale);
            while (next < edges.length && edges[next][1] <= y) {
                active.push(edges[next++]);
            }
            active = active.filter((edge: readonly [number, number, number, number, number]) => edge[3] > y);
            const crossings: Array<readonly [number, number]> = active.map((edge: readonly [number, number, number, number, number]): readonly [number, number] => [
                edge[0] + (y - edge[1]) * (edge[2] - edge[0]) / (edge[3] - edge[1]), edge[4]
            ]);
            crossings.sort((first: readonly [number, number], second: readonly [number, number]) => first[0] - second[0]);
            let winding: number = 0;
            const row: number = Math.floor(line / SAMPLES) * width;
            for (let index: number = 0; index + 1 < crossings.length; index++) {
                winding += crossings[index][1];
                if (winding !== 0) {
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
