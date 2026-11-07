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

import { Coverage } from "../fonts/layout/Coverage.js";
import type { FaceMetrics } from "../fonts/Typeface.js";

export interface MathConstants {
    scriptPercentScaleDown: number;
    scriptScriptPercentScaleDown: number;
    displayOperatorMinHeight: number;
    axisHeight: number;
    accentBaseHeight: number;
    subscriptShiftDown: number;
    subscriptTopMax: number;
    subscriptBaselineDropMin: number;
    superscriptShiftUp: number;
    superscriptShiftUpCramped: number;
    superscriptBottomMin: number;
    superscriptBaselineDropMax: number;
    subSuperscriptGapMin: number;
    superscriptBottomMaxWithSubscript: number;
    spaceAfterScript: number;
    upperLimitGapMin: number;
    upperLimitBaselineRiseMin: number;
    lowerLimitGapMin: number;
    lowerLimitBaselineDropMin: number;
    stackTopShiftUp: number;
    stackTopDisplayStyleShiftUp: number;
    stackBottomShiftDown: number;
    stackBottomDisplayStyleShiftDown: number;
    stackGapMin: number;
    stackDisplayStyleGapMin: number;
    stretchStackTopShiftUp: number;
    stretchStackBottomShiftDown: number;
    stretchStackGapAboveMin: number;
    stretchStackGapBelowMin: number;
    fractionNumeratorShiftUp: number;
    fractionNumeratorDisplayStyleShiftUp: number;
    fractionDenominatorShiftDown: number;
    fractionDenominatorDisplayStyleShiftDown: number;
    fractionNumeratorGapMin: number;
    fractionNumDisplayStyleGapMin: number;
    fractionRuleThickness: number;
    fractionDenominatorGapMin: number;
    fractionDenomDisplayStyleGapMin: number;
    skewedFractionHorizontalGap: number;
    skewedFractionVerticalGap: number;
    overbarVerticalGap: number;
    overbarRuleThickness: number;
    overbarExtraAscender: number;
    underbarVerticalGap: number;
    underbarRuleThickness: number;
    underbarExtraDescender: number;
    radicalVerticalGap: number;
    radicalDisplayStyleVerticalGap: number;
    radicalRuleThickness: number;
    radicalExtraAscender: number;
    radicalKernBeforeDegree: number;
    radicalKernAfterDegree: number;
    radicalDegreeBottomRaisePercent: number;
}

export interface GlyphPart {
    glyph: number;
    start: number;
    end: number;
    advance: number;
    extender: boolean;
}

export interface GlyphAssembly {
    italicsCorrection: number;
    parts: ReadonlyArray<GlyphPart>;
}

export interface GlyphConstruction {
    variants: ReadonlyArray<readonly [number, number]>;
    assembly?: GlyphAssembly;
}

const RECORD: number = 4;
const PART: number = 10;
const EXTENDER: number = 0x0001;
const SCRIPT_SCALE: number = 0.71;
const SCRIPT_SCRIPT_SCALE: number = 0.5041;
const SPACE_AFTER_SCRIPT: number = 1 / 24;
const KERN_BEFORE_DEGREE: number = 5 / 18;
const KERN_AFTER_DEGREE: number = -10 / 18;
const DEGREE_BOTTOM_RAISE: number = 0.6;
const CONSTANTS_SIZE: number = 214;
const VALUE_OFFSETS: Readonly<Record<string, number>> = {
    axisHeight: 12, accentBaseHeight: 16, subscriptShiftDown: 24, subscriptTopMax: 28, subscriptBaselineDropMin: 32, superscriptShiftUp: 36,
    superscriptShiftUpCramped: 40, superscriptBottomMin: 44, superscriptBaselineDropMax: 48, subSuperscriptGapMin: 52, superscriptBottomMaxWithSubscript: 56,
    spaceAfterScript: 60, upperLimitGapMin: 64, upperLimitBaselineRiseMin: 68, lowerLimitGapMin: 72, lowerLimitBaselineDropMin: 76, stackTopShiftUp: 80,
    stackTopDisplayStyleShiftUp: 84, stackBottomShiftDown: 88, stackBottomDisplayStyleShiftDown: 92, stackGapMin: 96, stackDisplayStyleGapMin: 100,
    stretchStackTopShiftUp: 104, stretchStackBottomShiftDown: 108, stretchStackGapAboveMin: 112, stretchStackGapBelowMin: 116, fractionNumeratorShiftUp: 120,
    fractionNumeratorDisplayStyleShiftUp: 124, fractionDenominatorShiftDown: 128, fractionDenominatorDisplayStyleShiftDown: 132, fractionNumeratorGapMin: 136,
    fractionNumDisplayStyleGapMin: 140, fractionRuleThickness: 144, fractionDenominatorGapMin: 148, fractionDenomDisplayStyleGapMin: 152,
    skewedFractionHorizontalGap: 156, skewedFractionVerticalGap: 160, overbarVerticalGap: 164,
    overbarRuleThickness: 168, overbarExtraAscender: 172, underbarVerticalGap: 176, underbarRuleThickness: 180, underbarExtraDescender: 184, radicalVerticalGap: 188, radicalDisplayStyleVerticalGap: 192,
    radicalRuleThickness: 196, radicalExtraAscender: 200, radicalKernBeforeDegree: 204, radicalKernAfterDegree: 208
};

export class MathTable {

    private readonly table?: Buffer;
    private readonly constantsAt?: number;
    private readonly italics?: readonly [Coverage, number];
    private readonly accents?: readonly [Coverage, number];
    private readonly variantsAt?: number;
    private readonly vertical?: Coverage;
    private readonly horizontal?: Coverage;
    private readonly constructions: Map<number, GlyphConstruction | null> = new Map<number, GlyphConstruction | null>();

    constructor(table?: Buffer) {
        // OpenType MATH: a header of version, then the offsets of MathConstants, MathGlyphInfo and MathVariants; MathML Core §5:
        // a part that a missing table or an invalid offset hides is not available.
        if (table === undefined || table.length < 10) {
            return;
        }
        this.table = table;
        const constants: number = table.readUInt16BE(4);
        if (constants !== 0 && constants + CONSTANTS_SIZE <= table.length) {
            this.constantsAt = constants;
        }
        const info: number = table.readUInt16BE(6);
        const italics: readonly [Coverage, number] | undefined = info !== 0 && info + 4 <= table.length ? this.covered(info, table.readUInt16BE(info)) : undefined;
        const accents: readonly [Coverage, number] | undefined = info !== 0 && info + 4 <= table.length ? this.covered(info, table.readUInt16BE(info + 2)) : undefined;
        if (italics !== undefined) {
            this.italics = italics;
        }
        if (accents !== undefined) {
            this.accents = accents;
        }
        const variants: number = table.readUInt16BE(8);
        if (variants !== 0 && variants + 10 <= table.length) {
            this.variantsAt = variants;
            const vertical: number = table.readUInt16BE(variants + 2);
            const horizontal: number = table.readUInt16BE(variants + 4);
            if (vertical !== 0) {
                this.vertical = new Coverage(table, variants + vertical);
            }
            if (horizontal !== 0) {
                this.horizontal = new Coverage(table, variants + horizontal);
            }
        }
    }

    scaleDowns(): readonly [number, number] | undefined {
        // MathML Core §4.5 asks whether the font "has an OpenType MATH table", and §5.1 gives each percentage divided by 100,
        // or its fallback when it is "null or not available".
        if (this.table === undefined) {
            return undefined;
        }
        const script: number = this.constantsAt === undefined ? 0 : this.table.readInt16BE(this.constantsAt);
        const scriptScript: number = this.constantsAt === undefined ? 0 : this.table.readInt16BE(this.constantsAt + 2);
        return [script === 0 ? SCRIPT_SCALE : script / 100, scriptScript === 0 ? SCRIPT_SCRIPT_SCALE : scriptScript / 100];
    }

    constants(metrics: FaceMetrics, size: number): MathConstants {
        // MathML Core §5.1: each constant of MathConstants, or its fallback when the constant is not available, in pixels for the
        // font size; device corrections are not applied.
        const scale: number = size / metrics.unitsPerEm;
        const rule: number = (metrics.underlineThickness ?? 0) * scale;
        const xHeight: number = (metrics.xHeight ?? 0) * scale;
        const value: (name: string, fallback: number) => number = (name: string, fallback: number): number =>
            this.table === undefined || this.constantsAt === undefined ? fallback : this.table.readInt16BE(this.constantsAt + VALUE_OFFSETS[name]) * scale;
        const scaleDowns: readonly [number, number] = this.scaleDowns() ?? [SCRIPT_SCALE, SCRIPT_SCRIPT_SCALE];
        const percent: number | undefined = this.table === undefined || this.constantsAt === undefined ? undefined : this.table.readInt16BE(this.constantsAt + CONSTANTS_SIZE - 2);
        return {
            scriptPercentScaleDown: scaleDowns[0],
            scriptScriptPercentScaleDown: scaleDowns[1],
            displayOperatorMinHeight: this.table === undefined || this.constantsAt === undefined ? 0 : this.table.readUInt16BE(this.constantsAt + 6) * scale,
            axisHeight: value("axisHeight", xHeight / 2),
            accentBaseHeight: value("accentBaseHeight", xHeight),
            subscriptShiftDown: value("subscriptShiftDown", (metrics.subscript?.yOffset ?? 0) * scale),
            subscriptTopMax: value("subscriptTopMax", xHeight * 4 / 5),
            subscriptBaselineDropMin: value("subscriptBaselineDropMin", 0),
            superscriptShiftUp: value("superscriptShiftUp", (metrics.superscript?.yOffset ?? 0) * scale),
            superscriptShiftUpCramped: value("superscriptShiftUpCramped", 0),
            superscriptBottomMin: value("superscriptBottomMin", xHeight / 4),
            superscriptBaselineDropMax: value("superscriptBaselineDropMax", 0),
            subSuperscriptGapMin: value("subSuperscriptGapMin", 4 * rule),
            superscriptBottomMaxWithSubscript: value("superscriptBottomMaxWithSubscript", xHeight * 4 / 5),
            spaceAfterScript: value("spaceAfterScript", size * SPACE_AFTER_SCRIPT),
            upperLimitGapMin: value("upperLimitGapMin", 0),
            upperLimitBaselineRiseMin: value("upperLimitBaselineRiseMin", 0),
            lowerLimitGapMin: value("lowerLimitGapMin", 0),
            lowerLimitBaselineDropMin: value("lowerLimitBaselineDropMin", 0),
            stackTopShiftUp: value("stackTopShiftUp", 0),
            stackTopDisplayStyleShiftUp: value("stackTopDisplayStyleShiftUp", 0),
            stackBottomShiftDown: value("stackBottomShiftDown", 0),
            stackBottomDisplayStyleShiftDown: value("stackBottomDisplayStyleShiftDown", 0),
            stackGapMin: value("stackGapMin", 3 * rule),
            stackDisplayStyleGapMin: value("stackDisplayStyleGapMin", 7 * rule),
            stretchStackTopShiftUp: value("stretchStackTopShiftUp", 0),
            stretchStackBottomShiftDown: value("stretchStackBottomShiftDown", 0),
            stretchStackGapAboveMin: value("stretchStackGapAboveMin", 0),
            stretchStackGapBelowMin: value("stretchStackGapBelowMin", 0),
            fractionNumeratorShiftUp: value("fractionNumeratorShiftUp", 0),
            fractionNumeratorDisplayStyleShiftUp: value("fractionNumeratorDisplayStyleShiftUp", 0),
            fractionDenominatorShiftDown: value("fractionDenominatorShiftDown", 0),
            fractionDenominatorDisplayStyleShiftDown: value("fractionDenominatorDisplayStyleShiftDown", 0),
            fractionNumeratorGapMin: value("fractionNumeratorGapMin", rule),
            fractionNumDisplayStyleGapMin: value("fractionNumDisplayStyleGapMin", 3 * rule),
            fractionRuleThickness: value("fractionRuleThickness", rule),
            fractionDenominatorGapMin: value("fractionDenominatorGapMin", rule),
            fractionDenomDisplayStyleGapMin: value("fractionDenomDisplayStyleGapMin", 3 * rule),
            skewedFractionHorizontalGap: value("skewedFractionHorizontalGap", 0),
            skewedFractionVerticalGap: value("skewedFractionVerticalGap", 0),
            overbarVerticalGap: value("overbarVerticalGap", 3 * rule),
            overbarRuleThickness: value("overbarRuleThickness", rule),
            overbarExtraAscender: value("overbarExtraAscender", rule),
            underbarVerticalGap: value("underbarVerticalGap", 3 * rule),
            underbarRuleThickness: value("underbarRuleThickness", rule),
            underbarExtraDescender: value("underbarExtraDescender", rule),
            radicalVerticalGap: value("radicalVerticalGap", rule * 5 / 4),
            radicalDisplayStyleVerticalGap: value("radicalDisplayStyleVerticalGap", rule + xHeight / 4),
            radicalRuleThickness: value("radicalRuleThickness", rule),
            radicalExtraAscender: value("radicalExtraAscender", rule),
            radicalKernBeforeDegree: value("radicalKernBeforeDegree", size * KERN_BEFORE_DEGREE),
            radicalKernAfterDegree: value("radicalKernAfterDegree", size * KERN_AFTER_DEGREE),
            radicalDegreeBottomRaisePercent: percent === undefined ? DEGREE_BOTTOM_RAISE : percent / 100
        };
    }

    italicsCorrection(glyph: number): number | undefined {
        // MathML Core §5.2: the value of MathItalicsCorrectionInfo for the glyph, in design units.
        return this.glyphValue(this.italics, glyph);
    }

    topAccentAttachment(glyph: number): number | undefined {
        return this.glyphValue(this.accents, glyph);
    }

    minConnectorOverlap(): number {
        return this.table === undefined || this.variantsAt === undefined ? 0 : this.table.readUInt16BE(this.variantsAt);
    }

    construction(glyph: number, inline: boolean): GlyphConstruction | undefined {
        // OpenType MATH: MathVariants lists the vertical constructions, then the horizontal ones, each in the order of its
        // coverage; a construction holds its size variants and its glyph assembly.
        const coverage: Coverage | undefined = inline ? this.horizontal : this.vertical;
        const table: Buffer | undefined = this.table;
        const base: number | undefined = this.variantsAt;
        if (coverage === undefined || table === undefined || base === undefined) {
            return undefined;
        }
        const index: number = coverage.indexOf(glyph);
        if (index < 0) {
            return undefined;
        }
        const key: number = inline ? -1 - glyph : glyph;
        const known: GlyphConstruction | null | undefined = this.constructions.get(key);
        if (known !== undefined) {
            return known ?? undefined;
        }
        const verticalCount: number = table.readUInt16BE(base + 6);
        const slot: number = base + 10 + 2 * ((inline ? verticalCount : 0) + index);
        const offset: number = slot + 2 <= table.length ? table.readUInt16BE(slot) : 0;
        const construction: GlyphConstruction | undefined = offset === 0 ? undefined : this.readConstruction(base + offset);
        this.constructions.set(key, construction ?? null);
        return construction;
    }

    private readConstruction(at: number): GlyphConstruction | undefined {
        const table: Buffer = this.table as Buffer;
        if (at + 4 > table.length) {
            return undefined;
        }
        const assemblyOffset: number = table.readUInt16BE(at);
        const count: number = table.readUInt16BE(at + 2);
        const variants: Array<readonly [number, number]> = [];
        for (let index: number = 0; index < count && at + 4 + (index + 1) * RECORD <= table.length; index++) {
            const record: number = at + 4 + index * RECORD;
            variants.push([table.readUInt16BE(record), table.readUInt16BE(record + 2)]);
        }
        const construction: GlyphConstruction = { variants };
        const assembly: number = at + assemblyOffset;
        if (assemblyOffset !== 0 && assembly + 6 <= table.length) {
            const partCount: number = table.readUInt16BE(assembly + 4);
            const parts: Array<GlyphPart> = [];
            for (let index: number = 0; index < partCount && assembly + 6 + (index + 1) * PART <= table.length; index++) {
                const record: number = assembly + 6 + index * PART;
                parts.push({
                    glyph: table.readUInt16BE(record), start: table.readUInt16BE(record + 2), end: table.readUInt16BE(record + 4), advance: table.readUInt16BE(record + 6),
                    extender: (table.readUInt16BE(record + 8) & EXTENDER) !== 0
                });
            }
            construction.assembly = { italicsCorrection: table.readInt16BE(assembly), parts };
        }
        return construction;
    }

    private covered(info: number, offset: number): readonly [Coverage, number] | undefined {
        // MathItalicsCorrectionInfo and MathTopAccentAttachment: a coverage, a count, and one MathValueRecord for each glyph.
        const table: Buffer = this.table as Buffer;
        const at: number = info + offset;
        if (offset === 0 || at + 4 > table.length) {
            return undefined;
        }
        const coverage: number = table.readUInt16BE(at);
        return coverage === 0 ? undefined : [new Coverage(table, at + coverage), at];
    }

    private glyphValue(entry: readonly [Coverage, number] | undefined, glyph: number): number | undefined {
        const table: Buffer | undefined = this.table;
        if (entry === undefined || table === undefined) {
            return undefined;
        }
        const index: number = entry[0].indexOf(glyph);
        const count: number = table.readUInt16BE(entry[1] + 2);
        const record: number = entry[1] + 4 + index * RECORD;
        return index < 0 || index >= count || record + 2 > table.length ? undefined : table.readInt16BE(record);
    }
}
