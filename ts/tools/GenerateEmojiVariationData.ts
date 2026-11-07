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

const DATA_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/emoji/emoji-variation-sequences.txt";
const ENTRY: RegExp = /^([0-9A-F]+)\s+FE0[EF]\s*;/;

class EmojiVariationDataGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        // CSS Fonts 4 §9.3: font-variant-emoji affects only "the code points listed by Unicode as contributing to a Unicode
        // emoji presentation sequence", which are the base characters of this file.
        const response: Response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + DATA_URL + ": " + response.status + " " + response.statusText);
        }
        const codes: Set<number> = new Set<number>();
        for (const line of (await response.text()).split("\n")) {
            const match: RegExpExecArray | null = ENTRY.exec(line);
            if (match !== null) {
                codes.add(Number.parseInt(match[1], 16));
            }
        }
        const ranges: Array<[number, number]> = [];
        for (const code of [...codes].sort((first: number, second: number) => first - second)) {
            const last: [number, number] | undefined = ranges[ranges.length - 1];
            if (last !== undefined && last[1] === code - 1) {
                last[1] = code;
            } else {
                ranges.push([code, code]);
            }
        }
        console.log("Read " + codes.size + " code points in " + ranges.length + " ranges");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(ranges), "utf8");
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
        return header + "export const EMOJI_VARIATION_RANGES: ReadonlyArray<readonly [number, number]> = [\n" + rows.join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new EmojiVariationDataGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "EmojiVariationData.ts")).run();
    console.log("Generated ts/pdf/generated/EmojiVariationData.ts");
} catch (error) {
    console.error("Error generating the emoji variation data:", error);
    process.exitCode = 1;
}
