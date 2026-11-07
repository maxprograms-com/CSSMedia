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
const MAX_CODEPOINT: number = 0x10FFFF;
const LONG_NAMES: Readonly<Record<string, string>> = {
    "Left_To_Right": "L", "Right_To_Left": "R", "Arabic_Letter": "AL", "European_Number": "EN", "European_Separator": "ES", "European_Terminator": "ET",
    "Arabic_Number": "AN", "Common_Separator": "CS", "Nonspacing_Mark": "NSM", "Boundary_Neutral": "BN", "Paragraph_Separator": "B", "Segment_Separator": "S",
    "White_Space": "WS", "Other_Neutral": "ON"
};

class BidiDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const classes: Array<string> = this.classesOf(await this.fetchText("extracted/DerivedBidiClass.txt"));
        const ranges: Array<[number, number, string]> = [];
        let start: number = 0;
        for (let codepoint: number = 1; codepoint <= MAX_CODEPOINT + 1; codepoint++) {
            if (codepoint > MAX_CODEPOINT || classes[codepoint] !== classes[start]) {
                // L is the class of every code point the table does not list.
                if (classes[start] !== "L") {
                    ranges.push([start, codepoint - 1, classes[start]]);
                }
                start = codepoint;
            }
        }
        const mirrors: Array<[number, number]> = this.pairsOf(await this.fetchText("BidiMirroring.txt"));
        const brackets: Array<[number, number, string]> = this.bracketsOf(await this.fetchText("BidiBrackets.txt"));
        const mirrored: Array<[number, number]> = this.propertyRanges(await this.fetchText("extracted/DerivedBinaryProperties.txt"), "Bidi_Mirrored");
        console.log("Read " + ranges.length + " bidi class ranges, " + mirrors.length + " mirrored characters, " + brackets.length + " brackets and "
            + mirrored.length + " ranges with the Bidi_Mirrored property");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(ranges, mirrors, brackets, mirrored), "utf8");
    }

    private propertyRanges(text: string, property: string): Array<[number, number]> {
        const ranges: Array<[number, number]> = [];
        for (const line of text.split("\n")) {
            const entry: RegExpExecArray | null = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/.exec(line);
            if (entry !== null && entry[3] === property) {
                const first: number = Number.parseInt(entry[1], 16);
                ranges.push([first, entry[2] === undefined ? first : Number.parseInt(entry[2], 16)]);
            }
        }
        return ranges.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
    }

    private async fetchText(path: string): Promise<string> {
        const response: Response = await fetch(UCD_URL + path);
        if (!response.ok) {
            throw new Error("Failed to fetch " + UCD_URL + path + ": " + response.status + " " + response.statusText);
        }
        return await response.text();
    }

    private classesOf(text: string): Array<string> {
        const classes: Array<string> = new Array<string>(MAX_CODEPOINT + 1).fill("L");
        const fill: (first: number, last: number, name: string) => void = (first: number, last: number, name: string): void => {
            for (let codepoint: number = first; codepoint <= last; codepoint++) {
                classes[codepoint] = name;
            }
        };
        // The @missing lines give the class of the unassigned code points of each block, and the entries override them.
        for (const line of text.split("\n")) {
            const missing: RegExpExecArray | null = /^#\s*@missing:\s*([0-9A-F]+)\.\.([0-9A-F]+);\s*(\w+)/.exec(line);
            if (missing !== null) {
                fill(Number.parseInt(missing[1], 16), Number.parseInt(missing[2], 16), LONG_NAMES[missing[3]] ?? missing[3]);
            }
        }
        for (const line of text.split("\n")) {
            const entry: RegExpExecArray | null = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/.exec(line);
            if (entry !== null) {
                const first: number = Number.parseInt(entry[1], 16);
                fill(first, entry[2] === undefined ? first : Number.parseInt(entry[2], 16), entry[3]);
            }
        }
        return classes;
    }

    private pairsOf(text: string): Array<[number, number]> {
        const pairs: Array<[number, number]> = [];
        for (const line of text.split("\n")) {
            const entry: RegExpExecArray | null = /^([0-9A-F]+);\s*([0-9A-F]+)/.exec(line);
            if (entry !== null) {
                pairs.push([Number.parseInt(entry[1], 16), Number.parseInt(entry[2], 16)]);
            }
        }
        return pairs;
    }

    private bracketsOf(text: string): Array<[number, number, string]> {
        const brackets: Array<[number, number, string]> = [];
        for (const line of text.split("\n")) {
            const entry: RegExpExecArray | null = /^([0-9A-F]+);\s*([0-9A-F]+);\s*([oc])/.exec(line);
            if (entry !== null) {
                brackets.push([Number.parseInt(entry[1], 16), Number.parseInt(entry[2], 16), entry[3]]);
            }
        }
        return brackets;
    }

    private render(ranges: ReadonlyArray<[number, number, string]>, mirrors: ReadonlyArray<[number, number]>, brackets: ReadonlyArray<[number, number, string]>,
        mirrored: ReadonlyArray<[number, number]>): string {
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
        const hex: (value: number) => string = (value: number): string => "0x" + value.toString(16).toUpperCase();
        return header
            + "export const BIDI_CLASS_RANGES: ReadonlyArray<readonly [number, number, string]> = [\n"
            + ranges.map((range: [number, number, string]) => "    [" + hex(range[0]) + ", " + hex(range[1]) + ", \"" + range[2] + "\"]").join(",\n") + "\n];\n\n"
            + "export const BIDI_MIRRORS: ReadonlyArray<readonly [number, number]> = [\n"
            + mirrors.map((pair: [number, number]) => "    [" + hex(pair[0]) + ", " + hex(pair[1]) + "]").join(",\n") + "\n];\n\n"
            + "export const BIDI_BRACKETS: ReadonlyArray<readonly [number, number, string]> = [\n"
            + brackets.map((bracket: [number, number, string]) => "    [" + hex(bracket[0]) + ", " + hex(bracket[1]) + ", \"" + bracket[2] + "\"]").join(",\n") + "\n];\n\n"
            + "export const BIDI_MIRRORED: ReadonlyArray<readonly [number, number]> = [\n"
            + mirrored.map((range: [number, number]) => "    [" + hex(range[0]) + ", " + hex(range[1]) + "]").join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new BidiDataGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "BidiData.ts")).run();
    console.log("Generated ts/pdf/generated/BidiData.ts");
} catch (error) {
    console.error("Error generating the bidi data table:", error);
    process.exitCode = 1;
}
