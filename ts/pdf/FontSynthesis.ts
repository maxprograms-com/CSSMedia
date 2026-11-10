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

import type { CssValue } from "../css/values/CssValue.js";
import { FontLayout } from "../fonts/layout/FontLayout.js";
import type { FeatureRecord } from "../fonts/layout/LayoutTable.js";
import type { FaceMetrics, FontInstance, MetricOverride, ScriptMetrics, Typeface } from "../fonts/Typeface.js";
import { TextTransformer } from "./TextTransformer.js";

type Values = Readonly<Record<string, CssValue>>;

type CapitalSynthesis = "none" | "lower" | "all" | "upper";

const UPPERCASE: CssValue = { kind: "ident", name: "uppercase", lower: "uppercase" };
const LOWERCASE: CssValue = { kind: "ident", name: "lowercase", lower: "lowercase" };
const POSITION_RATIO: number = 1.2;
const SUPERSCRIPT_RISE: number = 1 / 3;
const SUBSCRIPT_DROP: number = 1 / 5;

export class FontSynthesis {

    private readonly transformer: TextTransformer = new TextTransformer();
    private readonly features: WeakMap<Typeface, Map<string, boolean>> = new WeakMap<Typeface, Map<string, boolean>>();

    hasFeature(font: FontInstance, tag: string): boolean {
        // CSS Fonts 4 §6.6: "The availability of these glyphs is based on whether a given feature is defined or not in the
        // feature list of the font."
        let known: Map<string, boolean> | undefined = this.features.get(font.typeface);
        if (known === undefined) {
            known = new Map<string, boolean>();
            this.features.set(font.typeface, known);
        }
        let has: boolean | undefined = known.get(tag);
        if (has === undefined) {
            has = FontLayout.of(font.typeface).gsub?.features.some((feature: FeatureRecord) => feature.tag === tag) === true;
            known.set(tag, has);
        }
        return has;
    }

    capitalizes(values: Values): boolean {
        const keyword: string = this.keyword("normal", values["font-variant-caps"]);
        return keyword !== "normal" && keyword !== "titling-caps" && this.keyword("auto", values["font-synthesis-small-caps"]) !== "none";
    }

    capitals(values: Values, font: FontInstance): CapitalSynthesis {
        // CSS Fonts 4 §6.6: without small-caps glyphs in the font "user agents should simulate a small-caps font"; petite
        // capitals fall back to small capitals, and unicase to small capitals "only to lowercased uppercase letters".
        if (!this.capitalizes(values)) {
            return "none";
        }
        const small: boolean = this.hasFeature(font, "smcp");
        const smallFromCapitals: boolean = small && this.hasFeature(font, "c2sc");
        switch (this.keyword("normal", values["font-variant-caps"])) {
            case "small-caps":
                return small ? "none" : "lower";
            case "petite-caps":
                return small || this.hasFeature(font, "pcap") ? "none" : "lower";
            case "all-small-caps":
                return smallFromCapitals ? "none" : "all";
            case "all-petite-caps":
                return smallFromCapitals || (this.hasFeature(font, "pcap") && this.hasFeature(font, "c2pc")) ? "none" : "all";
            case "unicase":
                return this.hasFeature(font, "unic") ? "none" : "upper";
            default:
                return "none";
        }
    }

    reduces(mode: CapitalSynthesis, cluster: string, language?: string): boolean {
        // CSS Fonts 4 §6.6: the simulation "must not attempt to simulate alternates for codepoints which are considered
        // caseless", and "the casing transformations must match those used for the text-transform property".
        if (mode === "none") {
            return false;
        }
        const lowercase: boolean = this.uppercase(cluster, language) !== cluster;
        if (mode === "lower") {
            return lowercase;
        }
        const uppercase: boolean = this.transformer.apply(cluster, "", LOWERCASE, language) !== cluster;
        return mode === "upper" ? uppercase : lowercase || uppercase;
    }

    uppercase(text: string, language?: string): string {
        return this.transformer.apply(text, "", UPPERCASE, language);
    }

    capitalScale(font: FontInstance): number {
        // CSS Fonts 4 §6.6: small capitals "are reduced to the size of lowercase letters"; CSS Values 4 §6.1.1 gives 0.5em
        // and the ascent for a font without an x-height or a cap-height.
        const metrics: FaceMetrics = font.metrics;
        const xHeight: number = metrics.xHeight !== undefined && metrics.xHeight > 0 ? metrics.xHeight : metrics.unitsPerEm / 2;
        const capHeight: number = metrics.capHeight !== undefined && metrics.capHeight > 0 ? metrics.capHeight : (metrics.typographic ?? metrics.horizontal).ascender;
        return capHeight > 0 ? xHeight / capHeight : 1;
    }

    position(values: Values, tags: ReadonlyMap<string, number>): string | undefined {
        // CSS Fonts 4 §2.8.4: with auto "Synthesis of superscript and subscript forms is required", with none it "is not
        // allowed"; a feature that font-feature-settings turns off is not simulated either (§6.6).
        const keyword: string = this.keyword("normal", values["font-variant-position"]);
        const tag: string | undefined = keyword === "sub" ? "subs" : (keyword === "super" ? "sups" : undefined);
        if (tag === undefined || this.keyword("auto", values["font-synthesis-position"]) === "none" || (tags.get(tag) ?? 0) === 0) {
            return undefined;
        }
        return tag;
    }

    scriptForm(font: FontInstance, tag: string, upright: boolean, size: number): readonly [number, number] {
        // CSS Fonts 5 §4.6: an override is a share of the used size, from-font takes the OS/2 metric, which upright text lacks;
        // normal takes the size of font-size: smaller and the shifts CSS Inline 3 §4.2.3 gives for sub and super.
        const superscript: boolean = tag === "sups";
        const axis: number = upright ? 1 : 0;
        const metrics: ScriptMetrics | undefined = upright ? undefined : (superscript ? font.metrics.superscript : font.metrics.subscript);
        const position: MetricOverride | undefined = font.overrides?.[superscript ? "superscriptPosition" : "subscriptPosition"][axis];
        const scaled: MetricOverride | undefined = font.overrides?.[superscript ? "superscriptSize" : "subscriptSize"][axis];
        const scale: number = size / font.metrics.unitsPerEm;
        let offset: number = size * (superscript ? SUPERSCRIPT_RISE : SUBSCRIPT_DROP);
        if (typeof position === "number") {
            offset = position * size;
        } else if (position === "from-font" && metrics !== undefined) {
            offset = metrics.yOffset * scale;
        }
        let reduced: number = size / POSITION_RATIO;
        if (typeof scaled === "number") {
            reduced = scaled * size;
        } else if (scaled === "from-font" && metrics !== undefined && metrics.ySize > 0) {
            reduced = metrics.ySize * scale;
        }
        // OpenType gives the superscript offset above the baseline and the subscript offset below it.
        return [superscript ? offset : -offset, reduced];
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }
}
