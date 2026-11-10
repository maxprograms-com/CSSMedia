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
import { CssUnits } from "../css/values/CssUnits.js";
import { CharacterMapLookup } from "../fonts/CharacterMapLookup.js";
import { ColorFont } from "../fonts/ColorFont.js";
import { FontCatalog } from "../fonts/FontCatalog.js";
import { InstanceBuilder } from "../fonts/InstanceBuilder.js";
import { STANDARD_FONTS } from "../fonts/generated/StandardFonts.js";
import { GlyphShaper } from "../fonts/layout/GlyphShaper.js";
import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type {
    AxisOverrides, CatalogFace, FaceOverrides, FontInstance, FontVariations, InstalledFace, MetricOverride, NamedInstance, StandardFontData, Typeface, VariationAxis
} from "../fonts/Typeface.js";

export interface FamilyReference {
    name: string;
    generic: boolean;
}

export interface FontRequest {
    families: ReadonlyArray<FamilyReference>;
    weight: number;
    width: number;
    style: "normal" | "italic" | "left" | "right" | "oblique";
    angle: number;
    size: number;
    opticalSizing: boolean;
    boldSynthesis: boolean;
    styleSynthesis: "auto" | "none" | "oblique-only";
    variations?: CssValue;
    adjustedSize?: (instance: FontInstance) => number;
}

type Range = readonly [number, number];

interface Traits {
    weight: Range;
    width: Range;
    italic?: Range;
    oblique?: Range;
}

interface Candidate {
    face: CatalogFace;
    traits: Traits;
    slant?: number;
    unicode?: ReadonlyArray<Range>;
    size?: Range;
    overrides?: FaceOverrides;
    order: number;
}

interface DeclaredStyle {
    italic?: Range;
    oblique?: Range;
    slant?: number;
}

interface Chosen {
    candidates: ReadonlyArray<Candidate>;
    ordered: ReadonlyArray<Candidate>;
    weight: number;
    width: number;
    italic?: number;
    oblique?: number;
    emboldening?: number;
    skew?: number;
}

interface Segment {
    attribute: "italic" | "oblique";
    from: number;
    to: number;
    excludeTo: boolean;
    synthetic?: boolean;
}

interface StyleChoice {
    attribute: "italic" | "oblique";
    value: number;
    slant?: number;
    skew?: number;
}

const ITALIC_SELECTION: number = 0x0001;
const OBLIQUE_SELECTION: number = 0x0200;
const ITALIC_MAC_STYLE: number = 0x0002;
const WIDTH_CLASSES: ReadonlyArray<number> = [100, 50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
const OBLIQUE_THRESHOLD: number = 11;
const BOLD: number = 700;
const REGULAR: number = 400;
const STANDARD_UNITS: number = 1000;
const SHEARING: Segment = { attribute: "oblique", from: 0, to: 0, excludeTo: false, synthetic: true };
const SPACE: number = 0x20;
const TEXT_SELECTOR: number = 0xFE0E;
const EMOJI_SELECTOR: number = 0xFE0F;
const DEFAULT_IGNORABLE: RegExp = /^\p{Default_Ignorable_Code_Point}$/u;
const DEFAULT_FONT: FamilyReference = { name: "sans-serif", generic: true };
const FALLBACK_FONTS: ReadonlyArray<FamilyReference> = [DEFAULT_FONT, { name: "Symbol", generic: false }, { name: "ZapfDingbats", generic: false }];
const OVERRIDE_DESCRIPTORS: ReadonlyArray<string> = ["size-adjust", "ascent-override", "descent-override", "line-gap-override", "superscript-position-override",
    "subscript-position-override", "superscript-size-override", "subscript-size-override"];

export class FontMatcher {

    static readonly DEFAULT_FAMILY: string = "Helvetica";
    static readonly DEFAULT_OBLIQUE: number = 14;
    static readonly WIDTH_KEYWORDS: ReadonlyMap<string, number> = new Map<string, number>([
        ["ultra-condensed", 50], ["extra-condensed", 62.5], ["condensed", 75], ["semi-condensed", 87.5], ["normal", 100],
        ["semi-expanded", 112.5], ["expanded", 125], ["extra-expanded", 150], ["ultra-expanded", 200]
    ]);

    private static readonly STEM_GAIN: number = FontMatcher.stemGain();

    private readonly catalog: FontCatalog;
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly builder: InstanceBuilder = new InstanceBuilder();
    private readonly units: CssUnits = new CssUnits();
    private readonly families: Map<string, Array<Candidate>> = new Map<string, Array<Candidate>>();
    private readonly slants: Map<Candidate, number> = new Map<Candidate, number>();
    private readonly instances: Map<string, FontInstance> = new Map<string, FontInstance>();
    private readonly built: Map<string, FontInstance> = new Map<string, FontInstance>();
    private readonly faces: WeakMap<FontInstance, CatalogFace> = new WeakMap<FontInstance, CatalogFace>();
    private readonly matches: Map<string, Chosen | null> = new Map<string, Chosen | null>();
    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly shaper: GlyphShaper = new GlyphShaper();
    private readonly shapable: WeakMap<Typeface, Map<number, boolean>> = new WeakMap<Typeface, Map<number, boolean>>();

    constructor(catalog: FontCatalog) {
        this.catalog = catalog;
    }

    private static stemGain(): number {
        // How much thicker, in ems, the dominant vertical stems of the bold standard fonts are than those of the regular face of
        // the same family and slant, for each unit of weight between them.
        let total: number = 0;
        let pairs: number = 0;
        for (const bold of STANDARD_FONTS.filter((font: StandardFontData) => font.weight === "Bold")) {
            const regular: StandardFontData | undefined = STANDARD_FONTS.find((font: StandardFontData) =>
                font.family === bold.family && font.italicAngle === bold.italicAngle && font.weight !== "Bold");
            if (regular !== undefined) {
                total += (bold.stemV - regular.stemV) / STANDARD_UNITS / (BOLD - REGULAR);
                pairs++;
            }
        }
        return pairs === 0 ? 0 : total / pairs;
    }

    firstAvailable(request: FontRequest): FontInstance | undefined {
        // CSS Fonts 4 §5.2: the first font whose unicode-range does not exclude U+0020, or the user agent's default font.
        for (const family of [...request.families, DEFAULT_FONT]) {
            const chosen: Chosen | undefined = this.match(family, request);
            const candidate: Candidate | undefined = chosen?.candidates.find((entry: Candidate) => this.inRanges(SPACE, entry.unicode));
            if (chosen !== undefined && candidate !== undefined) {
                return this.instance(candidate, chosen, request);
            }
        }
        return undefined;
    }

    private defaultFont(request: FontRequest): FontInstance | undefined {
        // CSS Fonts 4 §5.2: a character that no font has is shown with "the missing character glyph from a default font".
        const chosen: Chosen | undefined = this.match(DEFAULT_FONT, request);
        return chosen === undefined || chosen.candidates.length === 0 ? undefined : this.instance(chosen.candidates[0], chosen, request);
    }

    fontFor(request: FontRequest, code: number): FontInstance | undefined {
        // CSS Fonts 4 §5.2 steps 8 to 11: the matched face of each family in turn, then the installed fonts that have the character.
        const codes: ReadonlyArray<number> = [code];
        return this.listed(request, codes) ?? this.installed(request, codes);
    }

    clusterFonts(request: FontRequest, codes: ReadonlyArray<number>): Array<FontInstance> | undefined {
        // CSS Fonts 4 §5.3: a font supporting the whole cluster, or its canonically equivalent character, else an installed one
        // supporting a variation sequence's base and selector; §5.2: else the default font, and nothing when that is missing.
        const composed: string = codes.length > 1 ? String.fromCodePoint(...codes).normalize("NFC") : "";
        const single: number | undefined = composed.length > 0 && composed.length === String.fromCodePoint(composed.codePointAt(0) as number).length
            ? composed.codePointAt(0) : undefined;
        const whole: FontInstance | undefined = this.listed(request, codes) ?? (single === undefined ? undefined : this.listed(request, [single]))
            ?? this.installed(request, codes);
        if (whole !== undefined) {
            return new Array<FontInstance>(codes.length).fill(whole);
        }
        const bases: Array<number> = codes.filter((code: number) => !this.isVariationSelector(code));
        if (codes.length === 1 || bases.length === 0) {
            const only: FontInstance | undefined = this.defaultFont(request);
            return only === undefined ? undefined : new Array<FontInstance>(codes.length).fill(only);
        }
        if (bases.length < codes.length) {
            // §9.3: fallback "must take the presentation preference" of VS16 and VS15 "into account": with no font listing the
            // sequence, a font with color glyph tables answers VS16 and one without them VS15, as the note there suggests.
            const color: boolean | undefined = codes.includes(EMOJI_SELECTOR) ? true : (codes.includes(TEXT_SELECTOR) ? false : undefined);
            const presented: FontInstance | undefined = color === undefined ? undefined : this.listed(request, bases, color) ?? this.installed(request, bases, color);
            if (presented !== undefined) {
                return new Array<FontInstance>(codes.length).fill(presented);
            }
            // "match the single character b using the normal procedure for matching single characters and ignore the
            // variation selector": the cluster is matched without its selectors, and each one goes with its character.
            const fonts: Array<FontInstance> | undefined = this.clusterFonts(request, bases);
            if (fonts === undefined) {
                return undefined;
            }
            let position: number = -1;
            return codes.map((code: number): FontInstance => {
                position += this.isVariationSelector(code) ? 0 : 1;
                return fonts[Math.max(position, 0)];
            });
        }
        // "the longest sequence that is completely supported by a font in the font list", and "the remaining combining
        // characters separately using the rules for single characters".
        let length: number = codes.length - 1;
        let first: FontInstance | undefined = this.listed(request, codes.slice(0, length));
        while (first === undefined && length > 1) {
            length--;
            first = this.listed(request, codes.slice(0, length));
        }
        first = first ?? this.fontFor(request, codes[0]);
        const fonts: Array<FontInstance> = [];
        let fallback: FontInstance | undefined;
        for (let index: number = 0; index < codes.length; index++) {
            let font: FontInstance | undefined = index < length ? first : this.fontFor(request, codes[index]);
            if (font === undefined) {
                fallback = fallback ?? this.defaultFont(request);
                font = fallback;
            }
            if (font === undefined) {
                return undefined;
            }
            fonts.push(font);
        }
        return fonts;
    }

    private listed(request: FontRequest, codes: ReadonlyArray<number>, color?: boolean): FontInstance | undefined {
        // CSS Fonts 4 §5.4: for a Private-Use Area code point "user agents must only match font families named in the
        // font-family list that are not generic families".
        const privateUse: boolean = codes.some((code: number) => this.isPrivateUse(code));
        for (const family of request.families) {
            const found: FontInstance | undefined = privateUse && family.generic ? undefined : this.withCharacters(request, codes, this.match(family, request), color);
            if (found !== undefined) {
                return found;
            }
        }
        return undefined;
    }

    private installed(request: FontRequest, codes: ReadonlyArray<number>, color?: boolean): FontInstance | undefined {
        // CSS Fonts 4 §5.2: after the list, the default font and the standard symbol fonts; §5.4 forbids it for private use.
        if (codes.some((code: number) => this.isPrivateUse(code))) {
            return undefined;
        }
        for (const family of FALLBACK_FONTS) {
            const found: FontInstance | undefined = this.withCharacters(request, codes, this.match(family, request), color);
            if (found !== undefined) {
                return found;
            }
        }
        return undefined;
    }

    private withCharacters(request: FontRequest, codes: ReadonlyArray<number>, chosen?: Chosen, color?: boolean): FontInstance | undefined {
        if (chosen === undefined) {
            return undefined;
        }
        // A composite face is tried in reverse order of its @font-face rules.
        for (const candidate of chosen.ordered) {
            const typeface: Typeface | undefined = codes.every((code: number) => this.inRanges(code, candidate.unicode)) ? this.catalog.typeface(candidate.face) : undefined;
            if (typeface !== undefined && this.supports(typeface, codes) && (color === undefined || (ColorFont.of(typeface) !== undefined) === color)) {
                return this.instance(candidate, chosen, request);
            }
        }
        return undefined;
    }

    private supports(typeface: Typeface, codes: ReadonlyArray<number>): boolean {
        // A variation sequence is supported when the font lists it (OpenType cmap format 14). CSS Text 4 §4: "unsupported
        // Default_ignorable characters must be ignored for text rendering", so they do not decide the font.
        for (let index: number = 0; index < codes.length; index++) {
            const code: number = codes[index];
            if (this.isVariationSelector(code)) {
                if (index === 0 || this.lookup.variantOf(typeface.characters, codes[index - 1], code) === undefined) {
                    return false;
                }
            } else if (!this.lookup.covers(typeface.characters, code)) {
                if (!DEFAULT_IGNORABLE.test(String.fromCodePoint(code))) {
                    return false;
                }
            } else if (!this.canShape(typeface, this.scripts.scriptOf(code))) {
                return false;
            }
        }
        return true;
    }

    private canShape(typeface: Typeface, script: number): boolean {
        // CSS Fonts 4 §5.2: the character must be in the character map and, "if required by the containing script, shaping
        // information is available for that character".
        let known: Map<number, boolean> | undefined = this.shapable.get(typeface);
        if (known === undefined) {
            known = new Map<number, boolean>();
            this.shapable.set(typeface, known);
        }
        let able: boolean | undefined = known.get(script);
        if (able === undefined) {
            able = this.shaper.canShape(typeface, this.scripts.openTypeTagsOf(script), this.scripts.isJoining(script));
            known.set(script, able);
        }
        return able;
    }

    private isVariationSelector(code: number): boolean {
        return (code >= 0xFE00 && code <= 0xFE0F) || (code >= 0xE0100 && code <= 0xE01EF);
    }

    private isPrivateUse(code: number): boolean {
        return (code >= 0xE000 && code <= 0xF8FF) || (code >= 0xF0000 && code <= 0xFFFFD) || (code >= 0x100000 && code <= 0x10FFFD);
    }

    private match(family: FamilyReference, request: FontRequest): Chosen | undefined {
        // The match depends only on the family and on the width, style and weight asked for, and on the size where a face
        // is declared for some sizes only, so each one is made once.
        const sized: boolean = this.candidates(family).some((candidate: Candidate) => candidate.size !== undefined);
        const key: string = (family.generic ? "generic:" : "family:") + family.name + "|" + request.width + "|" + request.style + "|" + request.angle + "|" + request.weight
            + "|" + request.boldSynthesis + "|" + request.styleSynthesis + (sized ? "|" + Math.round(request.size) : "");
        let chosen: Chosen | null | undefined = this.matches.get(key);
        if (chosen === undefined) {
            chosen = this.choice(family, request) ?? null;
            this.matches.set(key, chosen);
        }
        return chosen ?? undefined;
    }

    private choice(family: FamilyReference, request: FontRequest): Chosen | undefined {
        const candidates: Array<Candidate> = this.candidates(family);
        if (candidates.length === 0) {
            return undefined;
        }
        // CSS Fonts 4 §5.2 step 4: width first, then style, then weight.
        const width: number = this.choose(candidates.map((candidate: Candidate) => candidate.traits.width), this.widthOrder(request.width)) ?? request.width;
        let remaining: Array<Candidate> = candidates.filter((candidate: Candidate) => this.contains(width, candidate.traits.width));
        const style: StyleChoice | undefined = this.chooseStyle(remaining, request);
        if (style !== undefined) {
            remaining = remaining.filter((candidate: Candidate) => this.contains(style.value, this.styleRange(candidate, style.attribute, style.slant)));
        }
        // CSS Fonts 4 §2.2: a synthesized bold face is "treated as if" it "existed within the family"; §2.8 only allows synthesis,
        // and a standard font is drawn by the reader from outlines that the document does not hold.
        const weights: Array<Range> = remaining.map((candidate: Candidate) => candidate.traits.weight);
        const synthetic: boolean = request.boldSynthesis && !weights.some((range: Range) => range[1] >= BOLD)
            && remaining.some((candidate: Candidate) => candidate.face.origin !== "standard");
        let weight: number = this.choose(synthetic ? [...weights, [BOLD, BOLD]] : weights, this.weightOrder(request.weight)) ?? request.weight;
        let emboldening: number | undefined;
        if (synthetic && weight === BOLD) {
            weight = this.choose(weights, this.weightOrder(BOLD)) ?? request.weight;
            emboldening = BOLD - weight;
        }
        remaining = remaining.filter((candidate: Candidate) => this.contains(weight, candidate.traits.weight));
        // "font-size must be matched within a UA-dependent margin of tolerance", typically "rounded to the nearest whole pixel"
        // for scalable fonts; CSS Fonts 5 §4.3: the font-size descriptor gives the sizes that a face matches.
        const size: number = Math.round(request.size);
        remaining = remaining.filter((candidate: Candidate) => candidate.size === undefined || this.contains(size, candidate.size));
        const chosen: Chosen = { candidates: remaining, ordered: [...remaining].sort((first: Candidate, second: Candidate) => second.order - first.order), weight, width };
        if (style !== undefined) {
            chosen[style.attribute] = style.value;
            if (style.skew !== undefined) {
                chosen.skew = style.skew;
            }
        }
        if (emboldening !== undefined) {
            chosen.emboldening = emboldening;
        }
        return chosen;
    }

    private weightOrder(desired: number): Array<Range> {
        // CSS Fonts 4 §5.2 step 4, font-weight.
        if (desired >= 400 && desired <= 500) {
            return [[desired, 500], [desired, Number.NEGATIVE_INFINITY], [500, Number.POSITIVE_INFINITY]];
        }
        if (desired < 400) {
            return [[desired, Number.NEGATIVE_INFINITY], [desired, Number.POSITIVE_INFINITY]];
        }
        return [[desired, Number.POSITIVE_INFINITY], [desired, Number.NEGATIVE_INFINITY]];
    }

    private widthOrder(desired: number): Array<Range> {
        // CSS Fonts 4 §5.2 step 4, font-width.
        if (desired <= 100) {
            return [[desired, Number.NEGATIVE_INFINITY], [desired, Number.POSITIVE_INFINITY]];
        }
        return [[desired, Number.POSITIVE_INFINITY], [desired, Number.NEGATIVE_INFINITY]];
    }

    private choose(ranges: ReadonlyArray<Range>, order: ReadonlyArray<Range>): number | undefined {
        for (const [from, to] of order) {
            const value: number | undefined = this.nearest(ranges, from, to, false);
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    private chooseStyle(candidates: ReadonlyArray<Candidate>, request: FontRequest): StyleChoice | undefined {
        // CSS Fonts 4 §2.4: left and right ask for an italic face slanted clockwise or counter-clockwise, or else an oblique face
        // with a positive or negative slant; they follow the italic steps with only faces of that slant.
        const sign: number = (request.style === "oblique" && request.angle < 0) || request.style === "right" ? -1 : 1;
        const slant: number | undefined = request.style === "left" || request.style === "right" ? sign : undefined;
        for (const segment of this.styleOrder(request, sign)) {
            if (segment.synthetic === true) {
                const skew: number | undefined = this.syntheticSkew(request);
                if (skew !== undefined && candidates.some((candidate: Candidate) => this.contains(0, candidate.traits.oblique))) {
                    return { attribute: "oblique", value: 0, skew };
                }
                continue;
            }
            const directed: number | undefined = segment.attribute === "italic" && segment.from > 0 ? slant : undefined;
            const ranges: Array<Range> = [];
            for (const candidate of candidates) {
                const range: Range | undefined = this.signed(segment.attribute === "oblique" ? sign : 1, this.styleRange(candidate, segment.attribute, directed));
                if (range !== undefined) {
                    ranges.push(range);
                }
            }
            const value: number | undefined = this.nearest(ranges, segment.from, segment.to, segment.excludeTo);
            if (value !== undefined) {
                const choice: StyleChoice = { attribute: segment.attribute, value: segment.attribute === "oblique" ? value * sign : value };
                if (directed !== undefined) {
                    choice.slant = directed;
                }
                return choice;
            }
        }
        return undefined;
    }

    private syntheticSkew(request: FontRequest): number | undefined {
        // CSS Fonts 4 §5.2: for oblique, "a fallback match is produced by geometric shearing to the specified oblique value"; §2.4:
        // "If no italic or oblique face is available, oblique faces may be synthesized", which oblique-only forbids for italic.
        if (request.style === "oblique") {
            return request.styleSynthesis === "none" ? undefined : request.angle;
        }
        if (request.styleSynthesis !== "auto") {
            return undefined;
        }
        return request.style === "right" ? -FontMatcher.DEFAULT_OBLIQUE : FontMatcher.DEFAULT_OBLIQUE;
    }

    private styleRange(candidate: Candidate, attribute: "italic" | "oblique", slant?: number): Range | undefined {
        const range: Range | undefined = candidate.traits[attribute];
        return range === undefined || slant === undefined || this.slantOf(candidate) * slant > 0 ? range : undefined;
    }

    private slantOf(candidate: Candidate): number {
        // A slant declared with left or right comes first; the OpenType italic angle is counter-clockwise, the opposite of CSS.
        let slant: number | undefined = candidate.slant ?? this.slants.get(candidate);
        if (slant === undefined) {
            slant = -(this.catalog.typeface(candidate.face)?.metrics.italicAngle ?? 0);
            this.slants.set(candidate, slant);
        }
        return slant;
    }

    private styleOrder(request: FontRequest, sign: number): Array<Segment> {
        // CSS Fonts 4 §5.2 step 4, font-style; a negative oblique angle, and right, follow the same steps with the oblique values negated.
        const up: number = Number.POSITIVE_INFINITY;
        const down: number = Number.NEGATIVE_INFINITY;
        if (request.style === "normal") {
            return [
                { attribute: "oblique", from: 0, to: up, excludeTo: false }, { attribute: "italic", from: 0, to: up, excludeTo: false },
                { attribute: "oblique", from: 0, to: down, excludeTo: false }, { attribute: "italic", from: 0, to: down, excludeTo: false }
            ];
        }
        if (request.style !== "oblique") {
            return [
                { attribute: "italic", from: 1, to: up, excludeTo: false }, { attribute: "italic", from: 1, to: 0, excludeTo: true },
                { attribute: "oblique", from: OBLIQUE_THRESHOLD, to: up, excludeTo: false }, { attribute: "oblique", from: OBLIQUE_THRESHOLD, to: 0, excludeTo: true },
                SHEARING, { attribute: "italic", from: 0, to: down, excludeTo: false }, { attribute: "oblique", from: 0, to: down, excludeTo: false }
            ];
        }
        const angle: number = request.angle * sign;
        if (angle >= OBLIQUE_THRESHOLD) {
            return [
                { attribute: "oblique", from: angle, to: up, excludeTo: false }, { attribute: "oblique", from: angle, to: 0, excludeTo: true }, SHEARING,
                { attribute: "italic", from: 1, to: up, excludeTo: false }, { attribute: "italic", from: 1, to: 0, excludeTo: true },
                { attribute: "oblique", from: 0, to: down, excludeTo: false }, { attribute: "italic", from: 0, to: down, excludeTo: false }
            ];
        }
        // §5.2 says "italic values less than 1" and then "above 1", leaving out 1, the value of every non-variable italic face;
        // the italic segment starts at 1, or an italic-only family could never match such a request.
        return [
            { attribute: "oblique", from: angle, to: 0, excludeTo: angle > 0 }, { attribute: "oblique", from: angle, to: up, excludeTo: false }, SHEARING,
            { attribute: "italic", from: 1, to: 0, excludeTo: true }, { attribute: "italic", from: 1, to: up, excludeTo: false },
            { attribute: "oblique", from: 0, to: down, excludeTo: false }, { attribute: "italic", from: 0, to: down, excludeTo: false }
        ];
    }

    private nearest(ranges: ReadonlyArray<Range>, from: number, to: number, excludeTo: boolean): number | undefined {
        // The value closest to "from" in the direction of "to" that some face supports.
        let best: number | undefined;
        for (const range of ranges) {
            let value: number | undefined;
            if (to >= from && range[1] >= from && range[0] <= to) {
                value = Math.max(range[0], from);
            } else if (to < from && range[0] <= from && range[1] >= to) {
                value = Math.min(range[1], from);
            }
            if (value === undefined || (excludeTo && value === to)) {
                continue;
            }
            if (best === undefined || Math.abs(value - from) < Math.abs(best - from)) {
                best = value;
            }
        }
        return best;
    }

    private signed(sign: number, range?: Range): Range | undefined {
        if (range === undefined || sign === 1) {
            return range;
        }
        return [-range[1], -range[0]];
    }

    private contains(value: number, range?: Range): boolean {
        return range !== undefined && range[0] <= value && value <= range[1];
    }

    private inRanges(code: number, ranges?: ReadonlyArray<Range>): boolean {
        // CSS Fonts 4 §5.2: installed fonts named directly have a unicode-range that covers the whole code space.
        return ranges === undefined || ranges.some((range: Range) => range[0] <= code && code <= range[1]);
    }

    private candidates(family: FamilyReference): Array<Candidate> {
        const key: string = (family.generic ? "generic:" : "family:") + family.name;
        let candidates: Array<Candidate> | undefined = this.families.get(key);
        if (candidates === undefined) {
            candidates = [];
            const faces: ReadonlyArray<CatalogFace> | undefined = family.generic ? this.catalog.generic(family.name) : this.catalog.family(family.name);
            if (faces !== undefined) {
                for (let order: number = 0; order < faces.length; order++) {
                    const candidate: Candidate | undefined = this.candidate(faces[order], order);
                    if (candidate !== undefined) {
                        candidates.push(candidate);
                    }
                }
            }
            this.families.set(key, candidates);
        }
        return candidates;
    }

    private candidate(face: CatalogFace, order: number): Candidate | undefined {
        if (face.origin === "installed") {
            const installed: InstalledFace = face.installed as InstalledFace;
            const traits: Traits = this.fontTraits(installed.weightClass, installed.widthClass, installed.selection, installed.macStyle,
                () => this.catalog.typeface(face)?.metrics.italicAngle ?? 0, installed.axes);
            return { face, traits, order };
        }
        // CSS Fonts 4 §5.2 step 3: a face whose resources cannot be loaded is not present in the family.
        const typeface: Typeface | undefined = this.catalog.typeface(face);
        if (typeface === undefined) {
            return undefined;
        }
        const fromFont: Traits = this.fontTraits(typeface.metrics.weightClass, typeface.metrics.widthClass, typeface.metrics.selection, typeface.metrics.macStyle,
            () => typeface.metrics.italicAngle, typeface.variations?.axes);
        if (face.origin === "standard" || face.rule === undefined) {
            return { face, traits: fromFont, order };
        }
        const descriptors: Readonly<Record<string, CssValue>> = face.rule.descriptors;
        const style: DeclaredStyle | undefined = this.descriptorStyle(descriptors["font-style"]);
        const traits: Traits = {
            weight: this.descriptorRange((value: CssValue) => this.weightOf(value), descriptors["font-weight"]) ?? fromFont.weight,
            width: this.descriptorRange((value: CssValue) => this.widthOf(value), descriptors["font-width"]) ?? fromFont.width
        };
        const italic: Range | undefined = style === undefined ? fromFont.italic : style.italic;
        const oblique: Range | undefined = style === undefined ? fromFont.oblique : style.oblique;
        if (italic !== undefined) {
            traits.italic = italic;
        }
        if (oblique !== undefined) {
            traits.oblique = oblique;
        }
        const candidate: Candidate = { face, traits, order: face.rule.order };
        const unicode: ReadonlyArray<Range> | undefined = this.unicodeRanges(descriptors["unicode-range"]);
        const size: Range | undefined = this.descriptorRange((value: CssValue) => value.kind === "number" ? value.value : undefined, descriptors["font-size"]);
        if (style !== undefined && style.slant !== undefined) {
            candidate.slant = style.slant;
        }
        if (unicode !== undefined) {
            candidate.unicode = unicode;
        }
        if (size !== undefined) {
            candidate.size = size;
        }
        if (OVERRIDE_DESCRIPTORS.some((name: string) => descriptors[name] !== undefined)) {
            const adjust: CssValue | undefined = descriptors["size-adjust"];
            candidate.overrides = {
                sizeAdjust: adjust !== undefined && adjust.kind === "percentage" ? adjust.value / 100 : 1,
                ascent: this.axisOverrides(descriptors["ascent-override"], false),
                descent: this.axisOverrides(descriptors["descent-override"], false),
                lineGap: this.axisOverrides(descriptors["line-gap-override"], false),
                superscriptPosition: this.axisOverrides(descriptors["superscript-position-override"], true),
                subscriptPosition: this.axisOverrides(descriptors["subscript-position-override"], true),
                superscriptSize: this.axisOverrides(descriptors["superscript-size-override"], true),
                subscriptSize: this.axisOverrides(descriptors["subscript-size-override"], true)
            };
        }
        return candidate;
    }

    private axisOverrides(value: CssValue | undefined, repeated: boolean): AxisOverrides {
        // CSS Fonts 5 §4.5 and §4.6: the first value is for the x axis and the second for the y axis, which is normal when
        // omitted for the line metrics and the first value for the superscript and subscript metrics; percentages are of the size.
        const items: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" && value.separator === "space" ? value.items : [value]);
        const override: (item?: CssValue) => MetricOverride | undefined = (item?: CssValue): MetricOverride | undefined => {
            if (item !== undefined && item.kind === "percentage") {
                return item.value / 100;
            }
            return item !== undefined && item.kind === "ident" && item.lower === "from-font" ? "from-font" : undefined;
        };
        const first: MetricOverride | undefined = override(items[0]);
        return [first, items.length > 1 ? override(items[1]) : (repeated ? first : undefined)];
    }

    private fontTraits(weightClass: number, widthClass: number, selection: number, macStyle: number, italicAngle: () => number, axes?: ReadonlyArray<VariationAxis>): Traits {
        // CSS Fonts 4 §5.2 step 4: a font without a range of values is mapped by the property definitions; variation axes give ranges.
        const axis: (tag: string) => VariationAxis | undefined = (tag: string): VariationAxis | undefined => axes?.find((candidate: VariationAxis) => candidate.tag === tag);
        const wght: VariationAxis | undefined = axis("wght");
        const wdth: VariationAxis | undefined = axis("wdth");
        const ital: VariationAxis | undefined = axis("ital");
        const slnt: VariationAxis | undefined = axis("slnt");
        const weight: number = Math.min(Math.max(weightClass, 1), 1000);
        const traits: Traits = {
            weight: wght === undefined ? [weight, weight] : [wght.minimum, wght.maximum],
            width: wdth === undefined ? [WIDTH_CLASSES[widthClass] ?? 100, WIDTH_CLASSES[widthClass] ?? 100] : [wdth.minimum, wdth.maximum],
            italic: [0, 0],
            oblique: [0, 0]
        };
        if (ital !== undefined || slnt !== undefined) {
            // The OpenType slnt axis counts counterclockwise angles, the opposite of CSS.
            traits.italic = ital === undefined ? [0, 0] : [ital.minimum, ital.maximum];
            traits.oblique = slnt === undefined ? [0, 0] : [-slnt.maximum, -slnt.minimum];
        } else if ((selection & ITALIC_SELECTION) !== 0 || (macStyle & ITALIC_MAC_STYLE) !== 0) {
            traits.italic = [1, 1];
            delete traits.oblique;
        } else if ((selection & OBLIQUE_SELECTION) !== 0) {
            const angle: number = -italicAngle();
            delete traits.italic;
            traits.oblique = [angle, angle];
        }
        return traits;
    }

    private descriptorRange(single: (value: CssValue) => number | undefined, value?: CssValue): Range | undefined {
        // CSS Fonts 4 §4.4 to §4.6: one value, or two values giving a range; auto takes the values of the font.
        if (value === undefined) {
            return undefined;
        }
        if (value.kind === "list" && value.separator === "space" && value.items.length === 2) {
            const first: number | undefined = single(value.items[0]);
            const second: number | undefined = single(value.items[1]);
            return first === undefined || second === undefined ? undefined : [Math.min(first, second), Math.max(first, second)];
        }
        const number: number | undefined = single(value);
        return number === undefined ? undefined : [number, number];
    }

    private weightOf(value: CssValue): number | undefined {
        if (value.kind === "number") {
            return value.value;
        }
        if (value.kind === "ident") {
            return value.lower === "normal" ? 400 : (value.lower === "bold" ? 700 : undefined);
        }
        return undefined;
    }

    private widthOf(value: CssValue): number | undefined {
        if (value.kind === "percentage") {
            return value.value;
        }
        return value.kind === "ident" ? FontMatcher.WIDTH_KEYWORDS.get(value.lower) : undefined;
    }

    private descriptorStyle(value?: CssValue): DeclaredStyle | undefined {
        // CSS Fonts 4 §4.4: the values mean what they mean for font-style: normal, italic, italic slanted clockwise (left) or
        // counter-clockwise (right), or oblique with one angle or a range of two, 14deg when none is given; auto uses the font.
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const keyword: string | undefined = items[0].kind === "ident" ? items[0].lower : undefined;
        switch (keyword) {
            case "normal":
                return { italic: [0, 0], oblique: [0, 0] };
            case "italic":
                return { italic: [1, 1] };
            case "left":
                return { italic: [1, 1], slant: 1 };
            case "right":
                return { italic: [1, 1], slant: -1 };
            case "oblique":
                break;
            default:
                return undefined;
        }
        const angles: Array<number> = items.slice(1).map((item: CssValue) => this.degrees(item)).filter((angle: number | undefined): angle is number => angle !== undefined);
        const from: number = angles.length > 0 ? angles[0] : FontMatcher.DEFAULT_OBLIQUE;
        const to: number = angles.length > 1 ? angles[1] : from;
        return { oblique: [Math.min(from, to), Math.max(from, to)] };
    }

    private degrees(value: CssValue): number | undefined {
        if (value.kind === "dimension") {
            return this.units.baseTypeOf(value.unit) === "angle" ? this.units.toCanonical(value.value, value.unit) : undefined;
        }
        return value.kind === "number" && value.value === 0 ? 0 : undefined;
    }

    private unicodeRanges(value?: CssValue): ReadonlyArray<Range> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "comma" ? value.items : [value];
        const ranges: Array<Range> = [];
        for (const item of items) {
            if (item.kind === "unicode-range") {
                ranges.push([item.start, item.end]);
            }
        }
        return ranges;
    }

    private instance(candidate: Candidate, chosen: Chosen, request: FontRequest): FontInstance | undefined {
        const typeface: Typeface | undefined = this.catalog.typeface(candidate.face);
        if (typeface === undefined) {
            return undefined;
        }
        // CSS Fonts 4 §7.2, in ascending precedence: the matched weight, width and style; the named instance and then the
        // font-variation-settings of the @font-face rule; font-optical-sizing; the font-variation-settings property.
        const axes: Record<string, number> = { wght: chosen.weight, wdth: chosen.width };
        if (chosen.italic !== undefined) {
            axes["ital"] = chosen.italic;
        }
        if (chosen.oblique !== undefined) {
            axes["slnt"] = -chosen.oblique;
        }
        const descriptors: Readonly<Record<string, CssValue>> | undefined = candidate.face.rule?.descriptors;
        const named: CssValue | undefined = descriptors?.["font-named-instance"];
        const variations: FontVariations | undefined = typeface.variations;
        if (named !== undefined && named.kind === "string" && variations !== undefined) {
            // §5.1: names are matched without regard to case.
            const wanted: string = named.value.toLowerCase();
            const preset: NamedInstance | undefined = variations.instances.find((entry: NamedInstance) => entry.name.toLowerCase() === wanted);
            if (preset !== undefined) {
                for (const [index, axis] of variations.axes.entries()) {
                    axes[axis.tag] = preset.coordinates[index];
                }
            }
        }
        this.applySettings(axes, descriptors?.["font-variation-settings"]);
        if (request.opticalSizing) {
            axes["opsz"] = request.size;
        }
        this.applySettings(axes, request.variations);
        const instance: FontInstance = this.instanceAt(candidate, typeface, axes, chosen);
        if (!request.opticalSizing || request.adjustedSize === undefined || variations === undefined || !variations.axes.some((axis: VariationAxis) => axis.tag === "opsz")) {
            return instance;
        }
        // §8.1: "apply an optical sizing value appropriate for the adjusted font size", which needs the metrics of a built instance.
        axes["opsz"] = request.adjustedSize(instance);
        this.applySettings(axes, request.variations);
        return this.instanceAt(candidate, typeface, axes, chosen);
    }

    private instanceAt(candidate: Candidate, typeface: Typeface, axes: Readonly<Record<string, number>>, chosen: Chosen): FontInstance {
        const shared: string = typeface.source + "#" + typeface.index + "|" + (typeface.variations === undefined ? "" : JSON.stringify(axes));
        // Each @font-face rule has an instance of its own, since its descriptors apply only to the text it gives glyphs for, and
        // so does each synthesized face, which draws the same glyphs otherwise.
        const synthetic: string = chosen.emboldening === undefined && chosen.skew === undefined ? "" : "|" + (chosen.emboldening ?? 0) + "|" + (chosen.skew ?? 0);
        const key: string = (candidate.face.rule === undefined ? shared : shared + "|" + candidate.face.rule.order) + synthetic;
        let instance: FontInstance | undefined = this.instances.get(key);
        if (instance === undefined) {
            let built: FontInstance | undefined = this.built.get(shared);
            if (built === undefined) {
                built = this.builder.build(typeface, axes);
                this.built.set(shared, built);
            }
            instance = key === shared ? built : { ...built };
            if (candidate.overrides !== undefined) {
                instance.overrides = candidate.overrides;
            }
            if (chosen.emboldening !== undefined) {
                // CSS Fonts 4 §2.8: "a thin stroke around each glyph", whose width is the user agent's: in font units, as much as the
                // standard fonts' bold faces thicken their stems for the weight that the synthesized face adds.
                instance.emboldening = FontMatcher.STEM_GAIN * chosen.emboldening * built.metrics.unitsPerEm;
            }
            if (chosen.skew !== undefined) {
                instance.skew = chosen.skew;
            }
            this.instances.set(key, instance);
            this.faces.set(instance, candidate.face);
        }
        return instance;
    }

    private applySettings(axes: Record<string, number>, value?: CssValue): void {
        // CSS Fonts 4 §8.2: normal, or a list of pairs of an axis tag and its value.
        if (value === undefined) {
            return;
        }
        for (const entry of value.kind === "list" && value.separator === "comma" ? value.items : [value]) {
            if (entry.kind !== "list" || entry.items.length !== 2) {
                continue;
            }
            const tag: CssValue = entry.items[0];
            const amount: CssValue = entry.items[1];
            if (tag.kind === "string" && amount.kind === "number") {
                axes[tag.value] = amount.value;
            }
        }
    }

    faceOf(instance: FontInstance): CatalogFace | undefined {
        // CSS Fonts 4 §7.2: the font features of the @font-face rule of a font, and the family its feature values are for.
        return this.faces.get(instance);
    }
}
