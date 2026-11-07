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

const SOURCE_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/IndicSyllabicCategory.txt";
const ENTRY: RegExp = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/;
const ANUDATTA: number = 0x0952;
const PLACEHOLDERS: ReadonlyArray<number> = [0x00A0, 0x25CC];
const CLASSES: Readonly<Record<string, string>> = {
    "Consonant": "C", "Consonant_Dead": "C", "Vowel_Independent": "V", "Nukta": "N", "Virama": "H", "Vowel_Dependent": "M", "Consonant_Medial": "M",
    "Bindu": "SM", "Visarga": "SM", "Syllable_Modifier": "SM", "Cantillation_Mark": "VD", "Consonant_Placeholder": "NBSP", "Joiner": "ZWJ",
    "Non_Joiner": "ZWNJ", "Consonant_Preceding_Repha": "R"
};

class IndicShapingDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const response: Response = await fetch(SOURCE_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + SOURCE_URL + ": " + response.status + " " + response.statusText);
        }
        // Indic shaping engine, "Find next syllable in the input": the classes the syllable patterns are written with, taken
        // from the Indic_Syllabic_Category of each character; anudatta and the no-break space are named in the patterns.
        const classes: Map<number, string> = new Map<number, string>();
        for (const line of (await response.text()).split("\n")) {
            const match: RegExpExecArray | null = ENTRY.exec(line);
            const name: string | undefined = match === null ? undefined : CLASSES[match[3]];
            if (match === null || name === undefined) {
                continue;
            }
            const first: number = Number.parseInt(match[1], 16);
            for (let code: number = first; code <= (match[2] === undefined ? first : Number.parseInt(match[2], 16)); code++) {
                classes.set(code, name);
            }
        }
        classes.set(ANUDATTA, "A");
        for (const code of PLACEHOLDERS) {
            classes.set(code, "NBSP");
        }
        const names: Array<string> = ["X", ...new Set<string>(classes.values())];
        const ranges: Array<[number, number, number]> = [];
        for (const code of [...classes.keys()].sort((first: number, second: number) => first - second)) {
            const value: number = names.indexOf(classes.get(code) as string);
            const last: [number, number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && last[2] === value && last[1] + 1 === code) {
                last[1] = code;
            } else {
                ranges.push([code, code, value]);
            }
        }
        console.log("Read " + classes.size + " characters in " + ranges.length + " ranges");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(names, ranges), "utf8");
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
        const hex: (code: number) => string = (code: number): string => "0x" + code.toString(16).toUpperCase();
        return header
            + "export const INDIC_CLASSES: ReadonlyArray<string> = [" + names.map((name: string) => "\"" + name + "\"").join(", ") + "];\n\n"
            + "export const INDIC_RANGES: ReadonlyArray<readonly [number, number, number]> = [\n"
            + ranges.map((range: [number, number, number]) => "    [" + hex(range[0]) + ", " + hex(range[1]) + ", " + range[2] + "]").join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new IndicShapingDataGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "IndicShapingData.ts")).run();
    console.log("Generated ts/fonts/generated/IndicShapingData.ts");
} catch (error) {
    console.error("Error generating the Indic shaping data:", error);
    process.exitCode = 1;
}
