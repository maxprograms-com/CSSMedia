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

import { CharacterMapLookup } from "../CharacterMapLookup.js";
import type { FontInstance, Typeface } from "../Typeface.js";
import { DiacriticShaper } from "./DiacriticShaper.js";
import { FeatureShaper } from "./FeatureShaper.js";
import type { ShapeRequest } from "./FeatureShaper.js";
import { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import { HangulShaper } from "./HangulShaper.js";
import { IndicShaper } from "./IndicShaper.js";
import { KhmerShaper } from "./KhmerShaper.js";
import { MyanmarShaper } from "./MyanmarShaper.js";
import { ThaiShaper } from "./ThaiShaper.js";
import { UniversalShaper } from "./UniversalShaper.js";

type Engine = "indic" | "khmer" | "myanmar" | "thai" | "hangul" | "diacritic" | "universal" | "standard";

const SPACE: number = 0x20;
const DIGIT_ZERO: number = 0x30;
const FULL_STOP: number = 0x2E;
const SPACE_WIDTHS: ReadonlyMap<number, number> = new Map<number, number>([
    [0x2000, 1 / 2], [0x2001, 1], [0x2002, 1 / 2], [0x2003, 1], [0x2004, 1 / 3], [0x2005, 1 / 4], [0x2006, 1 / 6], [0x2009, 1 / 5], [0x200A, 1 / 10], [0x205F, 4 / 18], [0x3000, 1]
]);
const SPACE_LIKE: ReadonlyMap<number, number> = new Map<number, number>([[0x2007, DIGIT_ZERO], [0x2008, FULL_STOP]]);

export class GlyphShaper {

    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly openType: WeakMap<Typeface, Map<Engine, FeatureShaper>> = new WeakMap<Typeface, Map<Engine, FeatureShaper>>();
    private readonly engines: WeakMap<ReadonlyArray<string>, Engine> = new WeakMap<ReadonlyArray<string>, Engine>();

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        const glyphs: Array<GlyphInfo> = this.readable(codepoints, request, instance);
        for (const info of glyphs) {
            if (info.glyph === 0 && (SPACE_WIDTHS.has(info.codepoint) || SPACE_LIKE.has(info.codepoint))) {
                this.space(info, instance.typeface);
            }
        }
        return glyphs;
    }

    private space(info: GlyphInfo, typeface: Typeface): void {
        // A space the font lacks is its space glyph with the width Unicode's NamesList describes: "half an em", "four-eighteenths
        // of an em", thin "typically set to 1/5 or 1/6 em", hair "1/10 to 1/16 em", figure "the same width as digit zero".
        const like: number | undefined = SPACE_LIKE.get(info.codepoint);
        info.glyph = this.lookup.glyphOf(typeface.characters, SPACE);
        info.xAdvance = like === undefined ? (SPACE_WIDTHS.get(info.codepoint) as number) * typeface.metrics.unitsPerEm
            : typeface.glyphs.advances[this.lookup.glyphOf(typeface.characters, like)];
    }

    private readable(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Layout tables are read only as lookups run, so an offset past the end of a table first shows up here, as a RangeError.
        try {
            return this.shaped(codepoints, request, instance);
        } catch (error) {
            if (error instanceof RangeError) {
                throw new Error("Cannot read the layout tables of the font " + instance.typeface.source + ": " + error.message);
            }
            throw error;
        }
    }

    private shaped(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Without GSUB, morx does all the substitution, so the standard engine runs instead of one that looks for GSUB features.
        const typeface: Typeface = instance.typeface;
        const layout: FontLayout = FontLayout.of(typeface);
        let engines: Map<Engine, FeatureShaper> | undefined = this.openType.get(typeface);
        if (engines === undefined) {
            engines = new Map<Engine, FeatureShaper>();
            this.openType.set(typeface, engines);
        }
        const engine: Engine = layout.gsub === undefined && typeface.tables["morx"] !== undefined ? "standard" : this.engineOf(request.scriptTags);
        let shaper: FeatureShaper | undefined = engines.get(engine);
        if (shaper === undefined) {
            shaper = this.create(engine, layout);
            engines.set(engine, shaper);
        }
        return shaper.shape(codepoints, request, instance);
    }

    canShape(typeface: Typeface, scriptTags: ReadonlyArray<string>, joining: boolean): boolean {
        // CSS Fonts 4 §5.2: a font supports a character when, "if required by the containing script, shaping information is
        // available"; the scripts that join or are shaped by clusters require it.
        const engine: Engine = this.engineOf(scriptTags);
        if (!joining && engine !== "indic" && engine !== "khmer" && engine !== "myanmar" && engine !== "universal") {
            return true;
        }
        const layout: FontLayout = FontLayout.of(typeface);
        return typeface.tables["morx"] !== undefined || layout.gsub?.hasScript(scriptTags) === true || layout.gpos?.hasScript(scriptTags) === true;
    }

    private engineOf(scriptTags: ReadonlyArray<string>): Engine {
        // The tags of a script are one list for every run of that script, so the answer is found once for each list.
        let engine: Engine | undefined = this.engines.get(scriptTags);
        if (engine === undefined) {
            engine = this.chosen(scriptTags);
            this.engines.set(scriptTags, engine);
        }
        return engine;
    }

    private chosen(scriptTags: ReadonlyArray<string>): Engine {
        // Each script has the shaping engine of its specification; the standard engine, which also does the cursive joining
        // of Arabic, shapes the scripts that have none of their own.
        if (scriptTags.some((tag: string) => IndicShaper.SCRIPTS.has(tag))) {
            return "indic";
        }
        if (scriptTags.some((tag: string) => KhmerShaper.SCRIPTS.has(tag))) {
            return "khmer";
        }
        if (scriptTags.some((tag: string) => MyanmarShaper.SCRIPTS.has(tag))) {
            return "myanmar";
        }
        if (scriptTags.some((tag: string) => ThaiShaper.SCRIPTS.has(tag))) {
            return "thai";
        }
        if (scriptTags.some((tag: string) => HangulShaper.SCRIPTS.has(tag))) {
            return "hangul";
        }
        if (scriptTags.some((tag: string) => DiacriticShaper.SCRIPTS.has(tag))) {
            return "diacritic";
        }
        return scriptTags.some((tag: string) => UniversalShaper.SCRIPTS.has(tag)) ? "universal" : "standard";
    }

    private create(engine: Engine, layout: FontLayout): FeatureShaper {
        switch (engine) {
            case "indic":
                return new IndicShaper(layout);
            case "khmer":
                return new KhmerShaper(layout);
            case "myanmar":
                return new MyanmarShaper(layout);
            case "thai":
                return new ThaiShaper(layout);
            case "hangul":
                return new HangulShaper(layout);
            case "diacritic":
                return new DiacriticShaper(layout);
            case "universal":
                return new UniversalShaper(layout);
            default:
                return new FeatureShaper(layout);
        }
    }
}
