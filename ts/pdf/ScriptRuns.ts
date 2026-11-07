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

import { ScriptTags } from "../fonts/layout/ScriptTags.js";
import type { UnicodeBidi } from "./UnicodeBidi.js";

const MARK: RegExp = /^\p{M}$/u;
const UNRESOLVED: number = -1;

export class ScriptRuns {

    private readonly scripts: ScriptTags = new ScriptTags();
    private readonly bidi: UnicodeBidi;

    constructor(bidi: UnicodeBidi) {
        this.bidi = bidi;
    }

    resolve(codepoints: ReadonlyArray<number>): Uint16Array {
        // UAX #24 §5.1: "programs must resolve any of the special Script property values, such as Common, based on the context
        // of the surrounding characters. A simple heuristic uses the script of the preceding character".
        const count: number = codepoints.length;
        const result: Uint16Array = new Uint16Array(count);
        const common: number = this.scripts.common;
        const inherited: number = this.scripts.inherited;
        const openers: Array<number> = [];
        const closers: Array<number> = [];
        let current: number = UNRESOLVED;
        for (let index: number = 0; index < count; index++) {
            const code: number = codepoints[index];
            let script: number = this.scripts.scriptOf(code);
            if (script === common || script === inherited) {
                script = this.fromContext(code, script === common, current, index, result, openers, closers);
            } else if (current !== UNRESOLVED && script !== current && MARK.test(String.fromCodePoint(code))) {
                // §5.2: "treat all the characters of a combining character sequence, including spacing combining marks, as
                // having the Script property value of the first character in the sequence".
                script = current;
            }
            if (script === UNRESOLVED) {
                continue;
            }
            if (current === UNRESOLVED) {
                // The characters before the first one with a script of its own take that script.
                result.fill(script, 0, index);
            }
            result[index] = script;
            current = script;
        }
        return current === UNRESOLVED ? result.fill(common) : result;
    }

    private fromContext(code: number, isCommon: boolean, current: number, index: number, result: Uint16Array, openers: Array<number>, closers: Array<number>): number {
        // UAX #24 §5.1: "opening and closing elements of a pair resolve to the same Script property values, where possible".
        const match: number = closers.lastIndexOf(code);
        if (match >= 0) {
            const opener: number = openers[match];
            openers.length = match;
            closers.length = match;
            return current === UNRESOLVED ? UNRESOLVED : result[opener];
        }
        const closing: number | undefined = this.bidi.closingBracketOf(code);
        if (closing !== undefined) {
            openers.push(index);
            closers.push(closing);
        }
        // §5.3: a character used with several scripts continues a run of one of them, and no other: "U+30FC ... should not
        // continue a Latin script run, but instead should only continue runs of certain scripts".
        const extensions: ReadonlyArray<number> | undefined = isCommon ? this.scripts.extensionsOf(code) : undefined;
        return extensions === undefined || extensions.includes(current) ? current : extensions[0];
    }
}
