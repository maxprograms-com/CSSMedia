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
import { FontCatalog } from "../fonts/FontCatalog.js";
import { InstanceBuilder } from "../fonts/InstanceBuilder.js";
import type { BaseCoordinate, BaselineAxis, FaceMetrics, FaceOverrides, FontBaselines, FontInstance, LineMetrics, MetricOverride, ScriptBaselines } from "../fonts/Typeface.js";
import { VerticalMetrics } from "../fonts/VerticalMetrics.js";
import { MathTable } from "../mathml/MathTable.js";
import type { FamilyReference, FontMatcher, FontRequest } from "./FontMatcher.js";

const MATH_SCALE: number = 0.71;
const SPACE: number = 0x20;
const ZERO: number = 0x30;
const WATER: number = 0x6C34;
const DECORATION_THICKNESS: number = 15;
const DECORATION_OFFSET: number = 10;

export class FontMetrics {

    readonly matcher: FontMatcher;
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();
    private readonly verticalMetrics: VerticalMetrics = new VerticalMetrics();
    private readonly instances: InstanceBuilder = new InstanceBuilder();
    private readonly cache: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();
    private readonly keys: WeakMap<Readonly<Record<string, CssValue>>, string> = new WeakMap<Readonly<Record<string, CssValue>>, string>();
    private readonly changing: WeakSet<Readonly<Record<string, CssValue>>> = new WeakSet<Readonly<Record<string, CssValue>>>();
    private readonly interned: Map<string, string> = new Map<string, string>();

    constructor(matcher: FontMatcher) {
        this.matcher = matcher;
    }

    emboldening(font: FontInstance, size: number): number {
        return font.emboldening === undefined ? 0 : font.emboldening * size / font.metrics.unitsPerEm;
    }

    unsettled(values: Readonly<Record<string, CssValue>>): void {
        // The values of an element that is being computed still change, so what is found for them is not remembered.
        this.changing.add(values);
    }

    fontKey(values: Readonly<Record<string, CssValue>>): string {
        // The computed values that decide the font of the text and its metrics.
        let key: string | undefined = this.changing.has(values) ? undefined : this.keys.get(values);
        if (key === undefined) {
            key = JSON.stringify([values["font-family"], values["font-size"], values["font-weight"], values["font-width"],
            values["font-style"], values["font-optical-sizing"], values["font-variation-settings"], values["font-size-adjust"], values["writing-mode"],
            values["text-orientation"], values["font-synthesis-weight"], values["font-synthesis-style"]]);
            if (!this.changing.has(values)) {
                // Many styles have the same key, and each of them would keep its own copy of the text.
                const shared: string | undefined = this.interned.get(key);
                if (shared === undefined) {
                    this.interned.set(key, key);
                } else {
                    key = shared;
                }
                this.keys.set(values, key);
            }
        }
        return key;
    }

    fontSize(values: Readonly<Record<string, CssValue>>): number {
        const size: CssValue | undefined = values["font-size"];
        return size !== undefined && size.kind === "length" ? size.px : 0;
    }

    xHeight(values: Readonly<Record<string, CssValue>>): number {
        // CSS Values 4 §6.1.1: the x-height of the first available font, or 0.5em when it cannot be determined.
        return this.cached("ex", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            const height: number | undefined = instance?.metrics.xHeight;
            return instance !== undefined && height !== undefined && height > 0 ? this.scaled(instance, height, values) : this.fontSize(values) / 2;
        });
    }

    capHeight(values: Readonly<Record<string, CssValue>>): number {
        // CSS Values 4 §6.1.1: the cap-height of the first available font, or its ascent when that cannot be determined.
        return this.cached("cap", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            if (instance === undefined) {
                return this.fontSize(values);
            }
            const height: number | undefined = instance.metrics.capHeight;
            return this.scaled(instance, height !== undefined && height > 0 ? height : this.lines(instance, this.upright(values)).ascender, values);
        });
    }

    zeroAdvance(values: Readonly<Record<string, CssValue>>): number {
        // CSS Values 4 §6.1.1: the advance of "0" in the font used to render it; otherwise 0.5em, or 1em when typeset upright.
        return this.cached("ch", values, () => {
            const upright: boolean = this.upright(values);
            const advance: number | undefined = this.advance(values, ZERO, upright);
            return advance ?? (upright ? this.fontSize(values) : this.fontSize(values) / 2);
        });
    }

    spaceAdvance(values: Readonly<Record<string, CssValue>>): number {
        // CSS Text 4 §4.4: tab-size counts in "the advance width of the space character (U+0020)".
        return this.cached("space", values, () => this.advance(values, SPACE, false) ?? 0);
    }

    ideographicAdvance(values: Readonly<Record<string, CssValue>>): number {
        // CSS Values 4 §6.1.1: the advance of "水" in the font used to render it, in the inline axis; otherwise 1em.
        return this.cached("ic", values, () => {
            const upright: boolean = this.vertical(values) && this.keyword(values, "text-orientation") !== "sideways";
            return this.advance(values, WATER, upright) ?? this.fontSize(values);
        });
    }

    lineHeight(values: Readonly<Record<string, CssValue>>): number {
        // CSS Values 4 §6.1.1: the computed line-height, with normal converted using only the first available font.
        const lineHeight: CssValue | undefined = values["line-height"];
        if (lineHeight !== undefined && lineHeight.kind === "length") {
            return lineHeight.px;
        }
        if (lineHeight !== undefined && lineHeight.kind === "number") {
            return lineHeight.value * this.fontSize(values);
        }
        return this.cached("lh", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            if (instance === undefined) {
                return this.fontSize(values);
            }
            // CSS Inline 3 §3.2.2: the ascent and descent metrics, and the line gap floored at zero, which normal may include.
            // CSS Fonts 5 §3.4: font-size-adjust "does not affect the used value of line-height"; §4.4: size-adjust scales the metrics.
            const metrics: LineMetrics = this.lines(instance, this.upright(values));
            return (metrics.ascender - metrics.descender + Math.max(0, metrics.lineGap)) * this.fontSize(values) * (instance.overrides?.sizeAdjust ?? 1)
                / instance.metrics.unitsPerEm;
        });
    }

    underline(values: Readonly<Record<string, CssValue>>): readonly [number, number] {
        const thickness: number = this.cached("underline-thickness", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            const units: number | undefined = instance?.metrics.underlineThickness;
            return instance !== undefined && units !== undefined && units > 0 ? this.scaled(instance, units, values) : this.fontSize(values) / DECORATION_THICKNESS;
        });
        const offset: number = this.cached("underline-offset", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            return instance === undefined ? this.fontSize(values) / DECORATION_OFFSET : this.runUnderline(instance, this.usedSize(values, instance));
        });
        return [offset, thickness];
    }

    runUnderline(instance: FontInstance, size: number): number {
        // The post table gives the top of the underline, and Adobe Font Metrics the middle of the stroke.
        const metrics: FaceMetrics = instance.metrics;
        if (metrics.underlinePosition === undefined) {
            return size / DECORATION_OFFSET;
        }
        const scale: number = size / metrics.unitsPerEm;
        const thickness: number = metrics.underlineThickness !== undefined && metrics.underlineThickness > 0 ? metrics.underlineThickness * scale : size / DECORATION_THICKNESS;
        return -metrics.underlinePosition * scale - (instance.typeface.standardFont === undefined ? 0 : thickness / 2);
    }

    strikeout(instance: FontInstance, size: number): readonly [number, number] {
        const metrics: FaceMetrics = instance.metrics;
        const scale: number = size / metrics.unitsPerEm;
        const thickness: number = metrics.strikeoutSize !== undefined && metrics.strikeoutSize > 0 ? metrics.strikeoutSize * scale
            : (metrics.underlineThickness !== undefined && metrics.underlineThickness > 0 ? metrics.underlineThickness * scale : size / DECORATION_THICKNESS);
        if (metrics.strikeoutPosition !== undefined && metrics.strikeoutPosition > 0) {
            return [metrics.strikeoutPosition * scale, thickness];
        }
        const middle: number = metrics.xHeight !== undefined && metrics.xHeight > 0 ? metrics.xHeight * scale / 2 : size / 4;
        return [middle + thickness / 2, thickness];
    }

    ascent(values: Readonly<Record<string, CssValue>>): number {
        // CSS Inline 3 §3.2.2: the ascent metric of the first available font; without a font, the font size.
        return this.cached("ascent", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            return instance === undefined ? this.fontSize(values) : this.scaled(instance, this.lines(instance, this.upright(values)).ascender, values);
        });
    }

    descent(values: Readonly<Record<string, CssValue>>): number {
        // CSS Inline 3 §3.2.2: the descent metric of the first available font, as a distance below the baseline.
        return this.cached("descent", values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            return instance === undefined ? 0 : -this.scaled(instance, this.lines(instance, this.upright(values)).descender, values);
        });
    }

    baseline(values: Readonly<Record<string, CssValue>>, type: string): number {
        // CSS Inline 3 §3.3: the baseline set of an inline box "derives from its first available font"; the result is how
        // far the baseline is above the alphabetic one.
        if (type === "alphabetic") {
            return 0;
        }
        // §4.1: under text-orientation: upright, middle uses the central baseline.
        const upright: boolean = this.upright(values);
        const used: string = type === "middle" && upright ? "central" : type;
        const vertical: boolean = this.vertical(values);
        return this.cached("baseline-" + used + (vertical ? "-vertical" : ""), values, () => {
            const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
            return instance === undefined ? 0 : this.fontBaseline(instance, this.usedSize(values, instance), used, vertical, upright);
        });
    }

    fontBaseline(instance: FontInstance, size: number, type: string, vertical: boolean, upright: boolean): number {
        const metrics: FaceMetrics = instance.metrics;
        const line: LineMetrics = this.lines(instance, upright);
        const under: number | undefined = this.tableBaseline(instance, "ideo", vertical);
        const over: number | undefined = this.tableBaseline(instance, "idtp", vertical);
        let units: number = 0;
        switch (type) {
            case "text-top":
                units = line.ascender;
                break;
            case "text-bottom":
                units = line.descender;
                break;
            case "middle":
                units = (metrics.xHeight !== undefined && metrics.xHeight > 0 ? metrics.xHeight : metrics.unitsPerEm / 2) / 2;
                break;
            case "central":
                // CSS Inline 3 A.2: the central baseline is halfway between the ideographic ones, which "are typically 1em
                // apart", and the ascent and descent stand for them "when both are missing".
                if (under !== undefined) {
                    units = over !== undefined ? (over + under) / 2 : under + metrics.unitsPerEm / 2;
                } else {
                    units = over !== undefined ? over - metrics.unitsPerEm / 2 : (line.ascender + line.descender) / 2;
                }
                break;
            case "ideographic":
                units = under ?? (over !== undefined ? over - metrics.unitsPerEm : line.descender);
                break;
            case "ideographic-over":
                units = over ?? (under !== undefined ? under + metrics.unitsPerEm : line.ascender);
                break;
            case "ideographic-ink-over":
                units = this.tableBaseline(instance, "icft", vertical) ?? over ?? (under !== undefined ? under + metrics.unitsPerEm : line.ascender);
                break;
            case "ideographic-ink-under":
                units = this.tableBaseline(instance, "icfb", vertical) ?? under ?? (over !== undefined ? over - metrics.unitsPerEm : line.descender);
                break;
            case "cap":
                units = metrics.capHeight !== undefined && metrics.capHeight > 0 ? metrics.capHeight : line.ascender;
                break;
            case "ex":
                units = metrics.xHeight !== undefined && metrics.xHeight > 0 ? metrics.xHeight : metrics.unitsPerEm / 2;
                break;
            case "mathematical":
                units = this.tableBaseline(instance, "math", vertical) ?? (metrics.xHeight !== undefined && metrics.xHeight > 0 ? metrics.xHeight : metrics.unitsPerEm / 2) / 2;
                break;
            case "hanging":
                units = this.tableBaseline(instance, "hang", vertical) ?? (metrics.capHeight !== undefined && metrics.capHeight > 0 ? metrics.capHeight : line.ascender);
                break;
            default:
                units = 0;
        }
        return units * size / metrics.unitsPerEm;
    }

    fontExtent(instance: FontInstance, size: number, upright: boolean): readonly [number, number] {
        // CSS Inline 3 §5.3: with line-height: normal the ascent and descent of each font that gives glyphs count, and "the
        // font's line gap metric may also be incorporated into A and D by adding half to each side".
        const line: LineMetrics = this.lines(instance, upright);
        const scale: number = size / instance.metrics.unitsPerEm;
        const half: number = Math.max(0, line.lineGap) / 2;
        return [(line.ascender + half) * scale, (half - line.descender) * scale];
    }

    private tableBaseline(instance: FontInstance, tag: string, vertical: boolean): number | undefined {
        // OpenType BASE gives the baselines of each line direction by script, and VertAxis may be absent; the default script
        // speaks for the font, and the coordinates are counted from the alphabetic baseline, which the table calls romn.
        const baselines: FontBaselines = instance.typeface.baselines;
        const axis: BaselineAxis | undefined = vertical ? baselines.vertical ?? baselines.horizontal : baselines.horizontal;
        const scripts: ReadonlyArray<ScriptBaselines> | undefined = axis?.scripts;
        const script: ScriptBaselines | undefined = scripts?.find((entry: ScriptBaselines) => entry.script === "DFLT")
            ?? scripts?.find((entry: ScriptBaselines) => entry.script === "latn") ?? scripts?.[0];
        const coordinate: BaseCoordinate | undefined = script?.coordinates[tag];
        if (script === undefined || coordinate === undefined) {
            return undefined;
        }
        const alphabetic: BaseCoordinate | undefined = script.coordinates["romn"];
        return this.variedBaseline(instance, coordinate) - (alphabetic === undefined ? 0 : this.variedBaseline(instance, alphabetic));
    }

    private variedBaseline(instance: FontInstance, coordinate: BaseCoordinate): number {
        const store: FontBaselines["store"] = instance.typeface.baselines.store;
        return store === undefined ? coordinate.value
            : coordinate.value + this.instances.delta(store, this.instances.scalars(store, instance.coordinates), coordinate.outer, coordinate.inner);
    }

    firstFont(values: Readonly<Record<string, CssValue>>): FontInstance | undefined {
        return this.matcher.firstAvailable(this.request(values));
    }

    mathScale(parent: Readonly<Record<string, CssValue>>, inherited: number, computed: number): number {
        // MathML Core §4.5: the scale factor from the inherited math-depth A to the computed one B, 0.71 per level, with the
        // first levels taken from the MATH table of the inherited first available font when it has one.
        if (inherited === computed) {
            return 1;
        }
        const low: number = Math.min(inherited, computed);
        const high: number = Math.max(inherited, computed);
        let levels: number = high - low;
        let scale: number = 1;
        const instance: FontInstance | undefined = this.firstFont(parent);
        const scaleDowns: readonly [number, number] | undefined = instance === undefined ? undefined : new MathTable(instance.typeface.tables["MATH"]).scaleDowns();
        if (scaleDowns !== undefined) {
            if (low <= 0 && high >= 2) {
                scale *= scaleDowns[1];
                levels -= 2;
            } else if (low === 1) {
                scale *= scaleDowns[1] / scaleDowns[0];
                levels -= 1;
            } else if (high === 1) {
                scale *= scaleDowns[0];
                levels -= 1;
            }
        }
        scale *= Math.pow(MATH_SCALE, levels);
        return computed < inherited ? 1 / scale : scale;
    }

    request(values: Readonly<Record<string, CssValue>>): FontRequest {
        const weight: CssValue | undefined = values["font-weight"];
        const width: CssValue | undefined = values["font-width"];
        const style: CssValue | undefined = values["font-style"];
        const items: ReadonlyArray<CssValue> | undefined = style === undefined ? undefined : (style.kind === "list" ? style.items : [style]);
        const keyword: string = items !== undefined && items.length > 0 && items[0].kind === "ident" ? items[0].lower : "normal";
        const angle: CssValue | undefined = items?.[1];
        const optical: CssValue | undefined = values["font-optical-sizing"];
        const synthesisWeight: CssValue | undefined = values["font-synthesis-weight"];
        const synthesisStyle: CssValue | undefined = values["font-synthesis-style"];
        const request: FontRequest = {
            families: this.families(values["font-family"]),
            weight: weight !== undefined && weight.kind === "number" ? weight.value : 400,
            width: width !== undefined && width.kind === "percentage" ? width.value : 100,
            style: keyword === "normal" || keyword === "left" || keyword === "right" || keyword === "oblique" ? keyword : "italic",
            angle: angle !== undefined && angle.kind === "dimension" ? angle.value : 0,
            size: this.fontSize(values),
            opticalSizing: !(optical !== undefined && optical.kind === "ident" && optical.lower === "none"),
            boldSynthesis: !(synthesisWeight !== undefined && synthesisWeight.kind === "ident" && synthesisWeight.lower === "none"),
            styleSynthesis: synthesisStyle !== undefined && synthesisStyle.kind === "ident" && (synthesisStyle.lower === "none" || synthesisStyle.lower === "oblique-only")
                ? synthesisStyle.lower as "none" | "oblique-only" : "auto"
        };
        const variations: CssValue | undefined = values["font-variation-settings"];
        if (variations !== undefined) {
            request.variations = variations;
        }
        const adjust: CssValue | undefined = values["font-size-adjust"];
        if (adjust !== undefined && adjust.kind === "list") {
            request.adjustedSize = (instance: FontInstance): number => this.usedSize(values, instance);
        }
        return request;
    }

    private families(value?: CssValue): Array<FamilyReference> {
        // CSS Fonts 4 §2.1: a generic family is an unquoted keyword; a family name is a string or a sequence of identifiers.
        const families: Array<FamilyReference> = [];
        if (value === undefined) {
            return families;
        }
        for (const item of value.kind === "list" && value.separator === "comma" ? value.items : [value]) {
            if (item.kind === "string") {
                families.push({ name: item.value, generic: false });
            } else if (item.kind === "ident") {
                const generic: boolean = FontCatalog.GENERIC_FAMILIES.has(item.lower);
                families.push({ name: generic ? item.lower : item.name, generic });
            } else if (item.kind === "list" && item.separator === "space" && item.items.every((part: CssValue) => part.kind === "ident")) {
                families.push({ name: item.items.map((part: CssValue) => (part as { name: string }).name).join(" "), generic: false });
            }
        }
        return families;
    }

    private advance(values: Readonly<Record<string, CssValue>>, code: number, vertical: boolean): number | undefined {
        const instance: FontInstance | undefined = this.matcher.fontFor(this.request(values), code);
        if (instance === undefined) {
            return undefined;
        }
        const glyph: number = this.lookup.glyphOf(instance.typeface.characters, code);
        const advances: Float64Array | undefined = vertical ? instance.verticalAdvances : instance.advances;
        return advances === undefined || glyph >= advances.length ? undefined : this.scaled(instance, advances[glyph], values);
    }

    private lines(instance: FontInstance, upright: boolean): LineMetrics {
        // CSS Inline 3 §3.2.1 recommends sTypoAscender and sTypoDescender, and the hhea metrics in their absence. CSS Fonts 5 §4.5:
        // an override replaces a metric by a share of the font size, with its y axis value "when typesetting upright".
        const metrics: LineMetrics = instance.metrics.typographic ?? instance.metrics.horizontal;
        const overrides: FaceOverrides | undefined = instance.overrides;
        if (overrides === undefined) {
            return metrics;
        }
        const axis: number = upright ? 1 : 0;
        const ascent: MetricOverride | undefined = overrides.ascent[axis];
        const descent: MetricOverride | undefined = overrides.descent[axis];
        const lineGap: MetricOverride | undefined = overrides.lineGap[axis];
        const em: number = instance.metrics.unitsPerEm;
        return {
            ascender: typeof ascent === "number" ? ascent * em : metrics.ascender,
            descender: typeof descent === "number" ? -descent * em : metrics.descender,
            lineGap: typeof lineGap === "number" ? lineGap * em : metrics.lineGap
        };
    }

    private scaled(instance: FontInstance, units: number, values: Readonly<Record<string, CssValue>>): number {
        return units * this.usedSize(values, instance) / instance.metrics.unitsPerEm;
    }

    usedSize(values: Readonly<Record<string, CssValue>>, instance: FontInstance): number {
        // CSS Fonts 5 §3.4: "u = ( m / m′ ) s" for each font that is used, a font without the metric keeping the computed size;
        // §4.4: size-adjust scales the glyphs of its font, and font-size-adjust "is applied after" it.
        const size: number = this.fontSize(values);
        const sizeAdjust: number = instance.overrides?.sizeAdjust ?? 1;
        const adjust: CssValue | undefined = values["font-size-adjust"];
        if (adjust === undefined || adjust.kind !== "list" || adjust.items.length !== 2) {
            return size * sizeAdjust;
        }
        const metric: CssValue = adjust.items[0];
        const wanted: CssValue = adjust.items[1];
        const own: number | undefined = metric.kind === "ident" && wanted.kind === "number" ? this.aspect(instance, metric.lower) : undefined;
        return own === undefined || wanted.kind !== "number" ? size * sizeAdjust : size * wanted.value / own * sizeAdjust;
    }

    firstAspect(values: Readonly<Record<string, CssValue>>, metric: string): number | undefined {
        const instance: FontInstance | undefined = this.matcher.firstAvailable(this.request(values));
        return instance === undefined ? undefined : this.aspect(instance, metric);
    }

    private aspect(instance: FontInstance, metric: string): number | undefined {
        // CSS Fonts 5 §3.4: the x-height, the cap-height, the advance width of "0", or the advance width or height of "水",
        // each "divided by the font size"; §4.4: size-adjust scales "all metrics associated with this font".
        const metrics: FaceMetrics = instance.metrics;
        let units: number | undefined;
        switch (metric) {
            case "ex-height":
                units = metrics.xHeight;
                break;
            case "cap-height":
                units = metrics.capHeight;
                break;
            case "ch-width":
                units = this.glyphAdvance(instance, ZERO, false);
                break;
            case "ic-width":
                units = this.glyphAdvance(instance, WATER, false);
                break;
            case "ic-height":
                units = this.glyphAdvance(instance, WATER, true);
                break;
            default:
                units = undefined;
        }
        return units === undefined || units <= 0 ? undefined : units * (instance.overrides?.sizeAdjust ?? 1) / metrics.unitsPerEm;
    }

    private glyphAdvance(instance: FontInstance, code: number, vertical: boolean): number | undefined {
        const glyph: number = this.lookup.glyphOf(instance.typeface.characters, code);
        if (glyph === 0) {
            return undefined;
        }
        return vertical ? this.verticalMetrics.advance(instance, glyph) : instance.advances[glyph];
    }

    vertical(values: Readonly<Record<string, CssValue>>): boolean {
        const mode: string | undefined = this.keyword(values, "writing-mode");
        return mode === "vertical-rl" || mode === "vertical-lr";
    }

    private upright(values: Readonly<Record<string, CssValue>>): boolean {
        return this.vertical(values) && this.keyword(values, "text-orientation") === "upright";
    }

    private keyword(values: Readonly<Record<string, CssValue>>, property: string): string | undefined {
        const value: CssValue | undefined = values[property];
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }

    private cached(metric: string, values: Readonly<Record<string, CssValue>>, measure: () => number): number {
        const key: string = this.fontKey(values);
        let metrics: Map<string, number> | undefined = this.cache.get(key);
        if (metrics === undefined) {
            metrics = new Map<string, number>();
            this.cache.set(key, metrics);
        }
        let value: number | undefined = metrics.get(metric);
        if (value === undefined) {
            value = measure();
            metrics.set(metric, value);
        }
        return value;
    }
}
