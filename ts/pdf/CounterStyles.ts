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

import { AsciiCase } from "../css/AsciiCase.js";
import type { CounterStyleRule } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import { PREDEFINED_COUNTER_STYLES } from "./generated/PredefinedCounterStyles.js";

type CounterSystem = "cyclic" | "fixed" | "symbolic" | "alphabetic" | "numeric" | "additive" | "chinese" | "ethiopic";

type Range = readonly [number, number];

interface ChineseNumerals {
    digits: ReadonlyArray<string>;
    markers: readonly [string, string, string];
    informal: boolean;
}

export type CounterSymbol = string | CssValue;

interface CounterStyle {
    system: CounterSystem;
    firstSymbol: number;
    symbols?: ReadonlyArray<CounterSymbol>;
    additive?: ReadonlyArray<readonly [number, CounterSymbol]>;
    negative: readonly [CounterSymbol, CounterSymbol];
    prefix: CounterSymbol;
    suffix: CounterSymbol;
    ranges: ReadonlyArray<Range>;
    pad: readonly [number, CounterSymbol];
    fallback: string;
    chinese?: ChineseNumerals;
}

interface StyleSource {
    descriptors: Readonly<Record<string, CssValue>>;
    userAgent: boolean;
    layer: number;
    order: number;
}

const DECIMAL: string = "decimal";
const NEGATIVE_SIGN_SYSTEMS: ReadonlySet<CounterSystem> = new Set<CounterSystem>(["symbolic", "alphabetic", "numeric", "additive", "chinese", "ethiopic"]);
const SYSTEMS: ReadonlySet<string> = new Set<string>(["cyclic", "fixed", "symbolic", "alphabetic", "numeric", "additive"]);
const MAXIMUM_LENGTH: number = 60;
const CJK_RANGE: Range = [-9999, 9999];
const CJK_FALLBACK: string = "cjk-decimal";
const CJK_SUFFIX: string = "、";
const OPEN_DISCLOSURE: string = "▾";
const CLOSED_DISCLOSURE: string = "▸";
const CLOSED_DISCLOSURE_RIGHT_TO_LEFT: string = "◂";
const SIMPLIFIED_NEGATIVE: string = "负";
const TRADITIONAL_NEGATIVE: string = "負";
const INFORMAL_DIGITS: ReadonlyArray<string> = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const INFORMAL_MARKERS: readonly [string, string, string] = ["十", "百", "千"];
const FORMAL_MARKERS: readonly [string, string, string] = ["拾", "佰", "仟"];
const CHINESE_STYLES: ReadonlyMap<string, readonly [ChineseNumerals, string]> = new Map<string, readonly [ChineseNumerals, string]>([
    ["simp-chinese-informal", [{ digits: INFORMAL_DIGITS, markers: INFORMAL_MARKERS, informal: true }, SIMPLIFIED_NEGATIVE]],
    ["simp-chinese-formal", [{ digits: ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"], markers: FORMAL_MARKERS, informal: false }, SIMPLIFIED_NEGATIVE]],
    ["trad-chinese-informal", [{ digits: INFORMAL_DIGITS, markers: INFORMAL_MARKERS, informal: true }, TRADITIONAL_NEGATIVE]],
    ["trad-chinese-formal", [{ digits: ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"], markers: FORMAL_MARKERS, informal: false }, TRADITIONAL_NEGATIVE]],
    ["cjk-ideographic", [{ digits: INFORMAL_DIGITS, markers: INFORMAL_MARKERS, informal: true }, TRADITIONAL_NEGATIVE]]
]);

export class CounterStyles {

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly sources: Map<string, StyleSource> = new Map<string, StyleSource>();
    private readonly predefined: ReadonlySet<string>;
    private readonly resolved: Map<string, CounterStyle | null> = new Map<string, CounterStyle | null>();

    constructor(rules: ReadonlyArray<CounterStyleRule>) {
        // CSS Counter Styles 3 §3: the predefined styles are user-agent rules, so any author rule of the same name wins; among
        // author rules the standard cascade decides, by layer and then by order.
        for (const [name, descriptors] of PREDEFINED_COUNTER_STYLES) {
            this.sources.set(name, { descriptors, userAgent: true, layer: 0, order: 0 });
        }
        this.predefined = new Set<string>([...this.sources.keys(), ...CHINESE_STYLES.keys(), "ethiopic-numeric", "disclosure-open", "disclosure-closed"]);
        for (const rule of rules) {
            // CSS Counter Styles 3 §3: a name this specification defines is ASCII lowercased in the @counter-style rule too.
            const name: string = this.canonicalName(rule.name);
            const current: StyleSource | undefined = this.sources.get(name);
            if (current === undefined || current.userAgent || rule.layer > current.layer || (rule.layer === current.layer && rule.order > current.order)) {
                this.sources.set(name, { descriptors: rule.descriptors, userAgent: false, layer: rule.layer, order: rule.order });
            }
        }
    }

    representation(value: number, rightToLeft: boolean, style?: CssValue): Array<CounterSymbol> {
        // CSS Lists 3 §4.7: counter() and counters() show the representation alone, without prefix and suffix.
        return this.joined(this.generate(this.styleOf(rightToLeft, style), value, new Set<CounterStyle>(), rightToLeft));
    }

    marker(value: number, rightToLeft: boolean, style?: CssValue): Array<CounterSymbol> {
        // CSS Lists 3 §3.4: the prefix and suffix always come from the specified style, even when a fallback builds the representation.
        const counterStyle: CounterStyle = this.styleOf(rightToLeft, style);
        return this.joined([counterStyle.prefix, ...this.generate(counterStyle, value, new Set<CounterStyle>(), rightToLeft), counterStyle.suffix]);
    }

    private joined(symbols: ReadonlyArray<CounterSymbol>): Array<CounterSymbol> {
        // CSS Counter Styles 3 §3.8: "Counter symbols may be strings, images, or identifiers"; the text between two images is
        // one string.
        const result: Array<CounterSymbol> = [];
        for (const symbol of symbols) {
            const last: CounterSymbol | undefined = result[result.length - 1];
            if (typeof symbol !== "string") {
                result.push(symbol);
            } else if (typeof last === "string") {
                result[result.length - 1] = last + symbol;
            } else if (symbol.length > 0) {
                result.push(symbol);
            }
        }
        return result;
    }

    private styleOf(rightToLeft: boolean, value?: CssValue): CounterStyle {
        if (value !== undefined && value.kind === "function" && value.name === "symbols") {
            return this.anonymous(value.args) ?? this.named(DECIMAL, rightToLeft) as CounterStyle;
        }
        const name: string = value !== undefined && value.kind === "ident" ? value.name : DECIMAL;
        // CSS Counter Styles 3 §2 step 1: an unknown style is decimal.
        return this.named(name, rightToLeft) ?? this.named(DECIMAL, rightToLeft) as CounterStyle;
    }

    private named(name: string, rightToLeft: boolean): CounterStyle | undefined {
        // CSS Counter Styles 3 §3: the names this specification defines are ASCII lowercased wherever they are used as counter styles.
        const lower: string = this.asciiCase.foldLower(name);
        const key: string = this.predefined.has(lower) ? lower : name;
        if (key === "disclosure-closed" && rightToLeft) {
            return this.disclosure(key, CLOSED_DISCLOSURE_RIGHT_TO_LEFT);
        }
        return this.resolve(key, new Set<string>());
    }

    private resolve(name: string, extending: Set<string>): CounterStyle | undefined {
        const cached: CounterStyle | null | undefined = this.resolved.get(name);
        if (cached !== undefined) {
            return cached ?? undefined;
        }
        const source: StyleSource | undefined = this.sources.get(name);
        let style: CounterStyle | undefined;
        if (source !== undefined && (source.userAgent === false || !this.isComplex(name))) {
            style = this.define(name, source.descriptors, extending);
        } else {
            style = this.complex(name);
        }
        if (extending.size === 0) {
            this.resolved.set(name, style ?? null);
        }
        return style;
    }

    private isComplex(name: string): boolean {
        return CHINESE_STYLES.has(name) || name === "ethiopic-numeric" || name === "disclosure-open" || name === "disclosure-closed";
    }

    private complex(name: string): CounterStyle | undefined {
        // CSS Counter Styles 3 §6.3 and §7: styles whose symbols or algorithm the specification gives in prose.
        const chinese: readonly [ChineseNumerals, string] | undefined = CHINESE_STYLES.get(name);
        if (chinese !== undefined) {
            return {
                system: "chinese", firstSymbol: 1, negative: [chinese[1], ""], prefix: "", suffix: CJK_SUFFIX,
                ranges: [CJK_RANGE], pad: [0, ""], fallback: CJK_FALLBACK, chinese: chinese[0]
            };
        }
        if (name === "ethiopic-numeric") {
            return {
                system: "ethiopic", firstSymbol: 1, negative: ["-", ""], prefix: "", suffix: "/ ",
                ranges: [[1, Number.POSITIVE_INFINITY]], pad: [0, ""], fallback: DECIMAL
            };
        }
        if (name === "disclosure-open" || name === "disclosure-closed") {
            return this.disclosure(name, name === "disclosure-open" ? OPEN_DISCLOSURE : CLOSED_DISCLOSURE);
        }
        return undefined;
    }

    private disclosure(name: string, symbol: string): CounterStyle {
        // CSS Counter Styles 3 §6.3: a symbol suited to an open or closed disclosure widget; a directional one follows the writing mode.
        const base: CounterStyle | undefined = this.sources.has(name) && this.sources.get(name)?.userAgent === false ? this.resolve(name, new Set<string>()) : undefined;
        return base ?? {
            system: "cyclic", firstSymbol: 1, symbols: [symbol], negative: ["-", ""], prefix: "", suffix: " ",
            ranges: [[Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]], pad: [0, ""], fallback: DECIMAL
        };
    }

    private define(name: string, descriptors: Readonly<Record<string, CssValue>>, extending: Set<string>): CounterStyle | undefined {
        const system: Array<CssValue> = this.items(descriptors["system"]);
        const systemName: string = system.length > 0 && system[0].kind === "ident" ? system[0].lower : "symbolic";
        let style: CounterStyle;
        if (systemName === "extends") {
            // §3.1.7: unspecified descriptors come from the extended style; an unknown style or a cycle extends decimal.
            if (descriptors["symbols"] !== undefined || descriptors["additive-symbols"] !== undefined) {
                return undefined;
            }
            const baseName: string = system[1] !== undefined && system[1].kind === "ident" ? this.canonicalName(system[1].name) : DECIMAL;
            extending.add(name);
            const base: CounterStyle | undefined = extending.has(baseName) ? undefined : this.resolve(baseName, extending);
            extending.delete(name);
            style = { ...(base ?? this.resolve(DECIMAL, new Set<string>()) as CounterStyle) };
        } else {
            if (!SYSTEMS.has(systemName)) {
                return undefined;
            }
            const first: CssValue | undefined = system[1];
            // §3.1 and §3.8: without enough symbols for its system, the rule defines no counter style.
            const symbols: Array<CounterSymbol> | undefined = this.symbols(descriptors["symbols"]);
            const additive: Array<readonly [number, CounterSymbol]> | undefined = this.additiveSymbols(descriptors["additive-symbols"]);
            const minimum: number = systemName === "alphabetic" || systemName === "numeric" ? 2 : 1;
            if (systemName === "additive" ? (additive === undefined || additive.length === 0) : (symbols === undefined || symbols.length < minimum)) {
                return undefined;
            }
            style = {
                system: systemName as CounterSystem,
                firstSymbol: systemName === "fixed" && first !== undefined && first.kind === "number" ? first.value : 1,
                negative: ["-", ""], prefix: "", suffix: ". ", ranges: this.autoRange(systemName as CounterSystem), pad: [0, ""], fallback: DECIMAL
            };
            if (symbols !== undefined) {
                style.symbols = symbols;
            }
            if (additive !== undefined) {
                style.additive = additive;
            }
        }
        return this.withDescriptors(style, descriptors);
    }

    private withDescriptors(style: CounterStyle, descriptors: Readonly<Record<string, CssValue>>): CounterStyle {
        const result: CounterStyle = { ...style };
        const negative: Array<CounterSymbol> | undefined = this.symbols(descriptors["negative"]);
        if (negative !== undefined && negative.length >= 1 && negative.length <= 2) {
            result.negative = [negative[0], negative[1] ?? ""];
        }
        const prefix: Array<CounterSymbol> | undefined = this.symbols(descriptors["prefix"]);
        if (prefix !== undefined && prefix.length === 1) {
            result.prefix = prefix[0];
        }
        const suffix: Array<CounterSymbol> | undefined = this.symbols(descriptors["suffix"]);
        if (suffix !== undefined && suffix.length === 1) {
            result.suffix = suffix[0];
        }
        const ranges: Array<Range> | undefined = this.ranges(descriptors["range"]);
        if (ranges !== undefined) {
            result.ranges = ranges;
        }
        const pad: readonly [number, CounterSymbol] | undefined = this.pad(descriptors["pad"]);
        if (pad !== undefined) {
            result.pad = pad;
        }
        const fallback: CssValue | undefined = descriptors["fallback"];
        if (fallback !== undefined && fallback.kind === "ident") {
            result.fallback = this.canonicalName(fallback.name);
        }
        return result;
    }

    private canonicalName(name: string): string {
        const lower: string = this.asciiCase.foldLower(name);
        return this.predefined.has(lower) ? lower : name;
    }

    private autoRange(system: CounterSystem): Array<Range> {
        // §3.5: cyclic, numeric and fixed cover every value, alphabetic and symbolic start at 1, additive at 0.
        switch (system) {
            case "alphabetic":
            case "symbolic":
                return [[1, Number.POSITIVE_INFINITY]];
            case "additive":
                return [[0, Number.POSITIVE_INFINITY]];
            default:
                return [[Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]];
        }
    }

    private anonymous(args: ReadonlyArray<CssValue>): CounterStyle | undefined {
        // §4: symbols() has no prefix, a suffix of one space, range auto, fallback decimal and the default negative sign.
        const items: Array<CssValue> = args.flatMap((argument: CssValue) => this.items(argument));
        const first: CssValue | undefined = items[0];
        const typed: boolean = first !== undefined && first.kind === "ident";
        const system: string = typed ? (first as { lower: string }).lower : "symbolic";
        if (!SYSTEMS.has(system) || system === "additive") {
            return undefined;
        }
        const symbols: Array<CounterSymbol> = [];
        for (const item of items.slice(typed ? 1 : 0)) {
            const symbol: CounterSymbol | undefined = item.kind === "ident" ? undefined : this.symbol(item);
            if (symbol === undefined) {
                return undefined;
            }
            symbols.push(symbol);
        }
        if (symbols.length < ((system === "alphabetic" || system === "numeric") ? 2 : 1)) {
            return undefined;
        }
        return {
            system: system as CounterSystem, firstSymbol: 1, symbols, negative: ["-", ""], prefix: "", suffix: " ",
            ranges: this.autoRange(system as CounterSystem), pad: [0, ""], fallback: DECIMAL
        };
    }

    private items(value?: CssValue): Array<CssValue> {
        if (value === undefined) {
            return [];
        }
        return value.kind === "list" && value.separator === "space" ? [...value.items] : [value];
    }

    private symbol(value: CssValue): CounterSymbol | undefined {
        // §3.8: a symbol is a string, an identifier shown as its characters, or an image, which is "rendered as inline
        // replaced elements".
        if (value.kind === "string") {
            return value.value;
        }
        if (value.kind === "ident") {
            return value.name;
        }
        return value.kind === "url" || value.kind === "function" ? value : undefined;
    }

    private symbols(value?: CssValue): Array<CounterSymbol> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const symbols: Array<CounterSymbol> = [];
        for (const item of this.items(value)) {
            const symbol: CounterSymbol | undefined = this.symbol(item);
            if (symbol === undefined) {
                return undefined;
            }
            symbols.push(symbol);
        }
        return symbols;
    }

    private additiveSymbols(value?: CssValue): Array<readonly [number, CounterSymbol]> | undefined {
        // §3.8: each weight is a non-negative integer, in strictly descending order, or the declaration is invalid.
        if (value === undefined) {
            return undefined;
        }
        const tuples: Array<readonly [number, CounterSymbol]> = [];
        const entries: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "comma" ? value.items : [value];
        for (const entry of entries) {
            const parts: Array<CssValue> = this.items(entry);
            const weight: CssValue | undefined = parts.find((part: CssValue) => part.kind === "number");
            const other: CssValue | undefined = parts.find((part: CssValue) => part.kind !== "number");
            const symbol: CounterSymbol | undefined = other === undefined ? undefined : this.symbol(other);
            if (parts.length !== 2 || weight === undefined || weight.kind !== "number" || !weight.integer || weight.value < 0 || symbol === undefined) {
                return undefined;
            }
            if (tuples.length > 0 && weight.value >= tuples[tuples.length - 1][0]) {
                return undefined;
            }
            tuples.push([weight.value, symbol]);
        }
        return tuples;
    }

    private ranges(value?: CssValue): Array<Range> | undefined {
        // §3.5: auto, or pairs of an integer or infinite; a pair whose lower bound is above its upper one voids the descriptor.
        if (value === undefined || (value.kind === "ident" && value.lower === "auto")) {
            return undefined;
        }
        const ranges: Array<Range> = [];
        const entries: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "comma" ? value.items : [value];
        for (const entry of entries) {
            const bounds: Array<CssValue> = this.items(entry);
            if (bounds.length !== 2) {
                return undefined;
            }
            const lower: number = bounds[0].kind === "number" ? bounds[0].value : Number.NEGATIVE_INFINITY;
            const upper: number = bounds[1].kind === "number" ? bounds[1].value : Number.POSITIVE_INFINITY;
            if (lower > upper) {
                return undefined;
            }
            ranges.push([lower, upper]);
        }
        return ranges;
    }

    private pad(value?: CssValue): readonly [number, CounterSymbol] | undefined {
        // §3.6: <integer [0,∞]> && <symbol>.
        const parts: Array<CssValue> = this.items(value);
        const length: CssValue | undefined = parts.find((part: CssValue) => part.kind === "number");
        const other: CssValue | undefined = parts.find((part: CssValue) => part.kind !== "number");
        const symbol: CounterSymbol | undefined = other === undefined ? undefined : this.symbol(other);
        if (parts.length !== 2 || length === undefined || length.kind !== "number" || length.value < 0 || symbol === undefined) {
            return undefined;
        }
        return [length.value, symbol];
    }

    private generate(style: CounterStyle, value: number, fallbacks: Set<CounterStyle>, rightToLeft: boolean): Array<CounterSymbol> {
        // CSS Counter Styles 3 §2: range, initial representation, padding and negative sign; the fallback style takes what the
        // style cannot represent, and a loop of fallbacks ends in decimal.
        if (!style.ranges.some((range: Range) => range[0] <= value && value <= range[1])) {
            return this.fallback(style, value, fallbacks, rightToLeft);
        }
        const negative: boolean = value < 0 && NEGATIVE_SIGN_SYSTEMS.has(style.system);
        const initial: Array<CounterSymbol> | undefined = this.initial(style, negative ? -value : value);
        if (initial === undefined) {
            return this.fallback(style, value, fallbacks, rightToLeft);
        }
        let difference: number = style.pad[0] - this.graphemeCount(initial);
        if (negative) {
            difference -= this.graphemeCount(style.negative);
        }
        const padding: Array<CounterSymbol> | undefined = difference > 0 ? this.repeated(style.pad[1], difference) : undefined;
        if (difference > 0 && padding === undefined) {
            return this.fallback(style, value, fallbacks, rightToLeft);
        }
        const padded: Array<CounterSymbol> = padding !== undefined && padding.length > 0 ? [...padding, ...initial] : initial;
        const representation: Array<CounterSymbol> = negative ? [style.negative[0], ...padded, style.negative[1]] : padded;
        // §2: a representation longer than 60 code points may use the fallback style instead; an image counts as one.
        let length: number = 0;
        for (const symbol of representation) {
            length += this.codePoints(symbol);
        }
        return length > MAXIMUM_LENGTH ? this.fallback(style, value, fallbacks, rightToLeft) : representation;
    }

    private codePoints(symbol: CounterSymbol): number {
        return typeof symbol === "string" ? [...symbol].length : 1;
    }

    private fallback(style: CounterStyle, value: number, fallbacks: Set<CounterStyle>, rightToLeft: boolean): Array<CounterSymbol> {
        fallbacks.add(style);
        const next: CounterStyle = this.named(style.fallback, rightToLeft) ?? this.named(DECIMAL, rightToLeft) as CounterStyle;
        const decimal: CounterStyle = this.named(DECIMAL, rightToLeft) as CounterStyle;
        if (fallbacks.has(next)) {
            return next === decimal || fallbacks.has(decimal) ? [String(value)] : this.generate(decimal, value, fallbacks, rightToLeft);
        }
        return this.generate(next, value, fallbacks, rightToLeft);
    }

    private graphemeCount(symbols: ReadonlyArray<CounterSymbol>): number {
        // §3.6 counts the grapheme clusters of the representation; an image stands for one.
        let count: number = 0;
        for (const symbol of symbols) {
            if (typeof symbol !== "string") {
                count++;
                continue;
            }
            for (const segment of this.graphemes.segment(symbol)) {
                count += segment.segment.length > 0 ? 1 : 0;
            }
        }
        return count;
    }

    private repeated(symbol: CounterSymbol, times: number): Array<CounterSymbol> | undefined {
        // §2: these repetitions have a "size linear to an author-supplied number", so the limit is tested before building
        // them; nothing stands for a repetition over the limit, and an empty symbol adds nothing however often it repeats.
        const size: number = this.codePoints(symbol);
        if (size === 0) {
            return [];
        }
        return times * size > MAXIMUM_LENGTH ? undefined : new Array<CounterSymbol>(times).fill(symbol);
    }

    private initial(style: CounterStyle, value: number): Array<CounterSymbol> | undefined {
        if (style.system === "additive") {
            return style.additive === undefined ? undefined : this.additive(value, style.additive);
        }
        if (style.system === "chinese") {
            return [this.chinese(value, style.chinese as ChineseNumerals)];
        }
        if (style.system === "ethiopic") {
            return [this.ethiopic(value)];
        }
        const symbols: ReadonlyArray<CounterSymbol> | undefined = style.symbols;
        if (symbols === undefined) {
            return undefined;
        }
        const count: number = symbols.length;
        switch (style.system) {
            case "cyclic":
                // §3.1.1: the symbol at (value - 1) mod N.
                return [symbols[(((value - 1) % count) + count) % count]];
            case "fixed": {
                // §3.1.2: one pass through the symbols from the first symbol value.
                const index: number = value - style.firstSymbol;
                return index >= 0 && index < count ? [symbols[index]] : undefined;
            }
            case "symbolic":
                // §3.1.3: the symbol at (value - 1) mod N, repeated ceil(value / N) times; "This system is defined only over
                // strictly positive counter values", so a range that lets zero in sends it to the fallback style.
                return value < 1 ? undefined : this.repeated(symbols[(value - 1) % count], Math.ceil(value / count));
            case "alphabetic":
                // §3.1.4 has the same limit.
                return value < 1 ? undefined : this.alphabetic(value, symbols);
            case "numeric":
                return this.numeric(value, symbols);
        }
    }

    private alphabetic(value: number, symbols: ReadonlyArray<CounterSymbol>): Array<CounterSymbol> {
        // §3.1.4: bijective base N.
        let remaining: number = value;
        const result: Array<CounterSymbol> = [];
        while (remaining !== 0) {
            remaining--;
            result.unshift(symbols[remaining % symbols.length]);
            remaining = Math.floor(remaining / symbols.length);
        }
        return result;
    }

    private numeric(value: number, symbols: ReadonlyArray<CounterSymbol>): Array<CounterSymbol> {
        // §3.1.5: base N with the first symbol as zero.
        if (value === 0) {
            return [symbols[0]];
        }
        let remaining: number = value;
        const result: Array<CounterSymbol> = [];
        while (remaining !== 0) {
            result.unshift(symbols[remaining % symbols.length]);
            remaining = Math.floor(remaining / symbols.length);
        }
        return result;
    }

    private additive(value: number, tuples: ReadonlyArray<readonly [number, CounterSymbol]>): Array<CounterSymbol> | undefined {
        // §3.1.6: the tuples from the heaviest; zero needs a tuple of weight zero, and a remainder falls back.
        if (value === 0) {
            const zero: readonly [number, CounterSymbol] | undefined = tuples.find((tuple: readonly [number, CounterSymbol]) => tuple[0] === 0);
            return zero === undefined ? undefined : [zero[1]];
        }
        let remaining: number = value;
        const result: Array<CounterSymbol> = [];
        for (const [weight, symbol] of tuples) {
            if (weight === 0 || weight > remaining) {
                continue;
            }
            const repetitions: number = Math.floor(remaining / weight);
            const copies: Array<CounterSymbol> | undefined = this.repeated(symbol, repetitions);
            if (copies === undefined) {
                return undefined;
            }
            result.push(...copies);
            remaining -= weight * repetitions;
            if (remaining === 0) {
                return result;
            }
        }
        return undefined;
    }

    private chinese(value: number, numerals: ChineseNumerals): string {
        // §7.1.3: zero is the zero digit; otherwise each non-zero digit takes its marker, the informal styles drop the tens digit
        // from ten to nineteen, trailing zeros go and other runs of zeros collapse into one.
        if (value === 0) {
            return numerals.digits[0];
        }
        const decimal: string = String(value);
        const parts: Array<string> = [];
        for (let position: number = 0; position < decimal.length; position++) {
            const digit: number = Number(decimal[position]);
            const place: number = decimal.length - 1 - position;
            if (digit === 0) {
                parts.push("0");
            } else if (numerals.informal && value >= 10 && value <= 19 && place === 1) {
                parts.push(numerals.markers[0]);
            } else {
                parts.push(numerals.digits[digit] + (place === 0 ? "" : numerals.markers[place - 1]));
            }
        }
        while (parts.length > 0 && parts[parts.length - 1] === "0") {
            parts.pop();
        }
        let text: string = "";
        for (let index: number = 0; index < parts.length; index++) {
            if (parts[index] !== "0") {
                text += parts[index];
            } else if (parts[index - 1] !== "0") {
                text += numerals.digits[0];
            }
        }
        return text;
    }

    private ethiopic(value: number): string {
        // §7.2: groups of two digits from the least significant, with the markers for hundreds and ten thousands.
        if (value === 1) {
            return "፩";
        }
        const groups: Array<number> = [];
        for (let remaining: number = value; remaining > 0; remaining = Math.floor(remaining / 100)) {
            groups.push(remaining % 100);
        }
        let text: string = "";
        for (let index: number = groups.length - 1; index >= 0; index--) {
            const group: number = groups[index];
            const removed: boolean = group === 0 || (index === groups.length - 1 && group === 1) || (index % 2 === 1 && group === 1);
            if (!removed) {
                const tens: number = Math.floor(group / 10);
                const units: number = group % 10;
                text += (tens > 0 ? String.fromCodePoint(0x1371 + tens) : "") + (units > 0 ? String.fromCodePoint(0x1368 + units) : "");
            }
            if (index % 2 === 1 && group !== 0) {
                text += "፻";
            } else if (index % 2 === 0 && index !== 0) {
                text += "፼";
            }
        }
        return text;
    }
}
