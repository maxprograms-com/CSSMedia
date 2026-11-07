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

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language } from "typesbcp47";
import { LanguageUtils } from "typesbcp47";

const LISTING_URL: string = "https://api.github.com/repos/hyphenation/tex-hyphen/contents/hyph-utf8/tex/generic/hyph-utf8/patterns/txt";
const PATTERNS_URL: string = "https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/";
const MINIMUMS: RegExp = /typesetting:\s*\n%\s*left:\s*(\d+)\s*\n%\s*right:\s*(\d+)/;
const LICENCE_BLOCK: RegExp = /^% licen[cs]e:.*\n((?:%(?: {2,}.*)?\n)*)/m;
const LICENCE_NAME: RegExp = /^% +-? *name: *(.+)$/gm;
const COPYLEFT: RegExp = /^L?GPL$/;
const LIST_LOCALE: string = "en";
const BATCH_SIZE: number = 8;
const SUGGESTED_MINIMUM: number = 2;
const PREFERRED_SETS: Readonly<Record<string, string>> = {
    "de": "de-1996", "de-ch": "de-ch-1901", "en": "en-us", "el": "el-monoton", "bs": "sh-latn", "sh": "sh-latn", "sr": "sh-cyrl", "sr-cyrl": "sh-cyrl", "sr-latn": "sh-latn",
    "no": "nb", "mn": "mn-cyrl"
};

interface DirectoryEntry {
    name: string;
}

interface PatternSet {
    code: string;
    patterns: string;
    exceptions: string;
    leftMin: number;
    rightMin: number;
    licences: Array<string>;
}

class HyphenationPatternGenerator {

    private readonly setsDirectory: string;
    private readonly indexPath: string;

    constructor(setsDirectory: string, indexPath: string) {
        this.setsDirectory = setsDirectory;
        this.indexPath = indexPath;
    }

    async run(): Promise<void> {
        const names: Array<string> = (await (await this.fetchOk(LISTING_URL)).json() as Array<DirectoryEntry>).map((entry: DirectoryEntry) => entry.name);
        const listed: Array<string> = this.codesOf(names, ".pat.txt");
        const codes: Array<string> = listed.filter((code: string) => LanguageUtils.isValidLanguageTag(code));
        console.log("Skipping the pattern sets whose name is not a valid language tag: " + listed.filter((code: string) => !codes.includes(code)).join(", "));
        const withExceptions: Set<string> = new Set<string>(this.codesOf(names, ".hyp.txt"));
        const fetched: Array<PatternSet> = [];
        for (let start: number = 0; start < codes.length; start += BATCH_SIZE) {
            const batch: Array<string> = codes.slice(start, start + BATCH_SIZE);
            fetched.push(...await Promise.all(batch.map((code: string) => this.fetchSet(code, withExceptions.has(code)))));
            console.log("Fetched " + Math.min(start + BATCH_SIZE, codes.length) + " of " + codes.length + " pattern sets");
        }
        // A set whose header offers only the GPL or the LGPL cannot be shipped in this product, so it is left out.
        const sets: Array<PatternSet> = fetched.filter((set: PatternSet) => set.licences.length === 0 || !set.licences.every((name: string) => COPYLEFT.test(name)));
        for (const set of fetched) {
            console.log(set.code + ": " + (set.licences.length === 0 ? "stated in the header of its TeX file" : set.licences.join(", ")) + (sets.includes(set) ? "" : " (left out)"));
        }
        mkdirSync(this.setsDirectory, { recursive: true });
        for (const stale of readdirSync(this.setsDirectory).filter((name: string) => name.endsWith(".ts"))) {
            rmSync(join(this.setsDirectory, stale));
        }
        for (const set of sets) {
            writeFileSync(join(this.setsDirectory, set.code + ".ts"), this.renderSet(set), "utf8");
        }
        writeFileSync(this.indexPath, this.renderIndex(this.languages(new Set<string>(sets.map((set: PatternSet) => set.code)))), "utf8");
    }

    private codesOf(names: ReadonlyArray<string>, suffix: string): Array<string> {
        return names.filter((name: string) => name.endsWith(suffix)).map((name: string) => name.slice("hyph-".length, -suffix.length)).sort();
    }

    private languages(sets: ReadonlySet<string>): Map<string, string> {
        // The tags documents are expected to carry are those of the TypesBCP47 extended list, so each of them gets its own row:
        // the set named as the tag, or the one preferred for it, or else that of the tag with its last subtag dropped.
        const rows: Map<string, string> = new Map<string, string>();
        for (const code of LanguageUtils.getLanguages(LIST_LOCALE).map((language: Language) => language.getCode())) {
            let tag: string = code.toLowerCase();
            while (tag.length > 0) {
                const set: string | undefined = sets.has(tag) ? tag : PREFERRED_SETS[tag];
                if (set !== undefined && sets.has(set)) {
                    rows.set(code.toLowerCase(), set);
                    break;
                }
                const cut: number = tag.lastIndexOf("-");
                tag = cut === -1 ? "" : tag.slice(0, cut);
            }
        }
        return rows;
    }

    private async fetchSet(code: string, hasExceptions: boolean): Promise<PatternSet> {
        const patterns: string = this.wordsOf(await (await this.fetchOk(PATTERNS_URL + "txt/hyph-" + code + ".pat.txt")).text());
        const exceptions: string = hasExceptions ? this.wordsOf(await (await this.fetchOk(PATTERNS_URL + "txt/hyph-" + code + ".hyp.txt")).text()) : "";
        // The header of the TeX file of a set gives the letters to keep on each side of a hyphen when typesetting, and its licence;
        // without them, CSS Text 4 §6.3.4 suggests "2 for before and after".
        const source: string = await (await this.fetchOk(PATTERNS_URL + "tex/hyph-" + code + ".tex")).text();
        const minimums: RegExpExecArray | null = MINIMUMS.exec(source);
        return {
            code, patterns, exceptions,
            leftMin: minimums === null ? SUGGESTED_MINIMUM : Number(minimums[1]),
            rightMin: minimums === null ? SUGGESTED_MINIMUM : Number(minimums[2]),
            licences: [...(LICENCE_BLOCK.exec(source)?.[1] ?? "").matchAll(LICENCE_NAME)].map((match: RegExpMatchArray) => match[1].trim())
        };
    }

    private wordsOf(text: string): string {
        return text.split(/\r?\n/).map((line: string) => line.trim()).filter((line: string) => line.length > 0 && !line.startsWith("%")).join(" ");
    }

    private async fetchOk(url: string): Promise<Response> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response;
    }

    private header(): string {
        return "/*******************************************************************************\n" +
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
    }

    private literal(text: string): string {
        return JSON.stringify(text).replace(/[\u0080-￿]/g, (character: string) => "\\u" + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
    }

    private renderSet(set: PatternSet): string {
        return this.header() +
            "export const PATTERNS: string = " + this.literal(set.patterns) + ";\n\n" +
            "export const EXCEPTIONS: string = " + this.literal(set.exceptions) + ";\n\n" +
            "export const LEFT_MIN: number = " + set.leftMin + ";\n\n" +
            "export const RIGHT_MIN: number = " + set.rightMin + ";\n";
    }

    private renderIndex(rows: ReadonlyMap<string, string>): string {
        const lines: Array<string> = [...rows.keys()].sort().map((code: string) => "    \"" + code + "\": \"" + rows.get(code) + "\"");
        return this.header() + "export const HYPHENATION_SETS: Readonly<Record<string, string>> = {\n" + lines.join(",\n") + "\n};\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERATED: string = join(PACKAGE_ROOT, "ts", "pdf", "generated");
try {
    await new HyphenationPatternGenerator(join(GENERATED, "hyphenation"), join(GENERATED, "HyphenationSets.ts")).run();
    console.log("Generated ts/pdf/generated/hyphenation and ts/pdf/generated/HyphenationSets.ts");
} catch (error) {
    console.error("Error generating the hyphenation patterns:", error);
    process.exitCode = 1;
}
