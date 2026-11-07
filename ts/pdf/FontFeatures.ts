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

import type { FontFaceRule, FontFeatureValuesRule } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import { CaseFolder } from "../fonts/CaseFolder.js";

export interface FontFeatureSet {
    tags: ReadonlyMap<string, number>;
    languageOverride?: string;
}

export interface FeatureContext {
    face?: FontFaceRule;
    family?: string;
    upright: boolean;
    letterSpaced: boolean;
    available(tag: string): boolean;
}

type FeatureValues = Readonly<Record<string, Readonly<Record<string, ReadonlyArray<number>>>>>;

const DEFAULT_FEATURES: ReadonlyArray<string> = [
    "rvrn", "ccmp", "locl", "mark", "mkmk", "rlig", "curs", "dist", "abvm", "blwm", "isol", "fina", "fin2", "fin3", "medi", "med2", "init",
    "calt", "clig", "liga", "rclt", "mset"
];
const OPTIONAL_LIGATURES: ReadonlyArray<string> = ["liga", "clig", "dlig", "hlig"];
const LIGATURE_KEYWORDS: Readonly<Record<string, readonly [ReadonlyArray<string>, number]>> = {
    "common-ligatures": [["liga", "clig"], 1], "no-common-ligatures": [["liga", "clig"], 0],
    "discretionary-ligatures": [["dlig"], 1], "no-discretionary-ligatures": [["dlig"], 0],
    "historical-ligatures": [["hlig"], 1], "no-historical-ligatures": [["hlig"], 0],
    "contextual": [["calt"], 1], "no-contextual": [["calt"], 0]
};
const KEYWORD_FEATURES: Readonly<Record<string, ReadonlyArray<string>>> = {
    "small-caps": ["smcp"], "all-small-caps": ["c2sc", "smcp"], "petite-caps": ["pcap"], "all-petite-caps": ["c2pc", "pcap"], "unicase": ["unic"], "titling-caps": ["titl"],
    "lining-nums": ["lnum"], "oldstyle-nums": ["onum"], "proportional-nums": ["pnum"], "tabular-nums": ["tnum"], "diagonal-fractions": ["frac"],
    "stacked-fractions": ["afrc"], "ordinal": ["ordn"], "slashed-zero": ["zero"],
    "jis78": ["jp78"], "jis83": ["jp83"], "jis90": ["jp90"], "jis04": ["jp04"], "simplified": ["smpl"], "traditional": ["trad"], "full-width": ["fwid"],
    "proportional-width": ["pwid"], "ruby": ["ruby"], "sub": ["subs"], "super": ["sups"]
};
const KEYWORD_PROPERTIES: ReadonlyArray<string> = ["font-variant-caps", "font-variant-numeric", "font-variant-east-asian", "font-variant-position"];
const INDEXED_ALTERNATES: Readonly<Record<string, ReadonlyArray<string>>> = {
    "stylistic": ["salt"], "swash": ["swsh", "cswh"], "ornaments": ["ornm"], "annotation": ["nalt"]
};
const HIGHEST_INDEX: number = 99;

export class FontFeatures {

    private readonly caseFolder: CaseFolder = new CaseFolder();
    private readonly values: Map<string, FeatureValues> = new Map<string, FeatureValues>();

    constructor(rules: ReadonlyArray<FontFeatureValuesRule>) {
        // CSS Fonts 4 §6.9.1: "the resulting values definitions are the union of the definitions contained within these rules".
        for (const rule of rules) {
            for (const family of rule.families) {
                const key: string = this.caseFolder.fold(family);
                const merged: Record<string, Record<string, ReadonlyArray<number>>> = { ...this.values.get(key) };
                for (const [type, names] of Object.entries(rule.features)) {
                    merged[type] = { ...merged[type], ...names };
                }
                this.values.set(key, merged);
            }
        }
    }

    resolve(style: Readonly<Record<string, CssValue>>, context: FeatureContext): FontFeatureSet {
        // CSS Fonts 4 §7.2, in ascending order of precedence: the default features, the @font-face descriptors, the
        // font-variant properties and font-kerning, what other properties imply, and the font-feature-settings property.
        const tags: Map<string, number> = new Map<string, number>(DEFAULT_FEATURES.map((tag: string): [string, number] => [tag, 1]));
        // §6.3 and §7.1: kern for horizontal and sideways text and vkrn for upright text in vertical lines, where vert "must be enabled".
        const kerning: string = context.upright ? "vkrn" : "kern";
        tags.set(kerning, 1);
        if (context.upright) {
            tags.set("vert", 1);
        }
        let languageOverride: string | undefined = this.language(context.face?.descriptors["font-language-override"]);
        this.settings(tags, context.face?.descriptors["font-feature-settings"]);
        languageOverride = this.language(style["font-language-override"]) ?? languageOverride;
        this.ligatures(tags, style["font-variant-ligatures"]);
        for (const property of KEYWORD_PROPERTIES) {
            const keywords: Array<string> | undefined = this.keywords(style[property]);
            if (keywords === undefined) {
                continue;
            }
            for (const keyword of keywords) {
                const features: ReadonlyArray<string> | undefined = KEYWORD_FEATURES[keyword];
                if (features !== undefined) {
                    for (const tag of features) {
                        tags.set(tag, 1);
                    }
                }
            }
        }
        // CSS Fonts 4 §6.6: for a font without petite capitals "the property behaves as if small-caps or all-small-caps,
        // respectively, had been specified".
        const capitals: Array<string> | undefined = this.keywords(style["font-variant-caps"]);
        if (capitals?.includes("petite-caps") === true && !context.available("pcap")) {
            tags.set("smcp", 1);
        }
        if (capitals?.includes("all-petite-caps") === true && !(context.available("pcap") && context.available("c2pc"))) {
            tags.set("c2sc", 1);
            tags.set("smcp", 1);
        }
        this.alternates(tags, style["font-variant-alternates"], context.family);
        if (this.keywords(style["font-kerning"])?.includes("none") === true) {
            tags.set(kerning, 0);
        }
        if (context.letterSpaced) {
            // CSS Text 4 §8.2: with a spacing that is not zero "user agents should not apply optional ligatures".
            for (const tag of OPTIONAL_LIGATURES) {
                tags.set(tag, 0);
            }
        }
        this.settings(tags, style["font-feature-settings"]);
        return languageOverride === undefined ? { tags } : { tags, languageOverride };
    }

    private items(separator: "space" | "comma", value: CssValue): ReadonlyArray<CssValue> {
        return value.kind === "list" && value.separator === separator ? value.items : [value];
    }

    private keywords(value?: CssValue): Array<string> | undefined {
        return value === undefined ? undefined
            : this.items("space", value).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }

    private language(value?: CssValue): string | undefined {
        // CSS Fonts 4 §6.13: a string that names an OpenType language system tag, which has four characters.
        return value !== undefined && value.kind === "string" && value.value.length > 0 ? value.value.padEnd(4, " ") : undefined;
    }

    private ligatures(tags: Map<string, number>, value?: CssValue): void {
        // CSS Fonts 4 §6.4: none disables "all types of ligatures and contextual forms covered by this property"; required
        // ligatures "are not affected".
        const keywords: Array<string> | undefined = this.keywords(value);
        if (keywords === undefined) {
            return;
        }
        for (const keyword of keywords) {
            if (keyword === "none") {
                for (const tag of [...OPTIONAL_LIGATURES, "calt"]) {
                    tags.set(tag, 0);
                }
            }
            const change: readonly [ReadonlyArray<string>, number] | undefined = LIGATURE_KEYWORDS[keyword];
            if (change !== undefined) {
                for (const tag of change[0]) {
                    tags.set(tag, change[1]);
                }
            }
        }
    }

    private alternates(tags: Map<string, number>, value?: CssValue, family?: string): void {
        // CSS Fonts 4 §6.8: a name that @font-feature-values does not define for the family of the font "must be ignored when
        // choosing glyphs", and the values "never apply to generic font families".
        if (value === undefined) {
            return;
        }
        const defined: FeatureValues = (family === undefined ? undefined : this.values.get(this.caseFolder.fold(family))) ?? {};
        for (const item of this.items("space", value)) {
            if (item.kind === "ident" && item.lower === "historical-forms") {
                tags.set("hist", 1);
            }
            if (item.kind !== "function") {
                continue;
            }
            for (const name of item.args.flatMap((argument: CssValue) => this.items("comma", argument))) {
                const indexes: ReadonlyArray<number> | undefined = name.kind === "ident" ? defined[item.name]?.[name.name] : undefined;
                if (indexes !== undefined) {
                    this.alternate(tags, item.name, indexes);
                }
            }
        }
    }

    private alternate(tags: Map<string, number>, type: string, indexes: ReadonlyArray<number>): void {
        // CSS Fonts 4 §6.9.2: each value of a style set enables ss<value>; a character variant enables cv<first> with the
        // second value; the other types set their features to the value. Values "greater than 99 or equal to 0" enable nothing.
        if (type === "styleset") {
            for (const index of indexes) {
                if (index >= 1 && index <= HIGHEST_INDEX) {
                    tags.set("ss" + String(index).padStart(2, "0"), 1);
                }
            }
        } else if (type === "character-variant") {
            if (indexes[0] >= 1 && indexes[0] <= HIGHEST_INDEX) {
                tags.set("cv" + String(indexes[0]).padStart(2, "0"), indexes[1] ?? 1);
            }
        } else {
            const alternates: ReadonlyArray<string> | undefined = INDEXED_ALTERNATES[type];
            if (alternates !== undefined) {
                for (const tag of alternates) {
                    tags.set(tag, indexes[0]);
                }
            }
        }
    }

    private settings(tags: Map<string, number>, value?: CssValue): void {
        // CSS Fonts 4 §6.12: a tag string followed by an integer, on or off; without a value the feature is set to 1.
        if (value === undefined) {
            return;
        }
        for (const setting of this.items("comma", value)) {
            const parts: ReadonlyArray<CssValue> = this.items("space", setting);
            const tag: CssValue = parts[0];
            if (tag === undefined || tag.kind !== "string") {
                continue;
            }
            const amount: CssValue | undefined = parts[1];
            if (amount === undefined) {
                tags.set(tag.value, 1);
            } else if (amount.kind === "number") {
                tags.set(tag.value, amount.value);
            } else if (amount.kind === "ident") {
                tags.set(tag.value, amount.lower === "on" ? 1 : 0);
            }
        }
    }
}
