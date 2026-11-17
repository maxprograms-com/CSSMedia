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
import { LineBreaker } from "./LineBreaker.js";
import { VerticalOrientation } from "./VerticalOrientation.js";

type Values = Readonly<Record<string, CssValue>>;

export interface EmphasisStyle {
    shape: string;
    filled: boolean;
    text?: string;
}

interface Skipped {
    spaces: boolean;
    punctuation: boolean;
    symbols: boolean;
    narrow: boolean;
}

const SHAPES: ReadonlySet<string> = new Set<string>(["dot", "circle", "double-circle", "triangle", "sesame"]);
const CONTROLS: RegExp = /^[\p{Cc}\p{Cf}\p{Cn}]$/u;
const SEPARATOR: RegExp = /^\p{Z}$/u;
const PUNCTUATION: RegExp = /^\p{P}$/u;
const SYMBOL: RegExp = /^\p{S}$/u;
const SYMBOLIC_PUNCTUATION: ReadonlySet<number> = new Set<number>([0x23, 0x25, 0x2030, 0x2031, 0x66A, 0x609, 0x60A, 0x26, 0x204A, 0x40, 0xA7, 0xB6, 0x204B, 0x2053, 0x303D]);

export class EmphasisMarks {

    private readonly orientation: VerticalOrientation = new VerticalOrientation();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private breaker?: LineBreaker;

    style(values: Values): EmphasisStyle | undefined {
        // §3.1: with only filled or open the shape "computes to circle in horizontal typographic modes and sesame in vertical
        // typographic modes"; with a shape alone, filled is assumed.
        const value: CssValue | undefined = values["text-emphasis-style"];
        if (value === undefined) {
            return undefined;
        }
        if (value.kind === "string") {
            const first: string | undefined = this.graphemes.segment(value.value)[Symbol.iterator]().next().value?.segment;
            return first === undefined ? undefined : { shape: "string", filled: true, text: first };
        }
        const keywords: Array<string> = this.keywords(value);
        if (keywords.length === 0 || keywords.includes("none")) {
            return undefined;
        }
        const shape: string | undefined = keywords.find((keyword: string) => SHAPES.has(keyword));
        return { shape: shape ?? (this.isVertical(values) ? "sesame" : "circle"), filled: !keywords.includes("open") };
    }

    isVertical(values: Values): boolean {
        return this.orientation.typographicVertical(values);
    }

    isUnder(values: Values): boolean {
        // §3.4: over and under are for horizontal typographic modes and right and left for vertical ones; the right of a vertical
        // line is its over side and the left its under side.
        const keywords: Array<string> = this.keywords(values["text-emphasis-position"]);
        return this.isVertical(values) ? keywords.includes("left") : keywords.includes("under");
    }

    marked(codepoints: ReadonlyArray<number>, from: number, to: number, values: Values): boolean {
        // §3.1: "The marks are drawn once for each typographic character unit", not for the separators, the punctuation and the
        // control and unassigned characters, which the skip property refines.
        const skip: Skipped = this.skipped(values);
        let text: string = "";
        for (let position: number = from; position < to; position++) {
            text += String.fromCodePoint(codepoints[position]);
        }
        for (const cluster of this.graphemes.segment(text)) {
            if (this.isMarked(cluster.segment, skip)) {
                return true;
            }
        }
        return false;
    }

    unit(cluster: string, values: Values): boolean {
        return this.isMarked(cluster, this.skipped(values));
    }

    private isMarked(cluster: string, skip: Skipped): boolean {
        const code: number = cluster.codePointAt(0) as number;
        const character: string = String.fromCodePoint(code);
        if (CONTROLS.test(character)) {
            return false;
        }
        // "emphasis marks are drawn for a space that combines with any combining characters".
        if (skip.spaces && SEPARATOR.test(character) && cluster.length === character.length) {
            return false;
        }
        const punctuation: boolean = PUNCTUATION.test(character);
        const symbolic: boolean = SYMBOL.test(character) || (punctuation && SYMBOLIC_PUNCTUATION.has(character.normalize("NFKD").codePointAt(0) as number));
        if (skip.symbols && symbolic) {
            return false;
        }
        if (skip.punctuation && punctuation && !symbolic) {
            return false;
        }
        this.breaker = this.breaker ?? new LineBreaker();
        return !(skip.narrow && !this.breaker.isWideOrFullwidth(code));
    }

    private skipped(values: Values): Skipped {
        // §3.5: the initial value is spaces punctuation.
        const value: CssValue | undefined = values["text-emphasis-skip"];
        const keywords: Array<string> = value === undefined ? ["spaces", "punctuation"] : this.keywords(value);
        return {
            spaces: keywords.includes("spaces"), punctuation: keywords.includes("punctuation"), symbols: keywords.includes("symbols"), narrow: keywords.includes("narrow")
        };
    }

    private keywords(value?: CssValue): Array<string> {
        if (value === undefined) {
            return [];
        }
        return (value.kind === "list" ? value.items : [value]).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }
}
