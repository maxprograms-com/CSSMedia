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

interface HangulPlan {
    required: ShapeRequest;
    scripts: ReadonlyArray<string>;
    jamo: ReadonlyArray<readonly [Array<LookupPlan>, number]>;
    others: ReadonlyArray<LookupPlan>;
}

const SYLLABLE_BASE: number = 0xAC00;
const SYLLABLE_END: number = 0xD7A3;
const LEADING_BASE: number = 0x1100;
const VOWEL_BASE: number = 0x1161;
const TRAILING_BASE: number = 0x11A7;
const LEADING_COUNT: number = 19;
const VOWEL_COUNT: number = 21;
const TRAILING_COUNT: number = 28;
const LEADING_FILLER: number = 0x115F;
const VOWEL_FILLER: number = 0x1160;
const LEADING_SEQUENCES: string = "1102+1109 1102+110C 1102+1112 1103+1105 1103+1106 1103+1107 1103+1109 1103+110C 1105+1100 1105+1100+1100 1105+1103 "
    + "1105+1103+1103 1105+1106 1105+1107 1105+1107+1107 1105+112B 1105+1109 1105+110C 1105+110F 1106+1100 1106+1103 1106+1109 1107+1109+1110 "
    + "1107+110F 1107+1112 1109+1109+1107 110B+1105 110B+1112 110C+110C+1112 1110+1110 1111+1112 1112+1109 1159+1159";
const VOWEL_SEQUENCES: string = "1161+1173 1163+116E 1167+1163 1169+1163 1169+1163+1175 1169+1167 1169+1169+1175 116D+1161 116D+1161+1175 116D+1165 "
    + "116E+1167 116E+1175+1175 1172+1161+1175 1172+1169 1173+1161 1173+1165 1173+1165+1175 1173+1169 1175+1163+1169 1175+1163+1175 1175+1167 "
    + "1175+1167+1175 1175+1169+1175 1175+116D 1175+1172 1175+1175 119E+1161 119E+1165+1175";
const TRAILING_SEQUENCES: string = "11A8+11AB 11A8+11B8 11A8+11BE 11A8+11BF 11A8+11C2 11AB+11AB 11AB+11AF 11AB+11BE 11AE+11AE 11AE+11AE+11B8 11AE+11B8 "
    + "11AE+11BA 11AE+11BA+11A8 11AE+11BD 11AE+11BE 11AE+11C0 11AF+11A8+11A8 11AF+11A8+11C2 11AF+11AF+11BF 11AF+11B7+11C2 11AF+11B8+11AE "
    + "11AF+11B8+11C1 11AF+11F0 11AF+11F9+11C2 11AF+11BC 11B7+11AB 11B7+11AB+11AB 11B7+11B7 11B7+11B8+11BA 11B7+11BD 11B8+11AE 11B8+11AF+11C1 "
    + "11B8+11B7 11B8+11B8 11B8+11BA+11AE 11B8+11BD 11B8+11BE 11BA+11B7 11BA+11E6 11BA+11BA+11A8 11BA+11BA+11AE 11BA+11EB 11BA+11BD 11BA+11BE "
    + "11BA+11C0 11BA+11C2 11EB+11B8 11EB+11E6 11BC+11B7 11BC+11BA 11BC+11C2 11F0+11A8 11F0+11BF 11F0+11C2 11BD+11B8 11BD+11B8+11B8 11BD+11BD "
    + "11C1+11BA 11C1+11C0";
const JAMO_TYPES: ReadonlyArray<string> = ["L", "V", "T"];
const ALL: number = 1;
const LEADING_MASK: number = 256;
const VOWEL_MASK: number = 512;
const TRAILING_MASK: number = 1024;
const JAMO: ReadonlyArray<readonly [string, number]> = [["ccmp", ALL], ["ljmo", LEADING_MASK], ["vjmo", VOWEL_MASK], ["tjmo", TRAILING_MASK]];

export class HangulShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>(["hang", "jamo"]);

    private static readonly REGISTERED: ReadonlySet<number> = new Set<number>(
        (LEADING_SEQUENCES + " " + VOWEL_SEQUENCES + " " + TRAILING_SEQUENCES).split(" ").map((entry: string) => {
            const codes: Array<number> = entry.split("+").map((code: string) => Number.parseInt(code, 16));
            return HangulShaper.keyOf(codes[0], codes[1], codes[2] ?? 0);
        }));

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Hangul shaping engine: a jamo sequence that can form a modern syllable becomes that syllable, and the features are
        // not applied to it; the other sequences take the fillers of the canonical form and the jamo features, one by one.
        const plan: HangulPlan = this.planOf(request, instance, (): HangulPlan => this.plan(request, instance));
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        const symbols: Array<string> = codepoints.map((code: number) => this.symbolOf(code));
        const infos: Array<GlyphInfo> = [];
        let start: number = 0;
        while (start < codepoints.length) {
            const end: number = this.syllableEnd(codepoints, symbols, start);
            let marks: number = end;
            while (marks > start + 1 && symbols[marks - 1] === "M") {
                marks--;
            }
            const codes: Array<number> = [...this.canonical(codepoints.slice(start, marks)), ...codepoints.slice(marks, end)];
            const glyphs: Array<GlyphInfo> = codes.map((code: number, index: number) => {
                const info: GlyphInfo = this.mapper.single(code, start, 0, index + 1 < codes.length ? codes[index + 1] : codepoints[end]);
                const symbol: string = this.symbolOf(code);
                info.mask |= symbol === "L" ? LEADING_MASK : (symbol === "V" ? VOWEL_MASK : (symbol === "T" ? TRAILING_MASK : 0));
                return info;
            });
            if (codes.some((code: number) => JAMO_TYPES.includes(this.symbolOf(code)))) {
                for (const [lookups, mask] of plan.jamo) {
                    for (const lookup of lookups) {
                        applier?.run(lookup.index, glyphs, mask, lookup.alternate, request.rtl);
                    }
                }
            }
            infos.push(...glyphs);
            start = end;
        }
        // Only the jamo features work inside a syllable; a contextual feature such as calt also looks at what is around it.
        for (const lookup of plan.others) {
            applier?.run(lookup.index, infos, ALL, lookup.alternate, request.rtl);
        }
        this.place(infos, plan.required, plan.scripts, instance);
        return infos;
    }

    private plan(request: ShapeRequest, instance: FontInstance): HangulPlan {
        const scripts: Array<string> = [...request.scriptTags, ...FeatureShaper.FALLBACK_SCRIPTS];
        const features: Map<string, number> = new Map<string, number>(request.features);
        JAMO.forEach((feature: readonly [string, number]) => features.set(feature[0], 1));
        const required: ShapeRequest = { ...request, features };
        const active: Array<ActiveFeature> = this.layout.gsub === undefined ? [] : this.activeFeatures(this.layout.gsub, required, scripts, instance);
        const jamo: Array<readonly [Array<LookupPlan>, number]> = JAMO.map((feature: readonly [string, number]): readonly [Array<LookupPlan>, number] =>
            [this.lookupsOf(active.filter((entry: ActiveFeature) => entry.record.tag === feature[0])), feature[1]]);
        const others: Array<LookupPlan> = this.lookupsOf(active.filter((entry: ActiveFeature) => !JAMO.some((feature: readonly [string, number]) => feature[0] === entry.record.tag)));
        return { required, scripts, jamo, others };
    }

    private syllableEnd(codepoints: ReadonlyArray<number>, symbols: ReadonlyArray<string>, start: number): number {
        // Hangul shaping engine: "each Hangul syllable has the canonical format of LVT" of registered Jamos, and the Jamos
        // after a precomposed syllable continue its vowel or its trailing consonant; a tone mark needs a syllable before it.
        const first: string = symbols[start];
        let position: number = start;
        if (first === "S") {
            const index: number = codepoints[start] - SYLLABLE_BASE;
            const trailing: number = index % TRAILING_COUNT;
            position++;
            if (trailing === 0) {
                position += this.jamoLength(codepoints, symbols, position, "V", VOWEL_BASE + Math.floor(index / TRAILING_COUNT) % VOWEL_COUNT) - 1;
                position += this.jamoLength(codepoints, symbols, position, "T", 0);
            } else {
                position += this.jamoLength(codepoints, symbols, position, "T", TRAILING_BASE + trailing) - 1;
            }
        } else if (JAMO_TYPES.includes(first)) {
            for (const type of JAMO_TYPES) {
                position += this.jamoLength(codepoints, symbols, position, type, 0);
            }
        } else {
            return start + 1;
        }
        while (position < symbols.length && symbols[position] === "M") {
            position++;
        }
        return position;
    }

    private jamoLength(codepoints: ReadonlyArray<number>, symbols: ReadonlyArray<string>, position: number, type: string, before: number): number {
        // "the shaping engine identifies the maximum length of characters which can combine to form registered Jamos ...
        // This process is repeated on the next longest string in the sequence": a sequence of three comes before one of two.
        const run: Array<number> = before === 0 ? [] : [before];
        for (let index: number = position; index < symbols.length && symbols[index] === type && run.length < 4; index++) {
            run.push(codepoints[index]);
        }
        const registered: ReadonlySet<number> = HangulShaper.REGISTERED;
        if (run.length >= 3 && registered.has(HangulShaper.keyOf(run[0], run[1], run[2]))) {
            return 3;
        }
        if (run.length >= 2 && registered.has(HangulShaper.keyOf(run[0], run[1], 0)) && !(run.length >= 4 && registered.has(HangulShaper.keyOf(run[1], run[2], run[3])))) {
            return 2;
        }
        return run.length === 0 ? 0 : 1;
    }

    private static keyOf(first: number, second: number, third: number): number {
        return (first * 0x10000 + second) * 0x10000 + third;
    }

    private symbolOf(code: number): string {
        if (code === 0x302E || code === 0x302F) {
            return "M";
        }
        if ((code >= 0x1100 && code <= 0x115F) || (code >= 0xA960 && code <= 0xA97C)) {
            return "L";
        }
        if ((code >= 0x1160 && code <= 0x11A7) || (code >= 0xD7B0 && code <= 0xD7C6)) {
            return "V";
        }
        if ((code >= 0x11A8 && code <= 0x11FF) || (code >= 0xD7CB && code <= 0xD7FB)) {
            return "T";
        }
        return code >= SYLLABLE_BASE && code <= SYLLABLE_END ? "S" : "O";
    }

    private canonical(codes: Array<number>): Array<number> {
        // Unicode §3.12, Hangul syllable composition: a modern leading consonant and vowel, with or without a modern trailing
        // consonant, are one precomposed syllable, which is used when the font has it.
        let jamo: Array<number> = codes;
        const first: number = codes[0];
        if (first >= SYLLABLE_BASE && first <= SYLLABLE_END && codes.length > 1) {
            const index: number = first - SYLLABLE_BASE;
            const trailing: number = index % TRAILING_COUNT;
            jamo = [LEADING_BASE + Math.floor(index / (VOWEL_COUNT * TRAILING_COUNT)), VOWEL_BASE + Math.floor(index / TRAILING_COUNT) % VOWEL_COUNT,
                ...(trailing === 0 ? [] : [TRAILING_BASE + trailing]), ...codes.slice(1)];
        }
        const leading: number = jamo[0] - LEADING_BASE;
        const vowel: number = jamo.length > 1 ? jamo[1] - VOWEL_BASE : -1;
        const trailing: number = jamo.length > 2 ? jamo[2] - TRAILING_BASE : 0;
        if (jamo.length >= 2 && jamo.length <= 3 && leading >= 0 && leading < LEADING_COUNT && vowel >= 0 && vowel < VOWEL_COUNT
            && trailing >= (jamo.length === 3 ? 1 : 0) && trailing < TRAILING_COUNT) {
            const syllable: number = SYLLABLE_BASE + (leading * VOWEL_COUNT + vowel) * TRAILING_COUNT + trailing;
            if (this.layout.glyphOf(syllable) !== 0) {
                return [syllable];
            }
        }
        // "fillers Lf and Vf, are then added, where required, in the registered Jamo sequence to convert each of them to
        // canonical form."
        const symbols: Array<string> = jamo.map((code: number) => this.symbolOf(code));
        if (symbols[0] === "V" || symbols[0] === "T") {
            jamo = [LEADING_FILLER, ...jamo];
            symbols.unshift("L");
        }
        if (symbols[0] === "L" && !symbols.includes("V")) {
            const leadingEnd: number = symbols.lastIndexOf("L") + 1;
            jamo = [...jamo.slice(0, leadingEnd), VOWEL_FILLER, ...jamo.slice(leadingEnd)];
        }
        return jamo;
    }
}
