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

import { LIKELY_SCRIPTS, OPENTYPE_LANGUAGE_TAGS } from "../generated/OpenTypeLanguageTags.js";

interface Candidate {
    tag: string;
    subtags: ReadonlyArray<string>;
    breadth: number;
}

const SCRIPT: RegExp = /^[a-z]{4}$/;
const REGION: RegExp = /^(?:[a-z]{2}|\d{3})$/;

export class LanguageSystems {

    private readonly candidates: Map<string, Array<Candidate>> = new Map<string, Array<Candidate>>();
    private readonly resolved: Map<string, ReadonlyArray<string>> = new Map<string, ReadonlyArray<string>>();
    private unresolved?: Set<string>;

    constructor() {
        for (const [tag, languages] of Object.entries(OPENTYPE_LANGUAGE_TAGS)) {
            for (const language of languages) {
                const subtags: Array<string> = language.toLowerCase().split("-");
                const candidate: Candidate = { tag, subtags: subtags.slice(1), breadth: languages.length };
                const list: Array<Candidate> | undefined = this.candidates.get(subtags[0]);
                if (list === undefined) {
                    this.candidates.set(subtags[0], [candidate]);
                } else {
                    list.push(candidate);
                }
            }
        }
    }

    tagsOf(language: string): ReadonlyArray<string> | undefined {
        // CSS Fonts 4 §7.2: "The language specified by the inherited value of lang/xml:lang is applied." The system that shares
        // most subtags with the tag comes first, and a system for one language before one for a collection of languages.
        let tags: ReadonlyArray<string> | undefined = this.resolved.get(language);
        if (tags === undefined && this.unresolved?.has(language) !== true) {
            tags = this.resolve(this.canonical(language).toLowerCase().split("-"));
            if (tags === undefined) {
                this.unresolved = this.unresolved ?? new Set<string>();
                this.unresolved.add(language);
            } else {
                this.resolved.set(language, tags);
            }
        }
        return tags;
    }

    private canonical(language: string): string {
        // The map holds canonical tags, so a tag written with a replaced code, as tl for fil or mo for ro, is canonicalized too.
        try {
            return Intl.getCanonicalLocales(language)[0];
        } catch {
            return language;
        }
    }

    private resolve(subtags: Array<string>): ReadonlyArray<string> | undefined {
        const candidates: Array<Candidate> | undefined = this.candidates.get(subtags[0]);
        if (candidates === undefined) {
            return undefined;
        }
        const stated: Array<string> = subtags.slice(1);
        if (!stated.some((subtag: string) => SCRIPT.test(subtag))) {
            // UTS #35 §4.3: a tag without a script takes the likely script of the language in its region, or of the language.
            const region: string | undefined = stated.find((subtag: string) => REGION.test(subtag));
            const script: string | undefined = (region === undefined ? undefined : LIKELY_SCRIPTS[subtags[0] + "-" + region]) ?? LIKELY_SCRIPTS[subtags[0]];
            if (script !== undefined) {
                stated.push(script);
            }
        }
        const matching: Array<Candidate> = candidates.filter((candidate: Candidate) => candidate.subtags.every((subtag: string) => stated.includes(subtag)));
        if (matching.length === 0) {
            return undefined;
        }
        return matching.sort((first: Candidate, second: Candidate) => second.subtags.length - first.subtags.length || first.breadth - second.breadth)
            .map((candidate: Candidate) => candidate.tag);
    }
}
