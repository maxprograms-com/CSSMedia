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
import type { Homography, PathData } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { RelativeUnits } from "../pdf/LengthResolver.js";
import { LengthResolver } from "../pdf/LengthResolver.js";
import type { ContentStream } from "../writer/ContentStream.js";

export type { Homography };

export type Matrix = readonly [number, number, number, number, number, number];

export type Box = readonly [number, number, number, number];

export type Matrix4 = ReadonlyArray<number>;

export type Facet = readonly [number, ReadonlyArray<readonly [number, number, number]>];

export type SvgPath = PathData;

const MOVE: number = PathGeometry.MOVE;
const LINE: number = PathGeometry.LINE;
const CURVE: number = PathGeometry.CURVE;
const CLOSE: number = PathGeometry.CLOSE;
const ARC_PART: number = PathGeometry.ARC_PART;
const WHITE_SPACE: string = "\t\n\f\r ";
const COMMANDS: string = "MmZzLlHhVvCcSsQqTtAa";
const PARAMETERS: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
const ALIGNMENTS: ReadonlySet<string> = new Set<string>(["none", "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax", "xMidYMax", "xMaxYMax"]);
const NO_UNITS: RelativeUnits = { size: (): number | undefined => undefined };
const DEGREES: Readonly<Record<string, number>> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const EPSILON: number = 1e-12;
const W_LIMIT: number = PathGeometry.W_LIMIT;

export class SvgGeometry extends PathGeometry {

    static readonly IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
    static readonly IDENTITY4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    private readonly lengths: LengthResolver = new LengthResolver();
    private text: string = "";
    private index: number = 0;

    concat(outer: Matrix, inner: Matrix): Matrix {
        // The matrix that applies inner first and outer after, as cm does with the current matrix.
        return [
            inner[0] * outer[0] + inner[1] * outer[2], inner[0] * outer[1] + inner[1] * outer[3],
            inner[2] * outer[0] + inner[3] * outer[2], inner[2] * outer[1] + inner[3] * outer[3],
            inner[4] * outer[0] + inner[5] * outer[2] + outer[4], inner[4] * outer[1] + inner[5] * outer[3] + outer[5]
        ];
    }

    point(matrix: Matrix, x: number, y: number): readonly [number, number] {
        return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
    }

    invert(matrix: Matrix): Matrix | undefined {
        const determinant: number = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        if (determinant === 0 || !Number.isFinite(determinant)) {
            return undefined;
        }
        return [
            matrix[3] / determinant, -matrix[1] / determinant, -matrix[2] / determinant, matrix[0] / determinant,
            (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant, (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant
        ];
    }

    translation(x: number, y: number): Matrix {
        return [1, 0, 0, 1, x, y];
    }

    rotation(degrees: number): Matrix {
        const radians: number = degrees * Math.PI / 180;
        return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
    }

    transformBox(matrix: Matrix, box: Box): Box {
        const xs: Array<number> = [];
        const ys: Array<number> = [];
        for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
            const point: readonly [number, number] = this.point(matrix, x, y);
            xs.push(point[0]);
            ys.push(point[1]);
        }
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    }

    union(first: Box | undefined, second: Box | undefined): Box | undefined {
        if (first === undefined || second === undefined) {
            return first ?? second;
        }
        const left: number = Math.min(first[0], second[0]);
        const top: number = Math.min(first[1], second[1]);
        return [left, top, Math.max(first[0] + first[2], second[0] + second[2]) - left, Math.max(first[1] + first[3], second[1] + second[3]) - top];
    }

    viewBox(text: string | undefined): Box | undefined {
        // SVG 2 §8.6: a negative width or height makes the attribute invalid.
        const values: Array<number> = text === undefined ? [] : this.numbers(text);
        if (values.length !== 4 || this.index < this.text.length || values[2] < 0 || values[3] < 0) {
            return undefined;
        }
        return [values[0], values[1], values[2], values[3]];
    }

    fit(viewBox: Box, aspect: string | undefined, x: number, y: number, width: number, height: number): Matrix {
        // SVG 2 §8.2 and §8.7: an invalid preserveAspectRatio is xMidYMid meet.
        const parts: Array<string> = (aspect ?? "").trim().split(/[\t\n\f\r ]+/);
        const valid: boolean = parts.length <= 2 && ALIGNMENTS.has(parts[0]) && (parts.length === 1 || parts[1] === "meet" || parts[1] === "slice");
        const align: string = valid ? parts[0] : "xMidYMid";
        let scaleX: number = width / viewBox[2];
        let scaleY: number = height / viewBox[3];
        if (align !== "none") {
            const scale: number = valid && parts[1] === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
            scaleX = scale;
            scaleY = scale;
        }
        let translateX: number = x - viewBox[0] * scaleX;
        let translateY: number = y - viewBox[1] * scaleY;
        if (align.includes("xMid")) {
            translateX += (width - viewBox[2] * scaleX) / 2;
        } else if (align.includes("xMax")) {
            translateX += width - viewBox[2] * scaleX;
        }
        if (align.includes("YMid")) {
            translateY += (height - viewBox[3] * scaleY) / 2;
        } else if (align.includes("YMax")) {
            translateY += height - viewBox[3] * scaleY;
        }
        return [scaleX, 0, 0, scaleY, translateX, translateY];
    }

    numbers(text: string): Array<number> {
        // The numbers of a list separated by white space or a comma, up to the first that does not parse.
        this.text = text;
        this.index = 0;
        const values: Array<number> = [];
        this.skipWhiteSpace();
        for (let value: number | undefined = this.number(); value !== undefined; value = this.number()) {
            values.push(value);
            const before: number = this.index;
            this.skipSeparator();
            if (!this.startsNumber()) {
                this.index = before;
                this.skipWhiteSpace();
                break;
            }
        }
        return values;
    }

    points(text: string, closed: boolean): SvgPath | undefined {
        // SVG 2 §10.6 and §10.7: the last coordinate is dropped when it is odd.
        const values: Array<number> = this.numbers(text);
        if (values.length < 2) {
            return undefined;
        }
        let data: string = "M" + values[0] + " " + values[1];
        for (let index: number = 2; index + 1 < values.length; index += 2) {
            data += "L" + values[index] + " " + values[index + 1];
        }
        return this.parse(closed ? data + "Z" : data);
    }

    rectangle(x: number, y: number, width: number, height: number, rx: number, ry: number): SvgPath {
        // SVG 2 §10.2: the equivalent path of a rect.
        const arc: (toX: number, toY: number) => string = (toX: number, toY: number): string => rx > 0 && ry > 0 ? "A" + rx + " " + ry + " 0 0 1 " + toX + " " + toY : "";
        return this.parse("M" + (x + rx) + " " + y + "H" + (x + width - rx) + arc(x + width, y + ry) + "V" + (y + height - ry) + arc(x + width - rx, y + height)
            + "H" + (x + rx) + arc(x, y + height - ry) + "V" + (y + ry) + arc(x + rx, y) + "Z");
    }

    ellipse(cx: number, cy: number, rx: number, ry: number): SvgPath {
        // SVG 2 §10.3 and §10.4: four quarter arcs clockwise from three o'clock.
        const arc: string = "A" + rx + " " + ry + " 0 0 1 ";
        return this.parse("M" + (cx + rx) + " " + cy + arc + cx + " " + (cy + ry) + arc + (cx - rx) + " " + cy + arc + cx + " " + (cy - ry) + arc + (cx + rx) + " " + cy + "Z");
    }

    basicShape(value: CssValue, box: Box, rtl: boolean): readonly [SvgPath, boolean] | undefined {
        // CSS Shapes 1 §3.1: each shape in the coordinate system of the reference box, with its origin at the box's top
        // left corner and percentages of the box's size; the path is returned in the coordinates of the box's space.
        if (value.kind !== "function") {
            return undefined;
        }
        const args: ReadonlyArray<CssValue> = value.args;
        const width: number = box[2];
        const height: number = box[3];
        let data: string | undefined;
        let evenodd: boolean = false;
        switch (value.name.toLowerCase()) {
            case "circle":
            case "ellipse": {
                const tokens: ReadonlyArray<CssValue> = this.tokens(args[0]);
                const at: number = tokens.findIndex((token: CssValue) => this.isKeyword(token, "at"));
                const center: readonly [number, number] = at < 0 ? [width / 2, height / 2] : this.position(tokens.slice(at + 1), width, height, rtl);
                const size: ReadonlyArray<CssValue> = at < 0 ? tokens : tokens.slice(0, at);
                const [rx, ry]: readonly [number, number] = this.radii(size, center, width, height, value.name.toLowerCase() === "circle");
                data = rx > 0 && ry > 0 ? this.ellipsePath(center[0], center[1], rx, ry) : undefined;
                break;
            }
            case "inset":
            case "xywh":
            case "rect": {
                const tokens: ReadonlyArray<CssValue> = this.tokens(args[0]);
                const round: number = tokens.findIndex((token: CssValue) => this.isKeyword(token, "round"));
                const edges: ReadonlyArray<CssValue> = round < 0 ? tokens : tokens.slice(0, round);
                const rectangle: Box = this.basicRectangle(value.name.toLowerCase(), edges, width, height);
                data = this.roundedRectangle(rectangle, round < 0 ? [] : tokens.slice(round + 1), width, height);
                break;
            }
            case "polygon": {
                const header: ReadonlyArray<CssValue> = this.tokens(args[0]);
                const hasHeader: boolean = header.some((token: CssValue) => token.kind === "ident");
                evenodd = header.some((token: CssValue) => this.isKeyword(token, "evenodd"));
                const round: number = header.findIndex((token: CssValue) => this.isKeyword(token, "round"));
                const radius: number = hasHeader && round >= 0 ? Math.max(0, this.pixels(header[round + 1], 0)) : 0;
                const points: Array<readonly [number, number]> = (hasHeader ? args.slice(1) : args).map((pair: CssValue): readonly [number, number] => {
                    const coordinates: ReadonlyArray<CssValue> = this.tokens(pair);
                    return [this.pixels(coordinates[0], width), this.pixels(coordinates[1], height)];
                });
                data = points.length < 3 ? undefined : this.roundedPolygon(points, radius);
                break;
            }
            case "path": {
                const text: CssValue | undefined = args[args.length - 1];
                evenodd = args.length > 1 && this.isKeyword(args[0], "evenodd");
                if (text === undefined || text.kind !== "string") {
                    return undefined;
                }
                const parsed: SvgPath = this.parse(text.value);
                return parsed.verbs.length === 0 ? undefined : [this.transformPath(parsed, this.translation(box[0], box[1])), evenodd];
            }
            case "shape": {
                const header: ReadonlyArray<CssValue> = this.tokens(args[0]);
                evenodd = this.isKeyword(header[0], "evenodd");
                data = this.shapeCommands(header, args.slice(1), width, height, rtl);
                break;
            }
            default:
                return undefined;
        }
        if (data === undefined) {
            return undefined;
        }
        const parsed: SvgPath = this.parse(data);
        return parsed.verbs.length === 0 ? undefined : [this.transformPath(parsed, this.translation(box[0], box[1])), evenodd];
    }

    private tokens(value: CssValue | undefined): ReadonlyArray<CssValue> {
        if (value === undefined) {
            return [];
        }
        return value.kind === "list" && value.separator === "space" ? value.items : [value];
    }

    private isKeyword(value: CssValue | undefined, keyword: string): boolean {
        return value !== undefined && value.kind === "ident" && value.lower === keyword;
    }

    private radii(size: ReadonlyArray<CssValue>, center: readonly [number, number], width: number, height: number, circle: boolean): readonly [number, number] {
        // CSS Images 4 §3.2.2: extents measure to the box's sides or corners, an ellipse to a corner keeping the aspect of
        // the side keyword; a circle's percentage refers to the normalized diagonal.
        const sides: ReadonlyArray<number> = [center[0], width - center[0], center[1], height - center[1]].map(Math.abs);
        const closest: readonly [number, number] = [Math.min(sides[0], sides[1]), Math.min(sides[2], sides[3])];
        const farthest: readonly [number, number] = [Math.max(sides[0], sides[1]), Math.max(sides[2], sides[3])];
        const extent: string = size.length === 0 ? "closest-side" : (size[0].kind === "ident" ? size[0].lower : "");
        if (extent.length > 0) {
            if (circle) {
                switch (extent) {
                    case "farthest-side":
                        return [Math.max(...sides), Math.max(...sides)];
                    case "closest-corner":
                        return [Math.hypot(closest[0], closest[1]), Math.hypot(closest[0], closest[1])];
                    case "farthest-corner":
                        return [Math.hypot(farthest[0], farthest[1]), Math.hypot(farthest[0], farthest[1])];
                    default:
                        return [Math.min(...sides), Math.min(...sides)];
                }
            }
            // CSS Images 4 §3.2.2: two keywords give the horizontal and the vertical radius.
            const axis: (keyword: string, index: number) => number = (keyword: string, index: number): number => {
                switch (keyword) {
                    case "farthest-side":
                        return farthest[index];
                    case "closest-corner":
                        return closest[index] * Math.SQRT2;
                    case "farthest-corner":
                        return farthest[index] * Math.SQRT2;
                    default:
                        return closest[index];
                }
            };
            const vertical: string = size[1] !== undefined && size[1].kind === "ident" ? size[1].lower : extent;
            return [axis(extent, 0), axis(vertical, 1)];
        }
        if (circle) {
            const radius: number = this.pixels(size[0], Math.hypot(width, height) / Math.SQRT2);
            return [radius, radius];
        }
        return [this.pixels(size[0], width), this.pixels(size[1] ?? size[0], height)];
    }

    private ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
        const arc: string = "A" + rx + " " + ry + " 0 0 1 ";
        return "M" + (cx + rx) + " " + cy + arc + cx + " " + (cy + ry) + arc + (cx - rx) + " " + cy + arc + cx + " " + (cy - ry) + arc + (cx + rx) + " " + cy + "Z";
    }

    private basicRectangle(name: string, edges: ReadonlyArray<CssValue>, width: number, height: number): Box {
        // CSS Shapes 1 §3.1 and §3.2: rect() and xywh() are the inset() they compute to; insets that overlap in one
        // dimension are reduced in proportion to fit it.
        let top: number;
        let right: number;
        let bottom: number;
        let left: number;
        if (name === "xywh") {
            left = this.pixels(edges[0], width);
            top = this.pixels(edges[1], height);
            right = width - left - Math.max(0, this.pixels(edges[2], width));
            bottom = height - top - Math.max(0, this.pixels(edges[3], height));
        } else if (name === "rect") {
            const edge: (index: number, basis: number, auto: number) => number = (index: number, basis: number, auto: number): number =>
                this.isKeyword(edges[index], "auto") ? auto : this.pixels(edges[index], basis);
            top = edge(0, height, 0);
            left = edge(3, width, 0);
            right = width - Math.max(edge(1, width, width), left);
            bottom = height - Math.max(edge(2, height, height), top);
        } else {
            top = this.pixels(edges[0], height);
            right = this.pixels(edges[1] ?? edges[0], width);
            bottom = this.pixels(edges[2] ?? edges[0], height);
            left = this.pixels(edges[3] ?? edges[1] ?? edges[0], width);
        }
        if (top + bottom > height && top + bottom > 0) {
            const scale: number = height / (top + bottom);
            top *= scale;
            bottom *= scale;
        }
        if (left + right > width && left + right > 0) {
            const scale: number = width / (left + right);
            left *= scale;
            right *= scale;
        }
        return [left, top, Math.max(0, width - left - right), Math.max(0, height - top - bottom)];
    }

    private roundedRectangle(rectangle: Box, radius: ReadonlyArray<CssValue>, width: number, height: number): string | undefined {
        // CSS Backgrounds 3 §4.1 and §4.5: the border-radius shorthand gives the four corners from the top left clockwise,
        // and radii that overlap on a side shrink by the same factor until they fit.
        const [x, y, w, h]: Box = rectangle;
        if (w <= 0 || h <= 0) {
            return undefined;
        }
        const slash: number = radius.findIndex((token: CssValue) => token.kind === "slash");
        const horizontal: ReadonlyArray<number> = this.corners((slash < 0 ? radius : radius.slice(0, slash)).map((token: CssValue) => Math.max(0, this.pixels(token, width))));
        const vertical: ReadonlyArray<number> = slash < 0 ? this.corners(radius.map((token: CssValue) => Math.max(0, this.pixels(token, height))))
            : this.corners(radius.slice(slash + 1).map((token: CssValue) => Math.max(0, this.pixels(token, height))));
        const ratios: Array<number> = [w / (horizontal[0] + horizontal[1]), h / (vertical[1] + vertical[2]), w / (horizontal[2] + horizontal[3]), h / (vertical[3] + vertical[0])];
        const factor: number = Math.min(1, ...ratios.filter((ratio: number) => Number.isFinite(ratio)));
        const rx: ReadonlyArray<number> = horizontal.map((value: number) => value * factor);
        const ry: ReadonlyArray<number> = vertical.map((value: number) => value * factor);
        const arc: (index: number, toX: number, toY: number) => string = (index: number, toX: number, toY: number): string =>
            rx[index] > 0 && ry[index] > 0 ? "A" + rx[index] + " " + ry[index] + " 0 0 1 " + toX + " " + toY : "L" + toX + " " + toY;
        return "M" + (x + rx[0]) + " " + y + "H" + (x + w - rx[1]) + arc(1, x + w, y + ry[1]) + "V" + (y + h - ry[2]) + arc(2, x + w - rx[2], y + h)
            + "H" + (x + rx[3]) + arc(3, x, y + h - ry[3]) + "V" + (y + ry[0]) + arc(0, x + rx[0], y) + "Z";
    }

    private corners(values: ReadonlyArray<number>): ReadonlyArray<number> {
        switch (values.length) {
            case 0:
                return [0, 0, 0, 0];
            case 1:
                return [values[0], values[0], values[0], values[0]];
            case 2:
                return [values[0], values[1], values[0], values[1]];
            case 3:
                return [values[0], values[1], values[2], values[1]];
            default:
                return [values[0], values[1], values[2], values[3]];
        }
    }

    private roundedPolygon(points: ReadonlyArray<readonly [number, number]>, radius: number): string {
        // CSS Shapes 1 §3.1: each vertex rounded by a circle tangent to both of its sides, its radius clamped so that the
        // rounding never takes more than half of either side.
        let data: string = "";
        const count: number = points.length;
        for (let index: number = 0; index < count; index++) {
            const vertex: readonly [number, number] = points[index];
            const before: readonly [number, number] = points[(index + count - 1) % count];
            const after: readonly [number, number] = points[(index + 1) % count];
            const a: readonly [number, number] = [before[0] - vertex[0], before[1] - vertex[1]];
            const b: readonly [number, number] = [after[0] - vertex[0], after[1] - vertex[1]];
            const la: number = Math.hypot(a[0], a[1]);
            const lb: number = Math.hypot(b[0], b[1]);
            const angle: number = la === 0 || lb === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
            const half: number = Math.tan(angle / 2);
            const used: number = radius <= 0 || angle <= 0 || angle >= Math.PI ? 0 : Math.min(radius, half * Math.min(la, lb) / 2);
            if (used <= 0) {
                data += (index === 0 ? "M" : "L") + vertex[0] + " " + vertex[1];
                continue;
            }
            const distance: number = used / half;
            const start: readonly [number, number] = [vertex[0] + a[0] / la * distance, vertex[1] + a[1] / la * distance];
            const end: readonly [number, number] = [vertex[0] + b[0] / lb * distance, vertex[1] + b[1] / lb * distance];
            const turn: number = -a[0] * b[1] + a[1] * b[0];
            data += (index === 0 ? "M" : "L") + start[0] + " " + start[1] + "A" + used + " " + used + " 0 0 " + (turn > 0 ? 1 : 0) + " " + end[0] + " " + end[1];
        }
        return data + "Z";
    }

    private shapeCommands(header: ReadonlyArray<CssValue>, commands: ReadonlyArray<CssValue>, width: number, height: number, rtl: boolean): string | undefined {
        // CSS Shapes 1 §3.1.1: the shape() commands as path data; to is relative to the reference box and by to the
        // command's starting point, and a control point is relative to the start, the end or the box when from says so.
        const from: number = header.findIndex((token: CssValue) => this.isKeyword(token, "from"));
        if (from < 0) {
            return undefined;
        }
        let current: readonly [number, number] = this.position(header.slice(from + 1), width, height, rtl);
        let start: readonly [number, number] = current;
        let data: string = "M" + current[0] + " " + current[1];
        const pair: (tokens: ReadonlyArray<CssValue>) => readonly [number, number] = (tokens: ReadonlyArray<CssValue>): readonly [number, number] =>
            [this.pixels(tokens[0], width), this.pixels(tokens[1], height)];
        for (const command of commands) {
            const tokens: ReadonlyArray<CssValue> = this.tokens(command);
            const name: string = tokens[0] !== undefined && tokens[0].kind === "ident" ? tokens[0].lower : "";
            if (name === "close") {
                data += "Z";
                current = start;
                continue;
            }
            const absolute: boolean = this.isKeyword(tokens[1], "to");
            const parts: Array<ReadonlyArray<CssValue>> = this.commandParts(tokens.slice(2));
            const target: ReadonlyArray<CssValue> = parts[0] ?? [];
            let end: readonly [number, number];
            if (name === "hline" || name === "vline") {
                const horizontal: boolean = name === "hline";
                const size: number = horizontal ? width : height;
                const along: number = absolute ? this.edge(target[0], size, horizontal, rtl) : (horizontal ? current[0] : current[1]) + this.pixels(target[0], size);
                end = horizontal ? [along, current[1]] : [current[0], along];
                data += "L" + end[0] + " " + end[1];
            } else {
                if (absolute) {
                    end = this.position(target, width, height, rtl);
                } else {
                    const offset: readonly [number, number] = pair(target);
                    end = [current[0] + offset[0], current[1] + offset[1]];
                }
                const control: (tokens: ReadonlyArray<CssValue>) => readonly [number, number] = (tokens: ReadonlyArray<CssValue>): readonly [number, number] => {
                    const anchor: number = tokens.findIndex((token: CssValue) => this.isKeyword(token, "from"));
                    if (anchor < 0 && absolute) {
                        return this.position(tokens, width, height, rtl);
                    }
                    const offset: readonly [number, number] = pair(anchor < 0 ? tokens : tokens.slice(0, anchor));
                    const base: readonly [number, number] = anchor >= 0 && this.isKeyword(tokens[anchor + 1], "end") ? end
                        : (anchor >= 0 && this.isKeyword(tokens[anchor + 1], "origin") ? [0, 0] : current);
                    return [base[0] + offset[0], base[1] + offset[1]];
                };
                const withIndex: number = parts.findIndex((part: ReadonlyArray<CssValue>) => this.isKeyword(part[0], "with"));
                const controls: Array<readonly [number, number]> = [];
                if (withIndex >= 0) {
                    controls.push(control(parts[withIndex].slice(1)));
                    const second: ReadonlyArray<CssValue> | undefined = parts[withIndex + 1];
                    if (second !== undefined && second[0] !== undefined && second[0].kind === "slash") {
                        controls.push(control(second.slice(1)));
                    }
                }
                if (name === "move") {
                    data += "M" + end[0] + " " + end[1];
                    start = end;
                } else if (name === "line") {
                    data += "L" + end[0] + " " + end[1];
                } else if (name === "curve") {
                    data += controls.length === 2 ? "C" + controls[0][0] + " " + controls[0][1] + " " + controls[1][0] + " " + controls[1][1] + " " + end[0] + " " + end[1]
                        : "Q" + (controls[0] ?? current)[0] + " " + (controls[0] ?? current)[1] + " " + end[0] + " " + end[1];
                } else if (name === "smooth") {
                    data += controls.length > 0 ? "S" + controls[0][0] + " " + controls[0][1] + " " + end[0] + " " + end[1] : "T" + end[0] + " " + end[1];
                } else if (name === "arc") {
                    data += this.arcCommand(parts, end, width, height);
                } else {
                    return undefined;
                }
            }
            current = end;
        }
        return data;
    }

    private commandParts(tokens: ReadonlyArray<CssValue>): Array<ReadonlyArray<CssValue>> {
        // The end point, then each component that starts with a keyword of its own or a slash.
        const markers: ReadonlySet<string> = new Set<string>(["with", "of", "cw", "ccw", "large", "small", "rotate"]);
        const parts: Array<Array<CssValue>> = [[]];
        for (const token of tokens) {
            if (token.kind === "slash" || (token.kind === "ident" && markers.has(token.lower))) {
                parts.push([token]);
            } else {
                parts[parts.length - 1].push(token);
            }
        }
        return parts;
    }

    private arcCommand(parts: ReadonlyArray<ReadonlyArray<CssValue>>, end: readonly [number, number], width: number, height: number): string {
        // CSS Shapes 1 §3.1.1: one radius is both, a percentage of the normalized diagonal; cw is the sweep flag of SVG
        // and large its large-arc flag; the defaults are ccw and small.
        const of: ReadonlyArray<CssValue> | undefined = parts.find((part: ReadonlyArray<CssValue>) => this.isKeyword(part[0], "of"));
        const sizes: ReadonlyArray<CssValue> = of === undefined ? [] : of.slice(1);
        const rx: number = sizes.length === 1 ? this.pixels(sizes[0], Math.hypot(width, height) / Math.SQRT2) : this.pixels(sizes[0], width);
        const ry: number = sizes.length === 1 ? rx : this.pixels(sizes[1], height);
        const rotate: ReadonlyArray<CssValue> | undefined = parts.find((part: ReadonlyArray<CssValue>) => this.isKeyword(part[0], "rotate"));
        const sweep: boolean = parts.some((part: ReadonlyArray<CssValue>) => this.isKeyword(part[0], "cw"));
        const large: boolean = parts.some((part: ReadonlyArray<CssValue>) => this.isKeyword(part[0], "large"));
        return "A" + Math.abs(rx) + " " + Math.abs(ry) + " " + this.degrees(rotate?.[1]) + " " + (large ? 1 : 0) + " " + (sweep ? 1 : 0) + " " + end[0] + " " + end[1];
    }

    private edge(value: CssValue | undefined, size: number, horizontal: boolean, rtl: boolean): number {
        if (value !== undefined && value.kind === "ident") {
            const at: readonly [string, number] | undefined = this.keywordAt(value.lower, rtl);
            return at === undefined || (at[0] !== "both" && (at[0] === "x") !== horizontal) ? 0 : at[1] * size;
        }
        return this.pixels(value, size);
    }

    private keywordAt(keyword: string, rtl: boolean): readonly [string, number] | undefined {
        // CSS Values 4 §7.6: the axis and the fraction of the box each position keyword stands for; x-start, inline-start
        // and start follow the direction in the horizontal writing mode of SVG.
        switch (keyword) {
            case "left":
                return ["x", 0];
            case "right":
                return ["x", 1];
            case "x-start":
            case "inline-start":
                return ["x", rtl ? 1 : 0];
            case "x-end":
            case "inline-end":
                return ["x", rtl ? 0 : 1];
            case "top":
            case "y-start":
            case "block-start":
                return ["y", 0];
            case "bottom":
            case "y-end":
            case "block-end":
                return ["y", 1];
            case "center":
                return ["both", 0.5];
            default:
                return undefined;
        }
    }

    position(tokens: ReadonlyArray<CssValue>, width: number, height: number, rtl: boolean): readonly [number, number] {
        // CSS Values 4 §7.6: one value with the other centered, two values with keywords in either order (start and end
        // naming the block axis first), or four values that offset from the named edges.
        const sizes: Readonly<Record<string, number>> = { x: width, y: height };
        if (tokens.length === 4) {
            const result: Record<string, number> = { x: width / 2, y: height / 2 };
            for (const index of [0, 2]) {
                const keyword: CssValue = tokens[index];
                const at: readonly [string, number] | undefined = keyword.kind === "ident" ? this.keywordAt(keyword.lower, rtl) : undefined;
                if (at !== undefined && at[0] !== "both") {
                    const offset: number = this.pixels(tokens[index + 1], sizes[at[0]]);
                    result[at[0]] = at[1] === 0 ? offset : sizes[at[0]] - offset;
                }
            }
            return [result["x"], result["y"]];
        }
        if (tokens.length === 0) {
            return [width / 2, height / 2];
        }
        if (tokens.length === 1) {
            const token: CssValue = tokens[0];
            const at: readonly [string, number] | undefined = token.kind === "ident" ? this.keywordAt(token.lower, rtl) : undefined;
            if (at === undefined) {
                return [this.pixels(token, width), height / 2];
            }
            return at[0] === "y" ? [width / 2, at[1] * height] : (at[0] === "x" ? [at[1] * width, height / 2] : [width / 2, height / 2]);
        }
        let [first, second]: readonly [CssValue, CssValue] = [tokens[0], tokens[1]];
        if ([first, second].some((token: CssValue) => this.isKeyword(token, "start") || this.isKeyword(token, "end"))) {
            const block: number = this.isKeyword(first, "end") ? 1 : (this.isKeyword(first, "center") ? 0.5 : 0);
            const inline: number = this.isKeyword(second, "end") ? (rtl ? 0 : 1) : (this.isKeyword(second, "center") ? 0.5 : (rtl ? 1 : 0));
            return [inline * width, block * height];
        }
        const axisOf: (token: CssValue) => string | undefined = (token: CssValue): string | undefined =>
            token.kind === "ident" ? this.keywordAt(token.lower, rtl)?.[0] : undefined;
        if (axisOf(first) === "y" || axisOf(second) === "x") {
            [first, second] = [second, first];
        }
        const resolve: (token: CssValue, size: number) => number = (token: CssValue, size: number): number => {
            const at: readonly [string, number] | undefined = token.kind === "ident" ? this.keywordAt(token.lower, rtl) : undefined;
            return at === undefined ? this.pixels(token, size) : at[1] * size;
        };
        return [resolve(first, width), resolve(second, height)];
    }

    edges(path: SvgPath, matrix: Matrix, tolerance: number): Array<number> {
        const edges: Array<number> = [];
        for (const [points] of this.flattened(path, tolerance, SvgGeometry.IDENTITY3)) {
            for (let index: number = 0; index < points.length; index++) {
                const next: readonly [number, number] = points[(index + 1) % points.length];
                const from: readonly [number, number] = this.point(matrix, points[index][0], points[index][1]);
                const to: readonly [number, number] = this.point(matrix, next[0], next[1]);
                if (from[0] !== to[0] || from[1] !== to[1]) {
                    edges.push(from[0], from[1], to[0], to[1]);
                }
            }
        }
        return edges;
    }

    grown(edges: ReadonlyArray<number>, margin: number, tolerance: number): Array<number> {
        // CSS Shapes 1 §6.3: the points at the margin's distance from the shape, which each edge widened by it and each
        // vertex rounded by it cover; every piece winds once round its inside, so that together they fill with nonzero.
        const result: Array<number> = [];
        const piece: (points: ReadonlyArray<readonly [number, number]>) => void = (points: ReadonlyArray<readonly [number, number]>): void => {
            const ordered: ReadonlyArray<readonly [number, number]> = this.oriented(points);
            ordered.forEach((point: readonly [number, number], index: number) => {
                const next: readonly [number, number] = ordered[(index + 1) % ordered.length];
                result.push(point[0], point[1], next[0], next[1]);
            });
        };
        for (let index: number = 0; margin > 0 && index < edges.length; index += 4) {
            const [x0, y0, x1, y1]: ReadonlyArray<number> = edges.slice(index, index + 4);
            const length: number = Math.hypot(x1 - x0, y1 - y0);
            const nx: number = -(y1 - y0) / length * margin;
            const ny: number = (x1 - x0) / length * margin;
            piece([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
            piece(this.circle([x0, y0], margin, tolerance, SvgGeometry.IDENTITY3));
        }
        return result;
    }

    homography(matrix: Matrix4): Homography {
        // CSS Transforms 2 §4.2: a point (x, y) of a plane is (x, y, 0, 1), so the third column of the matrix plays no part,
        // and flattening leaves out the z it gives.
        return [matrix[0], matrix[4], matrix[12], matrix[1], matrix[5], matrix[13], matrix[3], matrix[7], matrix[15]];
    }

    planarHomography(matrix: Matrix): Homography {
        return [matrix[0], matrix[2], matrix[4], matrix[1], matrix[3], matrix[5], 0, 0, 1];
    }

    composeHomography(outer: Homography, inner: Homography): Homography {
        const result: Array<number> = [];
        for (let row: number = 0; row < 3; row++) {
            for (let column: number = 0; column < 3; column++) {
                result.push(outer[row * 3] * inner[column] + outer[row * 3 + 1] * inner[3 + column] + outer[row * 3 + 2] * inner[6 + column]);
            }
        }
        return result;
    }

    invertHomography(homography: Homography): Homography | undefined {
        const [a, b, c, d, e, f, g, h, k]: Homography = homography;
        const determinant: number = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
        if (determinant === 0 || !Number.isFinite(determinant)) {
            return undefined;
        }
        return [(e * k - f * h) / determinant, (c * h - b * k) / determinant, (b * f - c * e) / determinant, (f * g - d * k) / determinant, (a * k - c * g) / determinant,
            (c * d - a * f) / determinant, (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant];
    }

    tangent(homography: Homography, x: number, y: number): Matrix | undefined {
        const [px, py, w]: readonly [number, number, number] = this.mapped(homography, x, y);
        if (w <= W_LIMIT) {
            return undefined;
        }
        const a: number = (homography[0] * w - px * homography[6]) / (w * w);
        const b: number = (homography[3] * w - py * homography[6]) / (w * w);
        const c: number = (homography[1] * w - px * homography[7]) / (w * w);
        const d: number = (homography[4] * w - py * homography[7]) / (w * w);
        return [a, b, c, d, px / w - a * x - c * y, py / w - b * x - d * y];
    }

    projected(path: SvgPath, homography: Homography, tolerance: number): Array<Array<readonly [number, number]>> {
        // CSS Transforms 2 §4.2: a projective map keeps lines straight, so a polygon goes to the polygon of its projected
        // vertices, once cut where w is not positive.
        const result: Array<Array<readonly [number, number]>> = [];
        for (const [points, closed] of this.flattened(path, tolerance, homography)) {
            const polygon: ReadonlyArray<readonly [number, number]> = closed && points.length > 1 ? points.slice(0, -1) : points;
            const visible: Array<readonly [number, number]> = this.ahead(homography, polygon);
            if (visible.length >= 3) {
                result.push(visible.map((point: readonly [number, number]): readonly [number, number] => {
                    const [x, y, w]: readonly [number, number, number] = this.mapped(homography, point[0], point[1]);
                    return [x / w, y / w];
                }));
            }
        }
        return result;
    }

    projectedLines(path: SvgPath, homography: Homography, tolerance: number): SvgPath {
        // The subpaths as lines through the projection, open or closed as they are; cutting away the part where w is not
        // positive leaves the pieces open, a closed subpath going on across its start.
        const result: SvgPath = { verbs: [], points: [] };
        const w: (point: readonly [number, number]) => number = (point: readonly [number, number]): number =>
            homography[6] * point[0] + homography[7] * point[1] + homography[8] - W_LIMIT;
        const line: (points: ReadonlyArray<readonly [number, number]>, closed: boolean) => void = (points: ReadonlyArray<readonly [number, number]>, closed: boolean): void => {
            points.forEach((point: readonly [number, number], index: number) => {
                const [x, y, scale]: readonly [number, number, number] = this.mapped(homography, point[0], point[1]);
                result.verbs.push(index === 0 ? MOVE : LINE);
                result.points.push(x / scale, y / scale);
            });
            if (closed) {
                result.verbs.push(CLOSE);
            }
        };
        for (const [points, closed] of this.flattened(path, tolerance, homography)) {
            if (points.every((point: readonly [number, number]) => w(point) > 0)) {
                line(points, closed);
                continue;
            }
            const runs: Array<Array<readonly [number, number]>> = [[]];
            points.forEach((point: readonly [number, number], index: number) => {
                const previous: readonly [number, number] | undefined = points[index - 1];
                if (previous !== undefined && (w(previous) > 0) !== (w(point) > 0)) {
                    const t: number = w(previous) / (w(previous) - w(point));
                    const cut: readonly [number, number] = [previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t];
                    if (w(previous) > 0) {
                        runs[runs.length - 1].push(cut);
                        runs.push([]);
                    } else {
                        runs[runs.length - 1].push(cut);
                    }
                }
                if (w(point) > 0) {
                    runs[runs.length - 1].push(point);
                }
            });
            if (closed && runs.length > 1 && w(points[0]) > 0) {
                const last: Array<readonly [number, number]> = runs.pop() as Array<readonly [number, number]>;
                runs[0] = [...last, ...runs[0].slice(1)];
            }
            for (const run of runs) {
                if (run.length > 0) {
                    line(run, false);
                }
            }
        }
        return result;
    }

    polygonPath(points: ReadonlyArray<readonly [number, number]>): SvgPath {
        const path: SvgPath = { verbs: [], points: [] };
        points.forEach((point: readonly [number, number], index: number) => {
            path.verbs.push(index === 0 ? MOVE : LINE);
            path.points.push(point[0], point[1]);
        });
        path.verbs.push(CLOSE);
        return path;
    }

    private ahead(homography: Homography, polygon: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
        // CSS Transforms 2 §4.2: the parts with w < 0 are cut away; the cut stops just short of w = 0, where the points go
        // infinitely far.
        const result: Array<readonly [number, number]> = [];
        const w: (point: readonly [number, number]) => number = (point: readonly [number, number]): number =>
            homography[6] * point[0] + homography[7] * point[1] + homography[8] - W_LIMIT;
        polygon.forEach((point: readonly [number, number], index: number) => {
            const next: readonly [number, number] = polygon[(index + 1) % polygon.length];
            const here: number = w(point);
            const there: number = w(next);
            if (here > 0) {
                result.push(point);
            }
            if ((here > 0) !== (there > 0)) {
                const t: number = here / (here - there);
                result.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t]);
            }
        });
        return result;
    }

    parse(data: string): SvgPath {
        // SVG 2 §9.3.9 and §9.5.4: the path is drawn up to the last segment that is correctly defined before the first error.
        const path: SvgPath = { verbs: [], points: [] };
        this.text = data;
        this.index = 0;
        let command: string | undefined;
        let x: number = 0;
        let y: number = 0;
        let startX: number = 0;
        let startY: number = 0;
        let control: readonly [string, number, number] = ["", 0, 0];
        let closed: boolean = false;
        this.skipWhiteSpace();
        while (this.index < data.length) {
            const character: string = data.charAt(this.index);
            if (COMMANDS.includes(character)) {
                this.index++;
                if (command === undefined && character !== "M" && character !== "m") {
                    break;
                }
                command = character;
                if (character === "Z" || character === "z") {
                    if (!closed && path.verbs.length > 0) {
                        path.verbs.push(CLOSE);
                        x = startX;
                        y = startY;
                        closed = true;
                    }
                    control = ["", 0, 0];
                    this.skipWhiteSpace();
                    continue;
                }
                this.skipWhiteSpace();
            } else if (command === undefined || command === "Z" || command === "z" || !this.startsNumber()) {
                break;
            }
            const kind: string = (command as string).toLowerCase();
            const values: Array<number> = [];
            for (let parameter: number = 0; parameter < PARAMETERS[kind]; parameter++) {
                if (parameter > 0) {
                    this.skipSeparator();
                }
                const value: number | undefined = kind === "a" && (parameter === 3 || parameter === 4) ? this.flag() : this.number();
                if (value === undefined) {
                    return path;
                }
                values.push(value);
            }
            const relative: boolean = command !== (command as string).toUpperCase();
            const baseX: number = relative ? x : 0;
            const baseY: number = relative ? y : 0;
            if (kind === "m") {
                x = baseX + values[0];
                y = baseY + values[1];
                path.verbs.push(MOVE);
                path.points.push(x, y);
                startX = x;
                startY = y;
                closed = false;
                control = ["", 0, 0];
                // SVG 2 §9.3.3: the pairs after the first of a moveto are lineto commands.
                command = relative ? "l" : "L";
            } else {
                if (closed) {
                    // SVG 2 §9.3.4: a command after a closepath starts a new subpath at the same initial point.
                    path.verbs.push(MOVE);
                    path.points.push(startX, startY);
                    closed = false;
                }
                let next: readonly [string, number, number] = ["", 0, 0];
                if (kind === "l" || kind === "h" || kind === "v") {
                    const toX: number = kind === "v" ? x : baseX + values[0];
                    const toY: number = kind === "h" ? y : baseY + values[kind === "l" ? 1 : 0];
                    path.verbs.push(LINE);
                    path.points.push(toX, toY);
                    x = toX;
                    y = toY;
                } else if (kind === "c" || kind === "s") {
                    // SVG 2 §9.5.2: the first control point of S reflects the last one of a preceding cubic curve.
                    const reflected: boolean = kind === "s";
                    const c1x: number = reflected ? (control[0] === "c" ? 2 * x - control[1] : x) : baseX + values[0];
                    const c1y: number = reflected ? (control[0] === "c" ? 2 * y - control[2] : y) : baseY + values[1];
                    const offset: number = reflected ? 0 : 2;
                    path.verbs.push(CURVE);
                    path.points.push(c1x, c1y, baseX + values[offset], baseY + values[offset + 1], baseX + values[offset + 2], baseY + values[offset + 3]);
                    next = ["c", baseX + values[offset], baseY + values[offset + 1]];
                    x = baseX + values[offset + 2];
                    y = baseY + values[offset + 3];
                } else if (kind === "q" || kind === "t") {
                    // A quadratic curve is the cubic one with its control points two thirds of the way to its control point.
                    const qx: number = kind === "t" ? (control[0] === "q" ? 2 * x - control[1] : x) : baseX + values[0];
                    const qy: number = kind === "t" ? (control[0] === "q" ? 2 * y - control[2] : y) : baseY + values[1];
                    const toX: number = baseX + values[kind === "t" ? 0 : 2];
                    const toY: number = baseY + values[kind === "t" ? 1 : 3];
                    path.verbs.push(CURVE);
                    path.points.push(x + 2 * (qx - x) / 3, y + 2 * (qy - y) / 3, toX + 2 * (qx - toX) / 3, toY + 2 * (qy - toY) / 3, toX, toY);
                    next = ["q", qx, qy];
                    x = toX;
                    y = toY;
                } else {
                    this.arc(path, x, y, values[0], values[1], values[2], values[3] !== 0, values[4] !== 0, baseX + values[5], baseY + values[6]);
                    x = baseX + values[5];
                    y = baseY + values[6];
                }
                control = next;
            }
            const before: number = this.index;
            this.skipWhiteSpace();
            if (data.charAt(this.index) === ",") {
                this.index++;
                this.skipWhiteSpace();
                if (!this.startsNumber()) {
                    this.index = before;
                    break;
                }
            }
        }
        return path;
    }

    private arc(path: SvgPath, x1: number, y1: number, radiusX: number, radiusY: number, rotation: number, large: boolean, sweep: boolean, x: number, y: number): void {
        // SVG 2 §9.5.1 and the endpoint to center conversion of its implementation notes; each part of at most a quarter
        // turn is a cubic curve with its control points at 4/3 tan(angle / 4) of the radius.
        if (x === x1 && y === y1) {
            return;
        }
        let rx: number = Math.abs(radiusX);
        let ry: number = Math.abs(radiusY);
        if (rx === 0 || ry === 0) {
            path.verbs.push(LINE);
            path.points.push(x, y);
            return;
        }
        const phi: number = rotation * Math.PI / 180;
        const cos: number = Math.cos(phi);
        const sin: number = Math.sin(phi);
        const px: number = cos * (x1 - x) / 2 + sin * (y1 - y) / 2;
        const py: number = -sin * (x1 - x) / 2 + cos * (y1 - y) / 2;
        const lambda: number = (px * px) / (rx * rx) + (py * py) / (ry * ry);
        if (lambda > 1) {
            rx *= Math.sqrt(lambda);
            ry *= Math.sqrt(lambda);
        }
        const numerator: number = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
        const coefficient: number = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / (rx * rx * py * py + ry * ry * px * px)));
        const centerX: number = coefficient * rx * py / ry;
        const centerY: number = -coefficient * ry * px / rx;
        const cx: number = cos * centerX - sin * centerY + (x1 + x) / 2;
        const cy: number = sin * centerX + cos * centerY + (y1 + y) / 2;
        const theta: number = Math.atan2((py - centerY) / ry, (px - centerX) / rx);
        let delta: number = Math.atan2((-py - centerY) / ry, (-px - centerX) / rx) - theta;
        if (!sweep && delta > 0) {
            delta -= 2 * Math.PI;
        } else if (sweep && delta < 0) {
            delta += 2 * Math.PI;
        }
        const parts: number = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
        const step: number = delta / parts;
        const kappa: number = 4 / 3 * Math.tan(step / 4);
        const map: (u: number, v: number) => readonly [number, number] = (u: number, v: number): readonly [number, number] =>
            [cx + rx * cos * u - ry * sin * v, cy + rx * sin * u + ry * cos * v];
        for (let part: number = 0; part < parts; part++) {
            const from: number = theta + part * step;
            const to: number = from + step;
            const c1: readonly [number, number] = map(Math.cos(from) - kappa * Math.sin(from), Math.sin(from) + kappa * Math.cos(from));
            const c2: readonly [number, number] = map(Math.cos(to) + kappa * Math.sin(to), Math.sin(to) - kappa * Math.cos(to));
            const end: readonly [number, number] = part === parts - 1 ? [x, y] : map(Math.cos(to), Math.sin(to));
            path.verbs.push(part === parts - 1 ? CURVE : ARC_PART);
            path.points.push(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
        }
    }

    private number(): number | undefined {
        // SVG 2 §9.3.9: sign? (digit* "." digit+ | digit+) exponent?, taking as many characters as the production allows.
        const text: string = this.text;
        let index: number = this.index;
        if (text.charAt(index) === "+" || text.charAt(index) === "-") {
            index++;
        }
        const integerStart: number = index;
        while (this.isDigit(text.charAt(index))) {
            index++;
        }
        let digits: number = index - integerStart;
        if (text.charAt(index) === ".") {
            let fraction: number = index + 1;
            while (this.isDigit(text.charAt(fraction))) {
                fraction++;
            }
            if (fraction > index + 1) {
                digits += fraction - index - 1;
                index = fraction;
            }
        }
        if (digits === 0) {
            return undefined;
        }
        if (text.charAt(index) === "e" || text.charAt(index) === "E") {
            let exponent: number = index + 1;
            if (text.charAt(exponent) === "+" || text.charAt(exponent) === "-") {
                exponent++;
            }
            const exponentStart: number = exponent;
            while (this.isDigit(text.charAt(exponent))) {
                exponent++;
            }
            if (exponent > exponentStart) {
                index = exponent;
            }
        }
        const value: number = Number(text.substring(this.index, index));
        this.index = index;
        return value;
    }

    private flag(): number | undefined {
        const character: string = this.text.charAt(this.index);
        if (character !== "0" && character !== "1") {
            return undefined;
        }
        this.index++;
        return character === "1" ? 1 : 0;
    }

    private isDigit(character: string): boolean {
        return character >= "0" && character <= "9";
    }

    private startsNumber(): boolean {
        const character: string = this.text.charAt(this.index);
        return this.isDigit(character) || character === "+" || character === "-" || character === ".";
    }

    private skipWhiteSpace(): void {
        while (this.index < this.text.length && WHITE_SPACE.includes(this.text.charAt(this.index))) {
            this.index++;
        }
    }

    private skipSeparator(): void {
        this.skipWhiteSpace();
        if (this.text.charAt(this.index) === ",") {
            this.index++;
            this.skipWhiteSpace();
        }
    }

    emit(path: SvgPath, matrix: Matrix | undefined, content: ContentStream): void {
        // Points moved by a matrix here, instead of the coordinate system, keep the width of a stroke.
        let index: number = 0;
        for (const verb of path.verbs) {
            if (verb === CLOSE) {
                content.closePath();
                continue;
            }
            const points: Array<number> = [];
            for (let point: number = 0; point < (verb === CURVE || verb === ARC_PART ? 3 : 1); point++) {
                const mapped: readonly [number, number] = matrix === undefined ? [path.points[index], path.points[index + 1]] : this.point(matrix, path.points[index], path.points[index + 1]);
                points.push(mapped[0], mapped[1]);
                index += 2;
            }
            if (verb === MOVE) {
                content.moveTo(points[0], points[1]);
            } else if (verb === LINE) {
                content.lineTo(points[0], points[1]);
            } else {
                content.curveTo(points[0], points[1], points[2], points[3], points[4], points[5]);
            }
        }
    }

    bounds(path: SvgPath, matrix: Matrix): Box | undefined {
        // SVG 2 §8.10: the extremes of each curve count, not its control points.
        let box: Box | undefined;
        let current: readonly [number, number] = [0, 0];
        this.segments(path, (verb: number, start: readonly [number, number], points: ReadonlyArray<number>) => {
            const mapped: Array<readonly [number, number]> = [];
            for (let index: number = 0; index < points.length; index += 2) {
                mapped.push(this.point(matrix, points[index], points[index + 1]));
            }
            current = this.point(matrix, start[0], start[1]);
            const end: readonly [number, number] = mapped[mapped.length - 1] ?? current;
            box = this.union(box, [end[0], end[1], 0, 0]);
            if (verb === CURVE || verb === ARC_PART) {
                for (const t of [...this.extremes(current[0], mapped[0][0], mapped[1][0], end[0]), ...this.extremes(current[1], mapped[0][1], mapped[1][1], end[1])]) {
                    const point: readonly [number, number] = this.cubicPoint(current, mapped[0], mapped[1], end, t);
                    box = this.union(box, [point[0], point[1], 0, 0]);
                }
            }
        });
        return box;
    }

    private extremes(p0: number, p1: number, p2: number, p3: number): Array<number> {
        const a: number = -p0 + 3 * p1 - 3 * p2 + p3;
        const b: number = 2 * (p0 - 2 * p1 + p2);
        const c: number = p1 - p0;
        const roots: Array<number> = [];
        if (Math.abs(a) < 1e-12) {
            if (Math.abs(b) > 1e-12) {
                roots.push(-c / b);
            }
        } else if (b * b - 4 * a * c >= 0) {
            const root: number = Math.sqrt(b * b - 4 * a * c);
            roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
        }
        return roots.filter((t: number) => t > 0 && t < 1);
    }

    private cubicPoint(p0: readonly [number, number], p1: readonly [number, number], p2: readonly [number, number], p3: readonly [number, number], t: number): readonly [number, number] {
        const u: number = 1 - t;
        return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    }

    vertices(path: SvgPath): Array<readonly [number, number, number]> {
        // SVG 2 §9.4: a zero-length segment takes its neighbours' directions; §13.7.4: a marker points along an open end and
        // half way between the segments meeting elsewhere. The parts of an arc make one segment.
        const starts: Array<number> = [];
        const ends: Array<number> = [];
        const points: Array<readonly [number, number]> = [];
        const subpaths: Array<readonly [number, number, number, boolean]> = [];
        let first: boolean = true;
        this.segments(path, (verb: number, start: readonly [number, number], coordinates: ReadonlyArray<number>) => {
            const end: readonly [number, number] = [coordinates[coordinates.length - 2], coordinates[coordinates.length - 1]];
            if (verb === MOVE) {
                subpaths.push([end[0], end[1], starts.length, false]);
                first = true;
                return;
            }
            const vectors: Array<number> = verb === CURVE || verb === ARC_PART ? [coordinates[0] - start[0], coordinates[1] - start[1], coordinates[2] - start[0],
                coordinates[3] - start[1], end[0] - start[0], end[1] - start[1]] : [end[0] - start[0], end[1] - start[1]];
            const backwards: Array<number> = verb === CURVE || verb === ARC_PART ? [end[0] - coordinates[2], end[1] - coordinates[3], end[0] - coordinates[0],
                end[1] - coordinates[1], end[0] - start[0], end[1] - start[1]] : vectors;
            if (first) {
                starts.push(this.direction(vectors));
                ends.push(this.direction(backwards));
                points.push(end);
            } else {
                ends[ends.length - 1] = Number.isNaN(this.direction(backwards)) ? ends[ends.length - 1] : this.direction(backwards);
                points[points.length - 1] = end;
            }
            first = verb !== ARC_PART;
            if (verb === CLOSE) {
                const last: readonly [number, number, number, boolean] = subpaths[subpaths.length - 1];
                subpaths[subpaths.length - 1] = [last[0], last[1], last[2], true];
            }
        });
        const known: (index: number) => boolean = (index: number): boolean => !Number.isNaN(starts[index]);
        const resolvedStarts: Array<number> = [...starts];
        const resolvedEnds: Array<number> = [...ends];
        for (let index: number = 0; index < starts.length; index++) {
            if (!known(index)) {
                const before: number = this.nearest(starts.length, index, -1, known);
                const after: number = this.nearest(starts.length, index, 1, known);
                resolvedStarts[index] = before >= 0 ? ends[before] : (after >= 0 ? starts[after] : 0);
                resolvedEnds[index] = after >= 0 ? starts[after] : (before >= 0 ? ends[before] : 0);
            }
        }
        const vertices: Array<readonly [number, number, number]> = [];
        subpaths.forEach((subpath: readonly [number, number, number, boolean], position: number) => {
            const from: number = subpath[2];
            const to: number = position + 1 < subpaths.length ? subpaths[position + 1][2] : starts.length;
            if (to === from) {
                vertices.push([subpath[0], subpath[1], 0]);
                return;
            }
            const closedAngle: number = this.bisect(resolvedEnds[to - 1], resolvedStarts[from]);
            vertices.push([subpath[0], subpath[1], subpath[3] ? closedAngle : resolvedStarts[from]]);
            for (let segment: number = from; segment < to; segment++) {
                const angle: number = segment < to - 1 ? this.bisect(resolvedEnds[segment], resolvedStarts[segment + 1]) : (subpath[3] ? closedAngle : resolvedEnds[segment]);
                vertices.push([points[segment][0], points[segment][1], angle]);
            }
        });
        return vertices;
    }

    private direction(vectors: ReadonlyArray<number>): number {
        for (let index: number = 0; index < vectors.length; index += 2) {
            if (vectors[index] !== 0 || vectors[index + 1] !== 0) {
                return Math.atan2(vectors[index + 1], vectors[index]);
            }
        }
        return Number.NaN;
    }

    private nearest(count: number, index: number, step: number, known: (index: number) => boolean): number {
        for (let candidate: number = index + step; candidate >= 0 && candidate < count; candidate += step) {
            if (known(candidate)) {
                return candidate;
            }
        }
        return -1;
    }

    private bisect(incoming: number, outgoing: number): number {
        let difference: number = outgoing - incoming;
        while (difference > Math.PI) {
            difference -= 2 * Math.PI;
        }
        while (difference <= -Math.PI) {
            difference += 2 * Math.PI;
        }
        return incoming + difference / 2;
    }

    transformPath(path: SvgPath, matrix: Matrix): SvgPath {
        const points: Array<number> = [];
        for (let index: number = 0; index < path.points.length; index += 2) {
            points.push(...this.point(matrix, path.points[index], path.points[index + 1]));
        }
        return { verbs: path.verbs, points };
    }

    reverse(path: SvgPath): SvgPath {
        // Each subpath traced from its end back to its start; a closed one starts and closes where it did.
        const subpaths: Array<[readonly [number, number], Array<readonly [number, ReadonlyArray<number>, readonly [number, number]]>, boolean]> = [];
        this.segments(path, (verb: number, start: readonly [number, number], points: ReadonlyArray<number>) => {
            if (verb === MOVE) {
                subpaths.push([[points[0], points[1]], [], false]);
                return;
            }
            if (subpaths.length === 0) {
                subpaths.push([start, [], false]);
            }
            const last: [readonly [number, number], Array<readonly [number, ReadonlyArray<number>, readonly [number, number]]>, boolean] = subpaths[subpaths.length - 1];
            if (verb === CLOSE) {
                last[2] = true;
            } else {
                last[1].push([verb, points, start]);
            }
        });
        const result: SvgPath = { verbs: [], points: [] };
        for (const [start, segments, closed] of subpaths) {
            const final: ReadonlyArray<number> | undefined = segments[segments.length - 1]?.[1];
            const end: readonly [number, number] = final === undefined ? start : [final[final.length - 2], final[final.length - 1]];
            const begin: readonly [number, number] = closed ? start : end;
            result.verbs.push(MOVE);
            result.points.push(begin[0], begin[1]);
            if (closed && (end[0] !== start[0] || end[1] !== start[1])) {
                result.verbs.push(LINE);
                result.points.push(end[0], end[1]);
            }
            for (let index: number = segments.length - 1; index >= 0; index--) {
                const [verb, points, from]: readonly [number, ReadonlyArray<number>, readonly [number, number]] = segments[index];
                if (verb === LINE) {
                    result.verbs.push(LINE);
                    result.points.push(from[0], from[1]);
                    continue;
                }
                result.verbs.push(index > 0 && segments[index - 1][0] === ARC_PART ? ARC_PART : CURVE);
                result.points.push(points[2], points[3], points[0], points[1], from[0], from[1]);
            }
            if (closed) {
                result.verbs.push(CLOSE);
            }
        }
        return result;
    }

    closed(path: SvgPath): boolean {
        // SVG 2 §11.5: a path of one subpath that ends with a closepath.
        return path.verbs.filter((verb: number) => verb === MOVE).length === 1 && path.verbs[path.verbs.length - 1] === CLOSE;
    }

    length(path: SvgPath, tolerance: number): number {
        // SVG 2 §9.6: a moveto has no length.
        let total: number = 0;
        for (const [points] of this.flattened(path, tolerance, SvgGeometry.IDENTITY3)) {
            for (let index: number = 1; index < points.length; index++) {
                total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
            }
        }
        return total;
    }

    along(path: SvgPath, distance: number, tolerance: number): readonly [number, number, number] | undefined {
        // The point at a distance along the path, and the direction of the path there in radians.
        let travelled: number = 0;
        for (const [points] of this.flattened(path, tolerance, SvgGeometry.IDENTITY3)) {
            for (let index: number = 1; index < points.length; index++) {
                const from: readonly [number, number] = points[index - 1];
                const to: readonly [number, number] = points[index];
                const piece: number = Math.hypot(to[0] - from[0], to[1] - from[1]);
                if (piece > 0 && travelled + piece >= distance) {
                    const ratio: number = (distance - travelled) / piece;
                    return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio, Math.atan2(to[1] - from[1], to[0] - from[0])];
                }
                travelled += piece;
            }
        }
        return undefined;
    }

    spatial(values: Readonly<Record<string, CssValue>>, reference: Box): Matrix4 {
        // CSS Transforms 2 §6: translate to the transform origin, then by translate, rotate, scale and the transform list,
        // then back; percentages refer to the reference box.
        const origin: readonly [number, number, number] = this.origin(values["transform-origin"], reference);
        let matrix: Matrix4 = this.translation4(origin[0], origin[1], origin[2]);
        const translate: ReadonlyArray<CssValue> = this.listOf(values["translate"]);
        if (translate.length > 0) {
            matrix = this.multiply4(matrix, this.translation4(this.pixels(translate[0], reference[2]), this.pixels(translate[1], reference[3]), this.pixels(translate[2], 0)));
        }
        matrix = this.multiply4(matrix, this.individualRotate(this.listOf(values["rotate"])));
        const scale: ReadonlyArray<CssValue> = this.listOf(values["scale"]);
        if (scale.length > 0) {
            matrix = this.multiply4(matrix, this.scaling4(this.factor(scale[0]), this.factor(scale[scale.length > 1 ? 1 : 0]), scale.length > 2 ? this.factor(scale[2]) : 1));
        }
        for (const item of this.listOf(values["transform"])) {
            if (item.kind === "function") {
                matrix = this.multiply4(matrix, this.function(item.name.toLowerCase(), item.args.filter((argument: CssValue) => argument.kind !== "slash"), reference));
            }
        }
        return this.multiply4(matrix, this.translation4(-origin[0], -origin[1], -origin[2]));
    }

    multiply4(outer: Matrix4, inner: Matrix4): Matrix4 {
        // The matrix that applies inner first and outer after; both are in the column-major order of matrix3d().
        const result: Array<number> = new Array<number>(16).fill(0);
        for (let column: number = 0; column < 4; column++) {
            for (let row: number = 0; row < 4; row++) {
                let sum: number = 0;
                for (let index: number = 0; index < 4; index++) {
                    sum += outer[index * 4 + row] * inner[column * 4 + index];
                }
                result[column * 4 + row] = sum;
            }
        }
        return result;
    }

    lift(matrix: Matrix): Matrix4 {
        return [matrix[0], matrix[1], 0, 0, matrix[2], matrix[3], 0, 0, 0, 0, 1, 0, matrix[4], matrix[5], 0, 1];
    }

    planar(matrix: Matrix4): boolean {
        return [2, 3, 6, 7, 8, 9, 11, 14].every((index: number) => Math.abs(matrix[index]) < EPSILON) && Math.abs(matrix[10] - 1) < EPSILON && Math.abs(matrix[15] - 1) < EPSILON;
    }

    flatten(matrix: Matrix4): Matrix | null | undefined {
        // CSS Transforms 2 §4.2: a point (a, b) of a plane goes to (x / w, y / w) of the matrix applied to (a, b, 0, 1); when
        // w is the same everywhere that is an affine map, or nothing is drawn if w is not positive.
        if (Math.abs(matrix[3]) >= EPSILON || Math.abs(matrix[7]) >= EPSILON) {
            return undefined;
        }
        const w: number = matrix[15];
        if (w <= 0) {
            return null;
        }
        return [matrix[0] / w, matrix[1] / w, matrix[4] / w, matrix[5] / w, matrix[12] / w, matrix[13] / w];
    }

    projectBox(matrix: Matrix4, box: Box): Box | undefined {
        const flat: Matrix | null | undefined = this.flatten(matrix);
        if (flat !== undefined) {
            return flat === null ? undefined : this.transformBox(flat, box);
        }
        const homography: Homography = this.homography(matrix);
        let result: Box | undefined;
        for (const point of this.ahead(homography, [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0] + box[2], box[1] + box[3]], [box[0], box[1] + box[3]]])) {
            const [x, y, w]: readonly [number, number, number] = this.mapped(homography, point[0], point[1]);
            result = this.union(result, [x / w, y / w, 0, 0]);
        }
        return result;
    }

    facet(matrix: Matrix4, box: Box): Array<readonly [number, number, number]> {
        // The corners of a box in its plane of a 3D rendering context, cut where w is not positive, with the depth z / w.
        const homography: Homography = this.homography(matrix);
        const corners: ReadonlyArray<readonly [number, number]> = [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0] + box[2], box[1] + box[3]], [box[0], box[1] + box[3]]];
        return this.ahead(homography, corners).map((point: readonly [number, number]): readonly [number, number, number] => {
            const [x, y, w]: readonly [number, number, number] = this.mapped(homography, point[0], point[1]);
            return [x / w, y / w, (matrix[2] * point[0] + matrix[6] * point[1] + matrix[14]) / w];
        });
    }

    projectPath(path: SvgPath, matrix: Matrix4, tolerance: number): SvgPath {
        // A projective map keeps straight lines straight but not curves, which are flattened.
        const flat: Matrix | null | undefined = this.flatten(matrix);
        if (flat !== undefined) {
            return flat === null ? { verbs: [], points: [] } : this.transformPath(path, flat);
        }
        return this.projectedLines(path, this.homography(matrix), tolerance);
    }

    depthOrder(facets: ReadonlyArray<Facet>): Array<Facet> {
        // A binary space partition: the first polygon's plane parts the others, splitting those that cross it; the side away
        // from the viewer, who looks down from positive z, comes first, and polygons in one plane keep their order.
        if (facets.length === 0) {
            return [];
        }
        const [first, ...rest]: ReadonlyArray<Facet> = facets;
        const plane: readonly [number, number, number, number] | undefined = this.planeOf(first[1]);
        if (plane === undefined) {
            return [first, ...this.depthOrder(rest)];
        }
        const ahead: Array<Facet> = [];
        const behind: Array<Facet> = [];
        const level: Array<Facet> = [first];
        const distance: (point: readonly [number, number, number]) => number = (point: readonly [number, number, number]): number =>
            plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3];
        for (const facet of rest) {
            const distances: Array<number> = facet[1].map(distance);
            const tolerance: number = 1e-6 * Math.max(1, ...facet[1].map((point: readonly [number, number, number]) => Math.hypot(point[0], point[1], point[2])));
            if (distances.every((value: number) => Math.abs(value) <= tolerance)) {
                level.push(facet);
            } else if (distances.every((value: number) => value >= -tolerance)) {
                ahead.push(facet);
            } else if (distances.every((value: number) => value <= tolerance)) {
                behind.push(facet);
            } else {
                const front: Array<readonly [number, number, number]> = [];
                const back: Array<readonly [number, number, number]> = [];
                facet[1].forEach((point: readonly [number, number, number], index: number) => {
                    const next: readonly [number, number, number] = facet[1][(index + 1) % facet[1].length];
                    const here: number = distances[index];
                    const there: number = distances[(index + 1) % distances.length];
                    if (here >= -tolerance) {
                        front.push(point);
                    }
                    if (here <= tolerance) {
                        back.push(point);
                    }
                    if ((here > tolerance && there < -tolerance) || (here < -tolerance && there > tolerance)) {
                        const t: number = here / (here - there);
                        const cut: readonly [number, number, number] = [point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t, point[2] + (next[2] - point[2]) * t];
                        front.push(cut);
                        back.push(cut);
                    }
                });
                if (front.length >= 3) {
                    ahead.push([facet[0], front]);
                }
                if (back.length >= 3) {
                    behind.push([facet[0], back]);
                }
            }
        }
        level.sort((a: Facet, b: Facet) => a[0] - b[0]);
        const facing: boolean = plane[2] >= 0;
        return facing ? [...this.depthOrder(behind), ...level, ...this.depthOrder(ahead)] : [...this.depthOrder(ahead), ...level, ...this.depthOrder(behind)];
    }

    private planeOf(points: ReadonlyArray<readonly [number, number, number]>): readonly [number, number, number, number] | undefined {
        // The plane through a polygon, its normal found by Newell's method so that any three points will do.
        let nx: number = 0;
        let ny: number = 0;
        let nz: number = 0;
        points.forEach((point: readonly [number, number, number], index: number) => {
            const next: readonly [number, number, number] = points[(index + 1) % points.length];
            nx += (point[1] - next[1]) * (point[2] + next[2]);
            ny += (point[2] - next[2]) * (point[0] + next[0]);
            nz += (point[0] - next[0]) * (point[1] + next[1]);
        });
        const length: number = Math.hypot(nx, ny, nz);
        if (length < EPSILON) {
            return undefined;
        }
        const [a, b, c]: readonly [number, number, number] = [nx / length, ny / length, nz / length];
        return [a, b, c, -(a * points[0][0] + b * points[0][1] + c * points[0][2])];
    }


    private translation4(x: number, y: number, z: number): Matrix4 {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
    }

    private scaling4(x: number, y: number, z: number): Matrix4 {
        return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
    }

    private rotation4(x: number, y: number, z: number, degrees: number): Matrix4 {
        // CSS Transforms 2 §16: the rotation about a normalized vector; a vector that cannot be normalized rotates nothing.
        const length: number = Math.hypot(x, y, z);
        if (length === 0) {
            return SvgGeometry.IDENTITY4;
        }
        const [u, v, n]: readonly [number, number, number] = [x / length, y / length, z / length];
        const half: number = degrees * Math.PI / 360;
        const sc: number = Math.sin(half) * Math.cos(half);
        const sq: number = Math.sin(half) * Math.sin(half);
        return [
            1 - 2 * (v * v + n * n) * sq, 2 * (u * v * sq + n * sc), 2 * (u * n * sq - v * sc), 0,
            2 * (u * v * sq - n * sc), 1 - 2 * (u * u + n * n) * sq, 2 * (v * n * sq + u * sc), 0,
            2 * (u * n * sq + v * sc), 2 * (v * n * sq - u * sc), 1 - 2 * (u * u + v * v) * sq, 0,
            0, 0, 0, 1
        ];
    }

    perspective4(distance: number): Matrix4 {
        // CSS Transforms 2 §12.2 and §16: a distance below 1px is 1px.
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / Math.max(1, distance), 0, 0, 0, 1];
    }

    private origin(value: CssValue | undefined, reference: Box): readonly [number, number, number] {
        // CSS Transforms 1 §5.1: a vertical keyword first is the second coordinate; the third value is the z offset.
        const items: Array<CssValue> = [...this.listOf(value)];
        const vertical: Readonly<Record<string, number>> = { top: 0, center: 0.5, bottom: 1 };
        const horizontal: Readonly<Record<string, number>> = { left: 0, center: 0.5, right: 1 };
        if (items.length >= 2 && items[0].kind === "ident" && items[0].lower !== "center" && vertical[items[0].lower] !== undefined) {
            [items[0], items[1]] = [items[1], items[0]];
        }
        const resolve: (item: CssValue | undefined, keywords: Readonly<Record<string, number>>, start: number, size: number) => number =
            (item: CssValue | undefined, keywords: Readonly<Record<string, number>>, start: number, size: number): number => {
                if (item === undefined) {
                    return start + size / 2;
                }
                return item.kind === "ident" ? start + size * (keywords[item.lower] ?? 0.5) : start + this.pixels(item, size);
            };
        return [resolve(items[0], horizontal, reference[0], reference[2]), resolve(items[1], vertical, reference[1], reference[3]), this.pixels(items[2], 0)];
    }

    private individualRotate(items: ReadonlyArray<CssValue>): Matrix4 {
        // CSS Transforms 2 §5: an angle alone is about the z axis; x, y and z name an axis, and three numbers give one.
        const angle: CssValue | undefined = items.find((item: CssValue) => item.kind === "dimension" || (item.kind === "number" && items.length !== 3 && items.length !== 4));
        if (angle === undefined) {
            return SvgGeometry.IDENTITY4;
        }
        const axis: ReadonlyArray<CssValue> = items.filter((item: CssValue) => item !== angle);
        if (axis.length === 1 && axis[0].kind === "ident") {
            const name: string = axis[0].lower;
            return this.rotation4(name === "x" ? 1 : 0, name === "y" ? 1 : 0, name === "z" ? 1 : 0, this.degrees(angle));
        }
        if (axis.length === 3) {
            return this.rotation4(this.factor(axis[0]), this.factor(axis[1]), this.factor(axis[2]), this.degrees(angle));
        }
        return this.rotation4(0, 0, 1, this.degrees(angle));
    }

    private listOf(value: CssValue | undefined): ReadonlyArray<CssValue> {
        if (value === undefined || (value.kind === "ident" && value.lower === "none")) {
            return [];
        }
        return value.kind === "list" ? value.items : [value];
    }

    private function(name: string, args: ReadonlyArray<CssValue>, reference: Box): Matrix4 {
        // CSS Transforms 1 §12 and CSS Transforms 2 §12 and §16.
        const number: (index: number, fallback: number) => number = (index: number, fallback: number): number =>
            args[index] === undefined ? fallback : this.factor(args[index]);
        const tangent: (index: number) => number = (index: number): number => Math.tan(this.degrees(args[index]) * Math.PI / 180);
        switch (name) {
            case "matrix":
                return this.lift([number(0, 1), number(1, 0), number(2, 0), number(3, 1), number(4, 0), number(5, 0)]);
            case "matrix3d":
                return args.length === 16 ? args.map((argument: CssValue) => this.factor(argument)) : SvgGeometry.IDENTITY4;
            case "translate":
                return this.translation4(this.pixels(args[0], reference[2]), this.pixels(args[1], reference[3]), 0);
            case "translate3d":
                return this.translation4(this.pixels(args[0], reference[2]), this.pixels(args[1], reference[3]), this.pixels(args[2], 0));
            case "translatex":
                return this.translation4(this.pixels(args[0], reference[2]), 0, 0);
            case "translatey":
                return this.translation4(0, this.pixels(args[0], reference[3]), 0);
            case "translatez":
                return this.translation4(0, 0, this.pixels(args[0], 0));
            case "scale":
                return this.scaling4(number(0, 1), number(1, number(0, 1)), 1);
            case "scale3d":
                return this.scaling4(number(0, 1), number(1, 1), number(2, 1));
            case "scalex":
                return this.scaling4(number(0, 1), 1, 1);
            case "scaley":
                return this.scaling4(1, number(0, 1), 1);
            case "scalez":
                return this.scaling4(1, 1, number(0, 1));
            case "rotate":
            case "rotatez":
                return this.rotation4(0, 0, 1, this.degrees(args[0]));
            case "rotatex":
                return this.rotation4(1, 0, 0, this.degrees(args[0]));
            case "rotatey":
                return this.rotation4(0, 1, 0, this.degrees(args[0]));
            case "rotate3d":
                return this.rotation4(number(0, 0), number(1, 0), number(2, 0), this.degrees(args[3]));
            case "skew":
                return this.lift([1, args[1] === undefined ? 0 : tangent(1), tangent(0), 1, 0, 0]);
            case "skewx":
                return this.lift([1, 0, tangent(0), 1, 0, 0]);
            case "skewy":
                return this.lift([1, tangent(0), 0, 1, 0, 0]);
            case "perspective":
                return args[0] === undefined || (args[0].kind === "ident" && args[0].lower === "none") ? SvgGeometry.IDENTITY4 : this.perspective4(this.pixels(args[0], 0));
            default:
                return SvgGeometry.IDENTITY4;
        }
    }

    private factor(value: CssValue): number {
        if (value.kind === "number") {
            return value.value;
        }
        return value.kind === "percentage" ? value.value / 100 : this.pixels(value, 0);
    }

    private degrees(value: CssValue | undefined): number {
        if (value === undefined) {
            return 0;
        }
        if (value.kind === "number") {
            return value.value;
        }
        return value.kind === "dimension" ? value.value * (DEGREES[value.unit.toLowerCase()] ?? 1) : 0;
    }

    private pixels(value: CssValue | undefined, basis: number): number {
        if (value === undefined) {
            return 0;
        }
        return value.kind === "number" ? value.value : this.lengths.pixelsOf(value, NO_UNITS, basis) ?? 0;
    }
}
