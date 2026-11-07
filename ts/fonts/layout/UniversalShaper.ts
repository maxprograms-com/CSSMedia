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
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import type { SubstitutionApplier } from "./SubstitutionApplier.js";
import type { DecomposedText } from "./UniversalClusters.js";
import { UniversalClusters } from "./UniversalClusters.js";

interface UniversalPlan {
    required: ShapeRequest;
    scripts: ReadonlyArray<string>;
    preprocessing: ReadonlyArray<LookupPlan>;
    reph: ReadonlyArray<LookupPlan>;
    preBase: ReadonlyArray<LookupPlan>;
    orthographic: ReadonlyArray<LookupPlan>;
    topographical: ReadonlyArray<LookupPlan>;
    others: ReadonlyArray<LookupPlan>;
}

const PREPROCESSING: ReadonlyArray<string> = ["rvrn", "locl", "ccmp", "nukt", "akhn"];
const REPH: ReadonlyArray<string> = ["rphf"];
const PRE_BASE: ReadonlyArray<string> = ["pref"];
const ORTHOGRAPHIC: ReadonlyArray<string> = ["rkrf", "abvf", "blwf", "half", "pstf", "vatu", "cjct"];
const TOPOGRAPHICAL: ReadonlyArray<string> = ["isol", "init", "medi", "fina"];
const REQUIRED: ReadonlyArray<string> = [
    ...PREPROCESSING, ...REPH, ...PRE_BASE, ...ORTHOGRAPHIC, ...TOPOGRAPHICAL, "abvs", "blws", "haln", "pres", "psts", "rclt", "rlig",
    "curs", "dist", "mark", "abvm", "blwm", "mkmk"
];
const HORIZONTAL_ONLY: ReadonlyArray<string> = ["liga", "rlig"];
const TAIL_CLASSES: ReadonlyArray<string> = [
    "MPre", "MAbv", "MBlw", "MPst", "VPre", "VAbv", "VBlw", "VPst", "VMPre", "VMAbv", "VMBlw", "VMPst", "FAbv", "FBlw", "FPst", "FM"
];
const DOTTED_CIRCLE: number = 0x25CC;
const PRE_BASE_FORM: number = -1;

export class UniversalShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>([
        "adlm", "ahom", "bhks", "bali", "batk", "brah", "bugi", "buhd", "cakm", "cham", "chrs", "cpmn", "diak", "dogr", "dupl", "egyp", "elym", "gara", "gran",
        "gong", "gukh", "rohg", "hano", "java", "kthi", "kawi", "kali", "khar", "kits", "khoj", "sind", "krai", "lepc", "limb", "mahj", "maka", "mand", "mani",
        "marc", "gonm", "medf", "mtei", "plrd", "modi", "mong", "mult", "nagm", "nand", "newa", "nko ", "hmnp", "sogo", "ougr", "onao", "hmng", "phag", "phlp",
        "rjng", "saur", "shrd", "sidd", "sinh", "sogd", "soyo", "sunu", "sund", "sylo", "tglg", "tagb", "tale", "lana", "tavt", "takr", "tnsa", "tibt", "tfng",
        "tirh", "todr", "toto", "tutg", "vith", "wcho", "yezi", "zanb"
    ]);

    private readonly clusters: UniversalClusters = new UniversalClusters();
    private readonly base: number;
    private readonly halant: number;
    private readonly repha: number;
    private readonly vowelPre: number;
    private readonly modifierPre: number;
    private readonly tail: Set<number>;

    constructor(layout: FontLayout) {
        super(layout);
        this.base = this.clusters.classNamed("B");
        this.halant = this.clusters.classNamed("H");
        this.repha = this.clusters.classNamed("R");
        this.vowelPre = this.clusters.classNamed("VPre");
        this.modifierPre = this.clusters.classNamed("VMPre");
        this.tail = new Set<number>(TAIL_CLASSES.map((name: string) => this.clusters.classNamed(name)));
    }

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Universal Shaping Engine, "How the Universal Shaping Engine works": the clusters, the basic features on each
        // cluster, the reordering, and then the topographical, typographical and positional features on the run.
        const groups: Array<Array<GlyphInfo>> = this.groups(this.clusters.decompose(codepoints));
        const plan: UniversalPlan = this.planOf(request, instance, (): UniversalPlan => this.plan(request, instance));
        const applier: SubstitutionApplier | undefined = this.substitutionApplier();
        const run: (lookups: ReadonlyArray<LookupPlan>, glyphs: Array<GlyphInfo>) => void = (lookups: ReadonlyArray<LookupPlan>, glyphs: Array<GlyphInfo>): void => {
            for (const lookup of lookups) {
                applier?.run(lookup.index, glyphs, lookup.mask, lookup.alternate, request.rtl);
            }
        };
        for (const group of groups) {
            run(plan.preprocessing, group);
            // "Feature application is scoped to the first three glyphs in a cluster", and the output of rphf reorders as a repha.
            const head: Array<GlyphInfo> = group.slice(0, 3);
            const output: GlyphInfo | undefined = this.outputOf(head, (): void => run(plan.reph, head));
            group.splice(0, 3, ...head);
            if (output !== undefined) {
                output.category = this.repha;
            }
            const form: GlyphInfo | undefined = this.outputOf(group, (): void => run(plan.preBase, group));
            if (form !== undefined) {
                form.category = PRE_BASE_FORM;
            }
            run(plan.orthographic, group);
            this.reorder(group);
        }
        const infos: Array<GlyphInfo> = groups.flat();
        if (request.joining) {
            this.assignJoiningForms(infos);
            run(plan.topographical, infos);
        }
        run(plan.others, infos);
        this.place(infos, plan.required, plan.scripts, instance);
        return infos;
    }

    private plan(request: ShapeRequest, instance: FontInstance): UniversalPlan {
        const scripts: Array<string> = [...request.scriptTags, ...FeatureShaper.FALLBACK_SCRIPTS];
        const required: ShapeRequest = { ...request, features: this.features(request) };
        const active: Array<ActiveFeature> = this.layout.gsub === undefined ? [] : this.activeFeatures(this.layout.gsub, required, scripts, instance);
        const used: Set<ActiveFeature> = new Set<ActiveFeature>();
        const stage: (tags: ReadonlyArray<string>) => Array<LookupPlan> = (tags: ReadonlyArray<string>): Array<LookupPlan> => {
            const features: Array<ActiveFeature> = active.filter((feature: ActiveFeature) => tags.includes(feature.record.tag));
            features.forEach((feature: ActiveFeature) => used.add(feature));
            return this.lookupsOf(features);
        };
        const preprocessing: Array<LookupPlan> = stage(PREPROCESSING);
        const reph: Array<LookupPlan> = stage(REPH);
        const preBase: Array<LookupPlan> = stage(PRE_BASE);
        const orthographic: Array<LookupPlan> = stage(ORTHOGRAPHIC);
        const topographical: Array<LookupPlan> = request.joining ? stage(TOPOGRAPHICAL) : [];
        const others: Array<LookupPlan> = this.lookupsOf(active.filter((feature: ActiveFeature) => !used.has(feature)));
        return { required, scripts, preprocessing, reph, preBase, orthographic, topographical, others };
    }

    private features(request: ShapeRequest): Map<string, number> {
        // The engine applies its required features whatever the request says; liga and rlig are for "horizontal text only".
        const features: Map<string, number> = new Map<string, number>(request.features);
        for (const tag of REQUIRED) {
            features.set(tag, 1);
        }
        if (request.vertical) {
            for (const tag of HORIZONTAL_ONLY) {
                features.set(tag, 0);
            }
        }
        return features;
    }

    private groups(text: DecomposedText): Array<Array<GlyphInfo>> {
        const groups: Array<Array<GlyphInfo>> = [];
        for (const cluster of this.clusters.clusters(text.codes)) {
            const origin: number = text.origins[cluster.start];
            const group: Array<GlyphInfo> = [];
            if (cluster.defective && this.layout.glyphOf(DOTTED_CIRCLE) !== 0) {
                // "USE inserts a dotted circle glyph (U+25CC) to indicate a broken cluster."
                group.push(this.mapper.single(DOTTED_CIRCLE, origin, this.base));
            }
            for (let index: number = cluster.start; index < cluster.end; index++) {
                group.push(this.mapper.single(text.codes[index], origin, this.clusters.classOf(text.codes[index]), text.codes[index + 1]));
            }
            groups.push(group);
        }
        return groups;
    }

    private outputOf(glyphs: Array<GlyphInfo>, apply: () => void): GlyphInfo | undefined {
        // The glyph a reordering feature produces is the one it substitutes; earlier substitutions are set aside meanwhile.
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

    private isExplicitVirama(info: GlyphInfo): boolean {
        return info.category === this.halant && !info.substituted;
    }

    private reorder(group: Array<GlyphInfo>): void {
        // Universal Shaping Engine, "Glyph reordering": "in logical order: rphf, pref, VPre, VMPre", and none of them moves
        // "past an explicit virama".
        const reph: number = group.findIndex((info: GlyphInfo) => info.category === this.repha);
        if (reph >= 0) {
            const moved: Array<GlyphInfo> = group.splice(reph, 1);
            let target: number = reph;
            while (target < group.length && !this.isExplicitVirama(group[target]) && !this.tail.has(group[target].category)) {
                target++;
            }
            group.splice(target, 0, ...moved);
        }
        for (const category of [PRE_BASE_FORM, this.vowelPre, this.modifierPre]) {
            const moved: Array<GlyphInfo> = group.filter((info: GlyphInfo) => info.category === category);
            if (moved.length === 0) {
                continue;
            }
            let target: number = group.indexOf(moved[0]);
            while (target > 0 && !this.isExplicitVirama(group[target - 1])) {
                target--;
            }
            const rest: Array<GlyphInfo> = group.filter((info: GlyphInfo) => info.category !== category);
            group.length = 0;
            group.push(...rest.slice(0, target), ...moved, ...rest.slice(target));
        }
    }
}
