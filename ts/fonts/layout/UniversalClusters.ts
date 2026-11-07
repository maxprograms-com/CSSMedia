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

import { USE_CLASSES, USE_INVALID_CLUSTERS, USE_RANGES, USE_SPLIT_VOWELS } from "../generated/UniversalShapingData.js";

interface UniversalCluster {
    start: number;
    end: number;
    defective: boolean;
}

export interface DecomposedText {
    codes: Array<number>;
    origins: Array<number>;
}

const BMP_SIZE: number = 0x10000;
const SYMBOLS: Readonly<Record<string, string>> = {
    "B": "B", "GB": "g", "R": "R", "CS": "c", "VS": "v", "CMAbv": "a", "CMBlw": "b", "H": "H", "SUB": "s", "RK": "k",
    "MPre": "1", "MAbv": "2", "MBlw": "3", "MPst": "4", "VPre": "5", "VAbv": "6", "VBlw": "7", "VPst": "8",
    "VMPre": "p", "VMAbv": "q", "VMBlw": "r", "VMPst": "t", "FAbv": "x", "FBlw": "y", "FPst": "z", "FM": "m",
    "N": "N", "HN": "n", "S": "S", "G": "G", "HR": "h", "HM": "M", "SB": "<", "SE": ">", "J": "J",
    "IND": "I", "O": "O", "Rsv": "U", "WJ": "W", "ZWJ": "j", "ZWNJ": "w", "CGJ": "C"
};
const MARKS: string = "abHsk12345678pqrtxyzmnhM";
const X: string = "(?:C|j(?!j)|w(?=[" + MARKS + "]))*";
const MODIFIERS: string = "(?:v" + X + ")?(?:a" + X + ")*(?:b" + X + ")*";
const TAIL: string = "(?:1" + X + ")?(?:2" + X + ")?(?:3" + X + ")?(?:4" + X + ")?(?:5" + X + ")*(?:6" + X + ")*(?:7" + X + ")*(?:8" + X + ")*(?:p" + X + ")*(?:q" + X + ")*(?:r"
    + X + ")*(?:t" + X + ")*(?:x" + X + ")*(?:y" + X + ")*(?:z" + X + ")*(?:m" + X + ")?";
const HIEROGLYPH: string = "(?:<" + X + ")*G" + X + "(?:v" + X + ")?(?:h" + X + ")?(?:M" + X + ")?(?:>" + X + ")*";
const END: string = "[jw]?";
const CLUSTERS: ReadonlyArray<RegExp> = [
    new RegExp("(?:[Rc]" + X + ")?[Bg]" + X + MODIFIERS + "(?:(?:H" + X + "B" + X + "(?:v" + X + ")?|s" + X + ")(?:a" + X + ")*(?:b" + X + ")*)*(?:[Hk]" + X + "|" + TAIL + ")" + END, "y"),
    new RegExp("N" + X + "(?:v" + X + ")?(?:n" + X + "N" + X + "(?:v" + X + ")?)*(?:n" + X + ")?" + END, "y"),
    new RegExp("S" + X + MODIFIERS + END, "y"),
    new RegExp(HIEROGLYPH + "(?:J" + X + HIEROGLYPH + ")*(?:J" + X + ")?" + END, "y"),
    new RegExp("[IOUW]" + X + "(?:v" + X + ")?" + END, "y")
];

export class UniversalClusters {

    private readonly bmp: Uint8Array = new Uint8Array(BMP_SIZE);
    private readonly starts: Array<number> = [];
    private readonly ends: Array<number> = [];
    private readonly classes: Array<number> = [];
    private readonly symbols: Array<string> = USE_CLASSES.map((name: string) => SYMBOLS[name] ?? "O");
    private readonly splits: Map<number, ReadonlyArray<number>> = new Map<number, ReadonlyArray<number>>(USE_SPLIT_VOWELS);
    private readonly invalid: Map<number, Array<ReadonlyArray<number>>> = new Map<number, Array<ReadonlyArray<number>>>();

    constructor() {
        for (const [start, end, value] of USE_RANGES) {
            if (start < BMP_SIZE) {
                this.bmp.fill(value, start, Math.min(end, BMP_SIZE - 1) + 1);
            }
            if (end >= BMP_SIZE) {
                this.starts.push(Math.max(start, BMP_SIZE));
                this.ends.push(end);
                this.classes.push(value);
            }
        }
        for (const sequence of USE_INVALID_CLUSTERS) {
            const list: Array<ReadonlyArray<number>> | undefined = this.invalid.get(sequence[0]);
            if (list === undefined) {
                this.invalid.set(sequence[0], [sequence]);
            } else {
                list.push(sequence);
            }
        }
    }

    classNamed(name: string): number {
        return USE_CLASSES.indexOf(name);
    }

    classOf(codepoint: number): number {
        if (codepoint < BMP_SIZE) {
            return this.bmp[codepoint];
        }
        let low: number = 0;
        let high: number = this.starts.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < this.starts[middle]) {
                high = middle - 1;
            } else if (codepoint > this.ends[middle]) {
                low = middle + 1;
            } else {
                return this.classes[middle];
            }
        }
        return USE_CLASSES.indexOf("O");
    }

    decompose(codepoints: ReadonlyArray<number>): DecomposedText {
        // Universal Shaping Engine, "Split vowel handling": the clusters are validated "based on the decomposed state of a
        // split vowel"; each part keeps the position of its character in the text.
        const codes: Array<number> = [];
        const origins: Array<number> = [];
        for (let index: number = 0; index < codepoints.length; index++) {
            for (const part of this.splits.get(codepoints[index]) ?? [codepoints[index]]) {
                codes.push(part);
                origins.push(index);
            }
        }
        return { codes, origins };
    }

    clusters(codes: ReadonlyArray<number>): Array<UniversalCluster> {
        // Universal Shaping Engine, "Cluster validation": the standard, virama terminated, numeral, symbol, hieroglyph and
        // independent clusters; what starts none of them is a defective cluster of one character.
        let text: string = "";
        for (const code of codes) {
            text += this.symbols[this.classOf(code)];
        }
        const clusters: Array<UniversalCluster> = [];
        let start: number = 0;
        while (start < text.length) {
            let end: number = start;
            for (const pattern of CLUSTERS) {
                pattern.lastIndex = start;
                if (pattern.test(text) && pattern.lastIndex > start) {
                    end = pattern.lastIndex;
                    break;
                }
            }
            const defective: boolean = end === start && MARKS.includes(text[start]);
            end = end === start ? start + 1 : this.valid(codes, start, end);
            clusters.push({ start, end, defective });
            start = end;
        }
        return clusters;
    }

    private valid(codes: ReadonlyArray<number>, start: number, end: number): number {
        // Universal Shaping Engine, "Independent Vowel plus Dependent Vowel constraints": a listed sequence is not a cluster,
        // so the cluster ends before the last character of the sequence.
        const sequences: ReadonlyArray<ReadonlyArray<number>> | undefined = this.invalid.get(codes[start]);
        if (sequences === undefined) {
            return end;
        }
        for (const sequence of sequences) {
            if (start + sequence.length <= end && sequence.every((code: number, index: number) => codes[start + index] === code)) {
                return start + sequence.length - 1;
            }
        }
        return end;
    }
}
