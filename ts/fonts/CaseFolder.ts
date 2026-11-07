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

import { CASE_FOLDING } from "./generated/CaseFolding.js";

export class CaseFolder {

    private readonly foldings: Map<number, string> = new Map<number, string>();

    constructor() {
        for (const entry of CASE_FOLDING) {
            this.foldings.set(entry[0], String.fromCodePoint(...entry[1]));
        }
    }

    fold(text: string): string {
        // Unicode §3.13 Default Caseless Matching, without normalization or language tailoring (CSS Fonts 4 §5.1).
        let folded: string = "";
        for (const character of text) {
            folded += this.foldings.get(character.codePointAt(0) as number) ?? character;
        }
        return folded;
    }
}
