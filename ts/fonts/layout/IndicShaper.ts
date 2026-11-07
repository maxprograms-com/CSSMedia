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

import { INDIC_CLASSES, INDIC_RANGES } from "../generated/IndicShapingData.js";
import type { FontInstance } from "../Typeface.js";
import type { ActiveFeature, LookupPlan, ShapeRequest } from "./FeatureShaper.js";
import { FeatureShaper } from "./FeatureShaper.js";
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import type { IndicScript } from "./IndicScripts.js";
import { IndicScripts } from "./IndicScripts.js";
import type { SubstitutionApplier } from "./SubstitutionApplier.js";
import type { DecomposedText } from "./UniversalClusters.js";
import { UniversalClusters } from "./UniversalClusters.js";

interface Syllable {
    glyphs: Array<GlyphInfo>;
    lettered: boolean;
    initial: boolean;
}

interface Shaping {
    script: IndicScript;
    required: ShapeRequest;
    scripts: ReadonlyArray<string>;
    lookups: Map<string, Array<LookupPlan>>;
    presentation: ReadonlyArray<LookupPlan>;
    forms: Map<string, boolean>;
    modern: boolean;
}

const BMP_SIZE: number = 0x10000;
const SYMBOLS: Readonly<Record<string, string>> = {
    "C": "C", "V": "V", "N": "N", "H": "H", "M": "M", "SM": "S", "VD": "D", "A": "A", "NBSP": "B", "ZWJ": "j", "ZWNJ": "w", "R": "R", "X": "X"
};
const RA: string = "r";
const CONSONANT: string = "[Cr]";
const SIGNS: string = "(?:M*N?H?)?S?D{0,2}";
const SYLLABLES: ReadonlyArray<RegExp> = [
    new RegExp("R?(?:" + CONSONANT + "N?(?:H[jw]?|[jw]H))*" + CONSONANT + "N?A?(?:H[jw]?|M*N?H?)?S?D{0,2}", "y"),
    new RegExp("(?:rH)?VN?(?:[jw]?H" + CONSONANT + "|j" + CONSONANT + ")?" + SIGNS, "y"),
    new RegExp("(?:rH)?BN?(?:[jw]?H" + CONSONANT + ")?" + SIGNS, "y")
];
const MARKS: string = "NHMSDA";
const DOTTED_CIRCLE: number = 0x25CC;
const CLASS_BITS: number = 4;
const CLASS_MASK: number = (1 << CLASS_BITS) - 1;
const PRE_BASE_FORM: number = 13;
const ALL: number = 1;
const REPH_MASK: number = 256;
const HALF_MASK: number = 512;
const POST_MASK: number = 1024;
const INITIAL_MASK: number = 2048;
const BASIC: ReadonlyArray<readonly [string, number]> = [
    ["locl", ALL], ["nukt", ALL], ["akhn", ALL], ["rphf", REPH_MASK], ["rkrf", ALL], ["pref", POST_MASK], ["blwf", POST_MASK], ["abvf", ALL],
    ["half", HALF_MASK], ["pstf", POST_MASK], ["vatu", ALL], ["cjct", ALL]
];
const REQUIRED: ReadonlyArray<string> = [
    ...BASIC.map((feature: readonly [string, number]) => feature[0]), "init", "pres", "abvs", "blws", "psts", "haln", "dist", "abvm", "blwm", "mark", "mkmk"
];

export class IndicShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = IndicScripts.TAGS;

    private readonly scripts: IndicScripts = new IndicScripts();
    private readonly splitter: UniversalClusters = new UniversalClusters();
    private readonly classes: Uint8Array = new Uint8Array(BMP_SIZE);
    private readonly consonant: number = INDIC_CLASSES.indexOf("C");
    private readonly nukta: number = INDIC_CLASSES.indexOf("N");
    private readonly halant: number = INDIC_CLASSES.indexOf("H");
    private readonly joiner: number = INDIC_CLASSES.indexOf("ZWJ");
    private readonly nonJoiner: number = INDIC_CLASSES.indexOf("ZWNJ");
    private readonly matra: number = INDIC_CLASSES.indexOf("M");
    private readonly sign: number = INDIC_CLASSES.indexOf("SM");
    private readonly vedic: number = INDIC_CLASSES.indexOf("VD");
    private readonly repha: number = INDIC_CLASSES.indexOf("R");

    constructor(layout: FontLayout) {
        super(layout);
        for (const [start, end, value] of INDIC_RANGES) {
            this.classes.fill(value, start, Math.min(end, BMP_SIZE - 1) + 1);
        }
    }

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Indic shaping engine: the syllables, the reordering of each one, the basic shaping features applied one at a time,
        // the final reordering, and then the presentation and positioning features.
        const script: IndicScript | undefined = this.scripts.scriptOf(request.scriptTags);
        if (script === undefined) {
            return super.shape(codepoints, request, instance);
        }
        const shaping: Shaping = this.planOf(request, instance, (): Shaping => this.plan(script, request, instance));
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        const infos: Array<GlyphInfo> = [];
        for (const syllable of this.syllables(this.splitter.decompose(codepoints), script)) {
            const glyphs: Array<GlyphInfo> = syllable.glyphs;
            if (syllable.lettered) {
                this.arrange(glyphs, shaping);
                for (const [tag, mask] of BASIC) {
                    const form: GlyphInfo | undefined = tag === "pref" ? this.outputOf(glyphs, (): void => this.run(tag, glyphs, mask, shaping)) : undefined;
                    if (tag !== "pref") {
                        this.run(tag, glyphs, mask, shaping);
                    } else if (form !== undefined) {
                        form.category = (PRE_BASE_FORM << CLASS_BITS) | (form.category & CLASS_MASK);
                    }
                }
                this.reorder(glyphs, script);
                if (syllable.initial) {
                    glyphs.forEach((info: GlyphInfo) => {
                        info.mask |= INITIAL_MASK;
                    });
                    this.run("init", glyphs, INITIAL_MASK, shaping);
                }
            }
            for (const lookup of shaping.presentation) {
                applier?.run(lookup.index, glyphs, ALL, lookup.alternate, request.rtl);
            }
            for (const info of glyphs) {
                info.ignorable = info.joiner || info.nonJoiner || info.ignorable;
                infos.push(info);
            }
        }
        this.place(infos, shaping.required, shaping.scripts, instance);
        return infos;
    }

    private plan(script: IndicScript, request: ShapeRequest, instance: FontInstance): Shaping {
        const scripts: Array<string> = [...request.scriptTags, ...FeatureShaper.FALLBACK_SCRIPTS];
        const features: Map<string, number> = new Map<string, number>(request.features);
        REQUIRED.forEach((tag: string) => features.set(tag, 1));
        const required: ShapeRequest = { ...request, features };
        const active: Array<ActiveFeature> = this.layout.gsub === undefined ? [] : this.activeFeatures(this.layout.gsub, required, scripts, instance);
        const basic: Set<string> = new Set<string>([...BASIC.map((feature: readonly [string, number]) => feature[0]), "init"]);
        const lookups: Map<string, Array<LookupPlan>> = new Map<string, Array<LookupPlan>>();
        for (const tag of basic) {
            lookups.set(tag, this.lookupsOf(active.filter((feature: ActiveFeature) => feature.record.tag === tag)));
        }
        return {
            script, required, scripts, lookups, forms: new Map<string, boolean>(),
            presentation: this.lookupsOf(active.filter((feature: ActiveFeature) => !basic.has(feature.record.tag))),
            // A font written for the revised shaping model is registered under the second tag of its script, as dev2; the
            // shaping of a font of the old model, registered as deva, will be implemented on demand, if ever needed.
            modern: this.layout.gsub?.languageSystemOf(scripts, request.languageTags)?.scriptTag === script.tags[0]
        };
    }

    private run(tag: string, glyphs: Array<GlyphInfo>, mask: number, shaping: Shaping): void {
        const lookups: Array<LookupPlan> | undefined = shaping.lookups.get(tag);
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        if (lookups === undefined || applier === undefined) {
            return;
        }
        for (const lookup of lookups) {
            applier.run(lookup.index, glyphs, mask, lookup.alternate, shaping.required.rtl);
        }
    }

    private canonicalOrder(text: DecomposedText): void {
        // "Reorder marks to canonical order: Adjacent nukta and halant or nukta and vedic sign are always repositioned if
        // necessary, so that the nukta is first."
        const codes: Array<number> = text.codes;
        const origins: Array<number> = text.origins;
        for (let index: number = 1; index < codes.length; index++) {
            if (codes[index] >= BMP_SIZE || this.classes[codes[index]] !== this.nukta) {
                continue;
            }
            for (let at: number = index; at > 0 && codes[at - 1] < BMP_SIZE && (this.classes[codes[at - 1]] === this.halant || this.classes[codes[at - 1]] === this.vedic); at--) {
                const code: number = codes[at];
                const origin: number = origins[at];
                codes[at] = codes[at - 1];
                origins[at] = origins[at - 1];
                codes[at - 1] = code;
                origins[at - 1] = origin;
            }
        }
    }

    private outputOf(glyphs: Array<GlyphInfo>, apply: () => void): GlyphInfo | undefined {
        // "Only reorder a glyph produced by substitution during application of the 'pref' feature."
        const earlier: Set<GlyphInfo> = new Set<GlyphInfo>(glyphs.filter((info: GlyphInfo) => info.substituted));
        glyphs.forEach((info: GlyphInfo) => {
            info.substituted = false;
        });
        apply();
        const output: GlyphInfo | undefined = glyphs.find((info: GlyphInfo) => info.substituted);
        earlier.forEach((info: GlyphInfo) => {
            info.substituted = true;
        });
        return output;
    }

    private syllables(text: DecomposedText, script: IndicScript): Array<Syllable> {
        // Indic shaping engine, "Find next syllable in the input": the consonant syllable, the vowel-based syllable and the
        // stand alone cluster; any other character is a cluster by itself, a stray mark being an invalid combining mark.
        this.canonicalOrder(text);
        let symbols: string = "";
        for (const code of text.codes) {
            const type: number = code < BMP_SIZE ? this.classes[code] : 0;
            symbols += type === this.consonant && script.ra.includes(code) ? RA : SYMBOLS[INDIC_CLASSES[type]];
        }
        const syllables: Array<Syllable> = [];
        let start: number = 0;
        let lettered: boolean = false;
        while (start < symbols.length) {
            let end: number = start;
            for (const pattern of SYLLABLES) {
                pattern.lastIndex = start;
                if (pattern.test(symbols) && pattern.lastIndex > start) {
                    end = pattern.lastIndex;
                    break;
                }
            }
            const initial: boolean = !lettered;
            lettered = end > start;
            const glyphs: Array<GlyphInfo> = [];
            if (!lettered && MARKS.includes(symbols[start]) && this.layout.glyphOf(DOTTED_CIRCLE) !== 0) {
                glyphs.push(this.mapper.single(DOTTED_CIRCLE, text.origins[start], 0));
            }
            end = Math.max(end, start + 1);
            for (let index: number = start; index < end; index++) {
                const code: number = text.codes[index];
                glyphs.push(this.mapper.single(code, text.origins[start], code < BMP_SIZE ? this.classes[code] : 0, text.codes[index + 1]));
            }
            syllables.push({ glyphs, lettered, initial });
            start = end;
        }
        return syllables;
    }

    private hasForm(code: number, tag: string, shaping: Shaping): boolean {
        // "Retrieving dynamic character properties": rphf and half are applied with locl to Consonant + Halant, and pref, blwf
        // and pstf to Halant + Consonant; a font of the old model has them all on Consonant + Halant.
        const key: string = tag + code;
        let has: boolean | undefined = shaping.forms.get(key);
        if (has === undefined) {
            const consonant: GlyphInfo = this.mapper.single(code, 0, 0);
            const halant: GlyphInfo = this.mapper.single(shaping.script.halant, 0, 0);
            const glyphs: Array<GlyphInfo> = tag === "rphf" || tag === "half" || !shaping.modern ? [consonant, halant] : [halant, consonant];
            this.run("locl", glyphs, ALL, shaping);
            has = this.outputOf(glyphs, (): void => this.run(tag, glyphs, ALL, shaping)) !== undefined;
            shaping.forms.set(key, has);
        }
        return has;
    }

    private typeOf(info: GlyphInfo): number {
        return info.category & CLASS_MASK;
    }

    private positionOf(info: GlyphInfo): number {
        return info.category >> CLASS_BITS;
    }

    private arrange(glyphs: Array<GlyphInfo>, shaping: Shaping): void {
        // "Identify key positions inside syllable": Reph + HalfConsonant(s) + MainConsonant(s) + BelowBaseConsonant(s) +
        // PostBaseConsonant(s) + MatrasAndSigns; each element takes its position and the syllable is put in that order.
        const script: IndicScript = shaping.script;
        const types: Array<number> = glyphs.map((info: GlyphInfo) => info.category);
        const consonants: Array<number> = [];
        types.forEach((type: number, index: number) => {
            if (type === this.consonant) {
                consonants.push(index);
            }
        });
        const isJoiner: (index: number) => boolean = (index: number): boolean => types[index] === this.joiner || types[index] === this.nonJoiner;
        // "If a cluster begins with RA H (halant) ZWJ, the engine must ensure that the 'rphf' feature is not applied", and with
        // one consonant only there is no reph.
        let reph: number = types[0] === this.repha ? 1 : 0;
        if (reph === 0 && glyphs.length > 2 && types[0] === this.consonant && script.ra.includes(glyphs[0].codepoint) && types[1] === this.halant
            && !isJoiner(2) && (consonants.length > 1 || types[2] !== this.consonant) && this.hasForm(glyphs[0].codepoint, "rphf", shaping)) {
            reph = 2;
        }
        const candidates: Array<number> = consonants.filter((index: number) => index >= reph);
        // "Find base consonant": from the end, the first consonant that has no below-base or post-base form and is no pre-base
        // reordering Ra, or the first consonant; "post-base forms have to follow below-base forms".
        const vowelBased: boolean = types[reph] !== this.consonant;
        let base: number = vowelBased || candidates.length === 0 ? reph : candidates[0];
        const places: Map<number, number> = new Map<number, number>();
        let below: boolean = false;
        for (let order: number = candidates.length - 1; order >= (vowelBased ? 0 : 1); order--) {
            const code: number = glyphs[candidates[order]].codepoint;
            if (this.hasForm(code, "blwf", shaping) && !(!below && (this.hasForm(code, "pstf", shaping) || this.hasForm(code, "pref", shaping)))) {
                places.set(candidates[order], IndicScripts.SUBSCRIPT);
                below = true;
            } else if (vowelBased || (!below && (this.hasForm(code, "pstf", shaping) || this.hasForm(code, "pref", shaping)))) {
                places.set(candidates[order], IndicScripts.POSTSCRIPT);
            } else {
                base = candidates[order];
                break;
            }
        }
        let current: number = IndicScripts.MAIN;
        for (let index: number = 0; index < glyphs.length; index++) {
            const type: number = types[index];
            let position: number = current;
            if (index < reph) {
                position = IndicScripts.REPH;
            } else if (index < base) {
                position = IndicScripts.HALF;
            } else if (index > base) {
                if (type === this.halant || type === this.consonant || isJoiner(index)) {
                    // A consonant after the base, with the halant and the joiner before it, has the place of its form.
                    let next: number = index;
                    while (next < glyphs.length && (types[next] === this.halant || isJoiner(next))) {
                        next++;
                    }
                    position = places.get(next) ?? current;
                } else if (type === this.matra) {
                    position = this.scripts.positionOf(script, glyphs[index].codepoint);
                } else if (type === this.sign || type === this.vedic) {
                    position = IndicScripts.SIGNS;
                }
                current = position;
            }
            const info: GlyphInfo = glyphs[index];
            info.category = (position << CLASS_BITS) | type;
            info.ignorable = false;
            info.mask |= position === IndicScripts.REPH ? REPH_MASK : (position === IndicScripts.HALF ? HALF_MASK : 0);
            info.mask |= position === IndicScripts.SUBSCRIPT || position === IndicScripts.POSTSCRIPT ? POST_MASK : 0;
            if (type === this.nonJoiner && position === IndicScripts.HALF) {
                // "The shaping engine must take specific actions to prevent half forms for a sequence of Consonant + Halant + ZWNJ."
                for (let back: number = index - 1; back >= reph && (back === index - 1 || types[back + 1] !== this.consonant); back--) {
                    glyphs[back].mask &= ~HALF_MASK;
                }
            }
        }
        glyphs.sort((first: GlyphInfo, second: GlyphInfo) => this.positionOf(first) - this.positionOf(second));
    }

    private afterHalant(glyphs: ReadonlyArray<GlyphInfo>, base: number): number {
        // "after last standalone halant glyph ... and before the main consonant. If ZWJ or ZWNJ follow this halant, position
        // is moved after it."
        for (let index: number = base - 1; index >= 0; index--) {
            if (this.typeOf(glyphs[index]) === this.halant && !glyphs[index].substituted) {
                return index + 1 < base && (glyphs[index + 1].joiner || glyphs[index + 1].nonJoiner) ? index + 2 : index + 1;
            }
        }
        return -1;
    }

    private reorder(glyphs: Array<GlyphInfo>, script: IndicScript): void {
        // "Final reordering": the pre-base matras, the reph and the pre-base reordering consonant move according to the forms
        // the basic shaping features produced.
        const take: (position: number) => Array<GlyphInfo> = (position: number): Array<GlyphInfo> => {
            const taken: Array<GlyphInfo> = glyphs.filter((info: GlyphInfo) => this.positionOf(info) === position);
            const rest: Array<GlyphInfo> = glyphs.filter((info: GlyphInfo) => this.positionOf(info) !== position);
            glyphs.length = 0;
            glyphs.push(...rest);
            return taken;
        };
        const baseOf: () => number = (): number => {
            const index: number = glyphs.findIndex((info: GlyphInfo) => this.positionOf(info) >= IndicScripts.MAIN && this.positionOf(info) !== PRE_BASE_FORM);
            return index < 0 ? glyphs.length : index;
        };
        const matras: Array<GlyphInfo> = take(IndicScripts.BEFORE_HALF);
        const forms: Array<GlyphInfo> = take(PRE_BASE_FORM);
        const leading: number = Math.max(0, glyphs.findIndex((info: GlyphInfo) => this.positionOf(info) !== IndicScripts.REPH));
        const halant: number = this.afterHalant(glyphs, baseOf());
        glyphs.splice(halant >= 0 ? halant : baseOf(), 0, ...forms);
        glyphs.splice(halant >= 0 ? halant : leading, 0, ...matras);
        const reph: Array<GlyphInfo> = glyphs.filter((info: GlyphInfo) => this.positionOf(info) === IndicScripts.REPH);
        if (reph.length !== 1 || !(reph[0].substituted || this.typeOf(reph[0]) === this.repha)) {
            return;
        }
        take(IndicScripts.REPH);
        // "Reorder reph": after the first explicit halant among the consonants before the base, or else before the first
        // element whose reordering class comes after the class of the reph of the script, or else at the end of the syllable.
        const base: number = baseOf();
        let target: number = script.reph === IndicScripts.AFTER_POSTSCRIPT ? -1
            : glyphs.findIndex((info: GlyphInfo, index: number) => index < base && this.typeOf(info) === this.halant && !info.substituted);
        if (target >= 0) {
            target += target + 1 < glyphs.length && (glyphs[target + 1].joiner || glyphs[target + 1].nonJoiner) ? 2 : 1;
        } else {
            target = glyphs.findIndex((info: GlyphInfo, index: number) => index > base && this.positionOf(info) > script.reph && this.positionOf(info) !== PRE_BASE_FORM);
        }
        glyphs.splice(target < 0 ? glyphs.length : target, 0, ...reph);
    }
}
