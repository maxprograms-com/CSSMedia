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
const USE_URL: string = "https://raw.githubusercontent.com/microsoft/font-tools/main/USE/";
const ENTRY: RegExp = /^\s*([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/;
const CODE_POINTS: number = 0x110000;
const BASE_OTHER: ReadonlySet<number> = new Set<number>([0x2015, 0x2022, 0x25FB, 0x25FC, 0x25FD, 0x25FE]);
const JOINING: ReadonlySet<string> = new Set<string>(["C", "D", "L", "R"]);
const POSITIONS: Readonly<Record<string, string>> = {
    "Top": "Abv", "Top_And_Bottom": "Abv", "Top_And_Bottom_And_Right": "Abv", "Top_And_Right": "Abv",
    "Bottom": "Blw", "Overstruck": "Blw", "Bottom_And_Right": "Blw",
    "Left": "Pre", "Top_And_Left": "Pre", "Top_And_Left_And_Right": "Pre", "Left_And_Right": "Pre",
    "Right": "Pst"
};

interface Character {
    syllabic: string;
    positional: string;
    category: string;
    joining: string;
    script: string;
}

class UniversalShapingDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        // Universal Shaping Engine, "Overrides to Unicode categories": the two override files replace the Unicode values.
        const syllabic: Array<string> = this.values([await this.fetchText(UCD_URL + "IndicSyllabicCategory.txt"),
            await this.fetchText(USE_URL + "IndicSyllabicCategory-Additional.txt")], "Other");
        const positional: Array<string> = this.values([await this.fetchText(UCD_URL + "IndicPositionalCategory.txt"),
            await this.fetchText(USE_URL + "IndicPositionalCategory-Additional.txt")], "Not_Applicable");
        const categories: Array<string> = this.values([await this.fetchText(UCD_URL + "extracted/DerivedGeneralCategory.txt")], "Cn");
        const joining: Array<string> = this.values([await this.fetchText(UCD_URL + "extracted/DerivedJoiningType.txt")], "U");
        const scripts: Array<string> = this.values([await this.fetchText(UCD_URL + "Scripts.txt")], "Unknown");
        const names: Array<string> = [];
        const classes: Uint8Array = new Uint8Array(CODE_POINTS);
        for (let code: number = 0; code < CODE_POINTS; code++) {
            const name: string = this.classOf(code, {
                syllabic: syllabic[code], positional: positional[code], category: categories[code], joining: joining[code], script: scripts[code]
            });
            let index: number = names.indexOf(name);
            if (index < 0) {
                index = names.length;
                names.push(name);
            }
            classes[code] = index;
        }
        const ranges: Array<[number, number, number]> = [];
        for (let code: number = 0; code < CODE_POINTS; code++) {
            const last: [number, number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && last[2] === classes[code]) {
                last[1] = code;
            } else {
                ranges.push([code, code, classes[code]]);
            }
        }
        const splits: Array<[number, Array<number>]> = this.splitVowels(await this.fetchText(UCD_URL + "UnicodeData.txt"), syllabic);
        const invalid: Array<Array<number>> = this.sequences(await this.fetchText(USE_URL + "IndicShapingInvalidCluster.txt"));
        console.log("Read " + names.length + " classes in " + ranges.length + " ranges, " + splits.length + " split vowels and " + invalid.length + " invalid clusters");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(names, ranges, splits, invalid), "utf8");
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private values(texts: ReadonlyArray<string>, initial: string): Array<string> {
        const values: Array<string> = new Array<string>(CODE_POINTS).fill(initial);
        for (const text of texts) {
            for (const line of text.split("\n")) {
                const match: RegExpExecArray | null = ENTRY.exec(line);
                if (match !== null) {
                    const first: number = Number.parseInt(match[1], 16);
                    values.fill(match[3], first, (match[2] === undefined ? first : Number.parseInt(match[2], 16)) + 1);
                }
            }
        }
        return values;
    }

    private classOf(code: number, character: Character): string {
        // Universal Shaping Engine, "Character classification": the class of a character from its Unicode properties, and
        // the subclass of the classes that vary by position from its Indic_Positional_Category.
        const syllabic: string = character.syllabic;
        const letter: boolean = character.category === "Lo";
        const position: string = POSITIONS[character.positional] ?? "";
        if (code === 0x034F) {
            return "CGJ";
        }
        if (code >= 0xFE00 && code <= 0xFE0F) {
            return "VS";
        }
        if (code === 0x2060) {
            return "WJ";
        }
        switch (syllabic) {
            case "Joiner":
                return "ZWJ";
            case "Non_Joiner":
                return "ZWNJ";
            case "Hieroglyph":
                return "G";
            case "Hieroglyph_Modifier":
                return "HM";
            case "Hieroglyph_Mirror":
                return "HR";
            case "Hieroglyph_Joiner":
                return "J";
            case "Hieroglyph_Mark_Begin":
            case "Hieroglyph_Segment_Begin":
                return "SB";
            case "Hieroglyph_Mark_End":
            case "Hieroglyph_Segment_End":
                return "SE";
            case "Consonant_Placeholder":
                return "GB";
            case "Number":
            case "Consonant":
            case "Consonant_Head_Letter":
            case "Tone_Letter":
            case "Vowel_Independent":
                return "B";
            case "Nukta":
            case "Gemination_Mark":
            case "Consonant_Killer":
            case "Symbol_Modifier":
                return position === "Abv" ? "CMAbv" : "CMBlw";
            case "Consonant_With_Stacker":
                return "CS";
            case "Consonant_Succeeding_Repha":
                return position === "Abv" || position === "Blw" ? "F" + position : "FPst";
            case "Syllable_Modifier":
            case "Consonant_Final_Modifier":
                return "FM";
            case "Virama":
            case "Invisible_Stacker":
                return "H";
            case "Number_Joiner":
                return "HN";
            case "Consonant_Dead":
            case "Modifying_Letter":
                return "IND";
            case "Brahmi_Joining_Number":
                return "N";
            case "Consonant_Preceding_Repha":
            case "Consonant_Prefixed":
                return "R";
            case "Reordering_Killer":
                return "RK";
            case "Pure_Killer":
                return "V" + (position === "" ? "Pst" : position);
            case "Tone_Mark":
            case "Cantillation_Mark":
            case "Register_Shifter":
            case "Visarga":
                return "VM" + (position === "" ? "Pst" : position);
            case "Avagraha":
                if (letter) {
                    return "B";
                }
                break;
            case "Bindu":
                return letter ? "B" : "VM" + (position === "" ? "Pst" : position);
            case "Consonant_Final":
                return letter ? "B" : (position === "Abv" || position === "Blw" ? "F" + position : "FPst");
            case "Consonant_Medial":
                return letter ? "B" : "M" + (position === "" ? "Pst" : position);
            case "Consonant_Subjoined":
                return letter ? "B" : "SUB";
            case "Vowel":
            case "Vowel_Dependent":
                return letter ? "B" : "V" + (position === "" ? "Pst" : position);
            default:
                break;
        }
        if (JOINING.has(character.joining)) {
            return "B";
        }
        if (BASE_OTHER.has(code)) {
            return "GB";
        }
        if (character.category === "Cn") {
            return "Rsv";
        }
        if ((character.category === "So" && code !== 0x25CC) || character.category === "Sc") {
            return "S";
        }
        if (character.category === "Zs" || character.script === "Common" || (character.category === "Po" && code === 0x104E)) {
            return "O";
        }
        return "IND";
    }

    private splitVowels(text: string, syllabic: ReadonlyArray<string>): Array<[number, Array<number>]> {
        // Universal Shaping Engine, "Split vowel handling": a Vowel_Dependent character is replaced by its decomposition in
        // UnicodeData.txt, "applied recursively so that split vowels get fully decomposed".
        const mappings: Map<number, Array<number>> = new Map<number, Array<number>>();
        for (const line of text.split("\n")) {
            const fields: Array<string> = line.split(";");
            if (fields.length > 5 && /^[0-9A-F ]+$/.test(fields[5]) && syllabic[Number.parseInt(fields[0], 16)] === "Vowel_Dependent") {
                mappings.set(Number.parseInt(fields[0], 16), fields[5].split(" ").map((part: string) => Number.parseInt(part, 16)));
            }
        }
        const full: (code: number) => Array<number> = (code: number): Array<number> => (mappings.get(code) ?? [code]).flatMap((part: number) =>
            part === code ? [part] : full(part));
        return [...mappings.keys()].sort((first: number, second: number) => first - second).map((code: number): [number, Array<number>] => [code, full(code)]);
    }

    private sequences(text: string): Array<Array<number>> {
        const sequences: Array<Array<number>> = [];
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = /^\s*([0-9A-F]{4,6}(?:\s+[0-9A-F]{4,6})+)\s*;/.exec(line);
            if (match !== null) {
                sequences.push(match[1].trim().split(/\s+/).map((part: string) => Number.parseInt(part, 16)));
            }
        }
        return sequences;
    }

    private render(names: ReadonlyArray<string>, ranges: ReadonlyArray<[number, number, number]>, splits: ReadonlyArray<[number, Array<number>]>,
        invalid: ReadonlyArray<Array<number>>): string {
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
        const list: (codes: ReadonlyArray<number>) => string = (codes: ReadonlyArray<number>): string => "[" + codes.map(hex).join(", ") + "]";
        return header
            + "export const USE_CLASSES: ReadonlyArray<string> = [" + names.map((name: string) => "\"" + name + "\"").join(", ") + "];\n\n"
            + "export const USE_RANGES: ReadonlyArray<readonly [number, number, number]> = [\n"
            + ranges.map((range: [number, number, number]) => "    [" + hex(range[0]) + ", " + hex(range[1]) + ", " + range[2] + "]").join(",\n") + "\n];\n\n"
            + "export const USE_SPLIT_VOWELS: ReadonlyArray<readonly [number, ReadonlyArray<number>]> = [\n"
            + splits.map((split: [number, Array<number>]) => "    [" + hex(split[0]) + ", " + list(split[1]) + "]").join(",\n") + "\n];\n\n"
            + "export const USE_INVALID_CLUSTERS: ReadonlyArray<ReadonlyArray<number>> = [\n"
            + invalid.map((sequence: Array<number>) => "    " + list(sequence)).join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new UniversalShapingDataGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "UniversalShapingData.ts")).run();
    console.log("Generated ts/fonts/generated/UniversalShapingData.ts");
} catch (error) {
    console.error("Error generating the universal shaping data:", error);
    process.exitCode = 1;
}
