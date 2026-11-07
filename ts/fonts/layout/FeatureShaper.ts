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
import { VerticalMetrics } from "../VerticalMetrics.js";
import { AatShaper } from "./AatShaper.js";
import { ArabicJoining } from "./ArabicJoining.js";
import { AttachmentResolver } from "./AttachmentResolver.js";
import type { FontLayout } from "./FontLayout.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { GlyphMapper } from "./GlyphMapper.js";
import type { FeatureRecord, LanguageSystem, LayoutTable } from "./LayoutTable.js";
import { PositioningApplier } from "./PositioningApplier.js";
import { SubstitutionApplier } from "./SubstitutionApplier.js";

export interface ShapeRequest {
    rtl: boolean;
    scriptTags: ReadonlyArray<string>;
    languageTags?: ReadonlyArray<string>;
    features: ReadonlyMap<string, number>;
    joining: boolean;
    vertical: boolean;
}

export interface ActiveFeature {
    record: FeatureRecord;
    value: number;
}

export interface LookupPlan {
    index: number;
    mask: number;
    alternate: number;
}

const MASK_GLOBAL: number = GlyphMapper.MASK_GLOBAL;
const JOINING_MASKS: Readonly<Record<string, number>> = { "isol": 2, "fina": 4, "medi": 8, "init": 16, "fin2": 32, "fin3": 64, "med2": 128 };
const FORM_MASKS: Readonly<Record<string, number>> = { "isolated": 2, "final": 4, "medial": 8, "initial": 16, "final2": 32, "final3": 64, "medial2": 128 };
const RVRN_STAGE: ReadonlyArray<string> = ["rvrn"];
const ARABIC_STAGES: ReadonlyArray<ReadonlyArray<string>> = [
    ["ccmp", "locl"], ["isol"], ["fina"], ["fin2"], ["fin3"], ["medi"], ["med2"], ["init"], ["rlig"], ["calt"], ["liga"], ["dlig"], ["cswh"], ["mset"]
];
const FALLBACK_SCRIPTS: ReadonlyArray<string> = ["DFLT"];

export class FeatureShaper {

    static readonly FALLBACK_SCRIPTS: ReadonlyArray<string> = FALLBACK_SCRIPTS;

    protected readonly layout: FontLayout;
    protected readonly mapper: GlyphMapper;
    private readonly joining: ArabicJoining = new ArabicJoining();
    private readonly attachments: AttachmentResolver = new AttachmentResolver();
    private readonly verticalMetrics: VerticalMetrics = new VerticalMetrics();
    private readonly substitutions: WeakMap<ReadonlyMap<string, number>, Map<string, Array<Array<LookupPlan>>>> = new WeakMap<ReadonlyMap<string, number>, Map<string, Array<Array<LookupPlan>>>>();
    private readonly positionings: WeakMap<ReadonlyMap<string, number>, Map<string, Array<LookupPlan>>> = new WeakMap<ReadonlyMap<string, number>, Map<string, Array<LookupPlan>>>();
    private readonly enginePlans: WeakMap<ReadonlyMap<string, number>, Map<string, unknown>> = new WeakMap<ReadonlyMap<string, number>, Map<string, unknown>>();
    private readonly aat?: AatShaper;
    private readonly morphs: boolean;
    private readonly kerns: boolean;
    private readonly stillMarks: boolean;
    private substituter?: SubstitutionApplier;
    private positioner?: PositioningApplier;
    private positioned?: FontInstance;
    private positionedVertical: boolean = false;

    constructor(layout: FontLayout) {
        this.layout = layout;
        this.mapper = new GlyphMapper(layout);
        // morx and kerx stand in for a missing GSUB or GPOS. Only GDEF says which glyphs are marks, and those keep the advances
        // of the font when the Apple tables do the shaping, since kerx adjusts those advances.
        this.morphs = layout.gsub === undefined && layout.typeface.tables["morx"] !== undefined;
        this.kerns = layout.gpos === undefined && layout.typeface.tables["kerx"] !== undefined;
        this.stillMarks = !this.kerns && !(this.morphs && layout.gpos === undefined) && layout.gdef?.hasGlyphClasses() === true;
        if (this.morphs || this.kerns) {
            this.aat = new AatShaper(layout);
        }
    }

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // OpenType GSUB and GPOS: the substitutions run first, on glyph indexes; then the advances of the instance are
        // taken and the positioning lookups adjust them.
        const infos: Array<GlyphInfo> = this.mapper.map(codepoints);
        if (request.joining) {
            this.assignJoiningForms(infos);
        }
        // OpenType common formats: "An application should use a DFLT script table if there is not a script table associated
        // with the specific script of the text being formatted, or if the text does not have a specific script".
        const scripts: Array<string> = [...request.scriptTags, ...FALLBACK_SCRIPTS];
        if (this.layout.gsub !== undefined && infos.length > 0) {
            this.substitute(this.layout.gsub, infos, request, scripts, instance);
        } else if (this.morphs && infos.length > 0) {
            (this.aat as AatShaper).substitute(infos, request.features, request.rtl, request.vertical);
        }
        this.place(infos, request, scripts, instance);
        return infos;
    }

    protected place(infos: Array<GlyphInfo>, request: ShapeRequest, scripts: ReadonlyArray<string>, instance: FontInstance): void {
        // OpenType vmtx: the advance height "starts from the y coordinate of the glyph's vertical origin and advances
        // downwards"; the offsets place the origin of the outline from the pen, so they start at minus the vertical origin.
        for (const info of infos) {
            const still: boolean = info.ignorable || (this.stillMarks && info.glyphClass === GlyphDefinition.MARK);
            if (request.vertical) {
                info.xAdvance = still ? 0 : this.verticalMetrics.advance(instance, info.glyph);
                info.xOffset = -this.verticalMetrics.originX(instance, info.glyph);
                info.yOffset = -this.verticalMetrics.originY(instance, info.glyph);
            } else {
                info.xAdvance = still ? 0 : (instance.advances[info.glyph] ?? 0);
            }
        }
        if (this.layout.gpos !== undefined && infos.length > 0) {
            this.position(this.layout.gpos, infos, request, scripts, instance);
        } else if (this.kerns && infos.length > 0 && request.features.get(request.vertical ? "vkrn" : "kern") !== 0) {
            // font-kerning: none reaches here as kern or vkrn at zero, and in this font the kerning it turns off is in kerx.
            (this.aat as AatShaper).kern(infos, request.rtl, request.vertical, instance);
        }
    }

    protected planOf<T>(request: ShapeRequest, instance: FontInstance, build: () => T): T {
        // The required features, lookups and forms of a script engine do not depend on the text, so each is built once for
        // each set of features and each combination that planKey names.
        const key: string = this.planKey(request, instance);
        let plans: Map<string, unknown> | undefined = this.enginePlans.get(request.features);
        if (plans === undefined) {
            plans = new Map<string, unknown>();
            this.enginePlans.set(request.features, plans);
        }
        let plan: T | undefined = plans.get(key) as T | undefined;
        if (plan === undefined) {
            plan = build();
            plans.set(key, plan);
        }
        return plan;
    }

    protected substitutionApplier(): SubstitutionApplier | undefined {
        if (this.substituter === undefined && this.layout.gsub !== undefined) {
            this.substituter = new SubstitutionApplier(this.layout, this.layout.gsub);
        }
        return this.substituter;
    }

    protected assignJoiningForms(infos: Array<GlyphInfo>): void {
        const forms: Array<string> = this.joining.formsOf(infos.map((info: GlyphInfo) => info.codepoint));
        for (let index: number = 0; index < infos.length; index++) {
            const bit: number | undefined = FORM_MASKS[forms[index]];
            if (bit !== undefined) {
                infos[index].mask |= bit;
            }
        }
    }

    protected activeFeatures(table: LayoutTable, request: ShapeRequest, scripts: ReadonlyArray<string>, instance: FontInstance): Array<ActiveFeature> {
        // OpenType common formats, "Language system table": the required feature applies whatever the request says.
        const system: LanguageSystem | undefined = table.languageSystemOf(scripts, request.languageTags);
        const active: Array<ActiveFeature> = [];
        if (system === undefined) {
            return active;
        }
        const features: ReadonlyArray<FeatureRecord> = table.featuresFor(instance.coordinates);
        const indexes: Array<number> = system.requiredFeature !== undefined ? [system.requiredFeature, ...system.features] : [...system.features];
        for (const index of indexes) {
            const record: FeatureRecord | undefined = features[index];
            if (record === undefined) {
                continue;
            }
            const value: number = request.features.get(record.tag) ?? 0;
            if (value !== 0 || index === system.requiredFeature) {
                active.push({ record, value: value === 0 ? 1 : value });
            }
        }
        return active;
    }

    private substitute(table: LayoutTable, infos: Array<GlyphInfo>, request: ShapeRequest, scripts: ReadonlyArray<string>, instance: FontInstance): void {
        // The lookups to run depend on the features, the script, the language and the instance, not on the text, so
        // they are worked out once for each combination.
        const key: string = this.planKey(request, instance);
        let plans: Map<string, Array<Array<LookupPlan>>> | undefined = this.substitutions.get(request.features);
        if (plans === undefined) {
            plans = new Map<string, Array<Array<LookupPlan>>>();
            this.substitutions.set(request.features, plans);
        }
        let stages: Array<Array<LookupPlan>> | undefined = plans.get(key);
        if (stages === undefined) {
            const active: Array<ActiveFeature> = this.activeFeatures(table, request, scripts, instance);
            stages = this.stagesOf(active, request.joining).map((stage: Array<ActiveFeature>) => this.lookupsOf(stage));
            plans.set(key, stages);
        }
        const applier: SubstitutionApplier = this.substitutionApplier() as SubstitutionApplier;
        for (const lookups of stages) {
            for (const lookup of lookups) {
                applier.run(lookup.index, infos, lookup.mask, lookup.alternate, request.rtl);
            }
        }
    }

    private position(table: LayoutTable, infos: Array<GlyphInfo>, request: ShapeRequest, scripts: ReadonlyArray<string>, instance: FontInstance): void {
        const key: string = this.planKey(request, instance);
        let plans: Map<string, Array<LookupPlan>> | undefined = this.positionings.get(request.features);
        if (plans === undefined) {
            plans = new Map<string, Array<LookupPlan>>();
            this.positionings.set(request.features, plans);
        }
        let lookups: Array<LookupPlan> | undefined = plans.get(key);
        if (lookups === undefined) {
            lookups = this.lookupsOf(this.activeFeatures(table, request, scripts, instance));
            plans.set(key, lookups);
        }
        // The applier holds the variation scalars of an instance, and the runs of one font come one after the other.
        if (this.positioner === undefined || this.positioned !== instance || this.positionedVertical !== request.vertical) {
            this.positioner = new PositioningApplier(this.layout, table, instance.coordinates, request.vertical);
            this.positioned = instance;
            this.positionedVertical = request.vertical;
        }
        for (const lookup of lookups) {
            this.positioner.run(lookup.index, infos, lookup.mask, lookup.alternate, request.rtl);
        }
        this.attachments.resolve(infos, request.rtl, request.vertical);
    }

    private planKey(request: ShapeRequest, instance: FontInstance): string {
        return request.scriptTags.join(" ") + "|" + (request.languageTags === undefined ? "" : request.languageTags.join(" ")) + (request.joining ? "|j|" : "||")
            + (request.rtl ? "r" : "") + (request.vertical ? "v|" : "|") + instance.coordinates.join(",");
    }

    private stagesOf(active: ReadonlyArray<ActiveFeature>, joining: boolean): Array<Array<ActiveFeature>> {
        // The lookups of a stage run in lookup order; rvrn comes before everything, and a joining script needs its forms
        // chosen between the composition features and the required ligatures.
        const stages: Array<Array<ActiveFeature>> = [];
        const used: Set<ActiveFeature> = new Set<ActiveFeature>();
        const take: (tags: ReadonlyArray<string>) => void = (tags: ReadonlyArray<string>): void => {
            const stage: Array<ActiveFeature> = active.filter((entry: ActiveFeature) => tags.includes(entry.record.tag) && !used.has(entry));
            stage.forEach((entry: ActiveFeature) => used.add(entry));
            if (stage.length > 0) {
                stages.push(stage);
            }
        };
        take(RVRN_STAGE);
        if (joining) {
            for (const tags of ARABIC_STAGES) {
                take(tags);
            }
        }
        const rest: Array<ActiveFeature> = active.filter((entry: ActiveFeature) => !used.has(entry));
        if (rest.length > 0) {
            stages.push(rest);
        }
        return stages;
    }

    protected lookupsOf(features: ReadonlyArray<ActiveFeature>): Array<LookupPlan> {
        const plans: Map<number, LookupPlan> = new Map<number, LookupPlan>();
        for (const { record, value } of features) {
            const mask: number = JOINING_MASKS[record.tag] ?? MASK_GLOBAL;
            for (const index of record.lookups) {
                const known: LookupPlan | undefined = plans.get(index);
                if (known === undefined) {
                    plans.set(index, { index, mask, alternate: value });
                } else {
                    known.mask |= mask;
                }
            }
        }
        return [...plans.values()].sort((first: LookupPlan, second: LookupPlan) => first.index - second.index);
    }
}
