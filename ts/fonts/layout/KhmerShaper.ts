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

import type { FontInstance } from "../Typeface.js";
import type { ActiveFeature, LookupPlan, ShapeRequest } from "./FeatureShaper.js";
import { FeatureShaper } from "./FeatureShaper.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import type { SubstitutionApplier } from "./SubstitutionApplier.js";

interface KhmerPlan {
    required: ShapeRequest;
    scripts: ReadonlyArray<string>;
    forms: ReadonlyArray<readonly [Array<LookupPlan>, number]>;
    others: ReadonlyArray<LookupPlan>;
}

const CLASSES: ReadonlyArray<readonly [number, number, string]> = [
    [0x1780, 0x1782, "1"], [0x1783, 0x1783, "3"], [0x1784, 0x1787, "1"], [0x1788, 0x1788, "3"], [0x1789, 0x178C, "1"], [0x178D, 0x178D, "3"],
    [0x178E, 0x1793, "1"], [0x1794, 0x1794, "3"], [0x1795, 0x1798, "1"], [0x1799, 0x1799, "3"], [0x179A, 0x179A, "2"], [0x179B, 0x179D, "1"],
    [0x179E, 0x179F, "3"], [0x17A0, 0x17A0, "1"], [0x17A1, 0x17A1, "3"], [0x17A2, 0x17A2, "1"], [0x17A3, 0x17B3, "1"], [0x17B4, 0x17B5, "I"],
    [0x17B6, 0x17B6, "V"], [0x17B7, 0x17BA, "A"], [0x17BB, 0x17BD, "L"], [0x17BE, 0x17BE, "A"], [0x17BF, 0x17C0, "V"], [0x17C1, 0x17C3, "P"],
    [0x17C4, 0x17C5, "V"], [0x17C6, 0x17C6, "S"], [0x17C7, 0x17C8, "s"], [0x17C9, 0x17CA, "R"], [0x17CB, 0x17CD, "S"], [0x17CE, 0x17D1, "S"],
    [0x17D2, 0x17D2, "c"], [0x17DD, 0x17DD, "S"], [0x17E0, 0x17E9, "N"], [0x17F0, 0x17F9, "N"], [0x200C, 0x200C, "w"]
];
const SYLLABLE: RegExp = /(?:[123IN]|(?=c))(?:c1(?:c[123])?|c2(?:c3)?|c3(?:c3)?)?[PL]?R?w?A?S{0,2}V?s?/y;
const MARKS: string = "cPLRASVs";
const ABOVE_SPLIT: ReadonlySet<number> = new Set<number>([0x17BE]);
const POST_SPLIT: ReadonlySet<number> = new Set<number>([0x17BF, 0x17C0, 0x17C4, 0x17C5]);
const PRE_VOWEL_PART: number = 0x17C1;
const DOTTED_CIRCLE: number = 0x25CC;
const ALL: number = 1;
const PRE_MASK: number = 256;
const BELOW_MASK: number = 512;
const ABOVE_MASK: number = 1024;
const POST_MASK: number = 2048;
const FORMS: ReadonlyArray<readonly [string, number]> = [["pref", PRE_MASK], ["blwf", BELOW_MASK], ["abvf", ABOVE_MASK], ["pstf", POST_MASK]];
const REQUIRED: ReadonlyArray<string> = ["pref", "blwf", "abvf", "pstf", "pres", "blws", "abvs", "psts", "clig", "dist", "blwm", "abvm", "mkmk", "mark"];

export class KhmerShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>(["khmr"]);

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Khmer shaping engine: the syllables are analyzed and reordered, the form features are applied one by one to the
        // glyphs assigned to them, and then the typographical and the positioning features.
        const plan: KhmerPlan = this.planOf(request, instance, (): KhmerPlan => this.plan(request, instance));
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        const symbols: string = codepoints.map((code: number) => this.symbolOf(code)).join("");
        const infos: Array<GlyphInfo> = [];
        let start: number = 0;
        while (start < codepoints.length) {
            // "Exceptions to this ordering are invalid, and will cause a new cluster to be formed that has the dotted circle glyph
            // as the base glyph", so the pattern also matches a COENG and its letter with no base before them.
            SYLLABLE.lastIndex = start;
            const end: number = SYLLABLE.test(symbols) && SYLLABLE.lastIndex > start ? SYLLABLE.lastIndex : start + 1;
            const glyphs: Array<GlyphInfo> = this.syllable(codepoints, symbols, start, end);
            for (const [lookups, mask] of plan.forms) {
                for (const lookup of lookups) {
                    applier?.run(lookup.index, glyphs, mask, lookup.alternate, request.rtl);
                }
            }
            for (const lookup of plan.others) {
                applier?.run(lookup.index, glyphs, ALL, lookup.alternate, request.rtl);
            }
            infos.push(...glyphs);
            start = end;
        }
        this.place(infos, plan.required, plan.scripts, instance);
        return infos;
    }

    private plan(request: ShapeRequest, instance: FontInstance): KhmerPlan {
        const scripts: Array<string> = [...request.scriptTags, ...FeatureShaper.FALLBACK_SCRIPTS];
        const features: Map<string, number> = new Map<string, number>(request.features);
        REQUIRED.forEach((tag: string) => features.set(tag, 1));
        const required: ShapeRequest = { ...request, features };
        const active: Array<ActiveFeature> = this.layout.gsub === undefined ? [] : this.activeFeatures(this.layout.gsub, required, scripts, instance);
        const forms: Array<readonly [Array<LookupPlan>, number]> = FORMS.map((form: readonly [string, number]): readonly [Array<LookupPlan>, number] =>
            [this.lookupsOf(active.filter((feature: ActiveFeature) => feature.record.tag === form[0])), form[1]]);
        const others: Array<LookupPlan> = this.lookupsOf(active.filter((feature: ActiveFeature) => !FORMS.some((form: readonly [string, number]) => form[0] === feature.record.tag)));
        return { required, scripts, forms, others };
    }

    private symbolOf(code: number): string {
        for (const [first, last, symbol] of CLASSES) {
            if (code >= first && code <= last) {
                return symbol;
            }
        }
        return "X";
    }

    private syllable(codepoints: ReadonlyArray<number>, symbols: string, start: number, end: number): Array<GlyphInfo> {
        // "Analyze syllables and reorder characters": a type 1 subscript takes blwf and a type 3 one pstf; COENG + RO goes
        // before the base and takes pref; a register shifter before an above vowel takes blwf; a split vowel takes abvf or pstf.
        const base: Array<GlyphInfo> = [];
        const before: Array<GlyphInfo> = [];
        const after: Array<GlyphInfo> = [];
        const leading: Array<GlyphInfo> = [];
        if (MARKS.includes(symbols[start]) && this.layout.glyphOf(DOTTED_CIRCLE) !== 0) {
            // "a new cluster will be formed that has the dotted circle as the base glyph".
            base.push(this.mapper.single(DOTTED_CIRCLE, start, 0));
        }
        for (let index: number = start; index < end; index++) {
            const code: number = codepoints[index];
            const symbol: string = symbols[index];
            const info: GlyphInfo = this.mapper.single(code, start, 0, codepoints[index + 1]);
            const subscript: string = symbol === "c" && index + 1 < end ? symbols[index + 1] : (index > start && symbols[index - 1] === "c" ? symbol : "");
            if (index === start && base.length === 0) {
                // "Apply feature 'abvf' to Ro and the following COENG to get the Robat glyph" will be implemented on demand,
                // if ever needed; the Robat typed as U+17CC needs nothing here.
                base.push(info);
            } else if (subscript === "2") {
                info.mask |= PRE_MASK;
                before.push(info);
            } else if (subscript !== "") {
                info.mask |= subscript === "1" ? BELOW_MASK : POST_MASK;
                after.push(info);
            } else if (symbol === "P") {
                leading.push(info);
            } else {
                if (ABOVE_SPLIT.has(code) || POST_SPLIT.has(code)) {
                    // "the pre-base vowel part (U+17C1) is prepended to the beginning of the cluster".
                    leading.push(this.mapper.single(PRE_VOWEL_PART, start, 0));
                    info.mask |= ABOVE_SPLIT.has(code) ? ABOVE_MASK : POST_MASK;
                } else if (symbol === "R" && index + 1 < end && symbols[index + 1] === "A") {
                    info.mask |= BELOW_MASK;
                }
                after.push(info);
            }
        }
        return [...leading, ...before, ...base, ...after];
    }
}
