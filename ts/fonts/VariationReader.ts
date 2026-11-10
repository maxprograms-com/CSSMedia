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

import type { NameTableReader } from "./NameTableReader.js";
import type {
    AxisRemapping, AxisSegmentMap, DeltaSetIndexMap, FontVariations, GlyphMetricVariations, ItemVariationData, ItemVariationStore,
    MetricVariation, NamedInstance, VariationAxis, VariationRegion
} from "./Typeface.js";

const LONG_WORDS: number = 0x8000;
const WORD_DELTA_COUNT_MASK: number = 0x7FFF;
const INNER_INDEX_BIT_COUNT_MASK: number = 0x0F;
const MAP_ENTRY_SIZE_MASK: number = 0x30;

export class VariationReader {

    read(tables: Readonly<Record<string, Buffer>>, names: NameTableReader): FontVariations | undefined {
        const fvar: Buffer | undefined = tables["fvar"];
        if (fvar === undefined || fvar.length < 16 || fvar.readUInt16BE(0) !== 1) {
            return undefined;
        }
        const axes: Array<VariationAxis> = this.axes(fvar, names);
        // OpenType fvar: a font with no axes is not a variable font, and its variation data is ignored.
        if (axes.length === 0) {
            return undefined;
        }
        const variations: FontVariations = {
            axes,
            instances: this.instances(fvar, axes.length, names),
            metrics: this.metricRecords(tables["MVAR"])
        };
        const segmentMaps: Map<number, AxisSegmentMap> | undefined = this.segmentMaps(axes.length, tables["avar"]);
        if (segmentMaps !== undefined) {
            variations.segmentMaps = segmentMaps;
        }
        const remapping: AxisRemapping | undefined = this.remapping(tables["avar"]);
        const horizontal: GlyphMetricVariations | undefined = this.glyphMetricVariations(false, tables["HVAR"]);
        const vertical: GlyphMetricVariations | undefined = this.glyphMetricVariations(true, tables["VVAR"]);
        const metricsStore: ItemVariationStore | undefined = this.metricsStore(tables["MVAR"]);
        if (remapping !== undefined) {
            variations.remapping = remapping;
        }
        if (horizontal !== undefined) {
            variations.horizontal = horizontal;
        }
        if (vertical !== undefined) {
            variations.vertical = vertical;
        }
        if (metricsStore !== undefined) {
            variations.metricsStore = metricsStore;
        }
        return variations;
    }

    store(table: Buffer, offset: number): ItemVariationStore {
        // OpenType Font Variations Common Table Formats, "Item Variation Store".
        if (table.readUInt16BE(offset) !== 1) {
            throw new Error("An item variation store has an unknown format");
        }
        const regionList: number = offset + table.readUInt32BE(offset + 2);
        const dataCount: number = table.readUInt16BE(offset + 6);
        const axisCount: number = table.readUInt16BE(regionList);
        const regionCount: number = table.readUInt16BE(regionList + 2);
        const regions: Array<VariationRegion> = [];
        for (let region: number = 0; region < regionCount; region++) {
            const record: number = regionList + 4 + region * axisCount * 6;
            const starts: Float64Array = new Float64Array(axisCount);
            const peaks: Float64Array = new Float64Array(axisCount);
            const ends: Float64Array = new Float64Array(axisCount);
            for (let axis: number = 0; axis < axisCount; axis++) {
                starts[axis] = table.readInt16BE(record + axis * 6) / 16384;
                peaks[axis] = table.readInt16BE(record + axis * 6 + 2) / 16384;
                ends[axis] = table.readInt16BE(record + axis * 6 + 4) / 16384;
            }
            regions.push({ starts, peaks, ends });
        }
        const store: ItemVariationStore = { regions };
        let data: Map<number, ItemVariationData> | undefined;
        for (let index: number = 0; index < dataCount; index++) {
            const dataOffset: number = table.readUInt32BE(offset + 8 + index * 4);
            if (dataOffset !== 0) {
                data = data ?? new Map<number, ItemVariationData>();
                data.set(index, this.variationData(table, offset + dataOffset, regionCount));
            }
        }
        if (data !== undefined) {
            store.data = data;
        }
        return store;
    }

    deltaSetIndexMap(table: Buffer, offset: number): DeltaSetIndexMap {
        const format: number = table[offset];
        const entryFormat: number = table[offset + 1];
        const count: number = format === 0 ? table.readUInt16BE(offset + 2) : table.readUInt32BE(offset + 2);
        const dataStart: number = offset + (format === 0 ? 4 : 6);
        const entrySize: number = ((entryFormat & MAP_ENTRY_SIZE_MASK) >> 4) + 1;
        const innerBits: number = (entryFormat & INNER_INDEX_BIT_COUNT_MASK) + 1;
        const outer: Uint16Array = new Uint16Array(count);
        const inner: Uint16Array = new Uint16Array(count);
        for (let index: number = 0; index < count; index++) {
            const entry: number = table.readUIntBE(dataStart + index * entrySize, entrySize);
            outer[index] = Math.floor(entry / (1 << innerBits));
            inner[index] = entry & ((1 << innerBits) - 1);
        }
        return { outer, inner };
    }

    private axes(fvar: Buffer, names: NameTableReader): Array<VariationAxis> {
        const axesOffset: number = fvar.readUInt16BE(4);
        const axisCount: number = fvar.readUInt16BE(8);
        const axisSize: number = fvar.readUInt16BE(10);
        const axes: Array<VariationAxis> = [];
        for (let index: number = 0; index < axisCount; index++) {
            const record: number = axesOffset + index * axisSize;
            if (record + 20 > fvar.length) {
                return [];
            }
            let minimum: number = fvar.readInt32BE(record + 4) / 65536;
            const defaultValue: number = fvar.readInt32BE(record + 8) / 65536;
            let maximum: number = fvar.readInt32BE(record + 12) / 65536;
            if (minimum > defaultValue || maximum < defaultValue) {
                minimum = defaultValue;
                maximum = defaultValue;
            }
            axes.push({
                tag: fvar.toString("latin1", record, record + 4),
                minimum,
                defaultValue,
                maximum,
                name: names.name(fvar.readUInt16BE(record + 18)) ?? ""
            });
        }
        return axes;
    }

    private instances(fvar: Buffer, axisCount: number, names: NameTableReader): Array<NamedInstance> {
        const axesOffset: number = fvar.readUInt16BE(4);
        const axisSize: number = fvar.readUInt16BE(10);
        const instanceCount: number = fvar.readUInt16BE(12);
        const instanceSize: number = fvar.readUInt16BE(14);
        const instances: Array<NamedInstance> = [];
        const seen: Set<string> = new Set<string>();
        for (let index: number = 0; index < instanceCount; index++) {
            const record: number = axesOffset + axisCount * axisSize + index * instanceSize;
            if (record + instanceSize > fvar.length) {
                break;
            }
            const coordinates: Array<number> = [];
            for (let axis: number = 0; axis < axisCount; axis++) {
                coordinates.push(fvar.readInt32BE(record + 4 + axis * 4) / 65536);
            }
            // OpenType fvar: of instances that share coordinates, all but the first can be ignored.
            const key: string = coordinates.join(",");
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            instances.push({ name: names.name(fvar.readUInt16BE(record)) ?? "", coordinates });
        }
        return instances;
    }

    private segmentMaps(axisCount: number, avar?: Buffer): Map<number, AxisSegmentMap> | undefined {
        // avar version 2: "The table format for avar version 2 is the same as avar version 1, appended with offsets to two
        // extra structures".
        let maps: Map<number, AxisSegmentMap> | undefined;
        if (avar === undefined || avar.length < 8 || (avar.readUInt16BE(0) !== 1 && avar.readUInt16BE(0) !== 2)) {
            return maps;
        }
        let position: number = 8;
        for (let axis: number = 0; axis < Math.min(axisCount, avar.readUInt16BE(6)); axis++) {
            const count: number = avar.readUInt16BE(position);
            position += 2;
            const from: Array<number> = [];
            const to: Array<number> = [];
            for (let index: number = 0; index < count; index++) {
                const fromValue: number = avar.readInt16BE(position + index * 4) / 16384;
                const toValue: number = avar.readInt16BE(position + index * 4 + 2) / 16384;
                // OpenType avar: a record out of order in either column may be ignored.
                if (from.length > 0 && (fromValue <= from[from.length - 1] || toValue < to[to.length - 1])) {
                    continue;
                }
                from.push(fromValue);
                to.push(toValue);
            }
            position += count * 4;
            if (this.hasAnchors(from, to)) {
                maps = maps ?? new Map<number, AxisSegmentMap>();
                maps.set(axis, { from: Float64Array.from(from), to: Float64Array.from(to) });
            }
        }
        return maps;
    }

    private remapping(avar?: Buffer): AxisRemapping | undefined {
        // avar version 2: after the segment maps come the offsets of axisIndexMap and varStore, from the start of the table;
        // without a varStore no axis is remapped.
        if (avar === undefined || avar.length < 8 || avar.readUInt16BE(0) !== 2) {
            return undefined;
        }
        let position: number = 8;
        for (let axis: number = 0; axis < avar.readUInt16BE(6); axis++) {
            position += 2 + avar.readUInt16BE(position) * 4;
        }
        if (position + 8 > avar.length) {
            return undefined;
        }
        const mapOffset: number = avar.readUInt32BE(position);
        const storeOffset: number = avar.readUInt32BE(position + 4);
        if (storeOffset === 0) {
            return undefined;
        }
        return mapOffset === 0 ? { store: this.store(avar, storeOffset) } : { store: this.store(avar, storeOffset), indexes: this.deltaSetIndexMap(avar, mapOffset) };
    }

    private hasAnchors(from: ReadonlyArray<number>, to: ReadonlyArray<number>): boolean {
        // OpenType avar: without the -1, 0 and 1 maps, the axis is not modified.
        for (const anchor of [-1, 0, 1]) {
            const index: number = from.indexOf(anchor);
            if (index < 0 || to[index] !== anchor) {
                return false;
            }
        }
        return true;
    }

    private glyphMetricVariations(vertical: boolean, table?: Buffer): GlyphMetricVariations | undefined {
        if (table === undefined || table.length < 12 || table.readUInt16BE(0) !== 1) {
            return undefined;
        }
        // OpenType HVAR and VVAR: the side bearing maps follow the advance map, and only VVAR has a map for vertical origins.
        const storeOffset: number = table.readUInt32BE(4);
        const map: (position: number) => DeltaSetIndexMap | undefined = (position: number): DeltaSetIndexMap | undefined => {
            const offset: number = position + 4 <= table.length ? table.readUInt32BE(position) : 0;
            return offset === 0 ? undefined : this.deltaSetIndexMap(table, offset);
        };
        const variations: GlyphMetricVariations = { store: this.store(table, storeOffset) };
        const advances: DeltaSetIndexMap | undefined = map(8);
        const bearings: DeltaSetIndexMap | undefined = map(12);
        const origins: DeltaSetIndexMap | undefined = vertical ? map(20) : undefined;
        if (advances !== undefined) {
            variations.advances = advances;
        }
        if (bearings !== undefined) {
            variations.bearings = bearings;
        }
        if (origins !== undefined) {
            variations.origins = origins;
        }
        return variations;
    }

    private metricsStore(mvar?: Buffer): ItemVariationStore | undefined {
        if (mvar === undefined || mvar.length < 12 || mvar.readUInt16BE(0) !== 1 || mvar.readUInt16BE(10) === 0) {
            return undefined;
        }
        return this.store(mvar, mvar.readUInt16BE(10));
    }

    private metricRecords(mvar?: Buffer): Array<MetricVariation> {
        const records: Array<MetricVariation> = [];
        if (mvar === undefined || mvar.length < 12 || mvar.readUInt16BE(0) !== 1 || mvar.readUInt16BE(10) === 0) {
            return records;
        }
        const size: number = mvar.readUInt16BE(6);
        const count: number = mvar.readUInt16BE(8);
        for (let index: number = 0; index < count && 12 + index * size + 8 <= mvar.length; index++) {
            const record: number = 12 + index * size;
            records.push({ tag: mvar.toString("latin1", record, record + 4), outer: mvar.readUInt16BE(record + 4), inner: mvar.readUInt16BE(record + 6) });
        }
        return records;
    }

    private variationData(table: Buffer, offset: number, regionCount: number): ItemVariationData {
        const itemCount: number = table.readUInt16BE(offset);
        const wordField: number = table.readUInt16BE(offset + 2);
        const regionIndexCount: number = table.readUInt16BE(offset + 4);
        const regionIndexes: Uint16Array = new Uint16Array(regionIndexCount);
        for (let index: number = 0; index < regionIndexCount; index++) {
            const region: number = table.readUInt16BE(offset + 6 + index * 2);
            if (region >= regionCount) {
                throw new Error("An item variation data table refers to a region that does not exist");
            }
            regionIndexes[index] = region;
        }
        const longWords: boolean = (wordField & LONG_WORDS) !== 0;
        const wordCount: number = wordField & WORD_DELTA_COUNT_MASK;
        const longSize: number = longWords ? 4 : 2;
        const shortSize: number = longWords ? 2 : 1;
        const rowSize: number = wordCount * longSize + (regionIndexCount - wordCount) * shortSize;
        const deltas: Int32Array = new Int32Array(itemCount * regionIndexCount);
        let row: number = offset + 6 + regionIndexCount * 2;
        for (let item: number = 0; item < itemCount; item++) {
            let position: number = row;
            for (let column: number = 0; column < regionIndexCount; column++) {
                const long: boolean = column < wordCount;
                const size: number = long ? longSize : shortSize;
                deltas[item * regionIndexCount + column] = size === 4 ? table.readInt32BE(position) : (size === 2 ? table.readInt16BE(position) : table.readInt8(position));
                position += size;
            }
            row += rowSize;
        }
        return { itemCount, regionIndexes, deltas };
    }
}
