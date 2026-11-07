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

import { PhantomPointVariations } from "./PhantomPointVariations.js";
import { RegionScalar } from "./RegionScalar.js";
import type {
    AxisRemapping, AxisSegmentMap, DeltaSetIndexMap, FaceMetrics, FontInstance, FontVariations, GlyphMetricVariations, ItemVariationData,
    ItemVariationStore, LineMetrics, ScriptMetrics, Typeface, VariationAxis, VariationRegion
} from "./Typeface.js";

const ONE: number = 0x10000;

export class InstanceBuilder {

    static readonly NO_VARIATION: number = 0xFFFF;

    private readonly phantoms: PhantomPointVariations = new PhantomPointVariations();
    private readonly regionScalar: RegionScalar = new RegionScalar();

    build(typeface: Typeface, axisValues: Readonly<Record<string, number>>): FontInstance {
        const advances: Float64Array = Float64Array.from(typeface.glyphs.advances);
        const verticalSource: Uint16Array | undefined = typeface.glyphs.verticalAdvances;
        const verticalAdvances: Float64Array | undefined = verticalSource === undefined ? undefined : Float64Array.from(verticalSource);
        const variations: FontVariations | undefined = typeface.variations;
        if (variations === undefined) {
            return this.instance(typeface, new Float64Array(0), advances, typeface.metrics, verticalAdvances);
        }
        const coordinates: Float64Array = this.normalize(variations, axisValues);
        if (coordinates.every((value: number) => value === 0)) {
            return this.instance(typeface, coordinates, advances, typeface.metrics, verticalAdvances);
        }
        this.glyphVariations(coordinates, advances, variations.horizontal);
        if (verticalAdvances !== undefined) {
            this.glyphVariations(coordinates, verticalAdvances, variations.vertical);
        }
        // OpenType HVAR: in fonts with TrueType outlines, gvar phantom points vary the metrics that HVAR or VVAR do not.
        const needsHorizontal: boolean = variations.horizontal === undefined;
        const needsVertical: boolean = verticalAdvances !== undefined && variations.vertical === undefined;
        if (needsHorizontal || needsVertical) {
            this.phantoms.apply(typeface.tables, coordinates, typeface.glyphCount, needsHorizontal ? advances : undefined, needsVertical ? verticalAdvances : undefined);
        }
        return this.instance(typeface, coordinates, advances, this.metrics(typeface.metrics, variations, coordinates), verticalAdvances);
    }

    private instance(typeface: Typeface, coordinates: Float64Array, advances: Float64Array, metrics: FaceMetrics, verticalAdvances?: Float64Array): FontInstance {
        return verticalAdvances === undefined ? { typeface, coordinates, advances, metrics } : { typeface, coordinates, advances, verticalAdvances, metrics };
    }

    private normalize(variations: FontVariations, axisValues: Readonly<Record<string, number>>): Float64Array {
        // OpenType Font Variations Overview, "Coordinate scales and normalization": 16.16 arithmetic, then 2.14.
        const coordinates: Float64Array = new Float64Array(variations.axes.length);
        for (let index: number = 0; index < variations.axes.length; index++) {
            const axis: VariationAxis = variations.axes[index];
            const requested: number | undefined = axisValues[axis.tag];
            if (requested === undefined || !Number.isFinite(requested)) {
                continue;
            }
            const minimum: number = this.fixed(axis.minimum);
            const defaultValue: number = this.fixed(axis.defaultValue);
            const maximum: number = this.fixed(axis.maximum);
            const value: number = Math.min(Math.max(this.fixed(requested), minimum), maximum);
            // The overview does not say how a 16.16 division rounds, so each quotient goes through its float to 16.16 conversion.
            let normalized: number = 0;
            if (value < defaultValue) {
                normalized = this.fixed(-(defaultValue - value) / (defaultValue - minimum));
            } else if (value > defaultValue) {
                normalized = this.fixed((value - defaultValue) / (maximum - defaultValue));
            }
            normalized = Math.min(Math.max(normalized, -ONE), ONE);
            const map: AxisSegmentMap | undefined = variations.segmentMaps?.get(index);
            if (map !== undefined) {
                normalized = Math.min(Math.max(this.mapSegments(map, normalized), -ONE), ONE);
            }
            coordinates[index] = ((normalized + 2) >> 2) / 16384;
        }
        return variations.remapping === undefined ? coordinates : this.remap(variations.remapping, coordinates);
    }

    private remap(remapping: AxisRemapping, coordinates: Float64Array): Float64Array {
        // avar version 2, step 3: each axis takes the interpolated delta of its entry in varStore, stored in 2.14 units and
        // rounded away from zero on halves, and the result is clamped to [-1, 1]; every delta sees the coordinates of step 2.
        const scalars: Float64Array = this.scalars(remapping.store, coordinates);
        const map: DeltaSetIndexMap | undefined = remapping.indexes;
        const remapped: Float64Array = new Float64Array(coordinates.length);
        for (let axis: number = 0; axis < coordinates.length; axis++) {
            let outer: number = 0;
            let inner: number = axis;
            if (map !== undefined && map.outer.length > 0) {
                // OpenType DeltaSetIndexMap: an index past the end uses the last entry.
                const entry: number = Math.min(axis, map.outer.length - 1);
                outer = map.outer[entry];
                inner = map.inner[entry];
            }
            const delta: number = this.delta(remapping.store, scalars, outer, inner);
            const value: number = Math.round(coordinates[axis] * 16384) + Math.sign(delta) * Math.round(Math.abs(delta));
            remapped[axis] = Math.min(Math.max(value, -16384), 16384) / 16384;
        }
        return remapped;
    }

    scalars(store: ItemVariationStore, coordinates: Float64Array): Float64Array {
        const scalars: Float64Array = new Float64Array(store.regions.length);
        for (let index: number = 0; index < store.regions.length; index++) {
            const region: VariationRegion = store.regions[index];
            scalars[index] = this.regionScalar.compute(region.starts, region.peaks, region.ends, coordinates);
        }
        return scalars;
    }

    delta(store: ItemVariationStore, scalars: Float64Array, outer: number, inner: number): number {
        if (outer === InstanceBuilder.NO_VARIATION && inner === InstanceBuilder.NO_VARIATION) {
            return 0;
        }
        const data: ItemVariationData | undefined = store.data?.get(outer);
        if (data === undefined || inner >= data.itemCount) {
            return 0;
        }
        const columns: number = data.regionIndexes.length;
        let delta: number = 0;
        for (let column: number = 0; column < columns; column++) {
            const scalar: number = scalars[data.regionIndexes[column]];
            if (scalar !== 0) {
                delta += scalar * data.deltas[inner * columns + column];
            }
        }
        return delta;
    }

    private fixed(value: number): number {
        // OpenType: the fraction is rounded half up into the low word; the integer part is two's complement.
        return Math.floor(value * ONE + 0.5);
    }

    private mapSegments(map: AxisSegmentMap, value: number): number {
        // OpenType avar: find the first map whose fromCoordinate is at least the value, and interpolate from the one before.
        for (let index: number = 0; index < map.from.length; index++) {
            const endFrom: number = Math.round(map.from[index] * ONE);
            const endTo: number = Math.round(map.to[index] * ONE);
            if (endFrom < value) {
                continue;
            }
            if (endFrom === value || index === 0) {
                return endTo;
            }
            const startFrom: number = Math.round(map.from[index - 1] * ONE);
            const startTo: number = Math.round(map.to[index - 1] * ONE);
            const ratio: number = (value - startFrom) / (endFrom - startFrom);
            return this.fixed((startTo + ratio * (endTo - startTo)) / ONE);
        }
        return value;
    }

    private glyphVariations(coordinates: Float64Array, values: Float64Array, variations?: GlyphMetricVariations): void {
        if (variations === undefined) {
            return;
        }
        const scalars: Float64Array = this.scalars(variations.store, coordinates);
        const map: DeltaSetIndexMap | undefined = variations.advances;
        for (let glyph: number = 0; glyph < values.length; glyph++) {
            let outer: number = 0;
            let inner: number = glyph;
            if (map !== undefined && map.outer.length > 0) {
                // OpenType DeltaSetIndexMap: an index past the end uses the last entry.
                const entry: number = Math.min(glyph, map.outer.length - 1);
                outer = map.outer[entry];
                inner = map.inner[entry];
            }
            values[glyph] += this.delta(variations.store, scalars, outer, inner);
        }
    }

    private metrics(metrics: FaceMetrics, variations: FontVariations, coordinates: Float64Array): FaceMetrics {
        const store: ItemVariationStore | undefined = variations.metricsStore;
        if (store === undefined || variations.metrics.length === 0) {
            return metrics;
        }
        const scalars: Float64Array = this.scalars(store, coordinates);
        const deltas: Record<string, number> = {};
        for (const record of variations.metrics) {
            deltas[record.tag] = this.delta(store, scalars, record.outer, record.inner);
        }
        const varied: (tag: string, value?: number) => number | undefined = (tag: string, value?: number): number | undefined =>
            value === undefined ? undefined : value + (deltas[tag] ?? 0);
        const typographic: LineMetrics | undefined = metrics.typographic === undefined ? undefined : {
            ascender: metrics.typographic.ascender + (deltas["hasc"] ?? 0),
            descender: metrics.typographic.descender + (deltas["hdsc"] ?? 0),
            lineGap: metrics.typographic.lineGap + (deltas["hlgp"] ?? 0)
        };
        const vertical: LineMetrics | undefined = metrics.vertical === undefined ? undefined : {
            ascender: metrics.vertical.ascender + (deltas["vasc"] ?? 0),
            descender: metrics.vertical.descender + (deltas["vdsc"] ?? 0),
            lineGap: metrics.vertical.lineGap + (deltas["vlgp"] ?? 0)
        };
        // A metric that the font does not have stays out of the copy, and one that it has gets its variation.
        const result: FaceMetrics = { ...metrics };
        const scalar: (name: "windowsAscent" | "windowsDescent" | "xHeight" | "capHeight" | "underlinePosition" | "underlineThickness" | "strikeoutPosition" | "strikeoutSize",
            tag: string) => void = (name: "windowsAscent" | "windowsDescent" | "xHeight" | "capHeight" | "underlinePosition" | "underlineThickness" | "strikeoutPosition"
                | "strikeoutSize", tag: string): void => {
                const value: number | undefined = varied(tag, metrics[name]);
                if (value !== undefined) {
                    result[name] = value;
                }
            };
        scalar("windowsAscent", "hcla");
        scalar("windowsDescent", "hcld");
        scalar("xHeight", "xhgt");
        scalar("capHeight", "cpht");
        scalar("underlinePosition", "undo");
        scalar("underlineThickness", "unds");
        scalar("strikeoutPosition", "stro");
        scalar("strikeoutSize", "strs");
        const subscript: ScriptMetrics | undefined = this.scriptMetrics(deltas, "sb", metrics.subscript);
        const superscript: ScriptMetrics | undefined = this.scriptMetrics(deltas, "sp", metrics.superscript);
        if (typographic !== undefined) {
            result.typographic = typographic;
        }
        if (vertical !== undefined) {
            result.vertical = vertical;
        }
        if (subscript !== undefined) {
            result.subscript = subscript;
        }
        if (superscript !== undefined) {
            result.superscript = superscript;
        }
        return result;
    }

    private scriptMetrics(deltas: Readonly<Record<string, number>>, prefix: string, metrics?: ScriptMetrics): ScriptMetrics | undefined {
        if (metrics === undefined) {
            return undefined;
        }
        return {
            xSize: metrics.xSize + (deltas[prefix + "xs"] ?? 0),
            ySize: metrics.ySize + (deltas[prefix + "ys"] ?? 0),
            xOffset: metrics.xOffset + (deltas[prefix + "xo"] ?? 0),
            yOffset: metrics.yOffset + (deltas[prefix + "yo"] ?? 0)
        };
    }
}
