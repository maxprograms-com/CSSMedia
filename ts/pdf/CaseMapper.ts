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

import { COMBINING_CLASSES, CONDITIONAL_CASING } from "./generated/CaseMappings.js";

interface Conditional {
    lower: ReadonlyArray<number>;
    upper: ReadonlyArray<number>;
    contexts: ReadonlyArray<string>;
}

interface Active {
    entries: Map<number, Array<Conditional>>;
    pattern: RegExp;
}

const LANGUAGES: ReadonlySet<string> = new Set<string>(["lt", "tr", "az"]);
const CASED: RegExp = /^\p{Cased}$/u;
const CASE_IGNORABLE: RegExp = /^\p{Case_Ignorable}$/u;
const SOFT_DOTTED: RegExp = /^\p{Soft_Dotted}$/u;
const NEGATION: string = "Not_";
const LATIN_CAPITAL_I: number = 0x49;
const COMBINING_DOT_ABOVE: number = 0x307;
const ABOVE: number = 230;
const NOT_REORDERED: number = 0;

export class CaseMapper {

    private readonly active: Map<string, Active> = new Map<string, Active>();

    map(text: string, before: string, after: string, upper: boolean, locale?: string): string {
        const language: string = locale === undefined ? "" : locale.split("-")[0].toLowerCase();
        const known: Active = this.mappingsFor(language);
        known.pattern.lastIndex = 0;
        if (!known.pattern.test(text)) {
            return this.plain(text, upper, locale);
        }
        const whole: string = before + text + after;
        let result: string = "";
        let copied: number = 0;
        known.pattern.lastIndex = 0;
        for (let match: RegExpExecArray | null = known.pattern.exec(text); match !== null; match = known.pattern.exec(text)) {
            const character: string = match[0];
            const code: number = character.codePointAt(0) as number;
            const place: number = before.length + match.index;
            const entry: Conditional | undefined = (known.entries.get(code) as Array<Conditional>).find((candidate: Conditional) =>
                candidate.contexts.every((context: string) => this.holds(context, whole, place, place + character.length)));
            const mapped: string = entry === undefined ? this.plain(character, upper) : String.fromCodePoint(...(upper ? entry.upper : entry.lower));
            result += this.plain(text.substring(copied, match.index), upper, locale) + mapped;
            copied = match.index + character.length;
        }
        return result + this.plain(text.substring(copied), upper, locale);
    }

    private plain(text: string, upper: boolean, locale?: string): string {
        if (upper) {
            return locale === undefined ? text.toUpperCase() : text.toLocaleUpperCase(locale);
        }
        return locale === undefined ? text.toLowerCase() : text.toLocaleLowerCase(locale);
    }

    private mappingsFor(language: string): Active {
        let known: Active | undefined = this.active.get(language);
        if (known === undefined) {
            const entries: Map<number, Array<Conditional>> = new Map<number, Array<Conditional>>();
            for (const [code, lower, , upper, conditions] of CONDITIONAL_CASING) {
                const tags: ReadonlyArray<string> = conditions.filter((condition: string) => LANGUAGES.has(condition));
                if (tags.length > 0 && !tags.includes(language)) {
                    continue;
                }
                const list: Array<Conditional> | undefined = entries.get(code);
                const entry: Conditional = { lower, upper, contexts: conditions.filter((condition: string) => !LANGUAGES.has(condition)) };
                if (list === undefined) {
                    entries.set(code, [entry]);
                } else {
                    list.push(entry);
                }
            }
            const set: string = [...entries.keys()].map((code: number) => "\\u{" + code.toString(16) + "}").join("");
            known = { entries, pattern: new RegExp("[" + set + "]", "gu") };
            this.active.set(language, known);
        }
        return known;
    }

    private holds(context: string, whole: string, start: number, end: number): boolean {
        if (context.startsWith(NEGATION)) {
            return !this.holds(context.substring(NEGATION.length), whole, start, end);
        }
        switch (context) {
            case "Final_Sigma":
                return this.precededByCased(whole, start) && !this.followedByCased(whole, end);
            case "After_Soft_Dotted":
                return this.afterMatching(whole, start, (code: number) => SOFT_DOTTED.test(String.fromCodePoint(code)));
            case "After_I":
                return this.afterMatching(whole, start, (code: number) => code === LATIN_CAPITAL_I);
            case "More_Above":
                return this.beforeAbove(whole, end, false);
            case "Before_Dot":
                return this.beforeAbove(whole, end, true);
            default:
                throw new Error("Unknown case mapping context: " + context);
        }
    }

    private precededByCased(whole: string, start: number): boolean {
        for (let end: number = start; end > 0;) {
            const from: number = this.previous(whole, end);
            const character: string = whole.substring(from, end);
            if (!CASE_IGNORABLE.test(character)) {
                return CASED.test(character);
            }
            end = from;
        }
        return false;
    }

    private followedByCased(whole: string, end: number): boolean {
        for (let index: number = end; index < whole.length;) {
            const code: number = whole.codePointAt(index) as number;
            const character: string = String.fromCodePoint(code);
            if (!CASE_IGNORABLE.test(character)) {
                return CASED.test(character);
            }
            index += character.length;
        }
        return false;
    }

    private afterMatching(whole: string, start: number, wanted: (code: number) => boolean): boolean {
        for (let end: number = start; end > 0;) {
            const from: number = this.previous(whole, end);
            const code: number = whole.codePointAt(from) as number;
            if (wanted(code)) {
                return true;
            }
            const combining: number = this.combiningClass(code);
            if (combining === NOT_REORDERED || combining === ABOVE) {
                return false;
            }
            end = from;
        }
        return false;
    }

    private beforeAbove(whole: string, end: number, dot: boolean): boolean {
        for (let index: number = end; index < whole.length;) {
            const code: number = whole.codePointAt(index) as number;
            if (dot && code === COMBINING_DOT_ABOVE) {
                return true;
            }
            const combining: number = this.combiningClass(code);
            if (combining === ABOVE) {
                return !dot;
            }
            if (combining === NOT_REORDERED) {
                return false;
            }
            index += code > 0xFFFF ? 2 : 1;
        }
        return false;
    }

    private previous(text: string, end: number): number {
        const low: number = text.charCodeAt(end - 1);
        if (end > 1 && low >= 0xDC00 && low <= 0xDFFF) {
            const high: number = text.charCodeAt(end - 2);
            return high >= 0xD800 && high <= 0xDBFF ? end - 2 : end - 1;
        }
        return end - 1;
    }

    private combiningClass(code: number): number {
        let low: number = 0;
        let high: number = COMBINING_CLASSES.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const range: readonly [number, number, number] = COMBINING_CLASSES[middle];
            if (code < range[0]) {
                high = middle - 1;
            } else if (code > range[1]) {
                low = middle + 1;
            } else {
                return range[2];
            }
        }
        return NOT_REORDERED;
    }
}
