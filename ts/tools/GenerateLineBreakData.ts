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
const ENTRY: RegExp = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/;
const MISSING: RegExp = /^#\s*@missing:\s*([0-9A-F]+)\.\.([0-9A-F]+);\s*(\w+)/;
const CODE_POINTS: number = 0x110000;
const CLASS_BITS: number = 6;
const EAST_ASIAN: number = 1 << CLASS_BITS;
const INITIAL_QUOTE: number = 2 << CLASS_BITS;
const FINAL_QUOTE: number = 4 << CLASS_BITS;
const UNASSIGNED_PICTOGRAPH: number = 8 << CLASS_BITS;
const MARK: number = 16 << CLASS_BITS;
const LETTER: number = 32 << CLASS_BITS;
const WIDE: number = 64 << CLASS_BITS;
const FULLWIDTH: number = 128 << CLASS_BITS;
const UNKNOWN: string = "XX";
const EAST_ASIAN_WIDTHS: ReadonlySet<string> = new Set<string>(["F", "W", "H"]);
const WIDE_WIDTHS: ReadonlySet<string> = new Set<string>(["A", "F", "W"]);
const MARK_CATEGORIES: ReadonlySet<string> = new Set<string>(["Mn", "Mc"]);

class LineBreakDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const breaks: Array<string> = this.values(await this.fetchText("LineBreak.txt"), UNKNOWN);
        const widths: Array<string> = this.values(await this.fetchText("EastAsianWidth.txt"), "N");
        const categories: Array<string> = this.values(await this.fetchText("extracted/DerivedGeneralCategory.txt"), "Cn");
        const pictographs: Array<string> = this.values(this.pictographic(await this.fetchText("emoji/emoji-data.txt")), "");
        const names: Array<string> = [...new Set<string>(breaks)].sort();
        if (names.length > 1 << CLASS_BITS) {
            throw new Error("There are more line breaking classes than the data format holds");
        }
        const data: Uint16Array = new Uint16Array(CODE_POINTS);
        for (let code: number = 0; code < CODE_POINTS; code++) {
            // UAX #14 rules LB19a and LB30 use the East Asian Width, LB15a and LB15b the initial and final quotation marks,
            // LB30b the unassigned pictographs, and LB1 the nonspacing and spacing marks.
            data[code] = names.indexOf(breaks[code])
                | (EAST_ASIAN_WIDTHS.has(widths[code]) ? EAST_ASIAN : 0)
                | (categories[code] === "Pi" ? INITIAL_QUOTE : 0)
                | (categories[code] === "Pf" ? FINAL_QUOTE : 0)
                | (categories[code] === "Cn" && pictographs[code] === "Extended_Pictographic" ? UNASSIGNED_PICTOGRAPH : 0)
                | (MARK_CATEGORIES.has(categories[code]) ? MARK : 0)
                // CSS Text 4 §6.1 and §6.2 use the letters and numbers, and the Ambiguous, Fullwidth and Wide characters.
                | (categories[code].startsWith("L") || categories[code].startsWith("N") ? LETTER : 0)
                | (WIDE_WIDTHS.has(widths[code]) ? WIDE : 0)
                // CSS Text 4 §8.4.1 tells Fullwidth characters apart from Wide ones.
                | (widths[code] === "F" ? FULLWIDTH : 0);
        }
        const ranges: Array<[number, number, number]> = [];
        for (let code: number = 0; code < CODE_POINTS; code++) {
            const last: [number, number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && last[2] === data[code]) {
                last[1] = code;
            } else {
                ranges.push([code, code, data[code]]);
            }
        }
        console.log("Read " + names.length + " line breaking classes in " + ranges.length + " ranges");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(names, ranges), "utf8");
    }

    private async fetchText(file: string): Promise<string> {
        const response: Response = await fetch(UCD_URL + file);
        if (!response.ok) {
            throw new Error("Failed to fetch " + UCD_URL + file + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private pictographic(text: string): string {
        return text.split("\n").filter((line: string) => /;\s*Extended_Pictographic\s*#/.test(line)).join("\n");
    }

    private values(text: string, initial: string): Array<string> {
        // The @missing lines give the value of the code points a file does not list, and the entries override them.
        const values: Array<string> = new Array<string>(CODE_POINTS).fill(initial);
        const lines: Array<string> = text.split("\n");
        for (const pattern of [MISSING, ENTRY]) {
            for (const line of lines) {
                const match: RegExpExecArray | null = pattern.exec(line);
                if (match === null || (pattern === MISSING && match[3].length > 3)) {
                    continue;
                }
                const first: number = Number.parseInt(match[1], 16);
                values.fill(match[3], first, (match[2] === undefined ? first : Number.parseInt(match[2], 16)) + 1);
            }
        }
        return values;
    }

    private render(names: ReadonlyArray<string>, ranges: ReadonlyArray<[number, number, number]>): string {
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
        const rows: Array<string> = ranges.map((range: [number, number, number]) =>
            "    [0x" + range[0].toString(16).toUpperCase() + ", 0x" + range[1].toString(16).toUpperCase() + ", " + range[2] + "]");
        return header
            + "export const LINE_BREAK_CLASSES: ReadonlyArray<string> = [" + names.map((name: string) => "\"" + name + "\"").join(", ") + "];\n\n"
            + "export const LINE_BREAK_CLASS_BITS: number = " + CLASS_BITS + ";\n\n"
            + "export const LINE_BREAK_RANGES: ReadonlyArray<readonly [number, number, number]> = [\n" + rows.join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new LineBreakDataGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "LineBreakData.ts")).run();
    console.log("Generated ts/pdf/generated/LineBreakData.ts");
} catch (error) {
    console.error("Error generating the line breaking data:", error);
    process.exitCode = 1;
}
