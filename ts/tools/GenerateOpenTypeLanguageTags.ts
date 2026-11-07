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
import { LanguageUtils, RegistryParser } from "typesbcp47";

const REGISTRY_URL: string = "https://learn.microsoft.com/en-us/typography/opentype/spec/languagetags";
const LIKELY_URL: string = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/likelySubtags.json";
const SCRIPT: RegExp = /^[A-Za-z]{4}$/;
const REGISTRY_ROW: RegExp = /<tr>\s*<td>(.*?)<\/td>\s*<td>'?(.*?)'?<\/td>\s*<td>(.*?)<\/td>/gs;
const ISO_LIST: RegExp = /^[a-z]{3}(?:,\s*[a-z]{3})*(?![a-z])/;
const NO_BREAK_SPACE: string = "\u00A0";
const WRITTEN_FORMS: Readonly<Record<string, string>> = {
    "ZHS ": "zh-Hans", "ZHT ": "zh-Hant", "ZHH ": "zh-Hant-HK", "ZHTM": "zh-Hant-MO", "PGR ": "el-polyton", "IRT ": "ga-Latg", "KGE ": "ka-Geok",
    "HYE0": "hy-arevela"
};

interface LikelySubtagsFile {
    supplemental: { likelySubtags: Record<string, string> };
}

class OpenTypeLanguageTagGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const rows: Map<string, Array<string>> = this.registry(await this.fetchText(REGISTRY_URL), this.macrolanguages());
        const scripts: Map<string, string> = this.likelyScripts((JSON.parse(await this.fetchText(LIKELY_URL)) as LikelySubtagsFile).supplemental.likelySubtags);
        console.log(rows.size + " OpenType language system tags have a BCP 47 language tag");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(rows, scripts), "utf8");
    }

    private likelyScripts(likely: Readonly<Record<string, string>>): Map<string, string> {
        // UTS #35 §4.3: the likely subtags give the script of a tag that does not state it, as Hant for zh-TW. They are kept
        // for the languages that have a language system of their own for one of their scripts.
        const languages: Set<string> = new Set<string>(Object.values(WRITTEN_FORMS).filter((tag: string) => tag.split("-").some((subtag: string) => SCRIPT.test(subtag)))
            .map((tag: string) => tag.split("-")[0]));
        const scripts: Map<string, string> = new Map<string, string>();
        for (const [tag, full] of Object.entries(likely)) {
            const subtags: Array<string> = tag.split("-");
            const script: string | undefined = full.split("-").find((subtag: string) => SCRIPT.test(subtag));
            if (languages.has(subtags[0]) && script !== undefined && !subtags.some((subtag: string) => SCRIPT.test(subtag))) {
                scripts.set(tag.toLowerCase(), script.toLowerCase());
            }
        }
        return scripts;
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private subtag(identifier: string): string {
        // BCP 47 uses the two-letter code of a language that has one. An ISO 639-3 identifier that the registry does not
        // list is such a language, and canonicalization gives its subtag.
        if (LanguageUtils.isValidLanguageTag(identifier)) {
            return identifier;
        }
        try {
            return Intl.getCanonicalLocales(identifier)[0];
        } catch {
            return identifier;
        }
    }

    private macrolanguages(): Map<string, string> {
        // BCP 47 registry: a language records the macrolanguage that covers it. Each key is the name of a macrolanguage
        // followed by the subtag of a language it covers, and the value is the subtag of the macrolanguage.
        if (!LanguageUtils.registryParser) {
            LanguageUtils.registryParser = new RegistryParser();
        }
        const covered: Map<string, string> = new Map<string, string>();
        for (const entry of LanguageUtils.registryParser.entries) {
            const subtag: string | undefined = entry.getSubtag();
            const macrolanguage: string | undefined = entry.get("Macrolanguage");
            const name: string | undefined = macrolanguage === undefined ? undefined : LanguageUtils.registryParser.languages.get(macrolanguage)?.getDescription();
            if (entry.getType() === "language" && subtag !== undefined && macrolanguage !== undefined && name !== undefined) {
                covered.set(name.toLowerCase() + "|" + subtag, macrolanguage);
            }
        }
        return covered;
    }

    private registry(html: string, macrolanguages: ReadonlyMap<string, string>): Map<string, Array<string>> {
        // OpenType language system tags: the third column starts with the ISO 639 identifiers of the languages a tag stands
        // for; a tag that stands for no language has none, and nothing is mapped for it.
        const rows: Map<string, Array<string>> = new Map<string, Array<string>>();
        for (const match of html.matchAll(REGISTRY_ROW)) {
            const name: string = match[1].replace(/<[^>]*>/g, "").trim().toLowerCase();
            const tag: string = match[2].replace(/&nbsp;/g, " ").replaceAll(NO_BREAK_SPACE, " ");
            const languages: RegExpExecArray | null = ISO_LIST.exec(match[3].replace(/<[^>]*>/g, "").trim());
            if (tag.length !== 4 || languages === null) {
                continue;
            }
            const listed: Array<string> = languages[0].split(/,\s*/).map((identifier: string) => this.subtag(identifier));
            // A system named as a macrolanguage stands for it too, when it lists a language that the macrolanguage covers:
            // "Norwegian" is registered with the identifier of Norwegian Bokmal.
            for (const language of [...listed]) {
                const macrolanguage: string | undefined = macrolanguages.get(name + "|" + language);
                if (macrolanguage !== undefined && !listed.includes(macrolanguage)) {
                    listed.push(macrolanguage);
                }
            }
            const written: string | undefined = WRITTEN_FORMS[tag];
            const tags: Array<string> = [];
            for (const language of listed) {
                const mapped: string = written !== undefined && written.startsWith(language + "-") ? written : language;
                if (LanguageUtils.isValidLanguageTag(mapped) && !tags.includes(mapped)) {
                    tags.push(mapped);
                }
            }
            if (tags.length > 0) {
                rows.set(tag, tags);
            }
        }
        return rows;
    }

    private render(rows: ReadonlyMap<string, ReadonlyArray<string>>, scripts: ReadonlyMap<string, string>): string {
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
        const lines: Array<string> = [...rows.keys()].sort().map((tag: string) =>
            "    \"" + tag + "\": [" + (rows.get(tag) as ReadonlyArray<string>).map((language: string) => "\"" + language + "\"").join(", ") + "]");
        const scriptLines: Array<string> = [...scripts.keys()].sort().map((tag: string) => "    \"" + tag + "\": \"" + scripts.get(tag) + "\"");
        return header + "export const OPENTYPE_LANGUAGE_TAGS: Readonly<Record<string, ReadonlyArray<string>>> = {\n" + lines.join(",\n") + "\n};\n\n"
            + "export const LIKELY_SCRIPTS: Readonly<Record<string, string>> = {\n" + scriptLines.join(",\n") + "\n};\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new OpenTypeLanguageTagGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "OpenTypeLanguageTags.ts")).run();
    console.log("Generated ts/fonts/generated/OpenTypeLanguageTags.ts");
} catch (error) {
    console.error("Error generating the OpenType language tags table:", error);
    process.exitCode = 1;
}
