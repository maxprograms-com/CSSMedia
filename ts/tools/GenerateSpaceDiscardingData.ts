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
const BASE_UCD_URL: string = "https://www.unicode.org/Public/13.0.0/ucd/";
const ENTRY: RegExp = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/;
const DISCARDING_SCRIPTS: ReadonlySet<string> = new Set<string>(["Han", "Hiragana", "Katakana", "Yi"]);
const LISTED_BLOCKS: ReadonlyArray<readonly [number, number]> = [
    [0x2E80, 0x2EFF], [0x2F00, 0x2FDF], [0x2FF0, 0x2FFF], [0x3000, 0x303F], [0x3040, 0x309F], [0x30A0, 0x30FF], [0x3190, 0x319F],
    [0x31C0, 0x31EF], [0x31F0, 0x31FF], [0x3300, 0x33FF], [0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xA000, 0xA48F], [0xA490, 0xA4CF],
    [0xF900, 0xFAFF], [0xFE10, 0xFE1F], [0xFE30, 0xFE4F], [0xFE50, 0xFE6F], [0xFF00, 0xFFEF], [0x1B000, 0x1B0FF], [0x1B100, 0x1B12F],
    [0x1B130, 0x1B16F], [0x20000, 0x2A6DF], [0x2A700, 0x2B73F], [0x2B740, 0x2B81F], [0x2B820, 0x2CEAF], [0x2CEB0, 0x2EBEF],
    [0x2F800, 0x2FA1F], [0x30000, 0x3134F]
];

class SpaceDiscardingDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        // CSS Text 3 of 29 April 2020, Appendix F: the listed blocks of Unicode 13.0, and "any new block whose contents comprise
        // at least 50% codepoints belonging to the Han, Hiragana, Katakana, or Yi script".
        const known: Set<string> = new Set<string>(this.entries(await this.fetchText(BASE_UCD_URL + "Blocks.txt")).map((block: [number, number, string]) => block[0] + ".." + block[1]));
        const scripts: Array<[number, number, string]> = this.entries(await this.fetchText(UCD_URL + "Scripts.txt"));
        const blocks: Array<[number, number]> = LISTED_BLOCKS.map((block: readonly [number, number]): [number, number] => [block[0], block[1]]);
        for (const [start, end] of this.entries(await this.fetchText(UCD_URL + "Blocks.txt"))) {
            if (known.has(start + ".." + end)) {
                continue;
            }
            let assigned: number = 0;
            let discarding: number = 0;
            for (const [first, last, script] of scripts) {
                const shared: number = Math.min(end, last) - Math.max(start, first) + 1;
                if (shared > 0) {
                    assigned += shared;
                    discarding += DISCARDING_SCRIPTS.has(script) ? shared : 0;
                }
            }
            if (assigned > 0 && discarding * 2 >= assigned) {
                blocks.push([start, end]);
            }
        }
        blocks.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
        const ranges: Array<[number, number]> = [];
        for (const block of blocks) {
            const last: [number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && block[0] <= last[1] + 1) {
                last[1] = Math.max(last[1], block[1]);
            } else {
                ranges.push([block[0], block[1]]);
            }
        }
        console.log("Read " + blocks.length + " space-discarding blocks in " + ranges.length + " ranges");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(ranges), "utf8");
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private entries(text: string): Array<[number, number, string]> {
        const entries: Array<[number, number, string]> = [];
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = ENTRY.exec(line);
            if (match !== null) {
                const first: number = Number.parseInt(match[1], 16);
                entries.push([first, match[2] === undefined ? first : Number.parseInt(match[2], 16), match[3]]);
            }
        }
        return entries;
    }

    private render(ranges: ReadonlyArray<[number, number]>): string {
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
        const rows: Array<string> = ranges.map((range: [number, number]) =>
            "    [0x" + range[0].toString(16).toUpperCase() + ", 0x" + range[1].toString(16).toUpperCase() + "]");
        return header + "export const SPACE_DISCARDING_RANGES: ReadonlyArray<readonly [number, number]> = [\n" + rows.join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new SpaceDiscardingDataGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "SpaceDiscardingData.ts")).run();
    console.log("Generated ts/pdf/generated/SpaceDiscardingData.ts");
} catch (error) {
    console.error("Error generating the space-discarding data:", error);
    process.exitCode = 1;
}
