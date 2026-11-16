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
const NAME_FIELD: number = 1;
const COMBINING_CLASS_FIELD: number = 3;

interface ConditionalMapping {
    code: number;
    lower: Array<number>;
    title: Array<number>;
    upper: Array<number>;
    conditions: Array<string>;
}

class CaseMappingGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const mappings: Array<ConditionalMapping> = this.conditional(await this.fetchText(UCD_URL + "SpecialCasing.txt"));
        const classes: Array<[number, number, number]> = this.combiningClasses(await this.fetchText(UCD_URL + "UnicodeData.txt"));
        if (mappings.length === 0 || classes.length === 0) {
            throw new Error("The case mappings or the combining classes were not found");
        }
        console.log("Read " + mappings.length + " conditional case mappings and " + classes.length + " combining class ranges");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(mappings, classes), "utf8");
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private codes(field: string): Array<number> {
        return field.trim().split(/\s+/).filter((part: string) => part.length > 0).map((part: string) => Number.parseInt(part, 16));
    }

    private conditional(text: string): Array<ConditionalMapping> {
        const mappings: Array<ConditionalMapping> = [];
        for (const line of text.split("\n")) {
            const fields: Array<string> = line.split("#")[0].split(";");
            const conditions: Array<string> = (fields[4] ?? "").trim().split(/\s+/).filter((part: string) => part.length > 0);
            if (fields.length < 5 || fields[0].trim().length === 0 || conditions.length === 0) {
                continue;
            }
            mappings.push({ code: Number.parseInt(fields[0].trim(), 16), lower: this.codes(fields[1]), title: this.codes(fields[2]), upper: this.codes(fields[3]), conditions });
        }
        return mappings;
    }

    private combiningClasses(text: string): Array<[number, number, number]> {
        // UAX #44 §5.7.3: a pair of lines whose names end in "First>" and "Last>" stands for a range, which has no combining classes.
        const ranges: Array<[number, number, number]> = [];
        for (const line of text.split("\n")) {
            const fields: Array<string> = line.split(";");
            if (fields.length <= COMBINING_CLASS_FIELD || fields[NAME_FIELD].endsWith("First>") || fields[NAME_FIELD].endsWith("Last>")) {
                continue;
            }
            const combining: number = Number.parseInt(fields[COMBINING_CLASS_FIELD], 10);
            if (combining === 0) {
                continue;
            }
            const code: number = Number.parseInt(fields[0], 16);
            const last: [number, number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && last[1] + 1 === code && last[2] === combining) {
                last[1] = code;
            } else {
                ranges.push([code, code, combining]);
            }
        }
        return ranges;
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

    private render(mappings: ReadonlyArray<ConditionalMapping>, classes: ReadonlyArray<[number, number, number]>): string {
        const rows: Array<string> = mappings.map((mapping: ConditionalMapping) => "    [0x" + this.hex(mapping.code) + ", " + this.list(mapping.lower) + ", " + this.list(mapping.title)
            + ", " + this.list(mapping.upper) + ", [" + mapping.conditions.map((condition: string) => "\"" + condition + "\"").join(", ") + "]]");
        const classRows: Array<string> = classes.map((range: [number, number, number]) => "    [0x" + this.hex(range[0]) + ", 0x" + this.hex(range[1]) + ", " + range[2] + "]");
        return this.header()
            + "export const CONDITIONAL_CASING: ReadonlyArray<readonly [number, ReadonlyArray<number>, ReadonlyArray<number>, ReadonlyArray<number>, ReadonlyArray<string>]> = [\n"
            + rows.join(",\n") + "\n];\n\n"
            + "export const COMBINING_CLASSES: ReadonlyArray<readonly [number, number, number]> = [\n" + classRows.join(",\n") + "\n];\n";
    }

    private list(codes: ReadonlyArray<number>): string {
        return "[" + codes.map((code: number) => "0x" + this.hex(code)).join(", ") + "]";
    }

    private hex(code: number): string {
        return code.toString(16).toUpperCase();
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new CaseMappingGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "CaseMappings.ts")).run();
    console.log("Generated ts/pdf/generated/CaseMappings.ts");
} catch (error) {
    console.error("Error generating the case mapping tables:", error);
    process.exitCode = 1;
}
