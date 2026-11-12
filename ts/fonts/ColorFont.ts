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

import type { Matrix } from "../geometry/PathGeometry.js";
import { InstanceBuilder } from "./InstanceBuilder.js";
import type { DeltaSetIndexMap, ItemVariationStore, Typeface } from "./Typeface.js";
import { VariationReader } from "./VariationReader.js";

export interface ColorStop {
    offset: number;
    entry: number;
    alpha: number;
}

export interface ColorLine {
    extend: number;
    stops: ReadonlyArray<ColorStop>;
}

export interface Bitmap {
    table: string;
    offset: number;
    length: number;
    ppem: readonly [number, number];
    metrics?: readonly [number, number, number, number];
    origin?: readonly [number, number];
}

export type Paint =
    | { kind: "layers"; children: ReadonlyArray<number> }
    | { kind: "solid"; entry: number; alpha: number }
    | { kind: "linear"; line: ColorLine; points: readonly [number, number, number, number, number, number] }
    | { kind: "radial"; line: ColorLine; circles: readonly [number, number, number, number, number, number] }
    | { kind: "sweep"; line: ColorLine; center: readonly [number, number]; start: number; end: number }
    | { kind: "glyph"; glyph: number; child: number }
    | { kind: "colr-glyph"; glyph: number }
    | { kind: "transform"; matrix: Matrix; child: number }
    | { kind: "composite"; mode: number; source: number; backdrop: number }
    | { kind: "unknown" };

const BASE_RECORD: number = 6;
const LAYER_RECORD: number = 4;
const PAINT_RECORD: number = 6;
const COLOR_RECORD: number = 4;
const CLIP_RECORD: number = 7;
const NO_VARIATION: number = 0xFFFFFFFF;
const F2DOT14: number = 16384;
const FIXED: number = 65536;
const HALF_TURN: number = 180;
const SVG_RECORD: number = 12;
const BITMAP_SIZE: number = 48;
const SUBTABLE_RECORD: number = 8;
const SBIX_HEADER: number = 8;
const SBIX_IMAGES: ReadonlySet<string> = new Set<string>(["png ", "jpg ", "tiff"]);
const DUPLICATE: string = "dupe";

export class ColorFont {

    static readonly FOREGROUND: number = 0xFFFF;
    static readonly LIGHT: number = 0x0001;
    static readonly DARK: number = 0x0002;

    private static readonly fonts: WeakMap<Typeface, ColorFont | null> = new WeakMap<Typeface, ColorFont | null>();

    readonly entries: number = 0;
    readonly palettes: ReadonlyArray<Uint8Array> = [];
    readonly types: ReadonlyArray<number> = [];
    private readonly colr: Buffer;
    private readonly version: number;
    private readonly svgTable?: Buffer;
    private readonly sbix?: Buffer;
    private readonly cblc?: Buffer;
    private readonly cbdt?: Buffer;
    private readonly glyphCount: number;
    private readonly builder: InstanceBuilder = new InstanceBuilder();
    private readonly store?: ItemVariationStore;
    private readonly indexMap?: DeltaSetIndexMap;

    static of(typeface: Typeface): ColorFont | undefined {
        let font: ColorFont | null | undefined = ColorFont.fonts.get(typeface);
        if (font === undefined) {
            const tables: Readonly<Record<string, Buffer>> = typeface.tables;
            const color: boolean = (tables["COLR"] !== undefined && tables["CPAL"] !== undefined) || tables["SVG "] !== undefined || tables["sbix"] !== undefined
                || (tables["CBDT"] !== undefined && tables["CBLC"] !== undefined);
            font = color ? new ColorFont(tables, typeface.glyphCount) : null;
            ColorFont.fonts.set(typeface, font);
        }
        return font ?? undefined;
    }

    private constructor(tables: Readonly<Record<string, Buffer>>, glyphCount: number) {
        // OpenType COLR: "If the COLR table is present in a font but no CPAL table exists, then the COLR table is ignored."
        const cpal: Buffer | undefined = tables["CPAL"];
        this.colr = tables["COLR"] !== undefined && cpal !== undefined ? tables["COLR"] : Buffer.alloc(14);
        this.version = this.colr.readUInt16BE(0);
        this.glyphCount = glyphCount;
        if (tables["SVG "] !== undefined) {
            this.svgTable = tables["SVG "];
        }
        if (tables["sbix"] !== undefined) {
            this.sbix = tables["sbix"];
        }
        if (tables["CBDT"] !== undefined && tables["CBLC"] !== undefined) {
            this.cblc = tables["CBLC"];
            this.cbdt = tables["CBDT"];
        }
        if (cpal === undefined) {
            return;
        }
        // OpenType CPAL: each palette is numPaletteEntries color records from its index in colorRecordIndices, in BGRA order;
        // version 1 adds the flags of each palette.
        const colr: Buffer = this.colr;
        this.entries = cpal.readUInt16BE(2);
        const count: number = cpal.readUInt16BE(4);
        const records: number = cpal.readUInt32BE(8);
        const palettes: Array<Uint8Array> = [];
        for (let palette: number = 0; palette < count; palette++) {
            const first: number = records + cpal.readUInt16BE(12 + palette * 2) * COLOR_RECORD;
            const colors: Uint8Array = new Uint8Array(this.entries * 4);
            for (let entry: number = 0; entry < this.entries; entry++) {
                const at: number = first + entry * COLOR_RECORD;
                colors[entry * 4] = cpal[at + 2];
                colors[entry * 4 + 1] = cpal[at + 1];
                colors[entry * 4 + 2] = cpal[at];
                colors[entry * 4 + 3] = cpal[at + 3];
            }
            palettes.push(colors);
        }
        this.palettes = palettes;
        const typesOffset: number = cpal.readUInt16BE(0) >= 1 ? cpal.readUInt32BE(12 + count * 2) : 0;
        const types: Array<number> = [];
        for (let palette: number = 0; typesOffset !== 0 && palette < count; palette++) {
            types.push(cpal.readUInt32BE(typesOffset + palette * 4));
        }
        this.types = types;
        if (this.version >= 1 && colr.readUInt32BE(30) !== 0) {
            const reader: VariationReader = new VariationReader();
            this.store = reader.store(colr, colr.readUInt32BE(30));
            if (colr.readUInt32BE(26) !== 0) {
                this.indexMap = reader.deltaSetIndexMap(colr, colr.readUInt32BE(26));
            }
        }
    }

    svgDocument(glyph: number): readonly [number, number] | undefined {
        // OpenType SVG: "Records must be sorted in increasing startGlyphID order".
        const table: Buffer | undefined = this.svgTable;
        if (table === undefined) {
            return undefined;
        }
        const list: number = table.readUInt32BE(2);
        let low: number = 0;
        let high: number = table.readUInt16BE(list) - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const record: number = list + 2 + middle * SVG_RECORD;
            if (glyph < table.readUInt16BE(record)) {
                high = middle - 1;
            } else if (glyph > table.readUInt16BE(record + 2)) {
                low = middle + 1;
            } else {
                return [list + table.readUInt32BE(record + 4), table.readUInt32BE(record + 8)];
            }
        }
        return undefined;
    }

    svgData(offset: number, length: number): Buffer {
        return (this.svgTable as Buffer).subarray(offset, offset + length);
    }

    bitmap(glyph: number): Bitmap | undefined {
        // The bitmap of the strike with the most pixels per em: a PDF has no raster size to choose for, and OpenType CBDT
        // recommends to "downscale using the closest sized bitmap that is larger than the desired end raster size".
        return this.sbixBitmap(glyph) ?? this.colorBitmap(glyph);
    }

    private sbixBitmap(glyph: number): Bitmap | undefined {
        // OpenType sbix: in each strike, glyphDataOffsets give the data of each glyph, its origin offsets and graphic type, a
        // length of zero meaning none; a 'dupe' holds the glyph ID whose data "must be used for the current glyph".
        const table: Buffer | undefined = this.sbix;
        if (table === undefined || glyph >= this.glyphCount) {
            return undefined;
        }
        let best: Bitmap | undefined;
        for (let strike: number = 0; strike < table.readUInt32BE(4); strike++) {
            const start: number = table.readUInt32BE(SBIX_HEADER + strike * 4);
            const ppem: number = table.readUInt16BE(start);
            let current: number = glyph;
            for (let step: number = 0; step <= this.glyphCount && (best === undefined || ppem > best.ppem[1]); step++) {
                const from: number = start + table.readUInt32BE(start + 4 + current * 4);
                const to: number = start + table.readUInt32BE(start + 4 + (current + 1) * 4);
                const type: string = to - from > SBIX_HEADER ? table.toString("latin1", from + 4, from + 8) : "";
                if (type === DUPLICATE) {
                    current = table.readUInt16BE(from + SBIX_HEADER);
                    continue;
                }
                if (SBIX_IMAGES.has(type)) {
                    best = { table: "sbix", offset: from + SBIX_HEADER, length: to - from - SBIX_HEADER, ppem: [ppem, ppem], origin: [table.readInt16BE(from), table.readInt16BE(from + 2)] };
                }
                break;
            }
        }
        return best;
    }

    private colorBitmap(glyph: number): Bitmap | undefined {
        // OpenType CBLC: each BitmapSize record has an IndexSubtableList of glyph ranges, and each IndexSubtable (EBLC formats 1
        // to 5) locates the data of its glyphs in CBDT, where formats 17, 18 and 19 hold PNG data with small, big or no metrics.
        const table: Buffer | undefined = this.cblc;
        if (table === undefined) {
            return undefined;
        }
        let best: [number, number, number, number, number, readonly [number, number, number, number] | undefined] | undefined;
        for (let size: number = 0; size < table.readUInt32BE(4); size++) {
            const record: number = 8 + size * BITMAP_SIZE;
            const ppem: number = table[record + 45];
            if (glyph < table.readUInt16BE(record + 40) || glyph > table.readUInt16BE(record + 42) || (best !== undefined && ppem <= best[1])) {
                continue;
            }
            const list: number = table.readUInt32BE(record);
            for (let index: number = 0; index < table.readUInt32BE(record + 8); index++) {
                const range: number = list + index * SUBTABLE_RECORD;
                const first: number = table.readUInt16BE(range);
                if (glyph < first || glyph > table.readUInt16BE(range + 2)) {
                    continue;
                }
                const located: readonly [number, number, number, readonly [number, number, number, number] | undefined] | undefined =
                    this.located(table, list + table.readUInt32BE(range + 4), glyph, first);
                if (located !== undefined) {
                    best = [table[record + 44], ppem, located[0], located[1], located[2], located[3]];
                }
                break;
            }
        }
        if (best === undefined) {
            return undefined;
        }
        const [ppemX, ppemY, format, start, end, shared] = best;
        const data: Buffer = this.cbdt as Buffer;
        let metrics: readonly [number, number, number, number] | undefined = shared;
        let at: number = start;
        if (format === 17) {
            metrics = [data[at + 1], data[at], data.readInt8(at + 2), data.readInt8(at + 3)];
            at += 5;
        } else if (format === 18) {
            metrics = [data[at + 1], data[at], data.readInt8(at + 2), data.readInt8(at + 3)];
            at += 8;
        } else if (format !== 19) {
            throw new Error("The CBDT bitmap format " + format + ", which is not PNG data, is not implemented");
        }
        if (metrics === undefined || at + 4 > end) {
            return undefined;
        }
        return { table: "CBDT", offset: at + 4, length: data.readUInt32BE(at), ppem: [ppemX, ppemY], metrics };
    }

    private located(table: Buffer, subtable: number, glyph: number, first: number):
        readonly [number, number, number, readonly [number, number, number, number] | undefined] | undefined {
        const format: number = table.readUInt16BE(subtable);
        const image: number = table.readUInt16BE(subtable + 2);
        const data: number = table.readUInt32BE(subtable + 4);
        const shared: (at: number) => readonly [number, number, number, number] = (at: number): readonly [number, number, number, number] =>
            [table[at + 1], table[at], table.readInt8(at + 2), table.readInt8(at + 3)];
        const index: number = glyph - first;
        switch (format) {
            case 1:
                return [image, data + table.readUInt32BE(subtable + 8 + index * 4), data + table.readUInt32BE(subtable + 12 + index * 4), undefined];
            case 2: {
                const size: number = table.readUInt32BE(subtable + 8);
                return [image, data + index * size, data + (index + 1) * size, shared(subtable + 12)];
            }
            case 3:
                return [image, data + table.readUInt16BE(subtable + 8 + index * 2), data + table.readUInt16BE(subtable + 10 + index * 2), undefined];
            case 4:
                for (let pair: number = 0; pair < table.readUInt32BE(subtable + 8); pair++) {
                    const at: number = subtable + 12 + pair * 4;
                    if (table.readUInt16BE(at) === glyph) {
                        return [image, data + table.readUInt16BE(at + 2), data + table.readUInt16BE(at + 6), undefined];
                    }
                }
                return undefined;
            case 5: {
                const size: number = table.readUInt32BE(subtable + 8);
                for (let position: number = 0; position < table.readUInt32BE(subtable + 20); position++) {
                    if (table.readUInt16BE(subtable + 24 + position * 2) === glyph) {
                        return [image, data + position * size, data + (position + 1) * size, shared(subtable + 12)];
                    }
                }
                return undefined;
            }
            default:
                return undefined;
        }
    }

    bitmapData(bitmap: Bitmap): Buffer {
        const table: Buffer = (bitmap.table === "sbix" ? this.sbix : this.cbdt) as Buffer;
        return table.subarray(bitmap.offset, bitmap.offset + bitmap.length);
    }

    scalars(coordinates: Float64Array): Float64Array | undefined {
        return this.store === undefined ? undefined : this.builder.scalars(this.store, coordinates);
    }

    paint(glyph: number): number | undefined {
        // The offset of the root Paint table of a version 1 color glyph; "the application should search for a base glyph ID
        // first in the BaseGlyphList".
        const list: number = this.version >= 1 ? this.colr.readUInt32BE(14) : 0;
        if (list === 0) {
            return undefined;
        }
        const index: number = this.search(list + 4, this.colr.readUInt32BE(list), PAINT_RECORD, glyph);
        return index < 0 ? undefined : list + this.colr.readUInt32BE(list + 4 + index * PAINT_RECORD + 2);
    }

    layers(glyph: number): Array<readonly [number, number]> | undefined {
        // Version 0: the layer records of a base glyph, the first one at the bottom, each a glyph and a palette entry.
        const records: number = this.colr.readUInt32BE(4);
        const index: number = records === 0 ? -1 : this.search(records, this.colr.readUInt16BE(2), BASE_RECORD, glyph);
        if (index < 0) {
            return undefined;
        }
        const record: number = records + index * BASE_RECORD;
        const first: number = this.colr.readUInt32BE(8) + this.colr.readUInt16BE(record + 2) * LAYER_RECORD;
        const layers: Array<readonly [number, number]> = [];
        for (let layer: number = 0; layer < this.colr.readUInt16BE(record + 4); layer++) {
            const at: number = first + layer * LAYER_RECORD;
            layers.push([this.colr.readUInt16BE(at), this.colr.readUInt16BE(at + 2)]);
        }
        return layers;
    }

    clip(glyph: number, scalars?: Float64Array): readonly [number, number, number, number] | undefined {
        // The ClipList: ranges of base glyphs, each with a ClipBox; a variable box is rounded "such that the clip box expands".
        const list: number = this.version >= 1 ? this.colr.readUInt32BE(22) : 0;
        if (list === 0) {
            return undefined;
        }
        for (let index: number = 0; index < this.colr.readUInt32BE(list + 1); index++) {
            const record: number = list + 5 + index * CLIP_RECORD;
            if (glyph < this.colr.readUInt16BE(record) || glyph > this.colr.readUInt16BE(record + 2)) {
                continue;
            }
            const box: number = list + this.colr.readUIntBE(record + 4, 3);
            const base: number = this.colr[box] === 2 ? this.colr.readUInt32BE(box + 9) : NO_VARIATION;
            const varied: (at: number, item: number) => number = (at: number, item: number): number =>
                this.colr.readInt16BE(box + at) + this.delta(base, item, scalars);
            return [Math.floor(varied(1, 0)), Math.floor(varied(3, 1)), Math.ceil(varied(5, 2)), Math.ceil(varied(7, 3))];
        }
        return undefined;
    }

    paintAt(at: number, scalars?: Float64Array): Paint {
        // OpenType COLR, Paint tables: each format, the variable one taking its deltas by varIndexBase in the order of its fields.
        const table: Buffer = this.colr;
        const format: number = table[at];
        const child: number = at + table.readUIntBE(at + 1, 3);
        const word: (offset: number, base: number, item: number) => number = (offset: number, base: number, item: number): number =>
            table.readInt16BE(at + offset) + this.delta(base, item, scalars);
        const unit: (offset: number, base: number, item: number) => number = (offset: number, base: number, item: number): number => word(offset, base, item) / F2DOT14;
        const variable: boolean = format % 2 === 1;
        switch (format) {
            case 1: {
                const list: number = table.readUInt32BE(18);
                const first: number = table.readUInt32BE(at + 2);
                const children: Array<number> = [];
                for (let layer: number = first; list !== 0 && layer < first + table[at + 1] && layer < table.readUInt32BE(list); layer++) {
                    children.push(list + table.readUInt32BE(list + 4 + layer * 4));
                }
                return { kind: "layers", children };
            }
            case 2:
            case 3: {
                const base: number = format === 3 ? table.readUInt32BE(at + 5) : NO_VARIATION;
                return { kind: "solid", entry: table.readUInt16BE(at + 1), alpha: unit(3, base, 0) };
            }
            case 4:
            case 5: {
                const base: number = format === 5 ? table.readUInt32BE(at + 16) : NO_VARIATION;
                return {
                    kind: "linear", line: this.colorLine(child, format === 5, scalars),
                    points: [word(4, base, 0), word(6, base, 1), word(8, base, 2), word(10, base, 3), word(12, base, 4), word(14, base, 5)]
                };
            }
            case 6:
            case 7: {
                const base: number = format === 7 ? table.readUInt32BE(at + 16) : NO_VARIATION;
                // The radii are UFWORD.
                const radius: (offset: number, item: number) => number = (offset: number, item: number): number => table.readUInt16BE(at + offset) + this.delta(base, item, scalars);
                return {
                    kind: "radial", line: this.colorLine(child, format === 7, scalars),
                    circles: [word(4, base, 0), word(6, base, 1), radius(8, 2), word(10, base, 3), word(12, base, 4), radius(14, 5)]
                };
            }
            case 8:
            case 9: {
                // "add 1.0 and multiply by 180° to retrieve counter-clockwise degrees".
                const base: number = format === 9 ? table.readUInt32BE(at + 12) : NO_VARIATION;
                return {
                    kind: "sweep", line: this.colorLine(child, format === 9, scalars), center: [word(4, base, 0), word(6, base, 1)],
                    start: (unit(8, base, 2) + 1) * HALF_TURN, end: (unit(10, base, 3) + 1) * HALF_TURN
                };
            }
            case 10:
                return { kind: "glyph", glyph: table.readUInt16BE(at + 4), child };
            case 11:
                return { kind: "colr-glyph", glyph: table.readUInt16BE(at + 1) };
            case 12:
            case 13: {
                const affine: number = at + table.readUIntBE(at + 4, 3);
                const base: number = format === 13 ? table.readUInt32BE(affine + 24) : NO_VARIATION;
                const fixed: (item: number) => number = (item: number): number => (table.readInt32BE(affine + item * 4) + this.delta(base, item, scalars)) / FIXED;
                return { kind: "transform", matrix: [fixed(0), fixed(1), fixed(2), fixed(3), fixed(4), fixed(5)], child };
            }
            case 14:
            case 15: {
                const base: number = variable ? table.readUInt32BE(at + 8) : NO_VARIATION;
                return { kind: "transform", matrix: [1, 0, 0, 1, word(4, base, 0), word(6, base, 1)], child };
            }
            case 16:
            case 17:
            case 18:
            case 19:
            case 20:
            case 21:
            case 22:
            case 23:
                return { kind: "transform", matrix: this.scaling(format, at, scalars), child };
            case 24:
            case 25:
            case 26:
            case 27: {
                // "Rotation angle, 180° in counter-clockwise degrees per 1.0 of value", about the origin or a center.
                const centered: boolean = format >= 26;
                const base: number = variable ? table.readUInt32BE(at + (centered ? 10 : 6)) : NO_VARIATION;
                const angle: number = unit(4, base, 0) * Math.PI;
                const cx: number = centered ? word(6, base, 1) : 0;
                const cy: number = centered ? word(8, base, 2) : 0;
                const cos: number = Math.cos(angle);
                const sin: number = Math.sin(angle);
                return { kind: "transform", matrix: [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy], child };
            }
            case 28:
            case 29:
            case 30:
            case 31: {
                // For x skew angle φ and y skew angle ψ: "yx = tan(ψ)" and "xy = -tan(φ)", about the origin or a center.
                const centered: boolean = format >= 30;
                const base: number = variable ? table.readUInt32BE(at + (centered ? 12 : 8)) : NO_VARIATION;
                const xy: number = -Math.tan(unit(4, base, 0) * Math.PI);
                const yx: number = Math.tan(unit(6, base, 1) * Math.PI);
                const cx: number = centered ? word(8, base, 2) : 0;
                const cy: number = centered ? word(10, base, 3) : 0;
                return { kind: "transform", matrix: [1, yx, xy, 1, -xy * cy, -yx * cx], child };
            }
            case 32:
                return { kind: "composite", source: child, mode: table[at + 4], backdrop: at + table.readUIntBE(at + 5, 3) };
            default:
                return { kind: "unknown" };
        }
    }

    private scaling(format: number, at: number, scalars?: Float64Array): Matrix {
        // Formats 16 to 23: x and y factors or one uniform factor, about the origin or a center, each pair with a variable form.
        const table: Buffer = this.colr;
        const uniform: boolean = format >= 20;
        const centered: boolean = format === 18 || format === 19 || format >= 22;
        const fields: number = (uniform ? 1 : 2) + (centered ? 2 : 0);
        const base: number = format % 2 === 1 ? table.readUInt32BE(at + 4 + fields * 2) : NO_VARIATION;
        const word: (item: number) => number = (item: number): number => table.readInt16BE(at + 4 + item * 2) + this.delta(base, item, scalars);
        const sx: number = word(0) / F2DOT14;
        const sy: number = uniform ? sx : word(1) / F2DOT14;
        const cx: number = centered ? word(uniform ? 1 : 2) : 0;
        const cy: number = centered ? word(uniform ? 2 : 3) : 0;
        return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
    }

    private colorLine(at: number, variable: boolean, scalars?: Float64Array): ColorLine {
        // A ColorLine has ColorStop records of 6 bytes, a VarColorLine VarColorStop records of 10 with a varIndexBase.
        const stops: Array<ColorStop> = [];
        const size: number = variable ? 10 : 6;
        for (let index: number = 0; index < this.colr.readUInt16BE(at + 1); index++) {
            const stop: number = at + 3 + index * size;
            const base: number = variable ? this.colr.readUInt32BE(stop + 6) : NO_VARIATION;
            stops.push({
                offset: (this.colr.readInt16BE(stop) + this.delta(base, 0, scalars)) / F2DOT14, entry: this.colr.readUInt16BE(stop + 2),
                alpha: (this.colr.readInt16BE(stop + 4) + this.delta(base, 1, scalars)) / F2DOT14
            });
        }
        return { extend: this.colr[at], stops };
    }

    private delta(base: number, item: number, scalars?: Float64Array): number {
        // "A varIndexBase value of 0xFFFFFFFF" has no variation data; without a mapping, an index is outer in the high word and
        // inner in the low word, and with one, an index past its end takes "the last mapping array entry".
        if (base === NO_VARIATION || this.store === undefined || scalars === undefined) {
            return 0;
        }
        const index: number = base + item;
        const map: DeltaSetIndexMap | undefined = this.indexMap;
        if (map === undefined) {
            return this.builder.delta(this.store, scalars, index >>> 16, index & 0xFFFF);
        }
        const entry: number = Math.min(index, map.outer.length - 1);
        return entry < 0 ? 0 : this.builder.delta(this.store, scalars, map.outer[entry], map.inner[entry]);
    }

    private search(start: number, count: number, size: number, glyph: number): number {
        // The records are "sorted in increasing glyphID order", each starting with the glyph ID.
        let low: number = 0;
        let high: number = count - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const found: number = this.colr.readUInt16BE(start + middle * size);
            if (found === glyph) {
                return middle;
            }
            if (found < glyph) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return -1;
    }
}
