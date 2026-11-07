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

const UCD_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/";
const CSS_TEXT_URL: string = "https://www.w3.org/TR/css-text-4/";
const MATHML_URL: string = "https://www.w3.org/TR/mathml-core/";
const ENTITIES_URL: string = "https://www.w3.org/TR/xml-entity-names/";
const MATH_VARIANTS: ReadonlyArray<string> = [
    "bold", "italic", "bold-italic", "double-struck", "bold-fraktur", "script", "bold-script", "fraktur", "sans-serif", "bold-sans-serif", "sans-serif-italic",
    "sans-serif-bold-italic", "monospace", "initial", "tailed", "looped", "stretched"
];
const VARIANT_ROW: RegExp = /<tr[^>]*><td>U\+([0-9A-F]{4,6})<\/td><td>U\+([0-9A-F]{4,6})<\/td>/g;
const KANA_SECTION: string = "id=\"small-kana\"";
const ITALIC_SECTION: string = "id=\"italic-mappings\"";
const TABLE_END: string = "</table>";
const CODE_POINT: RegExp = /U\+([0-9A-F]{4,6})/g;
const WIDTH_MAPPING: RegExp = /^<(wide|narrow)> ([0-9A-F]+)$/;
const NAME_FIELD: number = 1;
const DECOMPOSITION_FIELD: number = 5;
const UPPERCASE_FIELD: number = 12;
const TITLECASE_FIELD: number = 14;

interface FullMapping {
    title: Array<number>;
    upper: Array<number>;
}

class TextTransformGenerator {

    private readonly outputPath: string;
    private readonly variantsPath: string;

    constructor(outputPath: string, variantsPath: string) {
        this.outputPath = outputPath;
        this.variantsPath = variantsPath;
    }

    async run(): Promise<void> {
        const characters: Array<Array<string>> = this.records(await this.fetchText(UCD_URL + "UnicodeData.txt"));
        const special: Map<number, FullMapping> = this.specialCasing(await this.fetchText(UCD_URL + "SpecialCasing.txt"));
        const titles: Array<[number, Array<number>]> = this.titlecase(characters, special);
        const widths: Array<[number, number]> = this.fullWidth(characters);
        const kana: Array<[number, number]> = this.pairs(await this.fetchText(CSS_TEXT_URL), KANA_SECTION);
        const italic: Array<[number, number]> = this.pairs(await this.fetchText(MATHML_URL), ITALIC_SECTION);
        if (kana.length === 0 || italic.length === 0) {
            throw new Error("A mapping table of the specifications was not found");
        }
        const variants: Array<[string, Array<[number, number]>]> = [];
        for (const variant of MATH_VARIANTS) {
            const pairs: Array<[number, number]> = this.variantPairs(await this.fetchText(ENTITIES_URL + variant + ".html"));
            if (pairs.length === 0) {
                throw new Error("The " + variant + " table of XML Entity Definitions for Characters was not found");
            }
            variants.push([variant, pairs]);
        }
        console.log("Read " + titles.length + " titlecase, " + widths.length + " full-width, " + kana.length + " small kana, " + italic.length + " italic mappings and "
            + variants.length + " mathvariant tables");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(titles, widths, kana, italic), "utf8");
        // The mathvariant tables belong to the MathML code, which is kept apart from the rest.
        mkdirSync(dirname(this.variantsPath), { recursive: true });
        writeFileSync(this.variantsPath, this.renderVariants(variants), "utf8");
    }

    private variantPairs(html: string): Array<[number, number]> {
        // MathML 4 §3.2.2 and MathML Core Appendix C point to these tables: each row gives the mathematical alphanumeric symbol,
        // then the unstyled character it stands for, the characters of the Letterlike Symbols block included.
        return [...html.matchAll(VARIANT_ROW)].map((match: RegExpMatchArray): [number, number] => [Number.parseInt(match[2], 16), Number.parseInt(match[1], 16)])
            .sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private records(text: string): Array<Array<string>> {
        // UAX #44 §5.7.3: a pair of lines whose names end in "First>" and "Last>" stands for a range, which has no mappings.
        return text.split("\n").map((line: string) => line.split(";")).filter((fields: Array<string>) =>
            fields.length > TITLECASE_FIELD && !fields[NAME_FIELD].endsWith("First>") && !fields[NAME_FIELD].endsWith("Last>"));
    }

    private codes(field: string): Array<number> {
        return field.trim().split(/\s+/).filter((part: string) => part.length > 0).map((part: string) => Number.parseInt(part, 16));
    }

    private specialCasing(text: string): Map<number, FullMapping> {
        // SpecialCasing.txt: code; lower; title; upper; then a condition list for the mappings that depend on context or language.
        const mappings: Map<number, FullMapping> = new Map<number, FullMapping>();
        for (const line of text.split("\n")) {
            const fields: Array<string> = line.split("#")[0].split(";");
            if (fields.length < 4 || fields[0].trim().length === 0 || (fields[4] ?? "").trim().length > 0) {
                continue;
            }
            mappings.set(Number.parseInt(fields[0].trim(), 16), { title: this.codes(fields[2]), upper: this.codes(fields[3]) });
        }
        return mappings;
    }

    private titlecase(characters: ReadonlyArray<Array<string>>, special: ReadonlyMap<number, FullMapping>): Array<[number, Array<number>]> {
        // Unicode §3.13: the full mapping of SpecialCasing.txt replaces the simple one of UnicodeData.txt, whose titlecase
        // field defaults to the uppercase one. Only the characters whose titlecase is not their uppercase are listed.
        const result: Array<[number, Array<number>]> = [];
        for (const fields of characters) {
            const code: number = Number.parseInt(fields[0], 16);
            const simpleUpper: Array<number> = fields[UPPERCASE_FIELD].length > 0 ? this.codes(fields[UPPERCASE_FIELD]) : [code];
            const simpleTitle: Array<number> = fields[TITLECASE_FIELD].trim().length > 0 ? this.codes(fields[TITLECASE_FIELD]) : simpleUpper;
            const upper: Array<number> = special.get(code)?.upper ?? simpleUpper;
            const title: Array<number> = special.get(code)?.title ?? simpleTitle;
            if (title.join(" ") !== upper.join(" ")) {
                result.push([code, title]);
            }
        }
        return result;
    }

    private fullWidth(characters: ReadonlyArray<Array<string>>): Array<[number, number]> {
        // CSS Text 4 §2.1.1: for <narrow> "the mapping is from the code point to the decomposition", and for <wide> "from the
        // decomposition (minus the <wide> tag) back to the original code point".
        const result: Array<[number, number]> = [];
        for (const fields of characters) {
            const match: RegExpExecArray | null = WIDTH_MAPPING.exec(fields[DECOMPOSITION_FIELD]);
            if (match === null) {
                continue;
            }
            const code: number = Number.parseInt(fields[0], 16);
            const other: number = Number.parseInt(match[2], 16);
            result.push(match[1] === "narrow" ? [code, other] : [other, code]);
        }
        return result.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
    }

    private pairs(html: string, section: string): Array<[number, number]> {
        // The table of the section lists each character followed by the one it maps to, each with its code point.
        const start: number = html.lastIndexOf(section);
        const end: number = html.indexOf(TABLE_END, start);
        if (start < 0 || end < 0) {
            return [];
        }
        const found: Array<number> = [...html.substring(start, end).matchAll(CODE_POINT)].map((match: RegExpMatchArray) => Number.parseInt(match[1], 16));
        const result: Array<[number, number]> = [];
        for (let index: number = 0; index + 1 < found.length; index += 2) {
            result.push([found[index], found[index + 1]]);
        }
        return result;
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

    private render(titles: ReadonlyArray<[number, Array<number>]>, widths: ReadonlyArray<[number, number]>, kana: ReadonlyArray<[number, number]>,
        italic: ReadonlyArray<[number, number]>): string {
        const titleRows: Array<string> = titles.map((entry: [number, Array<number>]) =>
            "    [0x" + this.hex(entry[0]) + ", [" + entry[1].map((code: number) => "0x" + this.hex(code)).join(", ") + "]]");
        return this.header()
            + "export const TITLECASE: ReadonlyArray<readonly [number, ReadonlyArray<number>]> = [\n" + titleRows.join(",\n") + "\n];\n\n"
            + this.renderPairs("FULL_WIDTH", widths) + "\n" + this.renderPairs("FULL_SIZE_KANA", kana) + "\n" + this.renderPairs("MATH_ITALIC", italic);
    }

    private renderVariants(variants: ReadonlyArray<[string, Array<[number, number]>]>): string {
        return this.header()
            + "export const MATH_VARIANTS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number]>]> = [\n"
            + variants.map((entry: [string, Array<[number, number]>]) => "    [\"" + entry[0] + "\", [" + entry[1].map((pair: [number, number]) => "[0x" + this.hex(pair[0])
                + ", 0x" + this.hex(pair[1]) + "]").join(", ") + "]]").join(",\n") + "\n];\n";
    }

    private renderPairs(name: string, pairs: ReadonlyArray<[number, number]>): string {
        const rows: Array<string> = pairs.map((pair: [number, number]) => "    [0x" + this.hex(pair[0]) + ", 0x" + this.hex(pair[1]) + "]");
        return "export const " + name + ": ReadonlyArray<readonly [number, number]> = [\n" + rows.join(",\n") + "\n];\n";
    }

    private hex(code: number): string {
        return code.toString(16).toUpperCase();
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new TextTransformGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "TextTransforms.ts"), join(PACKAGE_ROOT, "ts", "mathml", "generated", "MathVariants.ts")).run();
    console.log("Generated ts/pdf/generated/TextTransforms.ts and ts/mathml/generated/MathVariants.ts");
} catch (error) {
    console.error("Error generating the text transform tables:", error);
    process.exitCode = 1;
}
