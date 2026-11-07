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

import { LINE_BREAK_CLASS_BITS, LINE_BREAK_CLASSES, LINE_BREAK_RANGES } from "./generated/LineBreakData.js";

const CLASS_MASK: number = (1 << LINE_BREAK_CLASS_BITS) - 1;
const EAST_ASIAN: number = 1 << LINE_BREAK_CLASS_BITS;
const INITIAL_QUOTE: number = 2 << LINE_BREAK_CLASS_BITS;
const FINAL_QUOTE: number = 4 << LINE_BREAK_CLASS_BITS;
const UNASSIGNED_PICTOGRAPH: number = 8 << LINE_BREAK_CLASS_BITS;
const MARK: number = 16 << LINE_BREAK_CLASS_BITS;
const LETTER: number = 32 << LINE_BREAK_CLASS_BITS;
const WIDE: number = 64 << LINE_BREAK_CLASS_BITS;
const FULLWIDTH: number = 128 << LINE_BREAK_CLASS_BITS;
const BMP_SIZE: number = 0x10000;
const DOTTED_CIRCLE: number = 0x25CC;

const AI: number = LINE_BREAK_CLASSES.indexOf("AI");
const AK: number = LINE_BREAK_CLASSES.indexOf("AK");
const AL: number = LINE_BREAK_CLASSES.indexOf("AL");
const AP: number = LINE_BREAK_CLASSES.indexOf("AP");
const AS: number = LINE_BREAK_CLASSES.indexOf("AS");
const B2: number = LINE_BREAK_CLASSES.indexOf("B2");
const BA: number = LINE_BREAK_CLASSES.indexOf("BA");
const BB: number = LINE_BREAK_CLASSES.indexOf("BB");
const BK: number = LINE_BREAK_CLASSES.indexOf("BK");
const CB: number = LINE_BREAK_CLASSES.indexOf("CB");
const CJ: number = LINE_BREAK_CLASSES.indexOf("CJ");
const CL: number = LINE_BREAK_CLASSES.indexOf("CL");
const CM: number = LINE_BREAK_CLASSES.indexOf("CM");
const CP: number = LINE_BREAK_CLASSES.indexOf("CP");
const CR: number = LINE_BREAK_CLASSES.indexOf("CR");
const EB: number = LINE_BREAK_CLASSES.indexOf("EB");
const EM: number = LINE_BREAK_CLASSES.indexOf("EM");
const EX: number = LINE_BREAK_CLASSES.indexOf("EX");
const GL: number = LINE_BREAK_CLASSES.indexOf("GL");
const H2: number = LINE_BREAK_CLASSES.indexOf("H2");
const H3: number = LINE_BREAK_CLASSES.indexOf("H3");
const HH: number = LINE_BREAK_CLASSES.indexOf("HH");
const HL: number = LINE_BREAK_CLASSES.indexOf("HL");
const HY: number = LINE_BREAK_CLASSES.indexOf("HY");
const ID: number = LINE_BREAK_CLASSES.indexOf("ID");
const IN: number = LINE_BREAK_CLASSES.indexOf("IN");
const IS: number = LINE_BREAK_CLASSES.indexOf("IS");
const JL: number = LINE_BREAK_CLASSES.indexOf("JL");
const JT: number = LINE_BREAK_CLASSES.indexOf("JT");
const JV: number = LINE_BREAK_CLASSES.indexOf("JV");
const LF: number = LINE_BREAK_CLASSES.indexOf("LF");
const NL: number = LINE_BREAK_CLASSES.indexOf("NL");
const NS: number = LINE_BREAK_CLASSES.indexOf("NS");
const NU: number = LINE_BREAK_CLASSES.indexOf("NU");
const OP: number = LINE_BREAK_CLASSES.indexOf("OP");
const PO: number = LINE_BREAK_CLASSES.indexOf("PO");
const PR: number = LINE_BREAK_CLASSES.indexOf("PR");
const QU: number = LINE_BREAK_CLASSES.indexOf("QU");
const RI: number = LINE_BREAK_CLASSES.indexOf("RI");
const SA: number = LINE_BREAK_CLASSES.indexOf("SA");
const SG: number = LINE_BREAK_CLASSES.indexOf("SG");
const SP: number = LINE_BREAK_CLASSES.indexOf("SP");
const SY: number = LINE_BREAK_CLASSES.indexOf("SY");
const VF: number = LINE_BREAK_CLASSES.indexOf("VF");
const VI: number = LINE_BREAK_CLASSES.indexOf("VI");
const WJ: number = LINE_BREAK_CLASSES.indexOf("WJ");
const XX: number = LINE_BREAK_CLASSES.indexOf("XX");
const ZW: number = LINE_BREAK_CLASSES.indexOf("ZW");
const ZWJ: number = LINE_BREAK_CLASSES.indexOf("ZWJ");

interface Units {
    count: number;
    start: Int32Array;
    type: Uint8Array;
    flags: Uint16Array;
    dotted: Uint8Array;
    joiner: Uint8Array;
}

export class LineBreaker {

    static readonly NONE: number = 0;
    static readonly ALLOWED: number = 1;
    static readonly MANDATORY: number = 2;
    static readonly HYPHENATION: number = 3;
    static readonly SPARE_HYPHENATION: number = 4;

    private readonly bmp: Uint16Array = new Uint16Array(BMP_SIZE);
    private readonly starts: Array<number> = [];
    private readonly ends: Array<number> = [];
    private readonly values: Array<number> = [];

    constructor() {
        for (const [start, end, value] of LINE_BREAK_RANGES) {
            if (start < BMP_SIZE) {
                this.bmp.fill(value, start, Math.min(end, BMP_SIZE - 1) + 1);
            }
            if (end >= BMP_SIZE) {
                this.starts.push(Math.max(start, BMP_SIZE));
                this.ends.push(end);
                this.values.push(value);
            }
        }
    }

    classNamed(name: string): number {
        return LINE_BREAK_CLASSES.indexOf(name);
    }

    classOf(codepoint: number): number {
        return this.valueOf(codepoint) & CLASS_MASK;
    }

    isLetter(codepoint: number): boolean {
        return (this.valueOf(codepoint) & LETTER) !== 0;
    }

    isMark(codepoint: number): boolean {
        return (this.valueOf(codepoint) & MARK) !== 0;
    }

    isWide(codepoint: number): boolean {
        return (this.valueOf(codepoint) & WIDE) !== 0;
    }

    isFullwidth(codepoint: number): boolean {
        return (this.valueOf(codepoint) & FULLWIDTH) !== 0;
    }

    isWideOrFullwidth(codepoint: number): boolean {
        const value: number = this.valueOf(codepoint);
        return (value & EAST_ASIAN) !== 0 && (value & WIDE) !== 0;
    }

    classes(codepoints: ReadonlyArray<number>): Uint8Array {
        // UAX #14 §8: tailoring changes "the line breaking class assignment for some characters", so the classes are given
        // apart from the breaks, for the caller to change them before the rules run.
        const classes: Uint8Array = new Uint8Array(codepoints.length);
        for (let index: number = 0; index < codepoints.length; index++) {
            classes[index] = this.valueOf(codepoints[index]) & CLASS_MASK;
        }
        return classes;
    }

    breaks(codepoints: ReadonlyArray<number>, classes: Uint8Array): Uint8Array {
        // UAX #14 §6: entry i is the break before character i, and the last entry is the break at the end of the text.
        const count: number = codepoints.length;
        const result: Uint8Array = new Uint8Array(count + 1);
        const units: Units = this.units(codepoints, classes);
        for (let unit: number = 1; unit < units.count; unit++) {
            result[units.start[unit]] = this.breakBefore(units, unit);
        }
        // Rules LB2 and LB3: "Never break at the start of text" and "Always break at the end of text".
        result[count] = LineBreaker.MANDATORY;
        return result;
    }

    private valueOf(codepoint: number): number {
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
                return this.values[middle];
            }
        }
        return XX;
    }

    private units(codepoints: ReadonlyArray<number>, classes: Uint8Array): Units {
        const count: number = codepoints.length;
        const units: Units = {
            count: 0, start: new Int32Array(count), type: new Uint8Array(count), flags: new Uint16Array(count), dotted: new Uint8Array(count),
            joiner: new Uint8Array(count)
        };
        for (let index: number = 0; index < count; index++) {
            const value: number = this.valueOf(codepoints[index]);
            // Rule LB1: AI, SG and XX resolve to AL, SA to CM for a nonspacing or spacing mark and to AL otherwise, and CJ to NS.
            let type: number = classes[index];
            if (type === AI || type === SG || type === XX) {
                type = AL;
            } else if (type === SA) {
                type = (value & MARK) !== 0 ? CM : AL;
            } else if (type === CJ) {
                type = NS;
            }
            const last: number = units.count - 1;
            const base: number = last < 0 ? SP : units.type[last];
            const absorbs: boolean = last >= 0 && base !== BK && base !== CR && base !== LF && base !== NL && base !== SP && base !== ZW;
            if ((type === CM || type === ZWJ) && absorbs) {
                // Rule LB9: "Treat X (CM | ZWJ)* as if it were X", where X is not BK, CR, LF, NL, SP or ZW.
                units.joiner[last] = type === ZWJ ? 1 : 0;
                continue;
            }
            units.start[units.count] = index;
            units.joiner[units.count] = type === ZWJ ? 1 : 0;
            // Rule LB10: a remaining CM or ZWJ is treated "as if it had the properties of U+0041".
            units.type[units.count] = type === CM || type === ZWJ ? AL : type;
            units.flags[units.count] = type === CM || type === ZWJ ? 0 : value;
            units.dotted[units.count] = codepoints[index] === DOTTED_CIRCLE ? 1 : 0;
            units.count++;
        }
        return units;
    }

    private breakBefore(units: Units, unit: number): number {
        const type: Uint8Array = units.type;
        const before: number = type[unit - 1];
        const after: number = type[unit];
        const next: number = unit + 1 < units.count ? type[unit + 1] : -1;
        // Rules LB4 to LB7.
        if (before === BK || ((before === CR && after !== LF) || before === LF || before === NL)) {
            return LineBreaker.MANDATORY;
        }
        if (before === CR || after === BK || after === CR || after === LF || after === NL || after === SP || after === ZW) {
            return LineBreaker.NONE;
        }
        // The rules written with SP* look at the last character before the spaces.
        let solid: number = unit - 1;
        while (solid >= 0 && type[solid] === SP) {
            solid--;
        }
        const leading: number = solid >= 0 ? type[solid] : -1;
        // Rules LB8 to LB12a.
        if (leading === ZW) {
            return LineBreaker.ALLOWED;
        }
        if (units.joiner[unit - 1] === 1 || after === WJ || before === WJ || before === GL) {
            return LineBreaker.NONE;
        }
        if (after === GL && before !== SP && before !== HY && before !== HH) {
            return LineBreaker.NONE;
        }
        // Rules LB13 to LB17.
        if (after === CL || after === CP || after === EX || after === SY || leading === OP) {
            return LineBreaker.NONE;
        }
        if (leading === QU && (units.flags[solid] & INITIAL_QUOTE) !== 0 && (solid === 0 || this.opensQuote(type[solid - 1]))) {
            return LineBreaker.NONE;
        }
        if (after === QU && (units.flags[unit] & FINAL_QUOTE) !== 0 && (next === -1 || this.closesQuote(next))) {
            return LineBreaker.NONE;
        }
        if (before === SP && after === IS && next === NU) {
            return LineBreaker.ALLOWED;
        }
        if (after === IS || (after === NS && (leading === CL || leading === CP)) || (after === B2 && leading === B2)) {
            return LineBreaker.NONE;
        }
        // Rule LB18.
        if (before === SP) {
            return LineBreaker.ALLOWED;
        }
        return this.breakBetween(units, unit) ? LineBreaker.ALLOWED : LineBreaker.NONE;
    }

    private opensQuote(type: number): boolean {
        return type === BK || type === CR || type === LF || type === NL || type === OP || type === QU || type === GL || type === SP || type === ZW;
    }

    private closesQuote(type: number): boolean {
        return type === SP || type === GL || type === WJ || type === CL || type === QU || type === CP || type === EX || type === IS || type === SY
            || type === BK || type === CR || type === LF || type === NL || type === ZW;
    }

    private breakBetween(units: Units, unit: number): boolean {
        // Rules LB19 to LB31, between two characters that no space separates.
        const type: Uint8Array = units.type;
        const flags: Uint16Array = units.flags;
        const before: number = type[unit - 1];
        const after: number = type[unit];
        const previous: number = unit >= 2 ? type[unit - 2] : -1;
        const next: number = unit + 1 < units.count ? type[unit + 1] : -1;
        const beforeEastAsian: boolean = (flags[unit - 1] & EAST_ASIAN) !== 0;
        const afterEastAsian: boolean = (flags[unit] & EAST_ASIAN) !== 0;
        // Rules LB19 and LB19a.
        if ((after === QU && (flags[unit] & INITIAL_QUOTE) === 0) || (before === QU && (flags[unit - 1] & FINAL_QUOTE) === 0)) {
            return false;
        }
        if (after === QU && (!beforeEastAsian || next === -1 || (flags[unit + 1] & EAST_ASIAN) === 0)) {
            return false;
        }
        if (before === QU && (!afterEastAsian || previous === -1 || (flags[unit - 2] & EAST_ASIAN) === 0)) {
            return false;
        }
        // Rules LB20 to LB22.
        if (after === CB || before === CB) {
            return true;
        }
        const hyphen: boolean = before === HY || before === HH;
        const letter: boolean = after === AL || after === HL;
        if (hyphen && letter && (previous === -1 || previous === BK || previous === CR || previous === LF || previous === NL || previous === SP || previous === ZW
            || previous === CB || previous === GL)) {
            return false;
        }
        if (after === BA || after === HH || after === HY || after === NS || before === BB) {
            return false;
        }
        if ((hyphen && previous === HL && after !== HL) || (before === SY && after === HL) || after === IN) {
            return false;
        }
        // Rules LB23 to LB25.
        const letterBefore: boolean = before === AL || before === HL;
        const affixBefore: boolean = before === PR || before === PO;
        const affixAfter: boolean = after === PR || after === PO;
        if ((letterBefore && after === NU) || (before === NU && letter)) {
            return false;
        }
        if ((before === PR && (after === ID || after === EB || after === EM)) || ((before === ID || before === EB || before === EM) && after === PO)) {
            return false;
        }
        if ((affixBefore && letter) || (letterBefore && affixAfter)) {
            return false;
        }
        if (affixAfter && (this.endsNumber(type, unit - 1) || ((before === CL || before === CP) && this.endsNumber(type, unit - 2)))) {
            return false;
        }
        if (affixBefore && (after === NU || (after === OP && (next === NU || (next === IS && unit + 2 < units.count && type[unit + 2] === NU))))) {
            return false;
        }
        if (after === NU && (before === HY || before === IS || this.endsNumber(type, unit - 1))) {
            return false;
        }
        // Rules LB26 to LB28.
        if ((before === JL && (after === JL || after === JV || after === H2 || after === H3)) || ((before === JV || before === H2) && (after === JV || after === JT))
            || ((before === JT || before === H3) && after === JT)) {
            return false;
        }
        const syllableBefore: boolean = before === JL || before === JV || before === JT || before === H2 || before === H3;
        const syllableAfter: boolean = after === JL || after === JV || after === JT || after === H2 || after === H3;
        if ((syllableBefore && after === PO) || (before === PR && syllableAfter) || (letterBefore && letter)) {
            return false;
        }
        // Rule LB28a, where the dotted circle stands with the aksaras.
        const aksaraBefore: boolean = before === AK || before === AS || units.dotted[unit - 1] === 1;
        const aksaraAfter: boolean = after === AK || after === AS || units.dotted[unit] === 1;
        if ((before === AP && aksaraAfter) || (aksaraBefore && (after === VF || after === VI)) || (aksaraBefore && aksaraAfter && next === VF)) {
            return false;
        }
        if (before === VI && after !== AS && aksaraAfter && unit >= 2 && (previous === AK || previous === AS || units.dotted[unit - 2] === 1)) {
            return false;
        }
        // Rules LB29 to LB30b.
        if (before === IS && letter) {
            return false;
        }
        if ((after === OP && !afterEastAsian && (letterBefore || before === NU)) || (before === CP && !beforeEastAsian && (letter || after === NU))) {
            return false;
        }
        if (before === RI && after === RI) {
            let indicators: number = 0;
            for (let index: number = unit - 1; index >= 0 && type[index] === RI; index--) {
                indicators++;
            }
            if (indicators % 2 === 1) {
                return false;
            }
        }
        return !(after === EM && (before === EB || (flags[unit - 1] & UNASSIGNED_PICTOGRAPH) !== 0));
    }

    private endsNumber(type: Uint8Array, unit: number): boolean {
        // Rule LB25: NU ( SY | IS )* before the position.
        let index: number = unit;
        while (index >= 0 && (type[index] === SY || type[index] === IS)) {
            index--;
        }
        return index >= 0 && type[index] === NU;
    }
}
