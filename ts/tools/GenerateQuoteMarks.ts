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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language } from "typesbcp47";
import { LanguageUtils } from "typesbcp47";

const CLDR_BASE: string = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/";
const LOCALES_URL: string = CLDR_BASE + "cldr-core/availableLocales.json";
const LIKELY_URL: string = CLDR_BASE + "cldr-core/supplemental/likelySubtags.json";
const DELIMITERS_PATH: string = "cldr-misc-full/main/";
const ROOT_LOCALE: string = "und";
const LIST_LOCALE: string = "en";
const BATCH_SIZE: number = 16;
const INVISIBLE: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;

interface Delimiters {
    quotationStart: string;
    quotationEnd: string;
    alternateQuotationStart: string;
    alternateQuotationEnd: string;
}

interface DelimitersFile {
    main: Record<string, { delimiters?: Delimiters }>;
}

interface LocalesFile {
    availableLocales: { full: Array<string> };
}

interface LikelySubtagsFile {
    supplemental: { likelySubtags: Record<string, string> };
}

class QuoteMarksGenerator {

    private readonly outputPath: string;
    private readonly delimiters: Map<string, Promise<ReadonlyArray<string> | undefined>> = new Map<string, Promise<ReadonlyArray<string> | undefined>>();

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const available: ReadonlySet<string> = new Set<string>([ROOT_LOCALE, ...(await this.json<LocalesFile>(LOCALES_URL)).availableLocales.full]);
        const likely: Record<string, string> = (await this.json<LikelySubtagsFile>(LIKELY_URL)).supplemental.likelySubtags;
        // The tags documents are expected to carry are those of the TypesBCP47 extended list, so each of them gets its own row.
        const root: ReadonlyArray<string> | undefined = await this.delimitersOf(ROOT_LOCALE);
        if (root === undefined) {
            throw new Error("The root locale has no delimiters");
        }
        const rows: Map<string, ReadonlyArray<string>> = new Map<string, ReadonlyArray<string>>([[ROOT_LOCALE, root]]);
        const codes: Array<string> = LanguageUtils.getLanguages(LIST_LOCALE).map((language: Language) => language.getCode());
        for (let start: number = 0; start < codes.length; start += BATCH_SIZE) {
            const batch: Array<string> = codes.slice(start, start + BATCH_SIZE);
            const marks: Array<ReadonlyArray<string>> = await Promise.all(batch.map((code: string) => this.marksFor(code, available, likely)));
            marks.forEach((quotes: ReadonlyArray<string>, index: number) => rows.set(batch[index], quotes));
            console.log("Resolved " + Math.min(start + BATCH_SIZE, codes.length) + " of " + codes.length + " languages");
        }
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(rows), "utf8");
    }

    private async marksFor(code: string, available: ReadonlySet<string>, likely: Record<string, string>): Promise<ReadonlyArray<string>> {
        // UTS #35 §4.3: a tag without a locale of its own goes through its likely subtags, so zh-TW becomes zh-Hant-TW; then the
        // BCP 47 lookup drops subtags from the end until a locale with delimiters is found.
        const subtags: Array<string> = (available.has(code) ? code : likely[code] ?? code).split("-");
        while (subtags.length > 0) {
            const candidate: string = subtags.join("-");
            if (available.has(candidate)) {
                const quotes: ReadonlyArray<string> | undefined = await this.delimitersOf(candidate);
                if (quotes !== undefined) {
                    return quotes;
                }
            }
            subtags.pop();
        }
        const root: ReadonlyArray<string> | undefined = await this.delimitersOf(ROOT_LOCALE);
        if (root === undefined) {
            throw new Error("The root locale has no delimiters");
        }
        return root;
    }

    private delimitersOf(locale: string): Promise<ReadonlyArray<string> | undefined> {
        let pending: Promise<ReadonlyArray<string> | undefined> | undefined = this.delimiters.get(locale);
        if (pending === undefined) {
            pending = this.json<DelimitersFile>(CLDR_BASE + DELIMITERS_PATH + locale + "/delimiters.json").then((file: DelimitersFile) => {
                const delimiters: Delimiters | undefined = file.main[locale]?.delimiters;
                return delimiters === undefined ? undefined
                    : [delimiters.quotationStart, delimiters.quotationEnd, delimiters.alternateQuotationStart, delimiters.alternateQuotationEnd];
            });
            this.delimiters.set(locale, pending);
        }
        return pending;
    }

    private async json<T>(url: string): Promise<T> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return await response.json() as T;
    }

    private render(marks: ReadonlyMap<string, ReadonlyArray<string>>): string {
        const rows: Array<string> = [...marks].map(([locale, quotes]: [string, ReadonlyArray<string>]) => "    [" + [locale, ...quotes].map((text: string) => this.literal(text)).join(", ") + "]");
        const header: string =
            "/*******************************************************************************\n" +
            " * Copyright (c) 2026 Maxprograms. All rights reserved.\n" +
            " *\n" +
            " * Licensed under the Business Source License 1.1 (the \"License\");\n" +
            " * you may not use this file except in compliance with the License.\n" +
            " *\n" +
            " * Change Date: 2030-11-01\n" +
            " * Change License: Mozilla Public License, v. 2.0\n" +
            " *\n" +
            " * Additional Use Grant:\n" +
            " * You may make production use of the Licensed Work for personal use,\n" +
            " * educational use, and academic research. \"Personal use\" means use by an\n" +
            " * individual for their own purposes, and not on behalf of an employer, client\n" +
            " * or other organization. You may also make production use of the Licensed Work\n" +
            " * for trial purposes for a period of up to 30 days.\n" +
            " *\n" +
            " * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html\n" +
            " * or in the LICENSE file provided in the root of this repository.\n" +
            " *******************************************************************************/\n\n";
        return header + "export const QUOTE_MARKS: ReadonlyArray<readonly [string, string, string, string, string]> = [\n" + rows.join(",\n") + "\n];\n";
    }

    private literal(text: string): string {
        // Invisible characters (control, format and space characters other than the plain space) are written as escapes.
        let escaped: string = "";
        for (const character of JSON.stringify(text)) {
            if (character !== " " && INVISIBLE.test(character)) {
                for (let index: number = 0; index < character.length; index++) {
                    escaped += "\\u" + character.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
                }
            } else {
                escaped += character;
            }
        }
        return escaped;
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new QuoteMarksGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "QuoteMarks.ts")).run();
    console.log("Generated ts/pdf/generated/QuoteMarks.ts");
} catch (error) {
    console.error("Error generating the quotation marks:", error);
    process.exitCode = 1;
}
