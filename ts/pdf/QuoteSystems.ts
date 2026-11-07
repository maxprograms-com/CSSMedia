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

import { LanguageUtils } from "typesbcp47";
import { QUOTE_MARKS } from "./generated/QuoteMarks.js";

export type QuotePair = readonly [string, string];

const ROOT_LOCALE: string = "und";

export class QuoteSystems {

    private readonly marks: Map<string, ReadonlyArray<QuotePair>> = new Map<string, ReadonlyArray<QuotePair>>();
    private readonly resolved: Map<string, ReadonlyArray<QuotePair>> = new Map<string, ReadonlyArray<QuotePair>>();
    readonly diagnostics: Array<string> = [];

    constructor() {
        for (const [locale, start, end, alternateStart, alternateEnd] of QUOTE_MARKS) {
            this.marks.set(locale, [[start, end], [alternateStart, alternateEnd]]);
        }
    }

    forLanguage(language: string): ReadonlyArray<QuotePair> {
        // CSS Content 3 §2.4.1: auto takes the marks of the content language, from CLDR, for the languages of the TypesBCP47 list.
        let marks: ReadonlyArray<QuotePair> | undefined = this.resolved.get(language);
        if (marks === undefined) {
            const code: string | undefined = language.length === 0 ? undefined : LanguageUtils.normalizeCode(language);
            marks = code === undefined ? undefined : this.marks.get(code);
            if (marks === undefined) {
                if (language.length > 0) {
                    this.diagnostics.push("Language \"" + language + "\" is not in the list of supported languages, so quotes: auto uses the default quotation marks");
                }
                marks = this.marks.get(ROOT_LOCALE);
                if (marks === undefined) {
                    throw new Error("The quotation marks data has no root locale");
                }
            }
            this.resolved.set(language, marks);
        }
        return marks;
    }
}
