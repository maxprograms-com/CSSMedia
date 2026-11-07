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

const SPEC_URL: string = "https://w3c.github.io/mathml-core/";
const MATHML4_URL: string = "https://www.w3.org/TR/mathml4/";
const TABLE_ROW: RegExp = /<tr>([\s\S]*?)<\/tr>/g;
const OPERATOR_TABLE: string = "id=\"contm_ops_table\"";
const SYMBOL_LINK: RegExp = /href="https:\/\/openmath\.org\/cd\/([A-Za-z0-9_]+)#([A-Za-z0-9_]+)"/g;
const FORMS: ReadonlyArray<string> = ["infix", "prefix", "postfix"];
const PROPERTIES: ReadonlyArray<string> = ["stretchy", "symmetric", "largeop", "movablelimits"];
const CODE_POINT: RegExp = /U\+([0-9A-F]+)/g;
const HEX_ENTRY: RegExp = /\[0x([0-9A-F]+)\u20130x([0-9A-F]+)\]|\{0x([0-9A-F]+)\}/g;
const UNICODE_ENTRY: RegExp = /\[U\+([0-9A-F]+)\u2013U\+([0-9A-F]+)\]|\{U\+([0-9A-F]+)\}|U\+([0-9A-F]+)/g;
const ROW: RegExp = /<tr>([\s\S]*?)<\/tr>/g;
const CELL: RegExp = /<td>([\s\S]*?)<\/td>/g;
const QUOTED: RegExp = /'([^']*)'/g;
const TAG: RegExp = /<[^>]*>/g;
const EM: RegExp = /^([0-9.]+)(?:em)?$/;

interface Category {
    name: string;
    form: string;
    encoding: number;
    lspace: number;
    rspace: number;
    flags: number;
}

class MathOperatorsGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        // MathML Core, Editor's Draft, Appendix B.1: the special tables of figure 24, the (Content, Form) keys of figure 25, the
        // values of the categories of figure 26, the entries of figure 27 and the operators of figure 28 with an inline stretch axis.
        const html: string = await this.fetchText(SPEC_URL);
        const ascii: Array<string> = this.asciiPairs(this.figure(html, "operator-dictionary-compact-special-tables"));
        const categories: Array<Category> = this.categories(this.figure(html, "operator-dictionary-categories-values"));
        const unencoded: Set<string> = new Set<string>(categories.filter((category: Category) => category.encoding < 0).map((category: Category) => category.name));
        const direct: Array<[number, number, number, string]> = this.directEntries(this.figure(html, "operator-dictionary-category-table"), unencoded);
        const entries: Array<[number, number]> = this.hexEntries(this.figure(html, "operator-dictionary-categories-hexa-table"));
        const inline: Array<number> = [...this.figure(html, "inline-stretch-axis").matchAll(CODE_POINT)].map((match: RegExpMatchArray) => Number.parseInt(match[1], 16));
        // MathML 4 Appendix E.3: the OpenMath symbols that encode each Content MathML operator element.
        const symbols: Array<[string, string, string]> = this.symbols(await this.fetchText(MATHML4_URL));
        if (ascii.length === 0 || categories.length === 0 || entries.length === 0 || inline.length === 0 || symbols.length === 0) {
            throw new Error("The operator dictionary of the specification was not found where it was expected");
        }
        console.log("Read " + ascii.length + " ASCII pairs, " + categories.length + " categories, " + direct.length + " direct entries, " + entries.length
            + " entry ranges, " + inline.length + " operators with an inline stretch axis and " + symbols.length + " content symbols");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(ascii, categories, direct, entries, inline, symbols), "utf8");
    }

    private symbols(html: string): Array<[string, string, string]> {
        // Each row names the element in its first cell and links its symbols, "https://openmath.org/cd/<cd>#<name>", in the second.
        const start: number = html.indexOf(OPERATOR_TABLE);
        const end: number = start < 0 ? -1 : html.indexOf("</table>", start);
        if (start < 0 || end < 0) {
            return [];
        }
        const result: Array<[string, string, string]> = [];
        for (const row of html.substring(start, end).matchAll(TABLE_ROW)) {
            const cells: Array<string> = [...row[1].matchAll(CELL)].map((cell: RegExpMatchArray) => cell[1]);
            const element: string = (cells[0] ?? "").replace(TAG, "").trim();
            for (const link of (cells[1] ?? "").matchAll(SYMBOL_LINK)) {
                result.push([link[1], link[2], element]);
            }
        }
        return result;
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private figure(html: string, id: string): string {
        const start: number = html.indexOf("<figure id=\"" + id + "\"");
        const end: number = start < 0 ? -1 : html.indexOf("</figure>", start);
        if (start < 0 || end < 0) {
            throw new Error("Figure " + id + " was not found");
        }
        return html.substring(start, end);
    }

    private asciiPairs(figure: string): Array<string> {
        for (const row of figure.matchAll(ROW)) {
            const cells: Array<string> = [...row[1].matchAll(CELL)].map((cell: RegExpMatchArray) => cell[1]);
            if (cells.length === 2 && cells[0].includes("Operators_2_ascii_chars")) {
                return [...this.decoded(cells[1]).matchAll(QUOTED)].map((match: RegExpMatchArray) => match[1]);
            }
        }
        return [];
    }

    private categories(figure: string): Array<Category> {
        const categories: Array<Category> = [];
        for (const row of figure.matchAll(ROW)) {
            const cells: Array<string> = [...row[1].matchAll(CELL)].map((cell: RegExpMatchArray) => this.decoded(cell[1].replace(TAG, "")).trim());
            if (cells.length !== 6) {
                continue;
            }
            let flags: number = 0;
            for (const word of cells[5].split(/\s+/)) {
                const index: number = PROPERTIES.indexOf(word);
                flags |= index < 0 ? 0 : 1 << index;
            }
            categories.push({
                name: cells[0], form: cells[1], encoding: cells[2] === "N/A" ? -1 : Number.parseInt(cells[2], 16), lspace: this.em(cells[3]), rspace: this.em(cells[4]), flags
            });
        }
        return categories;
    }

    private em(text: string): number {
        const match: RegExpExecArray | null = EM.exec(text);
        if (match === null) {
            throw new Error("The space " + text + " is not in em");
        }
        return Number.parseFloat(match[1]);
    }

    private directEntries(figure: string, unencoded: ReadonlySet<string>): Array<[number, number, number, string]> {
        // Figure 25 decides the category only for the categories without an encoding in figure 26; the others come from figure 27.
        const entries: Array<[number, number, number, string]> = [];
        for (const row of figure.matchAll(ROW)) {
            const cells: Array<string> = [...row[1].matchAll(CELL)].map((cell: RegExpMatchArray) => cell[1]);
            if (cells.length !== 2) {
                continue;
            }
            const category: string = cells[1].replace(TAG, "").trim();
            const form: number = FORMS.findIndex((name: string) => cells[0].includes("<strong>" + name + "</strong>"));
            if (!unencoded.has(category) || form < 0) {
                continue;
            }
            const code: string = cells[0].substring(cells[0].indexOf("<code>"));
            for (const match of code.matchAll(UNICODE_ENTRY)) {
                const first: number = Number.parseInt(match[1] ?? match[3] ?? match[4], 16);
                const last: number = match[2] === undefined ? first : Number.parseInt(match[2], 16);
                entries.push([first, last, form, category]);
            }
        }
        return entries;
    }

    private hexEntries(figure: string): Array<[number, number]> {
        const entries: Array<[number, number]> = [];
        for (const match of figure.matchAll(HEX_ENTRY)) {
            const first: number = Number.parseInt(match[1] ?? match[3], 16);
            entries.push([first, match[2] === undefined ? first : Number.parseInt(match[2], 16)]);
        }
        return entries;
    }

    private decoded(text: string): string {
        return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    }

    private hex(value: number): string {
        return "0x" + value.toString(16).toUpperCase();
    }

    private render(ascii: ReadonlyArray<string>, categories: ReadonlyArray<Category>, direct: ReadonlyArray<[number, number, number, string]>,
        entries: ReadonlyArray<[number, number]>, inline: ReadonlyArray<number>, symbols: ReadonlyArray<[string, string, string]>): string {
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
        const pairs: string = ascii.map((pair: string) => JSON.stringify(pair)).join(", ");
        const rows: string = categories.map((category: Category) => "    [" + JSON.stringify(category.name) + ", " + JSON.stringify(category.form) + ", "
            + category.encoding + ", " + category.lspace + ", " + category.rspace + ", " + category.flags + "]").join(",\n");
        const directRows: string = direct.map((entry: [number, number, number, string]) => "    [" + this.hex(entry[0]) + ", " + this.hex(entry[1]) + ", " + entry[2] + ", "
            + JSON.stringify(entry[3]) + "]").join(",\n");
        const entryRows: string = entries.map((entry: [number, number]) => "[" + this.hex(entry[0]) + ", " + this.hex(entry[1]) + "]").join(", ");
        const inlineRows: string = inline.map((code: number) => this.hex(code)).join(", ");
        return header
            + "export const OPERATORS_2_ASCII_CHARS: ReadonlyArray<string> = [" + pairs + "];\n\n"
            + "export const OPERATOR_CATEGORIES: ReadonlyArray<readonly [string, string, number, number, number, number]> = [\n" + rows + "\n];\n\n"
            + "export const OPERATOR_DIRECT_ENTRIES: ReadonlyArray<readonly [number, number, number, string]> = [\n" + directRows + "\n];\n\n"
            + "export const OPERATOR_ENTRIES: ReadonlyArray<readonly [number, number]> = [" + entryRows + "];\n\n"
            + "export const INLINE_STRETCH_AXIS: ReadonlyArray<number> = [" + inlineRows + "];\n\n"
            + "export const CONTENT_SYMBOLS: ReadonlyArray<readonly [string, string, string]> = [\n"
            + symbols.map((entry: [string, string, string]) => "    [" + JSON.stringify(entry[0]) + ", " + JSON.stringify(entry[1]) + ", " + JSON.stringify(entry[2]) + "]")
                .join(",\n") + "\n];\n";
    }

}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new MathOperatorsGenerator(join(PACKAGE_ROOT, "ts", "mathml", "generated", "MathOperators.ts")).run();
    console.log("Generated ts/mathml/generated/MathOperators.ts");
} catch (error) {
    console.error("Error generating the operator dictionary:", error);
    process.exitCode = 1;
}
