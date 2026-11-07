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

import { SCRIPT_EXTENSIONS, SCRIPT_RANGES, SCRIPTS } from "../generated/Scripts.js";

const BMP_SIZE: number = 0x10000;

export class ScriptTags {

    private static shared?: { bmp: Uint16Array; starts: Array<number>; ends: Array<number>; scripts: Array<number>; common: number; inherited: number };

    readonly common: number;
    readonly inherited: number;

    private readonly bmp: Uint16Array;
    private readonly starts: Array<number>;
    private readonly ends: Array<number>;
    private readonly scripts: Array<number>;

    constructor() {
        // The tables are built once and shared, since every stage that looks at scripts has its own instance.
        if (ScriptTags.shared === undefined) {
            const bmp: Uint16Array = new Uint16Array(BMP_SIZE);
            const starts: Array<number> = [];
            const ends: Array<number> = [];
            const scripts: Array<number> = [];
            for (const [start, end, script] of SCRIPT_RANGES) {
                if (start < BMP_SIZE) {
                    bmp.fill(script, start, Math.min(end, BMP_SIZE - 1) + 1);
                }
                if (end >= BMP_SIZE) {
                    starts.push(Math.max(start, BMP_SIZE));
                    ends.push(end);
                    scripts.push(script);
                }
            }
            ScriptTags.shared = { bmp, starts, ends, scripts, common: ScriptTags.indexOf("Zyyy"), inherited: ScriptTags.indexOf("Zinh") };
        }
        this.bmp = ScriptTags.shared.bmp;
        this.starts = ScriptTags.shared.starts;
        this.ends = ScriptTags.shared.ends;
        this.scripts = ScriptTags.shared.scripts;
        this.common = ScriptTags.shared.common;
        this.inherited = ScriptTags.shared.inherited;
    }

    static indexOf(code: string): number {
        return SCRIPTS.findIndex((script: readonly [string, ReadonlyArray<string>, boolean]) => script[0] === code);
    }

    scriptOf(codepoint: number): number {
        // UAX #24 §2.1: a code point that the data does not list has the script Unknown, which is index 0.
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
                return this.scripts[middle];
            }
        }
        return 0;
    }

    extensionsOf(codepoint: number): ReadonlyArray<number> | undefined {
        // UAX #24 §2.2: the scripts a character is used with, listed only where they differ from its Script value.
        let low: number = 0;
        let high: number = SCRIPT_EXTENSIONS.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < SCRIPT_EXTENSIONS[middle][0]) {
                high = middle - 1;
            } else if (codepoint > SCRIPT_EXTENSIONS[middle][1]) {
                low = middle + 1;
            } else {
                return SCRIPT_EXTENSIONS[middle][2];
            }
        }
        return undefined;
    }

    openTypeTagsOf(script: number): ReadonlyArray<string> {
        return SCRIPTS[script][1];
    }

    isJoining(script: number): boolean {
        return SCRIPTS[script]?.[2] === true;
    }
}
