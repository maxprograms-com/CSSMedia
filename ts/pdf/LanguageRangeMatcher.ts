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

import type { RegistryEntry } from "typesbcp47";
import { LanguageUtils, RegistryParser } from "typesbcp47";
import { AsciiCase } from "../css/AsciiCase.js";

interface CanonicalTables {
    wholeTags: Map<string, string>;
    preferred: Map<string, string>;
    extlangPrefixes: Map<string, string>;
}

const WILDCARD: string = "*";
const PRIVATE_USE: string = "x";

export class LanguageRangeMatcher {

    private static tables?: CanonicalTables;

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly canonical: Map<string, Array<string>> = new Map<string, Array<string>>();

    matches(language: string, range: string): boolean {
        // Selectors 4 §7.2: an empty range matches only untagged content, and "*" never does.
        if (language.length === 0 || range.length === 0) {
            return language.length === 0 && range.length === 0;
        }
        return this.extendedFilter(this.canonicalize(language), this.canonicalize(range));
    }

    private extendedFilter(tag: ReadonlyArray<string>, range: ReadonlyArray<string>): boolean {
        // BCP 47 (RFC 4647 §3.3.2), extended filtering.
        if (range[0] !== WILDCARD && range[0] !== tag[0]) {
            return false;
        }
        let rangeIndex: number = 1;
        let tagIndex: number = 1;
        while (rangeIndex < range.length) {
            if (range[rangeIndex] === WILDCARD) {
                rangeIndex++;
            } else if (tagIndex >= tag.length) {
                return false;
            } else if (range[rangeIndex] === tag[tagIndex]) {
                rangeIndex++;
                tagIndex++;
            } else if (tag[tagIndex].length === 1) {
                return false;
            } else {
                tagIndex++;
            }
        }
        return true;
    }

    private canonicalize(text: string): Array<string> {
        // Selectors 4 §7.2: both sides are canonicalized and put in extlang form (BCP 47, RFC 5646 §4.5) before filtering;
        // the comparison ignores ASCII case, so everything is kept in lowercase.
        let subtags: Array<string> | undefined = this.canonical.get(text);
        if (subtags !== undefined) {
            return subtags;
        }
        const tables: CanonicalTables = this.canonicalTables();
        const lower: string = this.asciiCase.foldLower(text);
        subtags = (tables.wholeTags.get(lower) ?? lower).split("-");
        if (subtags[0].length !== 1 || subtags[0] === WILDCARD) {
            if (subtags.length > 1 && tables.extlangPrefixes.get(subtags[1]) === subtags[0]) {
                subtags.splice(0, 2, tables.preferred.get("extlang:" + subtags[1]) ?? subtags[1]);
            }
            subtags = this.replaceSubtags(subtags, tables);
            const prefix: string | undefined = subtags[0] === WILDCARD ? undefined : tables.extlangPrefixes.get(subtags[0]);
            if (prefix !== undefined) {
                subtags.unshift(prefix);
            }
        }
        this.canonical.set(text, subtags);
        return subtags;
    }

    private replaceSubtags(subtags: Array<string>, tables: CanonicalTables): Array<string> {
        // RFC 5646 §4.5: subtags with a Preferred-Value are replaced, and extension sequences are ordered by their singleton.
        let end: number = subtags.findIndex((subtag: string, index: number) => index > 0 && subtag.length === 1 && subtag !== WILDCARD);
        if (end === -1) {
            end = subtags.length;
        }
        const main: Array<string> = subtags.slice(0, end).flatMap((subtag: string, index: number) => {
            const type: string = index === 0 ? "language" : this.typeOf(subtag);
            return subtag === WILDCARD || type === "extlang" ? [subtag] : (tables.preferred.get(type + ":" + subtag) ?? subtag).split("-");
        });
        const extensions: Array<Array<string>> = [];
        let privateUse: Array<string> = [];
        let index: number = end;
        while (index < subtags.length) {
            if (subtags[index] === PRIVATE_USE) {
                privateUse = subtags.slice(index);
                break;
            }
            const sequence: Array<string> = [subtags[index++]];
            while (index < subtags.length && (subtags[index].length > 1 || subtags[index] === WILDCARD)) {
                sequence.push(subtags[index++]);
            }
            extensions.push(sequence);
        }
        extensions.sort((first: Array<string>, second: Array<string>) => first[0] < second[0] ? -1 : (first[0] > second[0] ? 1 : 0));
        return [...main, ...extensions.flat(), ...privateUse];
    }

    private typeOf(subtag: string): string {
        // RFC 5646 §2.2: extlangs have three letters, scripts four, regions two letters or three digits; the rest are variants.
        if (/^[a-z]{3}$/.test(subtag)) {
            return "extlang";
        }
        if (/^[a-z]{4}$/.test(subtag)) {
            return "script";
        }
        if (/^(?:[a-z]{2}|[0-9]{3})$/.test(subtag)) {
            return "region";
        }
        return "variant";
    }

    private canonicalTables(): CanonicalTables {
        if (LanguageRangeMatcher.tables === undefined) {
            // The registry parsed by LanguageUtils is shared, so it is read only once.
            if (!LanguageUtils.registryParser) {
                LanguageUtils.registryParser = new RegistryParser();
            }
            const tables: CanonicalTables = { wholeTags: new Map<string, string>(), preferred: new Map<string, string>(), extlangPrefixes: new Map<string, string>() };
            for (const entry of LanguageUtils.registryParser.entries) {
                this.addEntry(entry, tables);
            }
            LanguageRangeMatcher.tables = tables;
        }
        return LanguageRangeMatcher.tables;
    }

    private addEntry(entry: RegistryEntry, tables: CanonicalTables): void {
        const type: string | undefined = entry.getType();
        const preferred: string | undefined = entry.get("Preferred-Value");
        if (type === "grandfathered" || type === "redundant") {
            const tag: string | undefined = entry.get("Tag");
            if (tag !== undefined && preferred !== undefined) {
                tables.wholeTags.set(this.asciiCase.foldLower(tag), this.asciiCase.foldLower(preferred));
            }
            return;
        }
        const subtag: string | undefined = entry.get("Subtag");
        if (type === undefined || subtag === undefined) {
            return;
        }
        const key: string = this.asciiCase.foldLower(subtag);
        const prefix: string | undefined = entry.get("Prefix");
        if (type === "extlang" && prefix !== undefined) {
            tables.extlangPrefixes.set(key, this.asciiCase.foldLower(prefix));
        }
        if (preferred !== undefined) {
            tables.preferred.set(type + ":" + key, this.asciiCase.foldLower(preferred));
        }
    }
}
