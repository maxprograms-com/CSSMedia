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

interface MyanmarPlan {
    required: ShapeRequest;
    scripts: ReadonlyArray<string>;
    stages: ReadonlyArray<ReadonlyArray<LookupPlan>>;
}

const CLASSES: ReadonlyArray<readonly [number, number, string]> = [
    [0x1004, 0x1004, "k"], [0x101B, 0x101B, "k"], [0x105A, 0x105A, "k"], [0x1000, 0x1020, "C"], [0x103F, 0x103F, "C"], [0x104E, 0x104E, "C"],
    [0x1050, 0x1051, "C"], [0x105B, 0x105D, "C"], [0x1061, 0x1061, "C"], [0x1065, 0x1066, "C"], [0x106E, 0x1070, "C"], [0x1075, 0x1081, "C"],
    [0x108E, 0x108E, "C"], [0xAA60, 0xAA6F, "C"], [0xAA71, 0xAA76, "C"], [0xAA7A, 0xAA7A, "C"], [0x1032, 0x1032, "a"], [0x1036, 0x1036, "a"],
    [0x103A, 0x103A, "q"], [0x1041, 0x1049, "D"], [0x1090, 0x1099, "D"], [0x1040, 0x1040, "0"], [0x1037, 0x1037, "d"], [0x00A0, 0x00A0, "G"],
    [0x00D7, 0x00D7, "G"], [0x2012, 0x2015, "G"], [0x2022, 0x2022, "G"], [0x25CC, 0x25CC, "G"], [0x25FB, 0x25FE, "G"], [0x1039, 0x1039, "H"],
    [0x1021, 0x102A, "I"], [0x1052, 0x1055, "I"], [0x200C, 0x200D, "J"], [0x103E, 0x103E, "h"], [0x1060, 0x1060, "h"], [0x103C, 0x103C, "r"],
    [0x103D, 0x103D, "w"], [0x1082, 0x1082, "w"], [0x103B, 0x103B, "y"], [0x105E, 0x105F, "y"], [0x104A, 0x104B, "P"], [0x1063, 0x1064, "t"],
    [0x1069, 0x106D, "t"], [0xAA7B, 0xAA7B, "t"], [0xAA7C, 0xAA7F, "R"], [0x104C, 0x104D, "S"], [0x104F, 0x104F, "S"], [0x109E, 0x109F, "S"],
    [0xAA70, 0xAA70, "S"], [0xAA77, 0xAA79, "S"], [0x1038, 0x1038, "v"], [0x1087, 0x108D, "v"], [0x108F, 0x108F, "v"], [0x109A, 0x109C, "v"],
    [0x102D, 0x102E, "e"], [0x1033, 0x1035, "e"], [0x1071, 0x1074, "e"], [0x1085, 0x1086, "e"], [0x109D, 0x109D, "e"], [0x102F, 0x1030, "b"],
    [0x1058, 0x1059, "b"], [0x1031, 0x1031, "p"], [0x1084, 0x1084, "p"], [0x102B, 0x102C, "o"], [0x1056, 0x1057, "o"], [0x1062, 0x1062, "o"],
    [0x1067, 0x1068, "o"], [0x1083, 0x1083, "o"], [0xFE00, 0xFE0F, "s"], [0x2060, 0x2060, "W"]
];
const KINZI: string = "(?:kqH)?";
const BASE: string = KINZI + "[CkIDG]s?(?:H[CkI]s?)*";
const CLUSTERS: ReadonlyArray<RegExp> = [
    new RegExp(BASE + "H(?![CkI])", "y"),
    new RegExp(BASE + "q*(?:yq?)?r?(?:wq?|w?hq?)?p*e*b*a*(?:dq?)?(?:oh?q*e*a*(?:dq?)?)*(?:t(?:a?d?q?|q?a?))*v*J?", "y")
];
const MARKS: string = "aqdHhrwytvebpos";
const DOTTED_CIRCLE: number = 0x25CC;
const ALL: number = 1;
const BASIC: ReadonlyArray<string> = ["locl", "rphf", "pref", "blwf", "pstf"];
const REQUIRED: ReadonlyArray<string> = [...BASIC, "pres", "abvs", "blws", "psts", "dist", "mark", "mkmk"];

export class MyanmarShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>(["mym2", "mymr"]);

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Myanmar shaping engine: the clusters are found and reordered, the basic shaping features are applied one after
        // another, and then the presentation and positioning features together.
        const plan: MyanmarPlan = this.planOf(request, instance, (): MyanmarPlan => this.plan(request, instance));
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        const symbols: string = codepoints.map((code: number) => this.symbolOf(code)).join("");
        const infos: Array<GlyphInfo> = [];
        let start: number = 0;
        while (start < codepoints.length) {
            let end: number = start + 1;
            for (const pattern of CLUSTERS) {
                pattern.lastIndex = start;
                if (pattern.test(symbols)) {
                    end = pattern.lastIndex;
                    break;
                }
            }
            const glyphs: Array<GlyphInfo> = this.cluster(codepoints, symbols, start, end);
            for (const lookups of plan.stages) {
                for (const lookup of lookups) {
                    applier?.run(lookup.index, glyphs, ALL, lookup.alternate, request.rtl);
                }
            }
            infos.push(...glyphs);
            start = end;
        }
        this.place(infos, plan.required, plan.scripts, instance);
        return infos;
    }

    private plan(request: ShapeRequest, instance: FontInstance): MyanmarPlan {
        const scripts: Array<string> = [...request.scriptTags, ...FeatureShaper.FALLBACK_SCRIPTS];
        const features: Map<string, number> = new Map<string, number>(request.features);
        REQUIRED.forEach((tag: string) => features.set(tag, 1));
        const required: ShapeRequest = { ...request, features };
        const active: Array<ActiveFeature> = this.layout.gsub === undefined ? [] : this.activeFeatures(this.layout.gsub, required, scripts, instance);
        const stages: Array<Array<LookupPlan>> = BASIC.map((tag: string) => this.lookupsOf(active.filter((feature: ActiveFeature) => feature.record.tag === tag)));
        stages.push(this.lookupsOf(active.filter((feature: ActiveFeature) => !BASIC.includes(feature.record.tag))));
        return { required, scripts, stages };
    }

    private symbolOf(code: number): string {
        for (const [first, last, symbol] of CLASSES) {
            if (code >= first && code <= last) {
                return symbol;
            }
        }
        return "O";
    }

    private cluster(codepoints: ReadonlyArray<number>, symbols: string, start: number, end: number): Array<GlyphInfo> {
        // "Reordering characters": the kinzi goes directly after the cluster base, the medial ra before the base, the pre-base
        // vowels to the start of the cluster, and an anusvara that follows below-base vowels before them.
        const text: string = symbols.substring(start, end);
        const kinzi: number = text.startsWith("kqH") && end - start > 3 ? 3 : 0;
        const leading: Array<GlyphInfo> = [];
        const medial: Array<GlyphInfo> = [];
        const body: Array<GlyphInfo> = [];
        if (MARKS.includes(text[0]) && this.layout.glyphOf(DOTTED_CIRCLE) !== 0) {
            // "inserts a placeholder glyph (U+25CC) wherever combining marks occur without a valid base".
            body.push(this.mapper.single(DOTTED_CIRCLE, start, 0));
        }
        for (let index: number = kinzi; index < text.length; index++) {
            const info: GlyphInfo = this.mapper.single(codepoints[start + index], start, 0, codepoints[start + index + 1]);
            if (text[index] === "p") {
                leading.push(info);
            } else if (text[index] === "r") {
                medial.push(info);
            } else if (text[index] === "a" && index > 0 && text[index - 1] === "b") {
                let below: number = body.length;
                while (below > 0 && this.symbolOf(body[below - 1].codepoint) === "b") {
                    below--;
                }
                body.splice(below, 0, info);
            } else {
                body.push(info);
            }
            if (index === kinzi) {
                for (let part: number = 0; part < kinzi; part++) {
                    body.push(this.mapper.single(codepoints[start + part], start, 0));
                }
            }
        }
        return [...leading, ...medial, ...body];
    }
}
