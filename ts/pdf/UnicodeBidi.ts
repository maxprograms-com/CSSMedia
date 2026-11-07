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

import type { Direction } from "../css/CompiledSelector.js";
import { BIDI_BRACKETS, BIDI_CLASS_RANGES, BIDI_MIRRORED, BIDI_MIRRORS } from "./generated/BidiData.js";

export interface BidiParagraph {
    level: number;
    levels: Uint8Array;
}

interface Status {
    level: number;
    override: number;
    isolate: boolean;
}

interface Bracket {
    pair: number;
    open: boolean;
}

interface OpenBracket {
    closing: number;
    position: number;
}

const CLASS_NAMES: ReadonlyArray<string> = [
    "L", "R", "AL", "EN", "ES", "ET", "AN", "CS", "NSM", "BN", "B", "S", "WS", "ON", "LRE", "LRO", "RLE", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"
];
const L: number = 0;
const R: number = 1;
const AL: number = 2;
const EN: number = 3;
const ES: number = 4;
const ET: number = 5;
const AN: number = 6;
const CS: number = 7;
const NSM: number = 8;
const BN: number = 9;
const B: number = 10;
const S: number = 11;
const WS: number = 12;
const ON: number = 13;
const LRE: number = 14;
const LRO: number = 15;
const RLE: number = 16;
const RLO: number = 17;
const PDF: number = 18;
const LRI: number = 19;
const RLI: number = 20;
const FSI: number = 21;
const PDI: number = 22;
const NEUTRAL: number = -1;
const MAX_DEPTH: number = 125;
const MAX_BRACKETS: number = 63;
const BMP_SIZE: number = 0x10000;

export class UnicodeBidi {

    private readonly bmp: Uint8Array = new Uint8Array(BMP_SIZE);
    private readonly starts: Array<number> = [];
    private readonly ends: Array<number> = [];
    private readonly classes: Array<number> = [];
    private readonly mirrors: Map<number, number> = new Map<number, number>();
    private readonly brackets: Map<number, Bracket> = new Map<number, Bracket>();

    constructor() {
        // The table lists every class but L, which is the class of all the other code points.
        for (const [start, end, name] of BIDI_CLASS_RANGES) {
            const code: number = CLASS_NAMES.indexOf(name);
            if (start < BMP_SIZE) {
                this.bmp.fill(code, start, Math.min(end, BMP_SIZE - 1) + 1);
            }
            if (end >= BMP_SIZE) {
                this.starts.push(Math.max(start, BMP_SIZE));
                this.ends.push(end);
                this.classes.push(code);
            }
        }
        for (const [codepoint, mirrored] of BIDI_MIRRORS) {
            this.mirrors.set(codepoint, mirrored);
        }
        for (const [codepoint, pair, kind] of BIDI_BRACKETS) {
            this.brackets.set(codepoint, { pair, open: kind === "o" });
        }
    }

    mirrorOf(codepoint: number): number | undefined {
        return this.mirrors.get(codepoint);
    }

    isMirrored(codepoint: number): boolean {
        // The Bidi_Mirrored property, which some characters have without a mirrored character to show them with.
        let low: number = 0;
        let high: number = BIDI_MIRRORED.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            const range: readonly [number, number] = BIDI_MIRRORED[middle];
            if (codepoint < range[0]) {
                high = middle - 1;
            } else if (codepoint > range[1]) {
                low = middle + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    closingBracketOf(codepoint: number): number | undefined {
        // UAX #9 BD14 and BD15: for an opening paired bracket, the closing bracket that its Bidi_Paired_Bracket value names.
        const bracket: Bracket | undefined = this.brackets.get(codepoint);
        return bracket !== undefined && bracket.open ? bracket.pair : undefined;
    }

    isParagraphSeparator(codepoint: number): boolean {
        // UAX #9 rule P1: the text is split into paragraphs at the characters of class B.
        return this.classOf(codepoint) === B;
    }

    firstStrong(text: string, isolates: number): Direction | number {
        // UAX #9 rules P2 and P3: the first character of class L, R or AL decides, skipping what lies between an isolate
        // initiator and its matching PDI; the count of isolates still open is returned when the text has no such character.
        let open: number = isolates;
        for (const character of text) {
            const type: number = this.classOf(character.codePointAt(0) as number);
            if (this.isInitiator(type)) {
                open++;
            } else if (type === PDI) {
                open = Math.max(0, open - 1);
            } else if (open === 0 && type === L) {
                return "ltr";
            } else if (open === 0 && (type === R || type === AL)) {
                return "rtl";
            }
        }
        return open;
    }

    resolve(codepoints: ReadonlyArray<number>, baseLevel?: number): BidiParagraph {
        // UAX #9 §3.3 for one paragraph; rule HL1 lets the caller give the paragraph level, and P2 and P3 find it otherwise.
        const count: number = codepoints.length;
        const original: Uint8Array = new Uint8Array(count);
        for (let index: number = 0; index < count; index++) {
            original[index] = this.classOf(codepoints[index]);
        }
        const types: Int8Array = Int8Array.from(original);
        const matchingPdi: Int32Array = new Int32Array(count).fill(-1);
        const matchingInitiator: Int32Array = new Int32Array(count).fill(-1);
        this.matchIsolates(original, matchingPdi, matchingInitiator);
        const level: number = baseLevel ?? this.firstStrongLevel(original, 0, count, matchingPdi) ?? 0;
        const explicit: Uint8Array = new Uint8Array(count);
        this.resolveExplicit(original, types, explicit, level, matchingPdi);
        // Rule X10: sos and eos "must use the embedding levels assigned by the rules above, before any changes are made".
        const levels: Uint8Array = Uint8Array.from(explicit);
        for (const sequence of this.isolatingRunSequences(original, explicit, matchingPdi, matchingInitiator)) {
            this.resolveSequence(sequence, codepoints, original, types, explicit, levels, level, matchingPdi);
        }
        this.settleRemoved(original, levels, level);
        this.resetSeparators(original, levels, level);
        return { level, levels };
    }

    resetLineEnd(codepoints: ReadonlyArray<number>, levels: Uint8Array, start: number, end: number, level: number): void {
        // Rule L1, last item: white space and isolate formatting characters at the end of a line take the paragraph level;
        // the lines are known only after line breaking, so this part is applied to each line then.
        for (let index: number = end - 1; index >= start; index--) {
            const type: number = this.classOf(codepoints[index]);
            if (type !== WS && !this.isIsolateFormatting(type) && !this.isRemoved(type)) {
                break;
            }
            levels[index] = level;
        }
    }

    private classOf(codepoint: number): number {
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
        return L;
    }

    private isInitiator(type: number): boolean {
        return type === LRI || type === RLI || type === FSI;
    }

    private isIsolateFormatting(type: number): boolean {
        return type >= LRI && type <= PDI;
    }

    private isRemoved(type: number): boolean {
        // Rule X9 removes RLE, LRE, RLO, LRO, PDF and BN; here they stay in place and every later rule skips them (§5.2).
        return type === BN || (type >= LRE && type <= PDF);
    }

    private isNeutral(type: number): boolean {
        return (type >= B && type <= ON) || this.isIsolateFormatting(type);
    }

    private matchIsolates(original: Uint8Array, matchingPdi: Int32Array, matchingInitiator: Int32Array): void {
        // BD9: a PDI matches the nearest isolate initiator before it that is still open.
        const open: Array<number> = [];
        for (let index: number = 0; index < original.length; index++) {
            if (this.isInitiator(original[index])) {
                open.push(index);
            } else if (original[index] === PDI && open.length > 0) {
                const initiator: number = open.pop() as number;
                matchingPdi[initiator] = index;
                matchingInitiator[index] = initiator;
            }
        }
    }

    private firstStrongLevel(original: Uint8Array, from: number, to: number, matchingPdi: Int32Array): number | undefined {
        // Rules P2 and P3, skipping from an isolate initiator to its matching PDI, or to the end when it has none.
        for (let index: number = from; index < to; index++) {
            const type: number = original[index];
            if (type === L) {
                return 0;
            }
            if (type === R || type === AL) {
                return 1;
            }
            if (this.isInitiator(type)) {
                if (matchingPdi[index] < 0) {
                    return undefined;
                }
                index = matchingPdi[index];
            }
        }
        return undefined;
    }

    private resolveExplicit(original: Uint8Array, types: Int8Array, levels: Uint8Array, paragraphLevel: number, matchingPdi: Int32Array): void {
        // Rules X1 to X8, with the levels of the formatting characters set as §5.2 describes.
        const stack: Array<Status> = [{ level: paragraphLevel, override: NEUTRAL, isolate: false }];
        let overflowIsolates: number = 0;
        let overflowEmbeddings: number = 0;
        let validIsolates: number = 0;
        for (let index: number = 0; index < original.length; index++) {
            const type: number = original[index];
            const top: Status = stack[stack.length - 1];
            if (type === RLE || type === LRE || type === RLO || type === LRO) {
                levels[index] = top.level;
                const next: number = type === RLE || type === RLO ? this.nextOdd(top.level) : this.nextEven(top.level);
                if (next <= MAX_DEPTH && overflowIsolates === 0 && overflowEmbeddings === 0) {
                    stack.push({ level: next, override: type === LRO ? L : (type === RLO ? R : NEUTRAL), isolate: false });
                } else if (overflowIsolates === 0) {
                    overflowEmbeddings++;
                }
            } else if (this.isInitiator(type)) {
                levels[index] = top.level;
                if (top.override !== NEUTRAL) {
                    types[index] = top.override;
                }
                let rtl: boolean = type === RLI;
                if (type === FSI) {
                    // Rule X5c: P2 and P3 on the characters between the FSI and its matching PDI.
                    const end: number = matchingPdi[index] < 0 ? original.length : matchingPdi[index];
                    rtl = this.firstStrongLevel(original, index + 1, end, matchingPdi) === 1;
                }
                const next: number = rtl ? this.nextOdd(top.level) : this.nextEven(top.level);
                if (next <= MAX_DEPTH && overflowIsolates === 0 && overflowEmbeddings === 0) {
                    validIsolates++;
                    stack.push({ level: next, override: NEUTRAL, isolate: true });
                } else {
                    overflowIsolates++;
                }
            } else if (type === PDI) {
                if (overflowIsolates > 0) {
                    overflowIsolates--;
                } else if (validIsolates > 0) {
                    overflowEmbeddings = 0;
                    while (!stack[stack.length - 1].isolate) {
                        stack.pop();
                    }
                    stack.pop();
                    validIsolates--;
                }
                const current: Status = stack[stack.length - 1];
                levels[index] = current.level;
                if (current.override !== NEUTRAL) {
                    types[index] = current.override;
                }
            } else if (type === PDF) {
                if (overflowIsolates === 0 && overflowEmbeddings > 0) {
                    overflowEmbeddings--;
                } else if (overflowIsolates === 0 && !top.isolate && stack.length >= 2) {
                    stack.pop();
                }
                levels[index] = stack[stack.length - 1].level;
            } else if (type === B) {
                levels[index] = paragraphLevel;
            } else {
                levels[index] = top.level;
                if (type !== BN && top.override !== NEUTRAL) {
                    types[index] = top.override;
                }
            }
        }
    }

    private nextOdd(level: number): number {
        return (level & 1) === 1 ? level + 2 : level + 1;
    }

    private nextEven(level: number): number {
        return (level & 1) === 0 ? level + 2 : level + 1;
    }

    private isolatingRunSequences(original: Uint8Array, levels: Uint8Array, matchingPdi: Int32Array, matchingInitiator: Int32Array): Array<Array<number>> {
        // BD7 and BD13: the level runs, then each run that does not start with a matched PDI opens a sequence that goes on
        // with the run of the matching PDI while its last character is an isolate initiator that has one.
        const runs: Array<Array<number>> = [];
        let current: Array<number> = [];
        let currentLevel: number = -1;
        for (let index: number = 0; index < original.length; index++) {
            if (this.isRemoved(original[index])) {
                continue;
            }
            if (current.length > 0 && levels[index] !== currentLevel) {
                runs.push(current);
                current = [];
            }
            current.push(index);
            currentLevel = levels[index];
        }
        if (current.length > 0) {
            runs.push(current);
        }
        const runStartingAt: Map<number, Array<number>> = new Map<number, Array<number>>();
        for (const run of runs) {
            runStartingAt.set(run[0], run);
        }
        const sequences: Array<Array<number>> = [];
        for (const run of runs) {
            if (original[run[0]] === PDI && matchingInitiator[run[0]] >= 0) {
                continue;
            }
            const sequence: Array<number> = [...run];
            let last: number = run[run.length - 1];
            while (this.isInitiator(original[last]) && matchingPdi[last] >= 0) {
                const next: Array<number> | undefined = runStartingAt.get(matchingPdi[last]);
                if (next === undefined) {
                    break;
                }
                for (const index of next) {
                    sequence.push(index);
                }
                last = next[next.length - 1];
            }
            sequences.push(sequence);
        }
        return sequences;
    }

    private resolveSequence(sequence: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, original: Uint8Array, types: Int8Array, explicit: Uint8Array,
        levels: Uint8Array, paragraphLevel: number, matchingPdi: Int32Array): void {
        const length: number = sequence.length;
        const level: number = explicit[sequence[0]];
        const last: number = sequence[length - 1];
        const before: number = this.neighborLevel(sequence[0], -1, original, explicit, paragraphLevel);
        const unmatched: boolean = this.isInitiator(original[last]) && matchingPdi[last] < 0;
        const following: number = unmatched ? paragraphLevel : this.neighborLevel(last, 1, original, explicit, paragraphLevel);
        const sos: number = (Math.max(level, before) & 1) === 1 ? R : L;
        const eos: number = (Math.max(level, following) & 1) === 1 ? R : L;
        const embedding: number = (level & 1) === 1 ? R : L;
        const t: Int8Array = new Int8Array(length);
        for (let k: number = 0; k < length; k++) {
            t[k] = types[sequence[k]];
        }
        const beforeWeak: Int8Array = Int8Array.from(t);
        this.resolveWeak(t, sos);
        this.resolveBrackets(sequence, codepoints, beforeWeak, t, embedding, sos);
        // Rules N1 and N2: a run of neutrals takes the direction both sides share, numbers counting as R, or else the embedding direction.
        for (let k: number = 0; k < length; k++) {
            if (!this.isNeutral(t[k])) {
                continue;
            }
            let end: number = k;
            while (end < length && this.isNeutral(t[end])) {
                end++;
            }
            const leading: number = (k === 0 ? sos : t[k - 1]) === L ? L : R;
            const trailing: number = (end >= length ? eos : t[end]) === L ? L : R;
            t.fill(leading === trailing ? leading : embedding, k, end);
            k = end - 1;
        }
        // Rules I1 and I2.
        for (let k: number = 0; k < length; k++) {
            const type: number = t[k];
            if ((level & 1) === 0) {
                levels[sequence[k]] = type === R ? level + 1 : (type === AN || type === EN ? level + 2 : level);
            } else {
                levels[sequence[k]] = type === L || type === EN || type === AN ? level + 1 : level;
            }
        }
    }

    private resolveWeak(t: Int8Array, sos: number): void {
        // Rules W1 to W7, each applied to the whole sequence before the next.
        const length: number = t.length;
        for (let k: number = 0; k < length; k++) {
            if (t[k] === NSM) {
                const previous: number = k === 0 ? sos : t[k - 1];
                t[k] = this.isIsolateFormatting(previous) ? ON : previous;
            }
        }
        let strong: number = sos;
        for (let k: number = 0; k < length; k++) {
            if (t[k] === L || t[k] === R || t[k] === AL) {
                strong = t[k];
            } else if (t[k] === EN && strong === AL) {
                t[k] = AN;
            }
        }
        for (let k: number = 0; k < length; k++) {
            if (t[k] === AL) {
                t[k] = R;
            }
        }
        for (let k: number = 1; k < length - 1; k++) {
            if ((t[k] === ES || t[k] === CS) && t[k - 1] === EN && t[k + 1] === EN) {
                t[k] = EN;
            } else if (t[k] === CS && t[k - 1] === AN && t[k + 1] === AN) {
                t[k] = AN;
            }
        }
        for (let k: number = 0; k < length; k++) {
            if (t[k] !== ET) {
                continue;
            }
            let end: number = k;
            while (end < length && t[end] === ET) {
                end++;
            }
            if ((k > 0 && t[k - 1] === EN) || (end < length && t[end] === EN)) {
                t.fill(EN, k, end);
            }
            k = end - 1;
        }
        for (let k: number = 0; k < length; k++) {
            if (t[k] === ES || t[k] === ET || t[k] === CS) {
                t[k] = ON;
            }
        }
        strong = sos;
        for (let k: number = 0; k < length; k++) {
            if (t[k] === L || t[k] === R) {
                strong = t[k];
            } else if (t[k] === EN && strong === L) {
                t[k] = L;
            }
        }
    }

    private neighborLevel(index: number, step: number, original: Uint8Array, levels: Uint8Array, paragraphLevel: number): number {
        for (let position: number = index + step; position >= 0 && position < original.length; position += step) {
            if (!this.isRemoved(original[position])) {
                return levels[position];
            }
        }
        return paragraphLevel;
    }

    private bracketPairs(sequence: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, t: Int8Array): Array<[number, number]> {
        // BD16: a stack of 63 opening brackets; when it has no room the sequence has no bracket pairs at all.
        const pairs: Array<[number, number]> = [];
        const stack: Array<OpenBracket> = [];
        for (let k: number = 0; k < sequence.length; k++) {
            if (t[k] !== ON) {
                continue;
            }
            const bracket: Bracket | undefined = this.brackets.get(codepoints[sequence[k]]);
            if (bracket === undefined) {
                continue;
            }
            if (bracket.open) {
                if (stack.length === MAX_BRACKETS) {
                    return [];
                }
                stack.push({ closing: this.canonical(bracket.pair), position: k });
                continue;
            }
            const closing: number = this.canonical(codepoints[sequence[k]]);
            for (let depth: number = stack.length - 1; depth >= 0; depth--) {
                if (stack[depth].closing === closing) {
                    pairs.push([stack[depth].position, k]);
                    stack.length = depth;
                    break;
                }
            }
        }
        return pairs.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
    }

    private canonical(codepoint: number): number {
        // BD16: U+2329 and U+232A are canonically equivalent to U+3008 and U+3009, and no other brackets are.
        return codepoint === 0x2329 ? 0x3008 : (codepoint === 0x232A ? 0x3009 : codepoint);
    }

    private resolveBrackets(sequence: ReadonlyArray<number>, codepoints: ReadonlyArray<number>, beforeWeak: Int8Array, t: Int8Array, embedding: number, sos: number): void {
        // Rule N0: a pair takes the embedding direction when it encloses a strong type of that direction; when it encloses only
        // the opposite one, it takes the direction of the strong type before it. EN and AN count as R.
        const opposite: number = embedding === L ? R : L;
        for (const [open, close] of this.bracketPairs(sequence, codepoints, t)) {
            let foundEmbedding: boolean = false;
            let foundOpposite: boolean = false;
            for (let k: number = open + 1; k < close && !foundEmbedding; k++) {
                const direction: number = this.strongDirection(t[k]);
                foundEmbedding = direction === embedding;
                foundOpposite = foundOpposite || direction === opposite;
            }
            if (!foundEmbedding && !foundOpposite) {
                continue;
            }
            let resolved: number = embedding;
            if (!foundEmbedding) {
                let context: number = sos;
                for (let k: number = open - 1; k >= 0; k--) {
                    const direction: number = this.strongDirection(t[k]);
                    if (direction !== NEUTRAL) {
                        context = direction;
                        break;
                    }
                }
                resolved = context === opposite ? opposite : embedding;
            }
            for (const position of [open, close]) {
                t[position] = resolved;
                // "characters that had original bidirectional character type NSM prior to the application of W1" follow their bracket.
                for (let k: number = position + 1; k < sequence.length && beforeWeak[k] === NSM; k++) {
                    t[k] = resolved;
                }
            }
        }
    }

    private strongDirection(type: number): number {
        return type === L ? L : (type === R || type === EN || type === AN ? R : NEUTRAL);
    }

    private settleRemoved(original: Uint8Array, levels: Uint8Array, paragraphLevel: number): void {
        // §5.2: a character that rule X9 removes takes the level of the character before it.
        for (let index: number = 0; index < original.length; index++) {
            if (this.isRemoved(original[index])) {
                levels[index] = index > 0 ? levels[index - 1] : paragraphLevel;
            }
        }
    }

    private resetSeparators(original: Uint8Array, levels: Uint8Array, paragraphLevel: number): void {
        // Rule L1, first three items: segment and paragraph separators, and the white space and isolate formatting
        // characters before them, take the paragraph level; the original types decide.
        let reset: boolean = false;
        for (let index: number = original.length - 1; index >= 0; index--) {
            const type: number = original[index];
            if (type === B || type === S) {
                levels[index] = paragraphLevel;
                reset = true;
            } else if (reset && (type === WS || this.isIsolateFormatting(type) || this.isRemoved(type))) {
                levels[index] = paragraphLevel;
            } else {
                reset = false;
            }
        }
    }
}
