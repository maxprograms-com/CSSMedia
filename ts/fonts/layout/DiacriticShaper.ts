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

import type { FontInstance } from "../Typeface.js";
import type { ShapeRequest } from "./FeatureShaper.js";
import { FeatureShaper } from "./FeatureShaper.js";
import type { GlyphInfo } from "./GlyphInfo.js";

type MarkClass = readonly [number, number, number];

const ARABIC: ReadonlyArray<MarkClass> = [
    [0x064B, 0x064C, 1], [0x064E, 0x064F, 1], [0x0652, 0x0652, 1], [0x0657, 0x0658, 1], [0x06E1, 0x06E1, 1], [0x064D, 0x064D, 2], [0x0650, 0x0650, 2],
    [0x0656, 0x0656, 2], [0x0651, 0x0651, 3], [0x0610, 0x0614, 4], [0x0659, 0x0659, 4], [0x06D6, 0x06DC, 4], [0x06DF, 0x06E0, 4], [0x06E2, 0x06E2, 4],
    [0x06E4, 0x06E4, 4], [0x06E7, 0x06E8, 4], [0x06EB, 0x06EC, 4], [0x06E3, 0x06E3, 5], [0x06EA, 0x06EA, 5], [0x06ED, 0x06ED, 5], [0x0670, 0x0670, 6],
    [0x0653, 0x0653, 7], [0x0654, 0x0655, 8]
];
const SYRIAC: ReadonlyArray<MarkClass> = [
    [0x0730, 0x0730, 1], [0x0733, 0x0733, 1], [0x0736, 0x0736, 1], [0x073A, 0x073A, 1], [0x073D, 0x073D, 1], [0x0731, 0x0731, 2], [0x0734, 0x0734, 2],
    [0x0737, 0x0737, 2], [0x073B, 0x073B, 2], [0x073E, 0x073E, 2], [0x0740, 0x0740, 3], [0x0749, 0x074A, 3], [0x0732, 0x0732, 4], [0x0735, 0x0735, 4],
    [0x073F, 0x073F, 4], [0x0738, 0x0739, 5], [0x073C, 0x073C, 5], [0x0741, 0x0741, 6], [0x030A, 0x030A, 6], [0x0742, 0x0742, 7], [0x0325, 0x0325, 7],
    [0x0747, 0x0747, 8], [0x0303, 0x0304, 8], [0x0748, 0x0748, 9], [0x032D, 0x032E, 9], [0x0330, 0x0331, 9], [0x0308, 0x0308, 10], [0x0307, 0x0307, 12],
    [0x0323, 0x0323, 13]
];
const HEBREW: ReadonlyArray<MarkClass> = [
    [0x05B0, 0x05B6, 1], [0x05BB, 0x05BB, 1], [0x0599, 0x0599, 2], [0x05A1, 0x05A1, 2], [0x05A9, 0x05A9, 2], [0x05AE, 0x05AE, 2], [0x0597, 0x0597, 3],
    [0x05A8, 0x05A8, 3], [0x05AC, 0x05AC, 3], [0x0592, 0x0595, 4], [0x05A7, 0x05A7, 4], [0x05AB, 0x05AB, 4], [0x0598, 0x0598, 5], [0x059C, 0x059C, 5],
    [0x059E, 0x059F, 5], [0x059D, 0x059D, 6], [0x05A0, 0x05A0, 6], [0x059B, 0x059B, 7], [0x05A5, 0x05A5, 7], [0x0591, 0x0591, 8], [0x05A3, 0x05A3, 8],
    [0x05A6, 0x05A6, 8], [0x0596, 0x0596, 9], [0x05A4, 0x05A4, 9], [0x05AA, 0x05AA, 9], [0x059A, 0x059A, 10], [0x05AD, 0x05AD, 10], [0x05AF, 0x05AF, 11],
    [0x05BC, 0x05BC, 12], [0x05C4, 0x05C4, 13], [0x05B9, 0x05B9, 14], [0x05BD, 0x05BD, 15], [0x05B7, 0x05B7, 16], [0x05B8, 0x05B8, 17], [0x05BF, 0x05BF, 18],
    [0x05C1, 0x05C2, 19]
];
const THAI: ReadonlyArray<MarkClass> = [
    [0x0E31, 0x0E31, 1], [0x0E34, 0x0E37, 1], [0x0E47, 0x0E47, 2], [0x0E4D, 0x0E4D, 2], [0x0E48, 0x0E4B, 3], [0x0E4C, 0x0E4C, 4], [0x0E4E, 0x0E4E, 4],
    [0x0E38, 0x0E39, 5], [0x0E3A, 0x0E3A, 6]
];
const LAO: ReadonlyArray<MarkClass> = [
    [0x0EB1, 0x0EB1, 1], [0x0EB4, 0x0EB7, 1], [0x0EBB, 0x0EBB, 1], [0x0ECD, 0x0ECD, 1], [0x0EC8, 0x0ECC, 2], [0x0EBC, 0x0EBC, 5], [0x0EB8, 0x0EB9, 6]
];
const TABLES: Readonly<Record<string, ReadonlyArray<MarkClass>>> = { "arab": ARABIC, "syrc": SYRIAC, "hebr": HEBREW, "thai": THAI, "lao ": LAO };
const BASE: RegExp = /^[\p{L}\p{N}\p{Zs}]$/u;
const DOTTED_CIRCLE: number = 0x25CC;
const ZERO_WIDTH_JOINER: number = 0x200D;
const ARABIC_ABOVE: number = 1;
const ARABIC_BELOW: number = 2;
const SHADDA: number = 0x0651;
const MODIFIER_MARKS: ReadonlySet<number> = new Set<number>([
    0x0654, 0x0655, 0x0658, 0x06DC, 0x06E3, 0x06E7, 0x06E8, 0x08CA, 0x08CB, 0x08CD, 0x08CE, 0x08CF, 0x08D3, 0x08F3, 0x10EF4, 0x10EF6, 0x10EF9
]);
const CLASS_ONE_MARK: number = 0x0334;
const ABOVE_MARK: number = 0x0301;
const BELOW_MARK: number = 0x0323;

export class DiacriticShaper extends FeatureShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>(Object.keys(TABLES));

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // "Invalid Combining Marks": "There is a check to make sure more than one mark of a class is not placed on the same
        // base", and the mark that causes the invalid state, or has no base, is placed on a dotted circle.
        const table: ReadonlyArray<MarkClass> | undefined = TABLES[request.scriptTags.find((tag: string) => TABLES[tag] !== undefined) ?? ""];
        if (table === undefined || this.layout.glyphOf(DOTTED_CIRCLE) === 0) {
            return super.shape(table === ARABIC ? this.renderingOrder(codepoints) : codepoints, request, instance);
        }
        const codes: Array<number> = [];
        const origins: Array<number> = [];
        let used: Set<number> = new Set<number>();
        let based: boolean = false;
        codepoints.forEach((code: number, index: number) => {
            const type: number | undefined = table.find((entry: MarkClass) => code >= entry[0] && code <= entry[1])?.[2];
            if (type === undefined) {
                // "to render a sign standalone ... one should apply it on a space ... a ZWJ to be placed between the space and a
                // mark", so a space is a base, and a ZWJ leaves the base before it in place.
                if (code !== ZERO_WIDTH_JOINER && !/^\p{M}$/u.test(String.fromCodePoint(code))) {
                    based = code === DOTTED_CIRCLE || BASE.test(String.fromCodePoint(code));
                    used = new Set<number>();
                }
            } else if (!based || used.has(type) || this.excludes(table, type, used)) {
                codes.push(DOTTED_CIRCLE);
                origins.push(index);
                used = new Set<number>([type]);
                based = true;
            } else {
                used.add(type);
            }
            codes.push(code);
            origins.push(index);
        });
        const infos: Array<GlyphInfo> = super.shape(table === ARABIC ? this.renderingOrder(codes) : codes, request, instance);
        for (const info of infos) {
            info.cluster = origins[info.cluster];
        }
        return infos;
    }

    private renderingOrder(codes: ReadonlyArray<number>): ReadonlyArray<number> {
        // UTR #53 §3.2, for "rendering using inside-out stacking": each maximal run of non-starters is reordered.
        let result: Array<number> | undefined;
        let start: number = 0;
        while (start < codes.length) {
            if (!this.isNonStarter(codes[start])) {
                start++;
                continue;
            }
            let end: number = start + 1;
            while (end < codes.length && this.isNonStarter(codes[end])) {
                end++;
            }
            if (end - start > 1) {
                result = result ?? [...codes];
                result.splice(start, end - start, ...this.reordered(codes.slice(start, end)));
            }
            start = end;
        }
        return result ?? codes;
    }

    private reordered(run: ReadonlyArray<number>): ReadonlyArray<number> {
        // UTR #53 §3.2: "Normalize the input to NFD", then "Move any shadda characters (ccc=33) to the beginning", and before them
        // the MCM that begin the ccc=230 characters, and before those the MCM that begin the ccc=220 characters.
        const marks: Array<number> = Array.from(String.fromCodePoint(...run).normalize("NFD"), (mark: string) => mark.codePointAt(0) as number);
        const rest: Array<number> = marks.filter((mark: number) => mark !== SHADDA);
        const below: Array<number> = this.leadingModifiers(rest, BELOW_MARK);
        const above: Array<number> = this.leadingModifiers(rest, ABOVE_MARK);
        return [...below, ...above, ...marks.filter((mark: number) => mark === SHADDA), ...rest];
    }

    private leadingModifiers(marks: Array<number>, reference: number): Array<number> {
        const first: number = marks.findIndex((mark: number) => this.hasSameClass(mark, reference));
        let end: number = first;
        while (first >= 0 && end < marks.length && MODIFIER_MARKS.has(marks[end]) && this.hasSameClass(marks[end], reference)) {
            end++;
        }
        return first < 0 ? [] : marks.splice(first, end - first);
    }

    private isNonStarter(code: number): boolean {
        // Canonical ordering moves a mark of a higher combining class after a mark of class 1, and never moves a starter.
        const pair: string = String.fromCodePoint(code, CLASS_ONE_MARK);
        return /^\p{M}/u.test(pair) && pair.normalize("NFD") !== pair;
    }

    private hasSameClass(code: number, reference: number): boolean {
        // Canonical ordering leaves two non-starters as they are, in both orders, only when their combining classes are equal.
        const forward: string = String.fromCodePoint(code, reference);
        const backward: string = String.fromCodePoint(reference, code);
        return forward.normalize("NFD") === forward && backward.normalize("NFD") === backward;
    }

    private excludes(table: ReadonlyArray<MarkClass>, type: number, used: ReadonlySet<number>): boolean {
        // Arabic: "DIAC1 and DIAC2 classes should not be applied on the same base character."
        return table === ARABIC && ((type === ARABIC_ABOVE && used.has(ARABIC_BELOW)) || (type === ARABIC_BELOW && used.has(ARABIC_ABOVE)));
    }
}
