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

import { CompactOutlines } from "./CompactOutlines.js";
import type { OutlineBounds } from "./CompactOutlines.js";
import { GlyphOutlines } from "./GlyphOutlines.js";
import { InstanceBuilder } from "./InstanceBuilder.js";
import { PhantomPointVariations } from "./PhantomPointVariations.js";
import type { TopPhantom } from "./PhantomPointVariations.js";
import type { DeltaSetIndexMap, FontInstance, GlyphMetricVariations, GlyphMetrics, LineMetrics, VerticalOrigins } from "./Typeface.js";

interface InstanceOrigins {
    values: Float64Array;
    synthesized: number;
    varied: boolean;
    compact?: CompactOutlines;
    scalars?: Float64Array;
}

export class VerticalMetrics {

    private static readonly instances: WeakMap<FontInstance, InstanceOrigins> = new WeakMap<FontInstance, InstanceOrigins>();

    private readonly outlines: GlyphOutlines = new GlyphOutlines();
    private readonly phantoms: PhantomPointVariations = new PhantomPointVariations();
    private readonly builder: InstanceBuilder = new InstanceBuilder();

    advance(instance: FontInstance, glyph: number): number {
        // CSS Writing Modes 4 §5.1.1: "The UA must synthesize vertical font metrics for fonts that lack them"; the advance is
        // then the em box, which CSS Inline 3 Appendix A.1 makes of an ascent and a descent that add up to 1em.
        const advances: Float64Array | undefined = instance.verticalAdvances;
        return advances === undefined ? instance.metrics.unitsPerEm : (advances[glyph] ?? 0);
    }

    originX(instance: FontInstance, glyph: number): number {
        // OpenType vmtx: "The x coordinate of a glyph's vertical origin is not specified"; CSS Writing Modes 4 §4.2 aligns
        // upright glyphs on the central baseline, which runs through the middle of the advance width.
        return (instance.advances[glyph] ?? 0) / 2;
    }

    originY(instance: FontInstance, glyph: number): number {
        let origins: InstanceOrigins | undefined = VerticalMetrics.instances.get(instance);
        if (origins === undefined) {
            origins = this.prepare(instance);
            VerticalMetrics.instances.set(instance, origins);
        }
        if (glyph < 0 || glyph >= origins.values.length) {
            return origins.synthesized;
        }
        let value: number = origins.values[glyph];
        if (Number.isNaN(value)) {
            value = this.measure(instance, origins, glyph);
            origins.values[glyph] = value;
        }
        return value;
    }

    private prepare(instance: FontInstance): InstanceOrigins {
        // CSS Inline 3 Appendix A.1: for the em box "the ascent and descent are both proportionally augmented or reduced to
        // add up to exactly 1em"; its over edge is the synthesized origin, from which a 1em advance goes down.
        const lines: LineMetrics = instance.metrics.typographic ?? instance.metrics.horizontal;
        const extent: number = lines.ascender - lines.descender;
        const unitsPerEm: number = instance.metrics.unitsPerEm;
        const tables: Readonly<Record<string, Buffer>> = instance.typeface.tables;
        const glyphs: GlyphMetrics = instance.typeface.glyphs;
        const varied: boolean = instance.coordinates.some((value: number) => value !== 0);
        const variations: GlyphMetricVariations | undefined = instance.typeface.variations?.vertical;
        const measured: boolean = glyphs.topBearings !== undefined && tables["glyf"] === undefined && glyphs.verticalOrigins === undefined;
        const origins: InstanceOrigins = {
            values: new Float64Array(instance.typeface.glyphCount).fill(Number.NaN),
            synthesized: extent > 0 ? lines.ascender * unitsPerEm / extent : unitsPerEm,
            varied
        };
        const compact: CompactOutlines | undefined = measured ? CompactOutlines.of(tables, instance.coordinates) : undefined;
        if (compact !== undefined) {
            origins.compact = compact;
        }
        if (varied && variations !== undefined) {
            origins.scalars = this.builder.scalars(variations.store, instance.coordinates);
        }
        return origins;
    }

    private measure(instance: FontInstance, origins: InstanceOrigins, glyph: number): number {
        // OpenType vmtx: "The y coordinate of a glyph's vertical origin is specified as the sum of the glyph's top side
        // bearing ... and the top (i.e. maximum y) of the glyph's bounding box"; a glyph without outline has no such box.
        const tables: Readonly<Record<string, Buffer>> = instance.typeface.tables;
        const glyphs: GlyphMetrics = instance.typeface.glyphs;
        const bearings: Int16Array | undefined = glyphs.topBearings;
        if (bearings === undefined) {
            return origins.synthesized;
        }
        const variations: GlyphMetricVariations | undefined = instance.typeface.variations?.vertical;
        if (tables["glyf"] !== undefined && tables["loca"] !== undefined) {
            // OpenType VORG: "If present in OpenType fonts containing TrueType outline data, it must be ignored".
            const phantom: TopPhantom = origins.varied ? this.phantoms.topPhantom(tables, instance.coordinates, glyph) : { glyph, delta: 0 };
            const top: number | undefined = this.outlines.header(tables, phantom.glyph)?.yMax;
            return top === undefined ? origins.synthesized : (bearings[phantom.glyph] ?? 0) + top + phantom.delta;
        }
        const recorded: VerticalOrigins | undefined = glyphs.verticalOrigins;
        if (recorded !== undefined) {
            return this.recorded(recorded, glyph) + this.delta(origins, glyph, variations, variations?.origins);
        }
        const bounds: OutlineBounds | undefined = origins.compact?.bounds(glyph);
        return bounds === undefined ? origins.synthesized : bearings[glyph] + this.delta(origins, glyph, variations, variations?.bearings) + bounds.yMax;
    }

    private recorded(origins: VerticalOrigins, glyph: number): number {
        // OpenType VORG: the records are "sorted by glyph ID", and a glyph without record has the default origin.
        let low: number = 0;
        let high: number = origins.glyphs.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (origins.glyphs[middle] === glyph) {
                return origins.values[middle];
            }
            if (origins.glyphs[middle] < glyph) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return origins.defaultY;
    }

    private delta(origins: InstanceOrigins, glyph: number, variations?: GlyphMetricVariations, map?: DeltaSetIndexMap): number {
        // OpenType VVAR: the side bearings and the vertical origins vary only through a mapping subtable, which is required.
        if (variations === undefined || origins.scalars === undefined || map === undefined || map.outer.length === 0) {
            return 0;
        }
        const entry: number = Math.min(glyph, map.outer.length - 1);
        return this.builder.delta(variations.store, origins.scalars, map.outer[entry], map.inner[entry]);
    }
}
