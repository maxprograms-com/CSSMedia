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

import type { FontFaceRule } from "../css/Stylesheet.js";

export interface SfntFont {
    flavor: number;
    tables: Readonly<Record<string, Buffer>>;
}

export type CharacterMapMode = 0 | 1 | 2;

export interface VariationSequences {
    selector: number;
    defaultStarts: Uint32Array;
    defaultEnds: Uint32Array;
    codes: Uint32Array;
    glyphs: Uint16Array;
}

export interface CharacterMap {
    starts: Uint32Array;
    ends: Uint32Array;
    modes: Uint8Array;
    bases: Int32Array;
    glyphs: Uint16Array;
    variations: ReadonlyArray<VariationSequences>;
}

export interface FontNames {
    families: ReadonlyArray<string>;
    family: string;
    fullName: string;
    postScriptName: string;
}

export interface LineMetrics {
    ascender: number;
    descender: number;
    lineGap: number;
}

export interface ScriptMetrics {
    xSize: number;
    ySize: number;
    xOffset: number;
    yOffset: number;
}

export interface FaceMetrics {
    unitsPerEm: number;
    bounds: readonly [number, number, number, number];
    horizontal: LineMetrics;
    typographic?: LineMetrics;
    windowsAscent?: number;
    windowsDescent?: number;
    useTypographic: boolean;
    xHeight?: number;
    capHeight?: number;
    underlinePosition?: number;
    underlineThickness?: number;
    strikeoutPosition?: number;
    strikeoutSize?: number;
    subscript?: ScriptMetrics;
    superscript?: ScriptMetrics;
    italicAngle: number;
    fixedPitch: boolean;
    weightClass: number;
    widthClass: number;
    selection: number;
    macStyle: number;
    vertical?: LineMetrics;
}

export interface VerticalOrigins {
    defaultY: number;
    glyphs: Uint16Array;
    values: Int16Array;
}

export interface GlyphMetrics {
    advances: Uint16Array;
    verticalAdvances?: Uint16Array;
    topBearings?: Int16Array;
    verticalOrigins?: VerticalOrigins;
    bounds?: Int16Array;
}

export interface VariationAxis {
    tag: string;
    minimum: number;
    defaultValue: number;
    maximum: number;
    name: string;
}

export interface NamedInstance {
    name: string;
    coordinates: ReadonlyArray<number>;
}

export interface AxisSegmentMap {
    from: Float64Array;
    to: Float64Array;
}

export interface VariationRegion {
    starts: Float64Array;
    peaks: Float64Array;
    ends: Float64Array;
}

export interface ItemVariationData {
    itemCount: number;
    regionIndexes: Uint16Array;
    deltas: Int32Array;
}

export interface ItemVariationStore {
    regions: ReadonlyArray<VariationRegion>;
    data?: ReadonlyMap<number, ItemVariationData>;
}

export interface DeltaSetIndexMap {
    outer: Uint16Array;
    inner: Uint16Array;
}

export interface GlyphMetricVariations {
    store: ItemVariationStore;
    advances?: DeltaSetIndexMap;
    bearings?: DeltaSetIndexMap;
    origins?: DeltaSetIndexMap;
}

export interface MetricVariation {
    tag: string;
    outer: number;
    inner: number;
}

export interface AxisRemapping {
    store: ItemVariationStore;
    indexes?: DeltaSetIndexMap;
}

export interface FontVariations {
    axes: ReadonlyArray<VariationAxis>;
    instances: ReadonlyArray<NamedInstance>;
    segmentMaps?: ReadonlyMap<number, AxisSegmentMap>;
    remapping?: AxisRemapping;
    horizontal?: GlyphMetricVariations;
    vertical?: GlyphMetricVariations;
    metricsStore?: ItemVariationStore;
    metrics: ReadonlyArray<MetricVariation>;
}

export interface BaseCoordinate {
    value: number;
    outer: number;
    inner: number;
}

export interface ScriptBaselines {
    script: string;
    defaultBaseline: string;
    coordinates: Readonly<Record<string, BaseCoordinate>>;
}

export interface BaselineAxis {
    scripts: ReadonlyArray<ScriptBaselines>;
}

export interface FontBaselines {
    horizontal?: BaselineAxis;
    vertical?: BaselineAxis;
    store?: ItemVariationStore;
}

export interface StandardFontData {
    name: string;
    family: string;
    weight: string;
    italicAngle: number;
    fixedPitch: boolean;
    bounds: ReadonlyArray<number>;
    capHeight?: number;
    xHeight?: number;
    ascender?: number;
    descender?: number;
    underlinePosition: number;
    underlineThickness: number;
    stemV: number;
    glyphNames: ReadonlyArray<string>;
    widths: ReadonlyArray<number>;
    boxes: ReadonlyArray<number>;
    codes: ReadonlyArray<ReadonlyArray<number>>;
    kerning: ReadonlyArray<number>;
}

export interface Typeface {
    source: string;
    index: number;
    standardFont?: string;
    tables: Readonly<Record<string, Buffer>>;
    names: FontNames;
    glyphCount: number;
    characters: CharacterMap;
    metrics: FaceMetrics;
    glyphs: GlyphMetrics;
    variations?: FontVariations;
    baselines: FontBaselines;
}

export interface InstalledFace {
    path: string;
    index: number;
    names: FontNames;
    glyphCount: number;
    weightClass: number;
    widthClass: number;
    selection: number;
    macStyle: number;
    axes?: ReadonlyArray<VariationAxis>;
}

export interface CatalogFace {
    family: string;
    origin: "font-face" | "installed" | "standard";
    rule?: FontFaceRule;
    installed?: InstalledFace;
    standard?: string;
}

export type MetricOverride = number | "from-font";

export type AxisOverrides = readonly [MetricOverride | undefined, MetricOverride | undefined];

export interface FaceOverrides {
    sizeAdjust: number;
    ascent: AxisOverrides;
    descent: AxisOverrides;
    lineGap: AxisOverrides;
    superscriptPosition: AxisOverrides;
    subscriptPosition: AxisOverrides;
    superscriptSize: AxisOverrides;
    subscriptSize: AxisOverrides;
}

export interface FontInstance {
    typeface: Typeface;
    coordinates: Float64Array;
    advances: Float64Array;
    verticalAdvances?: Float64Array;
    metrics: FaceMetrics;
    overrides?: FaceOverrides;
    emboldening?: number;
    skew?: number;
}
