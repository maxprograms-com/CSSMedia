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

import type { CssNode, MediaQuery, MediaQueryList } from "css-tree";
import { walk } from "css-tree";
import { STANDARD_FONTS } from "../fonts/generated/StandardFonts.js";
import type { StandardFontData } from "../fonts/Typeface.js";
import { FontMatcher } from "../pdf/FontMatcher.js";
import { AsciiCase } from "./AsciiCase.js";
import { CssUnits } from "./values/CssUnits.js";
import { CssValueParser } from "./values/CssValueParser.js";

export type TriState = "true" | "false" | "unknown";

export interface PageSize {
    width: number;
    height: number;
}

type RangeType = "length" | "ratio" | "resolution" | "integer";

interface DiscreteFeature {
    values: ReadonlyArray<string>;
    current?: string;
}

const SIZE_FEATURES: ReadonlySet<string> = new Set<string>([
    "width", "height", "aspect-ratio", "orientation", "device-width", "device-height", "device-aspect-ratio"
]);

const RANGE_FEATURES: Readonly<Record<string, RangeType>> = {
    "width": "length",
    "height": "length",
    "aspect-ratio": "ratio",
    "horizontal-viewport-segments": "integer",
    "vertical-viewport-segments": "integer",
    "resolution": "resolution",
    "color": "integer",
    "color-index": "integer",
    "monochrome": "integer",
    "device-width": "length",
    "device-height": "length",
    "device-aspect-ratio": "ratio"
};

const DISCRETE_FEATURES: Readonly<Record<string, DiscreteFeature>> = {
    "overflow-block": { values: ["none", "scroll", "paged"], current: "paged" },
    "overflow-inline": { values: ["none", "scroll"], current: "none" },
    "display-mode": { values: ["fullscreen", "standalone", "minimal-ui", "browser", "picture-in-picture"] },
    "scan": { values: ["interlace", "progressive"] },
    "grid": { values: ["0", "1"], current: "0" },
    "update": { values: ["none", "slow", "fast"], current: "none" },
    "environment-blending": { values: ["opaque", "additive", "subtractive"], current: "opaque" },
    "color-gamut": { values: ["srgb", "p3", "rec2020"], current: "srgb" },
    "dynamic-range": { values: ["standard", "high"], current: "standard" },
    "inverted-colors": { values: ["none", "inverted"], current: "none" },
    "pointer": { values: ["none", "coarse", "fine"], current: "none" },
    "hover": { values: ["none", "hover"], current: "none" },
    "any-pointer": { values: ["none", "coarse", "fine"], current: "none" },
    "any-hover": { values: ["none", "hover"], current: "none" },
    "nav-controls": { values: ["none", "back"], current: "none" },
    "video-color-gamut": { values: ["srgb", "p3", "rec2020"], current: "srgb" },
    "video-dynamic-range": { values: ["standard", "high"], current: "standard" },
    "scripting": { values: ["none", "initial-only", "enabled"], current: "none" },
    "prefers-reduced-motion": { values: ["no-preference", "reduce"], current: "no-preference" },
    "prefers-reduced-transparency": { values: ["no-preference", "reduce"], current: "no-preference" },
    "prefers-contrast": { values: ["no-preference", "less", "more", "custom"], current: "no-preference" },
    "forced-colors": { values: ["none", "active"], current: "none" },
    "prefers-color-scheme": { values: ["light", "dark"], current: "light" },
    "prefers-reduced-data": { values: ["no-preference", "reduce"], current: "no-preference" },
    "display-state": { values: ["normal", "minimized", "maximized", "fullscreen"] },
    "resizable": { values: ["true", "false"], current: "false" },
    "shape": { values: ["rect", "round"], current: "rect" }
};

const FALSE_IN_BOOLEAN_CONTEXT: ReadonlySet<string> = new Set<string>(["none", "no-preference", "0", "false"]);

const INITIAL_FONT_SIZE_PX: number = 16;
const DIGIT_ZERO: number = 0x30;
const VIEWPORT_UNIT: RegExp = /^(?:[sld]?v|cq)(w|h|i|b|min|max)$/;

export class ConditionEvaluator {

    private readonly page: PageSize;
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly units: CssUnits = new CssUnits();
    private readonly customMedia: Map<string, MediaQueryList | boolean> = new Map<string, MediaQueryList | boolean>();
    private readonly evaluating: Set<string> = new Set<string>();

    constructor(page: PageSize) {
        this.page = page;
    }

    define(name: string, value: MediaQueryList | boolean): void {
        // Media Queries 5 §10: the last @custom-media rule for a name is the one that counts.
        this.customMedia.set(name, value);
    }

    matchesList(list: MediaQueryList | null): boolean {
        // Media Queries 5 §2.1: an empty list is true, and a list is true when any of its queries is true.
        if (list === null || list.children.isEmpty) {
            return true;
        }
        for (const query of list.children) {
            if (query.type === "MediaQuery" && this.evaluateQuery(query) === "true") {
                return true;
            }
        }
        return false;
    }

    evaluate(list: MediaQueryList): TriState {
        // CSS Values 5 §7.3: media() in if() keeps unknown for the boolean logic around it.
        let result: TriState = "false";
        for (const query of list.children) {
            const state: TriState = query.type === "MediaQuery" ? this.evaluateQuery(query) : "unknown";
            if (state === "true") {
                return "true";
            }
            if (state === "unknown") {
                result = "unknown";
            }
        }
        return result;
    }

    mentionsPageSize(list: MediaQueryList | null): boolean {
        // CSS Paged Media 3 §7.1: a size declaration qualified by a query on the page size is ignored.
        let found: boolean = false;
        if (list === null) {
            return false;
        }
        for (const query of list.children) {
            if (query.type === "MediaQuery" && query.condition !== null) {
                found = found || this.conditionMentionsSize(query.condition);
            }
        }
        return found;
    }

    private conditionMentionsSize(node: CssNode): boolean {
        if (node.type === "Feature" && node.name.startsWith("--")) {
            const definition: MediaQueryList | boolean | undefined = this.customMedia.get(node.name);
            if (definition === undefined || typeof definition === "boolean" || this.evaluating.has(node.name)) {
                return false;
            }
            this.evaluating.add(node.name);
            const mentions: boolean = this.mentionsPageSize(definition);
            this.evaluating.delete(node.name);
            return mentions;
        }
        if (node.type === "Feature") {
            return SIZE_FEATURES.has(this.baseName(node.name));
        }
        if (node.type === "FeatureRange") {
            const name: string | undefined = this.rangeName(node.left, node.middle, node.right);
            return name !== undefined && SIZE_FEATURES.has(name);
        }
        if (node.type === "Condition") {
            return node.children.toArray().some((child: CssNode) => this.conditionMentionsSize(child));
        }
        return false;
    }

    private evaluateQuery(query: MediaQuery): TriState {
        // Media Queries 5 §3.2: what fails the grammar comes as a query with neither a type nor a condition, and is not all.
        if (query.mediaType === null && query.condition === null) {
            return "false";
        }
        // Media Queries 5 §2.3: a query without a type is for all media; only print and all describe a PDF.
        const type: string = query.mediaType === null ? "all" : this.asciiCase.foldLower(query.mediaType);
        const typeResult: TriState = type === "print" || type === "all" ? "true" : "false";
        const conditionResult: TriState = query.condition === null ? "true" : this.evaluateCondition(query.condition);
        const combined: TriState = this.and([typeResult, conditionResult]);
        return query.modifier === "not" ? this.not(combined) : combined;
    }

    private evaluateCondition(node: CssNode): TriState {
        switch (node.type) {
            case "Condition":
                return this.evaluateChildren(node.children.toArray());
            case "Feature":
                return this.evaluateFeature(node.name, node.value);
            case "FeatureRange":
                return this.evaluateRange(node.left, node.leftComparison, node.middle, node.rightComparison, node.right);
            default:
                // Media Queries 5 §3.1: <general-enclosed> evaluates to unknown.
                return "unknown";
        }
    }

    private evaluateChildren(children: ReadonlyArray<CssNode>): TriState {
        if (children.length === 2 && children[0].type === "Identifier" && this.asciiCase.foldLower(children[0].name) === "not") {
            return this.not(this.evaluateCondition(children[1]));
        }
        const operands: Array<TriState> = [];
        let operator: string = "and";
        for (const child of children) {
            if (child.type === "Identifier" && ["and", "or"].includes(this.asciiCase.foldLower(child.name))) {
                operator = this.asciiCase.foldLower(child.name);
            } else {
                operands.push(this.evaluateCondition(child));
            }
        }
        return operator === "or" ? this.or(operands) : this.and(operands);
    }

    private evaluateCustom(name: string): TriState {
        // Media Queries 5 §10: a custom media query is evaluated logically; one in a definition loop is not defined.
        const definition: MediaQueryList | boolean | undefined = this.customMedia.get(name);
        if (definition === undefined || this.evaluating.has(name)) {
            return "unknown";
        }
        if (typeof definition === "boolean") {
            return definition ? "true" : "false";
        }
        this.evaluating.add(name);
        const result: TriState = this.evaluate(definition);
        const cyclic: boolean = this.cyclic(name, new Set<string>());
        this.evaluating.delete(name);
        return cyclic ? "unknown" : result;
    }

    private cyclic(name: string, seen: Set<string>): boolean {
        if (seen.has(name)) {
            return true;
        }
        const definition: MediaQueryList | boolean | undefined = this.customMedia.get(name);
        if (definition === undefined || typeof definition === "boolean") {
            return false;
        }
        seen.add(name);
        let found: boolean = false;
        walk(definition, (node: CssNode) => {
            if (!found && node.type === "Feature" && node.name.startsWith("--") && node.value === null) {
                found = this.cyclic(node.name, new Set<string>(seen));
            }
        });
        return found;
    }

    private evaluateFeature(featureName: string, value: CssNode | null): TriState {
        if (featureName.startsWith("--")) {
            return value === null ? this.evaluateCustom(featureName) : "unknown";
        }
        const rawName: string = this.asciiCase.foldLower(featureName);
        const discrete: DiscreteFeature | undefined = this.discrete(rawName);
        if (discrete !== undefined) {
            // Media Queries 5 §2.4.2: in a boolean context a feature is false for none, 0 and the values it defines as false.
            if (value === null) {
                return discrete.current !== undefined && !FALSE_IN_BOOLEAN_CONTEXT.has(discrete.current) ? "true" : "false";
            }
            // Media Queries 5 §3.2: a value outside the syntax of the feature is unknown.
            const keyword: string | undefined = this.keywordOf(value);
            if (keyword === undefined || !discrete.values.includes(keyword)) {
                return "unknown";
            }
            return keyword === discrete.current ? "true" : "false";
        }
        // Media Queries 5 §2.4.4: only range features take the min- and max- prefixes, which stand for >= and <=.
        const comparison: string = rawName.startsWith("min-") ? ">=" : (rawName.startsWith("max-") ? "<=" : "=");
        const name: string = comparison === "=" ? rawName : rawName.substring(4);
        const type: RangeType | undefined = RANGE_FEATURES[name];
        if (type === undefined) {
            return "unknown";
        }
        const actual: number = this.featureValue(name);
        if (value === null) {
            return comparison !== "=" ? "unknown" : (actual !== 0 ? "true" : "false");
        }
        const requested: number | undefined = this.requestedValue(type, value);
        if (requested === undefined) {
            return "unknown";
        }
        return this.compare(actual, comparison, requested) ? "true" : "false";
    }

    private discrete(name: string): DiscreteFeature | undefined {
        // Media Queries 5 §4.4: portrait when the height is greater than or equal to the width.
        if (name === "orientation") {
            return { values: ["portrait", "landscape"], current: this.page.height >= this.page.width ? "portrait" : "landscape" };
        }
        return DISCRETE_FEATURES[name];
    }

    private keywordOf(value: CssNode): string | undefined {
        // Media Queries 5 §5.3: an <mq-boolean> is the integer 0 or 1, and -0 is 0.
        if (value.type === "Identifier") {
            return this.asciiCase.foldLower(value.name);
        }
        return value.type === "Number" && CssValueParser.INTEGER.test(value.value) ? String(Number(value.value)) : undefined;
    }

    private evaluateRange(left: CssNode, leftComparison: string, middle: CssNode, rightComparison: string | null, right: CssNode | null): TriState {
        // Media Queries 5 §2.4.3: the name of a range feature is on one side of a comparison, or in the middle of two.
        const name: string | undefined = this.rangeName(left, middle, right);
        const type: RangeType | undefined = name === undefined ? undefined : RANGE_FEATURES[name];
        if (name === undefined || type === undefined) {
            return "unknown";
        }
        const actual: number = this.featureValue(name);
        if (right === null) {
            const nameOnLeft: boolean = left.type === "Identifier";
            const requested: number | undefined = this.requestedValue(type, nameOnLeft ? middle : left);
            if (requested === undefined) {
                return "unknown";
            }
            return (nameOnLeft ? this.compare(actual, leftComparison, requested) : this.compare(requested, leftComparison, actual)) ? "true" : "false";
        }
        const low: number | undefined = this.requestedValue(type, left);
        const high: number | undefined = this.requestedValue(type, right);
        if (low === undefined || high === undefined || rightComparison === null) {
            return "unknown";
        }
        return this.compare(low, leftComparison, actual) && this.compare(actual, rightComparison, high) ? "true" : "false";
    }

    private rangeName(left: CssNode, middle: CssNode, right: CssNode | null): string | undefined {
        const candidate: CssNode = right === null ? (left.type === "Identifier" ? left : middle) : middle;
        return candidate.type === "Identifier" ? this.asciiCase.foldLower(candidate.name) : undefined;
    }

    private featureValue(name: string): number {
        // Media Queries 5 §4.1, §4.2 and Appendix A: for paged media the width and height are those of the page, in CSS pixels.
        switch (name) {
            case "width":
            case "device-width":
                return this.page.width;
            case "height":
            case "device-height":
                return this.page.height;
            case "aspect-ratio":
            case "device-aspect-ratio":
                return this.page.width / this.page.height;
            case "resolution":
                // Media Queries 5 §5.1: output without physical resolution limits, such as vector output, matches infinite.
                return Infinity;
            case "color":
                return 8;
            case "horizontal-viewport-segments":
            case "vertical-viewport-segments":
                return 1;
            default:
                return 0;
        }
    }

    private requestedValue(type: RangeType, node: CssNode): number | undefined {
        switch (type) {
            case "integer":
                return node.type === "Number" && CssValueParser.INTEGER.test(node.value) ? Number(node.value) : undefined;
            case "ratio":
                return this.ratio(node);
            case "resolution":
                if (node.type === "Identifier") {
                    return this.asciiCase.foldLower(node.name) === "infinite" ? Infinity : undefined;
                }
                return node.type === "Dimension" && this.units.baseTypeOf(this.asciiCase.foldLower(node.unit)) === "resolution"
                    ? this.units.toCanonical(Number(node.value), this.asciiCase.foldLower(node.unit)) : undefined;
            default:
                return this.length(node);
        }
    }

    private ratio(node: CssNode): number | undefined {
        // CSS Values 4 §5.7: <number [0,∞]> [ / <number [0,∞]> ]?, the second defaulting to 1, compared as their quotient.
        const left: CssNode = node.type === "Ratio" ? node.left : node;
        const right: CssNode | null = node.type === "Ratio" ? node.right : null;
        if (left.type !== "Number" || (right !== null && right.type !== "Number")) {
            return undefined;
        }
        const first: number = Number(left.value);
        const second: number = right === null ? 1 : Number(right.value);
        return first < 0 || second < 0 ? undefined : first / second;
    }

    private length(node: CssNode): number | undefined {
        if (node.type === "Number") {
            return Number(node.value) === 0 ? 0 : undefined;
        }
        if (node.type !== "Dimension") {
            return undefined;
        }
        const value: number = Number(node.value);
        const unit: string = this.asciiCase.foldLower(node.unit);
        // CSS Contain 3 §6: with no eligible container a container unit "use[s] the small viewport size", and a page has one.
        const viewport: RegExpExecArray | null = VIEWPORT_UNIT.exec(unit);
        if (viewport !== null) {
            return value * this.viewportSize(viewport[1]) / 100;
        }
        // Media Queries 5 §1.3: relative lengths use the initial values, and CSS Values 4 §6.1.1 takes them from the font's
        // metrics; ic is 1em since the default font has no U+6C34.
        const font: StandardFontData | undefined = STANDARD_FONTS.find((data: StandardFontData) => data.name === FontMatcher.DEFAULT_FAMILY);
        switch (unit) {
            case "cap":
            case "rcap":
                return value * (font?.capHeight ?? font?.ascender ?? 1000) / 1000 * INITIAL_FONT_SIZE_PX;
            case "lh":
            case "rlh":
                return value * ((font?.ascender ?? 1000) - (font?.descender ?? 0)) / 1000 * INITIAL_FONT_SIZE_PX;
            case "em":
            case "rem":
            case "ic":
            case "ric":
                return value * INITIAL_FONT_SIZE_PX;
            case "ex":
            case "rex":
                return value * (font?.xHeight ?? 500) / 1000 * INITIAL_FONT_SIZE_PX;
            case "ch":
            case "rch":
                return value * this.zeroAdvance(font) / 1000 * INITIAL_FONT_SIZE_PX;
            default:
                return this.units.baseTypeOf(unit) === "length" ? this.units.toCanonical(value, unit) : undefined;
        }
    }

    private zeroAdvance(font: StandardFontData | undefined): number {
        const zero: number = font === undefined ? -1 : font.codes.findIndex((codes: ReadonlyArray<number>) => codes.includes(DIGIT_ZERO));
        return font === undefined || zero < 0 ? 500 : font.widths[zero];
    }

    private viewportSize(axis: string): number {
        switch (axis) {
            case "w":
            case "i":
                return this.page.width;
            case "h":
            case "b":
                return this.page.height;
            case "min":
                return Math.min(this.page.width, this.page.height);
            default:
                return Math.max(this.page.width, this.page.height);
        }
    }

    private compare(a: number, comparison: string, b: number): boolean {
        switch (comparison) {
            case "<":
                return a < b;
            case "<=":
                return a <= b || this.equal(a, b);
            case ">":
                return a > b;
            case ">=":
                return a >= b || this.equal(a, b);
            default:
                return this.equal(a, b);
        }
    }

    private equal(a: number, b: number): boolean {
        return a === b || Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    }

    private baseName(name: string): string {
        const lower: string = this.asciiCase.foldLower(name);
        return lower.startsWith("min-") || lower.startsWith("max-") ? lower.substring(4) : lower;
    }

    private and(results: ReadonlyArray<TriState>): TriState {
        if (results.includes("false")) {
            return "false";
        }
        return results.includes("unknown") ? "unknown" : "true";
    }

    private or(results: ReadonlyArray<TriState>): TriState {
        if (results.includes("true")) {
            return "true";
        }
        return results.includes("unknown") ? "unknown" : "false";
    }

    private not(result: TriState): TriState {
        return result === "unknown" ? "unknown" : (result === "true" ? "false" : "true");
    }
}
