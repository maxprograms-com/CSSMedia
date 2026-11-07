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

export interface HyphenationPatternModule {
    PATTERNS: string;
    EXCEPTIONS: string;
    LEFT_MIN: number;
    RIGHT_MIN: number;
}

const WORD_BOUNDARY: string = ".";
const HYPHEN: string = "-";
const LETTER: RegExp = /[\p{L}\p{M}]/u;
const UNCOUNTED: RegExp = /[\p{Mn}\p{P}]/u;

export class HyphenationPatterns {

    readonly leftMin: number;
    readonly rightMin: number;

    private readonly patterns: Map<string, number> = new Map<string, number>();
    private readonly weights: Uint8Array;
    private readonly exceptions: Map<string, ReadonlyArray<number>> = new Map<string, ReadonlyArray<number>>();
    private readonly extraLetters: Set<string> = new Set<string>();
    private longest: number = 0;

    constructor(module: HyphenationPatternModule) {
        this.leftMin = module.LEFT_MIN;
        this.rightMin = module.RIGHT_MIN;
        // A language has tens of thousands of patterns of a few weights each, so the weights of all of them share one
        // array; a pattern of n letters has n + 1 weights, which is never more than its text and the space after it.
        const text: string = module.PATTERNS;
        const weights: Uint8Array = new Uint8Array(text.length + 1);
        let used: number = 0;
        let start: number = 0;
        while (start < text.length) {
            const space: number = text.indexOf(" ", start);
            const end: number = space === -1 ? text.length : space;
            if (end > start) {
                used = this.addPattern(text.substring(start, end), weights, used);
            }
            start = end + 1;
        }
        this.weights = weights.slice(0, used);
        for (const word of module.EXCEPTIONS.split(" ")) {
            if (word.length > 0) {
                this.addException(word);
            }
        }
    }

    isExtraLetter(character: string): boolean {
        return this.extraLetters.has(character);
    }

    breakPositionsOf(word: string, minWord: number, leftMin: number, rightMin: number): Array<number> {
        // Liang's algorithm (TeX): the highest number that any pattern puts between two letters decides, and an odd one allows
        // a break there. A position is the count of code points before the break.
        const letters: Array<string> = Array.from(word, (character: string) => this.lower(character));
        const count: number = letters.length;
        const positions: Array<number> = [];
        // CSS Text 4 §6.3.4: "Nonspacing combining marks (Unicode General Category Mn) and intra-word punctuation (Unicode
        // General Category P*) do not count towards the minimum."
        const counted: Array<number> = [0];
        for (const letter of letters) {
            counted.push(counted[counted.length - 1] + (UNCOUNTED.test(letter) ? 0 : 1));
        }
        const total: number = counted[count];
        if (total < minWord) {
            return positions;
        }
        const listed: ReadonlyArray<number> | undefined = this.exceptions.get(letters.join(""));
        const levels: Uint8Array = listed === undefined ? this.levelsOf(letters) : new Uint8Array(0);
        for (let position: number = 1; position < count; position++) {
            if (counted[position] < leftMin || total - counted[position] < rightMin) {
                continue;
            }
            if (listed === undefined ? levels[position + 1] % 2 === 1 : listed.includes(position)) {
                positions.push(position);
            }
        }
        return positions;
    }

    private lower(character: string): string {
        // A lowercase form of more than one code point would shift the positions, so the character stays as it is.
        const lowered: string = character.toLowerCase();
        return lowered.length === character.length ? lowered : character;
    }

    private levelsOf(letters: ReadonlyArray<string>): Uint8Array {
        const padded: Array<string> = [WORD_BOUNDARY, ...letters, WORD_BOUNDARY];
        const levels: Uint8Array = new Uint8Array(padded.length + 1);
        for (let start: number = 0; start < padded.length; start++) {
            let key: string = "";
            for (let end: number = start; end < padded.length && end - start < this.longest; end++) {
                key += padded[end];
                const offset: number | undefined = this.patterns.get(key);
                if (offset === undefined) {
                    continue;
                }
                // The pattern has the letters from start to end, and one weight more than letters.
                const count: number = end - start + 2;
                for (let index: number = 0; index < count; index++) {
                    const weight: number = this.weights[offset + index];
                    if (weight > levels[start + index]) {
                        levels[start + index] = weight;
                    }
                }
            }
        }
        return levels;
    }

    private addPattern(pattern: string, weights: Uint8Array, offset: number): number {
        // A pattern is letters with digits between them: "ab3c" gives the weight 3 between b and c; "." marks the edge of a word.
        let letters: string = "";
        let count: number = 0;
        for (const character of pattern) {
            if (character >= "0" && character <= "9") {
                weights[offset + count] = Number(character);
            } else {
                letters += character;
                count++;
                this.noteLetter(character);
            }
        }
        this.patterns.set(letters, offset);
        this.longest = Math.max(this.longest, count);
        return offset + count + 1;
    }

    private addException(word: string): void {
        // An exception is a word written with hyphens where it may break, and it replaces the patterns for that word.
        let letters: string = "";
        const positions: Array<number> = [];
        let count: number = 0;
        for (const character of word) {
            if (character === HYPHEN) {
                positions.push(count);
            } else {
                letters += character;
                count++;
                this.noteLetter(character);
            }
        }
        this.exceptions.set(letters, positions);
    }

    private noteLetter(character: string): void {
        if (character !== WORD_BOUNDARY && !LETTER.test(character)) {
            this.extraLetters.add(character);
        }
    }
}
