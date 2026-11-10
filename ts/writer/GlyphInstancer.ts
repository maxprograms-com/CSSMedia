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

import type { OutlinePoints } from "../fonts/GlyphOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { FontInstance } from "../fonts/Typeface.js";

const ON_CURVE: number = 0x01;
const HEADER: number = 10;
const MAXP_SIZE: number = 32;

export class GlyphInstancer {

    private readonly outlines: GlyphOutlines = new GlyphOutlines();

    tables(instance: FontInstance, used: ReadonlySet<number>): Record<string, Buffer> {
        // ISO 32000-2 §9.9.1 embeds TrueType without variations or synthesized faces, so the glyphs are written as the instance draws
        // them, without the instructions, which were made for other points.
        const source: Readonly<Record<string, Buffer>> = instance.typeface.tables;
        const count: number = source["maxp"].readUInt16BE(4);
        const pieces: Array<Buffer> = [];
        const loca: Buffer = Buffer.alloc((count + 1) * 4);
        const hmtx: Buffer = Buffer.alloc(count * 4);
        const extremes: [number, number, number, number] = [0, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        let points: number = 0;
        let contours: number = 0;
        let length: number = 0;
        for (let glyph: number = 0; glyph < count; glyph++) {
            loca.writeUInt32BE(length, glyph * 4);
            const advance: number = Math.max(0, Math.min(0xFFFF, Math.round(instance.advances[glyph] ?? 0)));
            hmtx.writeUInt16BE(advance, glyph * 4);
            extremes[0] = Math.max(extremes[0], advance);
            const outline: OutlinePoints | undefined = used.has(glyph) ? this.outlines.programPoints(instance, glyph) : undefined;
            if (outline === undefined || outline.xs.length === 0) {
                continue;
            }
            const data: Buffer = this.simple(outline);
            const xMin: number = data.readInt16BE(2);
            const xMax: number = data.readInt16BE(6);
            hmtx.writeInt16BE(xMin, glyph * 4 + 2);
            extremes[1] = Math.min(extremes[1], xMin);
            extremes[2] = Math.min(extremes[2], advance - xMax);
            extremes[3] = Math.max(extremes[3], xMax);
            points = Math.max(points, outline.xs.length);
            contours = Math.max(contours, outline.ends.length);
            const padded: Buffer = Buffer.alloc(Math.ceil(data.length / 4) * 4);
            data.copy(padded);
            pieces.push(padded);
            length += padded.length;
        }
        loca.writeUInt32BE(length, count * 4);
        return {
            glyf: Buffer.concat(pieces), loca, hmtx, head: this.head(source["head"]), hhea: this.hhea(source["hhea"], instance, extremes, count),
            maxp: this.maxp(source["maxp"], points, contours)
        };
    }

    private simple(outline: OutlinePoints): Buffer {
        // OpenType glyf, "Simple glyph description": the header with the bounding box, the end points of the contours, no
        // instructions, one flag for each point, then the x and the y coordinates as words relative to the point before.
        const count: number = outline.xs.length;
        const contours: number = outline.ends.length;
        const xs: Array<number> = Array.from(outline.xs, (value: number) => Math.round(value));
        const ys: Array<number> = Array.from(outline.ys, (value: number) => Math.round(value));
        const data: Buffer = Buffer.alloc(HEADER + contours * 2 + 2 + count * 5);
        data.writeInt16BE(contours, 0);
        data.writeInt16BE(Math.min(...xs), 2);
        data.writeInt16BE(Math.min(...ys), 4);
        data.writeInt16BE(Math.max(...xs), 6);
        data.writeInt16BE(Math.max(...ys), 8);
        let position: number = HEADER;
        for (const end of outline.ends) {
            data.writeUInt16BE(end, position);
            position += 2;
        }
        data.writeUInt16BE(0, position);
        position += 2;
        for (let point: number = 0; point < count; point++) {
            data.writeUInt8(outline.onCurve[point] & ON_CURVE, position++);
        }
        for (const values of [xs, ys]) {
            let previous: number = 0;
            for (const value of values) {
                data.writeInt16BE(value - previous, position);
                position += 2;
                previous = value;
            }
        }
        return data;
    }

    private head(source: Buffer): Buffer {
        // OpenType head: indexToLocFormat says how the loca written here is read, whatever the format of the source.
        const table: Buffer = Buffer.from(source);
        table.writeInt16BE(1, 50);
        return table;
    }

    private hhea(source: Buffer, instance: FontInstance, extremes: readonly [number, number, number, number], count: number): Buffer {
        // OpenType hhea: the line metrics of the instance, the extremes of the advances and of the glyphs, and a full hmtx
        // record for every glyph.
        const table: Buffer = Buffer.from(source);
        table.writeInt16BE(Math.round(instance.metrics.horizontal.ascender), 4);
        table.writeInt16BE(Math.round(instance.metrics.horizontal.descender), 6);
        table.writeInt16BE(Math.round(instance.metrics.horizontal.lineGap), 8);
        table.writeUInt16BE(extremes[0], 10);
        if (extremes[3] > Number.NEGATIVE_INFINITY) {
            table.writeInt16BE(extremes[1], 12);
            table.writeInt16BE(extremes[2], 14);
            table.writeInt16BE(extremes[3], 16);
        }
        table.writeUInt16BE(count, 34);
        return table;
    }

    private maxp(source: Buffer, points: number, contours: number): Buffer {
        // OpenType maxp version 1.0: the largest simple glyph written, and no composite glyphs and no instructions.
        const table: Buffer = Buffer.alloc(MAXP_SIZE);
        source.copy(table, 0, 0, Math.min(source.length, MAXP_SIZE));
        table.writeUInt32BE(0x00010000, 0);
        table.writeUInt16BE(points, 6);
        table.writeUInt16BE(contours, 8);
        table.writeUInt16BE(0, 10);
        table.writeUInt16BE(0, 12);
        table.writeUInt16BE(Math.max(1, table.readUInt16BE(14)), 14);
        table.writeUInt16BE(0, 26);
        table.writeUInt16BE(0, 28);
        table.writeUInt16BE(0, 30);
        return table;
    }
}
