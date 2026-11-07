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

import { JOINING_TYPES } from "../generated/JoiningTypes.js";

const NON_JOINING: string = "U";
const TRANSPARENT: string = "T";
const ALAPH: number = 0x0710;
const DALATH_RISH: ReadonlyArray<number> = [0x0715, 0x0716, 0x072A];

export class ArabicJoining {

    private readonly starts: Array<number> = [];
    private readonly ends: Array<number> = [];
    private readonly types: Array<string> = [];

    constructor() {
        for (const [start, end, type] of JOINING_TYPES) {
            this.starts.push(start);
            this.ends.push(end);
            this.types.push(type);
        }
    }

    joiningTypeOf(codepoint: number): string {
        let low: number = 0;
        let high: number = this.starts.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < this.starts[middle]) {
                high = middle - 1;
            } else if (codepoint > this.ends[middle]) {
                low = middle + 1;
            } else {
                return this.types[middle];
            }
        }
        return NON_JOINING;
    }

    formsOf(codepoints: ReadonlyArray<number>): Array<string> {
        const types: Array<string> = codepoints.map((codepoint: number) => this.joiningTypeOf(codepoint));
        const joinsPrevious: Array<boolean> = new Array<boolean>(codepoints.length).fill(false);
        const joinsNext: Array<boolean> = new Array<boolean>(codepoints.length).fill(false);
        let previous: number = -1;
        for (let index: number = 0; index < codepoints.length; index++) {
            const type: string = types[index];
            if (type === TRANSPARENT) {
                continue;
            }
            if (type === NON_JOINING) {
                previous = -1;
                continue;
            }
            if (previous >= 0 && this.joinsForward(types[previous]) && this.joinsBackward(type)) {
                joinsPrevious[index] = true;
                joinsNext[previous] = true;
            }
            previous = index;
        }
        return types.map((type: string, index: number): string => {
            if (type === TRANSPARENT || type === NON_JOINING) {
                return "";
            }
            if (codepoints[index] === ALAPH) {
                return this.alaphForm(codepoints, types, index, joinsPrevious[index]);
            }
            if (joinsPrevious[index]) {
                return joinsNext[index] ? "medial" : "final";
            }
            return joinsNext[index] ? "initial" : "isolated";
        });
    }

    private alaphForm(codepoints: ReadonlyArray<number>, types: ReadonlyArray<string>, index: number, joined: boolean): string {
        // Syriac shaping engine: fin2 for an Alaph at the end of a word "when the preceding base character cannot be joined
        // to", fin3 when that character is a Dalath or a Rish, and med2 for a joined Alaph in the middle of a word.
        const neighbor: (step: number) => number = (step: number): number => {
            let position: number = index + step;
            while (position >= 0 && position < types.length && types[position] === TRANSPARENT) {
                position += step;
            }
            return position >= 0 && position < types.length && types[position] !== NON_JOINING ? position : -1;
        };
        const previous: number = neighbor(-1);
        if (neighbor(1) >= 0) {
            return joined ? "medial2" : "isolated";
        }
        if (joined || previous < 0) {
            return joined ? "final" : "isolated";
        }
        return DALATH_RISH.includes(codepoints[previous]) ? "final3" : "final2";
    }

    private joinsForward(type: string): boolean {
        return type === "D" || type === "L" || type === "C";
    }

    private joinsBackward(type: string): boolean {
        return type === "D" || type === "R" || type === "C";
    }
}
