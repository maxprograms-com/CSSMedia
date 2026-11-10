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
import { CharacterMapLookup } from "../fonts/CharacterMapLookup.js";
import { ArabicJoining } from "../fonts/layout/ArabicJoining.js";
import type { ShapeRequest } from "../fonts/layout/FeatureShaper.js";
import type { GlyphInfo } from "../fonts/layout/GlyphInfo.js";
import { GlyphShaper } from "../fonts/layout/GlyphShaper.js";
import { LanguageSystems } from "../fonts/layout/LanguageSystems.js";
import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type { CatalogFace, FontInstance } from "../fonts/Typeface.js";
import type { Combination, GlyphRun, Hyphen, InlineItem, ShapedRun, TextRun, TextSequence } from "./BoxTree.js";
import type { FeatureContext, FontFeatureSet, FontFeatures } from "./FontFeatures.js";
import type { FontMatcher, FontRequest } from "./FontMatcher.js";
import type { FontMetrics } from "./FontMetrics.js";
import { FontSynthesis } from "./FontSynthesis.js";
import { LineBreaker } from "./LineBreaker.js";
import type { TextCombination } from "./TextCombination.js";
import { TextTransformer } from "./TextTransformer.js";
import type { UnicodeBidi } from "./UnicodeBidi.js";

type Values = Readonly<Record<string, CssValue>>;

interface Shaping {
    infos: Array<GlyphInfo>;
    codes: Array<number>;
    added: number;
    count: number;
    sources?: Array<number>;
    shift: number;
    size: number;
    form?: string;
    synthesized: boolean;
}

const ZERO_WIDTH_JOINER: number = 0x200D;
const FEATURE_PROPERTIES: ReadonlyArray<string> = [
    "font-language-override", "font-variant-ligatures", "font-variant-caps", "font-variant-numeric", "font-variant-east-asian", "font-variant-position",
    "font-variant-alternates", "font-kerning", "letter-spacing", "font-feature-settings"
];
const HYPHEN: number = 0x2010;
const HYPHEN_MINUS: number = 0x2D;
const JOINS_NEXT: ReadonlySet<string> = new Set<string>(["D", "L", "C"]);
const JOINS_PREVIOUS: ReadonlySet<string> = new Set<string>(["D", "R", "C"]);
const WHITE_SPACE: RegExp = /^[\p{Zs}\t\n]$/u;
const WIDTH_VARIANTS: ReadonlyMap<number, string> = new Map<number, string>([[2, "hwid"], [3, "twid"], [4, "qwid"]]);

export class TextShaper {

    private readonly matcher: FontMatcher;
    private readonly metrics: FontMetrics;
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly hyphens: WeakMap<Values, Map<FontInstance, Map<string, Hyphen>>> = new WeakMap<Values, Map<FontInstance, Map<string, Hyphen>>>();
    private readonly features: FontFeatures;
    private readonly bidi: UnicodeBidi;
    private readonly synthesis: FontSynthesis;
    private readonly combination: TextCombination;
    private readonly transformer: TextTransformer = new TextTransformer();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly shaper: GlyphShaper = new GlyphShaper();
    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly languages: LanguageSystems = new LanguageSystems();
    private readonly joining: ArabicJoining = new ArabicJoining();
    private readonly sets: Map<string, Map<FontInstance, FontFeatureSet>> = new Map<string, Map<FontInstance, FontFeatureSet>>();
    private readonly styles: WeakMap<Values, Map<FontInstance, FontFeatureSet>> = new WeakMap<Values, Map<FontInstance, FontFeatureSet>>();
    private readonly uprightStyles: WeakMap<Values, Map<FontInstance, FontFeatureSet>> = new WeakMap<Values, Map<FontInstance, FontFeatureSet>>();

    constructor(matcher: FontMatcher, metrics: FontMetrics, features: FontFeatures, bidi: UnicodeBidi, synthesis: FontSynthesis, combination: TextCombination) {
        this.matcher = matcher;
        this.metrics = metrics;
        this.features = features;
        this.bidi = bidi;
        this.synthesis = synthesis;
        this.combination = combination;
    }

    shape(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, runs: Array<TextRun>,
        combinations: ReadonlyArray<Combination>): Array<ShapedRun> {
        const sizes: Map<TextRun, number> = new Map<TextRun, number>();
        const shapings: Array<Shaping> = [];
        const nodes: Array<TextSequence> = [];
        const narrows: Array<boolean> = [];
        let item: number = 0;
        let combination: number = 0;
        for (const [index, run] of runs.entries()) {
            while (starts[item + 1] <= run.start) {
                item++;
            }
            while (combination < combinations.length && combinations[combination].end <= run.start) {
                combination++;
            }
            // CSS Writing Modes 4 §9.1.3.1: in combined text of more than one unit "any full-width typographic character
            // units should first be converted to their non-full-width equivalents".
            const narrow: boolean = run.combined && this.combination.units(codepoints, combinations[combination]) > 1;
            if (run.combined) {
                sizes.set(run, run.size);
            }
            const node: TextSequence = items[item].node as TextSequence;
            nodes.push(node);
            narrows.push(narrow);
            shapings.push(this.glyphsOf(codepoints, runs, index, node, run.size, narrow));
        }
        // CSS Fonts 4 §6.5: synthesis is decided "for a given contiguous run of text" in sub or super, which can span several
        // fonts and elements, "to avoid a mixture of variant glyphs and synthesized ones".
        let first: number = 0;
        while (first < runs.length) {
            const form: string | undefined = shapings[first].form;
            let last: number = first + 1;
            let synthesized: boolean = shapings[first].synthesized;
            while (form !== undefined && last < runs.length && shapings[last].form === form) {
                synthesized = synthesized || shapings[last].synthesized;
                last++;
            }
            for (let index: number = first; synthesized && index < last; index++) {
                if (!shapings[index].synthesized) {
                    shapings[index] = this.glyphsOf(codepoints, runs, index, nodes[index], runs[index].size, narrows[index], undefined, true);
                }
            }
            first = last;
        }
        for (const [index, run] of runs.entries()) {
            this.store(run, shapings[index]);
        }
        // Every run has its glyphs now.
        const shaped: Array<ShapedRun> = runs as Array<ShapedRun>;
        this.fit(items, starts, codepoints, shaped, combinations, sizes);
        return shaped;
    }

    hyphenate(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, runs: ReadonlyArray<TextRun>, breaks: Uint8Array): void {
        // CSS Text 4 §6.3.2: hyphenate-character is "the string that is shown between parts of hyphenated words". A line
        // that ends at a hyphenation opportunity needs its width, so each run that has one gets the string shaped.
        let item: number = 0;
        for (const run of runs) {
            let hyphenates: boolean = false;
            for (let position: number = run.start + 1; position <= run.end && !hyphenates; position++) {
                hyphenates = breaks[position] === LineBreaker.HYPHENATION || breaks[position] === LineBreaker.SPARE_HYPHENATION;
            }
            if (!hyphenates || run.combined) {
                continue;
            }
            while (starts[item + 1] <= run.start) {
                item++;
            }
            run.hyphen = this.hyphenOf(run, items[item].node as TextSequence);
        }
    }

    private hyphenOf(run: TextRun, node: TextSequence): Hyphen {
        const values: Values = node.style.values;
        let fonts: Map<FontInstance, Map<string, Hyphen>> | undefined = this.hyphens.get(values);
        if (fonts === undefined) {
            fonts = new Map<FontInstance, Map<string, Hyphen>>();
            this.hyphens.set(values, fonts);
        }
        let known: Map<string, Hyphen> | undefined = fonts.get(run.font);
        if (known === undefined) {
            known = new Map<string, Hyphen>();
            fonts.set(run.font, known);
        }
        const key: string = run.size + "|" + run.script + "|" + run.level + "|" + (run.upright ? "u" : "") + "|" + (node.language ?? "");
        let hyphen: Hyphen | undefined = known.get(key);
        if (hyphen === undefined) {
            hyphen = this.shapedHyphen(run, node);
            known.set(key, hyphen);
        }
        return hyphen;
    }

    private shapedHyphen(run: TextRun, node: TextSequence): Hyphen {
        // §6.3.2: with auto "the user agent should find an appropriate string"; it is U+2010 HYPHEN when the font of the
        // text has it, and U+002D otherwise.
        const values: Values = node.style.values;
        const value: CssValue | undefined = values["hyphenate-character"];
        const covers: (code: number) => boolean = (code: number): boolean => this.lookup.covers(run.font.typeface.characters, code);
        const text: string = value !== undefined && value.kind === "string" ? value.value : String.fromCodePoint(covers(HYPHEN) ? HYPHEN : HYPHEN_MINUS);
        const parts: Array<GlyphRun> = [];
        let advance: number = 0;
        let request: FontRequest | undefined;
        let font: FontInstance | undefined;
        let codes: Array<number> = [];
        const flush: () => void = (): void => {
            if (font !== undefined && codes.length > 0) {
                const part: GlyphRun = this.glyphRun(codes, run, node, font);
                parts.push(part);
                for (const width of part.advances) {
                    advance += width;
                }
            }
            codes = [];
        };
        for (const cluster of this.graphemes.segment(text)) {
            // A character that the font of the text lacks takes its font as any text does (CSS Fonts 4 §5.3).
            const unit: Array<number> = Array.from(cluster.segment, (character: string) => character.codePointAt(0) as number);
            let chosen: FontInstance | undefined = run.font;
            if (!unit.every(covers)) {
                request = request ?? this.metrics.request(values);
                chosen = this.matcher.clusterFonts(request, unit)?.[0];
            }
            if (chosen !== font) {
                flush();
                font = chosen;
            }
            codes.push(...unit);
        }
        flush();
        return { parts, advance };
    }

    private glyphRun(codes: ReadonlyArray<number>, run: TextRun, node: TextSequence, font: FontInstance): GlyphRun {
        const set: FontFeatureSet = this.featureSet(node.style.values, font, run.upright);
        const request: ShapeRequest = {
            rtl: (run.level & 1) === 1, scriptTags: this.scripts.openTypeTagsOf(run.script), features: set.tags, joining: false, vertical: run.upright
        };
        const languageTags: ReadonlyArray<string> | undefined = this.languageTags(set, node.language);
        if (languageTags !== undefined) {
            request.languageTags = languageTags;
        }
        const kept: Array<GlyphInfo> = this.shaper.shape(codes, request, font).filter((info: GlyphInfo) => !(info.ignorable && !info.substituted));
        const scale: number = run.size / font.metrics.unitsPerEm;
        const part: GlyphRun = {
            font, size: run.size, glyphs: new Uint16Array(kept.length), advances: new Float64Array(kept.length), xOffsets: new Float64Array(kept.length),
            yOffsets: new Float64Array(kept.length)
        };
        for (const [index, info] of kept.entries()) {
            part.glyphs[index] = info.glyph;
            part.advances[index] = info.xAdvance * scale;
            part.xOffsets[index] = info.xOffset * scale;
            part.yOffsets[index] = info.yOffset * scale;
        }
        return part;
    }

    private fit(items: ReadonlyArray<InlineItem>, starts: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, runs: ReadonlyArray<ShapedRun>,
        combinations: ReadonlyArray<Combination>, sizes: ReadonlyMap<TextRun, number>): void {
        // CSS Writing Modes 4 §9.1.3: "The UA must ensure that the combined advance width of the composition fits within 1em
        // by compressing the combined text if necessary."
        let item: number = 0;
        let first: number = 0;
        for (const combination of combinations) {
            while (first < runs.length && runs[first].start < combination.start) {
                first++;
            }
            let last: number = first;
            while (last < runs.length && runs[last].start < combination.end) {
                last++;
            }
            while (starts[item + 1] <= combination.start) {
                item++;
            }
            const node: TextSequence = items[item].node as TextSequence;
            const size: CssValue | undefined = node.style.values["font-size"];
            const em: number = size !== undefined && size.kind === "length" ? size.px : 0;
            const units: number = this.combination.units(codepoints, combination);
            const tag: string | undefined = WIDTH_VARIANTS.get(units);
            if (tag !== undefined && this.advanceOf(runs, first, last) > em) {
                // "OpenType implementations must use width-specific variants (OpenType features hwid/twid/qwid ...) to
                // compress text in cases where those variants are available for all typographic character units".
                const narrowed: Array<Shaping> = [];
                for (let index: number = first; index < last; index++) {
                    const usual: Shaping = this.glyphsOf(codepoints, runs, index, node, sizes.get(runs[index]) as number, true);
                    const variant: Shaping = this.glyphsOf(codepoints, runs, index, node, sizes.get(runs[index]) as number, true, tag);
                    if (!this.allVariants(variant.infos, usual.infos, usual.codes)) {
                        break;
                    }
                    narrowed.push(variant);
                }
                for (let index: number = first; narrowed.length === last - first && index < last; index++) {
                    this.store(runs[index], narrowed[index - first]);
                }
            }
            // "Otherwise, the UA may use any means to compress the text, including ... scaling the text geometrically".
            const advance: number = this.advanceOf(runs, first, last);
            combination.scale = advance > em && advance > 0 ? em / advance : 1;
            first = last;
        }
    }

    private advanceOf(runs: ReadonlyArray<ShapedRun>, first: number, last: number): number {
        let advance: number = 0;
        for (let index: number = first; index < last; index++) {
            for (const glyph of runs[index].advances) {
                advance += glyph;
            }
        }
        return advance;
    }

    private glyphsOf(codepoints: ReadonlyArray<number>, runs: ReadonlyArray<TextRun>, index: number, node: TextSequence, base: number, narrow: boolean,
        extra?: string, synthesize?: boolean): Shaping {
        const run: TextRun = runs[index];
        const rightToLeft: boolean = (run.level & 1) === 1;
        // CSS Writing Modes 4 §5.1.1: "characters from horizontal cursive scripts (such as Arabic) are shaped in their
        // isolated forms when typeset upright".
        const joins: boolean = !run.upright && this.scripts.isJoining(run.script);
        // CSS Text 4 §8.7: where the font changes inside a word, U+200D asks the font for the joining form that the
        // character on the other side of the boundary calls for.
        const next: TextRun | undefined = runs[index + 1];
        const before: boolean = joins && run.contextBefore && JOINS_NEXT.has(this.joining.joiningTypeOf(codepoints[run.start - 1]));
        const after: boolean = joins && next !== undefined && next.contextBefore && next.start === run.end && JOINS_PREVIOUS.has(this.joining.joiningTypeOf(codepoints[run.end]));
        const codes: Array<number> = before ? [ZERO_WIDTH_JOINER] : [];
        // §5.1.1: upright typesetting uses "vertical font metrics" and the vertical font features; sideways typesetting
        // uses "horizontal metrics and composition".
        const set: FontFeatureSet = this.featureSet(node.style.values, run.font, run.upright);
        let tags: ReadonlyMap<string, number> = set.tags;
        // CSS Fonts 4 §6.6: unicase without unic in a font that has small capitals lowercases the uppercase letters for
        // smcp; with smcp turned off by font-feature-settings they stay as they are, "without any small-caps".
        const native: boolean = run.capitals && this.synthesis.capitals(node.style.values, run.font) === "native";
        const sources: Array<number> | undefined = run.capitals && !(native && set.tags.get("smcp") === 0) ? [] : undefined;
        if (native && sources !== undefined) {
            tags = new Map<string, number>(tags).set("smcp", 1);
        }
        if (sources !== undefined) {
            this.recase(codepoints, run, codes, sources, !native, node.language);
        }
        for (let position: number = run.start; sources === undefined && position < run.end; position++) {
            // UAX #9 rule L4: a character with the Bidi_Mirrored property is shown by its mirrored glyph when its
            // resolved directionality is R.
            const code: number = rightToLeft ? this.bidi.mirrorOf(codepoints[position]) ?? codepoints[position] : codepoints[position];
            codes.push(narrow ? this.transformer.narrow(code) : code);
        }
        const added: number = before ? 1 : 0;
        const count: number = codes.length - added;
        if (after) {
            codes.push(ZERO_WIDTH_JOINER);
        }
        if (extra !== undefined) {
            tags = new Map<string, number>(tags).set(extra, 1);
        }
        const request: ShapeRequest = {
            rtl: rightToLeft, scriptTags: this.scripts.openTypeTagsOf(run.script), features: tags, joining: joins, vertical: run.upright
        };
        const languageTags: ReadonlyArray<string> | undefined = this.languageTags(set, node.language);
        if (languageTags !== undefined) {
            request.languageTags = languageTags;
        }
        let infos: Array<GlyphInfo> = this.shaper.shape(codes, request, run.font);
        let size: number = base;
        let shift: number = 0;
        let synthesized: boolean = false;
        const position: string | undefined = this.synthesis.position(node.style.values, tags);
        if (position !== undefined) {
            // CSS Fonts 4 §6.5: "if a variant glyph is not available for all the characters in the run, simulated glyphs
            // should be synthesized for all characters using reduced forms of the glyphs" used without the feature.
            const features: Map<string, number> = new Map<string, number>(tags).set(position, 0);
            const plain: Array<GlyphInfo> = this.shaper.shape(codes, { ...request, features }, run.font);
            if (synthesize === true || !this.allVariants(infos, plain, codes)) {
                infos = plain;
                const form: readonly [number, number] = this.synthesis.scriptForm(run.font, position, run.upright, base);
                shift = form[0];
                size = form[1];
                synthesized = true;
            }
        }
        const shaping: Shaping = { infos, codes, added, count, shift, size, synthesized };
        if (position !== undefined) {
            shaping.form = position;
        }
        if (sources !== undefined) {
            shaping.sources = sources;
        }
        return shaping;
    }

    private recase(codepoints: ReadonlyArray<number>, run: TextRun, codes: Array<number>, sources: Array<number>, upper: boolean, language?: string): void {
        // CSS Fonts 4 §6.6: simulated small capitals show the uppercase of the text, and unicase through smcp the lowercase.
        // Where the case change alters the number of characters, each cluster is converted by itself, so that every glyph is
        // traced to the character it comes from.
        let text: string = "";
        for (let position: number = run.start; position < run.end; position++) {
            text += String.fromCodePoint(codepoints[position]);
        }
        const whole: Array<string> = Array.from(this.synthesis.recase(text, upper, language));
        if (whole.length === run.end - run.start) {
            for (const [index, character] of whole.entries()) {
                codes.push(character.codePointAt(0) as number);
                sources.push(index);
            }
            return;
        }
        let offset: number = 0;
        for (const cluster of this.graphemes.segment(text)) {
            for (const character of this.synthesis.recase(cluster.segment, upper, language)) {
                codes.push(character.codePointAt(0) as number);
                sources.push(offset);
            }
            offset += Array.from(cluster.segment).length;
        }
    }

    private allVariants(infos: ReadonlyArray<GlyphInfo>, plain: ReadonlyArray<GlyphInfo>, codes: ReadonlyArray<number>): boolean {
        // A character has a variant glyph when the feature gives it other glyphs than it has without the feature.
        const glyphsOf: (list: ReadonlyArray<GlyphInfo>) => Array<string> = (list: ReadonlyArray<GlyphInfo>): Array<string> => {
            const glyphs: Array<string> = new Array<string>(codes.length).fill("");
            for (const info of list) {
                glyphs[info.cluster] += info.glyph + " ";
            }
            return glyphs;
        };
        const varied: Array<string> = glyphsOf(infos);
        const usual: Array<string> = glyphsOf(plain);
        for (const [index, code] of codes.entries()) {
            if (code !== ZERO_WIDTH_JOINER && usual[index] !== "" && varied[index] === usual[index] && !WHITE_SPACE.test(String.fromCodePoint(code))) {
                return false;
            }
        }
        return true;
    }

    private languageTags(set: FontFeatureSet, language?: string): ReadonlyArray<string> | undefined {
        // CSS Fonts 4 §6.13: font-language-override names the language system; otherwise §7.2 applies the content language.
        if (set.languageOverride !== undefined) {
            return [set.languageOverride];
        }
        return language === undefined || language.length === 0 ? undefined : this.languages.tagsOf(language);
    }

    private featureSet(values: Values, font: FontInstance, upright: boolean): FontFeatureSet {
        // The features depend on these properties alone, so styles that have the same ones share one set.
        // A style object is asked many times, so it remembers the sets it shares, and the key is built once for it.
        const remembered: WeakMap<Values, Map<FontInstance, FontFeatureSet>> = upright ? this.uprightStyles : this.styles;
        let sets: Map<FontInstance, FontFeatureSet> | undefined = remembered.get(values);
        if (sets === undefined) {
            const key: string = (upright ? "u" : "") + JSON.stringify(FEATURE_PROPERTIES.map((property: string) => values[property] ?? null));
            sets = this.sets.get(key);
            if (sets === undefined) {
                sets = new Map<FontInstance, FontFeatureSet>();
                this.sets.set(key, sets);
            }
            remembered.set(values, sets);
        }
        let set: FontFeatureSet | undefined = sets.get(font);
        if (set === undefined) {
            const face: CatalogFace | undefined = this.matcher.faceOf(font);
            // CSS Text 4 §8.2: a letter-spacing that is not zero turns the optional ligatures off.
            const spacing: CssValue | undefined = values["letter-spacing"];
            const letterSpaced: boolean = spacing !== undefined && ((spacing.kind === "length" && spacing.px !== 0) || (spacing.kind === "percentage" && spacing.value !== 0)
                || spacing.kind === "calc");
            const context: FeatureContext = { upright, letterSpaced, available: (tag: string): boolean => this.synthesis.hasFeature(font, tag) };
            if (face !== undefined && face.rule !== undefined) {
                context.face = face.rule;
            }
            if (face !== undefined) {
                context.family = face.family;
            }
            set = this.features.resolve(values, context);
            sets.set(font, set);
        }
        return set;
    }

    private store(target: TextRun, shaping: Shaping): void {
        // The glyphs are kept in the order of the text, with their advances and offsets in CSS pixels. CSS Text 4 §4:
        // "unsupported Default_ignorable characters must be ignored for text rendering", and so is the U+200D added here.
        const run: ShapedRun = target as ShapedRun;
        const added: number = shaping.added;
        const sources: ReadonlyArray<number> | undefined = shaping.sources;
        const shift: number = shaping.shift;
        run.size = shaping.size;
        const infos: ReadonlyArray<GlyphInfo> = shaping.infos;
        const last: number = added + shaping.count;
        let kept: number = 0;
        for (let position: number = 0; position < infos.length; position++) {
            const info: GlyphInfo = infos[position];
            kept += info.cluster >= added && info.cluster < last && !(info.ignorable && !info.substituted) ? 1 : 0;
        }
        const scale: number = run.size / run.font.metrics.unitsPerEm;
        run.glyphs = new Uint16Array(kept);
        run.clusters = new Uint32Array(kept);
        run.advances = new Float64Array(kept);
        run.xOffsets = new Float64Array(kept);
        run.yOffsets = new Float64Array(kept);
        let index: number = 0;
        for (let position: number = 0; position < infos.length; position++) {
            const info: GlyphInfo = infos[position];
            if (info.cluster < added || info.cluster >= last || (info.ignorable && !info.substituted)) {
                continue;
            }
            run.glyphs[index] = info.glyph;
            run.clusters[index] = run.start + (sources === undefined ? info.cluster - added : sources[info.cluster - added]);
            run.advances[index] = info.xAdvance * scale;
            // A simulated superscript or subscript moves across the line: up in horizontal text, to the right when upright.
            run.xOffsets[index] = info.xOffset * scale + (run.upright ? shift : 0);
            run.yOffsets[index] = info.yOffset * scale + (run.upright ? 0 : shift);
            index++;
        }
    }
}
